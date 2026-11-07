// SQLiteAdapter - 在 Node/Docker 環境模擬 Cloudflare D1 介面的介面卡
// 僅在本地 / Docker 模式使用，Workers 環境直接使用 D1。

import sqlite3 from "sqlite3";
import { open } from "sqlite";

export class SQLiteAdapter {
  /**
   * @param {string} dbPath
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    await this.db.exec("PRAGMA busy_timeout = 5000;"); // 最多等 5 秒
    await this.db.exec("PRAGMA journal_mode = WAL;"); // 併發讀更友好
    await this.db.exec("PRAGMA synchronous = 1;"); // NORMAL
    await this.db.exec("PRAGMA foreign_keys = ON;");
    return this;
  }

  prepare(sql) {
    return {
      sql,
      params: [],
      _db: this.db,

      bind(...args) {
        this.params = args;
        return this;
      },

      async run() {
        const result = await this._db.run(this.sql, ...this.params);
        const changes =
          result && typeof result.changes === "number" ? result.changes : 0;
        return {
          success: true,
          changes,
          meta: { changes },
        };
      },

      async all() {
        const results = await this._db.all(this.sql, ...this.params);
        return { results };
      },

      async first() {
        return await this._db.get(this.sql, ...this.params);
      },
    };
  }

  async batch(statements) {
    await this.db.exec("BEGIN TRANSACTION");
    try {
      const results = [];
      for (const statement of statements) {
        if (typeof statement === "string") {
          const result = await this.db.exec(statement);
          results.push({ success: true, result });
        } else if (statement.sql && Array.isArray(statement.params)) {
          const result = await this.db.run(statement.sql, ...statement.params);
          results.push({ success: true, result });
        } else if (statement.sql && typeof statement.params === "undefined") {
          const result = await this.db.run(statement.sql);
          results.push({ success: true, result });
        } else if (statement.text || statement.sql) {
          const stmt = this.prepare(statement.text || statement.sql);
          if (statement.params) {
            stmt.bind(...statement.params);
          }
          const result = await stmt.run();
          results.push(result);
        }
      }
      await this.db.exec("COMMIT");
      return results;
    } catch (error) {
      await this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    return await this.db.exec(sql);
  }
}

/**
 * 工廠函式：建立並初始化 SQLiteAdapter 例項
 * @param {string} dbPath
 */
export async function createSQLiteAdapter(dbPath) {
  const adapter = new SQLiteAdapter(dbPath);
  await adapter.init();
  return adapter;
}
