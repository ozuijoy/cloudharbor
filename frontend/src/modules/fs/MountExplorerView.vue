<template>
  <div class="mount-explorer-container mx-auto px-3 sm:px-6 flex-1 flex flex-col pt-6 sm:pt-8 w-full max-w-full sm:max-w-6xl">
    <div class="header mb-4 border-b pb-2 flex justify-between items-center" :class="darkMode ? 'border-gray-800' : 'border-gray-100'">
      <h2 class="text-xl font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ $t("mount.title") }}</h2>

      <!-- 右側按鈕組 -->
      <div class="flex items-center gap-2">
        <!-- 搜尋按鈕 -->
        <button
          @click="handleOpenSearchModal"
          class="flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all duration-200 hover:shadow-sm"
          :class="
            darkMode
              ? 'border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-200'
              : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-700'
          "
          :title="$t('search.title')"
        >
          <!-- 搜尋圖示 -->
          <IconSearch size="sm" class="w-4 h-4" aria-hidden="true" />

          <!-- 搜尋文字（在小螢幕上隱藏） -->
          <span class="hidden sm:inline text-sm text-gray-500" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ $t("search.placeholder") }}
          </span>

          <!-- 快捷鍵提示（在大螢幕上顯示） -->
          <kbd
            class="hidden lg:inline-flex items-center px-1.5 py-0.5 text-xs font-mono rounded border"
            :class="darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-600'"
          >
            Ctrl K
          </kbd>
        </button>

        <!-- 設定按鈕 -->
        <button
          @click="handleOpenSettingsDrawer"
          class="p-2 rounded-md border transition-all duration-200 hover:shadow-sm"
          :class="
            darkMode
              ? 'border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-200'
              : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-700'
          "
          :title="$t('mount.settings.title')"
        >
          <IconSettings size="sm" class="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- 許可權管理元件 -->
    <PermissionManager
      :dark-mode="darkMode"
      permission-type="mount"
      :permission-required-text="$t('mount.permissionRequired')"
      :login-auth-text="$t('mount.loginAuth')"
      @permission-change="handlePermissionChange"
      @navigate-to-admin="navigateToAdmin"
    />

    <!-- 主要內容區域 -->
    <div v-if="hasPermission" class="mount-explorer-main">
      <!-- 頂部 README（僅目錄檢視顯示） -->
      <DirectoryReadme v-if="!showFilePreview" position="top" :meta="directoryMeta" :dark-mode="darkMode" />

      <!-- 操作按鈕 -->
      <div v-if="!showFilePreview" class="mb-4">
        <div class="px-1">
          <FileOperations
            :current-path="currentPath"
            :is-virtual="isVirtualDirectory"
            :dark-mode="darkMode"
            :view-mode="viewMode"
            :selected-items="selectedItems"
            @create-folder="handleCreateFolder"
            @refresh="handleRefresh"
            @change-view-mode="handleViewModeChange"
            @openUploadModal="handleOpenUploadModal"
            @openCopyModal="handleBatchCopy"
            @openTasksModal="handleOpenTasksModal"
            @task-created="handleTaskCreated"
            @show-message="handleShowMessage"
          />
        </div>
      </div>

      <!-- 上傳彈窗 -->
      <UppyUploadModal
        v-if="hasEverOpenedUploadModal"
        :is-open="isUploadModalOpen"
        :current-path="currentPath"
        :dark-mode="darkMode"
        :is-admin="isAdmin"
        @close="handleCloseUploadModal"
        @upload-success="handleUploadSuccess"
        @upload-error="handleUploadError"
      />

      <!-- 複製彈窗 -->
      <CopyModal
        v-if="hasEverOpenedCopyModal"
        :is-open="isCopyModalOpen"
        :dark-mode="darkMode"
        :selected-items="copyModalItems"
        :source-path="currentPath"
        :is-admin="isAdmin"
        :api-key-info="apiKeyInfo"
        @close="handleCloseCopyModal"
        @copy-started="handleCopyStarted"
      />

      <!-- 任務列表彈窗 -->
      <TaskListModal
        v-if="hasEverOpenedTasksModal"
        :is-open="isTasksModalOpen"
        :dark-mode="darkMode"
        @close="handleCloseTasksModal"
        @task-completed="handleTaskCompleted"
      />

      <!-- 新建資料夾彈窗 -->
      <InputDialog
        :is-open="showCreateFolderDialog"
        :title="t('mount.operations.createFolder')"
        :description="t('mount.createFolder.enterName')"
        :label="t('mount.createFolder.folderName')"
        :placeholder="t('mount.createFolder.placeholder')"
        :validator="validateFsItemNameDialog"
        :confirm-text="t('mount.createFolder.create')"
        :cancel-text="t('mount.createFolder.cancel')"
        :loading="isCreatingFolder"
        :loading-text="t('mount.createFolder.creating')"
        :dark-mode="darkMode"
        @confirm="handleCreateFolderConfirm"
        @cancel="handleCreateFolderCancel"
        @close="showCreateFolderDialog = false"
      />

      <!-- 右鍵選單重新命名彈窗 -->
      <InputDialog
        :is-open="contextMenuRenameDialogOpen"
        :title="t('mount.rename.title')"
        :description="t('mount.rename.enterNewName')"
        :label="t('mount.rename.newName')"
        :initial-value="contextMenuRenameItem?.name || ''"
        :validator="validateFsItemNameDialog"
        :confirm-text="t('mount.rename.confirm')"
        :cancel-text="t('mount.rename.cancel')"
        :loading="isRenaming"
        :loading-text="t('mount.rename.renaming')"
        :dark-mode="darkMode"
        @confirm="handleContextMenuRenameConfirm"
        @cancel="handleContextMenuRenameCancel"
        @close="contextMenuRenameDialogOpen = false"
      />

      <!-- 通用 ConfirmDialog 元件替換內聯對話方塊 -->
      <ConfirmDialog
        :is-open="showDeleteDialog"
        :title="itemsToDelete.length === 1 ? t('mount.delete.title') : t('mount.batchDelete.title')"
        :confirm-text="itemsToDelete.length === 1 ? t('mount.delete.confirm') : t('mount.batchDelete.confirmButton')"
        :cancel-text="itemsToDelete.length === 1 ? t('mount.delete.cancel') : t('mount.batchDelete.cancelButton')"
        :loading="isDeleting"
        :loading-text="itemsToDelete.length === 1 ? t('mount.delete.deleting') : t('mount.batchDelete.deleting')"
        :dark-mode="darkMode"
        confirm-type="danger"
        @confirm="confirmDelete"
        @cancel="cancelDelete"
        @close="showDeleteDialog = false"
      >
        <template #content>
          <template v-if="itemsToDelete.length === 1">
            {{
              t("mount.delete.message", {
                type: itemsToDelete[0]?.isDirectory ? t("mount.fileTypes.folder") : t("mount.fileTypes.file"),
                name: itemsToDelete[0]?.name,
              })
            }}
            {{ itemsToDelete[0]?.isDirectory ? t("mount.delete.folderWarning") : "" }}
          </template>
          <template v-else>
            {{ t("mount.batchDelete.message", { count: itemsToDelete.length }) }}
            <div class="mt-2">
              <div class="text-xs font-medium mb-1">{{ t("mount.batchDelete.selectedItems") }}</div>
              <div class="max-h-32 overflow-y-auto bg-gray-50 dark:bg-gray-700 rounded p-2 text-xs">
                <div v-for="item in itemsToDelete.slice(0, 10)" :key="item.path" class="flex items-center py-0.5">
                  <span class="truncate">{{ item.name }}</span>
                  <span v-if="item.isDirectory" class="ml-1 text-gray-500">{{ t("mount.batchDelete.folder") }}</span>
                </div>
                <div v-if="itemsToDelete.length > 10" class="text-gray-500 py-0.5">
                  {{ t("mount.batchDelete.moreItems", { count: itemsToDelete.length - 10 }) }}
                </div>
              </div>
            </div>
          </template>
        </template>
      </ConfirmDialog>


      <!-- 麵包屑導航 -->
      <div class="mb-4">
          <BreadcrumbNav
          :current-path="currentViewPath"
          :dark-mode="darkMode"
          @navigate="handleNavigate"
          @prefetch="handlePrefetch"
          :basic-path="apiKeyInfo?.basic_path || '/'"
          :user-type="isAdmin ? 'admin' : 'user'"
        />
      </div>

      <!-- 內容區域 - 根據模式顯示檔案列表或檔案預覽 -->
      <div class="mount-content bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <Transition name="fade-slide" mode="out-in" @before-enter="handleContentBeforeEnter">
          <!-- 檔案列表模式 -->
          <div v-if="!showFilePreview" key="list">
            <!-- 內嵌式密碼驗證 -->
            <PathPasswordDialog
              v-if="pathPassword.showPasswordDialog.value"
              :is-open="pathPassword.showPasswordDialog.value"
              :path="pathPassword.pendingPath.value || currentPath"
              :dark-mode="darkMode"
              :inline="true"
              @verified="handlePasswordVerified"
              @cancel="handlePasswordCancel"
              @close="handlePasswordClose"
              @error="handlePasswordError"
            />

            <template v-else>
              <!-- 非阻塞錯誤提示：不再用 error 直接替換整個列表區域 -->
              <div v-if="error" class="mb-4 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-start">
                    <IconXCircle size="md" class="w-5 h-5 text-red-500 mr-2 mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <div class="text-red-700 dark:text-red-200 font-medium">{{ $t("common.error") }}</div>
                      <div class="text-red-700/90 dark:text-red-200/90 text-sm mt-0.5">{{ error }}</div>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                          :class="darkMode ? 'bg-red-800/40 hover:bg-red-800/60 text-red-100' : 'bg-red-200 hover:bg-red-300 text-red-900'"
                          @click="handleRetryDirectory"
                        >
                          {{ $t("common.retry") }}
                        </button>
                        <button
                          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-100' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
                          @click="dismissDirectoryError"
                        >
                          {{ $t("common.close") }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 目錄列表 -->
              <div class="min-h-[400px]">
                <DirectoryList
                  ref="directoryListRef"
                  :current-path="currentPath"
                  :items="visibleItems"
                  :loading="loading"
                  :has-more="directoryHasMore"
                  :loading-more="directoryLoadingMore"
                  :is-virtual="isVirtualDirectory"
                  :dark-mode="darkMode"
                  :view-mode="viewMode"
                  :show-checkboxes="explorerSettings.settings.showCheckboxes"
                  :selected-items="getSelectedItems()"
                  :context-highlight-path="contextHighlightPath"
                  :animations-enabled="explorerSettings.settings.animationsEnabled"
                  :file-name-overflow="explorerSettings.settings.fileNameOverflow"
                  :show-action-buttons="explorerSettings.settings.showActionButtons"
                  :rename-loading="isDirectoryListRenaming"
                  @navigate="handleNavigate"
                  @download="handleDownload"
                  @getLink="handleGetLink"
                  @rename="handleRename"
                  @delete="handleDelete"
                  @preview="handlePreview"
                  @load-more="handleLoadMore"
                  @item-select="handleItemSelect"
                  @toggle-select-all="toggleSelectAll"
                  @show-message="handleShowMessage"
                  @contextmenu="handleFileContextMenu"
                />
              </div>
            </template>
          </div>

          <!-- 檔案預覽模式 -->
          <div v-else key="preview">
            <!-- 預覽載入狀態 -->
            <div v-if="isPreviewLoading" class="p-8 text-center">
              <LoadingIndicator
                :text="$t('common.loading')"
                :dark-mode="darkMode"
                size="xl"
                icon-class="text-blue-500"
              />
            </div>

            <!-- 預覽錯誤狀態 -->
            <div v-else-if="previewError" class="p-8 text-center">
              <div class="flex flex-col items-center space-y-4">
                <IconExclamation size="3xl" class="w-12 h-12 text-red-500" aria-hidden="true" />
                <div class="text-red-600 dark:text-red-400">
                  {{ previewError }}
                </div>
                <button @click="closePreviewWithUrl" class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                  {{ $t("common.back") }}
                </button>
              </div>
            </div>

            <!-- 預覽內容 -->
            <div v-else-if="previewFile || previewInfo" class="p-4">
              <!-- 返回按鈕 -->
              <div class="mb-4">
                <button
                  @click="closePreviewWithUrl"
                  class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
                  :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
                >
                  <IconBack size="sm" class="w-4 h-4 mr-1.5" aria-hidden="true" />
                  <span>{{ t("mount.backToFileList") }}</span>
                </button>
              </div>

              <!-- 檔案預覽內容 -->
              <FilePreview
                :file="previewInfo || previewFile"
                :dark-mode="darkMode"
                :is-loading="isPreviewLoading"
                :is-admin="isAdmin"
                :api-key-info="apiKeyInfo"
                :has-file-permission="hasFilePermission"
                :directory-items="visibleItems"
                @download="handleDownload"
                @loaded="handlePreviewLoaded"
                @error="handlePreviewError"
                @show-message="handleShowMessage"
              />
            </div>
          </div>
        </Transition>
      </div>

      <!-- 底部 README -->
      <DirectoryReadme v-if="!showFilePreview" position="bottom" :meta="directoryMeta" :dark-mode="darkMode" />
    </div>

    <!-- 搜尋彈窗 -->
    <SearchModal
      v-if="hasEverOpenedSearchModal"
      :is-open="isSearchModalOpen"
      :dark-mode="darkMode"
      :current-path="currentPath"
      :current-mount-id="currentMountId"
      @close="handleCloseSearchModal"
      @item-click="handleSearchItemClick"
    />

    <!-- 設定抽屜 -->
    <SettingsDrawer
      v-if="hasEverOpenedSettingsDrawer"
      :is-open="isSettingsDrawerOpen"
      :dark-mode="darkMode"
      @close="handleCloseSettingsDrawer"
    />

    <!-- FS 媒體檢視器（Lightbox Shell） -->
    <FsMediaLightboxDialog v-if="hasEverOpenedLightbox" />

    <!-- 懸浮操作欄 (當有選中項時顯示) -->
    <FloatingActionBar
      v-if="hasPermission && selectedCount > 0"
      :selected-count="selectedCount"
      :dark-mode="darkMode"
      @download="handleBatchDownload"
      @copy-link="handleBatchGetLink"
      @copy="handleBatchCopy"
      @add-to-basket="handleBatchAddToBasket"
      @rename="handleBatchRename"
      @delete="batchDelete"
      @clear-selection="handleClearSelection"
    />

    <!-- 浮動工具欄 (右下角快捷操作) -->
    <FloatingToolbar
      v-if="hasPermission"
      :dark-mode="darkMode"
      :can-write="!isVirtualDirectory"
      :show-checkboxes="explorerSettings.showCheckboxes"
      @refresh="handleRefresh"
      @new-folder="handleCreateFolder"
      @upload="handleOpenUploadModal"
      @toggle-checkboxes="explorerSettings.toggleShowCheckboxes"
      @open-basket="handleOpenFileBasket"
      @open-tasks="handleOpenTasksModal"
      @settings="handleOpenSettingsDrawer"
    />

    <!-- 返回頂部按鈕 -->
    <BackToTop :dark-mode="darkMode" />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted, onBeforeUnmount, watch, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useEventListener, useWindowScroll } from "@vueuse/core";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { IconBack, IconExclamation, IconSearch, IconSettings, IconXCircle } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

