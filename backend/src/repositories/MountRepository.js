/**
 * 掛載點Repository類
 * 負責掛載點相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class MountRepository extends BaseRepository {
  /**
   * 根據掛載路徑查詢掛載點
   * @param {string} mountPath - 掛載路徑
   * @returns {Promise<Object|null>} 掛載點物件或null
   */
  async findByMountPath(mountPath) {
    if (!mountPath) return null;

    return await this.findOne(DbTables.STORAGE_MOUNTS, { mount_path: mountPath });
  }

  /**
   * 根據管理員ID獲取掛載點列表
   * @param {string} adminId - 管理員ID
   * @param {boolean} includeInactive - 是否包含禁用的掛載點
   * @returns {Promise<Array>} 掛載點列表
   */
  async findByAdmin(adminId, includeInactive = false) {
    const conditions = { created_by: adminId };
    if (!includeInactive) {
      conditions.is_active = 1;
    }

    return await this.findMany(DbTables.STORAGE_MOUNTS, conditions, { orderBy: "sort_order ASC, name ASC" });
  }

  /**
   * 獲取所有掛載點列表（管理員專用）
   * @param {boolean} includeInactive - 是否包含禁用的掛載點
   * @returns {Promise<Array>} 所有掛載點列表
   */
  async findAll(includeInactive = true) {
    const conditions = includeInactive ? {} : { is_active: 1 };

    return await this.findMany(DbTables.STORAGE_MOUNTS, conditions, { orderBy: "sort_order ASC, name ASC" });
  }

  /**
   * 根據ID獲取掛載點
   * @param {string} mountId - 掛載點ID
   * @returns {Promise<Object|null>} 掛載點物件或null
   */
  async findById(mountId) {
    return await super.findById(DbTables.STORAGE_MOUNTS, mountId);
  }

  /**
   * 根據ID和管理員ID獲取掛載點（許可權檢查）
   * @param {string} mountId - 掛載點ID
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object|null>} 掛載點物件或null
   */
  async findByIdAndAdmin(mountId, adminId) {
    return await this.findOne(DbTables.STORAGE_MOUNTS, {
      id: mountId,
      created_by: adminId,
    });
  }

  /**
   * 根據ID和API金鑰使用者獲取啟用的掛載點
   * @param {string} mountId - 掛載點ID
   * @param {string} apiKeyId - API金鑰ID
   * @returns {Promise<Object|null>} 掛載點物件或null
   */
  async findByIdAndApiKey(mountId, apiKeyId) {
    return await this.findOne(DbTables.STORAGE_MOUNTS, {
      id: mountId,
      created_by: apiKeyId,
      is_active: 1,
    });
  }

  /**
   * 根據儲存配置ID查詢掛載點
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storageType - 儲存型別
   * @returns {Promise<Array>} 掛載點列表
   */
  async findByStorageConfig(storageConfigId, storageType) {
    return await this.findMany(DbTables.STORAGE_MOUNTS, {
      storage_config_id: storageConfigId,
      storage_type: storageType,
    });
  }

  /**
   * 建立掛載點
   * @param {Object} mountData - 掛載點資料
   * @returns {Promise<Object>} 建立結果
   */
  async createMount(mountData) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...mountData,
      created_at: mountData.created_at || new Date().toISOString(),
      updated_at: mountData.updated_at || new Date().toISOString(),
    };

    return await this.create(DbTables.STORAGE_MOUNTS, dataWithTimestamp);
  }

  /**
   * 更新掛載點
   * @param {string} mountId - 掛載點ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updateMount(mountId, updateData) {
    // 自動更新修改時間
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    return await this.update(DbTables.STORAGE_MOUNTS, mountId, dataWithTimestamp);
  }

  /**
   * 更新掛載點最後使用時間
   * @param {string} mountId - 掛載點ID
   * @returns {Promise<Object>} 更新結果
   */
  async updateLastUsed(mountId) {
    return await this.execute(`UPDATE ${DbTables.STORAGE_MOUNTS} SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [mountId]);
  }

  /**
   * 刪除掛載點
   * @param {string} mountId - 掛載點ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteMount(mountId) {
    return await this.delete(DbTables.STORAGE_MOUNTS, mountId);
  }

  /**
   * 檢查掛載路徑是否已存在
   * @param {string} mountPath - 掛載路徑
   * @param {string} excludeId - 排除的掛載點ID（用於更新時檢查）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsByMountPath(mountPath, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.STORAGE_MOUNTS} WHERE mount_path = ? AND id != ?`, [mountPath, excludeId]);
      return !!result;
    } else {
      return await this.exists(DbTables.STORAGE_MOUNTS, { mount_path: mountPath });
    }
  }

  /**
   * 批次更新掛載點狀態
   * @param {Array<string>} mountIds - 掛載點ID陣列
   * @param {number} isActive - 啟用狀態 (0或1)
   * @returns {Promise<Object>} 更新結果
   */
  async batchUpdateStatus(mountIds, isActive) {
    if (!mountIds || mountIds.length === 0) {
      return { updatedCount: 0, message: "沒有要更新的掛載點" };
    }

    const placeholders = mountIds.map(() => "?").join(",");
    const result = await this.execute(
      `UPDATE ${DbTables.STORAGE_MOUNTS} 
       SET is_active = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id IN (${placeholders})`,
      [isActive, ...mountIds]
    );

    return {
      updatedCount: result.meta?.changes || 0,
      message: `已更新${result.meta?.changes || 0}個掛載點狀態`,
    };
  }

  /**
   * 獲取掛載點統計資訊
   * @param {string} userId - 使用者ID（可選）
   * @returns {Promise<Object>} 統計資訊
   */
  async getStatistics(userId = null) {
    const conditions = userId ? { created_by: userId } : {};

    const total = await this.count(DbTables.STORAGE_MOUNTS, conditions);
    const active = await this.count(DbTables.STORAGE_MOUNTS, {
      ...conditions,
      is_active: 1,
    });

    // 按儲存型別統計
    let sql = `
      SELECT storage_type, COUNT(*) as count 
      FROM ${DbTables.STORAGE_MOUNTS}
    `;

    const params = [];
    if (userId) {
      sql += ` WHERE created_by = ?`;
      params.push(userId);
    }

    sql += ` GROUP BY storage_type`;

    const typeStats = await this.query(sql, params);

    return {
      total,
      active,
      inactive: total - active,
      byType: typeStats.results || [],
    };
  }
}
