import { ref, reactive, computed } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard.js";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";
import { useAdminBase } from "@/modules/admin";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { useFileShareStore } from "@/modules/fileshare/fileShareStore.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FileManagement");

/**
 * 檔案管理專用composable
 * 基於useAdminBase，新增檔案管理特有的邏輯
 * @param {string} userType - 使用者型別 'admin' 或 'apikey'
 * @param {Object} options - 配置選項
 * @param {Function} options.confirmFn - 確認對話方塊函式（必需）
 */
export function useFileManagement(userType = "admin", { confirmFn } = {}) {
  if (!confirmFn) {
    throw new Error("useFileManagement 必須傳入 confirmFn（請在 View 裡用 useConfirmDialog + createConfirmFn 建立）");
  }
  // 繼承基礎管理功能
  const base = useAdminBase("file-management");

  // 國際化
  const { t } = useI18n();

  const fileshareService = useFileshareService();
  const fileShareStore = useFileShareStore();
  // 檔案管理特有狀態（列表統一由 fileshare store 提供）
  const files = computed(() => fileShareStore.items);
  const editingFile = ref(null);
  const previewFile = ref(null);
  const showEdit = ref(false);
  const showPreview = ref(false);
  const showQRCodeModal = ref(false);
  const qrCodeDataURL = ref("");
  const qrCodeSlug = ref("");

  // 刪除設定store
  const deleteSettingsStore = useDeleteSettingsStore();

  // 使用者型別判斷
  const isAdmin = () => userType === "admin";
  const isApiKeyUser = () => userType === "apikey";

  // 搜尋狀態（服務端搜尋）
  const searchQuery = ref("");
  const isSearchMode = ref(false);
  const searchLoading = ref(false);




  /**
   * 載入檔案列表
   */
  const loadFiles = async () => {
    return await base.withLoading(async () => {
      try {
        const { pagination } = await fileShareStore.loadList({
          limit: base.pagination.limit,
          offset: base.pagination.offset,
        });
        base.updatePagination(pagination, "offset");
        base.updateLastRefreshTime();
      } catch (error) {
        log.error("載入檔案列表失敗:", error);
        base.showError(error.message || "載入資料失敗");
        fileShareStore.resetState();
      }
    });
  };

  /**
   * 處理分頁變化
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    loadFiles();
  };

  /**
   * 刪除單個檔案
   */
  const handleFileDelete = async (file) => {
    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: `"${file.filename}"` }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    return await base.withLoading(async () => {
      await fileshareService.deleteFiles([file.id], deleteSettingsStore.getDeleteMode());
      base.showSuccess("刪除成功");
      fileShareStore.removeFromStore(file.id);
      await loadFiles();
    });
  };

  /**
   * 批次刪除檔案
   */
  const handleBatchDelete = async () => {
    const selectedCount = base.selectedItems.value.length;
    if (selectedCount === 0) {
      base.showError("請先選擇要刪除的檔案");
      return;
    }

    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteMultiple", { count: selectedCount }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    return await base.withLoading(async () => {
      try {
        const result = await fileshareService.deleteFiles(base.selectedItems.value, deleteSettingsStore.getDeleteMode());

        if (result?.data && Array.isArray(result.data.failed) && result.data.failed.length > 0) {
          const { success: successCount, failed } = result.data;
          const failedCount = failed.length;
          base.showSuccess(`批次刪除完成：成功 ${successCount} 個，失敗 ${failedCount} 個`);

          const failedDetails = failed.map((item) => `ID: ${item.id} - ${item.error}`).join("\n");
          log.warn("部分檔案刪除失敗:", failedDetails);
        } else if (result?.data && typeof result.data.success === "number") {
          base.showSuccess(`成功刪除 ${result.data.success} 個檔案`);
        } else {
          base.showSuccess(`成功刪除 ${selectedCount} 個檔案`);
        }
      } finally {
        base.clearSelection();
        await loadFiles();
      }
    });
  };

  /**
   * 開啟編輯彈窗
   */
  const openEditModal = async (file) => {
    try {
      const detail = await fileShareStore.fetchById(file.id, { useCache: false });
      editingFile.value = detail;
      showEdit.value = true;
    } catch (err) {
      log.error("獲取檔案詳情失敗:", err);
      base.showError(err.message || "獲取檔案詳情失敗，請稍後重試");
    }
  };

