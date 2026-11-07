/**
 * 檔案操作 Composable
 * 基於 FS service 提供統一的下載、重新命名、建目錄、批次刪除、獲取直鏈等 UI 邏輯
 */

import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard.js";
import { useFsService } from "@/modules/fs";
import { createLogger } from "@/utils/logger.js";

/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

/**
 * @typedef {Object} FileOperationResult
 * @property {boolean} success
 * @property {string} message
 * @property {string} [url]
 */

export function useFileOperations() {
  const { t } = useI18n();
  const fsService = useFsService();
  const log = createLogger("FileOperations");

  const loading = ref(false);
  const error = ref(/** @type {string | null} */ (null));

  // ===== 下載檔案 =====

  /**
   * 下載檔案
   * @param {string | FsDirectoryItem} pathOrItem - 檔案路徑或檔案物件
   * @returns {Promise<FileOperationResult>}
   */
  const downloadFile = async (pathOrItem) => {
    /** @type {FsDirectoryItem} */
    const item =
      typeof pathOrItem === "string"
        ? { path: pathOrItem, name: pathOrItem.split("/").pop() || pathOrItem, isDirectory: false }
        : pathOrItem;

    if (!item || item.isDirectory) {
      return { success: false, message: t("mount.messages.cannotDownloadDirectory") };
    }

    try {
      loading.value = true;
      error.value = null;

      // 優先使用控制面 /api/fs/get 生成的 downloadUrl
      if (item.downloadUrl) {
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.download = item.name || "";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // 無 downloadUrl 時回退為按需簽發（file-link）下載
        await fsService.downloadFile(item.path, item.name);
      }

      return { success: true, message: t("mount.messages.downloadStarted", { name: item.name }) };
    } catch (err) {
      log.error("下載檔案失敗:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: t("mount.messages.downloadFailed", { name: item.name, message: error.value }) };
    } finally {
      loading.value = false;
    }
  };

  // ===== 重新命名 =====

  /**
   * 重新命名檔案或目錄
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {Promise<FileOperationResult>}
   */
  const renameItem = async (oldPath, newPath) => {
    try {
      loading.value = true;
      error.value = null;

      await fsService.renameItem(oldPath, newPath);
      return { success: true, message: t("mount.messages.renameSuccess") };
    } catch (err) {
      log.error("重新命名失敗:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: error.value || "重新命名失敗" };
    } finally {
      loading.value = false;
    }
  };

  // ===== 建立目錄 =====

  /**
   * 建立目錄
   * @param {string} parentPath
   * @param {string} folderName
   * @returns {Promise<FileOperationResult>}
   */
  const createFolder = async (parentPath, folderName) => {
    try {
      loading.value = true;
      error.value = null;

      const fullPath = parentPath.endsWith("/") ? `${parentPath}${folderName}/` : `${parentPath}/${folderName}/`;

      await fsService.createDirectory(fullPath);
      return { success: true, message: t("mount.messages.createFolderSuccess") };
    } catch (err) {
      log.error("建立資料夾失敗:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: error.value || "建立資料夾失敗" };
    } finally {
      loading.value = false;
    }
  };

  // ===== 批次刪除 =====

  /**
   * 批次刪除檔案/目錄
   * @param {FsDirectoryItem | FsDirectoryItem[] | string} itemsOrItem
   * @returns {Promise<FileOperationResult>}
   */
  const batchDeleteItems = async (itemsOrItem) => {
    let items;
    if (typeof itemsOrItem === "string") {
      items = [{ path: itemsOrItem, name: itemsOrItem.split("/").pop() || itemsOrItem, isDirectory: false }];
    } else if (Array.isArray(itemsOrItem)) {
      items = itemsOrItem;
    } else {
      items = [itemsOrItem];
    }

    if (!items || items.length === 0) {
      return { success: false, message: t("mount.messages.noItemsToDelete") };
    }

    try {
      loading.value = true;
      error.value = null;

      const paths = items.map((item) => item.path);
      await fsService.batchDeleteItems(paths);

      return {
        success: true,
        message: t("mount.messages.batchDeleteSuccess", { count: items.length }),
      };
    } catch (err) {
      log.error("批次刪除失敗:", err);
      error.value = /** @type {any} */ (err)?.message;
      return {
        success: false,
        message: t("mount.messages.batchDeleteFailed", { message: error.value }),
      };
    } finally {
      loading.value = false;
    }
  };

  // ===== 獲取直鏈並複製到剪貼簿 =====

  /**
   * 獲取檔案直鏈並複製到剪貼簿
   * @param {FsDirectoryItem} item
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<FileOperationResult>}
   */
  const getFileLink = async (item, expiresIn = null, forceDownload = true) => {
    if (item.isDirectory) {
      return {
        success: false,
        message: t("mount.messages.directoryNoLink"),
      };
    }

    try {
      loading.value = true;
      error.value = null;

      const url = await fsService.getFileLink(item.path, expiresIn, forceDownload);

      return {
        success: true,
        message: (await copyToClipboard(url)) ? t("mount.messages.linkCopiedSuccess") : t("mount.messages.copyFailed"),
        url,
      };
    } catch (err) {
      log.error("獲取檔案直鏈失敗:", err);
      error.value = /** @type {any} */ (err)?.message;
      return {
        success: false,
        message: error.value || t("mount.messages.getFileLinkError"),
      };
    } finally {
      loading.value = false;
    }
  };

  /**
   * 清理錯誤狀態
   */
  const clearError = () => {
    error.value = null;
  };

  return {
    // 狀態
    loading,
    error,

    // 操作
    downloadFile,
    renameItem,
    createFolder,
    batchDeleteItems,
    getFileLink,
    clearError,
  };
}
