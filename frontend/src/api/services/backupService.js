import { get, post } from "../client.js";

/**
 * 備份服務 - 處理資料備份與還原相關的API呼叫
 */
export class BackupService {
  /**
   * 獲取備份模組資訊
   * @returns {Promise<Object>} 模組資訊
   */
  static async getModules() {
    return await get("/admin/backup/modules");
  }

  /**
   * 建立備份
   * @param {Object} options - 備份選項
   * @param {string} options.backup_type - 備份型別 ('full' | 'modules')
   * @param {Array} options.selected_modules - 選中的模組（當backup_type為'modules'時）
   * @returns {Promise<Blob>} 備份檔案
   */
  static async createBackup(options) {
    // 使用專案標準的post方法，但需要特殊處理blob響應
    return post("/admin/backup/create", options, { responseType: "blob" });
  }

  /**
   * 還原備份
   * @param {File} file - 備份檔案
   * @param {string} mode - 還原模式 ('overwrite' | 'merge')
   * @returns {Promise<Object>} 還原結果
   */
  static async restoreBackup(file, mode = "overwrite") {
    const formData = new FormData();
    formData.append("backup_file", file);
    formData.append("mode", mode);

    // 使用專案標準的post方法傳送FormData
    return post("/admin/backup/restore", formData);
  }

  /**
   * 還原預檢查
   * @param {File} file - 備份檔案
   * @param {string} mode - 還原模式 ('overwrite' | 'merge')
   * @param {Object} options
   * @param {boolean} options.skipIntegrityCheck - 是否跳過完整性檢查
   * @param {boolean} options.preserveTimestamps - 是否保留時間戳
   * @returns {Promise<Object>} 預檢查結果
   */
  static async previewRestoreBackup(file, mode = "overwrite", options = {}) {
    const { skipIntegrityCheck = false, preserveTimestamps = false } = options;
    const formData = new FormData();
    formData.append("backup_file", file);
    formData.append("mode", mode);
    formData.append("skipIntegrityCheck", skipIntegrityCheck ? "true" : "false");
    formData.append("preserveTimestamps", preserveTimestamps ? "true" : "false");

    return post("/admin/backup/restore/preview", formData);
  }

  /**
   * 下載備份檔案
   * @param {Blob} blob - 備份資料
   * @param {string} filename - 檔名
   */
  static downloadBackup(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  /**
   * 解析備份檔案預覽資訊
   * @param {File} file - 備份檔案
   * @returns {Promise<Object>} 備份預覽資訊
   */
  static async parseBackupPreview(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const backupData = JSON.parse(e.target.result);
          if (backupData.metadata) {
            resolve(backupData.metadata);
          } else {
            reject(new Error("備份檔案格式錯誤：缺少後設資料"));
          }
        } catch (error) {
          reject(new Error("備份檔案格式錯誤：無效的JSON格式"));
        }
      };

      reader.onerror = () => {
        reject(new Error("檔案讀取失敗"));
      };

      reader.readAsText(file);
    });
  }
}

export default BackupService;
