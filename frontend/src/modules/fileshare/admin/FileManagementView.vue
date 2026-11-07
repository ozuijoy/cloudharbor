<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 頂部操作欄 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 標題和重新整理按鈕 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-medium text-gray-900 dark:text-white">檔案管理</h2>
        <!-- 重新整理按鈕 - 在所有螢幕尺寸顯示 -->
        <button
          type="button"
          class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          @click.prevent="refreshFiles"
          :disabled="loading || searchLoading"
        >
          <IconRefresh class="h-3 w-3 sm:h-4 sm:w-4 mr-1" :class="loading || searchLoading ? 'animate-spin' : ''" />
          <span class="hidden xs:inline">重新整理</span>
          <span class="xs:hidden">重新整理</span>
        </button>
      </div>

      <!-- 搜尋框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="searchQuery"
          placeholder="搜尋檔案（支援檔名、連結、備註）"
          :show-hint="true"
          search-hint="服務端搜尋，支援模糊匹配"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearSearch"
        />
      </div>

      <!-- 統計資訊和操作按鈕 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          共 {{ pagination.total }} 個檔案
          <span v-if="selectedFiles.length > 0" class="ml-2"> (已選擇 {{ selectedFiles.length }} 個) </span>
        </div>
        <div class="flex flex-wrap gap-1 sm:gap-2">
          <!-- 刪除模式開關 -->
          <div
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex-grow sm:flex-grow-0"
          >
            <span class="mr-2">僅刪除記錄</span>
            <button
              type="button"
              @click.prevent="deleteSettingsStore.toggleDeleteMode"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              :class="deleteSettingsStore.deleteRecordOnly ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'"
            >
              <span
                class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform"
                :class="deleteSettingsStore.deleteRecordOnly ? 'translate-x-5' : 'translate-x-1'"
              ></span>
            </button>
          </div>

          <!-- 批次刪除按鈕 -->
          <button
            type="button"
            @click.prevent="handleBatchDelete"
            :disabled="selectedFiles.length === 0"
            :class="[
              'inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 flex-grow sm:flex-grow-0',
              selectedFiles.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500',
            ]"
          >
            <IconDelete class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            <span class="hidden xs:inline">批次刪除{{ selectedFiles.length ? ` (${selectedFiles.length})` : "" }}</span>
            <span class="xs:hidden">刪除{{ selectedFiles.length ? ` (${selectedFiles.length})` : "" }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 上次重新整理時間顯示 -->
    <div class="flex justify-between items-center mb-2 sm:mb-3" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
        <span class="inline-flex items-center">
          <IconClock class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          上次重新整理: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 載入中指示器 -->
    <div v-if="loading" class="flex justify-center my-8">
      <IconRefresh class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" />
    </div>

    <!-- 資料展示區域 -->
    <div v-if="!loading" class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <FileTable
          :files="files"
          :dark-mode="darkMode"
          :selected-files="selectedFiles"
          :user-type="props.userType"
          :loading="loading || searchLoading"
          @toggle-select="toggleSelectItem"
          @toggle-select-all="toggleSelectAll"
          @edit="openEditModal"
          @preview="openPreviewModal"
          @delete="handleFileDelete"
          @generate-qr="(file) => generateQRCode(file, darkMode)"
          @copy-link="copyFileLink"
          @copy-permanent-link="copyPermanentLink"
          @error="showError"
        />
      </div>
    </div>

    <!-- 分頁元件（搜尋和正常模式統一顯示） -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        :search-mode="isSearchMode"
        :search-term="searchQuery"
        mode="offset"
        @offset-changed="handleOffsetChangeWithSearch"
        @limit-changed="handlePageSizeChange"
      />
    </div>

    <!-- 編輯檔案後設資料彈窗 -->
    <FileEditModal v-if="showEdit" :file="editingFile" :dark-mode="darkMode" @close="showEdit = false" @save="updateFileMetadata" />

    <!-- 檔案預覽彈窗 -->
    <FilePreviewModal
      v-if="showPreview"
      :file="previewFile"
      :dark-mode="darkMode"
      @close="showPreview = false"
      @preview-file="previewFileInNewWindow"
      @download-file="downloadFileDirectly"
    />

    <!-- 二維碼彈窗 -->
    <QRCodeModal v-if="showQRCodeModal" :qr-code-url="qrCodeDataURL" :file-slug="qrCodeSlug" :dark-mode="darkMode" @close="showQRCodeModal = false" />

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useFileManagement } from "@/modules/fileshare/admin/useFileManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { IconClock, IconDelete, IconRefresh } from "@/components/icons";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";

// 匯入子元件
import FileTable from "@/modules/fileshare/admin/components/FileTable.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import FileEditModal from "@/components/file/FileEditModal.vue";
import FilePreviewModal from "@/modules/fileshare/admin/components/FilePreviewModal.vue";
import QRCodeModal from "@/modules/fileshare/admin/components/QRCodeModal.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";

/**
 * 元件接收的屬性定義
 * userType: 使用者型別，'admin'或'apikey'
 */
const props = defineProps({
  userType: {
    type: String,
    default: "admin", // 預設為管理員
    validator: (value) => ["admin", "apikey"].includes(value),
  },
});

/**
 * 使用主題模式 composable
 */
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

// 使用檔案管理composable
const {
  // 狀態
  loading,
  selectedItems: selectedFiles,
  lastRefreshTime,
  pagination,
  pageSizeOptions,
  files,
  editingFile,
  previewFile,
  showEdit,
  showPreview,
  showQRCodeModal,
  qrCodeDataURL,
  qrCodeSlug,
  searchQuery,
  isSearchMode,
  searchLoading,

  // 方法
  loadFiles,
  refreshFiles,
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
  showError,
  previewFileInNewWindow,
  downloadFileDirectly,
  toggleSelectItem,
  toggleSelectAll,
} = useFileManagement(props.userType, { confirmFn });

// 需要在模板中使用的刪除設定store
const deleteSettingsStore = useDeleteSettingsStore();

// 元件掛載時載入檔案列表
onMounted(loadFiles);
</script>
