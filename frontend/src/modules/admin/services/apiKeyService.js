import { api } from "@/api";

/**
 * Admin API Key 管理 Service
 *
 * - 封裝 API Key 的增刪改查
 *
 * 約定：
 * - 成功：返回領域資料（列表 / 單個金鑰 / true）
 * - 失敗：丟擲 Error，由上層統一處理
 */
export function useAdminApiKeyService() {
  /**
   * 獲取全部 API 金鑰列表
   * @returns {Promise<Array>} API 金鑰陣列
   */
  const getAllApiKeys = async () => {
    const resp = await api.admin.getAllApiKeys();
    if (!resp) {
      throw new Error("獲取 API 金鑰列表失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取 API 金鑰列表失敗");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }

    if (Array.isArray(resp)) {
      return resp;
    }
    if (Array.isArray(resp.data)) {
      return resp.data;
    }

    return [];
  };

  /**
   * 刪除單個 API 金鑰
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteApiKey = async (id) => {
    const resp = await api.admin.deleteApiKey(id);
    if (!resp) {
      throw new Error("刪除 API 金鑰失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刪除 API 金鑰失敗");
      }
    }
    return true;
  };

  /**
   * 更新 API 金鑰
   * @param {string|number} id
   * @param {Object} data
   * @returns {Promise<Object>} 更新後的金鑰物件
   */
  const updateApiKey = async (id, data) => {
    const resp = await api.admin.updateApiKey(id, data);
    if (!resp) {
      throw new Error("更新 API 金鑰失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新 API 金鑰失敗");
      }
      return resp.data ?? { id, ...data };
    }
    return resp;
  };

  /**
   * 建立 API 金鑰
   * @returns {Promise<Object>} 新建的金鑰物件
   */
  const createApiKey = async (name, expiresAt, permissionsBitFlag, keyType, customKeyValue, basicPath, readOnly = false) => {
    const resp = await api.admin.createApiKey(name, expiresAt, permissionsBitFlag, keyType, customKeyValue, basicPath, readOnly);
    if (!resp) {
      throw new Error("建立 API 金鑰失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "建立 API 金鑰失敗");
      }
      return resp.data ?? resp;
    }
    return resp;
  };

  /**
   * 獲取指定 API 金鑰的儲存 ACL（storage_config_id 列表）
   * @param {string} id - API 金鑰 ID
   * @returns {Promise<string[]>}
   */
  const getApiKeyStorageAcl = async (id) => {
    const resp = await api.admin.getApiKeyStorageAcl(id);
    if (!resp) {
      throw new Error("獲取儲存 ACL 失敗");
    }

    let payload = resp;
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取儲存 ACL 失敗");
      }
      payload = resp.data ?? resp;
    }

    const ids = payload?.storage_config_ids ?? payload?.storageConfigIds ?? [];
    return Array.isArray(ids) ? ids : [];
  };

  /**
   * 更新指定 API 金鑰的儲存 ACL（整體替換）
   * @param {string} id - API 金鑰 ID
   * @param {string[]} storageConfigIds - 允許訪問的 storage_config_id 列表
   * @returns {Promise<string[]>} 更新後的 storage_config_id 列表
   */
  const updateApiKeyStorageAcl = async (id, storageConfigIds) => {
    const resp = await api.admin.updateApiKeyStorageAcl(id, storageConfigIds);
    if (!resp) {
      throw new Error("更新儲存 ACL 失敗");
    }

    let payload = resp;
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新儲存 ACL 失敗");
      }
      payload = resp.data ?? resp;
    }

    const ids = payload?.storage_config_ids ?? payload?.storageConfigIds ?? [];
    return Array.isArray(ids) ? ids : [];
  };

  return {
    getAllApiKeys,
    deleteApiKey,
    updateApiKey,
    createApiKey,
    getApiKeyStorageAcl,
    updateApiKeyStorageAcl,
  };
}