// 組合式函式 - 使用統一聚合匯出
// 按需從具體檔案匯入
import { useSelection } from "@/composables/ui-interaction/useSelection.js";
import { useUIState } from "@/composables/ui-interaction/useUIState.js";
import { useFileBasket } from "@/composables/file-system/useFileBasket.js";
import { useFileOperations } from "@/composables/file-system/useFileOperations.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { useContextMenu } from "@/composables/useContextMenu.js";

// 檢視控制器
import { useMountExplorerController } from "./useMountExplorerController.js";

// 子元件
import BreadcrumbNav from "@/modules/fs/components/shared/BreadcrumbNav.vue";
import DirectoryList from "@/modules/fs/components/directory/DirectoryList.vue";
import DirectoryReadme from "@/modules/fs/components/DirectoryReadme.vue";
import FileOperations from "@/modules/fs/components/shared/FileOperations.vue";
// （Uppy、Office、EPUB、影片播放器等）按需載入
const FilePreview = defineAsyncComponent(() => import("@/modules/fs/components/preview/FilePreview.vue"));
const UppyUploadModal = defineAsyncComponent(() => import("@/modules/fs/components/shared/modals/UppyUploadModal.vue"));
const CopyModal = defineAsyncComponent(() => import("@/modules/fs/components/shared/modals/CopyModal.vue"));
const TaskListModal = defineAsyncComponent(() => import("@/modules/fs/components/shared/modals/TaskListModal.vue"));
const SearchModal = defineAsyncComponent(() => import("@/modules/fs/components/shared/modals/SearchModal.vue"));
import PathPasswordDialog from "@/modules/fs/components/shared/modals/PathPasswordDialog.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import InputDialog from "@/components/common/dialogs/InputDialog.vue";
const FsMediaLightboxDialog = defineAsyncComponent(() => import("@/modules/fs/components/lightbox/FsMediaLightboxDialog.vue"));
import PermissionManager from "@/components/common/PermissionManager.vue";
const SettingsDrawer = defineAsyncComponent(() => import("@/modules/fs/components/shared/SettingsDrawer.vue"));
import FloatingActionBar from "@/modules/fs/components/shared/FloatingActionBar.vue";
import FloatingToolbar from "@/modules/fs/components/shared/FloatingToolbar.vue";
import BackToTop from "@/modules/fs/components/shared/BackToTop.vue";
import { useExplorerSettings } from "@/composables/useExplorerSettings";
import { createFsItemNameDialogValidator, isSameOrSubPath, validateFsItemName } from "@/utils/fsPathUtils.js";
import { useFsMediaLightbox } from "@/modules/fs/composables/useFsMediaLightbox";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("MountExplorerView");

