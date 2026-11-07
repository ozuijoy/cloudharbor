/**
 * SQLite/D1 Provider
 * - 使用 schema_migrations + sqliteMigrations 作為“遷移器”
 * - 將初始化/遷移職責從入口檔案移入 provider，便於未來擴充套件 PG/MySQL
 */

import { sqliteDialect } from "../dialects/sqliteDialect.js";
import { applyMigrations } from "../migrations/runner.js";
import { sqliteMigrations } from "../migrations/sqlite/index.js";

export const sqliteProvider = {
  name: "sqlite",
  dialect: sqliteDialect,

  /**
   * 確保資料庫結構可用（初始化/遷移）
   * @param {{ db:any, dialect:any, env:any, providerName:string }} runtime
   */
  async ensureReady(runtime) {
    await applyMigrations(runtime, sqliteMigrations);
  },
};