/**
   * 更新檔案後設資料
   */
  const updateFileMetadata = async (updatedFile) => {
    return await base.withLoading(async () => {
      try {
        await fileshareService.updateFileMetadata(updatedFile.id, updatedFile);
        base.showSuccess("檔案資訊更新成功");
        showEdit.value = false;
        editingFile.value = null;
        await loadFiles();
      } catch (err) {
        log.error("更新檔案資訊失敗:", err);
        base.showError(err.message || "更新失敗");
      }
    });
  };

  /**
   * 開啟預覽彈窗
   */
  const openPreviewModal = async (file) => {
    try {
      const detail = await fileShareStore.fetchById(file.id, { useCache: false, includeLinks: true });
      previewFile.value = detail;
      showPreview.value = true;
    } catch (err) {
      log.error("獲取檔案詳情失敗:", err);
      base.showError(err.message || "獲取檔案詳情失敗，請稍後重試");
    }
  };

  /**
   * 生成QR碼
   */
  const generateQRCode = async (file, darkMode = false) => {
    try {
      const fileUrl = fileshareService.buildShareUrl(file, window.location.origin);

      qrCodeDataURL.value = await createQRCodeImage(fileUrl, { darkMode });

      qrCodeSlug.value = file.slug;
      showQRCodeModal.value = true;
    } catch (err) {
      log.error("生成二維碼失敗:", err);
      base.showError("生成二維碼失敗");
    }
  };

  /**
   * 切換全選狀態（檔案管理專用）
   */
  const toggleSelectAll = () => {
    base.toggleSelectAll(files.value, "id");
  };

  /**
   * 複製檔案分享連結
   */
  const copyFileLink = async (file) => {
    if (!file || !file.slug) {
      base.showError("該檔案沒有有效的分享連結");
      return;
    }

    try {
      const fileUrl = fileshareService.buildShareUrl(file, window.location.origin);

      const ok = await copyToClipboard(fileUrl);
      if (ok) {
        base.showSuccess("分享連結已複製");
      }
    } catch (err) {
      log.error("複製連結失敗:", err);
      // 只在失敗時顯示錯誤提示，成功時不顯示頂部提示
      base.showError("複製連結失敗，請手動複製");
    }
  };

  /**
   * 確保檔案物件包含 previewUrl/downloadUrl（必要時按需拉取 include=links）
   * @param {any} file
   * @returns {Promise<any>}
   */
  const ensureLinks = async (file) => {
    if (!file || !file.id) return file;
    if (file.previewUrl || file.downloadUrl) return file;
    const detail = await fileShareStore.fetchById(file.id, { useCache: true, includeLinks: true });
    return detail || file;
  };

  /**
   * 複製檔案永久下載連結
   */
  const copyPermanentLink = async (file) => {
    if (!file || !file.slug) {
      base.showError("該檔案沒有有效的分享連結");
      return;
    }

    try {
      const detail = await ensureLinks(file);
      // 使用統一的 Down 路由構造永久下載連結
      const permanentDownloadUrl = fileshareService.getPermanentDownloadUrl(detail);
      if (!permanentDownloadUrl) {
        throw new Error("無法獲取檔案的下載連結");
      }

      await copyToClipboard(permanentDownloadUrl);
      base.showSuccess("下載直鏈已複製");
    } catch (err) {
      log.error("複製永久連結失敗:", err);
      base.showError(err.message || "複製永久連結失敗，請稍後重試");
    }
  };

