/**
 * S3搜尋操作模組
 * 負責S3儲存的搜尋相關操作
 */

import { ApiStatus } from "../../../../constants/index.js";
import { ValidationError } from "../../../../http/errors.js";
import { listS3Directory } from "../utils/s3Utils.js";
import { normalizeS3SubPath } from "../utils/S3PathUtils.js";
import { getEffectiveMimeType } from "../../../../utils/fileUtils.js";
import { buildFileInfo } from "../../../utils/FileInfoBuilder.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { updateMountLastUsed } from "../../../fs/utils/MountResolver.js";

export class S3SearchOperations {
  /**
   * 建構函式
   * @param {S3Client} s3Client - S3客戶端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(s3Client, config, encryptionSecret) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 在S3掛載點中搜尋檔案
   * @param {string} query - 搜尋查詢
   * @param {Object} options - 搜尋選項
   * @param {Object} options.mount - 掛載點物件
   * @param {string} options.searchPath - 搜尋路徑範圍
   * @param {number} options.maxResults - 最大結果數量
   * @param {D1Database} options.db - 資料庫例項
   * @returns {Promise<Array>} 搜尋結果陣列
   */
  async searchInMount(query, options = {}) {
    return handleFsError(
      async () => {
        const { mount, searchPath, maxResults = 1000, db } = options;

        if (!mount) {
          throw new ValidationError("掛載點資訊不能為空");
        }

        // 更新掛載點最後使用時間（僅在有掛載點上下文時）
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 確定搜尋字首
        let searchPrefix = "";
        if (searchPath) {
          // 計算相對於掛載點的子路徑
          const mountPath = mount.mount_path.replace(/\/+$/, "") || "/";
          const normalizedSearchPath = searchPath.replace(/\/+$/, "") || "/";

          if (normalizedSearchPath.startsWith(mountPath)) {
            const subPath = normalizedSearchPath.substring(mountPath.length) || "/";
            searchPrefix = normalizeS3SubPath(subPath, true);
          }
        }

        // 構建完整的S3字首
        const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";
        let fullPrefix = rootPrefix;
        if (searchPrefix && searchPrefix !== "/") {
          fullPrefix += searchPrefix;
        }

        // 遞迴搜尋S3物件
        const results = await this.recursiveS3Search(query, fullPrefix, mount, undefined, maxResults, db);

        return results;
      },
      "S3掛載點搜尋",
      "S3掛載點搜尋失敗"
    );
  }

  /**
   * 遞迴搜尋S3物件
   * @param {string} query - 搜尋查詢
   * @param {string} prefix - 搜尋字首
   * @param {Object} mount - 掛載點物件
   * @param {string} continuationToken - 分頁令牌
   * @param {number} maxResults - 最大結果數量
   * @param {D1Database} db - 資料庫例項
   * @returns {Promise<Array>} 搜尋結果陣列
   */
  async recursiveS3Search(query, prefix, mount, continuationToken = undefined, maxResults = 1000, db = null) {
    const results = [];

    try {
      // 使用空字串作為delimiter來獲取所有物件（包括子目錄中的檔案）
      const listResponse = await listS3Directory(this.s3Client, this.config.bucket_name, prefix, "", continuationToken);

      if (listResponse.Contents) {
        for (const item of listResponse.Contents) {
          // 檢查是否已達到最大結果數量
          if (results.length >= maxResults) {
            break;
          }

          // 檢查檔名是否匹配搜尋查詢
          if (this.matchesSearchQuery(item.Key, query)) {
            // 構建結果物件
            const result = await this.buildSearchResult(item, mount, prefix, db);
            results.push(result);
          }
        }
      }

      // 如果有更多結果且未達到最大數量限制，繼續遞迴搜尋
      if (listResponse.IsTruncated && listResponse.NextContinuationToken && results.length < maxResults) {
        const remainingResults = maxResults - results.length;
        const moreResults = await this.recursiveS3Search(query, prefix, mount, listResponse.NextContinuationToken, remainingResults, db);
        results.push(...moreResults);
      }

      return results;
    } catch (error) {
      console.error(`S3搜尋失敗 - Bucket: ${this.config.bucket_name}, Prefix: ${prefix}:`, error);
      return results; // 返回已找到的結果，不丟擲錯誤
    }
  }

  /**
   * 檢查檔名是否匹配搜尋查詢
   * @param {string} key - S3物件鍵
   * @param {string} query - 搜尋查詢
   * @returns {boolean} 是否匹配
   */
  matchesSearchQuery(key, query) {
    const fileName = key.split("/").pop() || "";
    const normalizedQuery = query.toLowerCase();
    const normalizedFileName = fileName.toLowerCase();

    // 支援模糊匹配
    return normalizedFileName.includes(normalizedQuery);
  }

  /**
   * 構建搜尋結果物件
   * @param {Object} item - S3物件
   * @param {Object} mount - 掛載點物件
   * @param {string} prefix - 搜尋字首
   * @param {D1Database} db - 資料庫例項
   * @returns {Promise<Object>} 搜尋結果物件
   */
  async buildSearchResult(item, mount, prefix, db) {
    const fileName = item.Key.split("/").pop() || "";

    // 計算相對於S3根字首的路徑
    let relativePath = item.Key;
    if (prefix && prefix !== "" && item.Key.startsWith(prefix)) {
      relativePath = item.Key.substring(prefix.length);
    }

    // 確保相對路徑以/開頭
    if (relativePath && !relativePath.startsWith("/")) {
      relativePath = "/" + relativePath;
    }

    // 構建完整的掛載路徑
    const mountPath = mount.mount_path.replace(/\/+$/, "") || "/";
    const fullPath = mountPath + (relativePath || "/" + fileName);

    const info = await buildFileInfo({
      fsPath: fullPath.replace(/\/+/g, "/"),
      name: fileName,
      isDirectory: false,
      size: item.Size,
      modified: item.LastModified ? new Date(item.LastModified) : null,
      mimetype: getEffectiveMimeType(null, fileName),
      mount,
      storageType: mount.storage_type,
      db,
    });

    return {
      ...info,
      mount_name: mount.name,
      s3_key: item.Key,
    };
  }

}
