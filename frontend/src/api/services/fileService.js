/**
 * 檔案管理服務API
 * 統一管理所有檔案相關的API呼叫，包括上傳、下載、管理等
 */

import { get, post, put, del } from "../client";

/******************************************************************************
 * 檔案上傳相關API
 ******************************************************************************/

/**
 * 獲取上傳預簽名URL
 * @param {Object} options - 上傳選項
 * @param {string} options.storage_config_id - 儲存配置ID
 * @param {string} options.filename - 檔名
 * @param {string} options.mimetype - 檔案的MIME型別
 * @param {string} [options.path] - 自定義儲存路徑
 * @param {string} [options.slug] - 自定義短連結
 * @param {number} [options.size] - 檔案大小（位元組）
 * @returns {Promise<Object>} 包含預簽名URL的響應
 */
export async function getUploadPresignedUrl(options) {
  try {
    const sha256 = typeof options?.sha256 === "string" && options.sha256 ? options.sha256 : null;
    const data = {
      filename: options.filename,
      fileSize: options.size ?? options.fileSize ?? options.filesize,
      contentType: options.mimetype,
      path: options.path || null,
      storage_config_id: options.storage_config_id || null,
      sha256,
    };

    return await post("share/presign", data);
  } catch (error) {
    if (error.message && error.message.includes("連結字尾已被佔用")) {
      throw new Error("連結字尾已被佔用，請嘗試其他字尾");
    }

    throw new Error(`獲取預簽名URL失敗: ${error.message}`);
  }
}

/**
 * 完成檔案上傳（更新檔案後設資料）
 * @param {Object} data - 上傳完成後的後設資料
 * @returns {Promise<Object>} 更新響應
 */
export async function completeFileUpload(data) {
  // 新協議優先：key + storage_config_id；相容舊 path（虛擬路徑）
  const payload = {
    key: data.key || undefined,
    storage_config_id: data.storage_config_id || undefined,
    path: data.path || undefined,
    filename: data.filename,
    size: Number(data.size ?? data.fileSize ?? 0),
    etag: data.etag,
    sha256: typeof data?.sha256 === "string" && data.sha256 ? data.sha256 : null,
    slug: data.slug,
    remark: data.remark,
    password: data.password,
    expires_in: data.expires_in ?? data.expiresIn,
    max_views: data.max_views ?? data.maxViews,
    use_proxy: data.use_proxy ?? data.useProxy,
    original_filename: data.original_filename ?? data.originalFilename ?? false,
  };

  return await post("share/commit", payload);
}

/**
 * 透過通用分享上傳介面上傳單個檔案並建立分享記錄（ObjectStore 多儲存直傳）
 * @param {Object} options
 * @param {File|Blob} options.file - 要上傳的檔案
 * @param {string|number} options.storage_config_id - 儲存配置ID
 * @param {string} [options.path] - 目標目錄（可選）
 * @param {string} [options.slug] - 自定義連結字尾（可選）
 * @param {string} [options.remark] - 備註（可選）
 * @param {string} [options.password] - 密碼（可選）
 * @param {number|string} [options.expires_in] - 過期時間（小時，可選）
 * @param {number|string} [options.max_views] - 最大訪問次數（可選）
 * @param {boolean} [options.use_proxy] - 是否透過代理下載（可選）
 * @param {boolean} [options.original_filename] - 是否使用原始檔名（可選）
 * @returns {Promise<Object>} 後端統一響應物件 { success, message, data }
 */
export async function uploadShareFile(options) {
  const {
    file,
    storage_config_id,
    path = "",
    slug = "",
    remark = "",
    password = "",
    expires_in = "0",
    max_views = 0,
    use_proxy = undefined,
    original_filename = undefined,
  } = options || {};

  if (!file) {
    throw new Error("缺少上傳檔案");
  }
  if (!storage_config_id) {
    throw new Error("缺少儲存配置ID");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("storage_config_id", String(storage_config_id));

  if (path) formData.append("path", String(path));
  if (slug) formData.append("slug", String(slug));
  if (remark) formData.append("remark", String(remark));
  if (password) formData.append("password", String(password));
  if (expires_in != null) formData.append("expires_in", String(expires_in));
  if (max_views != null) formData.append("max_views", String(max_views));
  if (use_proxy !== undefined) formData.append("use_proxy", use_proxy ? "true" : "false");
  if (original_filename !== undefined) {
    formData.append("original_filename", original_filename ? "true" : "false");
  }

  return post("share/upload", formData);
}


/******************************************************************************
 * 統一檔案管理API
 ******************************************************************************/

/**
 * 獲取檔案列表（統一介面，自動根據認證資訊處理）
 * @param {number} limit - 每頁條數
 * @param {number} offset - 偏移量
 * @param {Object} options - 額外查詢選項（管理員可用）
 * @returns {Promise<Object>} 檔案列表響應
 */
export async function getFiles(limit = 50, offset = 0, options = {}) {
  const params = { limit, offset, ...options };
  return await get("files", { params });
}

/**
 * 獲取單個檔案詳情（統一介面，自動根據認證資訊處理）
 * @param {string} id - 檔案ID
 * @returns {Promise<Object>} 檔案詳情響應
 */
export async function getFile(id, options = {}) {
  const params = {};
  if (options.includeLinks) {
    params.include = "links";
  }
  const hasParams = Object.keys(params).length > 0;
  return await get(`files/${id}`, hasParams ? { params } : undefined);
}

/**
 * 更新檔案後設資料（統一介面，自動根據認證資訊處理）
 * @param {string} id - 檔案ID
 * @param {Object} metadata - 更新的檔案後設資料
 * @returns {Promise<Object>} 更新響應
 */
export async function updateFile(id, metadata) {
  return await put(`files/${id}`, metadata);
}

/**
 * 批次刪除檔案（統一介面，自動根據認證資訊處理）
 * @param {Array<string>} ids - 檔案ID陣列
 * @param {string} deleteMode - 刪除模式：'record_only' 僅刪除記錄，'both' 同時刪除檔案（預設）
 * @returns {Promise<Object>} 批次刪除響應
 */
export async function batchDeleteFiles(ids, deleteMode = "both") {
  return await del(`files/batch-delete`, { ids, delete_mode: deleteMode });
}

/******************************************************************************
 * 公共檔案訪問API
 ******************************************************************************/

/**
 * 獲取公開檔案資訊
 * @param {string} slug - 檔案短連結
 * @returns {Promise<Object>} 檔案資訊響應
 */
export async function getPublicFile(slug) {
  return await get(`share/get/${slug}`);
}

/**
 * 驗證檔案密碼
 * @param {string} slug - 檔案短連結
 * @param {string} password - 檔案密碼
 * @returns {Promise<Object>} 驗證響應
 */
export async function verifyFilePassword(slug, password) {
  return await post(`share/verify/${slug}`, { password });
}
