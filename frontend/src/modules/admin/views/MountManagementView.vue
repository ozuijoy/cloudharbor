<script setup>
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import MountForm from "@/modules/admin/components/MountForm.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import ViewModeToggle from "@/components/common/ViewModeToggle.vue";
import { useMountManagement } from "@/modules/admin/storage/useMountManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { IconArchive, IconCalculator, IconCalendar, IconCheckCircle, IconClock, IconDelete, IconEye, IconFolder, IconFolderPlus, IconGlobeAlt, IconInformationCircle, IconRefresh, IconRename, IconSearch, IconShieldCheck, IconUser, IconXCircle } from "@/components/icons";

/**
 * 掛載管理檢視
 */

// 元件接收的屬性定義
const props = defineProps({
  userType: {
    type: String,
    default: "admin",
    validator: (value) => ["admin", "apikey"].includes(value),
  },
});


const { isDarkMode: darkMode } = useThemeMode();

// 國際化
const { t } = useI18n();

// 確認對話方塊
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 建立適配確認函式，用於傳遞給 composable
const confirmFn = createConfirmFn(confirm, {
  t,
  darkMode,
  getConfirmText: () => t("common.dialogs.deleteButton"),
});

const {
  // 狀態
  loading,
  error,
  showForm,
  currentMount,
  searchQuery,
  filteredMounts,
  pagination,
  lastRefreshTime,
  pageSizeOptions,
  viewMode,

  // 許可權狀態
  isAdmin,
  isApiKeyUser,

  // 行級載入狀態
  isMountToggling,
  isMountDeleting,

  // 方法
  loadMounts,
  loadStorageConfigs,
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
  formatCreator,
  getCreatorClass,
  formatStorageType,
} = useMountManagement({ confirmFn });

// 檢視模式選項配置
const viewModeOptions = [
  { value: "grid", icon: "grid", titleKey: "admin.mount.viewMode.grid" },
  { value: "list", icon: "list", titleKey: "admin.mount.viewMode.list" },
];

// 元件掛載時載入資料
onMounted(() => {
  loadStorageConfigs(); // 先載入儲存配置列表
  loadMounts(); // 然後載入掛載點列表
});
</script>

