<script setup>
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { usePasteManagement } from "@/modules/paste";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useCreatorBadge } from "@/composables/admin-management/useCreatorBadge.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { IconClock, IconDelete, IconRefresh } from "@/components/icons";

// 匯入子元件
import PasteTable from "@/modules/paste/admin/components/PasteTable.vue";
import PasteCardList from "@/modules/paste/admin/components/PasteCardList.vue";
import PasteMasonryView from "@/modules/paste/admin/components/PasteMasonryView.vue";
import PastePreviewModal from "@/modules/paste/admin/components/PastePreviewModal.vue";
import PasteEditModal from "@/modules/paste/admin/components/PasteEditModal.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import QRCodeModal from "@/modules/fileshare/admin/components/QRCodeModal.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import ViewModeToggle from "@/components/common/ViewModeToggle.vue";

/**
 * 使用主題模式 composable
 */
const { isDarkMode: darkMode } = useThemeMode();

// 國際化
const { t } = useI18n();

// 建立者徽章統一邏輯
const { formatCreator } = useCreatorBadge();

// 確認對話方塊
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 建立適配確認函式，用於傳遞給 composable
const confirmFn = createConfirmFn(confirm, {
  t,
  darkMode,
  getConfirmText: ({ confirmType }) => (confirmType === "warning" ? t("common.dialogs.cleanupButton") : t("common.dialogs.deleteButton")),
});

// 使用文字管理composable
const {
  // 狀態
  loading,
  error,
  selectedItems: selectedPastes,
  lastRefreshTime,
  pagination,
  pageSizeOptions,
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

  // 檢視模式
  viewMode,
  switchViewMode,

  // 許可權狀態
  isAdmin,
  isApiKeyUser,
  isAuthorized,

  // 方法
  loadPastes,
  refreshPastes,
  handleOffsetChange,
  searchQuery,
  isSearchMode,
  searchLoading,
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
  toggleSelectItem,
  toggleSelectAll,
  toggleVisibility,
  clearSelection,
} = usePasteManagement({ confirmFn });

// 別名對映，用於模板中的方法呼叫
const goToPage = handleOffsetChange;
const deleteSelectedPastes = batchDeletePastes;

// 檢視模式選項配置
const viewModeOptions = [
  { value: "table", icon: "table", title: "表格檢視" },
  { value: "masonry", icon: "masonry", title: "瀑布流檢視" },
];

// 元件掛載時載入資料
onMounted(() => {
  // 載入分享列表
  loadPastes();
});
</script>

<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 頂部操作欄 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 標題和操作按鈕組 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">文字管理</h2>

        <div class="flex items-center space-x-2">
          <!-- 檢視模式切換按鈕組 - 移動端 -->
          <ViewModeToggle
            v-model="viewMode"
            :options="viewModeOptions"
            :dark-mode="darkMode"
            size="sm"
            class="md:hidden"
          />
          <!-- 檢視模式切換按鈕組 - 桌面端 -->
          <ViewModeToggle
            v-model="viewMode"
            :options="viewModeOptions"
            :dark-mode="darkMode"
            size="md"
            class="hidden md:inline-flex"
          />

          <!-- 重新整理按鈕 - 在所有螢幕尺寸顯示 -->
          <button
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            @click="refreshPastes"
            :disabled="loading || searchLoading"
          >
            <IconRefresh class="h-3 w-3 sm:h-4 sm:w-4 mr-1" :class="loading || searchLoading ? 'animate-spin' : ''" />
            <span class="hidden xs:inline">{{ loading || searchLoading ? "重新整理中..." : "重新整理" }}</span>
            <span class="xs:hidden">{{ loading || searchLoading ? "..." : "刷" }}</span>
          </button>
        </div>
      </div>

      <!-- 搜尋框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="searchQuery"
          placeholder="搜尋文字分享（支援連結、備註、內容）"
          :show-hint="true"
          search-hint="服務端搜尋，支援模糊匹配"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearSearch"
        />
      </div>

      <!-- 其他操作按鈕行 -->
      <div class="flex flex-wrap gap-1 sm:gap-2">
        <!-- 清理過期按鈕 -->
        <button
          class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 flex-grow sm:flex-grow-0"
          @click="clearExpiredPastes"
          title="系統會自動刪除過期內容，但您也可以透過此功能手動立即清理"
        >
          <IconDelete class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span class="hidden xs:inline">清理過期</span>
          <span class="xs:hidden">清理</span>
        </button>

        <!-- 批次刪除按鈕 -->
        <button
          :disabled="selectedPastes.length === 0"
          :class="[
            'inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 flex-grow sm:flex-grow-0',
            selectedPastes.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500',
          ]"
          @click="deleteSelectedPastes"
        >
          <IconDelete class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span class="hidden xs:inline">批次刪除{{ selectedPastes.length ? `(${selectedPastes.length})` : "" }}</span>
          <span class="xs:hidden">刪除{{ selectedPastes.length ? `(${selectedPastes.length})` : "" }}</span>
        </button>
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

    <!-- 資料展示區域 -->
    <div class="overflow-visible bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <!-- 桌面端 - 表格檢視 (中等及以上裝置顯示) -->
        <div v-if="viewMode === 'table'" class="hidden md:block flex-1 overflow-auto">
          <PasteTable
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @toggle-visibility="toggleVisibility"
          />
        </div>

        <!-- 桌面端 - 瀑布流檢視 (中等及以上裝置顯示) -->
        <div v-if="viewMode === 'masonry'" class="hidden md:block flex-1 overflow-visible">
          <PasteMasonryView
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @quick-edit-content="quickEditContent"
          />
        </div>

        <!-- 移動端 - 列表檢視 (小於中等裝置顯示) -->
        <div v-if="viewMode === 'table'" class="md:hidden flex-1 overflow-auto">
          <PasteCardList
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
          />
        </div>

        <!-- 移動端 - 瀑布流檢視 (小於中等裝置顯示) -->
        <div v-if="viewMode === 'masonry'" class="md:hidden flex-1 overflow-visible">
          <PasteMasonryView
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @quick-edit-content="quickEditContent"
          />
        </div>
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

    <!-- 預覽彈窗元件 -->
    <PastePreviewModal
      :dark-mode="darkMode"
      :show-preview="showPreview"
      :paste="previewPaste"
      :copied-texts="copiedTexts"
      @close="closePreview"
      @view-paste="goToViewPage"
      @copy-link="copyLink"
    />

    <!-- 修改彈窗元件 -->
    <PasteEditModal :dark-mode="darkMode" :show-edit="showEdit" :paste="editingPaste" @close="closeEditModal" @save="submitEdit" />

    <!-- 二維碼彈窗元件 -->
    <QRCodeModal v-if="showQRCodeModal" :qr-code-url="qrCodeDataURL" :file-slug="qrCodeSlug" :dark-mode="darkMode" @close="showQRCodeModal = false" />

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
