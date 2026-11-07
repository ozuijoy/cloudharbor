/**
 * ZIP檔案處理服務
 * 基於zip.js，專門處理ZIP格式檔案
 */

/**
 * 情況1：HttpRangeReader成功（無加密）
 * Range檢測(484B) → 無加密 → 無快取 → 流式下載解壓
 *
 * 情況2：HttpRangeReader失敗（無加密）
 * Range檢測失敗 → 降級下載+快取 → 無加密 → 檢測到快取 → 使用快取解壓
 *
 * 情況3：加密檔案
 * 檢測+快取 → 有加密 → 使用快取解壓
 */
import {
  ZipReaderStream,
  ZipReader,
  BlobReader,
  BlobWriter,
  HttpRangeReader,
  configure,
  terminateWorkers,
  ERR_ENCRYPTED,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_INVALID_ENTRY_NAME,
} from "@zip.js/zip.js";
import { ARCHIVE_CONSTANTS, sharedFileBlobCache, getOrDownloadFileBlob } from "./archiveUtils.js";
import { getZipJsDefaultConfig } from "@/utils/zipjsRuntimeUris.js";
import { createLogger } from "@/utils/logger.js";

// 全域性配置標誌
let isZipJSConfigured = false;
const log = createLogger("ZipService");

/**
 * 初始化zip.js全域性配置
 */
function initializeZipJSConfig() {
  if (isZipJSConfigured) return;

  // 2.8+：顯式配置 workerURI/wasmURI並統一全域性預設引數
  const config = getZipJsDefaultConfig();
  configure(config);

  isZipJSConfigured = true;
  log.debug(`zip.js 全域性配置已初始化:
    - chunkSize: ${Math.round((config.chunkSize || 0) / 1024)}KB
    - maxWorkers: ${config.maxWorkers}
    - useWebWorkers: enabled
    - useCompressionStream: enabled
    - workerURI/wasmURI: configured`);
}

/**
 * 標準化錯誤處理
 */
function handleZipError(error) {
  const errorMessage = error.message || "";

  // 錯誤常量
  if (errorMessage === ERR_ENCRYPTED) {
    throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
  }
  if (errorMessage === ERR_CENTRAL_DIRECTORY_NOT_FOUND) {
    throw new Error("CORRUPTED_ARCHIVE");
  }
  if (errorMessage === ERR_INVALID_ENTRY_NAME) {
    throw new Error("INVALID_ARCHIVE_STRUCTURE");
  }

  // 密碼相關錯誤
  if (errorMessage.includes("Invalid password") || errorMessage.includes("Wrong password")) {
    throw new Error("INVALID_ARCHIVE_PASSWORD");
  }

  // 錯誤資訊
  log.warn("zip.js 錯誤:", errorMessage);
  throw error;
}

/**
 * ZIP64支援檢測工具類
 */
class ZIP64Detector {
  /**
   * 檢測ZIP檔案是否為ZIP64格式
   * @param {ZipReader} zipReader - ZIP讀取器例項
   * @returns {Promise<Object>} ZIP64檢測結果
   */
  static async detectZIP64Support(zipReader) {
    try {
      const entries = await zipReader.getEntries();

      let hasLargeFiles = false;
      let hasManyEntries = false;
      let largestFileSize = 0;
      let largestFileName = "";

      // 檢查是否有超過4GB的檔案
      for (const entry of entries) {
        const uncompressedSize = entry.uncompressedSize || 0;
        const compressedSize = entry.compressedSize || 0;

        if (uncompressedSize > largestFileSize) {
          largestFileSize = uncompressedSize;
          largestFileName = entry.filename;
        }

        // 4GB = 0xFFFFFFFF (4294967295 bytes)
        if (uncompressedSize > 0xffffffff || compressedSize > 0xffffffff) {
          hasLargeFiles = true;
        }
      }

      // 檢查是否有超過65535個條目
      if (entries.length > 0xffff) {
        hasManyEntries = true;
      }

      const isZIP64 = hasLargeFiles || hasManyEntries;

      return {
        isZIP64,
        hasLargeFiles,
        hasManyEntries,
        totalEntries: entries.length,
        largestFileSize,
        largestFileName,
        largestFileSizeMB: (largestFileSize / 1024 / 1024).toFixed(2),
        requiresZIP64: isZIP64,
      };
    } catch (error) {
      log.warn("ZIP64檢測失敗:", error);
      return {
        isZIP64: false,
        hasLargeFiles: false,
        hasManyEntries: false,
        totalEntries: 0,
        largestFileSize: 0,
        largestFileName: "",
        largestFileSizeMB: "0",
        requiresZIP64: false,
        error: error.message,
      };
    }
  }
}

