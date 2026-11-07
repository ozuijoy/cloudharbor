<template>
  <div class="p-4 flex-1 flex flex-col overflow-y-auto">
    <!-- 頁面標題 -->
    <div class="mb-4">
      <h2 class="text-lg font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
        {{ t("admin.fsIndex.title") }}
      </h2>
      <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t("admin.fsIndex.description") }}
      </p>
    </div>

    <!-- 頂部區域：統計 + 操作面板 並排佈局 -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-4">
      <!-- 左側：統計概覽 + 執行中任務 -->
      <div class="xl:col-span-8 space-y-4">
        <!-- 狀態分佈圖表 + KPI 指標 -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FsIndexStatusChart
            :index-status="indexStatusData"
            :is-loading="isLoading"
          />
          <FsIndexKPICards
            :index-status="indexStatusData"
            :is-loading="isLoading"
          />
        </div>

        <!-- 執行中的任務（始終顯示，空時顯示提示） -->
        <FsIndexRunningTasks
          :running-jobs="indexStatusData?.runningJobs || []"
          :mounts="indexStatusData?.items || []"
          :is-loading="isLoading"
          @stop-job="handleStopJob"
        />
      </div>

      <!-- 右側：操作面板 -->
      <div class="xl:col-span-4">
        <FsIndexActionPanel
          ref="actionPanelRef"
          :disabled="isLoading || !hasValidMounts"
          :is-loading="isLoading"
          @rebuild="handleRebuildAll"
          @apply-dirty="handleApplyDirtyAll"
          @clear="handleClearAll"
          @refresh="handleRefresh"
        />
      </div>
    </div>

    <!-- 掛載點索引狀態（全寬，無外部卡片容器） -->
    <div class="flex flex-col flex-1">
      <!-- 工具欄 -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h3 class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ t("admin.fsIndex.table.title") }}
        </h3>

        <!-- 工具欄控制元件 -->
        <div class="flex flex-wrap items-center gap-3">
          <!-- 搜尋框 -->
          <div class="relative">
            <IconSearch
              class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4"
              :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
            />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('admin.fsIndex.filter.placeholder')"
              class="pl-8 pr-3 py-2 text-sm rounded-lg border w-48 focus:outline-none focus:ring-2 transition-colors"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500 focus:ring-primary-500/50 focus:border-primary-500'
                : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-primary-500/50 focus:border-primary-500'"
            />
          </div>

          <!-- 狀態篩選 -->
          <select
            v-model="statusFilter"
            class="px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 transition-colors"
            :class="darkMode
              ? 'bg-gray-700 border-gray-600 text-gray-200 focus:ring-primary-500/50 focus:border-primary-500'
              : 'bg-white border-gray-300 text-gray-700 focus:ring-primary-500/50 focus:border-primary-500'"
          >
            <option
              v-for="option in statusOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>

          <!-- 分隔線 -->
          <div class="h-6 w-px" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>

          <!-- 檢視切換按鈕組 -->
          <div
            class="flex items-center rounded-lg border p-0.5"
            :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-200'"
          >
            <button
              @click="viewMode = 'table'"
              class="p-1.5 rounded-md transition-colors"
              :class="viewMode === 'table'
                ? (darkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                : (darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
              :title="t('admin.fsIndex.viewMode.table')"
            >
              <IconTable class="w-4 h-4" />
            </button>
            <button
              @click="viewMode = 'card'"
              class="p-1.5 rounded-md transition-colors"
              :class="viewMode === 'card'
                ? (darkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                : (darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')"
              :title="t('admin.fsIndex.viewMode.card')"
            >
              <IconGrid class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- 內容區域 -->
      <div class="flex-1 overflow-y-auto">
        <!-- 載入狀態 -->
        <div v-if="isLoading" class="flex justify-center items-center h-40">
          <IconRefresh class="animate-spin h-8 w-8 text-primary-500" />
        </div>

        <!-- 表格檢視 -->
        <AdminTable
          v-else-if="viewMode === 'table'"
          :data="paginatedMounts"
          :columns="mountColumns"
          :column-classes="mountColumnClasses"
          :empty-text="t('admin.fsIndex.empty.title')"
        >
          <!-- 移動端卡片檢視 -->
          <template #mobile="{ data }">
            <div class="space-y-3">
              <FsIndexMountCard
                v-for="item in data"
                :key="item.mountId"
                :mount="item"
                @rebuild="handleRebuildMount(item.mountId)"
                @apply-dirty="handleApplyDirtyMount(item.mountId)"
                @clear="handleClearMount(item.mountId)"
              />
            </div>
          </template>
        </AdminTable>

        <!-- 卡片檢視 -->
        <div v-else>
          <!-- 空狀態 -->
          <div
            v-if="paginatedMounts.length === 0"
            class="text-center py-10"
          >
            <IconFolder class="mx-auto w-10 h-10 mb-3" :class="darkMode ? 'text-gray-600' : 'text-gray-400'" />
            <h3 class="text-sm font-medium mb-1" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
              {{ searchQuery || statusFilter !== 'all' ? t("admin.fsIndex.filter.noResults") : t("admin.fsIndex.empty.title") }}
            </h3>
            <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.fsIndex.empty.description") }}
            </p>
          </div>

          <!-- 掛載點卡片網格 -->
          <div
            v-else
            class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3"
          >
            <FsIndexMountCard
              v-for="item in paginatedMounts"
              :key="item.mountId"
              :mount="item"
              @rebuild="handleRebuildMount(item.mountId)"
              @apply-dirty="handleApplyDirtyMount(item.mountId)"
              @clear="handleClearMount(item.mountId)"
            />
          </div>
        </div>
      </div>

      <!-- 分頁控制元件 -->
      <div v-if="filteredMounts.length > 0" class="mt-4">
        <CommonPagination
          :dark-mode="darkMode"
          :pagination="paginationData"
          mode="page"
          :show-page-size-selector="true"
          :page-size-options="pageSizeOptions"
          @page-changed="handlePageChange"
          @limit-changed="handleLimitChange"
        />
      </div>
    </div>

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, h } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog";
import { useStorageTypeIcon } from "@/composables/core/useStorageTypeIcon.js";
import api from "@/api";
import { createLogger } from "@/utils/logger.js";

// 圖示匯入
import {
  IconRefresh,
  IconFolder,
  IconTable,
  IconGrid,
  IconSearch,
  IconCheckCircle,
  IconExclamation,
  IconXCircle,
} from "@/components/icons";

// 通用元件
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import AdminTable from "@/components/common/AdminTable.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";

// 子元件匯入
import FsIndexKPICards from "@/modules/admin/components/FsIndexKPICards.vue";
import FsIndexStatusChart from "@/modules/admin/components/FsIndexStatusChart.vue";
import FsIndexRunningTasks from "@/modules/admin/components/FsIndexRunningTasks.vue";
import FsIndexMountCard from "@/modules/admin/components/FsIndexMountCard.vue";
import FsIndexActionPanel from "@/modules/admin/components/FsIndexActionPanel.vue";

// 服務
import {
  getStatusTextKey,
  getStatusBadgeClass,
  formatTimestamp,
} from "@/api/services/fsIndexService";

const { t } = useI18n();
const log = createLogger("FsIndexManagement");
const { showSuccess, showError } = useGlobalMessage();
const { isDarkMode: darkMode } = useThemeMode();
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();
const { getStorageTypeIcon, getStorageTypeIconClass } = useStorageTypeIcon();

// 狀態管理
const isLoading = ref(false);
const indexStatusData = ref(null);
const viewMode = ref("card");

// 自動重新整理（僅當“索引重建進行中”時才會觸發真正的請求）
let autoRefreshInFlight = false;
const { pause: stopAutoRefresh, resume: startAutoRefresh } = useIntervalFn(
  async () => {
    const hasRunningJobs =
      Array.isArray(indexStatusData.value?.runningJobs) &&
      indexStatusData.value.runningJobs.length > 0;

    const hasIndexingMounts =
      Array.isArray(indexStatusData.value?.items) &&
      indexStatusData.value.items.some((x) => x?.status === "indexing");

    if (!hasRunningJobs && !hasIndexingMounts) return;
    if (autoRefreshInFlight) return;

    autoRefreshInFlight = true;
    try {
      await loadIndexStatus({ silent: true });
    } finally {
      autoRefreshInFlight = false;
    }
  },
  2000,
  { immediate: false }
);

// 操作面板元件引用
const actionPanelRef = ref(null);


// 分頁和篩選狀態
const currentPage = ref(1);
const pageSize = ref(8);
const pageSizeOptions = [8, 12, 16, 24];
const statusFilter = ref("all");
const searchQuery = ref("");

// 狀態選項
const statusOptions = computed(() => [
  { value: "all", label: t("admin.fsIndex.filter.all") },
  { value: "ready", label: t("admin.fsIndex.status.ready") },
  { value: "indexing", label: t("admin.fsIndex.status.indexing") },
  { value: "not_ready", label: t("admin.fsIndex.status.notReady") },
  { value: "error", label: t("admin.fsIndex.status.error") },
]);

// 計算屬性
const hasValidMounts = computed(() => {
  return indexStatusData.value?.items && indexStatusData.value.items.length > 0;
});

// 篩選後的掛載點列表
const filteredMounts = computed(() => {
  if (!indexStatusData.value?.items) return [];

  let items = [...indexStatusData.value.items];

  // 按狀態篩選
  if (statusFilter.value !== "all") {
    items = items.filter(item => item.status === statusFilter.value);
  }

  // 按搜尋關鍵詞篩選
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim();
    items = items.filter(item =>
      item.name?.toLowerCase().includes(query) ||
      item.storageType?.toLowerCase().includes(query)
    );
  }

  return items;
});

// 分頁後的掛載點列表
const paginatedMounts = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredMounts.value.slice(start, end);
});