<template>
  <div class="p-4 flex-1 flex flex-col">
    <!-- 頂部操作欄 -->
    <div class="flex flex-col sm:flex-row sm:justify-between mb-4">
      <div class="mb-2 sm:mb-0">
        <h2 class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ isApiKeyUser ? $t("admin.mount.accessibleMounts") : $t("admin.mount.title") }}
        </h2>
      </div>
      <div class="flex flex-wrap gap-2">
        <!-- 只有管理員可以新增掛載點 -->
        <button
          v-if="isAdmin"
          @click="openCreateForm"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 shadow-sm hover:shadow"
          :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
          :disabled="loading"
        >
          <span class="flex items-center">
            <IconFolderPlus class="h-4 w-4 mr-1.5" />
            {{ $t("admin.mount.createMount") }}
          </span>
        </button>
        <button
          @click="loadMounts"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 shadow-sm hover:shadow"
          :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
        >
          <span class="flex items-center">
            <IconRefresh class="h-4 w-4 mr-1.5" />
            {{ $t("admin.mount.refresh") }}
          </span>
        </button>
      </div>
    </div>

    <!-- 錯誤訊息提示 -->
    <div v-if="error" class="mb-4 p-3 bg-red-100 text-red-600 rounded-md dark:bg-red-900/50 dark:text-red-200 dark:border dark:border-red-800">
      <p>{{ error }}</p>
    </div>

    <!-- 上次重新整理時間顯示 -->
    <div class="flex justify-between items-center mb-3 sm:mb-4" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
        <span class="inline-flex items-center">
          <IconClock class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          {{ $t("admin.mount.info.lastRefresh") }}: {{ lastRefreshTime }}
        </span>
      </div>

      <!-- 右側：搜尋框 + 檢視切換 -->
      <div class="flex items-center gap-2">
        <!-- 搜尋框 -->
        <div class="max-w-md">
          <div class="relative rounded-md shadow-sm">
            <input
              type="text"
              v-model="searchQuery"
              :placeholder="$t('admin.mount.search')"
              class="w-full px-3 py-1.5 rounded-md focus:outline-none focus:ring-2"
              :class="
                darkMode
                  ? 'bg-gray-700 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 border border-gray-600'
                  : 'bg-white text-gray-700 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 border border-gray-300'
              "
            />
            <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <IconSearch class="h-4 w-4" :class="darkMode ? 'text-gray-400' : 'text-gray-400'" />
            </div>
          </div>
        </div>

        <!-- 檢視切換按鈕組 -->
        <ViewModeToggle
          v-model="viewMode"
          :options="viewModeOptions"
          :dark-mode="darkMode"
          size="md"
        />
      </div>
    </div>

    <!-- 載入中指示器 -->
    <div v-if="loading" class="flex justify-center my-8">
      <IconRefresh class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" />
    </div>

    <!-- 掛載點列表為空 -->
    <div v-else-if="filteredMounts.length === 0" class="flex-grow flex items-center justify-center p-6">
      <div class="text-center">
        <IconArchive class="mx-auto h-12 w-12 mb-4" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" />
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ searchQuery ? $t("admin.mount.searchResults.noResults") : isApiKeyUser ? $t("admin.mount.empty.title") : $t("admin.mount.empty.title") }}
        </h3>
        <p class="text-sm mb-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ searchQuery ? "嘗試使用不同的搜尋條件" : isApiKeyUser ? "當前API金鑰沒有可訪問的掛載點，請聯絡管理員配置許可權" : $t("admin.mount.empty.description") }}
        </p>
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="inline-flex items-center px-3 py-2 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200"
          :class="
            darkMode
              ? 'border-gray-600 bg-gray-700 text-gray-200 hover:bg-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500'
          "
        >
          {{ $t("admin.mount.searchResults.clearSearch") }}
        </button>
      </div>
    </div>

    <!-- 掛載點列表 -->
    <div v-else class="flex-grow overflow-auto">
      <!-- 列表檢視 -->
      <div v-if="viewMode === 'list'">
        <!-- 桌面端表格 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="min-w-full divide-y" :class="darkMode ? 'divide-gray-700' : 'divide-gray-200'">
            <thead :class="darkMode ? 'bg-gray-800' : 'bg-gray-50'">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.name") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.mountPath") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.storageType") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.remark") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.status.proxySign") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.info.createdAt") }}
                </th>
                <th class="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("common.actions") }}
                </th>
              </tr>
            </thead>
            <tbody :class="darkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'" class="divide-y">
              <tr v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
                  :key="mount.id"
                  :class="darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                  class="transition-colors">
                <!-- 名稱 + 狀態 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center">
                    <span class="w-2 h-2 rounded-full mr-2" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    <span class="text-sm font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ mount.name }}</span>
                  </div>
                </td>
                <!-- 掛載路徑 -->
                <td class="px-6 py-4">
                  <div class="text-sm font-mono" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" :title="mount.mount_path">
                    <span class="inline-block max-w-xs truncate">{{ mount.mount_path }}</span>
                  </div>
                </td>
                <!-- 儲存型別 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ formatStorageType(mount) }}</span>
                </td>
                <!-- 備註 -->
                <td class="px-6 py-4">
                  <span class="text-sm inline-block max-w-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark || '-'">
                    {{ mount.remark || '-' }}
                  </span>
                </td>
                <!-- 代理/簽名狀態 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex flex-wrap gap-1">
                    <span v-if="mount.web_proxy" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-100 text-blue-800'">
                      {{ $t("admin.mount.status.proxy") }}
                    </span>
                    <span v-if="mount.enable_sign" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800'">
                      {{ $t("admin.mount.status.signature") }}
                    </span>
                    <span v-if="mount.enable_folder_summary_compute" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-purple-900/50 text-purple-200' : 'bg-purple-100 text-purple-800'">
                      {{ $t("admin.mount.status.folderSummary") }}
                    </span>
                    <span v-if="!mount.web_proxy && !mount.enable_sign && !mount.enable_folder_summary_compute" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">-</span>
                  </div>
                </td>
                <!-- 建立時間 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                    {{ formatDateOnly(mount.created_at) }}
                  </span>
                </td>
                <!-- 操作按鈕 -->
                <td class="px-6 py-4 whitespace-nowrap text-center">
                  <div class="flex justify-center space-x-2">
                    <template v-if="isAdmin">
                      <!-- 編輯按鈕 -->
                      <button
                        @click="openEditForm(mount)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        :class="darkMode ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-900'"
                        :title="$t('admin.mount.actions.edit')">
                        <IconRename class="h-5 w-5" />
                      </button>
                      <!-- 啟用/禁用按鈕 -->
                      <button
                        @click="toggleActive(mount)"
                        :disabled="isMountToggling(mount.id)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        :class="mount.is_active
                          ? (darkMode ? 'text-yellow-400 hover:text-yellow-300' : 'text-yellow-600 hover:text-yellow-900')
                          : (darkMode ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-900')"
                        :title="mount.is_active ? $t('admin.mount.actions.disable') : $t('admin.mount.actions.enable')">
                        <IconRefresh v-if="isMountToggling(mount.id)" class="h-5 w-5 animate-spin" />
                        <IconXCircle v-else-if="mount.is_active" class="h-5 w-5" />
                        <IconCheckCircle v-else class="h-5 w-5" />
                      </button>
                      <!-- 刪除按鈕 -->
                      <button
                        @click="confirmDelete(mount.id)"
                        :disabled="isMountDeleting(mount.id)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        :class="darkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-900'"
                        :title="$t('admin.mount.actions.delete')">
                        <IconRefresh v-if="isMountDeleting(mount.id)" class="h-5 w-5 animate-spin" />
                        <IconDelete v-else class="h-5 w-5" />
                      </button>
                    </template>
                    <template v-else>
                      <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ $t("admin.mount.actions.view") }}</span>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移動端網格卡片 (複用現有網格) -->
        <div class="md:hidden grid grid-cols-1 gap-4">
          <div
            v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
            :key="mount.id"
            class="rounded-lg shadow-md overflow-hidden transition-all duration-200 hover:shadow-lg flex flex-col"
            :class="darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'"
          >
            <div class="px-4 py-4 flex-1 flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-start mb-3">
                  <h3 class="text-base font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="mount.name">{{ mount.name }}</h3>
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        :class="mount.is_active
                          ? (darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800')
                          : (darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-800')">
                    <span class="w-1.5 h-1.5 rounded-full mr-1" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    {{ mount.is_active ? $t("admin.mount.status.enabled") : $t("admin.mount.status.disabled") }}
                  </span>
                </div>
                <div class="mb-2 text-sm font-mono" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ mount.mount_path }}</div>
                <div class="mb-2 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ formatStorageType(mount) }}</div>
                <div v-if="mount.remark" class="mb-2 text-sm truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark">{{ mount.remark }}</div>
                <div v-if="mount.web_proxy || mount.enable_sign || mount.enable_folder_summary_compute" class="mb-2 flex flex-wrap gap-1">
                  <span v-if="mount.web_proxy" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-100 text-blue-800'">{{ $t("admin.mount.status.proxy") }}</span>
                  <span v-if="mount.enable_sign" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800'">{{ $t("admin.mount.status.signature") }}</span>
                  <span v-if="mount.enable_folder_summary_compute" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-purple-900/50 text-purple-200' : 'bg-purple-100 text-purple-800'">{{ $t("admin.mount.status.folderSummary") }}</span>
                </div>
              </div>
              <div class="flex justify-end space-x-2 mt-3">
                <template v-if="isAdmin">
                  <button @click="openEditForm(mount)" class="px-2.5 py-1.5 rounded-md text-xs transition-colors"
                          :class="darkMode ? 'bg-gray-600 hover:bg-gray-500 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'">
                    {{ $t("admin.mount.actions.edit") }}
                  </button>
                  <button @click="toggleActive(mount)"
                          :disabled="isMountToggling(mount.id)"
                          class="px-2.5 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                          :class="mount.is_active
                            ? (darkMode ? 'bg-yellow-700 hover:bg-yellow-600 text-yellow-100' : 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800')
                            : (darkMode ? 'bg-green-700 hover:bg-green-600 text-green-100' : 'bg-green-100 hover:bg-green-200 text-green-800')">
                    <IconRefresh v-if="isMountToggling(mount.id)" class="h-3 w-3 mr-1 animate-spin" />
                    {{ mount.is_active ? $t("admin.mount.actions.disable") : $t("admin.mount.actions.enable") }}
                  </button>
                  <button @click="confirmDelete(mount.id)"
                          :disabled="isMountDeleting(mount.id)"
                          class="px-2.5 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                          :class="darkMode ? 'bg-red-700 hover:bg-red-600 text-red-100' : 'bg-red-100 hover:bg-red-200 text-red-800'">
                    <IconRefresh v-if="isMountDeleting(mount.id)" class="h-3 w-3 mr-1 animate-spin" />
                    {{ $t("admin.mount.actions.delete") }}
                  </button>
                </template>
                <template v-else>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ $t("admin.mount.actions.view") }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 網格檢視 (保持原有佈局) -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- 分頁顯示的掛載點 -->
        <div
          v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
          :key="mount.id"
          class="rounded-lg shadow-md overflow-hidden transition-all duration-200 hover:shadow-lg flex flex-col"
          :class="darkMode ? 'bg-gray-700 border border-gray-600 hover:border-blue-500/50' : 'bg-white border border-gray-200 hover:border-blue-400/50'"
        >
          <!-- 卡片內容區域 - 使用flex-col佈局 -->
          <div class="px-4 py-4 flex-1 flex flex-col justify-between">
            <!-- 卡片頂部資訊區 -->
            <div>
              <!-- 掛載點標題和狀態 -->
              <div class="flex justify-between items-start mb-3">
                <h3 class="text-base font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="mount.name">
                  {{ mount.name }}
                </h3>
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors duration-200"
                  :class="
                    mount.is_active
                      ? darkMode
                        ? 'bg-green-900/50 text-green-200 border border-green-800/50'
                        : 'bg-green-100 text-green-800 border border-green-200'
                      : darkMode
                      ? 'bg-gray-800 text-gray-300 border border-gray-700'
                      : 'bg-gray-100 text-gray-800 border border-gray-200'
                  "
                >
                  <span class="flex items-center">
                    <span class="w-1.5 h-1.5 rounded-full mr-1" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    {{ mount.is_active ? $t("admin.mount.status.enabled") : $t("admin.mount.status.disabled") }}
                  </span>
                </span>
              </div>

              <!-- 掛載路徑 - 改進顯示 -->
              <div class="mb-3">
                <div class="flex items-center">
                  <IconFolder
                    class="flex-shrink-0 mr-1.5 h-4 w-4"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <p class="text-sm font-mono truncate" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" :title="mount.mount_path">
                    {{ mount.mount_path }}
                  </p>
                </div>
              </div>

              <!-- 儲存型別和配置 - 改進顯示 -->
              <div class="mb-3">
                <div class="flex items-center text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                  <IconArchive
                    class="flex-shrink-0 mr-1.5 h-4 w-4"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <span class="truncate" :title="formatStorageType(mount)">{{ formatStorageType(mount) }}</span>
                </div>
              </div>

              <!-- 備註說明 - 固定高度確保對齊 -->
              <div class="mb-3 min-h-[24px]">
                <div v-if="mount.remark" class="flex items-start">
                  <IconInformationCircle
                    class="flex-shrink-0 mr-1.5 h-4 w-4 mt-0.5"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <p class="text-sm truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark">
                    {{ mount.remark }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 卡片底部資訊區 -->
            <div>
              <!-- 代理和簽名狀態 -->
              <div v-if="mount.web_proxy || mount.enable_folder_summary_compute" class="mb-2 flex flex-wrap gap-1">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-blue-900/50 text-blue-200 border border-blue-800/50' : 'bg-blue-100 text-blue-800 border border-blue-200'"
                >
                  <IconGlobeAlt class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.proxy") }}
                </span>
                <span
                  v-if="mount.enable_sign"
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-green-900/50 text-green-200 border border-green-800/50' : 'bg-green-100 text-green-800 border border-green-200'"
                >
                  <IconShieldCheck class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.signature") }}
                </span>
                <span
                  v-if="mount.enable_folder_summary_compute"
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-purple-900/50 text-purple-200 border border-purple-800/50' : 'bg-purple-100 text-purple-800 border border-purple-200'"
                >
                  <IconCalculator class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.folderSummary") }}
                </span>
              </div>

              <!-- 建立時間 -->
              <div class="text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <div class="flex items-center">
                  <IconCalendar
                    class="flex-shrink-0 mr-1.5 h-3.5 w-3.5"
                    :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                  />
                  <span>{{ $t("admin.mount.info.createdAt") }}: {{ formatDate(mount.created_at) }}</span>
                </div>
              </div>

              <!-- 建立者資訊 -->
              <div class="text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <div class="flex items-center">
                  <IconUser
                    class="flex-shrink-0 mr-1.5 h-3.5 w-3.5"
                    :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                  />
                  <span>{{ $t("admin.mount.info.createdBy") }}: </span>
                  <span class="ml-1 px-1.5 py-0.5 text-xs rounded" :class="getCreatorClass(mount)">
                    {{ formatCreator(mount) }}
                  </span>
                </div>
              </div>

              <!-- 操作按鈕組 - 根據使用者型別顯示不同按鈕 -->
              <div class="flex justify-end space-x-2">
                <!-- 管理員可以進行所有操作 -->
                <template v-if="isAdmin">
                  <button
                    @click="openEditForm(mount)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    :class="
                      darkMode
                        ? 'bg-gray-600 hover:bg-gray-500 text-gray-200 focus:ring-blue-500 focus:ring-offset-gray-800'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700 focus:ring-blue-500 focus:ring-offset-white'
                    "
                  >
                    <IconRename class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.edit") }}
                  </button>
                  <!-- 啟用/禁用切換按鈕 -->
                  <button
                    @click="toggleActive(mount)"
                    :disabled="isMountToggling(mount.id)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="
                      darkMode
                        ? mount.is_active
                          ? 'bg-yellow-700 hover:bg-yellow-600 text-yellow-100 focus:ring-yellow-500 focus:ring-offset-gray-800'
                          : 'bg-green-700 hover:bg-green-600 text-green-100 focus:ring-green-500 focus:ring-offset-gray-800'
                        : mount.is_active
                        ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800 focus:ring-yellow-500 focus:ring-offset-white'
                        : 'bg-green-100 hover:bg-green-200 text-green-800 focus:ring-green-500 focus:ring-offset-white'
                    "
                  >
                    <IconRefresh v-if="isMountToggling(mount.id)" class="h-3.5 w-3.5 mr-1 animate-spin" />
                    <IconXCircle v-else-if="mount.is_active" class="h-3.5 w-3.5 mr-1" />
                    <IconCheckCircle v-else class="h-3.5 w-3.5 mr-1" />
                    {{ mount.is_active ? $t("admin.mount.actions.disable") : $t("admin.mount.actions.enable") }}
                  </button>
                  <button
                    @click="confirmDelete(mount.id)"
                    :disabled="isMountDeleting(mount.id)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="
                      darkMode
                        ? 'bg-red-700 hover:bg-red-600 text-red-100 focus:ring-red-500 focus:ring-offset-gray-800'
                        : 'bg-red-100 hover:bg-red-200 text-red-800 focus:ring-red-500 focus:ring-offset-white'
                    "
                  >
                    <IconRefresh v-if="isMountDeleting(mount.id)" class="h-3.5 w-3.5 mr-1 animate-spin" />
                    <IconDelete v-else class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.delete") }}
                  </button>
                </template>
                <!-- API金鑰使用者只能檢視，顯示只讀提示 -->
                <template v-else>
                  <span class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium" :class="darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'">
                    <IconEye class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.view") }}
                  </span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分頁元件 -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        mode="offset"
        @offset-changed="handleOffsetChange"
        @limit-changed="handleLimitChange"
      />
    </div>

    <!-- 新建/編輯掛載點表單 -->
    <MountForm v-if="showForm" :dark-mode="darkMode" :mount="currentMount" :user-type="userType" @close="closeForm" @save-success="handleFormSaveSuccess" />

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
/* 自定義捲軸樣式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}
.dark ::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(107, 114, 128, 0.5);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(107, 114, 128, 0.5);
}

/* 卡片過渡效果 */
.mount-card-enter-active,
.mount-card-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.mount-card-enter-from,
.mount-card-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
