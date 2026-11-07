/**
 * 管理員Repository類
 * 負責管理員相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class AdminRepository extends BaseRepository {
  /**
   * 根據使用者名稱查詢管理員
   * @param {string} username - 使用者名稱
   * @returns {Promise<Object|null>} 管理員物件或null
   */
  async findByUsername(username) {
    if (!username) return null;

    return await this.findOne(DbTables.ADMINS, { username });
  }

  /**
   * 根據ID查詢管理員
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object|null>} 管理員物件或null
   */
  async findById(adminId) {
    return await super.findById(DbTables.ADMINS, adminId);
  }

  /**
   * 建立管理員
   * @param {Object} adminData - 管理員資料
   * @returns {Promise<Object>} 建立結果
   */
  async createAdmin(adminData) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...adminData,
      created_at: adminData.created_at || new Date().toISOString(),
      updated_at: adminData.updated_at || new Date().toISOString(),
    };

    return await this.create(DbTables.ADMINS, dataWithTimestamp);
  }

  /**
   * 更新管理員資訊
   * @param {string} adminId - 管理員ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updateAdmin(adminId, updateData) {
    // 自動更新修改時間
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    return await this.update(DbTables.ADMINS, adminId, dataWithTimestamp);
  }

  /**
   * 更新管理員最後登入時間
   * 注意：admins表中沒有last_login欄位，此方法僅更新updated_at欄位作為登入記錄
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object>} 更新結果
   */
  async updateLastLogin(adminId) {
    return await this.execute(`UPDATE ${DbTables.ADMINS} SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [adminId]);
  }

  /**
   * 檢查使用者名稱是否已存在
   * @param {string} username - 使用者名稱
   * @param {string} excludeId - 排除的管理員ID（用於更新時檢查）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsByUsername(username, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.ADMINS} WHERE username = ? AND id != ?`, [username, excludeId]);
      return !!result;
    } else {
      return await this.exists(DbTables.ADMINS, { username });
    }
  }

  /**
   * 獲取管理員統計資訊
   * @returns {Promise<Object>} 統計資訊
   */
  async getStatistics() {
    const total = await super.count(DbTables.ADMINS);

    // 獲取最近活躍的管理員數量（最近30天有更新的）
    // 注意：由於admins表沒有last_login欄位，使用updated_at欄位作為活躍度指標
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentActive = await this.queryFirst(
      `SELECT COUNT(*) as count FROM ${DbTables.ADMINS}
       WHERE updated_at IS NOT NULL AND updated_at >= ?`,
      [thirtyDaysAgo.toISOString()]
    );

    return {
      total,
      recentActive: recentActive?.count || 0,
    };
  }

  /**
   * 獲取所有管理員列表
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} 管理員列表
   */
  async findAll(options = {}) {
    const { orderBy = "created_at DESC", limit, offset } = options;

    return await this.findMany(DbTables.ADMINS, {}, { orderBy, limit, offset });
  }

  /**
   * 刪除管理員
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteAdmin(adminId) {
    return await this.delete(DbTables.ADMINS, adminId);
  }

  // ==================== 管理員令牌管理方法 ====================

  /**
   * 根據令牌值查詢令牌資訊
   * @param {string} token - 令牌值
   * @returns {Promise<Object|null>} 令牌物件或null
   */
  async findTokenByValue(token) {
    if (!token) return null;

    return await this.queryFirst(
      `SELECT admin_id, expires_at, created_at
       FROM ${DbTables.ADMIN_TOKENS}
       WHERE token = ?`,
      [token]
    );
  }

  /**
   * 驗證令牌（包含過期檢查和自動清理）
   * @param {string} token - 令牌值
   * @returns {Promise<string|null>} 管理員ID或null
   */
  async validateToken(token) {
    if (!token) return null;

    try {
      const tokenInfo = await this.findTokenByValue(token);

      if (!tokenInfo) {
        return null;
      }

      const expiresAt = new Date(tokenInfo.expires_at);
      const now = new Date();

      // 檢查令牌是否已過期
      if (now > expiresAt) {
        // 刪除過期的令牌
        await this.deleteToken(token);
        return null;
      }

      return tokenInfo.admin_id;
    } catch (error) {
      console.error("驗證令牌時發生錯誤:", error);
      return null;
    }
  }

  /**
   * 建立管理員令牌
   * @param {string} adminId - 管理員ID
   * @param {string} token - 令牌值
   * @param {Date|string} expiresAt - 過期時間
   * @returns {Promise<Object>} 建立結果
   */
  async createToken(adminId, token, expiresAt) {
    const expiresAtISO = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;

    return await this.execute(
      `INSERT INTO ${DbTables.ADMIN_TOKENS} (token, admin_id, expires_at, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [token, adminId, expiresAtISO]
    );
  }

  /**
   * 刪除指定令牌
   * @param {string} token - 令牌值
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteToken(token) {
    return await this.execute(`DELETE FROM ${DbTables.ADMIN_TOKENS} WHERE token = ?`, [token]);
  }

  /**
   * 刪除管理員的所有令牌
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteTokensByAdminId(adminId) {
    return await this.execute(`DELETE FROM ${DbTables.ADMIN_TOKENS} WHERE admin_id = ?`, [adminId]);
  }

  /**
   * 刪除所有過期令牌
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteExpiredTokens(currentTime = new Date()) {
    const result = await this.execute(`DELETE FROM ${DbTables.ADMIN_TOKENS} WHERE expires_at < ?`, [currentTime.toISOString()]);

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個過期令牌`,
    };
  }

  /**
   * 清理指定管理員的過期令牌
   * @param {string} adminId - 管理員ID
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Object>} 刪除結果
   */
  async cleanupTokensForAdmin(adminId, currentTime = new Date()) {
    const result = await this.execute(
      `DELETE FROM ${DbTables.ADMIN_TOKENS}
       WHERE admin_id = ? AND expires_at < ?`,
      [adminId, currentTime.toISOString()]
    );

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除管理員${adminId}的${result.meta?.changes || 0}個過期令牌`,
    };
  }

  /**
   * 獲取管理員的令牌列表（可選擇是否包含過期token）
   * @param {string} adminId - 管理員ID
   * @param {Object} options - 查詢選項
   * @param {boolean} options.includeExpired - 是否包含過期token，預設false
   * @param {string} options.orderBy - 排序方式，預設'created_at ASC'
   * @returns {Promise<Array>} 令牌列表
   */
  async getTokensForAdmin(adminId, options = {}) {
    const { includeExpired = false, orderBy = "created_at ASC" } = options;

    let sql = `SELECT token, created_at, expires_at FROM ${DbTables.ADMIN_TOKENS} WHERE admin_id = ?`;
    const params = [adminId];

    // 如果不包含過期token，新增過期時間條件
    if (!includeExpired) {
      const now = new Date().toISOString();
      sql += ` AND expires_at > ?`;
      params.push(now);
    }

    sql += ` ORDER BY ${orderBy}`;

    const result = await this.query(sql, params);
    return result.results || [];
  }

  /**
   * 獲取管理員的所有有效令牌（向後相容方法）
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Array>} 有效令牌列表
   */
  async getValidTokensForAdmin(adminId) {
    return await this.getTokensForAdmin(adminId, { includeExpired: false, orderBy: "created_at ASC" });
  }

  /**
   * 獲取管理員的所有令牌（包括過期的）
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Array>} 所有令牌列表
   */
  async getAllTokensForAdmin(adminId) {
    return await this.getTokensForAdmin(adminId, { includeExpired: true, orderBy: "created_at DESC" });
  }

  /**
   * 獲取管理員的令牌統計資訊（基於getValidTokensForAdmin避免重複查詢）
   * @param {string} adminId - 管理員ID
   * @returns {Promise<Object>} 令牌統計資訊
   */
  async getTokenStatistics(adminId) {
    // 獲取總令牌數
    const total = await super.count(DbTables.ADMIN_TOKENS, { admin_id: adminId });

    // 獲取有效令牌數（複用getValidTokensForAdmin方法）
    const validTokens = await this.getValidTokensForAdmin(adminId);
    const valid = validTokens.length;

    return {
      total,
      valid,
      expired: total - valid,
    };
  }
}