/**
 * 並行解壓工具類（僅用於密碼保護的ZIP檔案）
 */
class ParallelExtractionManager {
  constructor(maxConcurrency = navigator.hardwareConcurrency || 2) {
    this.maxConcurrency = Math.min(maxConcurrency, 8); // 最多8個併發
    this.semaphore = new Semaphore(this.maxConcurrency);
  }

  /**
   * 並行解壓多個檔案條目
   * @param {Array} entries - 檔案條目陣列
   * @param {Function} progressCallback - 進度回撥
   * @returns {Promise<Array>} 解壓結果陣列
   */
  async extractEntriesInParallel(entries, progressCallback = null) {
    let completedCount = 0;

    log.debug(`開始並行解壓 ${entries.length} 個檔案，併發數: ${this.maxConcurrency}`);

    const extractPromises = entries.map(async (entry) => {
      await this.semaphore.acquire();

      try {
        const startTime = performance.now();

        // 並行解壓單個檔案
        const writer = new BlobWriter();
        await entry.getData(writer, {
          onprogress: () => {
            // 進度資訊透過 progressCallback 傳遞給UI層
          },
        });

        const blob = await writer.getData();
        const content = await blob.arrayBuffer();
        const endTime = performance.now();

        completedCount++;

        // 更新總體進度
        if (progressCallback) {
          const overallProgress = (completedCount / entries.length) * 100;
          progressCallback(overallProgress, `並行解壓 ${completedCount}/${entries.length}`);
        }

        return {
          name: entry.filename,
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory: false,
          lastModDate: entry.lastModDate || new Date(),
          content,
          extractionTime: endTime - startTime,
          entry: {
            entry: entry,
            type: "zipjs-parallel",
            cachedContent: content,
            async getContent() {
              return this.cachedContent;
            },
          },
        };
      } finally {
        this.semaphore.release();
      }
    });

    // 等待所有檔案解壓完成
    const extractedFiles = await Promise.all(extractPromises);

    log.debug(`並行解壓完成！總計 ${extractedFiles.length} 個檔案`);
    return extractedFiles;
  }
}

/**
 * 訊號量實現（控制併發數量）
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      this.current++;
      resolve();
    }
  }
}

/**
 * 建立統一的ZipReader配置（官方最佳實踐）
 */
function createOptimalZipReaderConfig(options = {}) {
  return {
    useWebWorkers: true, // 啟用Web Workers
    useCompressionStream: true, // 使用原生壓縮流
    transferStreams: true, // 啟用流傳輸最佳化
    // 允許特定場景的覆蓋
    ...options,
  };
}

/**
 * ZIP檔案處理服務類
 */
class ZipService {
  constructor() {
    // 使用共享的檔案Blob快取
    this.fileBlobCache = sharedFileBlobCache;

    // 初始化高階功能元件
    this.zip64Detector = ZIP64Detector;
    this.parallelManager = new ParallelExtractionManager();

    // 初始化全域性配置
    initializeZipJSConfig();
  }

  /**
   * 清理zip.js資源
   */
  async cleanup() {
    try {
      await terminateWorkers();
      log.debug("zip.js Workers已終止");
    } catch (error) {
      log.warn("清理zip.js資源時出錯:", error);
    }
  }

