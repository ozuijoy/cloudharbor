/**
 * 壓縮檔案處理工具類
 * 統一管理常量、工具方法和快取，避免程式碼重複
 */

import { LRUCache } from "@/utils/lruCache.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ArchiveUtils");

// ===================================================================
// 統一常量定義
// ===================================================================

export const ARCHIVE_CONSTANTS = {
  // 快取配置
  CACHE: {
    EXTRACT_SIZE: 10, // 解壓結果快取大小
    FILE_BLOB_SIZE: 2, // 檔案Blob快取大小
    TTL: 10 * 60 * 1000, // 快取時間：10分鐘
  },
  // 檢測配置
  DETECTION: {
    MAX_CHECK_ENTRIES: 3, // 加密檢測最大檢查條目數
  },
  // 進度分配
  PROGRESS: {
    DOWNLOAD_RATIO: 70, // 下載進度佔比：70%
    EXTRACT_RATIO: 30, // 解壓進度佔比：30%
  },
  // 估算配置
  ESTIMATION: {
    INITIAL_ENTRIES: 10, // 初始估算條目數
  },
};

// ===================================================================
// 共享快取例項
// ===================================================================

/**
 * 共享的檔案Blob快取例項
 * 所有服務共用，避免重複建立
 */
export const sharedFileBlobCache = new LRUCache(ARCHIVE_CONSTANTS.CACHE.FILE_BLOB_SIZE);

// ===================================================================
// 共享工具方法
// ===================================================================

/**
 * 獲取或下載檔案Blob（帶快取）
 * @param {string} fileUrl - 檔案URL
 * @param {Function} progressCallback - 進度回撥
 * @param {number} startProgress - 起始進度
 * @param {number} endProgress - 結束進度
 * @param {string} stage - 階段描述
 * @returns {Promise<Blob>} 檔案Blob
 */
export async function getOrDownloadFileBlob(fileUrl, progressCallback = null, startProgress = 0, endProgress = 100, stage = "下載中") {
  const cacheKey = fileUrl;
  const cachedBlob = sharedFileBlobCache.get(cacheKey);

  if (cachedBlob) {
    log.debug("使用快取檔案:", fileUrl);
    if (progressCallback) progressCallback(endProgress, "使用快取檔案");
    return cachedBlob;
  }

  // 下載並快取
  const fileBlob = await downloadFileWithProgress(fileUrl, progressCallback, startProgress, endProgress, stage);
  sharedFileBlobCache.set(cacheKey, fileBlob, ARCHIVE_CONSTANTS.CACHE.TTL);
  log.debug("檔案已下載並快取:", fileUrl);
  return fileBlob;
}

/**
 * 通用檔案下載方法（帶進度監控）
 * @param {string} url - 檔案URL
 * @param {Function} progressCallback - 進度回撥函式
 * @param {number} progressStart - 進度起始值 (0-100)
 * @param {number} progressEnd - 進度結束值 (0-100)
 * @param {string} stage - 進度階段描述
 * @returns {Promise<Blob>} 下載的檔案Blob
 */
export async function downloadFileWithProgress(url, progressCallback = null, progressStart = 0, progressEnd = 100, stage = "下載中") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    loaded += value.length;

    if (total > 0 && progressCallback) {
      const progress = progressStart + (loaded / total) * (progressEnd - progressStart);
      progressCallback(Math.min(progress, progressEnd), stage);
    }
  }

  return new Blob(chunks);
}

/**
 * 檢查是否支援 WebAssembly
 * @returns {boolean} 是否支援
 */
export function isWebAssemblySupported() {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}

/**
 * 清除共享檔案Blob快取
 * @param {string} fileUrl - 檔案URL
 */
export function clearSharedFileBlobCache(fileUrl) {
  if (!fileUrl) return;

  sharedFileBlobCache.delete(fileUrl);
  log.debug("已清除共享檔案Blob快取:", fileUrl);
}

/**
 * 遞迴計算檔案總數（libarchive.js輔助方法）
 * @param {Object} filesObject - getFilesObject()返回的巢狀物件
 * @returns {number} 總檔案數量
 */
export function countTotalFiles(filesObject) {
  let count = 0;

  const countRecursive = (obj) => {
    for (const [, item] of Object.entries(obj)) {
      if (item && typeof item.extract === "function") {
        // CompressedFile
        count++;
      } else if (typeof item === "object" && item !== null) {
        // 目錄
        count++;
        countRecursive(item);
      }
    }
  };

  countRecursive(filesObject);
  return count;
}

/**
 * 遞迴計算已解壓檔案總數（extractFiles()返回的資料）
 * @param {Object} extractedFiles - extractFiles()返回的巢狀物件
 * @returns {number} 總檔案數量
 */
export function countExtractedFiles(extractedFiles) {
  let count = 0;

  const countRecursive = (obj) => {
    for (const [, item] of Object.entries(obj)) {
      if (item instanceof File) {
        // 已解壓的File物件
        count++;
      } else if (typeof item === "object" && item !== null) {
        // 目錄，遞迴計算
        count++;
        countRecursive(item);
      }
    }
  };

  countRecursive(extractedFiles);
  return count;
}
