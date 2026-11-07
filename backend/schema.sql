-- CloudHarbor D1資料庫初始化
-- 這個檔案用於建立所有必需的表結構
-- 執行方式: wrangler d1 execute cloudharbor-db --file=./schema.sql

-- 刪除已有表（如果需要重新建立）
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS storage_configs;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS admin_tokens;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS pastes;
DROP TABLE IF EXISTS file_passwords;
DROP TABLE IF EXISTS paste_passwords;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS fs_meta;
DROP TABLE IF EXISTS storage_mounts;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS scheduled_jobs;
DROP TABLE IF EXISTS upload_sessions;
DROP TABLE IF EXISTS scheduled_job_runs;
DROP TABLE IF EXISTS vfs_nodes;
DROP TABLE IF EXISTS upload_parts;
DROP TABLE IF EXISTS fs_search_index_entries;
DROP TABLE IF EXISTS fs_search_index_state;
DROP TABLE IF EXISTS fs_search_index_dirty;
DROP TABLE IF EXISTS fs_search_index_fts;
DROP TABLE IF EXISTS metrics_cache;

-- 建立pastes表 - 儲存文字分享資料
CREATE TABLE pastes (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  title TEXT,
  remark TEXT,
  password TEXT,
  expires_at DATETIME,
  max_views INTEGER,
  views INTEGER DEFAULT 0,  
  is_public BOOLEAN NOT NULL DEFAULT 1,
  created_by TEXT,                     -- 建立者標識（管理員ID或API金鑰ID）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 建立索引
CREATE INDEX idx_pastes_slug ON pastes(slug);
CREATE INDEX idx_pastes_created_at ON pastes(created_at DESC);
CREATE INDEX idx_pastes_created_by ON pastes(created_by);    -- 新增建立者索引
CREATE INDEX idx_pastes_is_public ON pastes(is_public);



-- 建立admins表 - 儲存管理員資訊
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 建立admin_tokens表 - 儲存管理員認證令牌
CREATE TABLE admin_tokens (
  token TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- 建立api_keys表 - 儲存API金鑰（位標誌許可權系統）
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  key TEXT UNIQUE NOT NULL,
  permissions INTEGER DEFAULT 0,        -- 位標誌許可權（替代布林欄位）
  role TEXT DEFAULT 'GENERAL',          -- 使用者角色：GUEST/GENERAL/ADMIN
  basic_path TEXT DEFAULT '/',
  is_enable BOOLEAN DEFAULT 0,         -- 啟用狀態：0=禁用，1=啟用（所有金鑰預設禁用，需手動開啟）
  last_used DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- 建立 storage_configs 表 - 聚合（驅動私有配置存入 config_json）
CREATE TABLE storage_configs (
  id TEXT PRIMARY KEY,                 -- 配置唯一標識
  name TEXT NOT NULL,                  -- 配置名稱
  storage_type TEXT NOT NULL,          -- 儲存型別（S3/WebDAV/…）
  admin_id TEXT,                       -- 歸屬管理員（允許NULL以相容/預留）
  is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  remark TEXT,                         -- 備註說明
  url_proxy TEXT,                      -- 代理入口 URL（例如 Worker/CDN 反代入口）
  status TEXT NOT NULL DEFAULT 'ENABLED',
  config_json TEXT NOT NULL,           -- 驅動私有配置（JSON，敏感欄位加密後存入）
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME
);
-- 索引與唯一約束
CREATE INDEX idx_storage_admin ON storage_configs(admin_id);
CREATE INDEX idx_storage_type ON storage_configs(storage_type);
CREATE INDEX idx_storage_public ON storage_configs(is_public);
CREATE UNIQUE INDEX idx_default_per_admin ON storage_configs(admin_id) WHERE is_default = 1;

-- 儲存 ACL 表：主體 -> 儲存配置訪問白名單
CREATE TABLE principal_storage_acl (
  subject_type TEXT NOT NULL,           -- 主體型別：API_KEY/USER/ROLE 等
  subject_id TEXT NOT NULL,             -- 主體ID：api_keys.id / users.id 等
  storage_config_id TEXT NOT NULL,      -- 被允許訪問的 storage_configs.id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subject_type, subject_id, storage_config_id)
);
CREATE INDEX idx_psa_storage_config_id ON principal_storage_acl(storage_config_id);

-- 建立files表 - 儲存已上傳檔案的後設資料（支援多儲存型別）
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,           -- 保持現有slug機制
  filename TEXT NOT NULL,              -- 原始檔名

  -- 儲存引用（支援多儲存型別）
  storage_config_id TEXT NOT NULL,     -- 儲存配置ID（S3/WebDAV/Local等）
  storage_type TEXT NOT NULL,          -- 儲存型別標識
  storage_path TEXT NOT NULL,          -- 儲存中的實際路徑
  file_path TEXT,                      -- 檔案系統路徑（可選，用於從檔案系統建立的分享）

  -- 檔案後設資料
  mimetype TEXT NOT NULL,              -- 檔案MIME型別
  size INTEGER NOT NULL,               -- 檔案大小
  etag TEXT,                           -- 檔案ETag（完整性驗證和快取）

  -- 分享控制
  remark TEXT,                         -- 檔案備註
  password TEXT,                       -- 密碼保護
  expires_at DATETIME,                 -- 過期時間
  max_views INTEGER,                   -- 最大檢視次數
  views INTEGER DEFAULT 0,             -- 當前檢視次數
  use_proxy BOOLEAN DEFAULT 0,         -- 是否使用代理訪問

  -- 後設資料
  created_by TEXT,                     -- 建立者
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 新增索引提升查詢效能
CREATE INDEX idx_files_slug ON files(slug);
CREATE INDEX idx_files_storage_config_id ON files(storage_config_id);
CREATE INDEX idx_files_storage_type ON files(storage_type);
CREATE INDEX idx_files_file_path ON files(file_path);
CREATE INDEX idx_files_created_at ON files(created_at);
CREATE INDEX idx_files_expires_at ON files(expires_at);

CREATE TABLE fs_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,                  -- 虛擬路徑，如 "/", "/public", "/private/docs"

  header_markdown TEXT NULL,           -- 頂部 README markdown 內容（inline）
  header_inherit BOOLEAN NOT NULL DEFAULT 0,

  footer_markdown TEXT NULL,           -- 底部 README markdown 內容（inline）
  footer_inherit BOOLEAN NOT NULL DEFAULT 0,

  hide_patterns TEXT NULL,             -- JSON 陣列字串，如 ["^README\\.md$", "^top\\.md$"]
  hide_inherit BOOLEAN NOT NULL DEFAULT 0,

  password TEXT NULL,                  -- 目錄訪問密碼（明文，為空表示未設定）
  password_inherit BOOLEAN NOT NULL DEFAULT 0,

  extra JSON NULL,                     -- 預留擴充套件欄位

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fs_meta_path ON fs_meta(path);

-- ================================
-- FS 搜尋索引（派生資料，可重建）
-- - entries/state/dirty 為普通表，可遷移
-- - fts 為 FTS5 虛表，作為加速結構，不參與 export/import（建議透過重建恢復）
-- ================================

CREATE TABLE fs_search_index_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mount_id TEXT NOT NULL,
  fs_path TEXT NOT NULL,
  name TEXT NOT NULL,
  is_dir BOOLEAN NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  modified_ms INTEGER NOT NULL DEFAULT 0,
  mimetype TEXT,
  index_run_id TEXT,
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE (mount_id, fs_path)
);

