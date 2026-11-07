import { ref, reactive, computed } from "vue";
import { useI18n } from "vue-i18n";
import { usePasteService } from "@/modules/paste";
import { copyToClipboard } from "@/utils/clipboard";
import { useAuthStore } from "@/stores/authStore.js";
import { useAdminBase } from "@/modules/admin";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";
import { createLogger } from "@/utils/logger.js";

/** @typedef {import("@/types/paste").Paste} Paste */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * 文字管理 Admin composable
 * 基於 useAdminBase + usePasteService 統一管理 Admin 文字列表的載入、刪除、搜尋、預覽、編輯等邏輯
 * @param {Object} options - 可選配置
 * @param {Function} options.confirmFn - 確認對話方塊函式（必需），接收 {title, message, confirmType}，返回 Promise<boolean>
 */
export function usePasteManagement(options = {}) {
  const { confirmFn } = options;
  if (!confirmFn) {
    throw new Error("usePasteManagement 必須傳入 confirmFn（請在 View 裡用 useConfirmDialog + createConfirmFn 建立）");
  }

  // 國際化
  const { t } = useI18n();
  const log = createLogger("PasteManagement");

  const base = useAdminBase('paste', {
    viewMode: {
      storageKey: 'paste-admin-view-mode',
      defaultMode: 'table',
    },
  });
  const pasteService = usePasteService();

  // ========== 搜尋（服務端搜尋） ==========
  const searchQuery = ref("");
  const isSearchMode = ref(false);
  const searchLoading = ref(false);

  /** @type {import("vue").Ref<Paste[]>} */
  const pastes = ref([]);
  /** @type {import("vue").Ref<Paste | null>} */
  const previewPaste = ref(null);
  /** @type {import("vue").Ref<Paste | null>} */
  const editingPaste = ref(null);
  const showPreview = ref(false);
  const showEdit = ref(false);
  const showQRCodeModal = ref(false);
  const qrCodeDataURL = ref("");
  const qrCodeSlug = ref("");

  const copiedTexts = reactive(/** @type {Record<string, boolean>} */ ({}));
  const copiedRawTexts = reactive(/** @type {Record<string, boolean>} */ ({}));

  const authStore = useAuthStore();

  const isAdmin = computed(() => authStore.isAdmin);
  const isApiKeyUser = computed(() => authStore.authType === "apikey" && authStore.hasTextManagePermission);
  const isAuthorized = computed(() => isAdmin.value || isApiKeyUser.value);

  /**
   * 載入文字列表
   * @returns {Promise<void>}
   */
  const loadPastes = async () => {
    return base.withLoading(async () => {
      try {
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: base.pagination.offset,
        });

        pastes.value = items;
        base.updatePagination(pagination, "offset");
        base.updateLastRefreshTime();
      } catch (err) {
        pastes.value = [];
        throw err;
      }
    });
  };

  /**
   * offset 變更（分頁）
   * @param {number} newOffset
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    loadPastes();
  };

  /**
   * 刪除單條文字
   * @param {string|number} pasteId
   */
  const deletePaste = async (pasteId) => {
    if (!pasteId) {
      base.showError("刪除失敗：缺少文字標識資訊");
      return;
    }

    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: t("paste.item", "該文字") }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    return base.withLoading(async () => {
      await pasteService.deleteSinglePaste(pasteId);
      base.showSuccess("刪除成功");
      await loadPastes();
    });
  };

  /**
   * 批次刪除文字
   */
  const batchDeletePastes = async () => {
    const selectedCount = base.selectedItems.value.length;
    if (selectedCount === 0) {
      base.showError("請先選擇要刪除的文字");
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

    return base.withLoading(async () => {
      await pasteService.deletePastes(base.selectedItems.value);
      base.showSuccess(`成功刪除 ${selectedCount} 條文字`);
      base.clearSelection();
      await loadPastes();
    });
  };

  /**
   * 清理所有已過期文字（管理員）
   */
  const clearExpiredPastes = async () => {
    if (!isAdmin.value) {
      base.showError("只有管理員可以清理過期文字");
      return;
    }

    const confirmed = await confirmFn({
      title: t("common.dialogs.cleanupTitle"),
      message: t("common.dialogs.cleanupExpired"),
      confirmType: "warning",
    });

    if (!confirmed) {
      return;
    }

    return base.withLoading(async () => {
      const message = await pasteService.clearExpiredPastes();
      base.showSuccess(message || "已清理過期文字");
      await loadPastes();
    });
  };

  /**
   * 開啟預覽彈窗並載入完整內容
   * @param {Paste} paste
   */
  const openPreview = async (paste) => {
    try {
      // 載入完整的文字詳情（包含 content 欄位）
      const detail = await pasteService.getPasteById(paste.id);
      previewPaste.value = detail;
      showPreview.value = true;
    } catch (err) {
      log.error("獲取文字詳情失敗:", err);
      base.showError("獲取文字詳情失敗");
    }
  };

  const closePreview = () => {
    showPreview.value = false;
    previewPaste.value = null;
  };

  /**
   * 開啟編輯彈窗並載入詳情
   * @param {Paste} paste
   */
  const openEditModal = async (paste) => {
    try {
      const detail = await pasteService.getPasteById(paste.id);
      editingPaste.value = detail;
      showEdit.value = true;
    } catch (err) {
      log.error("獲取文字詳情失敗:", err);
      base.showError("獲取文字詳情失敗");
    }
  };

  const closeEditModal = () => {
    showEdit.value = false;
    editingPaste.value = null;
  };

  /**
   * 通用的文字更新方法
   * @param {string} pasteId - 文字ID
   * @param {Partial<Paste>} updates - 要更新的欄位（支援部分更新）
   * @param {string} successMessage - 成功提示訊息
   * @returns {Promise<void>}
   */
  const updatePasteFields = async (pasteId, updates, successMessage = "更新成功") => {
    return base.withLoading(async () => {
      try {
        // 獲取完整資料（列表資料不包含content欄位）
        const fullPaste = await pasteService.getPasteById(pasteId);

        // 合併更新資料（使用 ?? 空值合併，保持原值）
        const payload = {
          title: updates.title ?? fullPaste.title,
          content: updates.content ?? fullPaste.content,
          remark: updates.remark ?? fullPaste.remark,
          max_views: updates.max_views ?? fullPaste.max_views,
          expires_at: updates.expires_at ?? fullPaste.expires_at,
          is_public: updates.is_public ?? fullPaste.is_public,
        };

        // 處理特殊欄位
        if (Object.prototype.hasOwnProperty.call(updates, "newSlug")) {
          payload.newSlug = updates.newSlug;
        }
        if (updates.password) {
          payload.password = updates.password;
        } else if (updates.clearPassword) {
          payload.clearPassword = true;
        }

        await pasteService.updatePaste(fullPaste.slug, payload);
        base.showSuccess(successMessage);
        await loadPastes();
      } catch (err) {
        log.error("更新文字失敗:", err);
        base.showError(err.message || "更新文字失敗");
        throw err;
      }
    });
  };

  /**
   * 提交編輯修改
   * @param {Partial<Paste>} updated
   */
  const submitEdit = async (updated) => {
    if (updated && updated.error) {
      base.showError(updated.error);
      return;
    }

    if (!editingPaste.value || !editingPaste.value.slug) {
      base.showError("提交失敗：缺少文字標識");
      return;
    }

    try {
      await updatePasteFields(editingPaste.value.id, updated, "更新成功");
      closeEditModal();
    } catch (err) {
      // 錯誤已在 updatePasteFields 中處理
    }
  };

  /**
   * 複製訪問連結
   * @param {string} slug - 文字標識
   */
  const copyLink = async (slug) => {
    if (!slug) {
      base.showError("複製失敗：缺少文字標識");
      return;
    }

    const baseUrl = window.location.origin;
    const link = `${baseUrl}/paste/${slug}`;

    try {
      const ok = await copyToClipboard(link);
      if (ok) {
        copiedTexts[slug] = true;
        base.showSuccess("訪問連結已複製");
        setTimeout(() => {
          copiedTexts[slug] = false;
        }, 2000);
      } else {
        base.showError("複製訪問連結失敗");
      }
    } catch (err) {
      log.error("複製訪問連結失敗:", err);
      base.showError("複製訪問連結失敗");
    }
  };

  /**
   * 複製 Raw 連結
   * @param {string} slug - 文字標識
   */
  const copyRawLink = async (slug) => {
    if (!slug) {
      base.showError("複製失敗：缺少文字標識");
      return;
    }

    // 從列表中查詢完整物件以獲取 plain_password
    const pasteObj = pastes.value.find((item) => item.slug === slug);

    try {
      const rawLink = pasteService.getRawPasteUrl(slug, pasteObj?.plain_password || null);
      const ok = await copyToClipboard(rawLink);
      if (ok) {
        copiedRawTexts[slug] = true;
        base.showSuccess("Raw 連結已複製");
        setTimeout(() => {
          copiedRawTexts[slug] = false;
        }, 2000);
      } else {
        base.showError("複製 Raw 連結失敗");
      }
    } catch (err) {
      log.error("複製 Raw 連結失敗:", err);
      base.showError("複製 Raw 連結失敗");
    }
  };

  /**
   * 快速編輯內容（雙擊編輯功能）
   * @param {Object} payload - { id, slug, content }
   */
  const quickEditContent = async (payload) => {
    if (!payload || !payload.id || !payload.slug || !payload.content) {
      base.showError("編輯失敗：缺少必要引數");
      return;
    }

    try {
      // 獲取完整資料（列表資料不包含content欄位）
      const fullPaste = await pasteService.getPasteById(payload.id);

      // 合併更新資料（只更新 content 欄位）
      const updatePayload = {
        title: fullPaste.title,
        content: payload.content,
        remark: fullPaste.remark,
        max_views: fullPaste.max_views,
        expires_at: fullPaste.expires_at,
        is_public: fullPaste.is_public,
      };

      // 呼叫 API 更新
      await pasteService.updatePaste(fullPaste.slug, updatePayload);

      // 區域性更新：直接修改物件屬性
      const index = pastes.value.findIndex((p) => p.id === payload.id);
      if (index !== -1) {
        // 直接修改屬性而不是替換物件（避免觸發整個列表重新渲染）
        pastes.value[index].content = payload.content;
      }

      base.showSuccess("內容已更新");
    } catch (err) {
      log.error("更新文字內容失敗:", err);
      base.showError(err.message || "更新文字內容失敗");
      throw err;
    }
  };

  /**
   * 開啟公共訪問頁
   * @param {string} slug
   */
  const goToViewPage = (slug) => {
    const baseUrl = window.location.origin;
    const viewUrl = `${baseUrl}/paste/${slug}`;
    window.open(viewUrl, "_blank");
  };

  /**
   * 生成並顯示二維碼
   * @param {string} slug
   * @param {boolean} darkMode
   */
  const showQRCode = async (slug, darkMode = false) => {
    try {
      if (!slug) {
        base.showError("生成二維碼失敗：缺少文字標識資訊");
        return;
      }

      const baseUrl = window.location.origin;
      const pasteUrl = `${baseUrl}/paste/${slug}`;

      qrCodeDataURL.value = await createQRCodeImage(pasteUrl, { darkMode });
      qrCodeSlug.value = slug;
      showQRCodeModal.value = true;
    } catch (err) {
      log.error("生成二維碼失敗:", err);
      base.showError("生成二維碼失敗");
    }
  };

  /**
   * 切換全選狀態（按 id 欄位）
   */
  const toggleSelectAll = () => {
    base.toggleSelectAll(pastes.value, "id");
  };

  /**
   * 搜尋文字列表
   * @param {string} searchTerm
   * @param {number|null} [offset]
   * @returns {Promise<{results: Paste[], pagination: PaginationInfo}>}
   */
  const searchPastes = async (searchTerm, offset = null) => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { results: [], pagination: /** @type {PaginationInfo} */ ({ total: 0, limit: base.pagination.limit, offset: 0 }) };
    }

    const searchOffset = offset !== null ? offset : base.pagination.offset;

    return base.withLoading(async () => {
      try {
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: searchOffset,
          search: searchTerm.trim(),
        });

        return {
          results: items,
          pagination: pagination || /** @type {PaginationInfo} */ ({
            total: items.length,
            limit: base.pagination.limit,
            offset: searchOffset,
          }),
        };
      } catch (err) {
        base.showError(err.message || "搜尋失敗");
        return {
          results: [],
          pagination: /** @type {PaginationInfo} */ ({
            total: 0,
            limit: base.pagination.limit,
            offset: searchOffset,
          }),
        };
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
      const result = await searchPastes(value.trim(), 0);
      pastes.value = result.results || [];
      base.updatePagination(result.pagination || { total: pastes.value.length, limit: base.pagination.limit, offset: 0 }, "offset");
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
    await loadPastes();
  };

  /**
   * 分頁變化（支援搜尋模式）
   */
  const handleOffsetChangeWithSearch = async (newOffset) => {
    if (isSearchMode.value && searchQuery.value) {
      try {
        searchLoading.value = true;
        const result = await searchPastes(searchQuery.value, newOffset);
        pastes.value = result.results || [];
        base.updatePagination(result.pagination || { total: pastes.value.length, limit: base.pagination.limit, offset: newOffset }, "offset");
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
    await loadPastes();
  };

  /**
   * 重新整理當前列表（保持搜尋/分頁狀態）
   */
  const refreshPastes = async () => {
    if (isSearchMode.value && searchQuery.value) {
      try {
        searchLoading.value = true;
        const result = await searchPastes(searchQuery.value, base.pagination.offset);
        pastes.value = result.results || [];
        base.updatePagination(result.pagination || { total: pastes.value.length, limit: base.pagination.limit, offset: base.pagination.offset }, "offset");
        base.updateLastRefreshTime();
      } finally {
        searchLoading.value = false;
      }
      return;
    }
    await loadPastes();
  };

  /**
   * 切換文字可見性
   * @param {Paste} paste
   */
  const toggleVisibility = async (paste) => {
    if (!paste || !paste.id) {
      base.showError("操作失敗：缺少文字標識");
      return;
    }

    const newVisibility = !paste.is_public;
    const visibilityText = newVisibility ? "公開" : "私密";

    try {
      // 複用通用更新方法，只更新 is_public 欄位
      await updatePasteFields(paste.id, { is_public: newVisibility }, `已切換為${visibilityText}`);
    } catch (err) {
      // 錯誤已在 updatePasteFields 中處理
    }
  };

  /**
   * 關閉所有彈窗
   */
  const closeAllModals = () => {
    showPreview.value = false;
    showEdit.value = false;
    showQRCodeModal.value = false;
    previewPaste.value = null;
    editingPaste.value = null;
    qrCodeDataURL.value = "";
    qrCodeSlug.value = "";
  };

  return {
    // 繼承 admin base
    ...base,

    // 搜尋狀態
    searchQuery,
    isSearchMode,
    searchLoading,

    // 文字管理狀態
    pastes,
    previewPaste,
    editingPaste,
    showPreview,
    showEdit,
    showQRCodeModal,
    qrCodeDataURL,
    qrCodeSlug,
    copiedTexts,
    copiedRawTexts,

    // 許可權狀態
    isAdmin,
    isApiKeyUser,
    isAuthorized,

    // 操作
    loadPastes,
    refreshPastes,
    searchPastes,
    handleOffsetChange,
    handleGlobalSearch,
    clearSearch,
    handleOffsetChangeWithSearch,
    handlePageSizeChange,
    deletePaste,
    batchDeletePastes,
    clearExpiredPastes,
    openPreview,
    closePreview,
    openEditModal,
    closeEditModal,
    submitEdit,
    copyLink,
    copyRawLink,
    quickEditContent,
    goToViewPage,
    showQRCode,
    toggleSelectAll,
    toggleVisibility,
    closeAllModals,
  };
}
