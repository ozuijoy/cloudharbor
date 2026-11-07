import { api } from "@/api";

/** @typedef {import("@/types/admin").AdminStorageConfig} AdminStorageConfig */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * Admin 儲存配置 Service
 *
 * - 統一封裝儲存配置相關 API（列表 / 新增 / 更新 / 刪除 / 設為預設 / 測試）
 * - 對多種後端返回結構做規範化，前端只看到統一的 DTO
 */
export function useAdminStorageConfigService() {
  /**
   * 獲取儲存配置列表
   * @param {{page?:number,limit?:number}} [params]
   * @returns {Promise<{items: AdminStorageConfig[], pagination: PaginationInfo}>}
   */
  const getStorageConfigs = async (params = {}) => {
    const resp = await api.admin.getStorageConfigs(params);
    if (!resp) {
      throw new Error("獲取儲存配置列表失敗");
    }

    let payload = resp;
    let total = resp?.total;

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取儲存配置列表失敗");
      }
      payload = resp.data ?? resp;
      if (typeof resp.total === "number") {
        total = resp.total;
      }
    }

    let dataBlock = payload;
    if (!Array.isArray(dataBlock)) {
      dataBlock =
        payload?.data && Array.isArray(payload.data)
          ? payload.data
          : payload?.items && Array.isArray(payload.items)
          ? payload.items
          : payload?.records && Array.isArray(payload.records)
          ? payload.records
          : payload?.data?.items && Array.isArray(payload.data.items)
          ? payload.data.items
          : payload;
    }

    /** @type {AdminStorageConfig[]} */
    const items = Array.isArray(dataBlock) ? dataBlock : [];

    if (typeof total !== "number") {
      total = typeof payload?.total === "number" ? payload.total : items.length;
    }

    const page = typeof params.page === "number" ? params.page : 1;
    const limit = typeof params.limit === "number" ? params.limit : items.length || 10;

    /** @type {PaginationInfo} */
    const pagination = {
      page,
      limit,
      total,
    };

    return {
      items,
      pagination,
    };
  };

  /**
   * 獲取儲存配置明文/掩碼檢視
   * @param {number|string} id
   * @param {"masked"|"plain"} mode
   * @returns {Promise<AdminStorageConfig>}
   */
  const getStorageConfigReveal = async (id, mode = "masked") => {
    const resp = await api.storage.getStorageConfigReveal(id, mode);
    if (!resp) {
      throw new Error("獲取儲存配置詳情失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取儲存配置詳情失敗");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? resp);
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 建立儲存配置
   * @param {Partial<AdminStorageConfig>} data
   * @returns {Promise<AdminStorageConfig>}
   */
  const createStorageConfig = async (data) => {
    const resp = await api.admin.createStorageConfig(data);
    if (!resp) {
      throw new Error("建立儲存配置失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "建立儲存配置失敗");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? data);
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 更新儲存配置
   * @param {number|string} id
   * @param {Partial<AdminStorageConfig>} data
   * @returns {Promise<AdminStorageConfig>}
   */
  const updateStorageConfig = async (id, data) => {
    const resp = await api.admin.updateStorageConfig(id, data);
    if (!resp) {
      throw new Error("更新儲存配置失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新儲存配置失敗");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? { id, ...data });
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 刪除儲存配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const deleteStorageConfig = async (id) => {
    const resp = await api.admin.deleteStorageConfig(id);
    if (!resp) {
      throw new Error("刪除儲存配置失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刪除儲存配置失敗");
      }
    }
    return true;
  };

  /**
   * 設為預設儲存配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const setDefaultStorageConfig = async (id) => {
    const resp = await api.admin.setDefaultStorageConfig(id);
    if (!resp) {
      throw new Error("設定預設儲存配置失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "設定預設儲存配置失敗");
      }
    }
    return true;
  };

  /**
   * 測試儲存配置連通性
   * @param {number|string} id
   * @returns {Promise<Object>}
   */
  const testStorageConfig = async (id) => {
    const resp = await api.admin.testStorageConfig(id);
    if (!resp) {
      throw new Error("測試儲存配置失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "測試儲存配置失敗");
      }
      return resp.data;
    }
    throw new Error("測試儲存配置失敗：響應結構無效");
  };

  return {
    getStorageConfigs,
    getStorageConfigReveal,
    createStorageConfig,
    updateStorageConfig,
    deleteStorageConfig,
    setDefaultStorageConfig,
    testStorageConfig,
  };
}