const validateFsItemNameDialog = createFsItemNameDialogValidator(t);

// 使用組合式函式
const selection = useSelection();
const fileOperations = useFileOperations();
const uiState = useUIState();
const fileBasket = useFileBasket();
const pathPassword = usePathPassword();

// 右鍵選單 - 延遲初始化
let contextMenu = null;

// Lightbox（模組內單例）
const fsLightbox = useFsMediaLightbox();

// 檔案籃狀態
const { isBasketOpen } = storeToRefs(fileBasket);

// 控制器：封裝路由 / 許可權 / 目錄載入與預覽初始化
const {
  currentPath,
  currentViewPath,
  loading,
  error,
  hasPermissionForCurrentPath,
  directoryItems,
  isVirtualDirectory,
  directoryMeta,
  directoryHasMore,
  directoryLoadingMore,
  isAdmin,
  hasApiKey,
  hasFilePermission,
  hasMountPermission,
  hasPermission,
  apiKeyInfo,
  currentMountId,
  previewFile,
  previewInfo,
  isPreviewLoading,
  previewError,
  showFilePreview,
  updateUrl,
  navigateTo,
  navigateToPreserveHistory,
  navigateToFile,
  stopPreview,
  refreshDirectory,
  refreshCurrentRoute,
  prefetchDirectory,
  consumePendingScrollRestore,
  invalidateCaches,
  removeItemsFromCurrentDirectory,
  loadMoreCurrentDirectory,
} = useMountExplorerController();

