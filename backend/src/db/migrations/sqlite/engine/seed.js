import crypto from "crypto";
import { DbTables } from "../../../../constants/index.js";

/**
 * SQLite/D1 系統設定與預設資料（engine）
 *
 */

export async function initDefaultSettings(db) {
  console.log("初始化系統預設設定...");

  // 為 cleanup_upload_sessions 任務寫入預設排程配置（若不存在）
  const cleanupIntervalSec = 24 * 60 * 60;
  const firstCleanupNextRunIso = new Date(Date.now() + cleanupIntervalSec * 1000).toISOString();
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
      "cleanup_upload_sessions",
      "cleanup_upload_sessions",
      "清理分片上傳會話（預設）",
      "定期清理本地分片上傳會話記錄，保持活躍列表乾淨。",
      cleanupIntervalSec,
      firstCleanupNextRunIso,
      JSON.stringify({ keepDays: 30, activeGraceHours: 24 }),
      "cleanup_upload_sessions",
    )
    .run();

  // 為 refresh_storage_usage_snapshots 寫入預設排程配置（若不存在）
  const refreshIntervalSec = 6 * 60 * 60;
  const firstRefreshNextRunIso = new Date(Date.now() + refreshIntervalSec * 1000).toISOString();
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
      refreshIntervalSec,
      firstRefreshNextRunIso,
      JSON.stringify({ maxItems: 50, maxConcurrency: 1 }),
      "refresh_storage_usage_snapshots",
    )
    .run();

  const defaultSettings = [
    {
      key: "max_upload_size",
      value: "100",
      description: "單次最大上傳檔案大小限制(MB)",
      type: "number",
      group_id: 1,
      sort_order: 1,
      flags: 0,
    },
    {
      key: "webdav_upload_mode",
      value: "chunked",
      description: "WebDAV 客戶端上傳模式。流式上傳大檔案，單次上傳適合小檔案或相容性場景。",
      type: "select",
      group_id: 3,
      options: JSON.stringify([
        { value: "chunked", label: "流式上傳" },
        { value: "single", label: "單次上傳" },
      ]),
      sort_order: 1,
      flags: 0,
    },
    {
      key: "proxy_sign_all",
      value: "true",
      description: "是否對所有檔案訪問請求進行代理簽名。",
      type: "bool",
      group_id: 1,
      sort_order: 2,
      flags: 0,
    },
    {
      key: "proxy_sign_expires",
      value: "0",
      description: "代理簽名的過期時間（秒），0表示永不過期。",
      type: "number",
      group_id: 1,
      sort_order: 3,
      flags: 0,
    },
  ];

  for (const setting of defaultSettings) {
    // INSERT OR IGNORE：已存在就忽略
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        setting.key,
        setting.value,
        setting.description,
        setting.type,
        setting.group_id,
        setting.options || null,
        setting.sort_order,
        setting.flags,
      )
      .run();
  }
}

export async function addPreviewSettings(db) {
  console.log("開始新增預覽設定預設值...");

  const previewSettings = [
    {
      key: "preview_text_types",
      value:
        "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,yml,yaml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,gitignore",
      description: "支援預覽的文字副檔名，用逗號分隔",
      type: "textarea",
      group_id: 2,
      sort_order: 1,
      flags: 0,
    },
    {
      key: "preview_audio_types",
      value: "mp3,flac,ogg,m4a,wav,opus,wma",
      description: "支援預覽的音訊副檔名，用逗號分隔",
      type: "textarea",
      group_id: 2,
      sort_order: 2,
      flags: 0,
    },
    {
      key: "preview_video_types",
      value: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8,ts,m2ts",
      description: "支援預覽的影片副檔名，用逗號分隔",
      type: "textarea",
      group_id: 2,
      sort_order: 3,
      flags: 0,
    },
    {
      key: "preview_image_types",
      value: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif",
      description: "支援預覽的圖片副檔名，用逗號分隔",
      type: "textarea",
      group_id: 2,
      sort_order: 4,
      flags: 0,
    },
    {
      key: "preview_providers",
      value: JSON.stringify(
        [
          // 無字尾檔案（README/LICENSE/Dockerfile/Makefile 等）兜底
          {
            id: "noext-text",
            priority: 0,
            match: { regex: "/^(readme|license|dockerfile|makefile)$/i" },
            previewKey: "text",
            providers: {},
          },
          {
            id: "office-openxml",
            priority: 0,
            match: { ext: ["docx", "xlsx", "pptx"] },
            previewKey: "office",
            providers: {
              native: "native",
              microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
              google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
            },
          },
          {
            id: "office-legacy",
            priority: 0,
            match: { ext: ["doc", "xls", "ppt", "rtf"] },
            previewKey: "office",
            providers: {
              microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
              google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
            },
          },
          {
            id: "pdf",
            priority: 0,
            match: { ext: ["pdf"] },
            previewKey: "pdf",
            providers: {
              native: "native",
            },
          },
          {
            id: "epub",
            priority: 0,
            match: { ext: ["epub", "mobi", "azw3", "azw", "fb2", "cbz"] },
            previewKey: "epub",
            providers: {
              native: "native",
            },
          },
          {
            id: "archive",
            priority: 0,
            match: {
              ext: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz", "tbz2", "txz", "cpio", "iso", "cab", "xar", "ar", "a", "mtree"],
            },
            previewKey: "archive",
            providers: {},
          },
        ],
        null,
        2,
      ),
      description: "預覽規則配置（JSON 陣列）：定義匹配條件、預覽型別與 URL 模板",
      type: "textarea",
      group_id: 2,
      sort_order: 5,
      flags: 0,
    },
  ];

  for (const setting of previewSettings) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(setting.key, setting.value, setting.description, setting.type, setting.group_id, setting.sort_order, setting.flags)
      .run();
  }
}

