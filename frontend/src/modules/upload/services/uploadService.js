import { api } from "@/api";

/**
 * Upload 領域 Service
 *
 * - 提供與上傳頁相關的輔助資料訪問（例如最近上傳檔案）
 *
 * 不負責：
 * - UI 文案、狀態管理與許可權判斷
 */
export function useUploadService() {
 /**
  * 獲取最近上傳的檔案列表
  *
  * @param {number} limit - 返回的最大條數
  */
  const getRecentFiles = async (limit = 5) => {
    const response = await api.file.getFiles(limit, 0);
    const list = response?.data?.files || [];

    // 與原有 UploadView 保持一致：按 created_at 倒序排序
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  /**
   * 獲取系統配置的最大上傳大小（單位：MB）
   * 由 API 層負責處理預設值與錯誤日誌，這裡直接透傳結果
   */
  const getMaxUploadSize = async () => {
    return api.file.getMaxUploadSize();
  };

  return {
    getRecentFiles,
    getMaxUploadSize,
  };
}
