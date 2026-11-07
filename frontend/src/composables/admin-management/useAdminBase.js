import { ref, reactive, watch } from "vue";
import { useLocalStorage, useTimeoutFn, useWindowSize } from "@vueuse/core";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { formatCurrentTime } from "@/utils/timeUtils.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("AdminBase");

/**
 * 管理功能基礎composable
 * 提供通用的狀態管理、選擇邏輯、訊息處理、檢視模式、移動端檢測等
 *
 * @param {string} pageKey - 頁面識別符號，用於區分不同頁面的分頁設定
 * @param {Object} options - 可選配置
 * @param {Object} [options.viewMode] - 檢視模式配置
 * @param {string} options.viewMode.storageKey - localStorage 鍵名
 * @param {string} options.viewMode.defaultMode - 預設檢視模式
 * @param {Object} [options.viewMode.responsive] - 響應式配置
 * @param {number} options.viewMode.responsive.breakpoint - 斷點寬度
 * @param {string} options.viewMode.responsive.mobileMode - 移動端模式
 * @param {string} options.viewMode.responsive.desktopMode - 桌面端模式
 * @param {Object|boolean} [options.mobileDetect] - 移動端檢測配置
 * @param {number} [options.mobileDetect.breakpoint=768] - 斷點寬度
 *
 * @example
 * // 基礎用法
 * const base = useAdminBase("key-management");
 *
 * @example
 * // 帶檢視模式切換
 * const base = useAdminBase("tasks", {
 *   viewMode: {
 *     storageKey: 'admin-tasks-view-mode',
 *     defaultMode: 'table',
 *     responsive: { breakpoint: 640, mobileMode: 'card', desktopMode: 'table' }
 *   }
 * });
 *
 * @example
 * // 帶移動端檢測
 * const base = useAdminBase("key-management", {
 *   mobileDetect: { breakpoint: 768 }
 * });
 *
 * @example
 * // 全部功能
 * const base = useAdminBase("tasks", {
 *   viewMode: { storageKey: 'xxx', defaultMode: 'table' },
 *   mobileDetect: true
 * });
 */
