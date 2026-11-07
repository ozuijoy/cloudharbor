import { DbTables } from "../../../../constants/index.js";
import { LegacyDbTables } from "./legacyKeys.js";
import { StorageFactory } from "../../../../storage/factory/StorageFactory.js";
import { toBool } from "../../../../utils/environmentUtils.js";
import {
  createFsMetaTables,
  createFsSearchIndexTables,
  createScheduledJobRunsTables,
  createScheduledJobsTables,
  createTasksTables,
  createUploadPartsTables,
  createUploadSessionsTables,
  createVfsTables,
  createMetricsCacheTables,
} from "./schema.js";
import {
  addCustomContentSettings,
  addFileNamingStrategySetting,
  addPreviewSettings,
  resetPreviewProvidersDefaults,
  addSiteSettings,
  createDefaultGuestApiKey,
} from "./seed.js";

/**
 * SQLite/D1 遷移輔助函式（legacy）
 *
 */

function getBooleanFieldNamesFromStorageSchema(storageType) {
  if (!storageType) return [];
  const meta = StorageFactory.getTypeMetadata(storageType);
  const fields = meta?.configSchema?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && typeof f === "object" && typeof f.name === "string" && (f.type === "boolean" || f.type === "bool"))
    .map((f) => f.name)
    .filter(Boolean);
}

function coerceConfigJsonBooleans(storageType, configJsonObj) {
  if (!configJsonObj || typeof configJsonObj !== "object") {
    return { changed: false, next: configJsonObj };
  }
  const boolKeys = getBooleanFieldNamesFromStorageSchema(storageType);
  if (!boolKeys.length) {
    return { changed: false, next: configJsonObj };
  }

  let changed = false;
  for (const key of boolKeys) {
    if (!Object.prototype.hasOwnProperty.call(configJsonObj, key)) continue;
    const raw = configJsonObj[key];
    if (raw === undefined || raw === null) continue;
    const nextVal = toBool(raw, false) ? 1 : 0;
    if (configJsonObj[key] !== nextVal) {
      configJsonObj[key] = nextVal;
      changed = true;
    }
  }

  return { changed, next: configJsonObj };
}

async function normalizeStorageConfigsBooleanFields(db) {
  console.log("版本34：開始歸一化 storage_configs.config_json 中的布林欄位（統一為 0/1）...");

  let rows = [];
  try {
    const res = await db
      .prepare(`SELECT id, storage_type, config_json FROM ${DbTables.STORAGE_CONFIGS} ORDER BY updated_at DESC`)
      .all();
    rows = Array.isArray(res?.results) ? res.results : [];
  } catch (e) {
    console.warn("版本34：讀取 storage_configs 失敗，跳過布林欄位歸一化：", e?.message || e);
    return { total: 0, updated: 0, failed: 0, skipped: 0 };
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const id = row?.id ? String(row.id) : "";
    const storageType = row?.storage_type ? String(row.storage_type) : "";
    const rawJson = row?.config_json;
    if (!id || !storageType || !rawJson) {
      skipped += 1;
      continue;
    }

    let cfgObj;
    try {
      cfgObj = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
    } catch {
      failed += 1;
      continue;
    }

    const { changed, next } = coerceConfigJsonBooleans(storageType, cfgObj);
    if (!changed) {
      skipped += 1;
      continue;
    }

    try {
      await db
        .prepare(`UPDATE ${DbTables.STORAGE_CONFIGS} SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(JSON.stringify(next), id)
        .run();
      updated += 1;
    } catch (e) {
      failed += 1;
      console.warn("版本34：歸一化 storage_config 失敗：", { id, storageType, error: e?.message || e });
    }
  }

  console.log("版本34：storage_configs 布林欄位歸一化完成：", { total: rows.length, updated, skipped, failed });
  return { total: rows.length, updated, skipped, failed };
}

export async function addTableField(db, tableName, fieldName, fieldDefinition) {
  try {
    const columnInfo = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    const fieldExists = columnInfo.results.some((column) => column.name === fieldName);

    if (!fieldExists) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${fieldDefinition}`).run();
      console.log(`成功新增${fieldName}欄位到${tableName}表`);
    } else {
      console.log(`${tableName}表已存在${fieldName}欄位，跳過新增`);
    }
  } catch (error) {
    console.error(`新增${fieldName}欄位到${tableName}表時出錯:`, error);
    console.log(`將繼續執行遷移過程，但請手動檢查${tableName}表結構`);
  }
}

