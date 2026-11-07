/**
 * 掛載管理器
 * 負責管理儲存驅動例項的建立、快取和生命週期
 * 基於掛載點配置動態建立和管理儲存驅動
 *
 */

import { StorageFactory } from "../factory/StorageFactory.js";
import { ApiStatus } from "../../constants/index.js";
import { AppError, AuthorizationError, DriverError, NotFoundError, ValidationError } from "../../http/errors.js";
import { findMountPointByPath } from "../fs/utils/MountResolver.js";
import { StorageConfigUtils } from "../utils/StorageConfigUtils.js";
import { getAccessibleMountsForUser } from "../../security/helpers/access.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { UserType } from "../../constants/index.js";

// MountManager 的許可權觸點只剩 `_validateMountPermissionForApiKey`，
// 它依賴 security/access 的工具保證 basicPath + S3 公共性一致，
// 因而這裡不再直接引用任何 authGateway 邏輯。

// 全域性驅動快取 - 永不過期策略，配置更新時主動清理
const globalDriverCache = new Map();
const MAX_CACHE_SIZE = 12;
// 除錯開關預設值（當 env / process.env 都沒配置時生效）
const DEFAULT_DEBUG_DRIVER_CACHE = false;

// 快取統計
const cacheStats = {
  hits: 0,
  misses: 0,
  errors: 0,
  cleanups: 0,
};

function toMountAppError(errorInfo) {
  const status = errorInfo?.status ?? ApiStatus.INTERNAL_ERROR;
  const message = errorInfo?.message ?? "掛載點解析失敗";
  switch (status) {
    case ApiStatus.BAD_REQUEST:
      return new ValidationError(message);
    case ApiStatus.FORBIDDEN:
      return new AuthorizationError(message);
    case ApiStatus.NOT_FOUND:
      return new NotFoundError(message);
    default:
      return new AppError(message, { status, code: "MOUNT_RESOLVE_FAILED", expose: status < 500 });
  }
}

/**
 * 清理所有驅動快取（手動清理用）
 * 由於採用永不過期策略，此函式主要用於手動清理或除錯
 */
function cleanupExpiredDrivers() {
  // 永不過期策略下，此函式主要用於手動清理
  // 實際的清理透過配置更新時的主動清理完成
  console.log(`當前驅動快取數量: ${globalDriverCache.size}，採用永不過期 + 主動清理策略`);
  return 0;
}

/**
 * LRU清理：當快取數量超過限制時，清理最久未訪問的項
 * @param {number} targetSize - 目標快取大小
 */
function evictOldestEntries(targetSize = MAX_CACHE_SIZE * 0.8) {
  if (globalDriverCache.size <= targetSize) return 0;

  // 按最後訪問時間排序，找出最久未訪問的項
  const entries = Array.from(globalDriverCache.entries()).sort(([, a], [, b]) => {
    const aTime = a.lastAccessed || a.timestamp;
    const bTime = b.lastAccessed || b.timestamp;
    return aTime - bTime;
  });

  const toRemove = globalDriverCache.size - targetSize;
  let removedCount = 0;

  for (let i = 0; i < toRemove && i < entries.length; i++) {
    const [key, cached] = entries[i];
    try {
      cached.driver.cleanup?.();
    } catch (error) {
      console.warn(`LRU清理驅動失敗 ${key}:`, error.message);
    }
    globalDriverCache.delete(key);
    removedCount++;
  }

  if (removedCount > 0) {
    console.log(`🗑️ LRU清理了 ${removedCount} 個最久未訪問的驅動快取`);
  }

  return removedCount;
}

