/**
 * 系統管理服務API
 * 統一管理所有系統相關的API呼叫，包括系統設定、儀表盤統計等
 */

import { get, post, put } from "../client";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("SystemService");

/******************************************************************************
 * 儀表盤統計API
 ******************************************************************************/

/**
 * 獲取儀表盤統計資料
 * @returns {Promise<Object>} 包含文字和檔案數量及儲存空間使用情況的統計資料
 */
export function getDashboardStats() {
  return get("/admin/dashboard/stats");
}

/******************************************************************************
 * 儲存用量報告（管理端）
 ******************************************************************************/

/**
 * 獲取儲存用量報告
 * - 這是獨立介面，不與 dashboard/stats 混用
 * @returns {Promise<Object>}
 */
export function getStorageUsageReport() {
  return get("/admin/storage-usage/report");
}

/**
 * 主動重新整理儲存用量快照
 * - 會觸發後端重新計算並寫入 metrics_cache
 * - 可能會呼叫上游 API(取決於 enable_disk_usage 配置)
 * - 應該由明確觸發(點選重新整理按鈕),不在頁面載入時自動呼叫
 * @param {Object} options
 * @param {number} [options.maxItems=50] - 最多重新整理多少個儲存配置(預設50,最大500)
 * @returns {Promise<Object>} 重新整理結果 { okCount, failCount, failures, total, refreshedAt }
 */
export function refreshStorageUsageSnapshots(options = {}) {
  const params = new URLSearchParams();
  if (options.maxItems && options.maxItems > 0) {
    params.append("maxItems", String(Math.min(options.maxItems, 500)));
  }
  const qs = params.toString();
  return post(`/admin/storage-usage/refresh${qs ? `?${qs}` : ""}`, null);
}

/******************************************************************************
 * 系統資訊API
 ******************************************************************************/

/**
 * 獲取系統最大上傳大小限制
 * @returns {Promise<number>} 最大上傳大小(MB)
 */
export async function getMaxUploadSize() {
  try {
    const response = await get("system/max-upload-size");
    if (response && response.data && response.data.max_upload_size) {
      return response.data.max_upload_size;
    }
    return 100; // 預設值
  } catch (error) {
    log.error("獲取最大上傳大小失敗:", error);
    return 100; // 出錯時返回預設值
  }
}

/**
 * 獲取上傳進度（通用後端進度介面）
 * @param {string} uploadId 上傳ID
 * @returns {Promise<Object>} 進度資訊 { id, loaded, total, completed, path, storageType, updatedAt }
 */
export function getUploadProgress(uploadId) {
  if (!uploadId) {
    throw new Error("uploadId is required");
  }
  const params = new URLSearchParams();
  params.append("upload_id", uploadId);
  return get(`/upload/progress?${params.toString()}`);
}

/******************************************************************************
 * 分組設定管理API
 ******************************************************************************/

/**
 * 按分組獲取設定項
 * @param {number} groupId - 分組ID
 * @param {boolean} includeMetadata - 是否包含後設資料
 * @returns {Promise<Object>} 分組設定響應
 */
export function getSettingsByGroup(groupId, includeMetadata = true) {
  const params = new URLSearchParams();
  params.append("group", groupId.toString());
  if (!includeMetadata) {
    params.append("metadata", "false");
  }
  return get(`/admin/settings?${params.toString()}`);
}

/**
 * 獲取所有分組的設定項
 * @param {boolean} includeSystemGroup - 是否包含系統內部分組
 * @returns {Promise<Object>} 所有分組設定響應
 */
export function getAllSettingsByGroups(includeSystemGroup = false) {
  const params = new URLSearchParams();
  if (includeSystemGroup) {
    params.append("includeSystem", "true");
  }
  return get(`/admin/settings?${params.toString()}`);
}

/**
 * 獲取分組列表和統計資訊
 * @returns {Promise<Object>} 分組資訊響應
 */
export function getGroupsInfo() {
  return get("/admin/settings/groups");
}

/**
 * 獲取設定項後設資料
 * @param {string} key - 設定鍵名
 * @returns {Promise<Object>} 設定後設資料響應
 */
export function getSettingMetadata(key) {
  return get(`/admin/settings/metadata?key=${encodeURIComponent(key)}`);
}

/**
 * 按分組批次更新設定
 * @param {number} groupId - 分組ID
 * @param {Object} settings - 設定鍵值對
 * @param {boolean} validateType - 是否進行型別驗證
 * @returns {Promise<Object>} 更新結果
 */
export function updateGroupSettings(groupId, settings, validateType = true) {
  const params = validateType ? "" : "?validate=false";
  return put(`/admin/settings/group/${groupId}${params}`, settings);
}

/******************************************************************************
 * 系統維護API
 ******************************************************************************/

/**
 * 清理所有過期的文字分享（僅管理員）
 * @returns {Promise<Object>} 清理結果
 */
export function clearExpiredPastes() {
  return post("/pastes/clear-expired", { clearExpired: true });
}

/**
 * 清理目錄快取（管理員）
 * @param {Object} options - 清理選項
 * @param {string} [options.mountId] - 要清理的掛載點ID
 * @param {string} [options.storageConfigId] - 儲存配置ID
 * @returns {Promise<Object>} 清理結果
 */
export function clearCacheAdmin(options = {}) {
  return post("/admin/cache/clear", options);
}

/**
 * 清理目錄快取（API金鑰使用者）
 * @param {Object} options - 清理選項
 * @param {string} [options.mountId] - 要清理的掛載點ID
 * @param {string} [options.storageConfigId] - 儲存配置ID
 * @returns {Promise<Object>} 清理結果
 */
export function clearCacheUser(options = {}) {
  return post("/user/cache/clear", options);
}

/**
 * 獲取快取統計資訊
 * @returns {Promise<Object>} 快取統計資料
 */
export function getCacheStats() {
  return get("/admin/cache/stats");
}

/**
 * 系統健康檢查
 * @returns {Promise<Object>} 健康檢查結果
 */
export function healthCheck() {
  return get("/health");
}

/**
 * 獲取系統版本資訊
 * @returns {Promise<Object>} 版本資訊
 */
export function getVersionInfo() {
  return get("/version");
}

/******************************************************************************
 * 遊客模式相關 API
 ******************************************************************************/

/**
 * 獲取遊客模式配置（Guest API Key）
 * @returns {Promise<Object>} 遊客配置，包含 enabled/key/permissions/basic_path 等
 */
export function getGuestConfig() {
  return get("/public/guest-config");
}