  /**
   * 統一的ZIP檔案解壓介面
   * @param {Blob|File|string} fileBlobOrUrl - 壓縮檔案 Blob 物件或URL
   * @param {string} filename - 檔名
   * @param {string} fileUrl - 檔案URL（用於快取鍵）
   * @param {Function} progressCallback - 進度回撥函式 (progress: 0-100)
   * @param {string|null} password - 可選的解壓密碼
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractArchive(fileBlobOrUrl, filename, fileUrl = "", progressCallback = null, password = null) {
    log.debug(`開始處理 ZIP 格式檔案:`, filename);

    // 第一步：檢測檔案是否加密
    let isEncrypted = false;
    let fileBlob = null;

    if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
      // 先用流式檢測（不下載完整檔案）
      isEncrypted = await this.lightweightEncryptionCheck(fileBlobOrUrl, progressCallback);
    } else {
      // 本地檔案：直接檢測
      isEncrypted = await this.quickEncryptionCheck(fileBlobOrUrl);
      fileBlob = fileBlobOrUrl;
    }

    if (isEncrypted && !password) {
      throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
    } else if (isEncrypted && password) {
      // 檢測到加密且有密碼：現在才下載完整檔案
      if (!fileBlob && typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        fileBlob = await getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 0, 70, "下載中");
      } else if (!fileBlob) {
        fileBlob = fileBlobOrUrl;
        if (progressCallback) progressCallback(70, "準備解壓");
      }
      return await this.extractZipWithPassword(fileBlob, password, progressCallback);
    } else {
      // 無加密：檢查是否有快取，優先使用快取避免重複下載
      // 如果HttpRangeReader失敗降級時已快取檔案，直接使用快取
      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        const cachedBlob = sharedFileBlobCache.get(fileBlobOrUrl);
        if (cachedBlob) {
          log.debug("使用快取檔案進行流式解壓:", fileBlobOrUrl);
          return await this.extractWithZipReaderStream(cachedBlob, progressCallback);
        }
      }
      // 使用流式解壓（不需要下載完整檔案）
      return await this.extractWithZipReaderStream(fileBlobOrUrl, progressCallback);
    }
  }

  /**
   * 基於Range請求的加密檢測
   * @param {string} fileUrl - 遠端檔案URL
   * @param {Function} progressCallback - 進度回撥函式
   * @returns {Promise<boolean>} true表示檢測到加密，false表示無加密
   */
  async rangeBasedEncryptionCheck(fileUrl, progressCallback = null) {
    try {
      log.debug("開始HttpRangeReader加密檢測:", fileUrl);
      if (progressCallback) progressCallback(20, "Range檢測");

      // 使用HttpRangeReader進行智慧Range請求
      const httpRangeReader = new HttpRangeReader(fileUrl, {
        useXHR: false,
      });

      // 建立ZipReader（HttpRangeReader已經內建了Range請求支援）
      const zipReader = new ZipReader(httpRangeReader, createOptimalZipReaderConfig());

      if (progressCallback) progressCallback(50, "獲取檔案列表");

      // 獲取ZIP檔案條目列表
      const entries = await zipReader.getEntries();

      if (progressCallback) progressCallback(80, "檢測加密");

      // 檢查前幾個檔案的加密狀態
      const checkCount = Math.min(entries.length, ARCHIVE_CONSTANTS.DETECTION.MAX_CHECK_ENTRIES);
      let hasEncrypted = false;

      for (let i = 0; i < checkCount; i++) {
        const entry = entries[i];
        if (entry.encrypted) {
          hasEncrypted = true;
          break;
        }
      }

      // 關閉reader釋放資源
      await zipReader.close();

      log.debug(`HttpRangeReader檢測完成: ${hasEncrypted ? "發現加密" : "無加密"}, 檢查了${checkCount}個條目`);
      return hasEncrypted;
    } catch (error) {
      log.warn("⚠️ HttpRangeReader檢測失敗:", error.message);
      // 重新丟擲錯誤，讓呼叫者決定如何處理
      throw error;
    }
  }