export async function resetPreviewProvidersDefaults(db) {
  console.log("開始重置 preview_providers 預設規則...");

  const previewProvidersValue = JSON.stringify(
    [
      // 無字尾檔案（README/LICENSE/Dockerfile/Makefile 等）兜底
      {
        id: "noext-text",
        priority: 0,
        match: { regex: "/^(readme|license|dockerfile|makefile)$/i" },
        previewKey: "text",
        providers: {},
      },
      {
        id: "office-openxml",
        priority: 0,
        match: { ext: ["docx", "xlsx", "pptx"] },
        previewKey: "office",
        providers: {
          native: "native",
          microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
          google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
        },
      },
      {
        id: "office-legacy",
        priority: 0,
        match: { ext: ["doc", "xls", "ppt", "rtf"] },
        previewKey: "office",
        providers: {
          microsoft: { urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url" },
          google: { urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true" },
        },
      },
      {
        id: "pdf",
        priority: 0,
        match: { ext: ["pdf"] },
        previewKey: "pdf",
        providers: {
          native: "native",
        },
      },
      {
        id: "epub",
        priority: 0,
        match: { ext: ["epub", "mobi", "azw3", "azw", "fb2", "cbz"] },
        previewKey: "epub",
        providers: {
          native: "native",
        },
      },
      {
        id: "archive",
        priority: 0,
        match: {
          // 壓縮包/歸檔檔案：走本地“線上解壓預覽”元件
          // 注：後端只取最後一個副檔名（例如 foo.tar.gz -> gz），因此把 tgz/tbz/txz 也單獨列出來
          ext: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz", "tbz2", "txz", "cpio", "iso", "cab", "xar", "ar", "a", "mtree"],
        },
        previewKey: "archive",
        providers: {},
      },
    ],
    null,
    2,
  );

  const description = "預覽規則配置（JSON 陣列）：定義匹配條件、預覽型別與 URL 模板";
  await db
    .prepare(
      `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
       VALUES (?, ?, ?, 'textarea', 2, 5, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         description = excluded.description,
         type = 'textarea',
         group_id = 2,
         sort_order = 5,
         flags = 0,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind("preview_providers", previewProvidersValue, description)
    .run();

  const obsoleteKeys = [
    "preview_office_types",
    "preview_document_types",
    "preview_document_apps",
    "preview_iframe_templates",
  ];
  const placeholders = obsoleteKeys.map(() => "?").join(", ");
  await db
    .prepare(`DELETE FROM ${DbTables.SYSTEM_SETTINGS} WHERE key IN (${placeholders})`)
    .bind(...obsoleteKeys)
    .run();
}

export async function addFileNamingStrategySetting(db) {
  console.log("開始新增檔案命名策略系統設定...");

  const options = JSON.stringify([
    { value: "overwrite", label: "覆蓋模式" },
    { value: "random_suffix", label: "隨機字尾模式" },
  ]);

  await db
    .prepare(
      `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      "file_naming_strategy",
      "overwrite",
      "檔案命名策略：覆蓋模式使用原始檔名（可能衝突），隨機字尾模式避免衝突且保持檔名可讀性。",
      "select",
      1,
      options,
      4,
      0,
    )
    .run();
}

export async function addDefaultProxySetting(db) {
  console.log("開始新增預設代理設定...");

  await db
    .prepare(
      `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      "default_use_proxy",
      "false",
      "檔案管理的預設代理設定。啟用後新上傳檔案預設使用Worker代理，禁用後預設使用直鏈。",
      "bool",
      1,
      5,
      0,
    )
    .run();
}

export async function addSiteSettings(db) {
  console.log("開始新增站點設定分組和公告欄設定...");

  const siteSettings = [
    {
      key: "site_title",
      value: "CloudHarbor",
      description: "站點標題，顯示在瀏覽器標籤頁和頁面標題中",
      type: "text",
      group_id: 4,
      sort_order: 1,
      flags: 0,
    },
    {
      key: "site_favicon_url",
      value: "",
      description: "站點圖示URL，支援https連結或base64格式，留空使用預設圖示",
      type: "text",
      group_id: 4,
      sort_order: 2,
      flags: 0,
    },
    {
      key: "site_announcement_enabled",
      value: "false",
      description: "是否在首頁顯示公告欄",
      type: "bool",
      group_id: 4,
      sort_order: 3,
      flags: 0,
    },
    {
      key: "site_announcement_content",
      value: "",
      description: "公告內容，支援 Markdown 格式",
      type: "textarea",
      group_id: 4,
      sort_order: 4,
      flags: 0,
    },
    {
      key: "site_footer_markdown",
      value: "© 2025 CloudHarbor. 保留所有權利。",
      description: "頁尾內容，支援 Markdown 格式，留空則不顯示頁尾",
      type: "textarea",
      group_id: 4,
      sort_order: 5,
      flags: 0,
    },
  ];

  for (const setting of siteSettings) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(setting.key, setting.value, setting.description, setting.type, setting.group_id, setting.sort_order, setting.flags)
      .run();
  }
}

export async function addCustomContentSettings(db) {
  console.log("開始新增自定義頭部和body設定...");

  const customContentSettings = [
    {
      key: "site_custom_head",
      value: "",
      description: "在此處設定的任何內容都會自動放置在網頁頭部的開頭",
      type: "textarea",
      group_id: 4,
      sort_order: 6,
      flags: 0,
    },
    {
      key: "site_custom_body",
      value: "",
      description: "在此處設定的任何內容都會自動放置在網頁正文的末尾",
      type: "textarea",
      group_id: 4,
      sort_order: 7,
      flags: 0,
    },
  ];

  for (const setting of customContentSettings) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(setting.key, setting.value, setting.description, setting.type, setting.group_id, setting.sort_order, setting.flags)
      .run();
  }

  console.log("自定義頭部和body設定新增完成");
}

/**
 * SQLite/D1 種子資料（legacy）
 *
 * 來源：歷史初始化實現（原 `backend/src/utils/database.js`，現已遷移到 db/migrations/sqlite/engine）
 */
export async function createDefaultAdmin(db) {
  console.log("檢查預設管理員賬戶...");

  // Workers 冷啟動併發下，用 INSERT OR IGNORE 避免 UNIQUE(username) 競態導致 500
  const adminId = crypto.randomUUID();
  // 密碼 "admin123" 的 SHA-256 雜湊
  const defaultPassword = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

  await db
    .prepare(
      `INSERT OR IGNORE INTO ${DbTables.ADMINS} (id, username, password)
       VALUES (?, ?, ?)`,
    )
    .bind(adminId, "admin", defaultPassword)
    .run();
}

export async function createDefaultGuestApiKey(db) {
  console.log("檢查預設遊客 API 金鑰...");

  const id = crypto.randomUUID();
  const key = "guest";
  const expiresAt = new Date("9999-12-31T23:59:59Z").toISOString();

  await db
    .prepare(
      `INSERT OR IGNORE INTO ${DbTables.API_KEYS} (id, name, key, permissions, role, basic_path, is_enable, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, "guest", key, 0, "GUEST", "/", 0, expiresAt)
    .run();
}

export default {
  initDefaultSettings,
  addPreviewSettings,
  addSiteSettings,
  addCustomContentSettings,
  addFileNamingStrategySetting,
  addDefaultProxySetting,
  createDefaultAdmin,
  createDefaultGuestApiKey,
};
