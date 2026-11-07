/**
 * 通用儲存配置 Repository（基於 storage_configs + config_json）
 * - 統一從 storage_configs 讀取，驅動私有配置存於 config_json（JSON）
 * - 返回物件時展開常用欄位到頂層（endpoint_url/provider_type/bucket_name等）
 * - WithSecrets 版本才返回 access_key_id/secret_access_key/password
 */
import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";

export class StorageConfigRepository extends BaseRepository {
  /**
   * 通用展開方法
   * - 解析 config_json
   * - 委託 StorageFactory.projectConfig 完成型別特定的配置投影
   * - 將投影結果與行物件合併，並保留 __config_json__ 供上層複用
   * @param {object} row - 資料庫原始行
   * @param {object} options - 選項
   * @returns {object|null} 展開後的配置物件
   */
  _inflate(row, { withSecrets = false } = {}) {
    if (!row) return null;
    try {
      if (row.config_json) {
        const raw = row.config_json;
        const cfg = typeof raw === "string" ? JSON.parse(raw) : raw || {};

        const projected = StorageFactory.projectConfig(row.storage_type, cfg, {
          withSecrets,
          row,
        });

        // 注意：row（表欄位）優先順序應高於 config_json（投影欄位）
        const merged = {
          ...(projected && typeof projected === "object" ? projected : {}),
          ...row,
        };

        // 保留原始 config_json 物件（非列舉屬性，避免對外暴露）
        Object.defineProperty(merged, "__config_json__", {
          value: cfg,
          enumerable: false,
          configurable: false,
          writable: false,
        });
        delete merged.config_json;
        return merged;
      }
    } catch (error) {
      console.error("Failed to inflate storage config:", error);
    }
    const { config_json, ...rest } = row;
    return rest;
  }

  _inflateList(rows, { withSecrets = false } = {}) {
    return Array.isArray(rows) ? rows.map((r) => this._inflate(r, { withSecrets })) : [];
  }

  async findById(configId) {
    const row = await super.findById(DbTables.STORAGE_CONFIGS, configId);
    return this._inflate(row, { withSecrets: false });
  }

