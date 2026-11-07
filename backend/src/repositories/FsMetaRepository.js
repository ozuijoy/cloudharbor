/**
 * FsMetaRepository
 * 負責 fs_meta 目錄元資訊表的持久化訪問
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class FsMetaRepository extends BaseRepository {
  /**
   * 根據單一路徑獲取 Meta 記錄
   * @param {string} path
   * @returns {Promise<Object|null>}
   */
  async findByPath(path) {
    if (!path) {
      return null;
    }
    return await this.findOne(DbTables.FS_META, { path });
  }

  /**
   * 根據多條路徑批次獲取 Meta 記錄
   * @param {string[]} paths
   * @returns {Promise<Object[]>}
   */
  async findByPaths(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
      return [];
    }

    // 為相容早期儲存的帶尾部斜槓路徑，這裡同時匹配規範路徑和“規範路徑+/'”兩種形式
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (uniquePaths.length === 0) {
      return [];
    }

    /** @type {string[]} */
    const expandedPaths = [];
    const seen = new Set();
    for (const p of uniquePaths) {
      if (!seen.has(p)) {
        expandedPaths.push(p);
        seen.add(p);
      }
      if (p !== "/" && !p.endsWith("/")) {
        const withSlash = `${p}/`;
        if (!seen.has(withSlash)) {
          expandedPaths.push(withSlash);
          seen.add(withSlash);
        }
      }
    }

    const placeholders = expandedPaths.map(() => "?").join(",");
    const sql = `SELECT * FROM ${DbTables.FS_META} WHERE path IN (${placeholders})`;
    const result = await this.query(sql, expandedPaths);
    return result.results || [];
  }

  /**
   * 獲取所有 Meta 記錄
   * @returns {Promise<Object[]>}
   */
  async findAll() {
    const sql = `SELECT * FROM ${DbTables.FS_META} ORDER BY path ASC`;
    const result = await this.query(sql);
    return result.results || [];
  }

  /**
   * 根據 ID 獲取 Meta 記錄
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return await this.findOne(DbTables.FS_META, { id });
  }

  /**
   * 建立 Meta 記錄
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const now = new Date().toISOString();
    const record = {
      path: data.path,
      header_markdown: data.header_markdown || null,
      header_inherit: data.header_inherit ? 1 : 0,
      footer_markdown: data.footer_markdown || null,
      footer_inherit: data.footer_inherit ? 1 : 0,
      hide_patterns: data.hide_patterns || null,
      hide_inherit: data.hide_inherit ? 1 : 0,
      password: data.password || null,
      password_inherit: data.password_inherit ? 1 : 0,
      extra: data.extra || null,
      created_at: now,
      updated_at: now,
    };

    // 使用基礎倉儲的 create 方法執行插入
    return await super.create(DbTables.FS_META, record);
  }

  /**
   * 更新 Meta 記錄
   * @param {number} id
   * @param {Object} data
   * @returns {Promise<void>}
   */
  async update(id, data) {
    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (data.path !== undefined) updates.path = data.path;
    if (data.header_markdown !== undefined) updates.header_markdown = data.header_markdown;
    if (data.header_inherit !== undefined) updates.header_inherit = data.header_inherit ? 1 : 0;
    if (data.footer_markdown !== undefined) updates.footer_markdown = data.footer_markdown;
    if (data.footer_inherit !== undefined) updates.footer_inherit = data.footer_inherit ? 1 : 0;
    if (data.hide_patterns !== undefined) updates.hide_patterns = data.hide_patterns;
    if (data.hide_inherit !== undefined) updates.hide_inherit = data.hide_inherit ? 1 : 0;
    if (data.password !== undefined) updates.password = data.password;
    if (data.password_inherit !== undefined) updates.password_inherit = data.password_inherit ? 1 : 0;
    if (data.extra !== undefined) updates.extra = data.extra;

    // 使用基礎倉儲的 update 方法按主鍵更新
    await super.update(DbTables.FS_META, id, updates);
  }

  /**
   * 刪除 Meta 記錄
   * @param {number} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    // 使用基礎倉儲的 delete 方法按主鍵刪除
    await super.delete(DbTables.FS_META, id);
  }
}