  /**
   * 輕量級加密檢測（智慧檢測，適用於遠端檔案）
   * 優先使用HttpRangeReader進行部分下載檢測，失敗時降級到快取下載檢測
   * 降級時會快取完整檔案，避免後續extractArchive重複下載
   * @param {string} fileUrl - 遠端檔案URL
   * @param {Function} progressCallback - 進度回撥函式
   * @returns {Promise<boolean>} true表示檢測到加密，false表示無加密
   */
  async lightweightEncryptionCheck(fileUrl, progressCallback = null) {
    try {
      log.debug("開始加密檢測:", fileUrl);
      if (progressCallback) progressCallback(10, "開始檢測");

      // 優先嚐試HttpRangeReader方式（真正的部分下載）
      try {
        const hasEncrypted = await this.rangeBasedEncryptionCheck(fileUrl, progressCallback);

        if (progressCallback) {
          progressCallback(100, hasEncrypted ? "發現加密" : "無加密");
        }

        log.debug(`HttpRangeReader檢測成功: ${hasEncrypted ? "發現加密" : "無加密"}`);
        return hasEncrypted;
      } catch (rangeError) {
        log.warn("⚠️ HttpRangeReader檢測失敗，降級到快取下載檢測:", rangeError.message);
        if (progressCallback) progressCallback(30, "降級檢測");
      }

      // 降級方案：下載完整檔案並快取，避免後續重複下載
      log.debug("降級使用快取下載檢測方式...");
      if (progressCallback) progressCallback(40, "下載檢測");

      // 使用getOrDownloadFileBlob確保檔案被快取
      // 這樣後續的extractArchive可以直接使用快取，避免重複下載
      const fileBlob = await getOrDownloadFileBlob(fileUrl, progressCallback, 40, 80, "下載中");

      if (progressCallback) progressCallback(90, "檢測加密");

      // 使用quickEncryptionCheck進行檢測
      const hasEncrypted = await this.quickEncryptionCheck(fileBlob);

      if (progressCallback) {
        progressCallback(100, hasEncrypted ? "發現加密" : "無加密");
      }

      log.debug(`快取下載檢測完成: ${hasEncrypted ? "發現加密" : "無加密"}`);
      return hasEncrypted;
    } catch (error) {
      log.warn("⚠️ 加密檢測失敗:", error.message);
      // 統一使用標準化錯誤處理
      try {
        handleZipError(error);
      } catch (handledError) {
        // 如果是已知的嚴重錯誤（如檔案損壞），重新丟擲
        if (handledError.message.includes("CORRUPTED_ARCHIVE")) {
          throw handledError;
        }
      }
      // 檢測失敗時保守處理：假設無加密
      return false;
    }
  }

  /**
   * 快速加密檢測（純檢測，無下載）
   * @param {Blob} fileBlob - 已下載的檔案Blob
   * @returns {Promise<boolean>} true表示檢測到加密，false表示無加密
   */
  async quickEncryptionCheck(fileBlob) {
    try {
      log.debug("開始加密檢測blob...");
      const zipReader = new ZipReader(new BlobReader(fileBlob));
      const entries = await zipReader.getEntries();

      const checkCount = Math.min(entries.length, ARCHIVE_CONSTANTS.DETECTION.MAX_CHECK_ENTRIES);
      for (let i = 0; i < checkCount; i++) {
        const entry = entries[i];
        if (entry.encrypted) {
          await zipReader.close();
          return true;
        }
      }

      await zipReader.close();
      return false;
    } catch (error) {
      log.warn("⚠️ 快速加密檢測失敗:", error.message);
      // 檢測失敗時保守處理：假設無加密
      return false;
    }
  }