CREATE TABLE fs_search_index_state (
  mount_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_indexed_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  last_error TEXT
);

CREATE TABLE fs_search_index_dirty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mount_id TEXT NOT NULL,
  fs_path TEXT NOT NULL,
  op TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE fs_search_index_fts
USING fts5(
  name,
  fs_path,
  tokenize='trigram',
  content='fs_search_index_entries',
  content_rowid='id'
);

CREATE TRIGGER fs_search_index_ai
AFTER INSERT ON fs_search_index_entries
BEGIN
  INSERT INTO fs_search_index_fts(rowid, name, fs_path)
  VALUES (new.id, new.name, new.fs_path);
END;

CREATE TRIGGER fs_search_index_ad
AFTER DELETE ON fs_search_index_entries
BEGIN
  INSERT INTO fs_search_index_fts(fs_search_index_fts, rowid, name, fs_path)
  VALUES ('delete', old.id, old.name, old.fs_path);
END;

CREATE TRIGGER fs_search_index_au
AFTER UPDATE ON fs_search_index_entries
BEGIN
  INSERT INTO fs_search_index_fts(fs_search_index_fts, rowid, name, fs_path)
  VALUES ('delete', old.id, old.name, old.fs_path);
  INSERT INTO fs_search_index_fts(rowid, name, fs_path)
  VALUES (new.id, new.name, new.fs_path);
