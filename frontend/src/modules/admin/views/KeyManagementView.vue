<script setup>
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import CommonPagination from "@/components/common/CommonPagination.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { useAdminApiKeyService } from "@/modules/admin/services/apiKeyService.js";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { IconClock, IconDelete, IconKey, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// 匯入子元件
import KeyForm from "@/modules/admin/components/KeyForm.vue";
import KeyTable from "@/modules/admin/components/KeyTable.vue";

// 使用i18n
const { t } = useI18n();
const log = createLogger("KeyManagementView");
const { getAllApiKeys, deleteApiKey } = useAdminApiKeyService();
const { getMountsList } = useAdminMountService();
const { showSuccess, showError } = useGlobalMessage();
const { isDarkMode: darkMode } = useThemeMode();

// 確認對話方塊
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 管理頁面基礎功能（含移動端檢測 + 分頁）
const {
  isMobile,
  lastRefreshTime,
  updateLastRefreshTime,
  pagination,
  pageSizeOptions,
  handlePaginationChange,
  changePageSize,
  resetPagination,
  updatePagination,
} = useAdminBase('key-management', {
  mobileDetect: { breakpoint: 768 },
});

// 狀態管理
const apiKeys = ref([]);
const isLoading = ref(false);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const selectedKeys = ref([]);
const editingKey = ref(null);

// 計算當前頁顯示的金鑰
const currentPageKeys = computed(() => {
  const start = (pagination.page - 1) * pagination.limit;
  const end = start + pagination.limit;
  return apiKeys.value.slice(start, end);
});

// 處理頁碼變化
const handlePageChange = (page) => {
  handlePaginationChange(page, 'page');
};

// 引用子元件
const keyFormRef = ref(null);
const keyTableRef = ref(null);

// 可用掛載點列表
const availableMounts = ref([]);

// 載入所有API金鑰
const loadApiKeys = async () => {
  isLoading.value = true;

  try {
    const keys = await getAllApiKeys();
    apiKeys.value = Array.isArray(keys) ? keys : [];

    // 重置分頁並更新總數
    resetPagination();
    updatePagination({ total: apiKeys.value.length }, 'page');
    // 更新最後重新整理時間
    updateLastRefreshTime();
  } catch (e) {
    log.error("載入API金鑰失敗:", e);
    showError(e.message || t("admin.keyManagement.error.loadFailed"));
  } finally {
    isLoading.value = false;
  }
};

// 載入掛載點列表
const loadMounts = async () => {
  try {
    const mounts = await getMountsList();
    // 只保留啟用狀態的掛載點
    availableMounts.value = (Array.isArray(mounts) ? mounts : []).filter((mount) => mount.is_active);
  } catch (error) {
    log.error("載入掛載點列表失敗:", error);
    availableMounts.value = [];
  }
};

// 開啟建立模態框
const openCreateModal = () => {
  showCreateModal.value = true;
};

// 開啟編輯模態框
const openEditModal = (key) => {
  editingKey.value = key;
  showEditModal.value = true;
};

// 處理建立金鑰成功
const handleKeyCreated = (newKey, fullKey) => {
  // 自動複製新建立的金鑰到剪貼簿
  if (fullKey) {
    (async () => {
      try {
        await copyToClipboard(fullKey);
        showSuccess(t("admin.keyManagement.success.createdAndCopied", "金鑰已建立並複製到剪貼簿"));
      } catch (e) {
        showSuccess(t("admin.keyManagement.success.created", "金鑰已成功建立"));
      }
    })();
  } else {
    showSuccess(t("admin.keyManagement.success.created", "金鑰已成功建立"));
  }

  // 新增到列表
  apiKeys.value.unshift(newKey);

  // 關閉模態框
  showCreateModal.value = false;
};

// 處理更新金鑰成功
const handleKeyUpdated = (updatedKey) => {
  // 更新本地狀態
  const index = apiKeys.value.findIndex((key) => key.id === updatedKey.id);
  if (index !== -1) {
    apiKeys.value[index] = updatedKey;
  }

  // 關閉模態框
  showEditModal.value = false;

  // 顯示成功訊息
  showSuccess(t("admin.keyManagement.success.updated"));
};

