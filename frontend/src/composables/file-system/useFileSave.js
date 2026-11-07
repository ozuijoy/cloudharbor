/**
 * 處理檔案儲存相關的邏輯，使用統一的檔案系統API
 */

import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

export function useFileSave() {
  const { t } = useI18n();
  const log = createLogger("FileSave");

  // 儲存狀態
  const isSaving = ref(false);
  const saveError = ref(null);

  /**
   * 儲存檔案內容
   * @param {string} filePath - 檔案路徑
   * @param {string} fileName - 檔名
   * @param {string} content - 檔案內容
   * @param {string} currentPath - 當前目錄路徑
   * @returns {Promise<Object>} 儲存結果
   */
  const saveFile = async (filePath, fileName, content, currentPath) => {
    try {
      isSaving.value = true;
      saveError.value = null;

      log.debug("儲存檔案:", {
        filePath,
        fileName,
        contentLength: content.length,
        currentPath,
      });

      const response = await api.fs.updateFile(filePath, content);

      if (response && response.success) {
        log.debug("檔案儲存成功:", response);

        return {
          success: true,
          message: t("mount.messages.fileSaveSuccess", { name: fileName }),
          data: response.data
        };
      } else {
        throw new Error(response?.message || t("mount.messages.fileSaveFailed"));
      }
      
    } catch (error) {
      log.error("儲存檔案失敗:", error);
      saveError.value = error.message || t("mount.messages.fileSaveFailed");
      
      return {
        success: false,
        message: saveError.value,
        error: error
      };
    } finally {
      isSaving.value = false;
    }
  };

  /**
   * 清除錯誤狀態
   */
  const clearSaveError = () => {
    saveError.value = null;
  };

  return {
    // 狀態
    isSaving,
    saveError,

    // 方法
    saveFile,
    clearSaveError,
  };
}
