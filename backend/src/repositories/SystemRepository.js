/**
 * 系統設定Repository類
 * 負責系統設定相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { DEFAULT_SETTINGS, SETTING_GROUPS, SETTING_TYPES, SETTING_FLAGS, validateSettingValue, convertSettingValue } from "../constants/settings.js";
import { ValidationError } from "../http/errors.js";

export class SystemRepository extends BaseRepository {
  /**
   * - 只會在 metadata 不存在時嘗試 INSERT OR IGNORE
   * - 如果 DEFAULT_SETTINGS 也沒有該 key，則返回 null
   *
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async ensureSettingMetadata(key) {
    if (!key) return null;

    const existing = await this.getSettingMetadata(key);
    if (existing) return existing;

    const defaults = DEFAULT_SETTINGS || {};
    const def = defaults[key];
    if (!def) return null;

    // 將 DEFAULT_SETTINGS 的欄位對映到 DB 列
    const value = def.default_value ?? "";
    const description = def.help ?? "";
    const type = def.type ?? SETTING_TYPES.TEXT;
    const groupId = def.group_id ?? SETTING_GROUPS.GLOBAL;
    const options = def.options ?? null;
    const sortOrder = def.sort_order ?? 0;
    const flags = def.flag ?? SETTING_FLAGS.PUBLIC;

    await this.execute(
      `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [key, String(value), String(description), String(type), Number(groupId), options, Number(sortOrder), Number(flags)],
    );

    return await this.getSettingMetadata(key);
  }

  /**
   * 獲取系統統計資料
   * @returns {Promise<Object>} 統計資料
   */
  async getDashboardStats() {
    // 獲取各種資料的統計
    const stats = {};

    // 文字分享總數
    stats.totalPastes = await this.count(DbTables.PASTES);

    // 檔案上傳總數
    stats.totalFiles = await this.count(DbTables.FILES);

    // API金鑰總數
    stats.totalApiKeys = await this.count(DbTables.API_KEYS);

    // 儲存配置總數（所有型別）
    const totalStorageResult = await this.queryFirst(`SELECT COUNT(*) AS cnt FROM ${DbTables.STORAGE_CONFIGS}`);
    stats.totalStorageConfigs = totalStorageResult?.cnt || 0;

    // S3配置總數（storage_configs 按型別過濾）
    const totalS3Result = await this.queryFirst(
      `SELECT COUNT(*) AS cnt FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type = 'S3'`
    );
    stats.totalS3Configs = totalS3Result?.cnt || 0;

    return stats;
  }

  /**
   * 獲取最近一週的資料趨勢
   * @returns {Promise<Object>} 趨勢資料
   */
  async getWeeklyTrends() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // 文字分享趨勢
    const pastesQuery = `
      SELECT
        date(created_at) as date,
        COUNT(*) as count
      FROM ${DbTables.PASTES}
      WHERE created_at >= ?
      GROUP BY date(created_at)
      ORDER BY date ASC
    `;
    const pastesResult = await this.query(pastesQuery, [sevenDaysAgoISO]);

    // 檔案上傳趨勢
    const filesQuery = `
      SELECT
        date(created_at) as date,
        COUNT(*) as count
      FROM ${DbTables.FILES}
      WHERE created_at >= ?
      GROUP BY date(created_at)
      ORDER BY date ASC
    `;
    const filesResult = await this.query(filesQuery, [sevenDaysAgoISO]);

    return {
      pastes: pastesResult.results || [],
      files: filesResult.results || [],
    };
  }


  /**
   * 清理過期資料
   * 使用各個Repository的專門方法，避免重複SQL邏輯
   * @returns {Promise<Object>} 清理結果
   */
  async cleanupExpiredData() {
    const now = new Date();
    let totalCleaned = 0;

    // 使用PasteRepository的專門方法清理過期文字分享
    const PasteRepository = require("./PasteRepository");
    const pasteRepo = new PasteRepository(this.db);

    const expiredPastesResult = await pasteRepo.deleteExpired(now);
    const pastesCount = expiredPastesResult.deletedCount;
    totalCleaned += pastesCount;

    // 使用ApiKeyRepository的專門方法清理過期API金鑰
    const ApiKeyRepository = require("./ApiKeyRepository");
    const apiKeyRepo = new ApiKeyRepository(this.db);

    const expiredApiKeysResult = await apiKeyRepo.deleteExpired(now);
    const apiKeysCount = expiredApiKeysResult.deletedCount;
    totalCleaned += apiKeysCount;

    // 使用PasteRepository的專門方法清理超限文字分享
    const overLimitResult = await pasteRepo.deleteOverViewLimit();
    const overLimitCount = overLimitResult.deletedCount;
    totalCleaned += overLimitCount;

    return {
      totalCleaned,
      details: {
        expiredPastes: pastesCount,
        expiredApiKeys: apiKeysCount,
        overLimitPastes: overLimitCount,
      },
      message: `清理完成，共清理${totalCleaned}條過期資料`,
    };
  }

  /**
   * 獲取代理簽名全域性配置
   * @returns {Promise<Object>} 全域性配置
   */
  async getProxySignConfig() {
    const signAllSetting = await this.getSettingMetadata("proxy_sign_all");
    const expiresSetting = await this.getSettingMetadata("proxy_sign_expires");

    return {
      signAll: signAllSetting?.value === "true",
      expires: parseInt(expiresSetting?.value) || 0,
    };
  }

  /**
   * 更新代理簽名全域性配置
   * @param {Object} config - 配置物件
   * @param {boolean} config.signAll - 是否簽名所有
   * @param {number} config.expires - 過期時間（秒）
   * @returns {Promise<Object>} 操作結果
   */
  async updateProxySignConfig(config) {
    const { signAll, expires } = config;

    // 驗證引數
    if (typeof signAll !== "boolean") {
      throw new ValidationError("signAll 必須是布林值");
    }

    if (typeof expires !== "number" || expires < 0) {
      throw new ValidationError("expires 必須是非負數");
    }

    // 使用新的分組更新機制（代理簽名設定屬於全域性設定組，group_id = 1）
    const settings = {
      proxy_sign_all: signAll.toString(),
      proxy_sign_expires: expires.toString(),
    };

    return await this.updateGroupSettings(1, settings, { validateType: true });
  }

  // ==================== 分組和型別化設定管理方法 ====================

  /**
   * 按分組獲取設定項
   * @param {number} groupId - 分組ID
   * @param {boolean} includeMetadata - 是否包含後設資料
   * @returns {Promise<Array>} 設定項列表
   */
  async getSettingsByGroup(groupId, includeMetadata = true) {
    const orderBy = includeMetadata ? "sort_order ASC, key ASC" : "key ASC";

    if (includeMetadata) {
      // 返回完整的後設資料
      return await this.findMany(DbTables.SYSTEM_SETTINGS, { group_id: groupId }, { orderBy });
    } else {
      // 只返回key-value對
      const settings = await this.findMany(DbTables.SYSTEM_SETTINGS, { group_id: groupId }, { orderBy });
      return settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
      }));
    }
  }

  /**
   * 獲取所有分組的設定項
   * @param {boolean} includeSystemGroup - 是否包含系統內部分組
   * @returns {Promise<Object>} 按分組組織的設定項
   */
  async getAllSettingsByGroups(includeSystemGroup = false) {
    const whereClause = includeSystemGroup ? {} : { group_id: { "!=": SETTING_GROUPS.SYSTEM } };
    const allSettings = await this.findMany(DbTables.SYSTEM_SETTINGS, whereClause, { orderBy: "group_id ASC, sort_order ASC, key ASC" });

    // 按分組組織資料
    const groupedSettings = {};
    for (const setting of allSettings) {
      const groupId = setting.group_id || SETTING_GROUPS.GLOBAL;
      if (!groupedSettings[groupId]) {
        groupedSettings[groupId] = [];
      }
      groupedSettings[groupId].push(setting);
    }

    return groupedSettings;
  }

  /**
   * 獲取設定項的後設資料
   * @param {string} key - 設定鍵名
   * @returns {Promise<Object|null>} 設定項後設資料
   */
  async getSettingMetadata(key) {
    if (!key) return null;
    return await this.findOne(DbTables.SYSTEM_SETTINGS, { key });
  }

  /**
   * 批次更新分組設定（支援型別驗證）
   * @param {number} groupId - 分組ID
   * @param {Object} settings - 設定鍵值對
   * @param {Object} options - 選項
   * @returns {Promise<Object>} 操作結果
   */
  async updateGroupSettings(groupId, settings, options = {}) {
    const { validateType = true } = options;
    const keys = Object.keys(settings);
    let updatedCount = 0;
    const errors = [];

    // 驗證所有設定項都屬於指定分組
    for (const key of keys) {
      const metadata = await this.ensureSettingMetadata(key);
      if (!metadata) {
        errors.push({ key, error: `設定項不存在: ${key}` });
        continue;
      }

      if (metadata.group_id !== groupId) {
        errors.push({ key, error: `設定項 ${key} 不屬於分組 ${groupId}` });
        continue;
      }

      try {
        let finalValue = settings[key];

        // 型別驗證
        if (validateType && metadata.type) {
          if (!validateSettingValue(key, finalValue, metadata.type)) {
            throw new ValidationError(`設定值無效: ${key} = ${finalValue}`);
          }
        }

        // 型別轉換
        if (metadata.type) {
          finalValue = convertSettingValue(finalValue, metadata.type);
        }

        // 更新設定
        await this.execute(
          `UPDATE ${DbTables.SYSTEM_SETTINGS}
           SET value = ?, updated_at = CURRENT_TIMESTAMP
           WHERE key = ?`,
          [finalValue.toString(), key]
        );

        updatedCount++;
      } catch (error) {
        errors.push({ key, error: error.message });
      }
    }

    return {
      groupId,
      updatedCount,
      totalCount: keys.length,
      errors,
      success: errors.length === 0,
      message: errors.length === 0 ? `成功更新分組${groupId}的${updatedCount}個設定` : `更新了${updatedCount}個設定，${errors.length}個失敗`,
    };
  }

  /**
   * 獲取分組列表和統計資訊
   * @returns {Promise<Array>} 分組資訊列表
   */
  async getGroupsInfo() {
    const groupStats = await this.query(`
      SELECT
        group_id,
        COUNT(*) as setting_count,
        COUNT(CASE WHEN flags = ${SETTING_FLAGS.READONLY} THEN 1 END) as readonly_count
      FROM ${DbTables.SYSTEM_SETTINGS}
      WHERE group_id != ${SETTING_GROUPS.SYSTEM}
      GROUP BY group_id
      ORDER BY group_id ASC
    `);

    return (groupStats.results || []).map((stat) => ({
      id: stat.group_id,
      name: this.getGroupName(stat.group_id),
      settingCount: stat.setting_count,
      readonlyCount: stat.readonly_count,
    }));
  }

  /**
   * 獲取分組名稱
   * @param {number} groupId - 分組ID
   * @returns {string} 分組名稱
   */
  getGroupName(groupId) {
    const groupNames = {
      [SETTING_GROUPS.GLOBAL]: "全域性設定",
      [SETTING_GROUPS.WEBDAV]: "WebDAV設定",
      [SETTING_GROUPS.SYSTEM]: "系統設定",
      [SETTING_GROUPS.PREVIEW]: "預覽設定",
      [SETTING_GROUPS.SITE]: "站點設定",
    };
    return groupNames[groupId] || `未知分組(${groupId})`;
  }
}
