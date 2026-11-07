/**
 * 基礎快取管理器
 * 提供通用的快取功能
 */

export class BaseCache {
  /**
   * 建構函式
   * @param {Object} options - 配置選項
   * @param {number} options.maxItems - 最大快取項數量
   * @param {number} options.prunePercentage - 清理時刪除的快取項百分比
   * @param {number} options.defaultTtl - 預設快取時間（秒）
   * @param {string} options.name - 快取名稱（用於日誌）
   */
  constructor(options = {}) {
    // 預設配置
    this.config = {
      maxItems: options.maxItems || 500,
      prunePercentage: options.prunePercentage || 20,
      defaultTtl: options.defaultTtl || 300,
      name: options.name || "BaseCache",
    };

    // 快取儲存
    this.cache = new Map();

    // 統計資訊
    this.stats = {
      hits: 0,
      misses: 0,
      expired: 0,
      invalidations: 0,
      pruned: 0,
    };
  }

  /**
   * 生成快取鍵 - 抽象方法，子類必須實現
   * @param {...any} params - 快取鍵引數
   * @returns {string} 快取鍵
   */
  generateKey(...params) {
    throw new Error("generateKey方法必須在子類中實現");
  }

  /**
   * 獲取快取項
   * @param {...any} params - 快取鍵引數
   * @returns {any|null} 快取的資料，如果快取未命中則返回null
   */
  get(...params) {
    const key = this.generateKey(...params);
    const cacheItem = this.cache.get(key);

    if (!cacheItem) {
      this.stats.misses++;
      return null;
    }

    // 檢查快取是否過期
    if (Date.now() > cacheItem.expiresAt) {
      this.cache.delete(key);
      this.stats.expired++;
      return null;
    }

    // LRU策略：更新最後訪問時間
    cacheItem.lastAccessed = Date.now();
    this.cache.set(key, cacheItem); // 重新設定以更新Map中的順序

    this.stats.hits++;
    return cacheItem.data;
  }

  /**
   * 設定快取項
   * @param {any} data - 要快取的資料
   * @param {number} ttlSeconds - 快取的生存時間（秒），可選
   * @param {...any} params - 快取鍵引數
   */
  set(data, ttlSeconds = null, ...params) {
    const key = this.generateKey(...params);
    const now = Date.now();
    const ttl = ttlSeconds || this.config.defaultTtl;
    const expiresAt = now + ttl * 1000;

    // 更新快取
    this.cache.set(key, {
      data,
      expiresAt,
      lastAccessed: now,
      ...this.getAdditionalCacheData(...params), // 子類可以新增額外資料
    });

    // 檢查是否需要清理快取
    if (this.cache.size > this.config.maxItems) {
      this.prune();
    }
  }

  /**
   * 獲取額外的快取資料 - 子類可以重寫
   * @param {...any} params - 快取鍵引數
   * @returns {Object} 額外的快取資料
   */
  getAdditionalCacheData(...params) {
    return {};
  }

  /**
   * 使指定鍵的快取失效
   * @param {...any} params - 快取鍵引數
   * @returns {boolean} 是否成功刪除
   */
  invalidate(...params) {
    const key = this.generateKey(...params);
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.invalidations++;
    }
    return deleted;
  }

  /**
   * 清理所有快取
   * @returns {number} 清理的快取項數量
   */
  invalidateAll() {
    const clearedCount = this.cache.size;
    this.cache.clear();
    this.stats.invalidations += clearedCount;
    return clearedCount;
  }

  /**
   * 清理過期的快取項或過多的快取項
   */
  prune() {
    const now = Date.now();
    const entries = [...this.cache.entries()];
    let prunedCount = 0;

    // 找出已過期的專案
    const expiredEntries = entries.filter(([_, item]) => now > item.expiresAt);

    // 如果有足夠的過期專案，直接清理它們
    if (expiredEntries.length >= Math.ceil((entries.length * this.config.prunePercentage) / 100)) {
      for (const [key] of expiredEntries) {
        this.cache.delete(key);
        prunedCount++;
      }
    } else {
      // 否則，使用LRU策略：按最後訪問時間排序並刪除最久未訪問的專案
      entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

      const toDelete = Math.ceil((entries.length * this.config.prunePercentage) / 100);
      for (let i = 0; i < toDelete; i++) {
        if (i < entries.length) {
          const [key] = entries[i];
          this.cache.delete(key);
          prunedCount++;
        }
      }
    }

    // 更新統計資訊
    if (prunedCount > 0) {
      this.stats.pruned += prunedCount;
      console.log(`${this.config.name}快取清理完成 - 刪除項:${prunedCount}`);
    }
  }

  /**
   * 獲取快取統計資訊
   * @returns {Object} 快取統計資料，包括命中率和大小
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      name: this.config.name,
    };
  }

  /**
   * 檢查快取大小並在必要時清理
   */
  checkSizeAndPrune() {
    if (this.cache.size > this.config.maxItems) {
      this.prune();
    }
  }

  /**
   * 獲取快取大小
   * @returns {number} 當前快取項數量
   */
  size() {
    return this.cache.size;
  }

  /**
   * 檢查快取是否為空
   * @returns {boolean} 快取是否為空
   */
  isEmpty() {
    return this.cache.size === 0;
  }

  /**
   * 獲取所有快取鍵
   * @returns {Array<string>} 所有快取鍵的陣列
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * 檢查指定鍵是否存在於快取中
   * @param {...any} params - 快取鍵引數
   * @returns {boolean} 鍵是否存在
   */
  has(...params) {
    const key = this.generateKey(...params);
    const cacheItem = this.cache.get(key);

    if (!cacheItem) {
      return false;
    }

    // 檢查是否過期
    if (Date.now() > cacheItem.expiresAt) {
      this.cache.delete(key);
      this.stats.expired++;
      return false;
    }

    return true;
  }
}

