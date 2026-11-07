/**
 * 目錄快取管理器 - 基於BaseCache的目錄列表快取實現
 * 提供目錄列表的快取功能，用於提高頻繁訪問目錄的效能
 */
import { BaseCache } from "./BaseCache.js";
import { normalizePath } from "../storage/fs/utils/PathResolver.js";

class DirectoryCacheManager extends BaseCache {
  /**
   * 建構函式
   * @param {Object} options - 配置選項
   * @param {number} options.maxItems - 最大快取項數量，預設為300
   * @param {number} options.prunePercentage - 清理時刪除的快取項百分比，預設為20%
   */
  constructor(options = {}) {
    const { maxItems, prunePercentage, defaultTtl } = options;
    super({
      maxItems: maxItems || 300,
      prunePercentage: prunePercentage || 20,
      defaultTtl: defaultTtl || 300,
      name: "DirectoryCache",
    });
  }

  /**
   * 生成安全的快取鍵 - 重寫基類方法
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @returns {string} - 快取鍵
   */
  generateKey(mountId, path) {
    // 規範化路徑：確保目錄路徑的一致性
    // 對於目錄快取，統一將路徑規範化為目錄格式（以/結尾）
    const normalizedPath = normalizePath(path, true);

    // 使用 Base64 編碼路徑，避免特殊字元問題
    const encodedPath = Buffer.from(normalizedPath).toString("base64");
    return `${mountId}:${encodedPath}`;
  }

  getAdditionalCacheData(mountId, path) {
    return {
      normalizedPath: normalizePath(path, true),
      mountId: mountId != null ? String(mountId) : "",
    };
  }

  /**
   * 獲取快取的目錄列表 - 使用基類方法
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @returns {Object|null} - 快取的目錄列表，如果快取未命中則返回null
   */
  get(mountId, path) {
    return super.get(mountId, path);
  }

  /**
   * 設定目錄列表快取 - 保持原有引數順序，內部呼叫基類方法
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @param {Object} data - 要快取的目錄列表資料
   * @param {number} ttlSeconds - 快取的生存時間（秒）
   */
  set(mountId, path, data, ttlSeconds) {
    // 保持原有引數順序，內部呼叫基類方法時調整引數順序
    super.set(data, ttlSeconds, mountId, path);
  }

  /**
   * 使指定目錄的快取失效 - 使用基類方法
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @returns {boolean} - 如果快取項存在並被刪除則返回true，否則返回false
   */
  invalidate(mountId, path) {
    const deleted = super.invalidate(mountId, path);
    if (deleted) {
      console.log(`目錄快取已失效 - 掛載點:${mountId}, 路徑:${path}`);
    }
    return deleted;
  }

  /**
   * 使指定路徑及其所有父路徑的快取失效
   * 例如: 對於路徑 /a/b/c，會使 /a/b/c、/a/b 和 /a 的快取失效
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @returns {number} - 被刪除的快取項數量
   */
  invalidatePathAndAncestors(mountId, path) {
    // 確保路徑格式標準化
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let currentPath = normalizedPath;
    let count = 0;

    // 清除當前路徑的快取
    if (this.invalidate(mountId, currentPath)) {
      count++;
    }

    // 逐級向上清除父路徑的快取
    while (currentPath !== "/" && currentPath.includes("/")) {
      // 獲取父路徑
      currentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
      if (currentPath === "") currentPath = "/";

      // 清除父路徑的快取
      if (this.invalidate(mountId, currentPath)) {
        count++;
      }

      // 如果已經到達根路徑，停止迴圈
      if (currentPath === "/") break;
    }

    if (count > 0) {
      console.log(`路徑及父路徑快取已失效 - 掛載點:${mountId}, 路徑:${path}, 刪除項:${count}`);
    }

    return count;
  }

  /**
   * 使指定目錄及其子樹（所有子目錄）的快取失效
   * 例如: /a/b/ 會使 /a/b/、/a/b/c/、/a/b/c/d/ ... 的快取失效
   * @param {string} mountId - 掛載點ID
   * @param {string} path - 目錄路徑
   * @returns {number} - 被刪除的快取項數量
   */
  invalidatePathTree(mountId, path) {
    if (!mountId) return 0;

    const normalizedPrefix = normalizePath(path, true);
    if (normalizedPrefix === "/") {
      return this.invalidateMount(mountId);
    }

    const decodePathFromKey = (key) => {
      if (typeof key !== "string") return null;
      const idx = key.indexOf(":");
      if (idx <= 0) return null;
      const encoded = key.slice(idx + 1);
      if (!encoded) return null;
      try {
        return Buffer.from(encoded, "base64").toString("utf8");
      } catch (_) {
        return null;
      }
    };

    let clearedCount = 0;
    for (const [key, item] of this.cache.entries()) {
      if (!key.startsWith(`${mountId}:`)) continue;
      const cachedPath = typeof item?.normalizedPath === "string" && item.normalizedPath
        ? item.normalizedPath
        : decodePathFromKey(key);
      if (typeof cachedPath !== "string" || cachedPath.length === 0) continue;
      if (cachedPath === normalizedPrefix || cachedPath.startsWith(normalizedPrefix)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`目錄子樹快取已失效 - 掛載點:${mountId}, 路徑:${path}, 刪除項:${clearedCount}`);
    }

    return clearedCount;
  }

  /**
   * 清理指定掛載點的所有快取
   * @param {string} mountId - 掛載點ID
   * @returns {number} 清理的快取項數量
   */
  invalidateMount(mountId) {
    let clearedCount = 0;

    // 遍歷所有快取項，刪除匹配掛載點的項
    for (const [key, item] of this.cache.entries()) {
      // 快取鍵格式：mountId:encodedPath
      if (key.startsWith(`${mountId}:`)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`掛載點快取已失效 - 掛載點:${mountId}, 刪除項:${clearedCount}`);
    }

    return clearedCount;
  }

  // prune() 和 getStats() 方法已由基類提供，無需重複實現
}

// 建立單例例項
const directoryCacheManager = new DirectoryCacheManager();

/**
 * 統一的快取清理函式 - 可根據掛載點ID或S3配置ID清理快取
 * @param {Object} options - 清理選項
 * @param {string} [options.mountId] - 要清理的掛載點ID
 * @param {D1Database} [options.db] - 資料庫連線（當使用storageConfigId時必需）
 * @param {string} [options.storageConfigId] - 儲存配置ID，將清理所有關聯的掛載點
 * @returns {Promise<number>} 清除的快取項數量
 */
// 匯出單例例項和類 (單例用於實際應用，類用於測試和特殊場景)
export { directoryCacheManager, DirectoryCacheManager };