const { y: windowScrollY } = useWindowScroll();

// ===== 僅“第一次開啟”時才載入重彈窗元件 =====
const hasEverOpenedUploadModal = ref(false);
const hasEverOpenedCopyModal = ref(false);
const hasEverOpenedTasksModal = ref(false);
const hasEverOpenedSearchModal = ref(false);
const hasEverOpenedSettingsDrawer = ref(false);
const hasEverOpenedLightbox = ref(false);

const scheduleWindowScrollTo = (top) => {
  if (typeof window === "undefined") return;
  // 等列表 DOM 插入並完成一次佈局後再滾動
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      windowScrollY.value = top;
    });
    return;
  }
  // 降級：極端環境無 rAF
  setTimeout(() => {
    windowScrollY.value = top;
  }, 0);
};

// 解決你說的“先下→到頂→再下”抖動：把滾動設定統一收口到 Transition 的進入階段，只執行一次
const handleContentBeforeEnter = () => {
  // 進入預覽：預設回到頂部
  if (showFilePreview.value) {
    scheduleWindowScrollTo(0);
    return;
  }

  // 回到列表：如果 controller 有“待恢復的滾動值”，在列表真正進入前先設定好
  if (typeof consumePendingScrollRestore === "function") {
    const value = consumePendingScrollRestore();
    if (typeof value === "number") {
      scheduleWindowScrollTo(value);
    }
  }
};

// 根據目錄 Meta 的隱藏規則計算實際可見條目
const visibleItems = computed(() => {
  const items = directoryItems.value || [];
  const meta = directoryMeta.value;
  const patterns = meta && Array.isArray(meta.hidePatterns) ? meta.hidePatterns : [];

  if (!patterns.length) {
    return items;
  }

  const regexes = patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter((re) => re);

  if (!regexes.length) {
    return items;
  }

  return items.filter((item) => !regexes.some((re) => re.test(item.name)));
});

const { selectedItems, selectedCount, setAvailableItems, toggleSelectAll, getSelectedItems, selectItem, clearSelection } = selection;

// 組合式函式狀態和方法
const {
  // 訊息管理
  showMessage,
  // 彈窗狀態管理
  isUploadModalOpen,
  isCopyModalOpen,
  isTasksModalOpen,
  isSearchModalOpen,

  openUploadModal,
  closeUploadModal,
  openCopyModal,
  closeCopyModal,
  openTasksModal,
  closeTasksModal,
  openSearchModal,
  closeSearchModal,
} = uiState;

const showDeleteDialog = ref(false);
const itemsToDelete = ref([]);
const isDeleting = ref(false);

// 右鍵選單相關狀態
const contextMenuRenameItem = ref(null);
const contextMenuRenameDialogOpen = ref(false);
const isRenaming = ref(false); // 重新命名操作的 loading 狀態
const contextMenuCopyItems = ref([]);
// 右鍵選單高亮的專案路徑（臨時高亮，不是勾選選中）
const contextHighlightPath = ref(null);
// DirectoryList 元件引用
const directoryListRef = ref(null);
// DirectoryList 重新命名操作的 loading 狀態
const isDirectoryListRenaming = ref(false);

// 新建資料夾彈窗狀態
const showCreateFolderDialog = ref(false);
const isCreatingFolder = ref(false);

// 設定抽屜狀態
const isSettingsDrawerOpen = ref(false);

