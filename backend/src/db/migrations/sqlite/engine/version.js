// SQLite/D1 schema 版本號（邏輯版本）
// 說明：
// - `app-v01..app-vNN` 的 NN 上限來自這裡
// - 這裡的版本號用於“遷移編排”，不與具體資料庫方言強繫結

export const APP_SCHEMA_VERSION = 34;

// 相容命名：歷史程式碼中使用 DB_SCHEMA_VERSION
export const DB_SCHEMA_VERSION = APP_SCHEMA_VERSION;