  /**
   * ZIP密碼解壓（純解壓，無下載）
   * @param {Blob} fileBlob - 已下載的檔案Blob
   * @param {string} password - 解壓密碼
   * @param {Function} progressCallback - 進度回撥函式
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractZipWithPassword(fileBlob, password, progressCallback = null) {
    try {
      log.debug("開始ZipReader進行密碼解壓...");
      if (progressCallback) progressCallback(75, "解析中");

      // 使用ZipReader進行密碼解壓
      const zipReader = new ZipReader(new BlobReader(fileBlob), {
        password,
      });

      const entries = await zipReader.getEntries({
        // 獲取條目列表時的進度回撥
        onprogress: (progress, total) => {
          if (progressCallback && total > 0) {
            const percentage = 75 + (progress / total) * 5; // 75-80%
            progressCallback(percentage, "掃描檔案");
          }
        },
      });

      // ZIP64支援檢測
      const zip64Info = await this.zip64Detector.detectZIP64Support(zipReader);
      if (zip64Info.isZIP64) {
        log.debug(`ZIP64格式: ${zip64Info.totalEntries}個檔案, 最大${zip64Info.largestFileSizeMB}MB (${zip64Info.largestFileName})`);
      }

      // 智慧選擇解壓策略
      const shouldUseParallel = this.shouldUseParallelExtraction(entries, zip64Info);

      if (shouldUseParallel) {
        log.debug("使用並行解壓策略");
        if (progressCallback) progressCallback(80, "並行解壓中");

        // 過濾出非目錄檔案進行並行解壓
        const fileEntries = entries.filter((entry) => !entry.directory);
        const directoryEntries = entries.filter((entry) => entry.directory);

        // 並行解壓檔案
        const parallelResults = await this.parallelManager.extractEntriesInParallel(fileEntries, (progress, status) => {
          if (progressCallback) {
            const adjustedProgress = 80 + progress * 0.15; // 80-95%
            progressCallback(adjustedProgress, status);
          }
        });

        // 新增目錄條目（不需要解壓內容）
        const directoryResults = directoryEntries.map((entry) => ({
          name: entry.filename,
          size: 0,
          compressedSize: 0,
          isDirectory: true,
          lastModDate: entry.lastModDate || new Date(),
          entry: {
            entry: entry,
            type: "zipjs-reader",
            async getContent() {
              throw new Error("Cannot extract directory");
            },
          },
        }));

        const result = [...parallelResults, ...directoryResults];
        await zipReader.close();

        if (progressCallback) progressCallback(100, "完成");
        log.debug(`並行解壓完成，處理了 ${entries.length} 個條目`);
        return result;
      }

      // 傳統順序解壓
      log.debug("使用傳統順序解壓策略");
      const result = [];
      let processedEntries = 0;

      for (const entry of entries) {
        if (entry.directory) {
          // 目錄條目
          result.push({
            name: entry.filename,
            size: 0,
            compressedSize: 0,
            isDirectory: true,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              async getContent() {
                throw new Error("Cannot extract directory");
              },
            },
          });
        } else {
          // 檔案條目 - 立即解密內容

          let cachedContent;
          try {
            const writer = new BlobWriter();
            // 使用官方的進度回撥進行檔案解壓
            await entry.getData(writer, {
              onprogress: (index, max) => {
                if (progressCallback && max > 0) {
                  const fileProgress = (index / max) * 100;
                  const overallProgress = 80 + (processedEntries / entries.length) * 15 + (fileProgress / entries.length) * 0.15;
                  progressCallback(Math.min(overallProgress, 95), `解壓 ${entry.filename}`);
                }
              },
            });
            // BlobWriter.getData() 返回Promise，需要await
            const blob = await writer.getData();
            cachedContent = await blob.arrayBuffer();
          } catch (error) {
            // 統一使用標準化錯誤處理
            handleZipError(error);
          }

          result.push({
            name: entry.filename,
            size: entry.uncompressedSize || 0,
            compressedSize: entry.compressedSize || 0,
            isDirectory: false,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              cachedContent,
              async getContent() {
                // 直接返回快取的ArrayBuffer
                return this.cachedContent;
              },
            },
          });
        }

        processedEntries++;

        // 解壓進度：75-100%
        if (progressCallback) {
          const extractProgress = 75 + (processedEntries / entries.length) * 25;
          progressCallback(Math.min(extractProgress, 100), "解壓中");
        }
      }

      await zipReader.close();

      if (progressCallback) progressCallback(100, "完成");

      log.debug(`ZipReader 密碼解壓完成，處理了 ${entries.length} 個條目`);
      return result;
    } catch (error) {
      log.error("ZIP密碼解壓失敗:", error);
      // 統一使用標準化錯誤處理
      handleZipError(error);
    }
  }

  /**
   * 智慧解壓策略選擇
   * @param {Array} entries - 檔案條目陣列
   * @param {Object} zip64Info - ZIP64檢測資訊
   * @returns {boolean} 是否應該使用並行解壓
   */
  shouldUseParallelExtraction(entries, zip64Info) {
    const fileEntries = entries.filter((entry) => !entry.directory);
    const totalFiles = fileEntries.length;

    // 基礎條件檢查（合併策略1-4）
    const hasVeryLargeFiles = fileEntries.some(
      (entry) => (entry.uncompressedSize || 0) > 50 * 1024 * 1024 // 50MB
    );
    const totalUncompressedSize = fileEntries.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0);
    const cpuCores = navigator.hardwareConcurrency || 2;

