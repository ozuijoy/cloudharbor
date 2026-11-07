/**
 * 基礎Repository類
 * 提供通用的資料訪問方法，所有具體Repository繼承此類
 * 純粹的資料訪問，不包含業務邏輯
 */

import { ValidationError } from "../http/errors.js";
import { getDialect } from "../db/dialects/index.js";

export class BaseRepository {
  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項（D1/SQLiteAdapter/未來可擴充套件）
   * @param {object} [dialect] - 資料庫方言物件（用於多資料庫擴充套件）
   */
  constructor(db, dialect = null) {
    this.db = db;
    // KISS：dialect 必須可用，否則預設 sqlite（當前專案主執行形態）
    this.dialect = dialect || getDialect("sqlite");
  }

  /**
   * 構建“插入忽略衝突”的 SQL
   * - 用於替代散落的 INSERT OR IGNORE / INSERT IGNORE / ON CONFLICT DO NOTHING
   * @param {string} table
   * @param {string[]} columns
   */
  _buildInsertIgnoreSql(table, columns) {
    if (!this.dialect?.buildInsertIgnoreSql) {
      throw new ValidationError("當前資料庫方言未實現 buildInsertIgnoreSql");
    }
    return this.dialect.buildInsertIgnoreSql({ table, columns });
  }

  /**
   * 根據ID查詢記錄
   * @param {string} table - 表名
   * @param {string} id - 記錄ID
   * @returns {Promise<Object|null>} 記錄物件或null
   */
  async findById(table, id) {
    if (!id) return null;
    
    return await this.db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .bind(id)
      .first();
  }

  /**
   * 根據條件查詢單條記錄
   * @param {string} table - 表名
   * @param {Object} conditions - 查詢條件 {field: value}
   * @returns {Promise<Object|null>} 記錄物件或null
   */
  async findOne(table, conditions) {
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);
    
    if (fields.length === 0) return null;
    
    const whereClause = fields.map(field => `${field} = ?`).join(' AND ');
    
    return await this.db
      .prepare(`SELECT * FROM ${table} WHERE ${whereClause}`)
      .bind(...values)
      .first();
  }

  /**
   * 根據條件查詢多條記錄
   * @param {string} table - 表名
   * @param {Object} conditions - 查詢條件 {field: value}
   * @param {Object} options - 查詢選項 {orderBy, limit, offset}
   * @returns {Promise<Array>} 記錄陣列
   */
  async findMany(table, conditions = {}, options = {}) {
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);
    
    let sql = `SELECT * FROM ${table}`;
    
    if (fields.length > 0) {
      const whereClause = fields.map(field => `${field} = ?`).join(' AND ');
      sql += ` WHERE ${whereClause}`;
    }
    
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
    }
    
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
      if (options.offset) {
        sql += ` OFFSET ${options.offset}`;
      }
    }
    
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .all();
      
    return result.results || [];
  }

  /**
   * 建立記錄
   * @param {string} table - 表名
   * @param {Object} data - 資料物件
   * @returns {Promise<Object>} 執行結果
   */
  async create(table, data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    
    if (fields.length === 0) {
      throw new ValidationError('建立記錄時資料不能為空');
    }
    
    const fieldsClause = fields.join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    
    return await this.db
      .prepare(`INSERT INTO ${table} (${fieldsClause}) VALUES (${placeholders})`)
      .bind(...values)
      .run();
  }

  /**
   * 更新記錄
   * @param {string} table - 表名
   * @param {string} id - 記錄ID
   * @param {Object} data - 更新資料
   * @returns {Promise<Object>} 執行結果
   */
  async update(table, id, data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    
    if (fields.length === 0) {
      throw new ValidationError('更新記錄時資料不能為空');
    }
    
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    return await this.db
      .prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`)
      .bind(...values, id)
      .run();
  }

  /**
   * 刪除記錄
   * @param {string} table - 表名
   * @param {string} id - 記錄ID
   * @returns {Promise<Object>} 執行結果
   */
  async delete(table, id) {
    return await this.db
      .prepare(`DELETE FROM ${table} WHERE id = ?`)
      .bind(id)
      .run();
  }

  /**
   * 根據條件刪除記錄
   * @param {string} table - 表名
   * @param {Object} conditions - 刪除條件
   * @returns {Promise<Object>} 執行結果
   */
  async deleteWhere(table, conditions) {
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);
    
    if (fields.length === 0) {
      throw new ValidationError('刪除記錄時條件不能為空');
    }
    
    const whereClause = fields.map(field => `${field} = ?`).join(' AND ');
    
    return await this.db
      .prepare(`DELETE FROM ${table} WHERE ${whereClause}`)
      .bind(...values)
      .run();
  }

  /**
   * 計算記錄數量
   * @param {string} table - 表名
   * @param {Object} conditions - 查詢條件
   * @returns {Promise<number>} 記錄數量
   */
  async count(table, conditions = {}) {
    const fields = Object.keys(conditions);
    const values = Object.values(conditions);
    
    let sql = `SELECT COUNT(*) as count FROM ${table}`;
    
    if (fields.length > 0) {
      const whereClause = fields.map(field => `${field} = ?`).join(' AND ');
      sql += ` WHERE ${whereClause}`;
    }
    
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .first();
      
    return result?.count || 0;
  }

  /**
   * 檢查記錄是否存在
   * @param {string} table - 表名
   * @param {Object} conditions - 查詢條件
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(table, conditions) {
    const count = await this.count(table, conditions);
    return count > 0;
  }

  /**
   * 執行自定義SQL查詢
   * @param {string} sql - SQL語句
   * @param {Array} params - 引數陣列
   * @returns {Promise<Object>} 查詢結果
   */
  async query(sql, params = []) {
    return await this.db
      .prepare(sql)
      .bind(...params)
      .all();
  }

  /**
   * 執行自定義SQL查詢（單條記錄）
   * @param {string} sql - SQL語句
   * @param {Array} params - 引數陣列
   * @returns {Promise<Object|null>} 查詢結果
   */
  async queryFirst(sql, params = []) {
    return await this.db
      .prepare(sql)
      .bind(...params)
      .first();
  }

  /**
   * 執行自定義SQL（增刪改）
   * @param {string} sql - SQL語句
   * @param {Array} params - 引數陣列
   * @returns {Promise<Object>} 執行結果
   */
  async execute(sql, params = []) {
    return await this.db
      .prepare(sql)
      .bind(...params)
      .run();
  }
}
