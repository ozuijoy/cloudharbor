/**
 * 掛載點管理服務API
 * 統一管理所有掛載點相關的API呼叫，包括管理員和API金鑰使用者的操作
 */

import { get, post, put, del } from "../client";

/******************************************************************************
 * 管理員掛載點管理API
 ******************************************************************************/

/**
 * 獲取掛載點列表（統一API）
 * 根據使用者許可權自動返回相應資料：
 * - 管理員：所有掛載點（包括禁用的）
 * - API金鑰使用者：有許可權的活躍掛載點
 * @returns {Promise<Object>} 掛載點列表響應物件
 */
export async function getMountsList() {
  return get("/mount/list");
}

/**
 * 建立新掛載點（僅管理員）
 * @param {Object} mountData 掛載點資料
 * @returns {Promise<Object>} 建立結果響應物件
 */
export async function createMount(mountData) {
  return post("/mount/create", mountData);
}

/**
 * 更新掛載點（僅管理員）
 * @param {string} id 掛載點ID
 * @param {Object} mountData 掛載點更新資料
 * @returns {Promise<Object>} 更新結果響應物件
 */
export async function updateMount(id, mountData) {
  return put(`/mount/${id}`, mountData);
}

/**
 * 刪除掛載點（僅管理員）
 * @param {string} id 掛載點ID
 * @returns {Promise<Object>} 刪除結果響應物件
 */
export async function deleteMount(id) {
  return del(`/mount/${id}`);
}

/**
 * 獲取所有支援的儲存型別及其能力與配置後設資料
 * 對映後端 /api/storage-types
 */
export async function getStorageTypes() {
  return get("/storage-types");
}

/**
 * 獲取掛載點配置Schema
 * 用於前端動態表單渲染
 * @returns {Promise<Object>} Schema配置物件
 */
export async function getMountSchema() {
  return get("/mount-schema");
}

// 相容性匯出 - 保持向後相容