END;

CREATE INDEX idx_fs_search_entries_mount_path ON fs_search_index_entries(mount_id, fs_path);
CREATE INDEX idx_fs_search_entries_mount_modified ON fs_search_index_entries(mount_id, modified_ms DESC, id DESC);
CREATE INDEX idx_fs_search_entries_modified ON fs_search_index_entries(modified_ms DESC, id DESC);
CREATE INDEX idx_fs_search_entries_mount_run ON fs_search_index_entries(mount_id, index_run_id);
CREATE INDEX idx_fs_search_dirty_mount ON fs_search_index_dirty(mount_id, created_at_ms ASC);

-- 建立file_passwords表 - 儲存檔案密碼
CREATE TABLE file_passwords (
  file_id TEXT PRIMARY KEY,
  plain_password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- 建立paste_passwords表 - 儲存文字密碼
CREATE TABLE paste_passwords (
  paste_id TEXT PRIMARY KEY,
  plain_password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paste_id) REFERENCES pastes(id) ON DELETE CASCADE
);

-- 建立system_settings表 - 儲存系統設定
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'string',              -- 設定值型別：string, number, bool, select
  group_id INTEGER DEFAULT 1,              -- 分組ID：1=全域性設定, 3=WebDAV設定
  options TEXT,                            -- JSON格式的選項配置（用於select型別）
  sort_order INTEGER DEFAULT 0,            -- 在分組內的排序順序
  flags INTEGER DEFAULT 0,                
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 建立schema_migrations表 - 記錄遷移執行歷史（內部使用）
CREATE TABLE schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 建立storage_mounts表 - 儲存掛載配置
CREATE TABLE storage_mounts (
  id TEXT PRIMARY KEY,                  -- 唯一標識
  name TEXT NOT NULL,                   -- 掛載點名稱
  storage_type TEXT NOT NULL,           -- 儲存型別(S3, WebDAV等)
  storage_config_id TEXT,               -- 關聯的通用儲存配置ID（storage_configs.id）
  mount_path TEXT NOT NULL,             -- 掛載路徑，如 /photos
  remark TEXT,                          -- 備註說明
  is_active BOOLEAN DEFAULT 1,          -- 是否啟用
  created_by TEXT NOT NULL,             -- 建立者標識
  sort_order INTEGER DEFAULT 0,         -- 顯示排序順序
  cache_ttl INTEGER DEFAULT 300,        -- 快取時間(秒)，提高效能
  web_proxy BOOLEAN DEFAULT 0,          -- 網頁預覽、下載和直接連結是否透過中轉
  webdav_policy TEXT DEFAULT '302_redirect', -- WebDAV策略：'302_redirect' 或 'native_proxy'
  enable_sign BOOLEAN DEFAULT 0,        -- 是否啟用代理簽名
  sign_expires INTEGER DEFAULT NULL,    -- 簽名過期時間（秒），NULL表示使用全域性設定
  enable_folder_summary_compute BOOLEAN DEFAULT 0, -- 是否啟用“目錄大小/時間”遞迴計算（兜底用）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME                    -- 最後使用時間
);

