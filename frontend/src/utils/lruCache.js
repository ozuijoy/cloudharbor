/**
 * LRU (Least Recently Used) 快取實現
 * 用於最佳化 Office 預覽 URL 快取策略
 */
export class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  /**
   * 獲取快取項
   * @param {string} key - 快取鍵
   * @returns {any} 快取值，如果不存在或已過期則返回 null
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const item = this.cache.get(key);
    
    // 檢查是否過期
    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    // 移動到最後（最近使用）
    this.cache.delete(key);
    this.cache.set(key, item);
    
    return item.value;
  }

  /**
   * 設定快取項
   * @param {string} key - 快取鍵
   * @param {any} value - 快取值
   * @param {number} ttl - 生存時間（毫秒），可選
   */
  set(key, value, ttl = null) {
    // 如果已存在，先刪除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // 如果達到最大容量，刪除最舊的項
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    const item = {
      value,
      timestamp: Date.now(),
      expiry: ttl ? Date.now() + ttl : null
    };

    this.cache.set(key, item);
  }

  /**
   * 檢查是否存在快取項
   * @param {string} key - 快取鍵
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * 刪除快取項
   * @param {string} key - 快取鍵
   * @returns {boolean} 是否成功刪除
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * 清空快取
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 獲取快取大小
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * 清理過期項
   * @returns {number} 清理的專案數量
   */
  cleanup() {
    let cleanedCount = 0;
    const now = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (item.expiry && now > item.expiry) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  /**
   * 獲取快取統計資訊
   * @returns {Object} 統計資訊
   */
  getStats() {
    const now = Date.now();
    let expiredCount = 0;
    let totalAge = 0;
    
    for (const [key, item] of this.cache.entries()) {
      if (item.expiry && now > item.expiry) {
        expiredCount++;
      }
      totalAge += now - item.timestamp;
    }
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expiredCount,
      averageAge: this.cache.size > 0 ? Math.round(totalAge / this.cache.size) : 0,
      utilizationRate: Math.round((this.cache.size / this.maxSize) * 100)
    };
  }
}
