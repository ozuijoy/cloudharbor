/**
 * 系統設定相關常量定義
 *
 */

/**
 * 設定分組常量
 *
 */
export const SETTING_GROUPS = {
  GLOBAL: 1, // 全域性設定
  PREVIEW: 2, // 預覽設定
  WEBDAV: 3, // WebDAV設定
  SITE: 4, // 站點設定
  SYSTEM: 99, // 系統內部設定（不在前端顯示）
};

/**
 * 設定型別常量
 * 支援不同的輸入元件型別
 */
export const SETTING_TYPES = {
  TEXT: "text", // 文字輸入框
  NUMBER: "number", // 數字輸入框
  BOOL: "bool", // 開關元件
  SELECT: "select", // 下拉選擇框
  TEXTAREA: "textarea", // 多行文字框
};

/**
 * 設定許可權標識常量
 * 使用位標誌控制設定項的訪問許可權
 */
export const SETTING_FLAGS = {
  PUBLIC: 0, // 公開可見
  PRIVATE: 1, // 需要管理員許可權
  READONLY: 2, // 只讀
  DEPRECATED: 3, // 已廢棄
};

/**
 * 分組顯示名稱對映
 * 用於前端介面顯示
 */
export const SETTING_GROUP_NAMES = {
  [SETTING_GROUPS.GLOBAL]: "全域性設定",
  [SETTING_GROUPS.PREVIEW]: "預覽設定",
  [SETTING_GROUPS.WEBDAV]: "WebDAV設定",
  [SETTING_GROUPS.SITE]: "站點設定",
  [SETTING_GROUPS.SYSTEM]: "系統設定",
};

/**
 * 設定項預設配置
 * 定義各個設定項的後設資料
 */