-- 建立索引
CREATE INDEX idx_storage_mounts_mount_path ON storage_mounts(mount_path);
CREATE INDEX idx_storage_mounts_storage_config_id ON storage_mounts(storage_config_id);
CREATE INDEX idx_storage_mounts_created_by ON storage_mounts(created_by);
CREATE INDEX idx_storage_mounts_is_active ON storage_mounts(is_active);
CREATE INDEX idx_storage_mounts_sort_order ON storage_mounts(sort_order);


-- 通用上傳會話表：管理各儲存驅動的前端分片/斷點續傳會話
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,                   -- 內部會話ID（例如 upl_xxx），供前後端統一引用

  -- 主體與目標資訊
  user_id TEXT NOT NULL,                 -- 使用者或 API Key 標識
  user_type TEXT NOT NULL,               -- 'admin' | 'apikey' | 其他
  storage_type TEXT NOT NULL,            -- 儲存型別：S3 / ONEDRIVE / WEBDAV / LOCAL 等
  storage_config_id TEXT NOT NULL,       -- 關聯的儲存配置 ID（storage_configs.id）
  mount_id TEXT,                         -- 關聯掛載 ID（storage_mounts.id，可為空）
  fs_path TEXT NOT NULL,                 -- FS 檢視路徑，如 /onedrive/path/file.ext 或 /s3/bucket/key
  source TEXT NOT NULL,                  -- 會話來源：FS / SHARE / OTHER

  -- 檔案級後設資料
  file_name TEXT NOT NULL,               -- 檔名
  file_size INTEGER NOT NULL,            -- 總大小（位元組）
  mime_type TEXT,                        -- MIME 型別（可選）
  checksum TEXT,                         -- 校驗和（可選，例如 SHA-256）

  -- 檔案指紋（用於跨驅動/跨會話識別同一邏輯檔案）
  fingerprint_algo TEXT,                 -- 指紋演算法標識，例如 meta-v1 / sha256 等
  fingerprint_value TEXT,                -- 指紋值（演算法自定義，可為後設資料拼接或雜湊）

  -- 策略與進度
  strategy TEXT NOT NULL,                -- 分片策略：per_part_url / single_session / ...
  part_size INTEGER NOT NULL,            -- 分片大小（位元組）
  total_parts INTEGER NOT NULL,          -- 預估分片總數
  bytes_uploaded INTEGER NOT NULL DEFAULT 0,  -- 已上傳位元組數（對於 single_session 可由 nextExpectedRanges 推導）
  uploaded_parts INTEGER NOT NULL DEFAULT 0,  -- 已確認的分片數量（對於 per_part_url 有意義）
  next_expected_range TEXT,              -- 對於 single_session：Graph nextExpectedRanges[0]，如 \"5242880-35799947\"

  -- provider 會話資訊（驅動私有）
  provider_upload_id TEXT,               -- 例如 S3 UploadId / 其他雲 provider upload id
  provider_upload_url TEXT,              -- 例如 OneDrive uploadSession.uploadUrl
  provider_meta TEXT,                    -- JSON 擴充套件欄位（驅動私有）

  -- 會話狀態與錯誤
  status TEXT NOT NULL,                  -- initiated / uploading / completed / aborted / expired / error
  error_code TEXT,
  error_message TEXT,

  -- 生命週期
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME                    -- 會話過期時間（例如 Graph expirationDateTime）
);

CREATE INDEX idx_upload_sessions_user ON upload_sessions(user_id, user_type);
CREATE INDEX idx_upload_sessions_storage ON upload_sessions(storage_type, storage_config_id);
CREATE INDEX idx_upload_sessions_mount_path ON upload_sessions(mount_id, fs_path);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status, updated_at DESC);
CREATE INDEX idx_upload_sessions_source ON upload_sessions(source);
CREATE INDEX idx_upload_sessions_fingerprint ON upload_sessions(fingerprint_value);

