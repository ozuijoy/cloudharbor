/**
 * 認證服務API
 * 統一管理所有認證相關的API呼叫，包括管理員登入、API金鑰驗證等
 */

import { get, post, put, del } from "../client";

/******************************************************************************
 * 管理員認證相關API
 ******************************************************************************/

/**
 * 管理員登入
 * @param {string} username - 使用者名稱
 * @param {string} password - 密碼
 * @returns {Promise<Object>} 登入結果（包含token）
 */
export function adminLogin(username, password) {
  return post("/admin/login", { username, password });
}

/**
 * 管理員登出
 * @returns {Promise<Object>} 登出結果
 */
export function adminLogout() {
  return post("/admin/logout");
}

/**
 * 檢查管理員登入狀態
 * @returns {Promise<Object>} 登入狀態
 */
export function checkAdminLogin() {
  return get("/test/admin-token");
}

/**
 * 更改管理員密碼
 * @param {string} currentPassword - 當前密碼
 * @param {string} newPassword - 新密碼
 * @param {string} [newUsername] - 新使用者名稱（可選）
 * @returns {Promise<Object>} 更新結果
 */
export function changeAdminPassword(currentPassword, newPassword, newUsername) {
  return post("/admin/change-password", {
    currentPassword,
    newPassword,
    newUsername,
  });
}

/******************************************************************************
 * API金鑰認證相關API
 ******************************************************************************/

/**
 * 驗證API金鑰
 * @returns {Promise<Object>} 驗證結果，包含許可權和金鑰資訊
 */
export function verifyApiKey() {
  return get("/test/api-key");
}

/******************************************************************************
 * API金鑰管理相關API（管理員功能）
 ******************************************************************************/

/**
 * 獲取所有API金鑰
 * @returns {Promise<Object>} API金鑰列表
 */
export function getAllApiKeys() {
  return get("/admin/api-keys");
}

/**
 * 建立新的API金鑰
 * @param {string} name - 金鑰名稱
 * @param {string} [expiresAt] - 過期時間，ISO格式字串
 * @param {number} [permissions=0] - 位標誌許可權值
 * @param {string} [role="GENERAL"] - 使用者角色
 * @param {string} [customKey] - 自定義金鑰（可選，僅限字母、數字、橫槓和下劃線）
 * @param {string} [basicPath="/"] - 基本路徑（可選，預設為根路徑'/'）
 * @returns {Promise<Object>} 新建立的API金鑰資訊
 */
export function createApiKey(name, expiresAt, permissions = 0, role = "GENERAL", customKey = null, basicPath = "/") {
  return post("/admin/api-keys", {
    name,
    expires_at: expiresAt,
    permissions,
    role,
    custom_key: customKey,
    basic_path: basicPath,
  });
}

/**
 * 刪除API金鑰
 * @param {string} keyId - 要刪除的金鑰ID
 * @returns {Promise<Object>} 刪除結果
 */
export function deleteApiKey(keyId) {
  return del(`/admin/api-keys/${keyId}`);
}

/**
 * 更新API金鑰
 * @param {string} keyId - 要更新的金鑰ID
 * @param {Object} updateData - 要更新的資料
 * @param {string} [updateData.name] - 新的金鑰名稱
 * @param {number} [updateData.permissions] - 位標誌許可權值
 * @param {string} [updateData.role] - 使用者角色
 * @param {string} [updateData.basic_path] - 基本路徑
 * @param {boolean} [updateData.is_enable] - 是否啟用
 * @param {string} [updateData.expires_at] - 新的過期時間，ISO格式字串
 * @returns {Promise<Object>} 更新結果
 */
export function updateApiKey(keyId, updateData) {
  return put(`/admin/api-keys/${keyId}`, updateData);
}

/**
 * 獲取指定 API 金鑰的儲存 ACL（可訪問的 storage_config_id 白名單）
 * @param {string} keyId - API 金鑰 ID
 * @returns {Promise<Object>} 儲存 ACL 資訊
 */
export function getApiKeyStorageAcl(keyId) {
  return get(`/admin/api-keys/${keyId}/storage-acl`);
}

/**
 * 更新指定 API 金鑰的儲存 ACL（整體替換）
 * @param {string} keyId - API 金鑰 ID
 * @param {string[]} storageConfigIds - 允許訪問的 storage_config_id 列表
 * @returns {Promise<Object>} 更新後的 ACL 資訊
 */
export function updateApiKeyStorageAcl(keyId, storageConfigIds) {
  return put(`/admin/api-keys/${keyId}/storage-acl`, {
    storage_config_ids: Array.isArray(storageConfigIds) ? storageConfigIds : [],
  });
}

// 相容性匯出 - 保持向後相容
export const login = adminLogin;
export const logout = adminLogout;
export const checkLogin = checkAdminLogin;
export const changePassword = changeAdminPassword;
export const getApiKeys = getAllApiKeys;