export async function removeTableField(db, tableName, fieldName) {
  try {
    const columnInfo = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    const fieldExists = columnInfo.results.some((column) => column.name === fieldName);

    if (fieldExists) {
      console.log(`檢測到${fieldName}欄位，嘗試使用現代SQLite語法刪除...`);
      await db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${fieldName}`).run();
      console.log(`${fieldName}欄位刪除成功`);
    } else {
      console.log(`${fieldName}欄位不存在，跳過刪除`);
    }
  } catch (error) {
    console.log(`現代SQLite語法刪除失敗，可能是版本不支援: ${error.message}`);
    console.log("該欄位將在程式碼中被忽略，資料庫結構保持不變以確保安全");
  }
}

export async function migrateFilesTableToMultiStorage(db) {
  console.log("開始遷移files表到多儲存型別支援...");

  // 注意：該遷移原實現會重建 files 表（對存量資料有影響）。
  // 這裡保留原邏輯，僅在版本升級路徑中呼叫。
  try {
    const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.FILES})`).all();
    const existingColumns = new Set(columnInfo.results.map((col) => col.name));

    const hasOldField = existingColumns.has("s3_config_id");
    const hasNewField = existingColumns.has("storage_config_id");

    console.log(`表結構檢查: s3_config_id=${hasOldField}, storage_config_id=${hasNewField}`);

    if (!hasNewField) {
      console.log("新增新欄位...");
      await addTableField(db, DbTables.FILES, "storage_config_id", "storage_config_id TEXT");
      await addTableField(db, DbTables.FILES, "storage_type", "storage_type TEXT");
      await addTableField(db, DbTables.FILES, "file_path", "file_path TEXT");
    }

    if (hasOldField) {
      console.log("開始遷移資料...");

      const updateResult = await db
        .prepare(
          `UPDATE ${DbTables.FILES}
           SET storage_config_id = s3_config_id, storage_type = 'S3'
           WHERE s3_config_id IS NOT NULL
             AND (storage_config_id IS NULL OR storage_type IS NULL)`,
        )
        .run();

      console.log(`成功遷移 ${updateResult.changes || 0} 條files記錄`);
    }

    console.log("重建表結構，確保最終結構正確...");
    await rebuildFilesTable(db);

    console.log("files表遷移完成");
  } catch (error) {
    console.error("遷移files表時出錯:", error);
    throw error;
  }
}

