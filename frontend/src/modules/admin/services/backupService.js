import BackupService from "@/api/services/backupService.js";

/**
 * Admin 備份 Service
 *
 * - 封裝所有後臺備份 / 恢複相關的 API 呼叫
 * - 為 BackupView 等檢視提供語義化方法
 *
 * 不負責：
 * - UI 文案、通知、檔案下載 DOM 操作（這些留給檢視層處理）
 */
export function useAdminBackupService() {
  /**
   * 獲取可備份模組資訊
   */
  const getModules = () => {
    return BackupService.getModules();
  };

  /**
   * 建立備份（完整 / 指定模組）
   * 直接返回後端的 Blob 響應，由呼叫方負責下載與解析
   */
  const createBackup = (options) => {
    return BackupService.createBackup(options);
  };

  /**
   * 恢復備份
   */
  const restoreBackup = (file, mode = "overwrite") => {
    return BackupService.restoreBackup(file, mode);
  };

  /**
   * 還原預檢查
   */
  const previewRestoreBackup = (file, mode = "overwrite", options = {}) => {
    return BackupService.previewRestoreBackup(file, mode, options);
  };

  return {
    getModules,
    createBackup,
    restoreBackup,
    previewRestoreBackup,
  };
}