export class MountManager {
  /**
   * 統一解析 DEBUG_DRIVER_CACHE
   *
   * - 未配置（undefined/null/空字串） -> 使用 defaultValue
   * - 配置了 -> 僅當值為 "true" 時返回 true，否則返回 false
   */
  static resolveDebugDriverCache({ env = null, defaultValue = DEFAULT_DEBUG_DRIVER_CACHE } = {}) {
    const raw =
      env?.DEBUG_DRIVER_CACHE ??
      (typeof process !== "undefined" ? process.env?.DEBUG_DRIVER_CACHE : null);

    if (raw == null || String(raw).trim() === "") {
      return !!defaultValue;
    }

    return String(raw).trim().toLowerCase() === "true";
  }

  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(db, encryptionSecret, repositoryFactory = null, options = {}) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);

    // 除錯開關：驅動快取日誌
    // 只認 true/false（不區分大小寫）
    const envEnabled = MountManager.resolveDebugDriverCache({ env: options?.env, defaultValue: DEFAULT_DEBUG_DRIVER_CACHE });
    this.debugDriverCache = typeof options?.debugDriverCache === "boolean" ? options.debugDriverCache : envEnabled;

    // 記錄管理器建立時間，用於統計
    this.createdAt = Date.now();
  }

  /**
   * 根據路徑獲取儲存驅動
   * @param {string} path - 檔案路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 包含驅動例項和掛載資訊的物件
   */
  async getDriverByPath(path, userIdOrInfo, userType) {
    // 查詢掛載點
    const mountResult = await findMountPointByPath(this.db, path, userIdOrInfo, userType, this.repositoryFactory);

    if (mountResult.error) {
      throw toMountAppError(mountResult.error);
    }

    const { mount, subPath } = mountResult;

    // 對API金鑰使用者驗證掛載點S3配置許可權
    if (userType === UserType.API_KEY) {
      await this._validateMountPermissionForApiKey(mount, userIdOrInfo);
    }

    // 獲取儲存驅動
    const driver = await this.getDriver(mount);

    return {
      driver,
      mount,
      subPath,
      mountPath: mountResult.mountPath,
    };
  }

  /**
   * 根據掛載點獲取儲存驅動
   * @param {Object} mount - 掛載點物件
   * @returns {Promise<any>} 儲存驅動例項（BaseDriver 子類）
   */
  async getDriver(mount) {
    // 如果快取數量超過限制，進行LRU清理
    if (globalDriverCache.size >= MAX_CACHE_SIZE) {
      evictOldestEntries();
    }

    const cacheKey = `${mount.storage_type}:${mount.storage_config_id}`;
    const cached = globalDriverCache.get(cacheKey);

    // 檢查快取有效性和健康狀態（永不過期，只檢查健康狀態）
    if (cached) {
      try {
        // 輕量級健康檢查
        if (cached.driver.isInitialized()) {
          cacheStats.hits++;
          // 更新訪問時間（用於LRU）
          cached.lastAccessed = Date.now();
          const cacheAge = Math.round((Date.now() - cached.timestamp) / 1000 / 60);
          if (this.debugDriverCache) {
            console.log(`✅[MountManager]驅動快取命中: ${cacheKey} (快取年齡: ${cacheAge}分鐘)`);
          }
          return cached.driver;
        }
      } catch (error) {
        cacheStats.errors++;
        globalDriverCache.delete(cacheKey);
      }
    }

    // 快取未命中，建立新驅動
    cacheStats.misses++;
    const driver = await this._createDriverWithRetry(mount);

    // 快取新建立的驅動
    globalDriverCache.set(cacheKey, {
      driver,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      mountId: mount.id,
      storageType: mount.storage_type,
    });

    if (this.debugDriverCache) {
      console.log(`🆕[MountManager]建立新驅動: ${cacheKey} (當前快取數量: ${globalDriverCache.size})`);
    }
    return driver;
  }

  /**
   * 建立儲存驅動例項（帶重試機制）
   * @private
   * @param {Object} mount - 掛載點物件
   * @param {number} maxRetries - 最大重試次數
   * @returns {Promise<any>} 儲存驅動例項（BaseDriver 子類）
   */
  async _createDriverWithRetry(mount, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this._createDriver(mount);
      } catch (error) {
        const isLastAttempt = i === maxRetries - 1;
        if (isLastAttempt) {
          cacheStats.errors++;
          if (error instanceof AppError) {
            throw error;
          }
          throw new DriverError("儲存驅動建立失敗", {
            status: ApiStatus.INTERNAL_ERROR,
            expose: false,
            details: {
              cause: error?.message,
              storageType: mount?.storage_type,
              storageConfigId: mount?.storage_config_id,
            },
          });
        }

        // 指數退避：1秒、2秒、3秒
        const delay = 1000 * (i + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 建立儲存驅動例項
   * @private
   * @param {Object} mount - 掛載點物件
   * @returns {Promise<any>} 儲存驅動例項（BaseDriver 子類）
   */
  async _createDriver(mount) {
    // 獲取儲存配置
    const config = await this._getStorageConfig(mount);

    // 使用工廠建立驅動
    const driver = await StorageFactory.createDriver(mount.storage_type, config, this.encryptionSecret);

    return driver;
  }

  /**
   * 獲取儲存配置
   * @private
   * @param {Object} mount - 掛載點物件
   * @returns {Promise<Object>} 儲存配置
   */
  async _getStorageConfig(mount) {
    return await StorageConfigUtils.getStorageConfig(this.db, mount.storage_type, mount.storage_config_id);
  }

  /**
   * 驗證API金鑰使用者的掛載點許可權
   * 檢查掛載點的S3配置是否允許API金鑰使用者訪問
   * @private
   * @param {Object} mount - 掛載點物件
   * @param {Object} userIdOrInfo - API金鑰使用者資訊
   * @throws {AuthorizationError} 當許可權不足時丟擲異常
  */
  async _validateMountPermissionForApiKey(mount, userIdOrInfo) {
    try {
      // 獲取可訪問的掛載點列表（已包含S3配置許可權過濾）
      const accessibleMounts = await getAccessibleMountsForUser(this.db, userIdOrInfo, UserType.API_KEY, this.repositoryFactory);

      // 驗證目標掛載點是否在可訪問列表中
      const isAccessible = accessibleMounts.some((accessibleMount) => accessibleMount.id === mount.id);

      if (!isAccessible) {
        console.log(`MountManager許可權檢查失敗: API金鑰使用者無許可權訪問掛載點 ${mount.name}`);
        throw new AuthorizationError(`API金鑰使用者無許可權訪問掛載點: ${mount.name}`);
      }

      console.log(`MountManager許可權檢查透過: API金鑰使用者可訪問掛載點 ${mount.name}`);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      console.error("MountManager許可權檢查過程發生錯誤:", error);
      throw new AppError("許可權檢查過程發生錯誤", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "MOUNT_PERMISSION_CHECK_FAILED",
        expose: false,
        details: { cause: error?.message },
      });
    }
  }

  /**
   * 清理指定掛載點的驅動快取
   * @param {string} mountId - 掛載點ID
   */
  async clearMountCache(mountId) {
    let clearedCount = 0;

    for (const [key, cached] of globalDriverCache.entries()) {
      if (cached.mountId === mountId) {
        try {
          await cached.driver.cleanup?.();
        } catch (error) {
          console.warn(`清理掛載點驅動失敗 ${key}:`, error.message);
        }
        globalDriverCache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      console.log(`清理掛載點驅動快取: ${mountId} -> 清理了 ${clearedCount} 個驅動`);
    }
  }

  /**
   * 清理指定儲存配置的驅動快取
   * @param {string} storageType - 儲存型別
   * @param {string} configId - 配置ID
   */
  async clearConfigCache(storageType, configId) {
    const cacheKey = `${storageType}:${configId}`;
    const cached = globalDriverCache.get(cacheKey);

    if (cached) {
      try {
        await cached.driver.cleanup?.();
      } catch (error) {
        console.warn(`清理儲存配置驅動失敗 ${cacheKey}:`, error.message);
      }
      globalDriverCache.delete(cacheKey);
      console.log(`清理儲存配置驅動快取: ${cacheKey}`);
    }
  }

  /**
   * 獲取快取統計資訊
   * @returns {Object} 快取統計資訊
   */
  getCacheStats() {
    const totalRequests = cacheStats.hits + cacheStats.misses;
    const hitRate = totalRequests > 0 ? Math.round((cacheStats.hits / totalRequests) * 100) : 0;

    return {
      totalCached: globalDriverCache.size,
      maxCacheSize: MAX_CACHE_SIZE,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      errors: cacheStats.errors,
      cleanups: cacheStats.cleanups,
      hitRate: hitRate,
      cacheUtilization: Math.round((globalDriverCache.size / MAX_CACHE_SIZE) * 100),
      managerUptime: Math.round((Date.now() - this.createdAt) / 1000 / 60), // 分鐘
    };
  }

  /**
   * 手動清理過期驅動快取
   * @returns {number} 清理的驅動數量
   */
  manualCleanup() {
    const expiredCount = cleanupExpiredDrivers();
    const lruCount = evictOldestEntries();
    return expiredCount + lruCount;
  }

  /**
   * 清理所有驅動快取
   */
  async clearAllCache() {
    const promises = [];
    let clearedCount = globalDriverCache.size;

    for (const [, cached] of globalDriverCache.entries()) {
      if (cached.driver?.cleanup) {
        promises.push(cached.driver.cleanup().catch(() => {}));
      }
    }

    await Promise.all(promises);
    globalDriverCache.clear();

    if (clearedCount > 0) {
      console.log(`已清理所有儲存驅動快取: ${clearedCount} 個驅動`);
    }
  }

  /**
   * 銷燬管理器
   */
  async destroy() {
    // 清理所有快取
    await this.clearAllCache();

    // 重置統計資訊
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.errors = 0;
    cacheStats.cleanups = 0;

    console.log("掛載管理器已銷燬");
  }
}
