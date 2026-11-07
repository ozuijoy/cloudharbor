/**
 * 文字分享服務API
 * 統一管理所有文字分享相關的API呼叫，包括管理員和API金鑰使用者的操作
 */

import { get, post, put, del } from "../client";
import { API_BASE_URL } from "../config";

/******************************************************************************
 * 公共文字分享API（無需認證）
 ******************************************************************************/

/**
 * 獲取文字分享
 * @param {string} slug - 文字分享連結字尾
 * @param {string} [password] - 訪問密碼（如果需要）
 * @returns {Promise<Object>} 文字分享資料
 */
export function getPaste(slug, password = null) {
  const endpoint = `/paste/${slug}`;

  // 如果提供了密碼，則以POST方式提交
  if (password) {
    return post(endpoint, { password });
  }

  return get(endpoint);
}

/**
 * 獲取文字分享的原始內容連結
 * @param {string} slug - 文字分享連結字尾
 * @param {string} [password] - 訪問密碼（如果需要）
 * @returns {string} 原始文字連結
 */
export function getRawPasteUrl(slug, password = null) {
  // 使用API_BASE_URL常量，不使用API_PREFIX字首
  const baseUrl = `${API_BASE_URL}/api/raw/${slug}`;

  // 如果提供了密碼，新增到URL引數中
  if (password) {
    return `${baseUrl}?password=${encodeURIComponent(password)}`;
  }

  return baseUrl;
}

/******************************************************************************
 * 統一文字分享API
 ******************************************************************************/

/**
 * 建立新的文字分享（管理員或API金鑰使用者）
 * @param {Object} pasteData - 文字分享資料
 * @param {string} pasteData.content - 分享內容
 * @param {string} [pasteData.slug] - 自定義連結字尾（可選）
 * @param {string} [pasteData.remark] - 備註資訊（可選）
 * @param {string} [pasteData.expires_at] - 過期時間，ISO格式（可選）
 * @param {string} [pasteData.password] - 訪問密碼（可選）
 * @param {number} [pasteData.max_views] - 最大檢視次數（可選）
 * @returns {Promise<Object>} 建立結果
 */
export function createPaste(pasteData) {
  // 使用post方法，client.js會自動處理認證頭部
  return post("/paste", pasteData);
}

/**
 * 獲取文字分享列表（統一介面，自動根據認證資訊處理）
 * @param {number} [page=1] - 頁碼（管理員使用）
 * @param {number} [limit=10] - 每頁數量
 * @param {number} [offset=0] - 偏移量（API金鑰使用者使用）
 * @param {Object} options - 額外查詢選項（管理員可用）
 * @returns {Promise<Object>} 文字分享列表
 */
export function getPastes(page = 1, limit = 10, offset = 0, options = {}) {
  // 構建查詢引數
  const params = new URLSearchParams();

  // 管理員使用page引數，API金鑰使用者使用limit和offset
  if (page > 1) {
    params.append("page", page.toString());
  }
  params.append("limit", limit.toString());
  if (offset > 0) {
    params.append("offset", offset.toString());
  }

  // 新增額外的查詢選項（管理員可用）
  Object.keys(options).forEach((key) => {
    if (options[key] !== undefined && options[key] !== null) {
      params.append(key, options[key].toString());
    }
  });

  const queryString = params.toString();
  return get(`/pastes${queryString ? "?" + queryString : ""}`);
}

/**
 * 獲取單個文字分享詳情（統一介面，自動根據認證資訊處理）
 * @param {string} id - 文字分享ID
 * @returns {Promise<Object>} 文字分享詳情
 */
export function getPasteById(id) {
  return get(`/pastes/${id}`);
}

/**
 * 更新文字分享（統一介面，自動根據認證資訊處理）
 * @param {string} slug - 文字分享的唯一標識
 * @param {Object} data - 更新的資料
 * @param {string} [data.content] - 新的文字內容
 * @param {string} [data.password] - 新的訪問密碼
 * @param {boolean} [data.clearPassword] - 是否清除密碼
 * @param {string} [data.remark] - 新的備註
 * @param {string} [data.expires_at] - 新的過期時間
 * @param {number} [data.max_views] - 新的最大檢視次數
 * @param {string} [data.newSlug] - 新的連結字尾，為空則自動生成
 * @returns {Promise<ApiResponse>} - API響應
 */
export function updatePaste(slug, data) {
  return put(`/pastes/${slug}`, data);
}

/**
 * 批次刪除文字分享（統一介面，自動根據認證資訊處理）
 * @param {string[]} ids - 文字分享ID陣列
 * @returns {Promise<Object>} 刪除結果
 */
export function batchDeletePastes(ids) {
  return del("/pastes/batch-delete", { ids });
}

/**
 * 清理所有過期的文字分享（僅管理員）
 * @returns {Promise<Object>} 清理結果
 */
export function clearExpiredPastes() {
  return post("/pastes/clear-expired", { clearExpired: true });
}
