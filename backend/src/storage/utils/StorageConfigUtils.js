/**
 * 儲存配置工具類
 * 提供統一的儲存配置獲取方法，供MountManager、FileService等使用
 * 避免重複程式碼，保持架構一致性
 */

import { ApiStatus } from "../../constants/index.js";
import { AppError, ValidationError, NotFoundError } from "../../http/errors.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { StorageFactory } from "../factory/StorageFactory.js";

export class StorageConfigUtils {
  /**
   * 根據儲存型別和配置ID獲取儲存配置
   * @param {D1Database} db - 資料庫例項
   * @param {string} storageType - 儲存型別
   * @param {string} configId - 配置ID
   * @returns {Promise<Object>} 儲存配置物件
   */
  static async getStorageConfig(db, storageType, configId) {
    if (!storageType) {
      throw new ValidationError("儲存型別不能為空");
    }

    if (!configId) {
      throw new ValidationError("配置ID不能為空");
    }

    if (!StorageFactory.isTypeSupported(storageType)) {
      throw new ValidationError(`不支援的儲存型別: ${storageType}`);
    }

    // 統一走 StorageConfigRepository，並依賴其內部的 StorageFactory.projectConfig 完成展平
    const factory = ensureRepositoryFactory(db);
    const repo = factory.getStorageConfigRepository();
    const config = repo.findByIdWithSecrets
      ? await repo.findByIdWithSecrets(configId)
      : await repo.findById(configId); // 兜底：舊實現不帶金鑰

    if (!config) {
      throw new NotFoundError("儲存配置不存在");
    }

    if (config.storage_type && config.storage_type !== storageType) {
      throw new ValidationError(`儲存配置型別不匹配，期望 ${storageType}，實際 ${config.storage_type}`);
    }

    return config;
  }

  /**
   * 檢查儲存配置是否存在
   * @param {D1Database} db - 資料庫例項
   * @param {string} storageType - 儲存型別
   * @param {string} configId - 配置ID
   * @returns {Promise<boolean>} 是否存在
   */
  static async configExists(db, storageType, configId) {
    try {
      await StorageConfigUtils.getStorageConfig(db, storageType, configId);
      return true;
    } catch (error) {
      if (error instanceof AppError && error.status === ApiStatus.NOT_FOUND) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 獲取支援的儲存型別列表
   * @returns {Array<string>} 支援的儲存型別
   */
  static getSupportedStorageTypes() {
    return StorageFactory.getSupportedTypes();
  }

  /**
   * 驗證儲存型別是否支援
   * @param {string} storageType - 儲存型別
   * @returns {boolean} 是否支援
   */
  static isStorageTypeSupported(storageType) {
    return StorageConfigUtils.getSupportedStorageTypes().includes(storageType);
  }
}
