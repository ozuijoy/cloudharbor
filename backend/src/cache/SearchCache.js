/**
 * 搜尋快取管理器
 * 提供搜尋結果的快取功能，用於提高頻繁搜尋的效能
 */
import crypto from "crypto";
import { BaseCache } from "./BaseCache.js";
import { UserType } from "../constants/index.js";
import { getMountsVersion } from "./cacheState.js";

class SearchCacheManager extends BaseCache {
  /**
   * 建構函式
   * @param {Object} options - 配置選項
   * @param {number} options.maxItems - 最大快取項數量，預設為200
   * @param {number} options.prunePercentage - 清理時刪除的快取項百分比，預設為20%
   * @param {number} options.defaultTtl - 預設快取時間（秒），預設為600秒（5分鐘）
   */
  constructor(options = {}) {
    super({
      maxItems: options.maxItems || 200, 
      prunePercentage: options.prunePercentage || 20,
      defaultTtl: options.defaultTtl || 600, 
      name: "SearchCache",
      ...options,
    });
  }

  /**
   * 生成搜尋快取鍵 - 重寫基類方法
   * @param {string} query - 搜尋查詢字串
   * @param {Object} searchParams - 搜尋引數物件
   * @param {string} userType - 使用者型別 (admin/apiKey)
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @returns {string} - 快取鍵
   */
  generateKey(query, searchParams, userType, userIdOrInfo, meta = {}) {
    // 構建快取鍵的組成部分
    const keyComponents = {
      query: query.toLowerCase().trim(),
      scope: searchParams.scope || "global",
      mountId: searchParams.mountId || "",
      path: searchParams.path || "",
      limit: Number.isFinite(searchParams.limit) ? Number(searchParams.limit) : 50,
      offset: Number.isFinite(searchParams.offset) ? Number(searchParams.offset) : 0,
      filters: searchParams.filters || {},
      userType: userType,
      mountsVersion: meta.mountsVersion || 0,
    };

    // 根據使用者型別新增使用者標識
    if (userType === UserType.ADMIN) {
      keyComponents.userId = typeof userIdOrInfo === "string" ? userIdOrInfo : userIdOrInfo?.id || "";
    } else if (userType === UserType.API_KEY) {
      // 對於API金鑰使用者，使用basicPath作為許可權標識
      keyComponents.basicPath = userIdOrInfo.basicPath || "";
      keyComponents.apiKeyId = userIdOrInfo.id || "";
    }

    // 將物件序列化並生成雜湊
    const keyString = JSON.stringify(keyComponents, Object.keys(keyComponents).sort());
    const hash = crypto.createHash("sha256").update(keyString).digest("hex");

    // 返回帶字首的快取鍵
    return `search:${hash.substring(0, 16)}`;
  }


  /**
   * 獲取快取的搜尋結果 - 使用基類方法
   * @param {string} query - 搜尋查詢字串
   * @param {Object} searchParams - 搜尋引數物件
   * @param {string} userType - 使用者型別
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @returns {Object|null} - 快取的搜尋結果，如果快取未命中則返回null
   */
  get(query, searchParams, userType, userIdOrInfo) {
    return super.get(query, searchParams, userType, userIdOrInfo, { mountsVersion: getMountsVersion() });
  }

  /**
   * 設定搜尋結果快取 - 保持原有引數順序，內部呼叫基類方法
   * @param {string} query - 搜尋查詢字串
   * @param {Object} searchParams - 搜尋引數物件
   * @param {string} userType - 使用者型別
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {Object} data - 要快取的搜尋結果資料
   * @param {number} ttlSeconds - 快取的生存時間（秒），可選
   */
  set(query, searchParams, userType, userIdOrInfo, data, ttlSeconds = null, meta = {}) {
    const cacheMeta = {
      mountsVersion: meta.mountsVersion ?? getMountsVersion(),
      mountIds: Array.isArray(meta.mountIds) ? meta.mountIds : [],
    };
    super.set(data, ttlSeconds, query, searchParams, userType, userIdOrInfo, cacheMeta);
  }

  /**
   * 獲取額外的快取資料 - 重寫基類方法
   * @param {string} query - 搜尋查詢字串
   * @param {Object} searchParams - 搜尋引數物件
   * @param {string} userType - 使用者型別
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @returns {Object} 額外的快取資料
   */
  getAdditionalCacheData(query, searchParams, userType, userIdOrInfo, meta = {}) {
    const additionalData = {
      query: query,
      searchParams: searchParams,
      userType: userType,
      mountsVersion: meta.mountsVersion ?? 0,
      mountIds: meta.mountIds ?? [],
    };

    // 根據使用者型別新增使用者標識欄位，用於invalidateUser方法
    if (userType === UserType.ADMIN) {
      additionalData.userId = typeof userIdOrInfo === "string" ? userIdOrInfo : userIdOrInfo?.id || "";
    } else if (userType === UserType.API_KEY) {
      additionalData.basicPath = userIdOrInfo.basicPath || "";
      additionalData.apiKeyId = userIdOrInfo.id || "";
    }

    return additionalData;
  }

