/**
 * API金鑰Repository類
 * 負責API金鑰相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { Permission, PermissionChecker } from "../constants/permissions.js";

export class ApiKeyRepository extends BaseRepository {
  /**
   * 根據金鑰查詢API金鑰
   * @param {string} key - API金鑰
   * @returns {Promise<Object|null>} API金鑰物件或null
   */
  async findByKey(key) {
    if (!key) return null;

    return await this.findOne(DbTables.API_KEYS, { key });
  }

  /**
   * 根據ID查詢API金鑰
   * @param {string} keyId - API金鑰ID
   * @returns {Promise<Object|null>} API金鑰物件或null
   */
  async findById(keyId) {
    return await super.findById(DbTables.API_KEYS, keyId);
  }

  /**
   * 獲取所有API金鑰列表
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} API金鑰列表
   */
  async findAll(options = {}) {
    const { orderBy = "created_at DESC", limit, offset } = options;

    return await this.findMany(DbTables.API_KEYS, {}, { orderBy, limit, offset });
  }

  /**
   * 建立API金鑰
   * @param {Object} keyData - API金鑰資料
   * @returns {Promise<Object>} 建立結果
   */
  async createApiKey(keyData) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...keyData,
      created_at: keyData.created_at || new Date().toISOString(),
    };

    return await this.create(DbTables.API_KEYS, dataWithTimestamp);
  }

  /**
   * 更新API金鑰資訊
   * @param {string} keyId - API金鑰ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updateApiKey(keyId, updateData) {
    return await this.update(DbTables.API_KEYS, keyId, updateData);
  }

  /**
   * 更新API金鑰最後使用時間
   * @param {string} keyId - API金鑰ID
   * @returns {Promise<Object>} 更新結果
   */
  async updateLastUsed(keyId) {
    return await this.execute(`UPDATE ${DbTables.API_KEYS} SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [keyId]);
  }

  /**
   * 刪除API金鑰
   * @param {string} keyId - API金鑰ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteApiKey(keyId) {
    return await this.delete(DbTables.API_KEYS, keyId);
  }

  /**
   * 檢查金鑰是否已存在
   * @param {string} key - API金鑰
   * @param {string} excludeId - 排除的金鑰ID（用於更新時檢查）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsByKey(key, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.API_KEYS} WHERE key = ? AND id != ?`, [key, excludeId]);
      return !!result;
    } else {
      return await this.exists(DbTables.API_KEYS, { key });
    }
  }

  /**
   * 檢查名稱是否已存在
   * @param {string} name - 金鑰名稱
   * @param {string} excludeId - 排除的金鑰ID（用於更新時檢查）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsByName(name, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.API_KEYS} WHERE name = ? AND id != ?`, [name, excludeId]);
      return !!result;
    } else {
      return await this.exists(DbTables.API_KEYS, { name });
    }
  }

  /**
   * 刪除過期的API金鑰
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteExpired(currentTime = new Date()) {
    const result = await this.execute(
      `DELETE FROM ${DbTables.API_KEYS} 
       WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [currentTime.toISOString()]
    );

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個過期API金鑰`,
    };
  }

  /**
   * 查詢過期的API金鑰
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Array>} 過期金鑰列表
   */
  async findExpired(currentTime = new Date()) {
    const result = await this.query(
      `SELECT * FROM ${DbTables.API_KEYS} 
       WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [currentTime.toISOString()]
    );

    return result.results || [];
  }

  /**
   * 獲取API金鑰統計資訊
   * @returns {Promise<Object>} 統計資訊
   */
  async getStatistics() {
    const total = await this.count(DbTables.API_KEYS);

    // 獲取有效金鑰數量（未過期）
    const now = new Date().toISOString();
    const valid = await this.queryFirst(
      `SELECT COUNT(*) as count FROM ${DbTables.API_KEYS} 
       WHERE expires_at IS NULL OR expires_at > ?`,
      [now]
    );

    // 獲取所有金鑰資料，在應用層統計許可權
    const allKeys = await this.findAll();
    const permissionStats = {
      // 基礎許可權
      text: 0,
      file_share: 0,

      // 掛載頁許可權
      mount_view: 0,
      mount_upload: 0,
      mount_copy: 0,
      mount_rename: 0,
      mount_delete: 0,

      // WebDAV許可權
      webdav_read: 0,
      webdav_manage: 0,
    };

    // 使用位標誌許可權系統進行統計
    allKeys.forEach((key) => {
      const permissions = key.permissions || 0;

      // 基礎許可權統計（任一相關位即可視為具備該能力族）
      if (PermissionChecker.hasAnyPermission(permissions, [Permission.TEXT_SHARE, Permission.TEXT_MANAGE])) {
        permissionStats.text++;
      }
      if (PermissionChecker.hasAnyPermission(permissions, [Permission.FILE_SHARE, Permission.FILE_MANAGE])) {
        permissionStats.file_share++;
      }

      // 掛載頁許可權統計
      if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_VIEW)) {
        permissionStats.mount_view++;
      }
      if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_UPLOAD)) {
        permissionStats.mount_upload++;
      }
      if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_COPY)) {
        permissionStats.mount_copy++;
      }
      if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_RENAME)) {
        permissionStats.mount_rename++;
      }
      if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_DELETE)) {
        permissionStats.mount_delete++;
      }

      // WebDAV許可權統計
      if (PermissionChecker.hasPermission(permissions, Permission.WEBDAV_READ)) {
        permissionStats.webdav_read++;
      }
      if (PermissionChecker.hasPermission(permissions, Permission.WEBDAV_MANAGE)) {
        permissionStats.webdav_manage++;
      }
    });

    return {
      total,
      valid: valid?.count || 0,
      expired: total - (valid?.count || 0),
      permissions: permissionStats,
    };
  }
}
