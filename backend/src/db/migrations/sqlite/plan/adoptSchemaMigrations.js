import { DbTables } from "../../../../constants/index.js";
import {
  deleteLegacySchemaKeysFromSystemSettings,
  getExistingTableSet,
  getLegacySchemaVersionFromSystemSettings,
  looksLikeExistingDatabase,
  makeVersionMigrationId,
  markMigrationsApplied,
  APP_SCHEMA_VERSION,
  REQUIRED_TABLES,
} from "./adoptUtils.js";
import { initDatabase } from "../engine/initDatabase.js";

const ADOPT_ID = "app-adopt-schema-migrations";


export default {
  id: ADOPT_ID,
  async up({ db }) {
    const existingTables = await getExistingTableSet(db);
    const hasSystemSettings = existingTables.has(DbTables.SYSTEM_SETTINGS);

    // 若已執行過 adopt，則直接退出
    try {
      const already = await db.prepare(`SELECT 1 AS ok FROM schema_migrations WHERE id = ?`).bind(ADOPT_ID).first();
      if (already) return false;
    } catch {
      // schema_migrations 不存在時會由 runner 先建立；這裡忽略
    }

    // legacyVersion 僅用於“舊庫接管”：若舊庫有 schema_version，則按其版本上限預標記 app-v01..app-vN
    const legacyVersion = hasSystemSettings ? await getLegacySchemaVersionFromSystemSettings(db) : 0;

    // 新庫/缺表庫：直接建到最終態，然後 squash 標記 v01..vN
    let needsTablesCreation = false;
    for (const tableName of REQUIRED_TABLES) {
      if (!existingTables.has(tableName)) {
        needsTablesCreation = true;
        break;
      }
    }

    const isExistingDb = await looksLikeExistingDatabase(db, existingTables);

    // 執行時負責 schema + 預設設定/預設資料：
    // - 純新庫（無表） => needsTablesCreation=true
    // - 僅有 schema（例如用 schema.sql 手工建立了表，但無資料）=> isExistingDb=false
    // - 老庫（有業務資料）=> isExistingDb=true 且通常 needsTablesCreation=false
    if (needsTablesCreation || !isExistingDb) {
      await initDatabase(db);
    }

    // adopt 標記範圍：
    // - 舊庫：按 legacy schema_version（上限為當前應用版本）
    // - 新庫/缺表庫：按當前應用版本（已初始化到最終態）
    const capVersion =
      legacyVersion > 0
        ? Math.min(legacyVersion, APP_SCHEMA_VERSION)
        : needsTablesCreation || !isExistingDb
          ? APP_SCHEMA_VERSION
          : 0;

    if (capVersion <= 0) {
      // 極少數情況：老庫存在業務資料，但缺失 schema_version，無法安全推斷版本。
      // 這裡不做 squash 標記，避免錯誤接管。
      return false;
    }
    const ids = [];
    for (let v = 1; v <= capVersion; v++) {
      ids.push(makeVersionMigrationId(v));
    }

    await markMigrationsApplied(db, ids);

    if (hasSystemSettings) {
      await deleteLegacySchemaKeysFromSystemSettings(db);
    }

    return true;
  },
};