    // 快速排除條件（不適合並行解壓）
    if (totalFiles < 3) {
      log.debug(`使用順序解壓: 檔案數量少(${totalFiles}個)`);
      return false;
    }
    if (hasVeryLargeFiles) {
      log.debug("使用順序解壓: 檢測到超大檔案(>50MB)");
      return false;
    }
    if (totalUncompressedSize > 200 * 1024 * 1024) {
      log.debug(`使用順序解壓: 總體積過大(${(totalUncompressedSize / 1024 / 1024).toFixed(0)}MB)`);
      return false;
    }
    if (cpuCores < 4) {
      log.debug(`使用順序解壓: CPU核心不足(${cpuCores}核)`);
      return false;
    }

    // ZIP64特殊處理
    if (zip64Info.isZIP64) {
      if (zip64Info.hasLargeFiles && !zip64Info.hasManyEntries) {
        log.debug("ZIP64大檔案格式 → 順序解壓");
        return false;
      } else if (zip64Info.hasManyEntries && !zip64Info.hasLargeFiles) {
        if (totalFiles >= 10 && totalFiles <= 200 && cpuCores >= 4) {
          log.debug("ZIP64大量檔案格式 → 並行解壓");
          return true;
        }
      } else if (zip64Info.hasLargeFiles && zip64Info.hasManyEntries) {
        if (cpuCores >= 8 && totalFiles <= 50) {
          log.debug("ZIP64複合格式 → 高效能並行解壓");
          return true;
        }
        log.debug("ZIP64複合格式 → 順序解壓");
        return false;
      }
    }

    // 最終判斷：檔案數量與CPU核心數匹配
    if (totalFiles >= 4 && totalFiles <= 50) {
      log.debug(`使用並行解壓: ${totalFiles}個檔案，${cpuCores}核CPU`);
      return true;
    }

