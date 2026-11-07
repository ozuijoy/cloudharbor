import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLocalStorage } from "@vueuse/core";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 儲存配置管理 composable
 * 提供多儲存配置的 CRUD、分頁管理、測試等能力
 * @param {Object} options - 可選配置
 * @param {Function} options.confirmFn - 確認對話方塊函式（必需），接收 {title, message, confirmType}，返回 Promise<boolean>
 */
export function useStorageConfigManagement(options = {}) {
  const { confirmFn } = options;
  if (!confirmFn) {
    throw new Error("useStorageConfigManagement 必須傳入 confirmFn（請在 View 裡用 useConfirmDialog + createConfirmFn 建立）");
  }

  // 國際化
  const { t } = useI18n();
  const log = createLogger("StorageConfigManagement");

  // 繼承基礎功能，使用獨立的頁面識別符號
  const base = useAdminBase("storage");
  const storageConfigsStore = useStorageConfigsStore();
  const { getStorageConfigs, getStorageConfigReveal, deleteStorageConfig, setDefaultStorageConfig, testStorageConfig } =
    useAdminStorageConfigService();

  const STORAGE_TYPE_UNKNOWN = "__UNSPECIFIED__";

  const refreshSharedConfigs = async () => {
    try {
      await storageConfigsStore.refreshConfigs();
    } catch (error) {
      log.warn("重新整理全域性儲存配置快取失敗", error);
    }
  };

  // 儲存配置狀態
  const storageConfigs = ref([]);
  const currentConfig = ref(null);
  const showAddForm = ref(false);
  const showEditForm = ref(false);
  const testResults = ref({});

  // 行級載入狀態：正在操作的配置 ID 集合
  const deletingConfigIds = ref(new Set());
  const settingDefaultConfigIds = ref(new Set());

  const storageTypeFilter = ref("all");

  const normalizeStorageTypeValue = (value) => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return STORAGE_TYPE_UNKNOWN;
  };

  const availableStorageTypes = computed(() => {
    const set = new Set();
    storageConfigs.value.forEach((config) => {
      set.add(normalizeStorageTypeValue(config.storage_type));
    });
    return Array.from(set);
  });

  const filteredConfigs = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);

    // 前端分頁：基於篩選結果切片
    const start = (base.pagination.page - 1) * base.pagination.limit;
    const end = start + base.pagination.limit;
    return filtered.slice(start, end);
  });

  watch(availableStorageTypes, (types) => {
    if (storageTypeFilter.value !== "all" && !types.includes(storageTypeFilter.value)) {
      storageTypeFilter.value = "all";
    }
  });

  // 篩選條件變化時重置到第一頁
  watch(storageTypeFilter, () => {
    base.resetPagination();
  });

  // 測試詳情模態框狀態
  const showTestDetails = ref(false);
  const selectedTestResult = ref(null);
  const showDetailedResults = ref(true);

  // 儲存配置分頁選項：4、8、12
  const pageSizeOptions = [4, 8, 12];

  // 重寫預設頁面大小，預設 4 條記錄
  const storedPageSizes = useLocalStorage("admin-page-size", {});
  const getDefaultPageSize = () => {
    try {
      const pageSizes = storedPageSizes.value;
      const savedSize =
        pageSizes && typeof pageSizes === "object"
          ? pageSizes["storage"] || 4
          : 4;
      // 確保儲存的值在分頁選項範圍內，否則使用預設值 4
      return pageSizeOptions.includes(savedSize) ? savedSize : 4;
    } catch (error) {
      log.warn("解析儲存配置分頁設定失敗:", error);
    }
    return 4;
  };

  // 重新初始化分頁狀態
  base.pagination.limit = getDefaultPageSize();

  // 篩選後的總數（用於分頁）
  const filteredTotal = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);
    return filtered.length;
  });

  // 監聽篩選結果變化，更新分頁
  watch([filteredTotal, () => base.pagination.limit], () => {
    base.updatePagination({ total: filteredTotal.value }, "page");
  });

  /**
   * 載入儲存配置列表
   * @param {Object} options - 可選配置
   * @param {boolean} options.silent - 是否靜默載入（不觸發全域性 loading 狀態）
   */
  const loadStorageConfigs = async (options = {}) => {
    const { silent = false } = options;

    // 靜默模式：不觸發全域性 loading，避免 DOM 重新掛載
    if (silent) {
      try {
        const { items } = await getStorageConfigs();
        storageConfigs.value = items;
        base.updatePagination({ total: filteredTotal.value }, "page");
        base.updateLastRefreshTime();
      } catch (error) {
        log.error("靜默載入儲存配置列表失敗:", error);
        throw error;
      }
      return;
    }

    // 非靜默模式：觸發全域性 loading（用於首次載入或手動重新整理）
    return await base.withLoading(async () => {
      try {
        const { items } = await getStorageConfigs();
        storageConfigs.value = items;
        base.updatePagination({ total: filteredTotal.value }, "page");
        base.updateLastRefreshTime();
      } catch (error) {
        log.error("載入儲存配置列表失敗:", error);
        storageConfigs.value = [];
        throw error;
      }
    });
  };

  /**
   * 處理頁碼變化
   */
  const handlePageChange = (page) => {
    base.handlePaginationChange(page, "page");
  };

  /**
   * 處理每頁數量變化
   */
  const handleLimitChange = (newLimit) => {
    base.changePageSize(newLimit);
  };

  /**
   * 刪除儲存配置（行級載入狀態，不影響全域性 loading）
   */
  const handleDeleteConfig = async (configId) => {
    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: t("admin.storage.item", "此儲存配置") }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    // 新增到正在刪除集合
    deletingConfigIds.value = new Set([...deletingConfigIds.value, configId]);
    try {
      await deleteStorageConfig(configId);
      base.showSuccess("刪除成功");
      // 靜默重新整理列表，避免 DOM 重新掛載
      await loadStorageConfigs({ silent: true });
      await refreshSharedConfigs();
    } catch (err) {
      log.error("刪除儲存配置失敗:", err);
      if (err.message && err.message.includes("有檔案正在使用")) {
        base.showError(`無法刪除此配置：${err.message}`);
      } else {
        base.showError(err.message || "刪除儲存配置失敗，請稍後再試");
      }
    } finally {
      // 從正在刪除集合中移除
      const newSet = new Set(deletingConfigIds.value);
      newSet.delete(configId);
      deletingConfigIds.value = newSet;
    }
  };

  /**
   * 編輯配置（使用 masked 模式載入金鑰欄位）
   */
  const editConfig = async (config) => {
    try {
      // 使用 masked 模式重新載入配置，顯示掩碼佔位符
      const maskedConfig = await getStorageConfigReveal(config.id, "masked");
      const finalConfig = maskedConfig?.data || maskedConfig || { ...config };

      currentConfig.value = finalConfig;
      showEditForm.value = true;
      showAddForm.value = false;
    } catch (err) {
      log.error("載入配置失敗:", err);
      // 降級：使用原始配置
      currentConfig.value = { ...config };
      showEditForm.value = true;
      showAddForm.value = false;
    }
  };

  /**
   * 新增新配置
   */
  const addNewConfig = () => {
    currentConfig.value = null;
    showAddForm.value = true;
    showEditForm.value = false;
  };

  /**
   * 處理表單成功提交
   */
  const handleFormSuccess = async () => {
    showAddForm.value = false;
    showEditForm.value = false;
    await loadStorageConfigs();
    await refreshSharedConfigs();
  };

  /**
   * 設定預設配置（行級載入狀態，不影響全域性 loading）
   */
  const handleSetDefaultConfig = async (configId) => {
    // 新增到正在設定預設集合
    settingDefaultConfigIds.value = new Set([...settingDefaultConfigIds.value, configId]);
    try {
      await setDefaultStorageConfig(configId);
      base.showSuccess("設定預設配置成功");
      // 靜默重新整理列表，避免 DOM 重新掛載
      await loadStorageConfigs({ silent: true });
      await refreshSharedConfigs();
    } catch (err) {
      log.error("設定預設儲存配置失敗:", err);
      base.showError(err.message || "無法設定為預設配置，請稍後再試");
    } finally {
      // 從正在設定預設集合中移除
      const newSet = new Set(settingDefaultConfigIds.value);
      newSet.delete(configId);
      settingDefaultConfigIds.value = newSet;
    }
  };

  /**
   * 測試結果處理器類
   */
  class TestResultProcessor {
    constructor(testData) {
      this.raw = testData || {};
      this.success = this.raw?.success === true;
      this.message = typeof this.raw?.message === "string" ? this.raw.message : "";

      const report = this.raw?.report && typeof this.raw.report === "object" ? this.raw.report : null;
      this.report = report || { version: "", storageType: "", info: {}, checks: [] };
      this.checks = Array.isArray(this.report.checks) ? this.report.checks : [];
    }

    /**
     * 計算測試狀態
     */
    calculateStatus() {
      const isFullSuccess = this.success;
      const anyOk = this.checks.some((c) => c && c.success === true);
      const isPartialSuccess = !isFullSuccess && anyOk;
      const isSuccess = isFullSuccess || isPartialSuccess;
      return { isFullSuccess, isPartialSuccess, isSuccess };
    }

    /**
     * 生成狀態訊息
     */
    generateStatusMessage() {
      if (this.message) return this.message;
      const status = this.calculateStatus();
      if (status.isFullSuccess) return "連線測試成功";
      if (status.isPartialSuccess) return "連線測試部分成功";
      return "連線測試失敗";
    }

    /**
     * 生成簡潔的狀態訊息
     */
    generateDetailsMessage() {
      const lines = [];
      for (const c of this.checks) {
        if (!c) continue;
        const label = c.label || c.key || "檢查項";
        if (c.skipped) {
          lines.push(`✓ ${label}（已跳過）`);
          continue;
        }
        if (c.success) {
          lines.push(`✓ ${label} 正常`);
        } else {
          lines.push(`✗ ${label} 失敗`);
          if (c.error) lines.push(`  ${String(c.error).split("\n")[0]}`);
        }
      }
      return lines.join("\n");
    }
  }

  /**
   * 測試儲存配置連線
   */
  const testConnection = async (configId) => {
    try {
      testResults.value[configId] = { loading: true };
      const data = await testStorageConfig(configId);

      // 使用測試結果處理器
      const processor = new TestResultProcessor(data || {});
      const status = processor.calculateStatus();

      testResults.value[configId] = {
        success: status.isFullSuccess,
        partialSuccess: status.isPartialSuccess,
        message: processor.generateStatusMessage(),
        details: processor.generateDetailsMessage(),
        report: processor.report || null,
        loading: false,
      };
    } catch (err) {
      testResults.value[configId] = {
        success: false,
        partialSuccess: false,
        message: "測試連線失敗",
        details: err.message || "無法連線到伺服器",
        loading: false,
      };
    }
  };

  /**
   * 顯示測試結果詳情
   */
  const showTestDetailsModal = (configId) => {
    selectedTestResult.value = testResults.value[configId];
    showTestDetails.value = true;
    showDetailedResults.value = true;
  };

  /**
   * 判斷配置是否正在刪除
   */
  const isConfigDeleting = (configId) => {
    return deletingConfigIds.value.has(configId);
  };

  /**
   * 判斷配置是否正在設定為預設
   */
  const isConfigSettingDefault = (configId) => {
    return settingDefaultConfigIds.value.has(configId);
  };

  return {
    // 繼承基礎功能
    ...base,

    // 重寫分頁選項
    pageSizeOptions,

    // 儲存配置狀態
    storageConfigs,
    filteredConfigs,
    storageTypeFilter,
    availableStorageTypes,
    currentConfig,
    showAddForm,
    showEditForm,
    testResults,
    showTestDetails,
    selectedTestResult,
    showDetailedResults,

    // 行級載入狀態
    deletingConfigIds,
    settingDefaultConfigIds,
    isConfigDeleting,
    isConfigSettingDefault,

    // 儲存配置管理方法
    loadStorageConfigs,
    handlePageChange,
    handleLimitChange,
    handleDeleteConfig,
    editConfig,
    addNewConfig,
    handleFormSuccess,
    handleSetDefaultConfig,

    // 測試功能方法
    testConnection,
    showTestDetailsModal,

    // 工具方法
    normalizeStorageTypeValue,
    STORAGE_TYPE_UNKNOWN,
  };
}