// 總頁數
const totalPages = computed(() => {
  return Math.ceil(filteredMounts.value.length / pageSize.value) || 1;
});

// 分頁資料（用於 CommonPagination 元件）
const paginationData = computed(() => ({
  page: currentPage.value,
  limit: pageSize.value,
  total: filteredMounts.value.length,
  totalPages: totalPages.value,
}));

// 監聽篩選條件變化，重置頁碼
watch([statusFilter, searchQuery], () => {
  currentPage.value = 1;
});

// 分頁操作
function handlePageChange(page) {
  currentPage.value = page;
}

function handleLimitChange(limit) {
  pageSize.value = limit;
  currentPage.value = 1;
}

// 表格列定義
const mountColumns = computed(() => [
  // 掛載點名稱
  {
    type: "accessor",
    key: "name",
    header: t("admin.fsIndex.table.mountName"),
    sortable: true,
    render: (value, row) => {
      return h("div", { class: "flex items-center gap-2" }, [
        // 儲存型別品牌圖示
        h(getStorageTypeIcon(row.storageType), {
          class: ["w-4 h-4 flex-shrink-0", getStorageTypeIconClass(row.storageType, darkMode.value)],
        }),
        h("span", {
          class: ["font-medium truncate", darkMode.value ? "text-white" : "text-gray-900"],
          title: value,
        }, value),
        // 狀態小圖示
        h(getStatusIcon(row.status), {
          class: ["w-3.5 h-3.5 flex-shrink-0", getStatusIconClass(row.status)],
        }),
      ]);
    },
  },
  // 儲存型別
  {
    type: "accessor",
    key: "storageType",
    header: t("admin.fsIndex.table.storageType"),
    sortable: true,
    render: (value) => {
      return h("span", {
        class: ["px-1.5 py-0.5 rounded text-xs", darkMode.value ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"],
      }, value);
    },
  },
  // 狀態
  {
    type: "accessor",
    key: "status",
    header: t("admin.fsIndex.table.status"),
    sortable: true,
    render: (value) => {
      return h("span", {
        class: ["px-1.5 py-0.5 text-xs font-medium rounded", getStatusBadgeClass(value)],
      }, t(getStatusTextKey(value)));
    },
  },
  // 待處理變更
  {
    type: "accessor",
    key: "dirtyCount",
    header: t("admin.fsIndex.table.dirtyCount"),
    sortable: true,
    render: (value) => {
      return h("span", {
        class: [
          "font-medium tabular-nums",
          value > 0
            ? (darkMode.value ? "text-yellow-400" : "text-yellow-600")
            : (darkMode.value ? "text-gray-400" : "text-gray-500"),
        ],
      }, value || 0);
    },
  },
  // 最後索引時間
  {
    type: "accessor",
    key: "lastIndexedMs",
    header: t("admin.fsIndex.table.lastIndexed"),
    sortable: true,
    render: (value) => {
      const text = value ? formatTimestamp(value) : t("admin.fsIndex.card.neverIndexed");
      return h("span", {
        class: ["text-xs", darkMode.value ? "text-gray-400" : "text-gray-500"],
      }, text);
    },
  },
  // 操作
  {
    type: "display",
    key: "actions",
    header: t("admin.fsIndex.table.actions"),
    sortable: false,
    render: (row) => {
      const buttons = [];

      // 索引中狀態 - 顯示進度指示
      if (row.status === "indexing") {
        buttons.push(
          h("span", {
            class: ["px-2 py-1 text-xs rounded inline-flex items-center gap-1",
              darkMode.value ? "bg-blue-900/30 text-blue-400" : "bg-blue-100 text-blue-600"],
          }, [
            h(IconRefresh, { class: "w-3 h-3 animate-spin" }),
            t("admin.fsIndex.status.indexing"),
          ])
        );
      } else {
        // 非索引中狀態 - 顯示操作按鈕
        // 建議操作按鈕（高亮顯示）
        if (row.recommendedAction === "rebuild") {
          buttons.push(
            h("button", {
              onClick: (e) => { e.stopPropagation(); handleRebuildMount(row.mountId); },
              class: ["px-2 py-1 text-xs font-medium text-white rounded transition-colors",
                darkMode.value ? "bg-yellow-600 hover:bg-yellow-700" : "bg-yellow-500 hover:bg-yellow-600"],
              title: t("admin.fsIndex.actions.rebuild"),
            }, t("admin.fsIndex.actions.rebuild"))
          );
        } else if (row.recommendedAction === "apply-dirty") {
          buttons.push(
            h("button", {
              onClick: (e) => { e.stopPropagation(); handleApplyDirtyMount(row.mountId); },
              class: ["px-2 py-1 text-xs font-medium text-white rounded transition-colors",
                darkMode.value ? "bg-green-600 hover:bg-green-700" : "bg-green-500 hover:bg-green-600"],
              title: t("admin.fsIndex.actions.applyDirty"),
            }, t("admin.fsIndex.actions.applyDirty"))
          );
        }

        // 清空索引按鈕（始終顯示，但狀態為 not_ready 時禁用）
        const isNotReady = row.status === "not_ready";
        buttons.push(
          h("button", {
            onClick: (e) => { e.stopPropagation(); if (!isNotReady) handleClearMount(row.mountId); },
            disabled: isNotReady,
            class: ["px-2 py-1 text-xs font-medium rounded transition-colors",
              isNotReady
                ? (darkMode.value ? "bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-gray-200 text-gray-400 cursor-not-allowed")
                : (darkMode.value ? "bg-gray-600 hover:bg-gray-500 text-gray-200" : "bg-gray-200 hover:bg-gray-300 text-gray-700")],
            title: t("admin.fsIndex.actions.clear"),
          }, t("admin.fsIndex.actions.clear"))
        );
      }

      return h("div", { class: "flex items-center justify-center gap-1.5" }, buttons);
    },
  },
]);

// 表格列寬度和對齊
const mountColumnClasses = {
  name: "w-[30%] text-left",
  storageType: "w-[12%] text-center",
  status: "w-[12%] text-center",
  dirtyCount: "w-[12%] text-center",
  lastIndexedMs: "w-[16%] text-center",
  actions: "w-[18%] text-center",
};

// 狀態圖示
function getStatusIcon(status) {
  switch (status) {
    case "ready": return IconCheckCircle;
    case "indexing": return IconRefresh;
    case "not_ready": return IconExclamation;
    case "error": return IconXCircle;
    default: return IconExclamation;
  }
}

function getStatusIconClass(status) {
  switch (status) {
    case "ready": return darkMode.value ? "text-green-400" : "text-green-600";
    case "indexing": return (darkMode.value ? "text-blue-400" : "text-blue-600") + " animate-spin";
    case "not_ready": return darkMode.value ? "text-yellow-400" : "text-yellow-600";
    case "error": return darkMode.value ? "text-red-400" : "text-red-600";
    default: return darkMode.value ? "text-gray-400" : "text-gray-600";
  }
}

// 載入索引狀態
async function loadIndexStatus(options = {}) {
  const silent = options?.silent === true;
  try {
    if (!silent) isLoading.value = true;
    const response = await api.admin.fsIndex.getIndexStatus();
    indexStatusData.value = response.data;
  } catch (error) {
    log.error("Failed to load index status:", error);
    showError(t("admin.fsIndex.error.loadFailed"));
  } finally {
    if (!silent) isLoading.value = false;
  }
}

// 重新整理資料
async function handleRefresh() {
  await loadIndexStatus();
}

// 全量重建
async function handleRebuildAll() {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.rebuildTitle"),
    message: t("admin.fsIndex.confirm.rebuildAll"),
    confirmType: "danger",
    confirmText: t("admin.fsIndex.actions.rebuildAll"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    // 獲取操作面板中的選項
    const options = actionPanelRef.value?.getRebuildOptions() || {};
    await api.admin.fsIndex.rebuildIndex(null, options);
    showSuccess(t("admin.fsIndex.success.rebuildStarted"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to rebuild index:", error);
    showError(t("admin.fsIndex.error.rebuildFailed"));
  }
}

// 全量增量更新
async function handleApplyDirtyAll() {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.applyDirtyTitle"),
    message: t("admin.fsIndex.confirm.applyDirtyAll"),
    confirmType: "warning",
    confirmText: t("admin.fsIndex.actions.applyDirtyAll"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    // 獲取操作面板中的選項
    const options = actionPanelRef.value?.getApplyDirtyOptions() || {};
    await api.admin.fsIndex.applyDirty(null, options);
    showSuccess(t("admin.fsIndex.success.applyDirtyStarted"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to apply dirty:", error);
    showError(t("admin.fsIndex.error.applyDirtyFailed"));
  }
}

// 清空所有索引
async function handleClearAll() {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.clearTitle"),
    message: t("admin.fsIndex.confirm.clearAll"),
    confirmType: "danger",
    confirmText: t("admin.fsIndex.actions.clearAll"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    await api.admin.fsIndex.clearIndex(null);
    showSuccess(t("admin.fsIndex.success.cleared"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to clear index:", error);
    showError(t("admin.fsIndex.error.clearFailed"));
  }
}

// 重建單個掛載點
async function handleRebuildMount(mountId) {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.rebuildTitle"),
    message: t("admin.fsIndex.confirm.rebuildSelected", { count: 1 }),
    confirmType: "danger",
    confirmText: t("admin.fsIndex.actions.rebuild"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    await api.admin.fsIndex.rebuildIndex([mountId], {});
    showSuccess(t("admin.fsIndex.success.rebuildStarted"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to rebuild mount:", error);
    showError(t("admin.fsIndex.error.rebuildFailed"));
  }
}

// 增量更新單個掛載點
async function handleApplyDirtyMount(mountId) {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.applyDirtyTitle"),
    message: t("admin.fsIndex.confirm.applyDirtySelected", { count: 1 }),
    confirmType: "warning",
    confirmText: t("admin.fsIndex.actions.applyDirty"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    await api.admin.fsIndex.applyDirty([mountId], {});
    showSuccess(t("admin.fsIndex.success.applyDirtyStarted"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to apply dirty to mount:", error);
    showError(t("admin.fsIndex.error.applyDirtyFailed"));
  }
}

// 清空單個掛載點索引
async function handleClearMount(mountId) {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.clearTitle"),
    message: t("admin.fsIndex.confirm.clearSelected", { count: 1 }),
    confirmType: "danger",
    confirmText: t("admin.fsIndex.actions.clear"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    await api.admin.fsIndex.clearIndex([mountId]);
    showSuccess(t("admin.fsIndex.success.cleared"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to clear mount index:", error);
    showError(t("admin.fsIndex.error.clearFailed"));
  }
}

// 停止任務
async function handleStopJob(jobId) {
  const confirmed = await confirm({
    title: t("admin.fsIndex.confirm.stopTitle"),
    message: t("admin.fsIndex.confirm.stopJob", { jobId }),
    confirmType: "warning",
    confirmText: t("admin.fsIndex.actions.stop"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  try {
    await api.admin.fsIndex.stopIndexJob(jobId);
    showSuccess(t("admin.fsIndex.success.stopped"));
    await loadIndexStatus();
  } catch (error) {
    log.error("Failed to stop job:", error);
    showError(t("admin.fsIndex.error.stopFailed"));
  }
}

// 生命週期
onMounted(async () => {
  await loadIndexStatus();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>
