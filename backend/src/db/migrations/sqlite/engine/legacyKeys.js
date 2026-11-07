// legacy key：線上舊庫中曾用於儲存遷移後設資料的 system_settings.key
// 說明：當前主線以 schema_migrations（遷移執行歷史表）作為權威遷移狀態來源，
// 仍用這兩個 key 名從舊庫 system_settings 匯入/接管。

export const LEGACY_SCHEMA_VERSION_KEY = "schema_version";
export const LEGACY_DB_INITIALIZED_KEY = "db_initialized";

// 僅用於相容舊遷移邏輯的 legacy 表名
export const LegacyDbTables = {
  S3_CONFIGS: "s3_configs",
};