/**
   * 獲取Office檔案預覽URL
   */
  const getOfficePreviewUrl = async (file) => {
    if (!file?.slug) return null;

    try {
      return await fileshareService.getOfficePreviewUrl(file);
    } catch (error) {
      log.error("獲取Office預覽URL失敗:", error);
      base.showError(`預覽失敗: ${error.message}`);
      return null;
    }
  };

/**
   * 預覽檔案
   */
  const previewFileInNewWindow = async (file) => {
    if (!file.slug) {
      base.showError("無法預覽：檔案沒有設定短連結");
      return;
    }

    try {
      const detail = await ensureLinks(file);
      // 檢查是否為Office檔案
      const { FileType } = await import("@/utils/fileTypes.js");
      if (detail.type === FileType.OFFICE) {
        // 獲取Office預覽URL
        const officePreviewUrl = await getOfficePreviewUrl(detail);
        if (officePreviewUrl) {
          window.open(officePreviewUrl, "_blank");
        }
        return;
      }

      // 非Office檔案使用普通預覽方式
      const previewUrl = getPermanentViewUrl(detail);
      if (!previewUrl) {
        throw new Error("無法獲取檔案的預覽連結");
      }
      window.open(previewUrl, "_blank");
    } catch (err) {
      log.error("預覽檔案失敗:", err);
      base.showError("預覽檔案失敗，請稍後重試");
    }
  };

  /**
   * 下載檔案
   */
  const downloadFileDirectly = async (file) => {
    try {
      // 檢查是否有永久下載連結
      if (!file.slug) {
        base.showError("無法下載：檔案沒有設定短連結");
        return;
      }

      const detail = await ensureLinks(file);

      // 提取檔名，用於下載時的檔案命名
      const fileName = detail.filename || "下載檔案";

      // 建立一個隱藏的a標籤
      const link = document.createElement("a");
      const downloadUrl = getPermanentDownloadUrl(detail);
      if (!downloadUrl) {
        throw new Error("無法獲取檔案的下載連結");
      }
      link.href = downloadUrl;
      link.download = fileName; // 設定下載檔名
      link.setAttribute("target", "_blank"); // 在新視窗開啟
      document.body.appendChild(link);

      // 模擬點選下載
      link.click();

      // 移除臨時建立的元素
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    } catch (err) {
      log.error("下載檔案失敗:", err);
      // 如果直接下載失敗，嘗試在新視窗開啟下載連結
      if (file.slug) {
        try {
          const detail = await ensureLinks(file);
          window.open(getPermanentDownloadUrl(detail), "_blank");
        } catch {
          window.open(getPermanentDownloadUrl(file), "_blank");
        }
      } else {
        window.open(file.publicUrl || "", "_blank");
      }
    }
  };

  /**
   * 獲取檔案的永久下載連結
   */
  const getPermanentDownloadUrl = (file) => {
    return fileshareService.getPermanentDownloadUrl(file);
  };

/**
   * 獲取檔案的永久預覽連結
   */
  const getPermanentViewUrl = (file) => {
    return fileshareService.getPermanentPreviewUrl(file);
  };