-- ================================
-- VFS 索引（長期資料）
-- - 用於讓“無目錄樹”的內容後端也能在 FS UI 裡展示為目錄樹
-- - root 約定：root 本身不佔記錄；root 下子節點使用 parent_id = ''（空字串）
-- ================================

CREATE TABLE vfs_nodes (
  id TEXT PRIMARY KEY,                   -- 唯一標識（例如 vfs_xxx）

  -- 多使用者隔離預留
  owner_type TEXT NOT NULL,              -- admin / apikey / user（預留）
  owner_id TEXT NOT NULL,                -- 具體主體 id（字串）

  -- 歸屬作用域（用於“無目錄樹後端”的虛擬目錄樹真相）
  scope_type TEXT NOT NULL,              -- mount | storage_config
  scope_id TEXT NOT NULL,                -- storage_mounts.id / storage_configs.id

  -- 目錄樹結構
  parent_id TEXT NOT NULL DEFAULT '',    -- root 下子節點：''；非 root：父節點 id
  name TEXT NOT NULL,                    -- 節點名（檔名/資料夾名）
  node_type TEXT NOT NULL,               -- dir | file | link

  -- 展示/元資訊
  mime_type TEXT,
  size INTEGER,
  hash_algo TEXT,
  hash_value TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | deleted（軟刪除預留）

  -- 內容後端定位
  storage_type TEXT NOT NULL,            -- 內容後端型別（TELEGRAM / URL / S3 ...）
  content_ref TEXT,                      -- JSON：描述如何獲取內容（TG manifest / URL 等）

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (owner_type, owner_id, scope_type, scope_id, parent_id, name)
);

CREATE INDEX idx_vfs_nodes_scope ON vfs_nodes(owner_type, owner_id, scope_type, scope_id, parent_id);
CREATE INDEX idx_vfs_nodes_scope_id ON vfs_nodes(scope_type, scope_id);

-- ================================
-- 分片上傳明細（臨時資料：complete 後刪除）
-- - 一片一行，避免併發寫入互相覆蓋
-- ================================

CREATE TABLE upload_parts (
  id TEXT PRIMARY KEY,                   -- 唯一標識（例如 uplp_xxx）
  upload_id TEXT NOT NULL,               -- upload_sessions.id
  part_no INTEGER NOT NULL,              -- 分片編號（從 1 開始）

  byte_start INTEGER,                    -- 可選：該片在整檔案中的起始偏移
  byte_end INTEGER,                      -- 可選：該片在整檔案中的結束偏移（包含）
  size INTEGER NOT NULL,                 -- 分片大小（位元組）

  checksum_algo TEXT,
  checksum TEXT,

  storage_type TEXT NOT NULL,            -- 內容後端型別（TELEGRAM / URL / ...）
  provider_part_id TEXT,                 -- 可選：回執 id（如 ETag / messageId / fileId）
  provider_meta TEXT,                    -- JSON：回執擴充套件欄位（如 TG messageId/fileId/channelId）

  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded | error
  error_code TEXT,
  error_message TEXT,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (upload_id, part_no)
);

CREATE INDEX idx_upload_parts_upload_part_no ON upload_parts(upload_id, part_no);
CREATE INDEX idx_upload_parts_updated_at ON upload_parts(updated_at);