  /**
   * 使指定掛載點的所有搜尋快取失效
   * @param {string} mountId - 掛載點ID
   * @returns {number} - 被刪除的快取項數量
   */
  invalidateMount(mountId) {
    let count = 0;
    const keysToDelete = [];

    // 找出所有涉及該掛載點的搜尋快取
    for (const [key, cacheItem] of this.cache.entries()) {
      const { searchParams, mountIds = [] } = cacheItem;
      const involvesMount =
        mountIds.includes(mountId) ||
        searchParams.mountId === mountId ||
        (searchParams.scope === "global" && !searchParams.mountId);

      if (involvesMount) {
        keysToDelete.push(key);
      }
    }

    // 刪除找到的所有鍵
    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    if (count > 0) {
      this.stats.invalidations += count;
      console.log(`搜尋快取已失效 - 掛載點:${mountId}, 刪除項:${count}`);
    }

    return count;
  }

  /**
   * 使所有搜尋快取失效
   * @returns {number} - 被刪除的快取項數量
   */
  invalidateAll() {
    const count = this.cache.size;
    this.cache.clear();

    if (count > 0) {
      this.stats.invalidations += count;
      console.log(`所有搜尋快取已失效 - 刪除項:${count}`);
    }

    return count;
  }

  /**
   * 使指定使用者的所有搜尋快取失效
   * @param {string} userType - 使用者型別
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @returns {number} - 被刪除的快取項數量
   */
  invalidateUser(userType, userIdOrInfo) {
    let count = 0;
    const keysToDelete = [];

    // 找出所有屬於該使用者的搜尋快取
    for (const [key, cacheItem] of this.cache.entries()) {
      if (cacheItem.userType === userType) {
        let shouldDelete = false;

        if (userType === UserType.ADMIN) {
          // 對於管理員，直接比較使用者ID
          const adminId = typeof userIdOrInfo === "string" ? userIdOrInfo : userIdOrInfo.id;
          // 正確訪問：檢查額外資料中的使用者資訊
          if (cacheItem.userId === adminId) {
            shouldDelete = true;
          }
        } else if (userType === UserType.API_KEY) {
          // 對於API金鑰使用者，比較basicPath和apiKeyId
          const apiKeyInfo = userIdOrInfo;
          // 正確訪問：檢查額外資料中的API金鑰資訊
          if (cacheItem.basicPath === apiKeyInfo.basicPath && cacheItem.apiKeyId === apiKeyInfo.id) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          keysToDelete.push(key);
        }
      }
    }

    // 刪除找到的所有鍵
    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    if (count > 0) {
      this.stats.invalidations += count;
      console.log(`使用者搜尋快取已失效 - 使用者型別:${userType}, 刪除項:${count}`);
    }

    return count;
  }
}

// 建立單例例項
const searchCacheManager = new SearchCacheManager();

/**
 * 統一的搜尋快取清理函式
 * @param {Object} options - 清理選項
 * @param {string} [options.mountId] - 要清理的掛載點ID
 * @param {string} [options.userType] - 使用者型別
 * @param {string|Object} [options.userIdOrInfo] - 使用者ID或API金鑰資訊
 * @returns {number} 清除的快取項數量
 */
export function clearSearchCache(options = {}) {
  const { mountId, userType, userIdOrInfo } = options;
  let totalCleared = 0;

  try {
    // 場景1: 清理指定掛載點的搜尋快取
    if (mountId) {
      const clearedCount = searchCacheManager.invalidateMount(mountId);
      console.log(`SearchCache: 已清理掛載點 ${mountId} 的搜尋快取，共 ${clearedCount} 項`);
      totalCleared += clearedCount;
    }

    // 場景2: 清理指定使用者的搜尋快取
    if (userType && userIdOrInfo) {
      const clearedCount = searchCacheManager.invalidateUser(userType, userIdOrInfo);
      console.log(`SearchCache:已清理使用者 ${userType} 的搜尋快取，共 ${clearedCount} 項`);
      totalCleared += clearedCount;
    }

    // 場景3: 清理所有搜尋快取
    if (!mountId && !userType) {
      const clearedCount = searchCacheManager.invalidateAll();
      totalCleared += clearedCount;
      console.log(`SearchCache:已清理所有搜尋快取，共 ${clearedCount} 項`);
    }

    return totalCleared;
  } catch (error) {
    console.error("清理搜尋快取時出錯:", error);
    return 0;
  }
}

// 匯出單例例項和類
export { searchCacheManager, SearchCacheManager };