// ===== 僅“第一次開啟”時才載入重彈窗元件（watch 需要在依賴變數定義之後註冊） =====
watch(
  () => isUploadModalOpen.value,
  (open) => {
    if (open) hasEverOpenedUploadModal.value = true;
  }
);
watch(
  () => isCopyModalOpen.value,
  (open) => {
    if (open) hasEverOpenedCopyModal.value = true;
  }
);
watch(
  () => isTasksModalOpen.value,
  (open) => {
    if (open) hasEverOpenedTasksModal.value = true;
  }
);
watch(
  () => isSearchModalOpen.value,
  (open) => {
    if (open) hasEverOpenedSearchModal.value = true;
  }
);
watch(
  () => isSettingsDrawerOpen.value,
  (open) => {
    if (open) hasEverOpenedSettingsDrawer.value = true;
  }
);
watch(
  () => fsLightbox.isOpen.value,
  (open) => {
    if (open) hasEverOpenedLightbox.value = true;
  }
);

// 初始化使用者配置
const explorerSettings = useExplorerSettings();

// 從 explorerSettings 獲取檢視模式
const viewMode = computed(() => explorerSettings.settings.viewMode);
const setViewMode = (mode) => explorerSettings.setViewMode(mode);

// 複製彈窗使用的專案列表：優先使用右鍵選單選中的專案，否則使用勾選的專案
const copyModalItems = computed(() => {
  if (contextMenuCopyItems.value.length > 0) {
    return contextMenuCopyItems.value;
  }
  return getSelectedItems();
});

// 初始化右鍵選單
const initContextMenu = () => {
  contextMenu = useContextMenu({
    onDownload: handleDownload,
    onGetLink: handleGetLink,
    onRename: (item) => {
      // 直接觸發重新命名，設定待重新命名的專案
      contextMenuRenameItem.value = item;
      contextMenuRenameDialogOpen.value = true;
    },
    onDelete: (items) => {
      if (Array.isArray(items)) {
        itemsToDelete.value = items;
      } else {
        itemsToDelete.value = [items];
      }
      showDeleteDialog.value = true;
    },
    onCopy: (items) => {
      // 右鍵選單複製：直接使用傳入的專案，而不是依賴 selectedItems
      const itemsArray = Array.isArray(items) ? items : [items];
      if (itemsArray.length === 0) {
        showMessage("warning", t("mount.messages.noItemsSelected"));
        return;
      }
      // 臨時設定選中專案以便複製彈窗使用
      contextMenuCopyItems.value = itemsArray;
      openCopyModal();
    },
    onAddToBasket: (items) => {
      const itemsArray = Array.isArray(items) ? items : [items];
      const result = fileBasket.addSelectedToBasket(itemsArray, currentPath.value);
      if (result.success) {
        showMessage("success", result.message);
      } else {
        showMessage("error", result.message);
      }
    },
    onToggleCheckboxes: () => {
      // 切換勾選框顯示狀態
      explorerSettings.toggleShowCheckboxes();
    },
    t,
  });
};

onMounted(() => {
  explorerSettings.loadSettings();
  explorerSettings.setupDarkModeObserver();
  initContextMenu();
});

const props = defineProps({
  mode: {
    type: String,
    default: "default", // 預設模式，或 "selection"（選擇模式）
  },
});

const { isDarkMode: darkMode } = useThemeMode();

// 許可權變化處理
const handlePermissionChange = (hasPermission) => {
  // 許可權狀態會自動更新，這裡只需要記錄日誌
};

// API金鑰資訊
// 導航到管理頁面
const navigateToAdmin = () => {
  import("@/router").then(({ routerUtils }) => {
    routerUtils.navigateTo("admin");
  });
};

// 搜尋相關事件處理
const handleOpenSearchModal = () => {
  openSearchModal();
};

// 設定抽屜事件處理
const handleOpenSettingsDrawer = () => {
  isSettingsDrawerOpen.value = true;
};

const handleCloseSettingsDrawer = () => {
  isSettingsDrawerOpen.value = false;
};

// 開啟檔案籃
const handleOpenFileBasket = () => {
  fileBasket.toggleBasket();
};

// 懸浮操作欄事件處理
const handleBatchDownload = async () => {
  const selectedFiles = getSelectedItems();
  for (const item of selectedFiles) {
    if (!item.isDirectory) {
      await handleDownload(item);
    }
  }
};

const handleBatchGetLink = async () => {
  const selectedFiles = getSelectedItems();
  if (selectedFiles.length === 1 && !selectedFiles[0].isDirectory) {
    await handleGetLink(selectedFiles[0]);
  }
};

const handleBatchRename = () => {
  const selectedFiles = getSelectedItems();
  if (selectedFiles.length === 1) {
    // 直接開啟重新命名對話方塊
    contextMenuRenameItem.value = selectedFiles[0];
    contextMenuRenameDialogOpen.value = true;
  }
};

const handleClearSelection = () => {
  clearSelection();
};

const handleCloseSearchModal = () => {
  closeSearchModal();
};

// 處理搜尋結果項點選
const handleSearchItemClick = async (item) => {
  try {
    if (!item.isDirectory) {
      await navigateToFile(item.path);
    } else {
      await navigateTo(item.path);
    }

    // 關閉搜尋模態框
    closeSearchModal();
  } catch (error) {
    log.error("搜尋結果導航失敗:", error);
    showMessage("error", "導航失敗: " + error.message);
  }
};

// ===== MountExplorerMain的所有方法 =====

/**
 * 處理導航
 */
const handleNavigate = async (path) => {
  // 麵包屑/返回上級屬於“回退導航”：
  // - 優先保留目標目錄的 history 快照
  if (isSameOrSubPath(path, currentViewPath.value)) {
    await navigateToPreserveHistory(path);
    return;
  }

  await navigateTo(path);
};

const handlePrefetch = (path) => {
  prefetchDirectory(path);
};

/**
 * 處理重新整理
 */
const handleRefresh = async () => {
  await refreshDirectory();
};

/**
 * 處理“載入更多”（用於上游分頁的目錄）
 */
const handleLoadMore = async () => {
  await loadMoreCurrentDirectory();
};

/**
 * 處理檢視模式變化
 */
const handleViewModeChange = (newViewMode) => {
  setViewMode(newViewMode);
  // 檢視模式已透過 useExplorerSettings 自動儲存到 localStorage
};