/**
   * 搜尋檔案
   * @param {string} searchTerm - 搜尋關鍵詞
   * @param {number} offset - 偏移量，預設為當前分頁的offset
   * @returns {Promise<Object>} 搜尋結果
   */
  const searchFiles = async (searchTerm, offset = null) => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { files: [], pagination: { total: 0, limit: base.pagination.limit, offset: 0 } };
    }

    const searchOffset = offset !== null ? offset : base.pagination.offset;

    return await base.withLoading(async () => {
      try {
        const { files: results, pagination } = await fileShareStore.loadList({
          limit: base.pagination.limit,
          offset: searchOffset,
          search: searchTerm.trim(),
        });
        return { files: results, pagination };
      } catch (error) {
        log.error("搜尋檔案失敗:", error);
        base.showError(error.message || "搜尋失敗");
        return { files: [], pagination: { total: 0, limit: base.pagination.limit, offset: searchOffset } };
      }
    });
  };

  /**
   * 處理全域性搜尋（服務端）
   * - 規則：少於 2 個字視為“未搜尋”
   */
  const handleGlobalSearch = async (value) => {
    searchQuery.value = value;

    if (!value || value.trim().length < 2) {
      await clearSearch();
      return;
    }

    try {
      searchLoading.value = true;
      isSearchMode.value = true;

      base.resetPagination();
      const result = await searchFiles(value.trim(), 0);
      base.updatePagination(result.pagination || { total: files.value.length, limit: base.pagination.limit, offset: 0 }, "offset");
      base.updateLastRefreshTime();
    } finally {
      searchLoading.value = false;
    }
  };

  /**
   * 清除搜尋，回到正常分頁列表
   */
  const clearSearch = async () => {
    searchQuery.value = "";
    isSearchMode.value = false;
    base.resetPagination();
    await loadFiles();
  };

  /**
   * 分頁變化（支援搜尋模式）
   */
  const handleOffsetChangeWithSearch = async (newOffset) => {
    if (isSearchMode.value && searchQuery.value) {
      try {
        searchLoading.value = true;
        const result = await searchFiles(searchQuery.value, newOffset);
        base.updatePagination(result.pagination || { total: files.value.length, limit: base.pagination.limit, offset: newOffset }, "offset");
      } finally {
        searchLoading.value = false;
      }
      return;
    }

    handleOffsetChange(newOffset);
  };

  /**
   * 每頁數量變化（支援搜尋模式）
   */
  const handlePageSizeChange = async (newPageSize) => {
    base.changePageSize(newPageSize);
    if (isSearchMode.value && searchQuery.value) {
      await handleGlobalSearch(searchQuery.value);
      return;
    }
    await loadFiles();
  };

  /**
   * 重新整理當前列表（保持搜尋/分頁狀態）
   */
  const refreshFiles = async () => {
    if (isSearchMode.value && searchQuery.value) {
      try {
        searchLoading.value = true;
        const result = await searchFiles(searchQuery.value, base.pagination.offset);
        base.updatePagination(result.pagination || { total: files.value.length, limit: base.pagination.limit, offset: base.pagination.offset }, "offset");
        base.updateLastRefreshTime();
      } finally {
        searchLoading.value = false;
      }
      return;
    }
    await loadFiles();
  };

/**
   * 關閉所有彈窗
   */
  const closeAllModals = () => {
    showEdit.value = false;
    showPreview.value = false;
    showQRCodeModal.value = false;
    editingFile.value = null;
    previewFile.value = null;
    qrCodeDataURL.value = "";
    qrCodeSlug.value = "";
  };

  return {
    // 繼承基礎功能
    ...base,

    // 搜尋狀態
    searchQuery,
    isSearchMode,
    searchLoading,

    // 檔案管理特有狀態
    files,
    editingFile,
    previewFile,
    showEdit,
    showPreview,
    showQRCodeModal,
    qrCodeDataURL,
    qrCodeSlug,

    // 檔案管理方法
    loadFiles,
    refreshFiles,
    searchFiles,
    handleOffsetChange,
    handleGlobalSearch,
    clearSearch,
    handleOffsetChangeWithSearch,
    handlePageSizeChange,
    handleFileDelete,
    handleBatchDelete,
    openEditModal,
    updateFileMetadata,
    openPreviewModal,
    generateQRCode,
    copyFileLink,
    copyPermanentLink,
    getOfficePreviewUrl,
    previewFileInNewWindow,
    downloadFileDirectly,
    getPermanentDownloadUrl,
    getPermanentViewUrl,
    toggleSelectAll,
    closeAllModals,
  };
}
