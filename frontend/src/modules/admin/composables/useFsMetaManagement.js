/**
 * FS Meta 元資訊管理 Composable
 *
 * 說明：
 * - 屬於 Admin 模組下的業務組合邏輯
 * - 繼承 useAdminBase 獲取統一的狀態管理、分頁、訊息處理等功能
 * - 僅負責業務邏輯，不直接處理 UI
 */
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import {
  getAllFsMeta,
  createFsMeta,
  updateFsMeta,
  deleteFsMeta,
} from "@/api/services/fsMetaService.js";

export function useFsMetaManagement() {
  const { t } = useI18n();

  // 繼承 useAdminBase 獲取統一功能
  const base = useAdminBase("fsMeta");

  // 業務資料
  const metaList = ref([]);

  // 搜尋狀態
  const searchQuery = ref("");
  const isSearchMode = ref(false);
  const searchLoading = ref(false);

  // 表單狀態
  const showForm = ref(false);
  const currentMeta = ref(null);

  // 刪除確認狀態
  const showDeleteConfirm = ref(false);
  const metaToDelete = ref(null);

  /**
   * 篩選後的列表 (前端搜尋)
   */
  const filteredMetaList = computed(() => {
    if (!isSearchMode.value || !searchQuery.value.trim()) {
      return metaList.value;
    }
    const query = searchQuery.value.trim().toLowerCase();
    return metaList.value.filter((meta) =>
      meta.path.toLowerCase().includes(query)
    );
  });

  /**
   * 當前頁資料 (基於分頁)
   */
  const paginatedMetaList = computed(() => {
    const start = base.pagination.offset;
    const end = start + base.pagination.limit;
    return filteredMetaList.value.slice(start, end);
  });

  /**
   * 更新分頁資訊
   */
  const updatePaginationFromList = () => {
    const total = filteredMetaList.value.length;
    base.updatePagination({ total }, "offset");
  };

  /**
   * 載入所有元資訊記錄
   */
  const loadMetaList = async () => {
    return base.withLoading(async () => {
      const response = await getAllFsMeta();
      metaList.value = response.data || [];
      updatePaginationFromList();
      base.updateLastRefreshTime();
    }, {
      showErrorOnCatch: true,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.loadFailed"));
    });
  };

  /**
   * 建立元資訊
   */
  const createMeta = async (data) => {
    return base.withLoading(async () => {
      await createFsMeta(data);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.created"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.createFailed"));
      return false;
    });
  };

  /**
   * 更新元資訊
   */
  const updateMeta = async (id, data) => {
    return base.withLoading(async () => {
      await updateFsMeta(id, data);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.updated"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.updateFailed"));
      return false;
    });
  };

  /**
   * 刪除元資訊
   */
  const deleteMeta = async (id) => {
    return base.withLoading(async () => {
      await deleteFsMeta(id);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.deleted"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.deleteFailed"));
      return false;
    });
  };

  // ========== 搜尋功能 ==========

  /**
   * 處理全域性搜尋
   */
  const handleGlobalSearch = (value) => {
    searchQuery.value = value;

    if (!value || value.trim().length < 2) {
      clearSearch();
      return;
    }

    searchLoading.value = true;
    isSearchMode.value = true;

    // 重置分頁到第一頁
    base.resetPagination();
    updatePaginationFromList();

    searchLoading.value = false;
  };

  /**
   * 清除搜尋
   */
  const clearSearch = () => {
    searchQuery.value = "";
    isSearchMode.value = false;
    base.resetPagination();
    updatePaginationFromList();
  };

  // ========== 表單管理 ==========

  /**
   * 開啟建立表單
   */
  const openCreateForm = () => {
    currentMeta.value = null;
    showForm.value = true;
  };

  /**
   * 開啟編輯表單
   */
  const openEditForm = (meta) => {
    currentMeta.value = { ...meta };
    showForm.value = true;
  };

  /**
   * 關閉表單
   */
  const closeForm = () => {
    showForm.value = false;
    currentMeta.value = null;
  };

  /**
   * 處理表單儲存
   */
  const handleFormSave = async (data) => {
    let success;
    if (currentMeta.value) {
      success = await updateMeta(currentMeta.value.id, data);
    } else {
      success = await createMeta(data);
    }

    if (success) {
      closeForm();
      // 如果在搜尋模式，更新篩選結果
      if (isSearchMode.value && searchQuery.value) {
        updatePaginationFromList();
      }
    }
    return success;
  };

  // ========== 刪除確認管理 ==========

  /**
   * 確認刪除
   */
  const confirmDelete = (meta) => {
    metaToDelete.value = meta;
    showDeleteConfirm.value = true;
  };

  /**
   * 執行刪除
   */
  const handleDelete = async () => {
    if (!metaToDelete.value) return false;

    const success = await deleteMeta(metaToDelete.value.id);
    if (success) {
      cancelDelete();
      // 如果在搜尋模式，更新篩選結果
      if (isSearchMode.value && searchQuery.value) {
        updatePaginationFromList();
      }
    }
    return success;
  };

  /**
   * 取消刪除
   */
  const cancelDelete = () => {
    showDeleteConfirm.value = false;
    metaToDelete.value = null;
  };

  // ========== 分頁處理 ==========

  /**
   * 處理分頁偏移變化
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
  };

  /**
   * 處理每頁數量變化
   */
  const handlePageSizeChange = (newPageSize) => {
    base.changePageSize(newPageSize);
    updatePaginationFromList();
  };

  return {
    // 來自 useAdminBase 的狀態
    loading: base.loading,
    error: base.error,
    pagination: base.pagination,
    pageSizeOptions: base.pageSizeOptions,
    lastRefreshTime: base.lastRefreshTime,

    // 業務資料
    metaList,
    filteredMetaList,
    paginatedMetaList,

    // 搜尋狀態
    searchQuery,
    isSearchMode,
    searchLoading,

    // 表單狀態
    showForm,
    currentMeta,

    // 刪除確認狀態
    showDeleteConfirm,
    metaToDelete,

    // CRUD 方法
    loadMetaList,
    createMeta,
    updateMeta,
    deleteMeta,

    // 搜尋方法
    handleGlobalSearch,
    clearSearch,

    // 表單方法
    openCreateForm,
    openEditForm,
    closeForm,
    handleFormSave,

    // 刪除確認方法
    confirmDelete,
    handleDelete,
    cancelDelete,

    // 分頁方法
    handleOffsetChange,
    handlePageSizeChange,

    // 工具方法
    showSuccess: base.showSuccess,
    showError: base.showError,
  };
}
