import { api } from "@/api";

/**
 * Admin 系統相關 Service
 *
 * - 統一封裝所有 api.system 相關呼叫
 * - 為 settings / dashboard 等檢視提供資料訪問介面
 *
 * 約定：
 * - 成功返回“領域資料”（陣列 / 物件 / 布林）
 * - 失敗丟擲 Error，由呼叫方統一處理
 */
export function useAdminSystemService() {
  /**
   * 按分組獲取系統設定
   *
   * @param {number} groupId 分組 ID
   * @param {boolean} [includeSecrets=true] 是否包含敏感欄位
   * @returns {Promise<Array<{key:string,value:string}>>}
   */
  const getSettingsByGroup = async (groupId, includeSecrets = true) => {
    const resp = await api.system.getSettingsByGroup(groupId, includeSecrets);
    if (!resp) {
      throw new Error("獲取系統設定失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取系統設定失敗");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }
    return Array.isArray(resp) ? resp : [];
  };

  /**
   * 按分組批次更新系統設定
   *
   * @param {number} groupId 分組 ID
   * @param {Object} data 設定鍵值對
   * @param {boolean} [includeSecrets] 是否包含敏感欄位
   * @returns {Promise<void>}
   */
  const updateGroupSettings = async (groupId, data, includeSecrets) => {
    const resp = await api.system.updateGroupSettings(groupId, data, includeSecrets);
    if (!resp) {
      throw new Error("更新系統設定失敗");
    }
    if (typeof resp === "object" && "success" in resp && !resp.success) {
      throw new Error(resp.message || "更新系統設定失敗");
    }
  };

  /**
   * 獲取快取統計資訊
   * @returns {Promise<Object>} cache 統計物件
   */
  const getCacheStats = async () => {
    const resp = await api.system.getCacheStats();
    if (!resp) {
      throw new Error("獲取快取統計資訊失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取快取統計資訊失敗");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * 獲取系統版本與環境資訊
   * @returns {Promise<Object>} version 資訊物件
   */
  const getVersionInfo = async () => {
    const resp = await api.system.getVersionInfo();
    if (!resp) {
      throw new Error("獲取版本資訊失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取版本資訊失敗");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * 清理快取（無引數 = 清理全部快取）
   * @returns {Promise<Object>} 清理結果（用於展示統計）
   */
  const clearCache = async () => {
    const resp = await api.admin.clearCache();
    if (!resp) {
      throw new Error("清理快取失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "清理快取失敗");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * Global Settings（分組 ID = 1）
   */
  const getGlobalSettings = () => getSettingsByGroup(1, true);
  const updateGlobalSettings = (data) => updateGroupSettings(1, data, true);

  /**
   * Preview Settings（分組 ID = 2）
   */
  const getPreviewSettings = () => getSettingsByGroup(2, true);
  const updatePreviewSettings = (data) => updateGroupSettings(2, data, true);

  /**
   * WebDAV Settings（分組 ID = 3）
   */
  const getWebdavSettings = () => getSettingsByGroup(3, true);
  const updateWebdavSettings = (data) => updateGroupSettings(3, data, true);

  /**
   * Site Settings（分組 ID = 4）
   */
  const getSiteSettings = () => getSettingsByGroup(4, true);
  const updateSiteSettings = (data) => updateGroupSettings(4, data);

  return {
    getSettingsByGroup,
    updateGroupSettings,
    getCacheStats,
    getVersionInfo,
    clearCache,
    getGlobalSettings,
    updateGlobalSettings,
    getPreviewSettings,
    updatePreviewSettings,
    getWebdavSettings,
    updateWebdavSettings,
    getSiteSettings,
    updateSiteSettings,
  };
}