    // 預設策略
    log.debug("使用預設順序解壓策略");
    return false;
  }

  /**
   * 使用 ZipReaderStream 統一流式解壓 ZIP 檔案（支援URL和Blob輸入）
   * @param {string|Blob|File} fileBlobOrUrl - ZIP 檔案URL或Blob物件
   * @param {Function} progressCallback - 進度回撥函式 (progress: 0-100)
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractWithZipReaderStream(fileBlobOrUrl, progressCallback = null) {
    try {
      let readableStream;
      let totalSize = 0;
      let loaded = 0;
      let isRemoteFile = false;

      // 統一獲取ReadableStream
      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        // 遠端檔案：fetch獲取stream
        log.debug("ZipReaderStream 處理遠端ZIP檔案:", fileBlobOrUrl);
        isRemoteFile = true;

        const response = await fetch(fileBlobOrUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get("content-length");
        totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        readableStream = response.body;

        log.debug(`遠端ZIP檔案大小: ${totalSize ? (totalSize / 1024 / 1024).toFixed(2) + "MB" : "未知"}`);
      } else {
        // 本地Blob：使用Blob.stream()轉換為ReadableStream
        log.debug("ZipReaderStream 處理本地ZIP檔案");
        const blob = fileBlobOrUrl;
        totalSize = blob.size;
        readableStream = blob.stream();

        log.debug(`本地ZIP檔案大小: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      }

      // 建立進度監控的TransformStream（統一處理）
      const progressMonitorStream = new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.length;

          if (totalSize > 0 && progressCallback) {
            // 下載/讀取進度佔70%，解壓進度佔30%
            const readProgress = (loaded / totalSize) * ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO;
            const stage = isRemoteFile ? "下載中" : "讀取中";
            progressCallback(Math.min(readProgress, ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO), stage);
          }

          controller.enqueue(chunk);
        },
      });

      const result = [];
      let processedEntries = 0;
      let estimatedTotalEntries = ARCHIVE_CONSTANTS.ESTIMATION.INITIAL_ENTRIES; // 初始估算值，會動態調整

      // 使用統一配置的 ZipReaderStream 流式處理（chunkSize由全域性configure()控制）
      const zipReaderStream = new ZipReaderStream(createOptimalZipReaderConfig());

      log.debug("開始流式解析ZIP條目...");

      // ReadableStream → 進度監控 → ZIP解析（統一處理）
      for await (const entry of readableStream.pipeThrough(progressMonitorStream).pipeThrough(zipReaderStream)) {
        // 轉換為統一格式
        const fileInfo = {
          name: entry.filename,
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory: entry.directory,
          lastModDate: entry.lastModDate || new Date(),
          entry: {
            entry: entry,
            type: "zipjs-stream",
            async getContent() {
              // 使用Response API
              if (!entry.readable) {
                throw new Error(`Entry "${entry.filename}" readable stream is not available`);
              }

              // Response建構函式接受ReadableStream
              return new Response(entry.readable).arrayBuffer();
            },
          },
        };

        result.push(fileInfo);
        processedEntries++;

        // 動態調整估算的總條目數
        if (processedEntries > estimatedTotalEntries * 0.8) {
          estimatedTotalEntries = Math.ceil(processedEntries * 1.5);
        }

        // 解壓進度：70-100%（基於動態估算的總條目數）
        if (progressCallback) {
          const extractProgress = ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO + (processedEntries / estimatedTotalEntries) * ARCHIVE_CONSTANTS.PROGRESS.EXTRACT_RATIO;
          progressCallback(Math.min(extractProgress, 95), "解壓中");
        }
      }

      // 確保進度達到100%
      if (progressCallback) {
        progressCallback(100, "完成");
      }

      log.debug(`ZipReaderStream 流式解壓完成: ${result.length}個檔案 (${(loaded / 1024 / 1024).toFixed(1)}MB)`);
      return result;
    } catch (error) {
      log.error("ZipReaderStream 流式解壓失敗:", error);
      throw error;
    }
  }

  /**
   * 清除檔案Blob快取
   * @param {string} fileUrl - 檔案URL
   */
  clearFileBlobCache(fileUrl) {
    // 共享快取由archiveUtils管理
    if (!fileUrl) return;

    this.fileBlobCache.delete(fileUrl);
    log.debug("已清除ZIP服務檔案Blob快取:", fileUrl);
  }
}

// 匯出單例例項
export const zipService = new ZipService();

// 匯出全域性清理函式（用於應用關閉時呼叫）
export const cleanupZipJS = async () => {
  await zipService.cleanup();
};

export default zipService;
