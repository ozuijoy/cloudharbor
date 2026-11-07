/**
 * FS 目錄摘要快取（記憶體快取）
 * - 用途：快取“目錄大小/目錄時間(內容更新時間)”的計算/索引兜底結果，避免重複掃描或重複聚合查詢
 * - 說明：這是派生資料，重啟程序後會丟失（符合“可選計算 + 記憶體快取”的定位）
 */
import { BaseCache } from "./BaseCache.js";
import { normalizePath } from "../storage/fs/utils/PathResolver.js";

class FsFolderSummaryCacheManager extends BaseCache {
  constructor(options = {}) {
    const { maxItems, prunePercentage, defaultTtl } = options;
    super({
      maxItems: maxItems || 500,
      prunePercentage: prunePercentage || 20,
      defaultTtl: defaultTtl || 300,
      name: "FsFolderSummaryCache",
    });
  }

  generateKey(mountId, path) {
    const normalizedPath = normalizePath(path, true);
    const encodedPath = Buffer.from(normalizedPath).toString("base64");
    return `${mountId}:${encodedPath}`;
  }

  getAdditionalCacheData(mountId, path) {
    return {
      normalizedPath: normalizePath(path, true),
      mountId: mountId != null ? String(mountId) : "",
    };
  }

  get(mountId, path) {
    return super.get(mountId, path);
  }

  set(mountId, path, data, ttlSeconds) {
    super.set(data, ttlSeconds, mountId, path);
  }

  invalidate(mountId, path) {
    const deleted = super.invalidate(mountId, path);
    if (deleted) {
      console.log(`目錄摘要快取已失效 - 掛載點:${mountId}, 路徑:${path}`);
    }
    return deleted;
  }

  invalidatePathAndAncestors(mountId, path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let currentPath = normalizedPath;
    let count = 0;

    if (this.invalidate(mountId, currentPath)) {
      count++;
    }

    while (currentPath !== "/" && currentPath.includes("/")) {
      currentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
      if (currentPath === "") currentPath = "/";

      if (this.invalidate(mountId, currentPath)) {
        count++;
      }

      if (currentPath === "/") break;
    }

    if (count > 0) {
      console.log(`目錄摘要路徑及父路徑快取已失效 - 掛載點:${mountId}, 路徑:${path}, 刪除項:${count}`);
    }

    return count;
  }

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
      console.log(`目錄摘要子樹快取已失效 - 掛載點:${mountId}, 路徑:${path}, 刪除項:${clearedCount}`);
    }

    return clearedCount;
  }

  invalidateMount(mountId) {
    let clearedCount = 0;
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${mountId}:`)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`目錄摘要掛載點快取已失效 - 掛載點:${mountId}, 刪除項:${clearedCount}`);
    }

    return clearedCount;
  }
}

export { FsFolderSummaryCacheManager };
export const fsFolderSummaryCacheManager = new FsFolderSummaryCacheManager();
