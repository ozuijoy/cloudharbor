import { ref, computed, watch, onMounted } from "vue";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useI18n } from "vue-i18n";
import { formatDateTimeWithSeconds, formatDateTime } from "@/utils/timeUtils.js";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { useAdminApiKeyService } from "@/modules/admin/services/apiKeyService.js";
import { useStorageTypePresentation } from "@/modules/admin/storage/useStorageTypePresentation.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 掛載點管理專用composable
 * @param {Object} options - 可選配置
 * @param {Function} options.confirmFn - 確認對話方塊函式（必需），接收 {title, message, confirmType}，返回 Promise<boolean>
 */
export function useMountManagement(options = {}) {
  const { confirmFn } = options;
  if (!confirmFn) {
    throw new Error("useMountManagement 必須傳入 confirmFn（請在 View 裡用 useConfirmDialog + createConfirmFn 建立）");
  }

  // 繼承基礎管理功能（含檢視模式切換）
  const base = useAdminBase("mount", {
    viewMode: {
      storageKey: 'mount-view-mode',
      defaultMode: 'grid',
    },
  });
  const { getMountsList, updateMount, createMount, deleteMount } = useAdminMountService();
  const { getAllApiKeys } = useAdminApiKeyService();

  // 國際化
  const { t } = useI18n();
  const log = createLogger("MountManagement");

  // 使用認證Store
  const authStore = useAuthStore();

  // 掛載點管理特有狀態
  const mounts = ref([]);
  const storageConfigsStore = useStorageConfigsStore();
  const storageConfigs = computed(() => storageConfigsStore.sortedConfigs);
  const storageConfigsLoading = computed(() => storageConfigsStore.isLoading);
  const apiKeyNames = ref({});
  const showForm = ref(false);
  const currentMount = ref(null);
  const searchQuery = ref("");

  // 行級載入狀態：正在操作的掛載點 ID 集合
  const togglingMountIds = ref(new Set());
  const deletingMountIds = ref(new Set());

  // 儲存型別展示/樣式 helper（用於 UI 主題等行為）
  const { getBadgeClass, ensureLoaded: ensureStorageTypesLoaded } = useStorageTypePresentation();

  // 從 base 獲取檢視模式（別名 toggleViewMode 保持相容）
  const { viewMode, switchViewMode: toggleViewMode } = base;

  // 掛載管理專用分頁配置：每頁預設 6 條，自定義可選項
  const pageSizeOptions = [6, 12, 24, 48, 96];
  if (base.pagination.limit === 20) {
    base.pagination.limit = pageSizeOptions[0];
  }

  // 許可權計算屬性
  const isAdmin = computed(() => authStore.isAdmin);
  const isApiKeyUser = computed(() => authStore.authType === "apikey" && authStore.hasMountPermission);
  const isAuthorized = computed(() => isAdmin.value || isApiKeyUser.value);

  const apiUpdateMount = (id, mountData) => {
    if (!isAdmin.value) {
      throw new Error("API金鑰使用者無許可權更新掛載點");
    }
    return updateMount(id, mountData);
  };

  const apiDeleteMount = (id) => {
    if (!isAdmin.value) {
      throw new Error("API金鑰使用者無許可權刪除掛載點");
    }
    return deleteMount(id);
  };

  /**
   * 搜尋過濾計算屬性
   */
  const filteredMounts = computed(() => {
    if (!searchQuery.value) {
      return mounts.value;
    }

    const query = searchQuery.value.toLowerCase();
    return mounts.value.filter(
      (mount) =>
        mount.name.toLowerCase().includes(query) ||
        mount.mount_path.toLowerCase().includes(query) ||
        mount.storage_type.toLowerCase().includes(query) ||
        (mount.remark && mount.remark.toLowerCase().includes(query))
    );
  });

  /**
   * 更新分頁資訊（掛載點專用邏輯）
   */
  const updateMountPagination = () => {
    base.pagination.total = filteredMounts.value.length;
    base.pagination.hasMore = base.pagination.offset + base.pagination.limit < base.pagination.total;
  };

  // 監聽過濾結果變化，自動同步分頁資訊
  watch(
    filteredMounts,
    () => {
      updateMountPagination();
    },
    { immediate: true }
  );

  /**
   * 格式化日期顯示（包含時分秒）
   */
  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return formatDateTimeWithSeconds(dateString);
  };


  const formatDateOnly = (dateString) => {
    if (!dateString) return "-";
    return formatDateTime(dateString, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };
  
  /**
   * 載入儲存配置列表
   */
  const loadStorageConfigs = async (options = {}) => {
    try {
      if (options.force) {
        await storageConfigsStore.refreshConfigs();
      } else {
        await storageConfigsStore.loadConfigs();
      }
    } catch (err) {
      log.error("載入儲存配置列表錯誤:", err);
    }
  };

  /**
   * 根據ID獲取儲存配置
   */
  const getStorageConfigById = (configId) => {
    return storageConfigsStore.getConfigById(configId);
  };

  /**
   * 載入API金鑰名稱列表
   */
  const loadApiKeyNames = async () => {
    try {
      // 根據使用者型別選擇不同的載入方式
      if (isAdmin.value) {
        // 管理員使用者 - 載入所有API金鑰
        const keys = await getAllApiKeys();
        const keyMap = {};
        (Array.isArray(keys) ? keys : []).forEach((key) => {
          keyMap[key.id] = key.name;
        });
        apiKeyNames.value = keyMap;
      } else {
        // API金鑰使用者 - 只載入當前API金鑰資訊
        const keyInfo = authStore.apiKeyInfo;
        if (keyInfo && keyInfo.id) {
          const keyMap = {};
          keyMap[keyInfo.id] = keyInfo.name || t("admin.mount.currentApiKey");
          apiKeyNames.value = keyMap;
        }
      }
    } catch (err) {
      log.error("載入API金鑰列表錯誤:", err);
    }
  };

  /**
   * 載入掛載點列表
   * 使用統一API，根據使用者許可權自動返回相應資料
   * @param {Object} options - 可選配置
   * @param {boolean} options.silent - 是否靜默載入
   */
  const loadMounts = async (options = {}) => {
    const { silent = false } = options;

    // 靜默模式
    // 失敗時保留現有資料，不清空列表
    if (silent) {
      try {
        const data = await getMountsList();
        mounts.value = Array.isArray(data) ? data : [];

        if (mounts.value.length > 0) {
          base.updateLastRefreshTime();
        }

        updateMountPagination();

        if (!storageConfigs.value.length) {
          await loadStorageConfigs();
        }

        const needsApiKeys = mounts.value.some(
          (mount) =>
            mount.created_by &&
            (mount.created_by.startsWith("apikey:") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by))
        );

        if (needsApiKeys) {
          await loadApiKeyNames();
        }
      } catch (err) {
        // 靜默模式失敗：僅記錄日誌，保留現有資料，不清空列表
        log.error("靜默載入掛載點列表失敗:", err);
      }
      return;
    }

    // 非靜默模式：觸發全域性 loading（用於首次載入或手動重新整理）
    return await base.withLoading(async () => {
      try {
        const data = await getMountsList();
        mounts.value = Array.isArray(data) ? data : [];

        if (mounts.value.length > 0) {
          base.updateLastRefreshTime();
        }

        updateMountPagination();

        if (!storageConfigs.value.length) {
          await loadStorageConfigs();
        }

        const needsApiKeys = mounts.value.some(
          (mount) =>
            mount.created_by &&
            (mount.created_by.startsWith("apikey:") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by))
        );

        if (needsApiKeys) {
          await loadApiKeyNames();
        }
      } catch (err) {
        // 非靜默模式失敗：顯示錯誤提示，清空列表（首次載入場景）
        log.error("載入掛載點列表錯誤:", err);
        base.showError(err.message || t("admin.mount.error.loadFailed"));
        mounts.value = [];
      }
    });
  };

  /**
   * 處理分頁變化
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    // 掛載點列表使用前端分頁，這裡不需要重新請求後端
  };

  /**
   * 處理每頁數量變化
   */
  const handleLimitChange = (newLimit) => {
    base.changePageSize(newLimit);
    // 重置到第一頁
    base.handlePaginationChange(0, "offset");
    updateMountPagination();
  };

  // 初始化時確儲存儲型別後設資料載入完成（用於 UI 主題等）
  onMounted(() => {
    ensureStorageTypesLoaded();
  });

  /**
   * 開啟新建表單
   */
  const openCreateForm = () => {
    currentMount.value = null;
    showForm.value = true;
  };

  /**
   * 開啟編輯表單
   */
  const openEditForm = (mount) => {
    currentMount.value = { ...mount };
    showForm.value = true;
  };

  /**
   * 關閉表單
   */
  const closeForm = () => {
    showForm.value = false;
    currentMount.value = null;
  };

  /**
   * 表單儲存成功的處理函式
   */
  const handleFormSaveSuccess = (success = true, message = null) => {
    const wasEdit = !!currentMount.value;
    closeForm();

    // 如果操作失敗，顯示錯誤訊息
    if (success === false) {
      base.showError(message || t("admin.mount.error.updateFailed"));
      return;
    }

    // 顯示成功訊息
    base.showSuccess(
      message || (wasEdit ? t("admin.mount.success.updated") : t("admin.mount.success.created")),
    );

    // 重新載入掛載點列表
    loadMounts();
  };

  /**
   * 刪除掛載點（行級載入狀態，不影響全域性 loading）
   */
  const confirmDelete = async (id) => {
    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: t("admin.mount.item", "此掛載點") }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    // 新增到正在刪除集合
    deletingMountIds.value = new Set([...deletingMountIds.value, id]);
    try {
      // 根據使用者型別呼叫相應的API函式
      await apiDeleteMount(id);

      base.showSuccess(t("admin.mount.success.deleted"));
      // 靜默重新整理掛載點列表
      await loadMounts({ silent: true });
    } catch (err) {
      log.error("刪除掛載點錯誤:", err);
      base.showError(err.message || t("admin.mount.error.deleteFailed"));
    } finally {
      // 從正在刪除集合中移除
      const newSet = new Set(deletingMountIds.value);
      newSet.delete(id);
      deletingMountIds.value = newSet;
    }
  };

  /**
   * 切換掛載點啟用/禁用狀態
   */
  const toggleActive = async (mount) => {
    // 確定操作型別（用於提示訊息）
    const action = mount.is_active ? t("admin.mount.actions.disable") : t("admin.mount.actions.enable");

    // 只有管理員可以切換掛載點狀態
    if (isApiKeyUser.value) {
      base.showError(t("admin.mount.error.apiKeyNoPermission"));
      return;
    }

    // 新增到正在切換集合
    togglingMountIds.value = new Set([...togglingMountIds.value, mount.id]);
    try {
      // 準備更新資料，只包含is_active欄位
      const updateData = {
        is_active: !mount.is_active,
      };

      await apiUpdateMount(mount.id, updateData);

      base.showSuccess(mount.is_active ? t("admin.mount.success.disabled") : t("admin.mount.success.enabled"));
      // 靜默重新整理掛載點列表
      await loadMounts({ silent: true });
    } catch (err) {
      log.error(`${action}掛載點錯誤:`, err);
      base.showError(err.message || (mount.is_active ? t("admin.mount.error.disableFailed") : t("admin.mount.error.enableFailed")));
    } finally {
      // 從正在切換集合中移除
      const newSet = new Set(togglingMountIds.value);
      newSet.delete(mount.id);
      togglingMountIds.value = newSet;
    }
  };

  const getStorageTypeClass = (storageType, darkModeValue = false) => {
    return getBadgeClass(storageType, darkModeValue);
  };

  /**
   * 獲取狀態樣式類
   */
  const getStatusClass = (isActive, darkModeValue = false) => {
    if (isActive) {
      return darkModeValue ? "bg-green-700 text-green-100" : "bg-green-100 text-green-800";
    } else {
      return darkModeValue ? "bg-red-700 text-red-100" : "bg-red-100 text-red-800";
    }
  };

  /**
   * 獲取建立者型別，用於後續格式化和樣式計算
   */
  const getCreatorType = (mount) => {
    if (!mount.created_by) {
      return "system";
    }

    if (mount.created_by === "admin") {
      return "admin";
    }

    // 處理帶"apikey:"字首的API金鑰ID
    if (typeof mount.created_by === "string" && mount.created_by.startsWith("apikey:")) {
      return "apikey";
    }

    // 檢查是否在已知的API金鑰列表中的UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by) && apiKeyNames.value && apiKeyNames.value[mount.created_by]) {
      return "apikey";
    }

    // UUID格式但不在已知API金鑰列表中，則視為管理員
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by)) {
      return "admin";
    }

    // 預設為其他型別
    return "other";
  };

  /**
   * 格式化建立者資訊顯示
   */
  const formatCreator = (mount) => {
    const creatorType = getCreatorType(mount);

    if (creatorType === "system") {
      return t("admin.mount.creators.system", "系統");
    }

    if (creatorType === "admin") {
      return t("admin.mount.creators.admin", "管理員");
    }

    if (creatorType === "apikey") {
      // 獲取API金鑰ID
      let keyId = mount.created_by;
      if (mount.created_by.startsWith("apikey:")) {
        keyId = mount.created_by.substring(7);
      }

      // 顯示API金鑰名稱或縮略ID
      if (apiKeyNames.value && apiKeyNames.value[keyId]) {
        return `${t("admin.mount.creators.apiKey", "金鑰")}：${apiKeyNames.value[keyId]}`;
      } else if (keyId.length > 10) {
        return `${t("admin.mount.creators.apiKey", "金鑰")}：${keyId.substring(0, 5)}...`;
      } else {
        return `${t("admin.mount.creators.apiKey", "金鑰")}：${keyId}`;
      }
    }

    // 預設直接返回建立者值
    return mount.created_by;
  };

  /**
   * 獲取建立者標籤的樣式類
   */
  const getCreatorClass = (mount, darkModeValue = false) => {
    const creatorType = getCreatorType(mount);

    // 根據建立者型別返回對應樣式
    if (creatorType === "system") {
      return darkModeValue ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700";
    }

    if (creatorType === "admin") {
      return darkModeValue ? "bg-green-900/50 text-green-200 border border-green-800/50" : "bg-green-100 text-green-800 border border-green-200";
    }

    if (creatorType === "apikey") {
      return darkModeValue ? "bg-blue-900/50 text-blue-200 border border-blue-800/50" : "bg-blue-100 text-blue-800 border border-blue-200";
    }

    // 預設樣式
    return darkModeValue ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700";
  };

  /**
   * 獲取建立者顯示名稱（保持向後相容）
   */
  const getCreatorDisplayName = (createdBy) => {
    if (!createdBy) return t("admin.mount.info.unknownCreator");

    // 如果是API金鑰建立的
    if (createdBy.startsWith("apikey:")) {
      const keyId = createdBy.replace("apikey:", "");
      return apiKeyNames.value[keyId] || t("admin.mount.info.unknownApiKey");
    }

    // 如果是UUID格式（API金鑰ID）
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdBy)) {
      return apiKeyNames.value[createdBy] || t("admin.mount.info.unknownApiKey");
    }

    // 否則認為是管理員建立的
    return t("admin.mount.info.admin");
  };

  /**
   * 格式化儲存型別顯示
   */
  const formatStorageType = (mount) => {
    // 基本驗證
    if (!mount) return "-";

    if (mount.storage_config_id) {
      if (!storageConfigs.value.length && storageConfigsLoading.value) {
        return `${mount.storage_type || "-"} (載入中...)`;
      }

      const config = getStorageConfigById(mount.storage_config_id);
      if (config) {
        return storageConfigsStore.formatProviderLabel(config);
      }

      return `${mount.storage_type || "-"} (ID: ${mount.storage_config_id})`;
    }

    return storageConfigsStore.getStorageTypeLabel(mount.storage_type) || mount.storage_type || "-";
  };

  /**
   * 判斷掛載點是否正在切換狀態
   */
  const isMountToggling = (mountId) => {
    return togglingMountIds.value.has(mountId);
  };

  /**
   * 判斷掛載點是否正在刪除
   */
  const isMountDeleting = (mountId) => {
    return deletingMountIds.value.has(mountId);
  };

  return {
    // 繼承基礎功能
    ...base,

    // 掛載點管理特有狀態
    mounts,
    storageConfigs,
    storageConfigsLoading,
    apiKeyNames,
    showForm,
    currentMount,
    searchQuery,
    filteredMounts,
    pageSizeOptions,
    viewMode,

    // 行級載入狀態
    togglingMountIds,
    deletingMountIds,
    isMountToggling,
    isMountDeleting,

    // 許可權狀態
    isAdmin,
    isApiKeyUser,
    isAuthorized,

    // 掛載點管理方法
    loadMounts,
    loadStorageConfigs,
    loadApiKeyNames,
    handleOffsetChange,
    handleLimitChange,
    openCreateForm,
    openEditForm,
    closeForm,
    handleFormSaveSuccess,
    confirmDelete,
    toggleActive,
    toggleViewMode,

    // 工具方法
    formatDate,
    formatDateOnly,
    getStorageConfigById,
    updateMountPagination,
    getStorageTypeClass,
    getStatusClass,
    getCreatorType,
    formatCreator,
    getCreatorClass,
    getCreatorDisplayName,
    formatStorageType,
  };
}
