/**
 * 檔案Repository類
 * 負責檔案相關的資料訪問操作
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { ValidationError } from "../http/errors.js";

export class FileRepository extends BaseRepository {
  /**
   * 根據ID查詢檔案
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object|null>} 檔案物件或null
   */
  async findById(fileId) {
    return await super.findById(DbTables.FILES, fileId);
  }

  /**
   * 根據slug查詢檔案
   * @param {string} slug - 檔案slug
   * @returns {Promise<Object|null>} 檔案物件或null
   */
  async findBySlug(slug) {
    if (!slug) return null;

    return await this.queryFirst(`SELECT * FROM ${DbTables.FILES} WHERE slug = ?`, [slug]);
  }

  /**
   * 根據slug查詢檔案並關聯儲存配置
   * @param {string} slug - 檔案slug
   * @returns {Promise<Object|null>} 包含儲存配置的檔案物件或null
   */
  async findBySlugWithStorageConfig(slug) {
    if (!slug) return null;

    return await this.queryFirst(
      `
      SELECT
        f.*,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.endpoint_url')
          ELSE NULL
        END as endpoint_url,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.bucket_name')
          ELSE NULL
        END as bucket_name,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.region')
          ELSE NULL
        END as region,
        NULL as access_key_id,
        NULL as secret_access_key,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.path_style')
          ELSE NULL
        END as path_style,
        CASE
          WHEN f.storage_type = 'S3'
            THEN COALESCE(json_extract(s.config_json,'$.provider_type'), 'S3')
          ELSE s.storage_type
        END as storage_provider_type,
        s.name as storage_config_name,
        s.url_proxy as url_proxy
      FROM ${DbTables.FILES} f
      LEFT JOIN ${DbTables.STORAGE_CONFIGS} s ON f.storage_config_id = s.id
      WHERE f.slug = ?
      `,
      [slug]
    );
  }

  /**
   * 根據ID查詢檔案並關聯儲存配置
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object|null>} 包含儲存配置的檔案物件或null
   */
  async findByIdWithStorageConfig(fileId) {
    if (!fileId) return null;

    return await this.queryFirst(
      `
      SELECT
        f.*,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.endpoint_url')
          ELSE NULL
        END as endpoint_url,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.bucket_name')
          ELSE NULL
        END as bucket_name,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.region')
          ELSE NULL
        END as region,
        NULL as access_key_id,
        NULL as secret_access_key,
        CASE
          WHEN f.storage_type = 'S3' THEN json_extract(s.config_json,'$.path_style')
          ELSE NULL
        END as path_style,
        CASE
          WHEN f.storage_type = 'S3'
            THEN COALESCE(json_extract(s.config_json,'$.provider_type'), 'S3')
          ELSE s.storage_type
        END as storage_provider_type,
        s.name as storage_config_name
      FROM ${DbTables.FILES} f
      LEFT JOIN ${DbTables.STORAGE_CONFIGS} s ON f.storage_config_id = s.id
      WHERE f.id = ?
      `,
      [fileId]
    );
  }

  /**
   * 建立檔案記錄
   * @param {Object} fileData - 檔案資料
   * @returns {Promise<Object>} 建立結果
   */
  async createFile(fileData) {
    // 確保包含必要的時間戳
    const dataWithTimestamp = {
      ...fileData,
      created_at: fileData.created_at || new Date().toISOString(),
      updated_at: fileData.updated_at || new Date().toISOString(),
    };

    return await this.create(DbTables.FILES, dataWithTimestamp);
  }

  /**
   * 更新檔案記錄
   * @param {string} fileId - 檔案ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updateFile(fileId, updateData) {
    // 自動更新修改時間
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    return await this.update(DbTables.FILES, fileId, dataWithTimestamp);
  }

  /**
   * 增加檔案檢視次數
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object>} 更新結果
   */
  async incrementViews(fileId) {
    return await this.execute(`UPDATE ${DbTables.FILES} SET views = views + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [fileId]);
  }

  /**
   * 刪除檔案記錄
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteFile(fileId) {
    return await this.delete(DbTables.FILES, fileId);
  }

  /**
   * 根據儲存路徑刪除檔案記錄
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storagePath - 儲存路徑
   * @param {string} storageType - 儲存型別
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteByStorageConfigPath(storageConfigId, storagePath, storageType) {
    if (!storageConfigId || !storagePath || !storageType) {
      return { deletedCount: 0, message: "缺少必要引數" };
    }

    const result = await this.execute(`DELETE FROM ${DbTables.FILES} WHERE storage_config_id = ? AND storage_path = ? AND storage_type = ?`, [
      storageConfigId,
      storagePath,
      storageType,
    ]);

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}條檔案記錄`,
    };
  }

  /**
   * 根據儲存配置ID查詢檔案
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storageType - 儲存型別
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} 檔案列表
   */
  async findByStorageConfigId(storageConfigId, storageType, options = {}) {
    if (!storageType) {
      throw new ValidationError("儲存型別引數是必需的");
    }
    return await this.findMany(
      DbTables.FILES,
      {
        storage_config_id: storageConfigId,
        storage_type: storageType,
      },
      options
    );
  }

  /**
   * 根據建立者查詢檔案
   * @param {string} createdBy - 建立者標識
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} 檔案列表
   */
  async findByCreator(createdBy, options = {}) {
    return await this.findMany(DbTables.FILES, { created_by: createdBy }, options);
  }

  /**
   * 根據ID和建立者查詢檔案
   * @param {string} fileId - 檔案ID
   * @param {string} createdBy - 建立者標識
   * @returns {Promise<Object|null>} 檔案物件或null
   */
  async findByIdAndCreator(fileId, createdBy) {
    if (!fileId || !createdBy) return null;

    return await this.queryFirst(`SELECT * FROM ${DbTables.FILES} WHERE id = ? AND created_by = ?`, [fileId, createdBy]);
  }

  /**
   * 統計檔案總大小
   * @param {Object} conditions - 統計條件
   * @returns {Promise<number>} 總大小（位元組）
   */
  async getTotalSize(conditions = {}) {
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);

    let sql = `SELECT COALESCE(SUM(size), 0) as total_size FROM ${DbTables.FILES}`;

    if (fields.length > 0) {
      const whereClause = fields.map((field) => `${field} = ?`).join(" AND ");
      sql += ` WHERE ${whereClause}`;
    }

    const result = await this.queryFirst(sql, values);
    return result?.total_size || 0;
  }

  /**
   * 獲取指定儲存配置的總使用量（排除指定檔案）
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} excludeFileId - 要排除的檔案ID
   * @param {string} storageType - 儲存型別
   * @returns {Promise<Object>} 包含total_used欄位的物件
   */
  async getTotalSizeByStorageConfigExcludingFile(storageConfigId, excludeFileId, storageType) {
    if (!storageType) {
      throw new ValidationError("儲存型別引數是必需的");
    }
    const result = await this.queryFirst(`SELECT COALESCE(SUM(size), 0) as total_used FROM ${DbTables.FILES} WHERE storage_type = ? AND storage_config_id = ? AND id != ?`, [
      storageType,
      storageConfigId,
      excludeFileId,
    ]);
    return result;
  }

  /**
   * 批次刪除檔案記錄
   * @param {Array<string>} fileIds - 檔案ID陣列
   * @returns {Promise<Object>} 刪除結果
   */
  async batchDelete(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return { deletedCount: 0, message: "沒有要刪除的檔案" };
    }

    const placeholders = fileIds.map(() => "?").join(",");
    const result = await this.execute(`DELETE FROM ${DbTables.FILES} WHERE id IN (${placeholders})`, fileIds);

    return {
      deletedCount: result.meta?.changes || 0,
      message: `已刪除${result.meta?.changes || 0}條檔案記錄`,
    };
  }

  /**
   * 檢查檔案是否存在
   * @param {string} slug - 檔案slug
   * @returns {Promise<boolean>} 是否存在
   */
  async existsBySlug(slug) {
    return await this.exists(DbTables.FILES, { slug });
  }

  /**
   * 根據slug查詢檔案（排除指定ID）
   * @param {string} slug - 檔案slug
   * @param {string} excludeId - 要排除的檔案ID
   * @returns {Promise<Object|null>} 檔案物件或null
   */
  async findBySlugExcludingId(slug, excludeId) {
    return await this.queryFirst(`SELECT id FROM ${DbTables.FILES} WHERE slug = ? AND id != ?`, [slug, excludeId]);
  }

  /**
   * 檢查儲存路徑是否存在
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storagePath - 儲存路徑
   * @param {string} storageType - 儲存型別（必需引數）
   * @returns {Promise<boolean>} 是否存在
   */
  async existsByStoragePath(storageConfigId, storagePath, storageType) {
    if (!storageType) {
      throw new ValidationError("儲存型別引數是必需的");
    }
    return await this.exists(DbTables.FILES, {
      storage_config_id: storageConfigId,
      storage_path: storagePath,
      storage_type: storageType,
    });
  }

  /**
   * 根據儲存路徑查詢檔案
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storagePath - 儲存路徑
   * @param {string} storageType - 儲存型別（必需引數）
   * @returns {Promise<Object|null>} 檔案物件或null
   */
  async findByStoragePath(storageConfigId, storagePath, storageType) {
    if (!storageType) {
      throw new ValidationError("儲存型別引數是必需的");
    }
    return await this.findOne(DbTables.FILES, {
      storage_config_id: storageConfigId,
      storage_path: storagePath,
      storage_type: storageType,
    });
  }

  /**
   * 統計使用指定儲存配置的檔案數量
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storageType - 儲存型別
   * @returns {Promise<number>} 檔案數量
   */
  async countByStorageConfigId(storageConfigId, storageType) {
    if (!storageType) {
      throw new ValidationError("儲存型別引數是必需的");
    }
    return await super.count(DbTables.FILES, {
      storage_config_id: storageConfigId,
      storage_type: storageType,
    });
  }

  /**
   * 查詢多個檔案並關聯儲存配置
   * @param {Object} conditions - 查詢條件
   * @param {Object} options - 查詢選項
   * @returns {Promise<Array>} 包含儲存配置的檔案列表
   */
  async findManyWithStorageConfig(conditions = {}, options = {}) {
    const { orderBy = "created_at DESC", limit, offset } = options;

    // 構建WHERE條件
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);

    let sql = `
      SELECT
        f.id, f.filename, f.slug, f.storage_path, f.storage_config_id,
        f.storage_type, f.file_path, f.mimetype, f.size, f.remark,
        f.created_at, f.views, f.max_views, f.expires_at, f.etag,
        f.password, f.created_by, f.use_proxy,
        s.name as storage_config_name,
        CASE
          WHEN f.storage_type = 'S3'
            THEN COALESCE(json_extract(s.config_json,'$.provider_type'), 'S3')
          ELSE s.storage_type
        END as storage_provider_type,
        ak.name as key_name
      FROM ${DbTables.FILES} f
      LEFT JOIN ${DbTables.STORAGE_CONFIGS} s ON f.storage_config_id = s.id
      LEFT JOIN ${DbTables.API_KEYS} ak ON f.created_by LIKE 'apikey:%' AND ak.id = SUBSTR(f.created_by, 8)
    `;

    if (fields.length > 0) {
      const whereClause = fields.map((field) => `f.${field} = ?`).join(" AND ");
      sql += ` WHERE ${whereClause}`;
    }

    sql += ` ORDER BY f.${orderBy}`;

    if (limit) {
      sql += ` LIMIT ${limit}`;
      if (offset) {
        sql += ` OFFSET ${offset}`;
      }
    }

    const queryResult = await this.query(sql, values);
    return queryResult.results || [];
  }

  /**
   * 統計檔案數量（支援條件）
   * @param {Object} conditions - 查詢條件
   * @returns {Promise<number>} 檔案數量
   */
  async count(conditions = {}) {
    return await super.count(DbTables.FILES, conditions);
  }

  // ==================== 密碼管理方法 ====================

  /**
   * 建立檔案明文密碼記錄
   * @param {string} fileId - 檔案ID
   * @param {string} plainPassword - 明文密碼
   * @returns {Promise<Object>} 建立結果
   */
  async createFilePasswordRecord(fileId, plainPassword) {
    return await this.execute(
      `INSERT INTO ${DbTables.FILE_PASSWORDS} (file_id, plain_password, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [fileId, plainPassword]
    );
  }

  /**
   * 更新檔案的明文密碼
   * @param {string} fileId - 檔案ID
   * @param {string} plainPassword - 新的明文密碼
   * @returns {Promise<Object>} 更新結果
   */
  async updateFilePasswordRecord(fileId, plainPassword) {
    return await this.execute(
      `UPDATE ${DbTables.FILE_PASSWORDS}
       SET plain_password = ?, updated_at = CURRENT_TIMESTAMP
       WHERE file_id = ?`,
      [plainPassword, fileId]
    );
  }

  /**
   * 刪除檔案的密碼記錄
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteFilePasswordRecord(fileId) {
    return await this.execute(`DELETE FROM ${DbTables.FILE_PASSWORDS} WHERE file_id = ?`, [fileId]);
  }

  /**
   * 檢查檔案是否有密碼記錄
   * @param {string} fileId - 檔案ID
   * @returns {Promise<boolean>} 是否存在密碼記錄
   */
  async hasFilePasswordRecord(fileId) {
    const result = await this.queryFirst(`SELECT file_id FROM ${DbTables.FILE_PASSWORDS} WHERE file_id = ?`, [fileId]);

    return !!result;
  }

  /**
   * 建立或更新檔案密碼記錄
   * @param {string} fileId - 檔案ID
   * @param {string} plainPassword - 明文密碼
   * @returns {Promise<Object>} 操作結果
   */
  async upsertFilePasswordRecord(fileId, plainPassword) {
    const exists = await this.hasFilePasswordRecord(fileId);

    if (exists) {
      return await this.updateFilePasswordRecord(fileId, plainPassword);
    } else {
      return await this.createFilePasswordRecord(fileId, plainPassword);
    }
  }

  /**
   * 獲取檔案密碼資訊
   * @param {string} fileId - 檔案ID
   * @returns {Promise<Object|null>} 密碼資訊物件，包含plain_password欄位
   */
  async getFilePassword(fileId) {
    return await this.queryFirst(`SELECT plain_password FROM ${DbTables.FILE_PASSWORDS} WHERE file_id = ?`, [fileId]);
  }

  // ==================== 搜尋方法 ====================

  /**
   * 搜尋檔案並關聯儲存配置
   * @param {string} searchTerm - 搜尋關鍵詞
   * @param {Object} options - 搜尋選項
   * @param {string} options.createdBy - 建立者篩選
   * @param {number} options.limit - 每頁條數
   * @param {number} options.offset - 偏移量
   * @returns {Promise<Object>} 搜尋結果和分頁資訊
   */
  async searchWithStorageConfig(searchTerm, options = {}) {
    const { createdBy, limit = 30, offset = 0 } = options;

    // 構建搜尋條件 - 搜尋檔名、連結標識、備註
    const searchPattern = `%${searchTerm}%`;
    const searchConditions = ["f.filename LIKE ?", "f.slug LIKE ?", "f.remark LIKE ?"];

    let whereClause = `(${searchConditions.join(" OR ")})`;
    let params = [searchPattern, searchPattern, searchPattern];

    // 新增建立者篩選
    if (createdBy) {
      whereClause += " AND f.created_by = ?";
      params.push(createdBy);
    }

    // 查詢資料
    const sql = `
      SELECT
        f.id, f.filename, f.slug, f.storage_path, f.storage_config_id,
        f.storage_type, f.file_path, f.mimetype, f.size, f.remark,
        f.created_at, f.views, f.max_views, f.expires_at, f.etag,
        f.password, f.created_by, f.use_proxy,
        s.name as storage_config_name,
        CASE
          WHEN f.storage_type = 'S3'
            THEN COALESCE(json_extract(s.config_json,'$.provider_type'), 'S3')
          ELSE s.storage_type
        END as storage_provider_type,
        ak.name as key_name
      FROM ${DbTables.FILES} f
      LEFT JOIN ${DbTables.STORAGE_CONFIGS} s ON f.storage_config_id = s.id
      LEFT JOIN ${DbTables.API_KEYS} ak ON f.created_by LIKE 'apikey:%' AND ak.id = SUBSTR(f.created_by, 8)
      WHERE ${whereClause}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const queryResult = await this.query(sql, params);
    const files = queryResult.results || [];

    // 獲取搜尋結果總數
    const countSql = `
      SELECT COUNT(*) as total
      FROM ${DbTables.FILES} f
      WHERE ${whereClause}
    `;
    const countParams = params.slice(0, -2); // 移除limit和offset引數
    const countResult = await this.queryFirst(countSql, countParams);
    const total = countResult?.total || 0;

    return {
      files,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }
}