  async findByIdWithSecrets(configId) {
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE id = ?`, [configId]);
    return this._inflate(row, { withSecrets: true });
  }

  async findByAdmin(adminId) {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { admin_id: adminId }, { orderBy: "name ASC" });
    return this._inflateList(rows);
  }

  async findByAdminWithPagination(adminId, options = {}) {
    const { page = 1, limit = 10 } = options;
    const offset = (page - 1) * limit;
    const total = await this.count(DbTables.STORAGE_CONFIGS, { admin_id: adminId });
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { admin_id: adminId }, { orderBy: "name ASC", limit, offset });
    return {
      configs: this._inflateList(rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findDefault(options = {}) {
    const { requirePublic = false, adminId = null, withSecrets = false } = options;
    let sql = `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE is_default = 1`;
    const params = [];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    if (requirePublic) {
      sql += ` AND is_public = 1`;
    }
    sql += ` ORDER BY updated_at DESC LIMIT 1`;
    const row = await this.queryFirst(sql, params);
    return this._inflate(row, { withSecrets });
  }

  async findFirstPublic(options = {}) {
    const { withSecrets = false } = options;
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE is_public = 1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`);
    return this._inflate(row, { withSecrets });
  }

  async findByProviderType(providerType, adminId = null) {
    let sql = `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.provider_type') = ?`;
    const params = [providerType];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    sql += ` ORDER BY name ASC`;
    const res = await this.query(sql, params);
    return this._inflateList(res.results || []);
  }

  async createConfig(data) {
    const dataWithTimestamp = {
      ...data,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
    return await this.create(DbTables.STORAGE_CONFIGS, dataWithTimestamp);
  }

  async updateConfig(configId, updateData) {
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };
    return await this.update(DbTables.STORAGE_CONFIGS, configId, dataWithTimestamp);
  }

  async updateLastUsed(configId) {
    return await this.execute(`UPDATE ${DbTables.STORAGE_CONFIGS} SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [configId]);
  }

  async deleteConfig(configId) {
    return await this.delete(DbTables.STORAGE_CONFIGS, configId);
  }

  async existsByName(name, adminId, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.STORAGE_CONFIGS} WHERE name = ? AND admin_id = ? AND id != ?`, [name, adminId, excludeId]);
      return !!result;
    }
    return await this.exists(DbTables.STORAGE_CONFIGS, { name, admin_id: adminId });
  }

  async countByAdmin(adminId) {
    return await this.count(DbTables.STORAGE_CONFIGS, { admin_id: adminId });
  }

  async findAll() {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, {}, { orderBy: "admin_id ASC, name ASC" });
    return this._inflateList(rows);
  }

  async findByEndpoint(endpointUrl, adminId) {
    const res = await this.query(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE json_extract(config_json,'$.endpoint_url') = ? AND admin_id = ? ORDER BY name ASC`, [
      endpointUrl,
      adminId,
    ]);
    return this._inflateList(res.results || []);
  }

  async findByBucket(bucketName, adminId) {
    const res = await this.query(
      `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.bucket_name') = ? AND admin_id = ? ORDER BY name ASC`,
      [bucketName, adminId]
    );
    return this._inflateList(res.results || []);
  }

  async getStatistics(adminId = null) {
    const conditions = adminId ? { admin_id: adminId } : {};
    const total = await this.count(DbTables.STORAGE_CONFIGS, conditions);
    let sql = `
      SELECT json_extract(config_json,'$.provider_type') AS provider_type, COUNT(*) as count
      FROM ${DbTables.STORAGE_CONFIGS}
      WHERE storage_type='S3'
    `;
    const params = [];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    sql += ` GROUP BY provider_type`;
    const providerStats = await this.query(sql, params);
    return { total, byProvider: providerStats.results || [] };
  }

  async findRecentlyUsed(adminId, limit = 10) {
    const result = await this.query(
      `
      SELECT * FROM ${DbTables.STORAGE_CONFIGS}
      WHERE admin_id = ? AND last_used IS NOT NULL
      ORDER BY last_used DESC
      LIMIT ?
      `,
      [adminId, limit]
    );
    return this._inflateList(result.results || []);
  }

  async batchDelete(configIds) {
    if (!configIds || configIds.length === 0) {
      return { deletedCount: 0, message: "沒有要刪除的配置" };
    }
    const placeholders = configIds.map(() => "?").join(",");
    const result = await this.execute(`DELETE FROM ${DbTables.STORAGE_CONFIGS} WHERE id IN (${placeholders})`, configIds);
    return { deletedCount: result.meta?.changes || 0, message: `已刪除${result.meta?.changes || 0}個配置` };
  }

  async findByRegion(region, adminId) {
    const res = await this.query(
      `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.region') = ? AND admin_id = ? ORDER BY name ASC`,
      [region, adminId]
    );
    return this._inflateList(res.results || []);
  }

  async findByIdAndAdmin(configId, adminId) {
    const row = await this.findOne(DbTables.STORAGE_CONFIGS, { id: configId, admin_id: adminId });
    return this._inflate(row, { withSecrets: false });
  }

  async findByIdAndAdminWithSecrets(configId, adminId) {
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE id = ? AND admin_id = ?`, [configId, adminId]);
    return this._inflate(row, { withSecrets: true });
  }

  async findPublic() {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { is_public: 1 }, { orderBy: "name ASC" });
    return this._inflateList(rows);
  }

  async findPublicById(configId) {
    const row = await this.findOne(DbTables.STORAGE_CONFIGS, { id: configId, is_public: 1 });
    return this._inflate(row, { withSecrets: false });
  }

  async setAsDefault(configId, adminId) {
    await this.db.batch([
      this.db.prepare(`UPDATE ${DbTables.STORAGE_CONFIGS} SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE admin_id = ?`).bind(adminId),
      this.db.prepare(`UPDATE ${DbTables.STORAGE_CONFIGS} SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(configId),
    ]);
  }
}