/**
 * 處理資料夾建立 - 開啟彈窗
 */
const handleCreateFolder = () => {
  showCreateFolderDialog.value = true;
};

/**
 * 處理新建資料夾確認
 */
const handleCreateFolderConfirm = async (folderName) => {
  if (!folderName) return;

  isCreatingFolder.value = true;
  try {
    // 使用fileOperations建立資料夾，傳遞正確的引數
    const result = await fileOperations.createFolder(currentPath.value, folderName);

    if (result.success) {
      showMessage("success", result.message);
      invalidateCaches();
      // 重新載入當前目錄內容
      await refreshDirectory();
      showCreateFolderDialog.value = false;
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    log.error("建立資料夾失敗:", error);
    showMessage("error", "建立資料夾失敗，請重試");
  } finally {
    isCreatingFolder.value = false;
  }
};

/**
 * 處理新建資料夾取消
 */
const handleCreateFolderCancel = () => {
  showCreateFolderDialog.value = false;
};

/**
 * 處理右鍵選單重新命名確認
 */
const handleContextMenuRenameConfirm = async (newName) => {
  if (!contextMenuRenameItem.value || !newName || !newName.trim()) return;

  const nameValidation = validateFsItemName(newName);
  if (!nameValidation.valid) return;

  // 設定 loading 狀態
  isRenaming.value = true;

  try {
    const item = contextMenuRenameItem.value;
    const isDirectory = item.isDirectory;
    const oldPath = item.path;
    const basePath = isDirectory && oldPath.endsWith("/") ? oldPath.slice(0, -1) : oldPath;
    const parentPath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    let newPath = parentPath + newName.trim();

    // 目錄在後端契約中仍以 `/` 結尾
    if (isDirectory) {
      newPath += "/";
    }

    // 使用 fileOperations 重新命名
    const result = await fileOperations.renameItem(oldPath, newPath);

    if (result.success) {
      showMessage("success", result.message);
      invalidateCaches();
      // 重新載入當前目錄內容
      await refreshDirectory();
      // 關閉對話方塊並清理狀態
      contextMenuRenameDialogOpen.value = false;
      contextMenuRenameItem.value = null;
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    log.error("重新命名失敗:", error);
    showMessage("error", error.message || t("mount.rename.failed"));
  } finally {
    isRenaming.value = false;
  }
};

/**
 * 處理右鍵選單重新命名取消
 */
const handleContextMenuRenameCancel = () => {
  contextMenuRenameDialogOpen.value = false;
  contextMenuRenameItem.value = null;
};

/**
 * 關閉檔案籃面板
 */
const closeBasket = () => {
  try {
    fileBasket.closeBasket();
  } catch (error) {
    log.error("關閉檔案籃面板失敗:", error);
  }
};

/**
 * 處理檔案下載
 */
const handleDownload = async (item) => {
  const result = await fileOperations.downloadFile(item);

  if (result.success) {
    showMessage("success", result.message);
  } else {
    showMessage("error", result.message);
  }
};

/**
 * 處理獲取檔案連結
 */
const handleGetLink = async (item) => {
  const result = await fileOperations.getFileLink(item);

  if (result.success) {
    showMessage("success", result.message);
  } else {
    showMessage("error", result.message);
  }
};

/**
 * 處理檔案預覽
 */
const handlePreview = async (item) => {
  if (!item || item.isDirectory) return;

  // 直接導航到檔案路徑（pathname 表示物件）
  await navigateToFile(item.path);
};

/**
 * 處理檔案刪除（顯示確認對話方塊）
 */
const handleDelete = (item) => {
  itemsToDelete.value = [item];
  showDeleteDialog.value = true;
};

/**
 * 處理檔案重新命名
 */
const handleRename = async ({ item, newName }) => {
  if (!item || !newName || !newName.trim()) return;

  const nameValidation = validateFsItemName(newName);
  if (!nameValidation.valid) return;

  // 設定 loading 狀態（用於 DirectoryList 內部的重新命名對話方塊）
  isDirectoryListRenaming.value = true;

  try {
    // 構建新路徑
    const isDirectory = item.isDirectory;
    const oldPath = item.path;
    const basePath = isDirectory && oldPath.endsWith("/") ? oldPath.slice(0, -1) : oldPath;
    const parentPath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    let newPath = parentPath + newName.trim();

    // 目錄在後端契約中仍以 `/` 結尾
    if (isDirectory) {
      newPath += "/";
    }

    // 使用fileOperations重新命名
    const result = await fileOperations.renameItem(oldPath, newPath);

    if (result.success) {
      showMessage("success", result.message);
      invalidateCaches();
      // 重新載入當前目錄內容
      await refreshDirectory();
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    showMessage("error", error.message || t("mount.rename.failed"));
  } finally {
    isDirectoryListRenaming.value = false;
    // 關閉 DirectoryList 的重新命名對話方塊
    directoryListRef.value?.closeRenameDialog();
  }
};

/**
 * 處理專案選擇
 */
const handleItemSelect = (item, selected) => {
  selectItem(item, selected);
};

// handleItemDelete方法在原始檔案中不存在，已刪除（使用handleDelete代替）

/**
 * 處理批次刪除
 */
const batchDelete = () => {
  const selectedFiles = getSelectedItems();

  if (selectedFiles.length === 0) {
    showMessage("warning", t("mount.messages.noItemsSelected"));
    return;
  }

  itemsToDelete.value = selectedFiles;
  showDeleteDialog.value = true;
};

/**
 * 取消刪除
 */
const cancelDelete = () => {
  // 刪除過程中不允許取消
  if (isDeleting.value) return;

  // 清理刪除狀態
  itemsToDelete.value = [];
};

/**
 * 確認刪除
 */
const confirmDelete = async () => {
  if (itemsToDelete.value.length === 0 || isDeleting.value) return;

  isDeleting.value = true;

  try {
    // 使用fileOperations刪除專案
    const result = await fileOperations.batchDeleteItems(itemsToDelete.value);

    if (result.success) {
      showMessage("success", result.message);

      // 刪除屬於寫操作：清空前端快取（秒開快照 + 可驗證快取），強制下一次導航以服務端為準
      invalidateCaches();
      // 立即從當前目錄移除（減少等待與閃爍）
      removeItemsFromCurrentDirectory(itemsToDelete.value.map((item) => item?.path).filter(Boolean));

      // 如果是批次刪除，清空選擇狀態
      if (itemsToDelete.value.length > 1) {
        clearSelection();
      }

      // 關閉對話方塊
      showDeleteDialog.value = false;
      itemsToDelete.value = [];

      // 重新載入當前目錄內容
      await refreshDirectory();
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    log.error("刪除操作失敗:", error);
    showMessage("error", error.message || t("mount.messages.deleteFailed", { message: t("common.unknown") }));
  } finally {
    isDeleting.value = false;
  }
};

// 這些方法在原始MountExplorerMain.vue中不存在，已刪除

const handleBatchAddToBasket = () => {
  try {
    const selectedFiles = getSelectedItems();
    const result = fileBasket.addSelectedToBasket(selectedFiles, currentPath.value);

    if (result.success) {
      showMessage("success", result.message);
      // 可選：關閉勾選模式
      // toggleCheckboxMode(false);
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    log.error("批次新增到檔案籃失敗:", error);
    showMessage("error", t("fileBasket.messages.batchAddFailed"));
  }
};

// 彈窗相關方法
const handleOpenUploadModal = () => {
  openUploadModal();
};

const handleCloseUploadModal = () => {
  closeUploadModal();
};

const handleUploadSuccess = async (payload) => {
  const count = Number(payload?.count || 0);
  const skippedUploadCount = Number(payload?.skippedUploadCount || 0);

  if (skippedUploadCount > 0) {
    showMessage("success", t("mount.messages.uploadSuccessWithSkipped", { count, skipped: skippedUploadCount }));
  } else if (count > 1) {
    // 相容：多檔案時給更明確的提示
    showMessage("success", t("mount.messages.uploadSuccessWithCount", { count }));
  } else {
    showMessage("success", t("mount.messages.uploadSuccess"));
  }
  invalidateCaches();
  await refreshDirectory();
};

const handleUploadError = (error) => {
  log.error("上傳失敗:", error);
  showMessage("error", error.message || t("mount.messages.uploadFailed"));
};

const handleBatchCopy = () => {
  if (selectedItems.value.length === 0) {
    showMessage("warning", t("mount.messages.noItemsSelected"));
    return;
  }
  openCopyModal();
};

const handleCloseCopyModal = () => {
  closeCopyModal();
  // 清理右鍵選單複製專案
  contextMenuCopyItems.value = [];
};

const handleCopyStarted = (event) => {
  // 顯示覆制開始訊息
  const message =
    event?.message ||
    t("mount.taskManager.copyStarted", {
      count: event?.itemCount || 0,
      path: event?.targetPath || "",
    });
  showMessage("success", message);
  clearSelection();
};

const handleOpenTasksModal = () => {
  openTasksModal();
};

const handleCloseTasksModal = () => {
  closeTasksModal();
};

/**
 * 處理任務完成事件 - 自動重新整理當前目錄
 */
const handleTaskCompleted = async (event) => {
  // 延遲一小段時間再重新整理，確保後端資料已同步
  setTimeout(async () => {
    try {
      invalidateCaches();
      await refreshDirectory();
      showMessage('success', t('mount.taskManager.taskCompletedRefresh'));
    } catch (error) {
      log.error('[MountExplorer] 重新整理目錄失敗:', error);
    }
  }, 500);
};

/**
 * 處理任務建立事件
 */
const handleTaskCreated = (taskInfo) => {
  // 可以在這裡新增額外的任務跟蹤邏輯
  // 例如：開啟工作管理員面板
  // openTasksModal();
};

const handleShowMessage = (messageInfo) => {
  showMessage(messageInfo.type, messageInfo.message);
};

// 用於儲存清除高亮的函式引用，以便在下次右鍵時先移除舊監聽器
let clearHighlightHandler = null;
let stopClearHighlightListener = null;

// 處理右鍵選單事件
// 1. 單檔案右鍵：只臨時高亮顯示當前檔案
// 2. 有選中項時右鍵：操作已選中的專案
const handleFileContextMenu = (payload) => {
  if (!contextMenu) return;
  const { event, item, action } = payload;

  // 處理特殊操作（不需要 item 的操作）
  if (action) {
    switch (action) {
      case 'copy':
        // 複製操作：使用 payload.items
        if (payload.items && payload.items.length > 0) {
          contextMenuCopyItems.value = payload.items;
          openCopyModal();
        }
        return;
      
      case 'add-to-basket':
        // 新增到檔案籃操作：使用 payload.items
        if (payload.items && payload.items.length > 0) {
          const result = fileBasket.addSelectedToBasket(payload.items, currentPath.value);
          if (result.success) {
            showMessage("success", result.message);
          } else {
            showMessage("error", result.message);
          }
        }
        return;
      
      case 'toggle-checkboxes':
        // 切換勾選框顯示
        explorerSettings.toggleShowCheckboxes();
        return;
    }
  }

  // 常規右鍵選單處理（需要 item）
  if (!item) return;

  // 先移除之前的監聽器（如果存在）
  if (typeof stopClearHighlightListener === "function") {
    stopClearHighlightListener();
    stopClearHighlightListener = null;
  }
  clearHighlightHandler = null;

  // 獲取當前已選中的專案
  const selectedFiles = getSelectedItems();
  const isItemSelected = selectedFiles.some((i) => i.path === item.path);

  let itemsForMenu;

  if (selectedFiles.length > 0) {
    // 有選中項時：
    // - 如果右鍵的專案已在選中列表中，操作所有選中專案
    // - 如果右鍵的專案不在選中列表中，只操作當前專案（不改變選中狀態）
    if (isItemSelected) {
      itemsForMenu = selectedFiles;
      // 已選中的專案不需要臨時高亮
      contextHighlightPath.value = null;
    } else {
      itemsForMenu = [item];
      // 設定臨時高亮
      contextHighlightPath.value = item.path;
    }
  } else {
    // 無選中項：只操作當前右鍵的專案，設定臨時高亮
    itemsForMenu = [item];
    contextHighlightPath.value = item.path;
  }

  // 顯示右鍵選單（傳遞當前勾選框顯示狀態）
  contextMenu.showContextMenu(event, item, itemsForMenu, darkMode.value, explorerSettings.settings.showCheckboxes);

  // 建立清除高亮的處理函式
  // 只監聽 click 事件（左鍵點選關閉選單時清除高亮）
  // 不監聽 contextmenu 事件，因為下次右鍵會直接設定新的高亮
  clearHighlightHandler = () => {
    contextHighlightPath.value = null;
    if (typeof stopClearHighlightListener === "function") {
      stopClearHighlightListener();
      stopClearHighlightListener = null;
    }
  };

  // 延遲新增監聽器，避免當前事件立即觸發
  // 使用 ref 儲存 timeout ID 以便在元件解除安裝時清理
  const timeoutId = setTimeout(() => {
    if (clearHighlightHandler) {
      stopClearHighlightListener = useEventListener(document, "click", clearHighlightHandler, { once: true });
    }
  }, 50);
};

// 密碼驗證事件處理
const handlePasswordVerified = ({ path, token, message }) => {
  // 儲存驗證 token
  pathPassword.savePathToken(path, token);

  // 顯示成功訊息
  showMessage("success", message || t("mount.pathPassword.verified"));

  // 關閉彈窗
  pathPassword.closePasswordDialog();
  pathPassword.clearPendingPath();

  // 重新載入當前路由（可能是目錄，也可能是檔案深鏈）
  refreshCurrentRoute();
};

const handlePasswordCancel = async () => {
  // 關閉密碼彈窗
  pathPassword.closePasswordDialog();
  pathPassword.clearPendingPath();

  // 計算父目錄路徑
  const currentPathValue = currentPath.value;
  let parentPath = "/";

  if (currentPathValue && currentPathValue !== "/") {
    // 移除末尾的斜槓（如果有）
    const normalized = currentPathValue.replace(/\/+$/, "");
    // 獲取最後一個斜槓之前的部分
    const lastSlashIndex = normalized.lastIndexOf("/");
    if (lastSlashIndex > 0) {
      parentPath = normalized.substring(0, lastSlashIndex);
    }
  }

  // 導航到父目錄
  await navigateTo(parentPath);
};

const handlePasswordClose = () => {
  pathPassword.closePasswordDialog();
};

const handlePasswordError = ({ message }) => {
  log.error("密碼驗證錯誤:", message);
  showMessage("error", message);
};

// 預覽相關方法
let lastPreviewLoadedKey = "";
const handlePreviewLoaded = () => {
  // 避免同一個檔案在媒體事件重複觸發時刷屏
  const f = previewInfo.value || previewFile.value;
  const key = f?.path || f?.name || "";
  if (key && key === lastPreviewLoadedKey) return;
  lastPreviewLoadedKey = key;
};

const handlePreviewError = (error) => {
  log.error("預覽載入失敗:", error);
  showMessage("error", t("mount.messages.previewError"));
};

const closePreviewWithUrl = async () => {
  await navigateToPreserveHistory(currentPath.value);
};

const handleRetryDirectory = async () => {
  // 清掉當前錯誤
  error.value = null;
  await refreshDirectory();
};

const dismissDirectoryError = () => {
  error.value = null;
};

// 預覽相關事件處理已在上面定義

// 提供資料給子元件
provide("darkMode", darkMode);
provide("isAdmin", isAdmin);
provide("apiKeyInfo", apiKeyInfo);
provide("hasPermissionForCurrentPath", hasPermissionForCurrentPath);
provide("navigateToFile", navigateToFile);

// 處理認證狀態變化
const handleAuthStateChange = (event) => {
  // 許可權狀態會自動更新，這裡只需要記錄日誌
};

// 全域性快捷鍵處理
const handleGlobalKeydown = (event) => {
  // Ctrl+K 開啟搜尋
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    if (hasPermission.value && !isSearchModalOpen.value) {
      handleOpenSearchModal();
    }
  }

  // ESC 關閉搜尋
  if (event.key === "Escape" && isSearchModalOpen.value) {
    handleCloseSearchModal();
  }
};

// 註冊全域性事件（自動清理）
useEventListener(window, "auth-state-changed", handleAuthStateChange);
useEventListener(document, "keydown", handleGlobalKeydown);

// 監聽目錄專案變化，更新選擇狀態（僅針對可見條目）
watch(
  () => visibleItems.value,
  (newItems) => {
    setAvailableItems(newItems);
  },
  { immediate: true }
);

// 監聽路徑變化，自動關閉密碼彈窗
watch(
  () => currentPath.value,
  (newPath, oldPath) => {
    if (newPath !== oldPath && pathPassword.showPasswordDialog.value) {
      pathPassword.closePasswordDialog();
      pathPassword.clearPendingPath();
    }
  }
);

// 元件解除安裝時清理資源
onBeforeUnmount(() => {
  // 清理 clearHighlightHandler 事件監聽器
  if (typeof stopClearHighlightListener === "function") {
    stopClearHighlightListener();
    stopClearHighlightListener = null;
  }
  clearHighlightHandler = null;

  // 清理 MutationObserver
  explorerSettings.cleanupDarkModeObserver();

  // 停止預覽
  stopPreview();

  // 清理選擇狀態
  clearSelection();
});
</script>

<style scoped>
/* Smooth View Transitions */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
