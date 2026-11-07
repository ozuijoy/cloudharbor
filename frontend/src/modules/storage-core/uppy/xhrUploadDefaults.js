/**
 * XHRUpload 上傳引數預設值
 *
 * Uppy 的 XHRUpload 預設 `timeout` 為 30 秒，而且計時器是在「最後一次有進度事件」後
 * 重新計時。也就是說：
 * - 大檔案在慢速網路上傳時，只要 30 秒內沒有進度事件就會被中止；
 * - 檔案本體上傳完成（100%）後，若後端還在處理（例如中轉到 S3/Telegram/Discord、
 *   或寫入較慢的磁碟），前端仍在等回應，30 秒後同樣會被判定逾時並中止請求。
 *
 * 部署後常見的「上傳到一半失敗／連線中斷」多數就是這個逾時造成的，因此這裡把
 * 進度逾時放寬到 10 分鐘（仍可攔截真正斷線的殭屍連線），並允許透過執行時設定覆寫：
 *
 *   window.appConfig.uploadTimeoutMs = 0; // 0 表示完全停用進度逾時
 *
 * 注意：Uppy 的 timeout 是「無進度逾時」，不是整體上傳時間上限。
 * 若不想改前端設定，Docker 部署時可用環境變數 UPLOAD_TIMEOUT_MS（毫秒，0 表示不限），
 * 由 entrypoint.sh 寫入 config.js 的 window.appConfig.uploadTimeoutMs。
 */

const DEFAULT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘

/**
 * 取得目前生效的上傳進度逾時（毫秒，0 表示不限制）
 * @returns {number}
 */
export function getUploadTimeoutMs() {
  try {
    const configured = typeof window !== "undefined" ? window?.appConfig?.uploadTimeoutMs : undefined;
    if (configured !== undefined && configured !== null && configured !== "") {
      const parsed = Number(configured);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  } catch {
    // 忽略執行時設定解析錯誤，回退到預設值
  }
  return DEFAULT_UPLOAD_TIMEOUT_MS;
}

/**
 * 為 XHRUpload 選項補上統一的上傳逾時設定（呼叫端明確指定時以呼叫端為準）
 * @param {object} options
 * @returns {object}
 */
export function withUploadTimeout(options = {}) {
  if (options && Object.prototype.hasOwnProperty.call(options, "timeout")) {
    return options;
  }
  return { timeout: getUploadTimeoutMs(), ...options };
}