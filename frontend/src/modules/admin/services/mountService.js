import { api } from "@/api";

/** @typedef {import("@/types/admin").MountConfig} MountConfig */

/**
 * Admin 掛載管理 Service
 *
 * - 統一封裝掛載點列表 / 建立 / 更新 / 刪除
 * - 規整返回結構，前端只使用 MountConfig[]
 */
export function useAdminMountService() {
  /**
   * 獲取掛載列表
   * @returns {Promise<MountConfig[]>}
   */
  const getMountsList = async () => {
    const resp = await api.mount.getMountsList();
    if (!resp) {
      throw new Error("獲取掛載列表失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取掛載列表失敗");
      }
      const data = resp.data ?? resp.items ?? resp.records ?? [];
      return Array.isArray(data) ? /** @type {MountConfig[]} */ (data) : [];
    }

    if (Array.isArray(resp)) {
      return /** @type {MountConfig[]} */ (resp);
    }
    if (Array.isArray(resp.data)) {
      return /** @type {MountConfig[]} */ (resp.data);
    }

    return [];
  };

  /**
   * 更新掛載配置
   * @param {string|number} id
   * @param {Partial<MountConfig>} payload
   * @returns {Promise<MountConfig>}
   */
  const updateMount = async (id, payload) => {
    const resp = await api.mount.updateMount(id, payload);
    if (!resp) {
      throw new Error("更新掛載失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新掛載失敗");
      }
      return /** @type {MountConfig} */ (resp.data ?? { id, ...payload });
    }
    return /** @type {MountConfig} */ (resp);
  };

  /**
   * 建立掛載
   * @param {Partial<MountConfig>} payload
   * @returns {Promise<MountConfig>}
   */
  const createMount = async (payload) => {
    const resp = await api.mount.createMount(payload);
    if (!resp) {
      throw new Error("建立掛載失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "建立掛載失敗");
      }
      return /** @type {MountConfig} */ (resp.data ?? resp);
    }
    return /** @type {MountConfig} */ (resp);
  };

  /**
   * 刪除掛載
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteMount = async (id) => {
    const resp = await api.mount.deleteMount(id);
    if (!resp) {
      throw new Error("刪除掛載失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刪除掛載失敗");
      }
    }
    return true;
  };

  return {
    getMountsList,
    updateMount,
    createMount,
    deleteMount,
  };
}

