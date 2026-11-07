/**
 * 壓縮檔案處理服務
 * 統一封裝 zip.js 和 libarchive.js，提供一致的 API 介面
 */

import { getArchiveType } from "@/utils/fileTypes";
import { LRUCache } from "@/utils/lruCache.js";
import { zipService } from "./zipService.js";
import { libarchiveService } from "./libarchiveService.js";
import { ARCHIVE_CONSTANTS, clearSharedFileBlobCache } from "./archiveUtils.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ArchiveService");

/**
 * 壓縮檔案處理服務類
 */
class ArchiveService {
  constructor() {
    // 配置物件
    this.config = {
      cacheEnabled: true,
    };

    // 解壓結果快取
    this.extractCache = new LRUCache(ARCHIVE_CONSTANTS.CACHE.EXTRACT_SIZE);

    // 檔案Blob快取（用於密碼驗證時避免重複下載）
    this.fileBlobCache = new LRUCache(ARCHIVE_CONSTANTS.CACHE.FILE_BLOB_SIZE);
  }

  // ===================================================================
  // 統一入口
  // ===================================================================

  /**
   * 統一的壓縮檔案解壓介面
   * @param {Blob|File|string} fileBlobOrUrl - 壓縮檔案 Blob 物件或URL
   * @param {string} filename - 檔名
   * @param {string} fileUrl - 檔案URL（用於快取鍵）
   * @param {Function} progressCallback - 進度回撥函式 (progress: 0-100)
   * @param {string|null} password - 可選的解壓密碼
   * @returns {Promise<Array>} 統一格式的檔案列表
   */
  async extractArchive(fileBlobOrUrl, filename, fileUrl = "", progressCallback = null, password = null) {
    log.debug("開始解壓檔案:", filename);

    // 快取檢查
    if (this.config.cacheEnabled && fileUrl) {
      const cacheKey = `${fileUrl}_${filename}`;
      const cached = this.extractCache.get(cacheKey);
      if (cached) {
        log.debug("使用快取的解壓結果:", filename);
        if (progressCallback) progressCallback(100);
        return cached;
      }
    }

    const archiveType = getArchiveType(filename);

    if (!archiveType.supported) {
      throw new Error(`不支援的壓縮格式: ${archiveType.name}`);
    }

    // 根據格式和密碼情況選擇最優處理方式
    let result;
    if (archiveType.name === "ZIP") {
      // 使用zipService處理ZIP檔案
      result = await zipService.extractArchive(fileBlobOrUrl, filename, fileUrl, progressCallback, password);
    } else {
      // 使用libarchiveService處理其他格式檔案
      result = await libarchiveService.extractArchive(fileBlobOrUrl, filename, fileUrl, progressCallback, password, archiveType);
    }

    // 快取結果
    if (this.config.cacheEnabled && fileUrl && result) {
      const cacheKey = `${fileUrl}_${filename}`;
      this.extractCache.set(cacheKey, result);
    }

    log.debug(`解壓完成，共 ${result.length} 個檔案/目錄`);
    return result;
  }

  // ===================================================================
  // 快取管理
  // ===================================================================

  /**
   * 清除解壓結果快取
   * @param {string} fileUrl - 檔案URL
   * @param {string} filename - 檔名
   */
  clearFileCache(fileUrl, filename) {
    if (!fileUrl || !filename) return;

    const cacheKey = `${fileUrl}_${filename}`;
    this.extractCache.delete(cacheKey);
    log.debug("已清除解壓快取:", cacheKey);
  }

  /**
   * 清除檔案Blob快取
   * @param {string} fileUrl - 檔案URL
   */
  clearFileBlobCache(fileUrl) {
    if (!fileUrl) return;

    this.fileBlobCache.delete(fileUrl);
    // 清除共享的檔案Blob快取
    clearSharedFileBlobCache(fileUrl);
    log.debug("已清除檔案Blob快取:", fileUrl);
  }

  // ===================================================================
  // 工具方法
  // ===================================================================

  /**
   * 統一的檔案內容獲取介面
   * @param {Object} entryWrapper - 檔案條目包裝物件
   * @returns {Promise<ArrayBuffer>} 檔案內容
   */
  async getFileContent(entryWrapper) {
    try {
      return await entryWrapper.getContent();
    } catch (error) {
      log.error("獲取檔案內容失敗:", error);
      throw new Error(`獲取檔案內容失敗: ${error.message}`);
    }
  }
}

// 匯出單例例項
export const archiveService = new ArchiveService();
export default archiveService;