export async function rebuildFilesTable(db) {
  console.log("開始重建files表結構...");

  await db
    .prepare(
      `CREATE TABLE ${DbTables.FILES}_new (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        storage_config_id TEXT NOT NULL,
        storage_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        file_path TEXT,
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        etag TEXT,
        remark TEXT,
        password TEXT,
        expires_at DATETIME,
        max_views INTEGER,
        views INTEGER DEFAULT 0,
        use_proxy BOOLEAN DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO ${DbTables.FILES}_new
       SELECT id, slug, filename, storage_config_id, storage_type, storage_path, file_path,
              mimetype, size, etag, remark, password, expires_at, max_views, views, use_proxy,
              created_by, created_at, updated_at
       FROM ${DbTables.FILES}
       WHERE storage_config_id IS NOT NULL AND storage_config_id != ''`,
    )
    .run();

  await db.prepare(`DROP TABLE ${DbTables.FILES}`).run();
  await db.prepare(`ALTER TABLE ${DbTables.FILES}_new RENAME TO ${DbTables.FILES}`).run();

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_slug ON ${DbTables.FILES}(slug)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_config_id ON ${DbTables.FILES}(storage_config_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_type ON ${DbTables.FILES}(storage_type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_file_path ON ${DbTables.FILES}(file_path)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON ${DbTables.FILES}(created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_expires_at ON ${DbTables.FILES}(expires_at)`).run();

  console.log("成功重建files表結構");
}

export async function migrateToBitFlagPermissions(db) {
  console.log("開始位標誌許可權系統遷移...");

  try {
    const existingKeys = await db.prepare(`SELECT * FROM ${DbTables.API_KEYS}`).all();
    console.log(`找到 ${existingKeys.results?.length || 0} 條現有API金鑰記錄`);

    const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.API_KEYS})`).all();
    const existingColumns = new Set(columnInfo.results.map((col) => col.name));

    if (
      !existingColumns.has("permissions") ||
      !existingColumns.has("role") ||
      (!existingColumns.has("is_enable") && !existingColumns.has("is_guest"))
    ) {
      console.log("檢測到需要完整的表結構遷移");

      await db
        .prepare(
          `CREATE TABLE ${DbTables.API_KEYS}_new (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          key TEXT UNIQUE NOT NULL,
          permissions INTEGER DEFAULT 0,
          role TEXT DEFAULT 'GENERAL',
          basic_path TEXT DEFAULT '/',
          is_enable BOOLEAN DEFAULT 0,
          last_used DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL
        )`,
        )
        .run();

      if (existingKeys.results && existingKeys.results.length > 0) {
        for (const keyRecord of existingKeys.results) {
          let permissions = 0;

          if (keyRecord.text_permission === 1) permissions |= 1;
          if (keyRecord.file_permission === 1) permissions |= 2;
          if (keyRecord.mount_permission === 1) permissions |= 256 | 512 | 1024 | 2048 | 4096;

          const role = permissions === 256 ? "GUEST" : "GENERAL";

          await db
            .prepare(
              `INSERT INTO ${DbTables.API_KEYS}_new
             (id, name, key, permissions, role, basic_path, is_enable, last_used, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              keyRecord.id,
              keyRecord.name,
              keyRecord.key,
              permissions,
              role,
              keyRecord.basic_path || "/",
              0,
              keyRecord.last_used,
              keyRecord.created_at,
              keyRecord.expires_at,
            )
            .run();
        }
      }

      await db.prepare(`DROP TABLE ${DbTables.API_KEYS}`).run();
      await db.prepare(`ALTER TABLE ${DbTables.API_KEYS}_new RENAME TO ${DbTables.API_KEYS}`).run();

      console.log("api_keys表結構遷移完成");
    }
  } catch (error) {
    console.error("位標誌許可權系統遷移失敗:", error);
  }
}

export async function migrateSystemSettingsStructure(db) {
  console.log("開始系統設定架構重構遷移...");

  const newFields = [
    { name: "type", sql: "ALTER TABLE system_settings ADD COLUMN type TEXT DEFAULT 'text'" },
    { name: "group_id", sql: "ALTER TABLE system_settings ADD COLUMN group_id INTEGER DEFAULT 1" },
    { name: "options", sql: "ALTER TABLE system_settings ADD COLUMN options TEXT" },
    { name: "sort_order", sql: "ALTER TABLE system_settings ADD COLUMN sort_order INTEGER DEFAULT 0" },
    { name: "flags", sql: "ALTER TABLE system_settings ADD COLUMN flags INTEGER DEFAULT 0" },
  ];

  const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.SYSTEM_SETTINGS})`).all();
  const existingColumns = new Set(columnInfo.results.map((col) => col.name));

  for (const field of newFields) {
    if (!existingColumns.has(field.name)) {
      try {
        await db.prepare(field.sql).run();
        console.log(`成功新增欄位: ${field.name}`);
      } catch (error) {
        console.error(`新增欄位 ${field.name} 失敗:`, error);
      }
    }
  }
}

export async function migrateWebDavUploadModeToSingleChunked(db) {
  console.log("開始遷移 webdav_upload_mode 設定到 single/chunked...");

  try {
    const row = await db.prepare(`SELECT key, value, options FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind("webdav_upload_mode").first();

    if (!row) {
      console.log("未找到 webdav_upload_mode 設定，跳過遷移");
      return;
    }

    let value = row.value;
    if (value === "direct" || value === "stream") {
      value = "single";
    } else if (value === "multipart") {
      value = "chunked";
    }

    const options = JSON.stringify([
      { value: "chunked", label: "流式上傳" },
      { value: "single", label: "單次上傳" },
    ]);

    const now = new Date().toISOString();

    await db
      .prepare(
        `UPDATE ${DbTables.SYSTEM_SETTINGS}
         SET value = ?, options = ?, updated_at = ?
         WHERE key = 'webdav_upload_mode'`,
      )
      .bind(value, options, now)
      .run();

    console.log("webdav_upload_mode 設定遷移完成:", value);
  } catch (error) {
    console.error("遷移 webdav_upload_mode 設定失敗:", error);
  }
}

export async function normalizeWebDavUploadModeLabels(db) {
  try {
    const row = await db.prepare(`SELECT key, value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind("webdav_upload_mode").first();

    if (!row) {
      console.log("normalizeWebDavUploadModeLabels: 未找到 webdav_upload_mode 設定，跳過更新");
      return;
    }

    const options = JSON.stringify([
      { value: "chunked", label: "流式上傳" },
      { value: "single", label: "單次上傳" },
    ]);

    const description = "WebDAV 客戶端上傳模式。流式上傳大檔案，單次上傳適合小檔案或相容性場景。";
    const now = new Date().toISOString();

    await db
      .prepare(
        `UPDATE ${DbTables.SYSTEM_SETTINGS}
         SET description = ?, options = ?, updated_at = ?
         WHERE key = 'webdav_upload_mode'`,
      )
      .bind(description, options, now)
      .run();

    console.log("normalizeWebDavUploadModeLabels: 已更新 webdav_upload_mode 顯示配置");
  } catch (error) {
    console.error("normalizeWebDavUploadModeLabels: 更新 webdav_upload_mode 顯示配置失敗:", error);
  }
}

export async function migrateFilesUseProxyDefault(db) {
  console.log("開始修改files表的use_proxy預設值...");
  console.log("files表use_proxy預設值已在表建立時設定為0");
}

export async function migrateApiKeysIsGuestToIsEnable(db) {
  console.log("開始遷移 api_keys 表的 is_guest -> is_enable...");

  const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.API_KEYS})`).all();
  const existingColumns = new Set(columnInfo.results.map((col) => col.name));

  const hasIsGuest = existingColumns.has("is_guest");
  const hasIsEnable = existingColumns.has("is_enable");

  if (!hasIsGuest && !hasIsEnable) {
    console.log("api_keys 表不存在 is_guest / is_enable 欄位，跳過遷移");
    return;
  }

  if (hasIsGuest && !hasIsEnable) {
    try {
      console.log("檢測到僅存在 is_guest，嘗試重新命名為 is_enable...");
      await db.prepare(`ALTER TABLE ${DbTables.API_KEYS} RENAME COLUMN is_guest TO is_enable`).run();
      console.log("成功將 is_guest 列重新命名為 is_enable");
      return;
    } catch (error) {
      console.warn("重新命名 is_guest -> is_enable 失敗，將使用新增列 + 複製資料方案：", error);

      await db.prepare(`ALTER TABLE ${DbTables.API_KEYS} ADD COLUMN is_enable BOOLEAN DEFAULT 0`).run();
      await db.prepare(`UPDATE ${DbTables.API_KEYS} SET is_enable = COALESCE(is_guest, 0)`).run();

      try {
        await removeTableField(db, DbTables.API_KEYS, "is_guest");
      } catch (dropError) {
        console.warn("刪除 is_guest 列失敗，將保留舊列但在程式碼中忽略：", dropError);
      }
      return;
    }
  }

  if (hasIsGuest && hasIsEnable) {
    console.log("檢測到同時存在 is_guest 和 is_enable，使用 is_guest 覆蓋 is_enable...");
    await db
      .prepare(`UPDATE ${DbTables.API_KEYS} SET is_enable = COALESCE(is_guest, is_enable, 0)`)
      .run()
      .catch((error) => {
        console.error("同步 is_guest 到 is_enable 時出錯：", error);
      });

    try {
      await removeTableField(db, DbTables.API_KEYS, "is_guest");
    } catch (dropError) {
      console.warn("刪除 is_guest 列失敗，將保留舊列但在程式碼中忽略：", dropError);
    }
    return;
  }

  if (!hasIsGuest && hasIsEnable) {
    console.log("api_keys 已使用 is_enable 列，不需要遷移 is_guest");
  }
}

export async function runLegacyMigrationByVersion(db, version) {
  switch (version) {
    case 1:
    case 2:
    case 3:
      break;

    case 4:
      await addTableField(db, DbTables.API_KEYS, "mount_permission", "mount_permission BOOLEAN DEFAULT 0");
      break;

    case 5:
      await addTableField(db, DbTables.API_KEYS, "basic_path", "basic_path TEXT DEFAULT '/'");
      break;

    case 6:
      await addTableField(db, LegacyDbTables.S3_CONFIGS, "custom_host", "custom_host TEXT");
      await addTableField(db, LegacyDbTables.S3_CONFIGS, "signature_expires_in", "signature_expires_in INTEGER DEFAULT 3600");
      break;

    case 7:
      await removeTableField(db, LegacyDbTables.S3_CONFIGS, "custom_host_signature");
      break;

    case 8:
      await addTableField(db, DbTables.STORAGE_MOUNTS, "web_proxy", "web_proxy BOOLEAN DEFAULT 0");
      await addTableField(db, DbTables.STORAGE_MOUNTS, "webdav_policy", "webdav_policy TEXT DEFAULT '302_redirect'");
      break;

    case 9:
      await migrateFilesTableToMultiStorage(db);
      break;

    case 10:
      await migrateToBitFlagPermissions(db);
      break;

    case 11:
      await addTableField(db, DbTables.STORAGE_MOUNTS, "enable_sign", "enable_sign BOOLEAN DEFAULT 0");
      await addTableField(db, DbTables.STORAGE_MOUNTS, "sign_expires", "sign_expires INTEGER DEFAULT NULL");
      break;

    case 12:
      await migrateSystemSettingsStructure(db);
      break;

    case 13:
      await addPreviewSettings(db);
      break;

    case 14:
      await migrateFilesUseProxyDefault(db);
      break;

    case 15:
      await addFileNamingStrategySetting(db);
      break;

    case 16:
      await addSiteSettings(db);
      break;

    case 17:
      await addCustomContentSettings(db);
      break;

    case 18: {
      console.log("版本18：建立 storage_configs 表並遷移 s3_configs 資料...");

      await db
        .prepare(
          `
          CREATE TABLE IF NOT EXISTS ${DbTables.STORAGE_CONFIGS} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            storage_type TEXT NOT NULL,
            admin_id TEXT,
            is_public INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0,
            remark TEXT,
            status TEXT NOT NULL DEFAULT 'ENABLED',
            config_json TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME
          )
        `,
        )
        .run();

      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_admin ON ${DbTables.STORAGE_CONFIGS}(admin_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_type ON ${DbTables.STORAGE_CONFIGS}(storage_type)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_public ON ${DbTables.STORAGE_CONFIGS}(is_public)`).run();
      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_default_per_admin
           ON ${DbTables.STORAGE_CONFIGS}(admin_id)
           WHERE is_default = 1`,
        )
        .run();

      await db
        .prepare(
          `
          INSERT OR IGNORE INTO ${DbTables.STORAGE_CONFIGS} (
            id, name, storage_type, admin_id, is_public, is_default, remark, status,
            config_json, created_at, updated_at, last_used
          )
          SELECT
            s.id,
            s.name,
            'S3' AS storage_type,
            s.admin_id,
            COALESCE(s.is_public, 0),
            COALESCE(s.is_default, 0),
            NULL AS remark,
            'ENABLED' AS status,
            json_object(
              'provider_type', s.provider_type,
              'endpoint_url', s.endpoint_url,
              'bucket_name', s.bucket_name,
              'region', s.region,
              'path_style', s.path_style,
              'default_folder', s.default_folder,
              'custom_host', s.custom_host,
              'signature_expires_in', s.signature_expires_in,
              'total_storage_bytes', s.total_storage_bytes,
              'access_key_id', s.access_key_id,
              'secret_access_key', s.secret_access_key
            ) AS config_json,
            s.created_at,
            s.updated_at,
            s.last_used
          FROM ${LegacyDbTables.S3_CONFIGS} s
          WHERE NOT EXISTS (
            SELECT 1 FROM ${DbTables.STORAGE_CONFIGS} t WHERE t.id = s.id
          )
        `,
        )
        .run()
        .catch((error) => {
          // 相容：若舊庫中不存在 s3_configs（或已清理），跳過資料遷移但保留新表結構。
          // 這能避免“全新庫/已升級庫”在誤觸發舊遷移時直接失敗。
          console.warn("版本18：遷移 s3_configs -> storage_configs 失敗，將跳過資料遷移：", error?.message || error);
        });

      console.log("版本18：storage_configs 表與資料遷移完成。");
      break;
    }

    case 19:
      console.log("版本19：檢查並建立 principal_storage_acl 表...");

      await db
        .prepare(
          `
          CREATE TABLE IF NOT EXISTS ${DbTables.PRINCIPAL_STORAGE_ACL} (
            subject_type TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            storage_config_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (subject_type, subject_id, storage_config_id)
          )
        `,
        )
        .run();

      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_psa_storage_config_id ON ${DbTables.PRINCIPAL_STORAGE_ACL}(storage_config_id)`).run();

      console.log("版本19：principal_storage_acl 表檢查/建立完成。");
      break;

    case 20:
      console.log("版本20：檢查並遷移 api_keys.is_guest -> is_enable...");
      await migrateApiKeysIsGuestToIsEnable(db);
      console.log("版本20：api_keys 啟用位(is_enable) 遷移完成。");

      console.log("版本20：檢查並建立預設遊客 API 金鑰...");
      await createDefaultGuestApiKey(db);
      console.log("版本20：預設遊客 API 金鑰檢查/建立完成。");
      break;

    case 21:
      console.log("版本21：為 pastes 表新增 title 和 is_public 欄位...");
      await addTableField(db, DbTables.PASTES, "title", "title TEXT");
      await addTableField(db, DbTables.PASTES, "is_public", "is_public BOOLEAN NOT NULL DEFAULT 1");
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pastes_is_public ON ${DbTables.PASTES}(is_public)`).run();
      console.log("版本21：pastes 表 title / is_public 欄位與索引檢查/建立完成。");

      console.log("版本21：檢查並建立 fs_meta 目錄 Meta 表...");
      await createFsMetaTables(db);
      console.log("版本21：fs_meta 表及其索引檢查/建立完成。");
      break;

    case 22:
      console.log("版本22：遷移 webdav_upload_mode 設定到 single/chunked...");
      await migrateWebDavUploadModeToSingleChunked(db);
      break;

    case 23:
      console.log("版本23：檢查並補充 preview_providers 預覽規則配置...");
      await addPreviewSettings(db);
      console.log("版本23：preview_providers 配置檢查/建立完成。");
      console.log("版本23：更新 webdav_upload_mode 顯示選項為“流式上傳/單次上傳”...");
      await normalizeWebDavUploadModeLabels(db);
      console.log("版本23：webdav_upload_mode 選項更新完成。");
      break;

    case 24:
      console.log("版本24：為 storage_configs 表新增 url_proxy 欄位...");
      await addTableField(db, DbTables.STORAGE_CONFIGS, "url_proxy", "url_proxy TEXT");
      console.log("版本24：storage_configs.url_proxy 欄位檢查/建立完成。");
      break;

    case 25:
      console.log("版本25：檢查並建立 tasks 表...");
      await createTasksTables(db);
      console.log("版本25：tasks 表及索引建立完成。");
      break;

    case 26:
      console.log("版本26：檢查並建立 upload_sessions 表...");
      await createUploadSessionsTables(db);
      console.log("版本26：upload_sessions 表及索引檢查/建立完成。");
      break;

    case 27:
      console.log("版本27：檢查並建立 scheduled_jobs，scheduled_job_runs 表...");
      await createScheduledJobsTables(db);
      await createScheduledJobRunsTables(db);
      console.log("版本27：scheduled_jobs，scheduled_job_runs 表及索引檢查/建立完成。");
      break;

    case 28:
      console.log("版本28：檢查並建立 FS 搜尋索引表（FTS5 trigram）...");
      await createFsSearchIndexTables(db);
      console.log("版本28：FS 搜尋索引表檢查/建立完成。");
      break;

    case 29:
      console.log("版本29：為 tasks 表新增 trigger_type / trigger_ref 欄位...");
      await addTableField(db, DbTables.TASKS, "trigger_type", "trigger_type TEXT NOT NULL DEFAULT 'manual'");
      await addTableField(db, DbTables.TASKS, "trigger_ref", "trigger_ref TEXT");
      console.log("版本29：tasks.trigger_type / trigger_ref 欄位檢查/建立完成。");
      break;

    case 30:
      console.log("版本30：為 storage_mounts 表新增 enable_folder_summary_compute 欄位...");
      await addTableField(
        db,
        DbTables.STORAGE_MOUNTS,
        "enable_folder_summary_compute",
        "enable_folder_summary_compute BOOLEAN DEFAULT 0",
      );
      console.log("版本30：storage_mounts.enable_folder_summary_compute 欄位檢查/建立完成。");
      break;

    case 31:
      console.log("版本31：重置 preview_providers 預設規則...");
      await resetPreviewProvidersDefaults(db);
      console.log("版本31：preview_providers 預設規則重置完成。");
      break;

    case 32:
      console.log("版本32：檢查並建立 vfs_nodes 與 upload_parts 表...");
      await createVfsTables(db);
      await createUploadPartsTables(db);
      console.log("版本32：vfs_nodes 與 upload_parts 表檢查/建立完成。");
      break;

    case 33:
      console.log("版本33：統一 upload_sessions.status 狀態值（active -> initiated/uploading）...");
      try {
        const result = await db
          .prepare(
            `UPDATE ${DbTables.UPLOAD_SESSIONS}
             SET status = CASE
               WHEN (bytes_uploaded > 0)
                 OR (uploaded_parts > 0)
                 OR (next_expected_range IS NOT NULL AND next_expected_range != '')
               THEN 'uploading'
               ELSE 'initiated'
             END
             WHERE status = 'active'`,
          )
          .run();

        console.log("版本33：upload_sessions.status 遷移完成", {
          changes: result?.changes ?? result?.meta?.changes ?? 0,
        });
      } catch (error) {
        console.warn("版本33：upload_sessions.status 遷移失敗（可忽略，將由新程式碼覆蓋舊狀態）:", error?.message || error);
      }
      break;

    case 34: {
      console.log("版本34：新增 metrics_cache（用量快照快取）+ 預設快照重新整理任務...");
      try {
        await createMetricsCacheTables(db);
      } catch (e) {
        console.warn("版本34：建立 metrics_cache 失敗（可忽略，後續會再次嘗試）:", e?.message || e);
      }
      try {
        const intervalSec = 6 * 60 * 60;
        const nextRunAfterIso = new Date(Date.now() + intervalSec * 1000).toISOString();
        await db
          .prepare(
            `
            INSERT INTO ${DbTables.SCHEDULED_JOBS} (task_id, handler_id, name, description, enabled, schedule_type, interval_sec, next_run_after, config_json)
            SELECT ?, ?, ?, ?, 1, 'interval', ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?
            )
          `,
          )
          .bind(
            "refresh_storage_usage_snapshots",
            "refresh_storage_usage_snapshots",
            "重新整理儲存用量快照（預設）",
            "定期重新整理儲存用量資料（已用/總量）。用於上傳容量限制判斷與管理端展示。",
            intervalSec,
            nextRunAfterIso,
            JSON.stringify({ maxItems: 50, maxConcurrency: 1 }),
            "refresh_storage_usage_snapshots",
          )
          .run();
      } catch (e) {
          console.warn("版本34：寫入預設 refresh_storage_usage_snapshots 任務失敗（可忽略）:", e?.message || e);
        }

      // 歸一化 storage_configs.config_json 中的布林欄位（統一為 0/1）
      try {
        await normalizeStorageConfigsBooleanFields(db);
      } catch (e) {
        console.warn("版本34：歸一化 storage_configs 布林欄位失敗（可忽略，將由後續儲存配置逐步修復）：", e?.message || e);
      }

      break;
    }

    default:
      console.log(`未知的遷移版本: ${version}`);
      break;
  }
}

export default {
  addTableField,
  removeTableField,
  migrateFilesTableToMultiStorage,
  rebuildFilesTable,
  migrateToBitFlagPermissions,
  migrateSystemSettingsStructure,
  migrateWebDavUploadModeToSingleChunked,
  normalizeWebDavUploadModeLabels,
  migrateFilesUseProxyDefault,
  migrateApiKeysIsGuestToIsEnable,
  runLegacyMigrationByVersion,
};
