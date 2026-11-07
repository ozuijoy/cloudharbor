import { DEFAULT_MAX_UPLOAD_SIZE_MB } from "../constants/index.js";
import { AuthenticationError, RepositoryError } from "../http/errors.js";
import { SETTING_GROUPS } from "../constants/settings.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { previewSettingsCache } from "../cache/index.js";
import { processWeeklyData } from "../utils/common.js";

const resolveRepositoryFactory = ensureRepositoryFactory;

/**
 * 獲取最大上傳檔案大小限制
 * @param {D1Database} db - D1資料庫例項
 * @returns {Promise<number>} 最大上傳大小(MB)
 */
export async function getMaxUploadSize(db, repositoryFactory) {
  try {
    // 使用 SystemRepository 的新方法
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    // 使用 getSettingMetadata 獲取最大上傳大小設定
    const setting = await systemRepository.getSettingMetadata("max_upload_size");

    // 返回預設值或資料庫中的值
    return setting ? parseInt(setting.value) : DEFAULT_MAX_UPLOAD_SIZE_MB;
  } catch (error) {
    console.error("獲取最大上傳大小錯誤:", error);
    // 發生錯誤時返回預設值
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }
}

/**
 * 獲取儀表盤統計資料
 * @param {D1Database} db - D1資料庫例項
 * @param {string} adminId - 管理員ID
 * @returns {Promise<Object>} 儀表盤統計資料
 */
export async function getDashboardStats(db, adminId, repositoryFactory) {
  try {
    if (!adminId) {
      throw new AuthenticationError("未授權");
    }

    // 使用 SystemRepository
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    // 獲取基礎統計資料
    const basicStats = await systemRepository.getDashboardStats();

    // 獲取最近一週的趨勢資料
    const weeklyTrends = await systemRepository.getWeeklyTrends();

    // 處理每日資料，補全缺失的日期
    const lastWeekPastes = processWeeklyData(weeklyTrends.pastes);
    const lastWeekFiles = processWeeklyData(weeklyTrends.files);

    return {
      totalPastes: basicStats.totalPastes,
      totalFiles: basicStats.totalFiles,
      totalApiKeys: basicStats.totalApiKeys,
      totalStorageConfigs: basicStats.totalStorageConfigs ?? basicStats.totalS3Configs ?? 0,
      lastWeekPastes,
      lastWeekFiles,
    };
  } catch (error) {
    console.error("獲取儀表盤統計資料失敗:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("獲取儀表盤統計資料失敗", { cause: error?.message });
  }
}

// ==================== 新增：分組設定管理服務方法 ====================

/**
 * 按分組獲取設定項
 * @param {D1Database} db - D1資料庫例項
 * @param {number} groupId - 分組ID
 * @param {boolean} includeMetadata - 是否包含後設資料
 * @returns {Promise<Array>} 設定項列表
 */
export async function getSettingsByGroup(db, groupId, includeMetadata = true, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getSettingsByGroup(groupId, includeMetadata);
  } catch (error) {
    console.error("按分組獲取設定錯誤:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("按分組獲取設定失敗", { cause: error?.message });
  }
}

/**
 * 獲取所有分組的設定項
 * @param {D1Database} db - D1資料庫例項
 * @param {boolean} includeSystemGroup - 是否包含系統內部分組
 * @returns {Promise<Object>} 按分組組織的設定項
 */
export async function getAllSettingsByGroups(db, includeSystemGroup = false, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getAllSettingsByGroups(includeSystemGroup);
  } catch (error) {
    console.error("獲取分組設定錯誤:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("獲取分組設定失敗", { cause: error?.message });
  }
}

/**
 * 獲取分組列表和統計資訊
 * @param {D1Database} db - D1資料庫例項
 * @returns {Promise<Array>} 分組資訊列表
 */
export async function getGroupsInfo(db, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getGroupsInfo();
  } catch (error) {
    console.error("獲取分組資訊錯誤:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("獲取分組資訊失敗", { cause: error?.message });
  }
}

/**
 * 批次更新分組設定
 * @param {D1Database} db - D1資料庫例項
 * @param {number} groupId - 分組ID
 * @param {Object} settings - 設定鍵值對
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 操作結果
 */
export async function updateGroupSettings(db, groupId, settings, options = {}, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    const result = await systemRepository.updateGroupSettings(groupId, settings, options);

    // 如果是預覽設定分組，重新整理預覽設定快取
    if (groupId === SETTING_GROUPS.PREVIEW) {
      try {
        await previewSettingsCache.refresh(db);
        console.log("預覽設定快取已自動重新整理");
      } catch (cacheError) {
        console.error("重新整理預覽設定快取失敗:", cacheError);
        // 快取重新整理失敗不影響設定更新的成功
      }
    }

    return result;
  } catch (error) {
    console.error("批次更新分組設定錯誤:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("批次更新分組設定失敗", { cause: error?.message });
  }
}

/**
 * 獲取設定項後設資料
 * @param {D1Database} db - D1資料庫例項
 * @param {string} key - 設定鍵名
 * @returns {Promise<Object|null>} 設定項後設資料
 */
export async function getSettingMetadata(db, key, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getSettingMetadata(key);
  } catch (error) {
    console.error("獲取設定後設資料錯誤:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("獲取設定後設資料失敗", { cause: error?.message });
  }
}