CREATE TABLE tasks (
  -- 核心標識
  task_id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,           -- 'copy' | 'upload' | 'download' | 'delete' | 'archive'

  -- 通用狀態
  status TEXT NOT NULL,              -- 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

  -- 任務負載（JSON格式）
  payload TEXT NOT NULL,             -- JSON: { items: [...], options: {...} }

  -- 統計資訊（JSON格式）
  stats TEXT NOT NULL DEFAULT '{}',  -- JSON: { totalItems, processedItems, successCount, failedCount, skippedCount }

  -- 錯誤資訊（可選）
  error_message TEXT,

  -- 使用者資訊
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL,           -- 'admin' | 'apikey'

  -- 觸發來源（用於任務列表展示/區分）
  trigger_type TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'scheduled'
  trigger_ref TEXT,                              -- 可選：來源引用（如 scheduled handlerId / 頁面標識）

  -- Workflows 關聯（僅 Workers 執行時使用，可選）
  workflow_instance_id TEXT,

  -- 時間戳（Unix timestamp in milliseconds）
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_type_status ON tasks (task_type, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;

CREATE TABLE scheduled_jobs (
  task_id              TEXT PRIMARY KEY,              -- 作業唯一標識（job ID），例如 'cleanup_upload_sessions_default'
  handler_id           TEXT,                          -- 任務型別ID（Handler ID），例如 'cleanup_upload_sessions'
  name                 TEXT,                          -- 作業名稱（展示用，可自定義）
  description          TEXT,                          -- 作業描述/備註
  enabled              INTEGER NOT NULL,              -- 1=啟用, 0=禁用

  schedule_type        TEXT NOT NULL DEFAULT 'interval', -- 排程型別：interval | cron
  interval_sec         INTEGER,                       -- interval 模式下的執行間隔(秒)
  cron_expression      TEXT,                          -- cron 模式下的表示式，例如 \"0 2 * * *\"

  run_count            INTEGER NOT NULL DEFAULT 0,    -- 累計執行次數（成功/失敗均計入）
  failure_count        INTEGER NOT NULL DEFAULT 0,    -- 累計失敗次數

  last_run_status      TEXT,                          -- 最近一次執行狀態：success/failure/skipped
  last_run_started_at  DATETIME,                      -- 最近一次執行開始時間
  last_run_finished_at DATETIME,                      -- 最近一次執行結束時間

  next_run_after       DATETIME,                      -- 最早允許再次執行的時間
  lock_until           DATETIME,                      -- 鎖過期時間，用於多例項互斥

  config_json          TEXT NOT NULL DEFAULT '{}',
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduled_jobs_next_run ON scheduled_jobs (enabled, next_run_after);

-- 後臺排程作業執行日誌表：記錄每次執行結果
CREATE TABLE scheduled_job_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL,                  -- 對應 scheduled_jobs.task_id
  status        TEXT NOT NULL,                  -- 'success' | 'failure' | 'skipped'
  trigger_type  TEXT NOT NULL DEFAULT 'auto',   -- 觸發型別：'auto' | 'manual'

  scheduled_at  DATETIME,                       -- 計劃執行時間（可選）
  started_at    DATETIME NOT NULL,              -- 本次執行開始時間
  finished_at   DATETIME,                       -- 本次執行結束時間
  duration_ms   INTEGER,                        -- 執行耗時(毫秒)

  summary       TEXT,                           -- 簡要摘要，如影響行數等
  error_message TEXT,                           -- 失敗時的錯誤資訊
  details_json  TEXT,                           -- 可選的結構化詳情(JSON)

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduled_job_runs_task_started
  ON scheduled_job_runs (task_id, started_at DESC);

-- 通用指標快取表：儲存各種統計指標的快取資料
CREATE TABLE metrics_cache (
  scope_type TEXT NOT NULL,              -- 作用域型別，如 'global'、'storage'、'user' 等
  scope_id TEXT NOT NULL,                -- 作用域標識，如具體的儲存ID或使用者ID
  metric_key TEXT NOT NULL,              -- 指標鍵名

  value_num INTEGER,                     -- 數值型別的指標值
  value_text TEXT,                       -- 文字型別的指標值
  value_json_text TEXT,                  -- JSON格式的複雜指標值

  snapshot_at_ms INTEGER,                -- 快照時間戳（毫秒）
  updated_at_ms INTEGER NOT NULL,        -- 最後更新時間戳（毫秒）

  error_message TEXT,                    -- 錯誤資訊（如果指標計算失敗）

  PRIMARY KEY (scope_type, scope_id, metric_key)
);

-- 通用指標快取索引：按作用域型別和ID查詢
CREATE INDEX idx_metrics_cache_scope ON metrics_cache(scope_type, scope_id);
