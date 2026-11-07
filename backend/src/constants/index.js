/**
 * 常量定義檔案
 */

// 資料庫表名常量
export const DbTables = {
  ADMINS: "admins", // 管理員表
  ADMIN_TOKENS: "admin_tokens", // 管理員令牌表
  PASTES: "pastes", // 文字表
  API_KEYS: "api_keys", // API金鑰表
  STORAGE_CONFIGS: "storage_configs", // 通用"儲存配置表"
  PRINCIPAL_STORAGE_ACL: "principal_storage_acl", // 主體 -> 儲存配置 ACL 表
  FILES: "files", // 檔案表
  FILE_PASSWORDS: "file_passwords", // 檔案明文密碼錶
  SYSTEM_SETTINGS: "system_settings", // 系統設定表
  PASTE_PASSWORDS: "paste_passwords", // 文字密碼錶
  STORAGE_MOUNTS: "storage_mounts", // 儲存掛載表
  FS_META: "fs_meta", // 目錄 Meta 配置表
  FS_SEARCH_INDEX_ENTRIES: "fs_search_index_entries", // FS 搜尋索引（條目表，派生資料）
  FS_SEARCH_INDEX_STATE: "fs_search_index_state", // FS 搜尋索引（狀態表，派生資料）
  FS_SEARCH_INDEX_FTS: "fs_search_index_fts", // FS 搜尋索引（FTS5 虛表，派生資料）
  FS_SEARCH_INDEX_DIRTY: "fs_search_index_dirty", // FS 搜尋索引（dirty 佇列表，派生資料）
  METRICS_CACHE: "metrics_cache", // 通用指標快取表（快照/用量/配額等派生資料）
  TASKS: "tasks", // 任務編排表
  SCHEMA_MIGRATIONS: "schema_migrations", // 遷移歷史表（用於記錄 schema 版本）
  SCHEDULED_JOBS: "scheduled_jobs", // 後臺排程作業表
  SCHEDULED_JOB_RUNS: "scheduled_job_runs", // 後臺排程作業執行日誌表
  UPLOAD_SESSIONS: "upload_sessions", // 通用上傳會話表（前端分片/斷點續傳）
  UPLOAD_PARTS: "upload_parts", // 上傳分片明細表（臨時賬本，一片一行）
  VFS_NODES: "vfs_nodes", // 虛擬目錄樹索引表（長期目錄樹/條目）
};

// 預設的最大上傳大小（MB）
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 100;

// API狀態碼常量
export const ApiStatus = {
  SUCCESS: 200,
  CREATED: 201,
  ACCEPTED: 202, // 部分成功，用於批次操作中有部分失敗的情況
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  INTERNAL_ERROR: 500,
};

//檔案型別常量
export const FILE_TYPES = {
  UNKNOWN: 0, // 未知檔案
  FOLDER: 1, // 資料夾
  VIDEO: 2, // 影片檔案
  AUDIO: 3, // 音訊檔案
  TEXT: 4, // 文字檔案
  IMAGE: 5, // 圖片檔案
  OFFICE: 6, // Office文件
  DOCUMENT: 7, // 文件檔案
};

// 檔案型別名稱對映
export const FILE_TYPE_NAMES = {
  [FILE_TYPES.UNKNOWN]: "unknown",
  [FILE_TYPES.FOLDER]: "folder",
  [FILE_TYPES.VIDEO]: "video",
  [FILE_TYPES.AUDIO]: "audio",
  [FILE_TYPES.TEXT]: "text",
  [FILE_TYPES.IMAGE]: "image",
  [FILE_TYPES.OFFICE]: "office",
  [FILE_TYPES.DOCUMENT]: "document",
};

// S3提供商型別常量
export const S3ProviderTypes = {
  R2: "Cloudflare R2",
  B2: "Backblaze B2",
  AWS: "AWS S3",
  ALIYUN_OSS: "Aliyun OSS",
  OTHER: "Other S3 Compatible",
};

// 統一的使用者型別常量（供服務層/能力層使用）
export const UserType = {
  ADMIN: "admin",
  API_KEY: "apiKey",
  ANONYMOUS: "anonymous",
};
