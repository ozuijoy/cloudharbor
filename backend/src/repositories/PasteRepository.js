/**
 * 文字分享Repository類
 * 負責文字分享相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class PasteRepository extends BaseRepository {
  /**
   * 根據slug查詢文字分享
   * @param {string} slug - 唯一標識
   * @returns {Promise<Object|null>} 文字分享物件或null
   */
  async findBySlug(slug) {
    if (!slug) return null;

    return await this.findOne(DbTables.PASTES, { slug });
  }

  /**
   * 根據ID查詢文字分享
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<Object|null>} 文字分享物件或null
   */
  async findById(pasteId) {
    return await super.findById(DbTables.PASTES, pasteId);
  }

  /**
   * 獲取所有文字分享列表（分頁）
   * @param {Object} options - 查詢選項
   * @returns {Promise<Object>} 包含結果和分頁資訊的物件
   */
  async findAllWithPagination(options = {}) {
    const { page = 1, limit = 10, created_by = null, orderBy = "created_at DESC" } = options;
    const offset = (page - 1) * limit;

    // 構建查詢條件
    const conditions = {};
    if (created_by) {
      conditions.created_by = created_by;
    }

    // 獲取總數
    const total = await this.count(DbTables.PASTES, conditions);

    // 獲取資料
    const results = await this.findMany(DbTables.PASTES, conditions, { orderBy, limit, offset });

    return {
      results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * 根據建立者獲取文字分享列表
   * @param {string} created_by - 建立者標識
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} 文字分享列表
   */
  async findByCreator(created_by, options = {}) {
    const { orderBy = "created_at DESC", limit, offset } = options;

    return await this.findMany(DbTables.PASTES, { created_by: created_by }, { orderBy, limit, offset });
  }

  /**
   * 根據ID和建立者查詢文字分享
   * @param {string} pasteId - 文字分享ID
   * @param {string} created_by - 建立者標識
   * @returns {Promise<Object|null>} 文字分享物件或null
   */
  async findByIdAndCreator(pasteId, created_by) {
    if (!pasteId || !created_by) return null;

    return await this.findOne(DbTables.PASTES, {
      id: pasteId,
      created_by: created_by,
    });
  }

  /**
   * 建立文字分享
   * @param {Object} pasteData - 文字分享資料
   * @returns {Promise<Object>} 建立結果
   */
  async createPaste(pasteData) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...pasteData,
      created_at: pasteData.created_at || new Date().toISOString(),
      updated_at: pasteData.updated_at || new Date().toISOString(),
    };

    return await this.create(DbTables.PASTES, dataWithTimestamp);
  }

  /**
   * 更新文字分享
   * @param {string} pasteId - 文字分享ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updatePaste(pasteId, updateData) {
    // 自動更新修改時間
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    return await this.update(DbTables.PASTES, pasteId, dataWithTimestamp);
  }

  /**
   * 增加文字分享檢視次數
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<Object>} 更新結果
   */
  async incrementViews(pasteId) {
    return await this.execute(`UPDATE ${DbTables.PASTES} SET views = views + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [pasteId]);
  }

  /**
   * 刪除文字分享
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deletePaste(pasteId) {
    return await this.delete(DbTables.PASTES, pasteId);
  }

  /**
   * 批次刪除文字分享
   * @param {Array<string>} pasteIds - 文字分享ID陣列
   * @returns {Promise<Object>} 刪除結果
   */
  async batchDelete(pasteIds) {
    if (!pasteIds || pasteIds.length === 0) {
      return { deletedCount: 0, message: "沒有要刪除的文字分享" };
    }

    const placeholders = pasteIds.map(() => "?").join(",");
    const result = await this.execute(`DELETE FROM ${DbTables.PASTES} WHERE id IN (${placeholders})`, pasteIds);

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個文字分享`,
    };
  }

  /**
   * 刪除過期的文字分享
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteExpired(currentTime = new Date()) {
    const result = await this.execute(
        `DELETE FROM ${DbTables.PASTES} 
       WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [currentTime.toISOString()]
    );

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個過期文字分享`,
    };
  }

  /**
   * 刪除超過最大檢視次數的文字分享
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteOverViewLimit() {
    const result = await this.execute(
        `DELETE FROM ${DbTables.PASTES} 
       WHERE max_views IS NOT NULL AND max_views > 0 AND views >= max_views`
    );

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個超限文字分享`,
    };
  }

  /**
   * 查詢過期文字分享
   * @param {Date} currentTime - 當前時間
   * @returns {Promise<Array>} 過期文字分享列表
   */
  async findExpired(currentTime = new Date()) {
    const result = await this.query(
        `SELECT * FROM ${DbTables.PASTES} 
       WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [currentTime.toISOString()]
    );

    return result.results || [];
  }

  /**
   * 查詢超過最大檢視次數的文字分享
   * @returns {Promise<Array>} 超限文字分享列表
   */
  async findOverViewLimit() {
    const result = await this.query(
        `SELECT * FROM ${DbTables.PASTES} 
       WHERE max_views IS NOT NULL AND max_views > 0 AND views >= max_views`
    );

    return result.results || [];
  }

  /**
   * 檢查slug是否已存在
   * @param {string} slug - 唯一標識
   * @param {string} excludeId - 排除的文字分享ID（用於更新時檢查）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsBySlug(slug, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.PASTES} WHERE slug = ? AND id != ?`, [slug, excludeId]);
      return !!result;
    } else {
      return await this.exists(DbTables.PASTES, { slug });
    }
  }

  /**
   * 獲取文字分享統計資訊
   * @param {string} created_by - 建立者標識（可選）
   * @returns {Promise<Object>} 統計資訊
   */
  async getStatistics(created_by = null) {
    const conditions = created_by ? { created_by: created_by } : {};

    const total = await this.count(DbTables.PASTES, conditions);

    // 獲取最近一週的資料
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let sql = `SELECT COUNT(*) as count FROM ${DbTables.PASTES} WHERE created_at >= ?`;
    const params = [sevenDaysAgo.toISOString()];

    if (created_by) {
      sql += ` AND created_by = ?`;
      params.push(created_by);
    }

    const recentCount = await this.queryFirst(sql, params);

    return {
      total,
      recentWeek: recentCount?.count || 0,
    };
  }

  // ==================== 密碼管理方法 ====================

  /**
   * 建立文字分享明文密碼記錄
   * @param {string} pasteId - 文字分享ID
   * @param {string} plainPassword - 明文密碼
   * @returns {Promise<Object>} 建立結果
   */
  async createPasswordRecord(pasteId, plainPassword) {
    return await this.execute(
        `INSERT INTO ${DbTables.PASTE_PASSWORDS} (paste_id, plain_password, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [pasteId, plainPassword]
    );
  }

  /**
   * 查詢文字分享的明文密碼
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<string|null>} 明文密碼或null
   */
  async findPasswordByPasteId(pasteId) {
    const result = await this.queryFirst(`SELECT plain_password FROM ${DbTables.PASTE_PASSWORDS} WHERE paste_id = ?`, [pasteId]);

    return result?.plain_password || null;
  }

  /**
   * 更新文字分享的明文密碼
   * @param {string} pasteId - 文字分享ID
   * @param {string} plainPassword - 新的明文密碼
   * @returns {Promise<Object>} 更新結果
   */
  async updatePasswordRecord(pasteId, plainPassword) {
    return await this.execute(
        `UPDATE ${DbTables.PASTE_PASSWORDS}
       SET plain_password = ?, updated_at = CURRENT_TIMESTAMP
       WHERE paste_id = ?`,
        [plainPassword, pasteId]
    );
  }

  /**
   * 刪除文字分享的密碼記錄
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deletePasswordRecord(pasteId) {
    return await this.execute(`DELETE FROM ${DbTables.PASTE_PASSWORDS} WHERE paste_id = ?`, [pasteId]);
  }

  /**
   * 檢查文字分享是否有密碼記錄
   * @param {string} pasteId - 文字分享ID
   * @returns {Promise<boolean>} 是否存在密碼記錄
   */
  async hasPasswordRecord(pasteId) {
    const result = await this.queryFirst(`SELECT paste_id FROM ${DbTables.PASTE_PASSWORDS} WHERE paste_id = ?`, [pasteId]);

    return !!result;
  }

  /**
   * 建立或更新密碼記錄
   * @param {string} pasteId - 文字分享ID
   * @param {string} plainPassword - 明文密碼
   * @returns {Promise<Object>} 操作結果
   */
  async upsertPasswordRecord(pasteId, plainPassword) {
    const exists = await this.hasPasswordRecord(pasteId);

    if (exists) {
      return await this.updatePasswordRecord(pasteId, plainPassword);
    } else {
      return await this.createPasswordRecord(pasteId, plainPassword);
    }
  }

  // ==================== 複合操作方法 ====================

  /**
   * 建立文字分享（包含密碼處理）
   * @param {Object} pasteData - 文字分享資料
   * @param {string} plainPassword - 明文密碼（可選）
   * @returns {Promise<Object>} 建立結果
   */
  async createPasteWithPassword(pasteData, plainPassword = null) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...pasteData,
      created_at: pasteData.created_at || new Date().toISOString(),
      updated_at: pasteData.updated_at || new Date().toISOString(),
    };

    // 建立文字分享記錄
    const createResult = await this.create(DbTables.PASTES, dataWithTimestamp);

    // 如果提供了明文密碼，建立密碼記錄
    if (plainPassword) {
      await this.createPasswordRecord(pasteData.id, plainPassword);
    }

    return createResult;
  }

  /**
   * 查詢文字分享（包含密碼資訊）
   * @param {string} slug - 唯一標識
   * @param {boolean} includePassword - 是否包含明文密碼
   * @returns {Promise<Object|null>} 文字分享物件（包含密碼資訊）或null
   */
  async findBySlugWithPassword(slug, includePassword = false) {
    const paste = await this.findBySlug(slug);

    if (!paste) return null;

    // 如果需要包含密碼且文字有密碼
    if (includePassword && paste.password) {
      const plainPassword = await this.findPasswordByPasteId(paste.id);
      return {
        ...paste,
        plain_password: plainPassword,
      };
    }

    return paste;
  }

  /**
   * 查詢文字分享（包含密碼資訊）
   * @param {string} pasteId - 文字分享ID
   * @param {boolean} includePassword - 是否包含明文密碼
   * @returns {Promise<Object|null>} 文字分享物件（包含密碼資訊）或null
   */
  async findByIdWithPassword(pasteId, includePassword = false) {
    const paste = await this.findById(pasteId);

    if (!paste) return null;

    // 如果需要包含密碼且文字有密碼
    if (includePassword && paste.password) {
      const plainPassword = await this.findPasswordByPasteId(paste.id);
      return {
        ...paste,
        plain_password: plainPassword,
      };
    }

    return paste;
  }

  /**
   * 更新文字分享（包含密碼處理）
   * @param {string} pasteId - 文字分享ID
   * @param {Object} updateData - 更新資料
   * @param {string} newPlainPassword - 新的明文密碼（可選）
   * @param {boolean} clearPassword - 是否清除密碼
   * @returns {Promise<Object>} 更新結果
   */
  async updatePasteWithPassword(pasteId, updateData, newPlainPassword = null, clearPassword = false) {
    // 更新文字分享記錄
    const updateResult = await this.updatePaste(pasteId, updateData);

    // 處理密碼更新
    if (clearPassword) {
      // 清除密碼
      await this.deletePasswordRecord(pasteId);
    } else if (newPlainPassword) {
      // 更新或建立密碼記錄
      await this.upsertPasswordRecord(pasteId, newPlainPassword);
    }

    return updateResult;
  }

  // ==================== 管理員專用查詢方法 ====================

  /**
   * 獲取管理員文字分享列表（包含內容預覽和格式化欄位）
   * @param {Object} options - 查詢選項
   * @returns {Promise<Object>} 包含結果和分頁資訊的物件
   */
  async findAllForAdmin(options = {}) {
    const { page = 1, limit = 10, offset = null, created_by = null, search = null } = options;

    // 支援兩種分頁模式：page模式和offset模式
    const actualOffset = offset !== null ? offset : (page - 1) * limit;

    // 構建查詢條件
    let whereClause = "";
    let countWhereClause = "";
    const queryParams = [];
    const countParams = [];

    const conditions = [];

    // 新增搜尋條件 - 搜尋連結標識、備註、內容
    if (search && search.trim()) {
      const searchPattern = `%${search.trim()}%`;
      conditions.push("(slug LIKE ? OR remark LIKE ? OR content LIKE ?)");
      queryParams.push(searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern);
    }

    // 新增建立者篩選
    if (created_by) {
      conditions.push("created_by = ?");
      queryParams.push(created_by);
      countParams.push(created_by);
    }

    // 構建WHERE子句
    if (conditions.length > 0) {
      whereClause = " WHERE " + conditions.join(" AND ");
      countWhereClause = " WHERE " + conditions.join(" AND ");
    }

    // 獲取總數
    const countSql = `SELECT COUNT(*) as total FROM ${DbTables.PASTES}${countWhereClause}`;
    const countResult = await this.queryFirst(countSql, countParams);
    const total = countResult?.total || 0;

    // 查詢資料：管理員列表統一返回完整 content，由前端自行截斷預覽
    const querySql = `
      SELECT
        id,
        slug,
        title,
        content,
        remark,
        password IS NOT NULL as has_password,
        expires_at,
        max_views,
        views as view_count,
        is_public,
        created_by,
        created_at,
        updated_at
      FROM ${DbTables.PASTES}${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    queryParams.push(limit, actualOffset);
    const queryResult = await this.query(querySql, queryParams);
    const results = queryResult.results || [];

    return {
      results,
      pagination: {
        total,
        limit,
        offset: actualOffset,
        hasMore: actualOffset + limit < total,
        // 保持向後相容
        page: Math.floor(actualOffset / limit) + 1,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 獲取使用者文字分享列表（包含完整內容）
   * @param {string} created_by - 建立者標識
   * @param {Object} options - 查詢選項
   * @returns {Promise<Object>} 包含結果和分頁資訊的物件
   */
  async findByCreatorWithPagination(created_by, options = {}) {
    const { limit = 30, offset = 0, search = null } = options;

    // 構建查詢條件
    let whereClause = "WHERE created_by = ?";
    let params = [created_by];

    // 新增搜尋條件 - 搜尋連結標識、備註、內容
    if (search && search.trim()) {
      const searchPattern = `%${search.trim()}%`;
      whereClause += " AND (slug LIKE ? OR remark LIKE ? OR content LIKE ?)";
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // 查詢資料
    const querySql = `
      SELECT id, slug, title, content, remark, password IS NOT NULL as has_password,
      expires_at, max_views, views, is_public, created_at, updated_at, created_by
      FROM ${DbTables.PASTES}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const queryResult = await this.query(querySql, params);
    const results = queryResult.results || [];

    // 獲取總數（包含搜尋條件）
    const countSql = `SELECT COUNT(*) as total FROM ${DbTables.PASTES} ${whereClause}`;
    const countParams = params.slice(0, -2); // 移除limit和offset引數
    const countResult = await this.queryFirst(countSql, countParams);
    const total = countResult?.total || 0;

    return {
      results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  // ==================== 更新專用方法 ====================

  /**
   * 根據條件查詢文字分享（用於更新前的許可權檢查）
   * @param {string} slug - 唯一標識
   * @param {string} created_by - 建立者標識（可選，用於許可權檢查）
   * @returns {Promise<Object|null>} 文字分享物件或null
   */
  async findBySlugForUpdate(slug, created_by = null) {
    let sql = `SELECT id, slug, expires_at, max_views, views FROM ${DbTables.PASTES} WHERE slug = ?`;
    const params = [slug];

    if (created_by) {
      sql += ` AND created_by = ?`;
      params.push(created_by);
    }

    return await this.queryFirst(sql, params);
  }

  /**
   * 更新文字分享（支援複雜的欄位更新）
   * @param {string} pasteId - 文字分享ID
   * @param {Object} updateData - 更新資料
   * @param {Object} options - 更新選項
   * @returns {Promise<Object>} 更新結果
   */
  async updatePasteComplex(pasteId, updateData, options = {}) {
    const { newSlug = null, passwordHash = null, clearPassword = false, resetViews = false, newViewsValue = 0 } = options;

    // 構建動態 SQL
    const updateFields = [];
    const params = [];

    // 處理密碼更新
    if (clearPassword) {
      updateFields.push("password = NULL");
    } else if (passwordHash) {
      updateFields.push("password = ?");
      params.push(passwordHash);
    }

    // 處理 slug 更新
    if (newSlug) {
      updateFields.push("slug = ?");
      params.push(newSlug);
    }

    // 處理基本欄位更新
    if (updateData.title !== undefined) {
      updateFields.push("title = ?");
      params.push(updateData.title || null);
    }

    if (updateData.content !== undefined) {
      updateFields.push("content = ?");
      params.push(updateData.content);
    }

    if (updateData.remark !== undefined) {
      updateFields.push("remark = ?");
      params.push(updateData.remark || null);
    }

    if (updateData.expires_at !== undefined) {
      updateFields.push("expires_at = ?");
      params.push(updateData.expires_at || null);
    }

    if (updateData.max_views !== undefined) {
      updateFields.push("max_views = ?");
      params.push(updateData.max_views || null);
    }

    if (updateData.is_public !== undefined) {
      updateFields.push("is_public = ?");
      params.push(updateData.is_public ? 1 : 0);
    }

    if (resetViews) {
      updateFields.push("views = ?");
      params.push(newViewsValue);
    }

    // 總是更新修改時間
    updateFields.push("updated_at = CURRENT_TIMESTAMP");

    // 新增 WHERE 條件的引數
    params.push(pasteId);

    const sql = `
      UPDATE ${DbTables.PASTES}
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;

    return await this.execute(sql, params);
  }

  // ==================== 批次刪除專用方法 ====================

  /**
   * 批次刪除指定建立者的文字分享
   * @param {Array<string>} pasteIds - 文字分享ID陣列
   * @param {string} created_by - 建立者標識
   * @returns {Promise<Object>} 刪除結果
   */
  async batchDeleteByCreator(pasteIds, created_by) {
    if (!pasteIds || pasteIds.length === 0) {
      return { deletedCount: 0, message: "沒有要刪除的文字分享" };
    }

    const placeholders = pasteIds.map(() => "?").join(",");
    const params = [...pasteIds, created_by];

    const result = await this.execute(`DELETE FROM ${DbTables.PASTES} WHERE id IN (${placeholders}) AND created_by = ?`, params);

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}個文字分享`,
    };
  }
}
