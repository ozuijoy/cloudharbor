/**
 * FS Meta 元資訊服務
 */
import { get, post, put, del } from "../client.js";

/**
 * 獲取所有元資訊記錄
 * @returns {Promise<Array>}
 */
export async function getAllFsMeta() {
  return await get("/fs-meta/list");
}

/**
 * 獲取單個元資訊記錄
 * @param {number} id
 * @returns {Promise<Object>}
 */
export async function getFsMetaById(id) {
  return await get(`/fs-meta/${id}`);
}

/**
 * 建立元資訊記錄
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function createFsMeta(data) {
  return await post("/fs-meta/create", data);
}

/**
 * 更新元資訊記錄
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<void>}
 */
export async function updateFsMeta(id, data) {
  return await put(`/fs-meta/${id}`, data);
}

/**
 * 刪除元資訊記錄
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteFsMeta(id) {
  return await del(`/fs-meta/${id}`);
}

/**
 * 驗證路徑密碼
 * @param {string} path - 目錄路徑
 * @param {string} password - 密碼
 * @returns {Promise<{verified: boolean, token?: string, message: string}>}
 */
export async function verifyFsMetaPassword(path, password) {
  const response = await post("/fs/meta/password/verify", { path, password });

  if (response && typeof response === "object" && "data" in response) {
    const data = /** @type {{ verified: boolean; token?: string|null; requiresPassword?: boolean; path?: string }} */ (
      response.data
    );
    return {
      verified: Boolean(data.verified),
      token: data.token ?? null,
      requiresPassword: data.requiresPassword ?? Boolean(data.token),
      path: data.path ?? path,
      message: response.message || "密碼驗證成功",
    };
  }

  // 相容舊格式，直接返回原始響應
  return response;
}