// 批次刪除選中的金鑰
const deleteSelectedKeys = async () => {
  if (selectedKeys.value.length === 0) {
    showError(t("admin.keyManagement.selectKeysFirst"));
    return;
  }

  // 過濾掉 GUEST 金鑰（不允許刪除）
  const deletableIds = selectedKeys.value.filter((id) => {
    const key = apiKeys.value.find((k) => k.id === id);
    return key && (key.role || "GENERAL") !== "GUEST";
  });

  if (deletableIds.length === 0) {
    showError(t("admin.keyManagement.error.cannotDeleteGuest", "遊客金鑰不允許刪除，請透過禁用或修改許可權控制訪問"));
    return;
  }

  const selectedCount = deletableIds.length;

  // 使用統一確認對話方塊
  const confirmed = await confirm({
    title: t("common.dialogs.deleteTitle"),
    message: t("common.dialogs.deleteMultiple", { count: selectedCount }),
    confirmType: "danger",
    confirmText: t("common.dialogs.deleteButton") + ` (${selectedCount})`,
    darkMode: darkMode.value,
  });

  if (!confirmed) {
    return;
  }

  isLoading.value = true;

  try {
    // 逐個刪除選中的金鑰
    const promises = deletableIds.map((id) => deleteApiKey(id));
    await Promise.all(promises);

    // 清空選中列表
    selectedKeys.value = [];

    // 重新載入資料
    await loadApiKeys();

    // 清空表格選中狀態
    if (keyTableRef.value) {
      keyTableRef.value.clearSelectedKeys();
    }

    // 顯示成功訊息
    showSuccess(t("admin.keyManagement.success.bulkDeleted", { count: selectedCount }));
  } catch (e) {
    log.error("批次刪除金鑰失敗:", e);
    showError(t("admin.keyManagement.error.bulkDeleteFailed"));
  } finally {
    isLoading.value = false;
  }
};

// Key 管理頁不再維護區域性 toast，錯誤與成功提示統一走 useGlobalMessage

// 處理選中金鑰變化
const handleSelectedKeysChange = (keys) => {
  selectedKeys.value = keys;
};

// 元件掛載時載入金鑰和掛載點列表
onMounted(() => {
  loadApiKeys();
  loadMounts();
});
</script>

<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 頂部操作欄 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 標題和操作按鈕行 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ $t("admin.keyManagement.title") }}</h2>

        <div class="flex flex-wrap gap-2">
          <!-- 重新整理按鈕 -->
          <button
            @click="loadApiKeys"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
          >
            <IconRefresh size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.refresh") }}</span>
          </button>

          <!-- 批次刪除按鈕 -->
          <button
            @click="deleteSelectedKeys"
            :disabled="selectedKeys.length === 0"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="[
              selectedKeys.length === 0
                ? 'opacity-50 cursor-not-allowed bg-gray-400 dark:bg-gray-600'
                : darkMode
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white',
            ]"
          >
            <IconDelete size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.bulkDelete") }}{{ selectedKeys.length ? `(${selectedKeys.length})` : "" }}</span>
            <span class="xs:hidden">{{ $t("admin.keyManagement.delete") }}{{ selectedKeys.length ? `(${selectedKeys.length})` : "" }}</span>
          </button>

          <!-- 建立新金鑰按鈕 -->
          <button
            @click="openCreateModal"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="darkMode ? 'bg-primary-600 hover:bg-primary-700 text-white' : 'bg-primary-500 hover:bg-primary-600 text-white'"
          >
            <IconKey size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.create") }}</span>
            <span class="xs:hidden">{{ $t("admin.keyManagement.createShort") }}</span>
          </button>
        </div>
      </div>

      <!-- 最後重新整理時間顯示 -->
      <div v-if="lastRefreshTime" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <span class="inline-flex items-center">
          <IconClock size="sm" class="mr-1" />
          {{ $t("admin.keyManagement.lastRefreshed") }}: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 金鑰列表 -->
    <div class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg">
      <KeyTable
        ref="keyTableRef"
        :dark-mode="darkMode"
        :api-keys="currentPageKeys"
        :is-loading="isLoading"
        :available-mounts="availableMounts"
        :is-mobile="isMobile"
        @refresh="loadApiKeys"
        @edit="openEditModal"
        @selected-keys-change="handleSelectedKeysChange"
      />
    </div>

    <!-- 分頁元件 - 統一放在外部 -->
    <div v-if="!isLoading && apiKeys.length > 0" class="mt-4">
      <CommonPagination :dark-mode="darkMode" :pagination="pagination" mode="page" @page-changed="handlePageChange" />
    </div>

    <!-- 模態框 -->
    <!-- 建立金鑰模態框 -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-[60] overflow-y-auto flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4"
      :class="darkMode ? 'bg-gray-900/75' : 'bg-black/50'"
      @click="showCreateModal = false"
    >
      <KeyForm
        ref="keyFormRef"
        :dark-mode="darkMode"
        :available-mounts="availableMounts"
        :is-edit-mode="false"
        @close="showCreateModal = false"
        @created="handleKeyCreated"
        @click.stop
      />
    </div>

    <!-- 編輯金鑰模態框 -->
    <div
      v-if="showEditModal"
      class="fixed inset-0 z-[60] overflow-y-auto flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4"
      :class="darkMode ? 'bg-gray-900/75' : 'bg-black/50'"
      @click="showEditModal = false"
    >
      <KeyForm
        ref="keyFormRef"
        :dark-mode="darkMode"
        :key-data="editingKey"
        :available-mounts="availableMounts"
        :is-edit-mode="true"
        @close="showEditModal = false"
        @updated="handleKeyUpdated"
        @click.stop
      />
    </div>

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
