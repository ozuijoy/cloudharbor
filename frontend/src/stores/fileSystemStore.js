/**
 * 檔案系統 Pinia Store
 * 負責掛載瀏覽器中 FS 目錄瀏覽的核心狀態
 * 支援請求取消機制，最佳化導航體驗
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./authStore.js";
import { useFsService } from "@/modules/fs";
import { createLogger } from "@/utils/logger.js";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */
/** @typedef {import("@/types/fs").FsResolvedMeta} FsResolvedMeta */

export const useFileSystemStore = defineStore("fileSystem", () => {
  const fsService = useFsService();
  const authStore = useAuthStore();
  const log = createLogger("FileSystemStore");

  // ===== 狀態 =====
  const currentPath = ref("/");
  /** @type {import("vue").Ref<FsDirectoryResponse | null>} */
  const directoryData = ref(/** @type {FsDirectoryResponse | null} */ (null));
  const loading = ref(false);
  const error = ref(/** @type {string | null} */ (null));

  // 當前正在載入的路徑（避免重複請求）
  const currentLoadingPath = ref(/** @type {string | null} */ (null));

  // ===== 派生狀態 =====

  /**
   * 檢查當前路徑是否有訪問許可權
   */
  const hasPermissionForCurrentPath = computed(() => authStore.hasPathPermission(currentPath.value));

  /**
   * 目錄條目列表
   * @type {import("vue").ComputedRef<FsDirectoryItem[]>}
   */
  const directoryItems = computed(() => (directoryData.value?.items || []));

  /**
   * 是否為虛擬目錄
   */
  const isVirtualDirectory = computed(() => directoryData.value?.isVirtual || false);

  /**
   * 當前目錄 Meta 資訊
   * @type {import("vue").ComputedRef<FsResolvedMeta | null>}
   */
  const directoryMeta = computed(() => directoryData.value?.meta || null);

  // ===== Actions =====

  /**
   * 載入目錄內容
   * 支援請求取消：當使用者快速導航時，舊請求會被自動取消
   * @param {string} path - 目錄路徑
   * @param {boolean} [force=false] - 是否強制重新整理
   */
  const loadDirectory = async (path, force = false) => {
    const normalizedPath = path || "/";

    // 避免重複請求（同一路徑且非強制重新整理）
    if (!force && currentLoadingPath.value === normalizedPath) {
      log.debug(`目錄 ${normalizedPath} 正在載入中，跳過重複請求`);
      return;
    }

    // 許可權檢查
    if (!authStore.hasPathPermission(normalizedPath)) {
      error.value = `無權訪問路徑: ${normalizedPath}`;
      return;
    }

    // 立即更新當前路徑，讓 UI 先響應（麵包屑等）
    currentPath.value = normalizedPath;

    try {
      loading.value = true;
      currentLoadingPath.value = normalizedPath;
      error.value = null;

      // fsService.getDirectoryList 內部會自動取消之前的請求
      const data = await fsService.getDirectoryList(normalizedPath, { refresh: force });
      
      // 如果請求被取消，data 為 null，不更新狀態
      if (data === null) {
        log.debug("目錄請求被取消，跳過狀態更新:", normalizedPath);
        return;
      }

      // 確保響應對應當前請求的路徑（防止競態）
      if (currentPath.value === normalizedPath) {
        directoryData.value = data;
      }
    } catch (err) {
      // 請求被取消時，靜默處理，不顯示錯誤
      if (/** @type {any} */ (err)?.name === "AbortError" || /** @type {any} */ (err)?.__aborted) {
        log.debug("目錄請求被取消，靜默處理:", normalizedPath);
        return;
      }

      log.error("載入目錄失敗:", err);
      // 針對路徑密碼校驗失敗的場景，不將其視為"普通錯誤"，交給路徑密碼彈窗處理
      if (/** @type {any} */ (err)?.code === "FS_PATH_PASSWORD_REQUIRED") {
        directoryData.value = null;
        error.value = null;
      } else {
        error.value = /** @type {any} */ (err)?.message || "載入目錄失敗";
        directoryData.value = null;
      }
    } finally {
      // 只有當前載入路徑匹配時才清除 loading 狀態
      if (currentLoadingPath.value === normalizedPath) {
        loading.value = false;
        currentLoadingPath.value = null;
      }
    }
  };

  /**
   * 重新整理當前目錄
   */
  const refreshDirectory = async () => {
    if (currentPath.value) {
      await loadDirectory(currentPath.value, true);
    }
  };

  /**
   * 重置狀態（退出登入 / 切換使用者時使用）
   */
  const resetState = () => {
    currentPath.value = "/";
    directoryData.value = null;
    loading.value = false;
    error.value = null;
    currentLoadingPath.value = null;
    fsService.cancelAllRequests();
  };

  return {
    // 狀態
    currentPath,
    directoryData,
    loading,
    error,

    // 派生狀態
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,
    directoryMeta,

    // Actions
    loadDirectory,
    refreshDirectory,
    resetState,
  };
});
