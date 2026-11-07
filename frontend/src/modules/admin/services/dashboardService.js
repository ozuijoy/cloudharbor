import { api } from "@/api";

/**
 * Admin 儀表盤 Service
 *
 * - 封裝 dashboard 統計相關 API 呼叫
 *
 * 不負責：
 * - 圖表配置、文案、展示邏輯
 */
export function useDashboardService() {
  /**
   * 獲取儀表盤統計資料
   */
  const getDashboardStats = async () => {
    const resp = await api.admin.getDashboardStats();
    if (!resp) {
      throw new Error("獲取儀表盤統計資料失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取儀表盤統計資料失敗");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  /**
   * 獲取儲存用量報告
   */
  const getStorageUsageReport = async () => {
    const resp = await api.admin.getStorageUsageReport();
    if (!resp) {
      throw new Error("獲取儲存用量報告失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取儲存用量報告失敗");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  /**
   * 主動重新整理儲存用量快照
   */
  const refreshStorageUsageSnapshots = async (options = {}) => {
    const resp = await api.admin.refreshStorageUsageSnapshots(options);
    if (!resp) {
      throw new Error("重新整理儲存用量快照失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "重新整理儲存用量快照失敗");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  return {
    getDashboardStats,
    getStorageUsageReport,
    refreshStorageUsageSnapshots,
  };
}