export const DEFAULT_SETTINGS = {
  // 全域性設定組
  max_upload_size: {
    key: "max_upload_size",
    type: SETTING_TYPES.NUMBER,
    group_id: SETTING_GROUPS.GLOBAL,
    help: "單次上傳檔案的最大大小限制(MB)，建議根據伺服器效能設定。",
    options: null,
    sort_order: 1,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "100",
  },

  proxy_sign_all: {
    key: "proxy_sign_all",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.GLOBAL,
    help: "開啟後所有代理訪問都需要簽名驗證，提升安全性。",
    options: null,
    sort_order: 2,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "false",
  },

  proxy_sign_expires: {
    key: "proxy_sign_expires",
    type: SETTING_TYPES.NUMBER,
    group_id: SETTING_GROUPS.GLOBAL,
    help: "代理簽名的過期時間（秒），0表示永不過期。",
    options: null,
    sort_order: 3,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "0",
  },

  file_naming_strategy: {
    key: "file_naming_strategy",
    type: SETTING_TYPES.SELECT,
    group_id: SETTING_GROUPS.GLOBAL,
    help: "檔案命名策略：覆蓋模式使用原始檔名（可能衝突），隨機字尾模式避免衝突且保持檔名可讀性。",
    options: JSON.stringify([
      { value: "overwrite", label: "覆蓋模式" },
      { value: "random_suffix", label: "隨機字尾模式" },
    ]),
    sort_order: 4,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "overwrite",
  },

  default_use_proxy: {
    key: "default_use_proxy",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.GLOBAL,
    help: "新檔案的預設代理設定。啟用後新檔案預設使用Worker代理，禁用後預設使用直鏈。",
    options: null,
    sort_order: 5,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "false",
  },

  // 預覽設定組
  preview_text_types: {
    key: "preview_text_types",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.PREVIEW,
    help: "支援預覽的文字副檔名，用逗號分隔",
    options: null,
    sort_order: 1,
    flag: SETTING_FLAGS.PUBLIC,
    default_value:
      "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,yml,yaml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,gitignore",
  },

  preview_audio_types: {
    key: "preview_audio_types",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.PREVIEW,
    help: "支援預覽的音訊副檔名，用逗號分隔",
    options: null,
    sort_order: 2,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "mp3,flac,ogg,m4a,wav,opus,wma",
  },

  preview_video_types: {
    key: "preview_video_types",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.PREVIEW,
    help: "支援預覽的影片副檔名，用逗號分隔",
    options: null,
    sort_order: 3,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8,ts,m2ts",
  },

  preview_image_types: {
    key: "preview_image_types",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.PREVIEW,
    help: "支援預覽的圖片副檔名，用逗號分隔",
    options: null,
    sort_order: 4,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif,heic,heif",
  },

  preview_providers: {
    key: "preview_providers",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.PREVIEW,
    help: "預覽規則配置（JSON 陣列），統一定義匹配條件、預覽型別與可用預覽器 URL 模板",
    options: null,
    sort_order: 5,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: JSON.stringify(
      [
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
  },

  // WebDAV設定組
  webdav_upload_mode: {
    key: "webdav_upload_mode",
    type: SETTING_TYPES.SELECT,
    group_id: SETTING_GROUPS.WEBDAV,
    help: "WebDAV 客戶端上傳模式。流式上傳大檔案，單次上傳適合小檔案或相容性場景。",
    options: JSON.stringify([
      { value: "chunked", label: "流式上傳" },
      { value: "single", label: "單次上傳" },
    ]),
    sort_order: 1,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "chunked",
  },

  // 站點設定組
  site_title: {
    key: "site_title",
    type: SETTING_TYPES.TEXT,
    group_id: SETTING_GROUPS.SITE,
    help: "站點標題，顯示在瀏覽器標籤頁和頁面標題中",
    options: null,
    sort_order: 1,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "CloudHarbor",
  },

  site_favicon_url: {
    key: "site_favicon_url",
    type: SETTING_TYPES.TEXT,
    group_id: SETTING_GROUPS.SITE,
    help: "站點圖示URL，支援https連結或base64格式，留空使用預設圖示",
    options: null,
    sort_order: 2,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "",
  },

  site_announcement_enabled: {
    key: "site_announcement_enabled",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.SITE,
    help: "是否在首頁顯示公告欄",
    options: null,
    sort_order: 3,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "false",
  },

  site_announcement_content: {
    key: "site_announcement_content",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.SITE,
    help: "公告內容，支援 Markdown 格式",
    options: null,
    sort_order: 4,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "",
  },

  site_footer_markdown: {
    key: "site_footer_markdown",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.SITE,
    help: "頁尾內容，支援 Markdown 格式，留空則不顯示頁尾",
    options: null,
    sort_order: 5,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "© 2025 CloudHarbor. 保留所有權利。",
  },

  site_custom_head: {
    key: "site_custom_head",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.SITE,
    help: "在此處設定的任何內容都會自動放置在網頁頭部的開頭",
    options: null,
    sort_order: 6,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "",
  },

  site_custom_body: {
    key: "site_custom_body",
    type: SETTING_TYPES.TEXTAREA,
    group_id: SETTING_GROUPS.SITE,
    help: "在此處設定的任何內容都會自動放置在網頁正文的末尾",
    options: null,
    sort_order: 7,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "",
  },

  // 前臺入口開關
  // - enabled=true：顯示入口 + 允許訪問路由
  // - enabled=false：隱藏入口 + 訪問時前端自動跳轉到其它預設頁
  site_home_editor_enabled: {
    key: "site_home_editor_enabled",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.SITE,
    help: "是否啟用首頁編輯器（/）。關閉後：首頁入口不顯示，訪問 / 會自動跳轉。",
    options: null,
    sort_order: 8,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "true",
  },

  site_upload_page_enabled: {
    key: "site_upload_page_enabled",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.SITE,
    help: "是否啟用檔案上傳頁面（/upload）。關閉後：上傳入口不顯示，訪問 /upload 會自動跳轉。",
    options: null,
    sort_order: 9,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "true",
  },

  site_mount_explorer_enabled: {
    key: "site_mount_explorer_enabled",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.SITE,
    help: "是否啟用掛載瀏覽頁面（/mount-explorer）。關閉後：掛載入口不顯示，訪問該頁面會自動跳轉。",
    options: null,
    sort_order: 10,
    flag: SETTING_FLAGS.PUBLIC,
    default_value: "true",
  },

  // 系統內部設定（不在前端顯示）
  db_initialized: {
    key: "db_initialized",
    type: SETTING_TYPES.BOOL,
    group_id: SETTING_GROUPS.SYSTEM,
    help: "資料庫初始化狀態標記，系統內部使用。",
    options: null,
    sort_order: 1,
    flag: SETTING_FLAGS.READONLY,
    default_value: "false",
  },

  schema_version: {
    key: "schema_version",
    type: SETTING_TYPES.NUMBER,
    group_id: SETTING_GROUPS.SYSTEM,
    help: "資料庫架構版本號，系統內部使用。",
    options: null,
    sort_order: 2,
    flag: SETTING_FLAGS.READONLY,
    default_value: "1",
  },
};

/**
 * 驗證設定值的輔助函式
 * @param {string} key - 設定鍵名
 * @param {any} value - 設定值
 * @param {string} type - 設定型別
 * @returns {boolean} 驗證結果
 */
export function validateSettingValue(key, value, type) {
  switch (type) {
    case SETTING_TYPES.NUMBER:
      const num = Number(value);
      if (isNaN(num)) return false;

      // 特定設定項的範圍驗證
      if (key === "max_upload_size") {
        return num > 0; // 非負數
      }
      if (key === "proxy_sign_expires") {
        return num >= 0; // 非負數
      }
      return true;

    case SETTING_TYPES.BOOL:
      return value === "true" || value === "false" || value === true || value === false;

    case SETTING_TYPES.SELECT:
      if (key === "webdav_upload_mode") {
        return ["single", "chunked"].includes(value);
      }
      return true;

    case SETTING_TYPES.TEXT:
    case SETTING_TYPES.TEXTAREA:
      if (typeof value !== "string") return false;

      // 自定義頭部和body的長度限制
      if (key === "site_custom_head" || key === "site_custom_body") {
        return value.length <= 100000; // 100KB限制
      }

      // 預覽設定的特殊驗證
      if (key.startsWith("preview_") && key.endsWith("_types")) {
        // 驗證副檔名列表格式：逗號分隔，只包含字母數字和點
        const extensions = value.split(",").map((ext) => ext.trim().toLowerCase());
        return extensions.every((ext) => /^[a-z0-9]+$/.test(ext));
      }

      return true;

    default:
      return true;
  }
}

/**
 * 轉換設定值為正確的型別
 * @param {any} value - 原始值
 * @param {string} type - 目標型別
 * @returns {any} 轉換後的值
 */
export function convertSettingValue(value, type) {
  switch (type) {
    case SETTING_TYPES.NUMBER:
      return Number(value);
    case SETTING_TYPES.BOOL:
      return value === "true" || value === true;
    case SETTING_TYPES.TEXT:
    case SETTING_TYPES.TEXTAREA:
    case SETTING_TYPES.SELECT:
      return String(value);
    default:
      return value;
  }
}
