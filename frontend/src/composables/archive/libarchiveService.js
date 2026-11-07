/**
 * libarchive檔案處理服務
 * 基於libarchive.js，專門處理RAR、7Z、TAR等格式檔案
 */

import { Archive } from "libarchive.js";
import { sharedFileBlobCache, getOrDownloadFileBlob, isWebAssemblySupported, countTotalFiles, countExtractedFiles } from "./archiveUtils.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("Libarchive");

/**
 * libarchive檔案處理服務類
 */
class LibarchiveService {
  constructor() {
    this.libarchiveInitialized = false;
    this.initPromise = null;

    // 簡單配置物件
    this.config = {
      workerUrl: "/libarchive.js/dist/worker-bundle.js",
    };

    // 使用共享的檔案Blob快取
    this.fileBlobCache = sharedFileBlobCache;
  }

  /**
   * 統一的libarchive檔案解壓介面
   * @param {Blob|File|string} fileBlobOrUrl - 壓縮檔案 Blob 物件或URL
   * @param {string} filename - 檔名
   * @param {string} fileUrl - 檔案URL（用於快取鍵）
   * @param {Function} progressCallback - 進度回撥函式 (progress: 0-100)
   * @param {string|null} password - 可選的解壓密碼
   * @param {Object} archiveType - 壓縮格式資訊
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractArchive(fileBlobOrUrl, filename, fileUrl = "", progressCallback = null, password = null, archiveType) {
    log.debug(`開始處理 ${archiveType.name} 格式檔案:`, filename);

    // libarchive格式：密碼檢測和分支邏輯
    let hasEncrypted = false;
    let fileBlob = null;

    if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
      // 遠端檔案：先下載用於檢測
      fileBlob = await getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 0, 50, "下載中");
      hasEncrypted = await this.libarchiveEncryptionCheck(fileBlob, archiveType, progressCallback);
    } else {
      hasEncrypted = await this.libarchiveEncryptionCheck(fileBlobOrUrl, archiveType, progressCallback);
      fileBlob = fileBlobOrUrl;
    }

    // 第二步：根據加密狀態和密碼情況選擇處理方式
    if (hasEncrypted && !password) {
      throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
    } else if (hasEncrypted && password) {
      // 加密檔案需要密碼：fileBlob應該已經在檢測階段準備好了
      if (!fileBlob) {
        log.warn("密碼解壓時fileBlob為空，嘗試重新獲取");
        if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
          fileBlob = await getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 60, 70, "重新下載");
        } else {
          fileBlob = fileBlobOrUrl;
        }
      }

      if (progressCallback) progressCallback(70, "準備密碼解壓");
      return await this.extractLibarchiveWithPassword(fileBlob, archiveType, password, progressCallback);
    } else {
      return await this.extractWithLibarchiveStream(fileBlob, archiveType, progressCallback);
    }
  }

  /**
   * 初始化 libarchive.js（懶載入）
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async initLibarchive() {
    if (this.libarchiveInitialized) {
      return true;
    }

    // 避免重複初始化
    if (this.initPromise) {
      return await this.initPromise;
    }

    this.initPromise = this._performInit();
    return await this.initPromise;
  }

  async _performInit() {
    try {
      // 檢查 WebAssembly 支援
      if (!isWebAssemblySupported()) {
        log.warn("當前瀏覽器不支援 WebAssembly，libarchive.js 功能將不可用");
        return false;
      }

      log.debug("正在初始化 libarchive.js WebWorker:", this.config.workerUrl);

      Archive.init({
        workerUrl: this.config.workerUrl,
      });

      this.libarchiveInitialized = true;
      log.debug("libarchive.js 初始化成功，WebWorker已配置");
      return true;
    } catch (error) {
      log.warn("libarchive.js 初始化失敗，將降級到僅支援 ZIP:", error);
      return false;
    }
  }

  /**
   * libarchive加密檢測
   * @param {Blob} fileBlob - 已下載的檔案Blob
   * @param {Object} archiveType - 壓縮格式資訊
   * @param {Function} progressCallback - 進度回撥函式
   * @returns {Promise<boolean>} true表示檢測到加密，false表示無加密
   */
  async libarchiveEncryptionCheck(fileBlob, archiveType, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，無法檢測 ${archiveType.name} 格式`);
    }

    try {
    log.debug(`開始檢測 ${archiveType.name} 檔案是否加密...`);
      if (progressCallback) progressCallback(55, "檢測加密");

      // 使用官方API開啟壓縮檔案
      const archive = await Archive.open(fileBlob);

      try {
        // 檢查是否有加密資料
        const hasEncrypted = await archive.hasEncryptedData();

        if (progressCallback) {
          progressCallback(60, hasEncrypted ? "發現加密" : "無加密");
        }

        log.debug(`${archiveType.name} 加密檢測完成:`, hasEncrypted === true ? "有加密" : "無加密");
        return hasEncrypted === true;
      } finally {
        // 關閉archive釋放worker
        try {
          await archive.close();
        } catch (closeError) {
          log.warn("關閉archive時出錯:", closeError);
        }
      }
    } catch (error) {
      log.warn(`⚠️ ${archiveType.name} 加密檢測失敗:`, error.message);
      return false;
    }
  }

  /**
   * libarchive密碼解壓
   * @param {Blob} fileBlob - 已下載的檔案Blob
   * @param {Object} archiveType - 壓縮格式資訊
   * @param {string} password - 解壓密碼
   * @param {Function} progressCallback - 進度回撥函式
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractLibarchiveWithPassword(fileBlob, archiveType, password, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，無法處理 ${archiveType.name} 格式`);
    }

    let archive = null;
    try {
      log.debug(`開始libarchive密碼解壓 ${archiveType.name} 檔案...`);
      if (progressCallback) progressCallback(75, "解析中");

      // 開啟壓縮檔案
      archive = await Archive.open(fileBlob);
      // 設定密碼
      await archive.usePassword(password);
      log.debug(`${archiveType.name} 檔案密碼已設定`);

      // 全量解壓所有檔案
      const extractedFiles = await archive.extractFiles((entry) => {
        if (progressCallback && entry.path) {
          log.debug(`正在解壓: ${entry.path}`);
        }
      });
      log.debug(`${archiveType.name} 全量解壓完成`);

      const result = [];
      let processedFiles = 0;
      const totalFiles = countExtractedFiles(extractedFiles);

      // 轉換為統一格式（全量解壓，內容已快取）
      const processFiles = (obj, basePath = "") => {
        for (const [name, item] of Object.entries(obj)) {
          const fullPath = basePath ? `${basePath}/${name}` : name;

          if (item instanceof File) {
            // 這是一個已解壓的File物件
            result.push({
              name: fullPath,
              size: item.size || 0,
              compressedSize: 0,
              isDirectory: false,
              lastModDate: item.lastModified ? new Date(item.lastModified) : new Date(),
              entry: {
                entry: item,
                type: "libarchive-password",
                cachedContent: null, // 將在下面設定
                async getContent() {
                  // 直接返回快取的ArrayBuffer
                  if (!this.cachedContent) {
                    this.cachedContent = await item.arrayBuffer();
                  }
                  return this.cachedContent;
                },
              },
            });

            // 立即快取內容
            item.arrayBuffer().then((buffer) => {
              result[result.length - 1].entry.cachedContent = buffer;
            });
          } else if (typeof item === "object" && item !== null) {
            // 這是一個目錄，遞迴處理
            result.push({
              name: fullPath + "/",
              size: 0,
              compressedSize: 0,
              isDirectory: true,
              lastModDate: new Date(),
              entry: {
                entry: null,
                type: "libarchive-password",
                async getContent() {
                  throw new Error("Cannot extract directory");
                },
              },
            });
            processFiles(item, fullPath);
          }

          // 更新解壓進度
          processedFiles++;
          if (progressCallback) {
            // 解壓進度：75-100%
            const extractProgress = 75 + (processedFiles / totalFiles) * 25;
            progressCallback(Math.min(extractProgress, 100), "解壓中");
          }
        }
      };

      processFiles(extractedFiles);

      if (progressCallback) progressCallback(100, "完成");

      log.debug(`libarchive密碼解壓完成，處理了 ${result.length} 個專案`);
      return result;
    } catch (error) {
      log.error(`libarchive密碼解壓 ${archiveType.name} 失敗:`, error);
      throw new Error(`${archiveType.name} 密碼解壓失敗: ${error.message}`);
    } finally {
      // 確保關閉archive釋放worker
      if (archive) {
        try {
          await archive.close();
        } catch (closeError) {
          log.warn("關閉archive時出錯:", closeError);
        }
      }
    }
  }

  /**
   * 使用 libarchive.js 按需解壓模式
   * @param {Blob|File} fileBlob - 壓縮檔案 Blob 物件
   * @param {Object} archiveType - 壓縮格式資訊
   * @param {Function} progressCallback - 進度回撥函式 (progress: 0-100)
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractWithLibarchiveStream(fileBlob, archiveType, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，無法處理 ${archiveType.name} 格式`);
    }

    let archive = null;
    try {
      // 使用官方API開啟壓縮檔案
      archive = await Archive.open(fileBlob);
      // 獲取檔案列表（不解壓內容，按需解壓模式）
      const filesObject = await archive.getFilesObject();

      log.debug(`libarchive.js 獲取 ${archiveType.name} 檔案列表完成`);
      log.debug(`檔案內容將按需解壓，不佔用大量記憶體`);

      // 轉換為統一格式（按需解壓）
      const result = [];
      let processedFiles = 0;
      const totalFiles = countTotalFiles(filesObject); // 計算總檔案數

      const processFiles = (obj, basePath = "") => {
        for (const [name, item] of Object.entries(obj)) {
          const fullPath = basePath ? `${basePath}/${name}` : name;

          if (item && typeof item.extract === "function") {
            // 這是一個 CompressedFile，支援按需解壓
            result.push({
              name: fullPath,
              size: item.size || 0,
              compressedSize: item.compressedSize || 0,
              isDirectory: false,
              lastModDate: new Date(),
              entry: {
                entry: item,
                type: "libarchive",
                async getContent() {
                  // 按需解壓：只有在需要時才解壓單個檔案
                  log.debug(`按需解壓檔案: ${fullPath}`);
                  try {
                    const file = await item.extract();
                    return await file.arrayBuffer();
                  } catch (error) {
                    log.error(`解壓檔案 ${fullPath} 失敗:`, error);
                    throw new Error(`解壓檔案失敗: ${error.message}`);
                  }
                },
              },
            });
          } else if (typeof item === "object" && item !== null) {
            // 這是一個目錄，遞迴處理
            result.push({
              name: fullPath + "/",
              size: 0,
              compressedSize: 0,
              isDirectory: true,
              lastModDate: new Date(),
              entry: {
                entry: null,
                type: "libarchive",
                async getContent() {
                  throw new Error("Cannot extract directory");
                },
              },
            });
            processFiles(item, fullPath);
          }

          // 更新檔案列表處理進度
          processedFiles++;
          if (progressCallback) {
            // 檔案列表處理進度
            const progress = (processedFiles / totalFiles) * 100;
            progressCallback(Math.min(progress, 100), "分析檔案");
          }
        }
      };

      processFiles(filesObject);

      log.debug(`libarchive按需解壓準備完成，處理了 ${result.length} 個專案`);
      return result;
    } catch (error) {
      log.error(`libarchive.js 解壓 ${archiveType.name} 失敗:`, error);
      throw new Error(`${archiveType.name} 檔案解壓失敗: ${error.message}`);
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
    log.debug("已清除libarchive服務檔案Blob快取:", fileUrl);
  }
}

// 匯出單例例項
export const libarchiveService = new LibarchiveService();
export default libarchiveService;