export function useAdminBase(pageKey = "default", options = {}) {
  const { viewMode: viewModeConfig = null, mobileDetect: mobileDetectConfig = null } = options;
  const { width: windowWidth } = useWindowSize();

  const globalMessage = useGlobalMessage();
  const storedPageSizes = useLocalStorage("admin-page-size", {});

  // ========== 基礎狀態管理 ==========
  const loading = ref(false);
  const error = ref("");
  const successMessage = ref("");
  const selectedItems = ref([]);
  const lastRefreshTime = ref("");

  // ========== 分頁管理 ==========
  const pageSizeOptions = [10, 20, 30, 50, 100];

  const getDefaultPageSize = () => {
    try {
      const saved = storedPageSizes.value;
      if (saved && typeof saved === "object") {
        return saved[pageKey] || 20;
      }
    } catch (error) {
      // ignore
    }
    // 相容舊格式：曾經直接存一個數字
    if (typeof storedPageSizes.value === "number") {
      const oldValue = storedPageSizes.value || 20;
      storedPageSizes.value = { default: oldValue };
      return pageKey === "default" ? oldValue : 20;
    }
    return 20;
  };

  const pagination = reactive({
    limit: getDefaultPageSize(),
    total: 0,
    page: 1,
    totalPages: 0,
    offset: 0,
    hasMore: false,
  });

  const updatePagination = (data, mode = "page") => {
    if (mode === "page") {
      pagination.total = data.total || 0;
      pagination.totalPages = Math.ceil(pagination.total / pagination.limit);
    } else {
      pagination.total = data.total || 0;
      pagination.hasMore = data.hasMore !== undefined ? data.hasMore : pagination.offset + pagination.limit < pagination.total;
      if (data.limit !== undefined) pagination.limit = data.limit;
      if (data.offset !== undefined) pagination.offset = data.offset;
    }
  };

  const handlePaginationChange = (value, mode = "page") => {
    if (mode === "page") {
      pagination.page = value;
      pagination.offset = (value - 1) * pagination.limit;
    } else {
      pagination.offset = value;
      pagination.page = Math.floor(value / pagination.limit) + 1;
    }
  };

  const resetPagination = () => {
    pagination.page = 1;
    pagination.offset = 0;
  };

  const changePageSize = (newLimit) => {
    try {
      storedPageSizes.value = { ...(storedPageSizes.value || {}), [pageKey]: newLimit };
    } catch (error) {
      log.warn("儲存分頁設定失敗:", error);
    }
    pagination.limit = newLimit;
    resetPagination();
  };

  // ========== 選擇管理 ==========
  const toggleSelectItem = (id) => {
    const index = selectedItems.value.indexOf(id);
    if (index > -1) {
      selectedItems.value.splice(index, 1);
    } else {
      selectedItems.value.push(id);
    }
  };

  const toggleSelectAll = (allItems, idField = "id") => {
    if (selectedItems.value.length === allItems.length) {
      selectedItems.value = [];
    } else {
      selectedItems.value = allItems.map((item) => item[idField]);
    }
  };

  const clearSelection = () => {
    selectedItems.value = [];
  };

  // ========== 訊息管理 ==========
  const clearSuccessDelayMs = ref(0);
  const { start: startClearSuccess, stop: stopClearSuccess } = useTimeoutFn(
    () => {
      successMessage.value = "";
    },
    clearSuccessDelayMs,
    { immediate: false }
  );

  const showSuccess = (message, duration = 4000) => {
    successMessage.value = message;
    stopClearSuccess();
    clearSuccessDelayMs.value = duration;
    startClearSuccess();
    globalMessage.showSuccess(message, duration);
  };

  const showError = (message) => {
    error.value = message;
    globalMessage.showError(message);
  };

  const clearMessages = () => {
    error.value = "";
    successMessage.value = "";
  };

  // ========== 重新整理時間 ==========
  const updateLastRefreshTime = () => {
    lastRefreshTime.value = formatCurrentTime();
  };

  // ========== 載入包裝器 ==========
  const withLoading = async (asyncFn, options = {}) => {
    const { clearMessagesFirst = true, showErrorOnCatch = true } = options;
    loading.value = true;
    if (clearMessagesFirst) clearMessages();

    try {
      const result = await asyncFn();
      return result;
    } catch (err) {
      log.error("操作失敗:", err);
      if (showErrorOnCatch) {
        showError(err.message || "操作失敗，請重試");
      }
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // ========== 檢視模式管理（可選） ==========
  const viewMode = ref(null);
  const userHasChosenView = ref(false);
  let switchViewMode = () => {};

  if (viewModeConfig) {
    const { storageKey, defaultMode, responsive } = viewModeConfig;
    const storedViewMode = useLocalStorage(storageKey, "");

    if (!storageKey) {
      throw new Error("useAdminBase: viewMode.storageKey is required");
    }

    const getRecommendedMode = () => {
      if (!responsive) return defaultMode;
      const { breakpoint = 640, mobileMode, desktopMode } = responsive;
      return windowWidth.value < breakpoint ? mobileMode : desktopMode;
    };

    const getInitialMode = () => {
      if (storedViewMode.value) return storedViewMode.value;
      return responsive ? getRecommendedMode() : defaultMode;
    };

    viewMode.value = getInitialMode();
    userHasChosenView.value = !!storedViewMode.value;

    switchViewMode = (mode) => {
      viewMode.value = mode;
      storedViewMode.value = mode;
      userHasChosenView.value = true;
    };

    // 響應式處理
    if (responsive) {
      let lastBreakpointState = windowWidth.value < responsive.breakpoint;

      const handleViewResize = () => {
        const { breakpoint = 640, mobileMode, desktopMode } = responsive;
        const isNowMobile = windowWidth.value < breakpoint;

        // 只在跨越斷點時強制切換檢視
        if (isNowMobile !== lastBreakpointState) {
          lastBreakpointState = isNowMobile;
          const targetMode = isNowMobile ? mobileMode : desktopMode;
          if (viewMode.value !== targetMode) {
            viewMode.value = targetMode;
          }
        }
      };

      watch(windowWidth, handleViewResize);
    }
  }

  // ========== 移動端檢測（可選） ==========
  const isMobile = ref(false);
  let checkMobile = () => {};

  if (mobileDetectConfig) {
    const breakpoint = typeof mobileDetectConfig === "object" ? mobileDetectConfig.breakpoint || 768 : 768;

    checkMobile = () => {
      isMobile.value = windowWidth.value < breakpoint;
    };

    watch(windowWidth, () => checkMobile(), { immediate: true });
  }

  // ========== 返回值 ==========
  return {
    // 基礎狀態
    loading,
    error,
    successMessage,
    selectedItems,
    lastRefreshTime,
    pagination,
    pageSizeOptions,

    // 分頁方法
    updatePagination,
    handlePaginationChange,
    resetPagination,
    changePageSize,

    // 選擇方法
    toggleSelectItem,
    toggleSelectAll,
    clearSelection,

    // 訊息方法
    showSuccess,
    showError,
    clearMessages,

    // 工具方法
    updateLastRefreshTime,
    withLoading,

    // 檢視模式（可選功能）
    viewMode,
    userHasChosenView,
    switchViewMode,

    // 移動端檢測（可選功能）
    isMobile,
    checkMobile,
  };
}
