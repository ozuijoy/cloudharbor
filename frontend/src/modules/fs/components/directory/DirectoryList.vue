<template>
  <div>
    <!-- 列表檢視的表頭 -->
    <div
      v-if="viewMode === 'list'"
      class="grid items-center gap-3 py-2 px-3 mx-1 border-b sticky top-16 z-10 backdrop-blur-md rounded-t-xl transition-colors duration-200"
      :class="[
        darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-white/80 border-gray-200',
        headerGridClass,
      ]"
    >
      <!-- 全選勾選框 (根據全域性設定顯示) -->
      <div v-if="showCheckboxes" class="flex items-center justify-center p-2 -m-2">
        <input
          type="checkbox"
          :checked="isAllSelected"
          @change="toggleSelectAll(!isAllSelected)"
          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
        />
      </div>
      <div
        class="flex items-center justify-center"
        :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
        :title="t('mount.fileList.type')"
      >
        <IconDocument class="w-4 h-4 opacity-70" aria-hidden="true" />
        <span class="sr-only">{{ t("mount.fileList.type") }}</span>
      </div>

      <!-- 可排序的名稱列 -->
      <div
        class="font-medium cursor-pointer select-none flex items-center hover:opacity-75 transition-opacity"
        :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
        @click="handleSort('name')"
        :title="t('mount.fileList.clickToSort')"
      >
        <span class="truncate">{{ t("mount.fileList.name") }}</span>
        <!-- 排序圖示 -->
        <template v-if="getSortIcon('name')">
          <IconChevronDown v-if="sortField === 'name' && sortOrder === 'asc'" size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
          <IconChevronUp v-else size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
        </template>
        <!-- 預設排序提示圖示 -->
        <IconHamburger v-else size="xs" class="ml-1 flex-shrink-0 opacity-40" aria-hidden="true" />
      </div>

      <!-- 可排序的大小列 -->
      <div
        class="min-w-24 text-center font-medium hidden sm:flex cursor-pointer select-none items-center justify-center hover:opacity-75 transition-opacity"
        :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
        @click="handleSort('size')"
        :title="t('mount.fileList.clickToSort')"
      >
        <span>{{ t("mount.fileList.size") }}</span>
        <!-- 排序圖示 -->
        <template v-if="getSortIcon('size')">
          <IconChevronDown v-if="sortField === 'size' && sortOrder === 'asc'" size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
          <IconChevronUp v-else size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
        </template>
        <!-- 預設排序提示圖示 -->
        <IconHamburger v-else size="xs" class="ml-1 flex-shrink-0 opacity-40" aria-hidden="true" />
      </div>

      <!-- 可排序的修改時間列 -->
      <div
        class="min-w-36 text-center font-medium hidden sm:flex cursor-pointer select-none items-center justify-center hover:opacity-75 transition-opacity"
        :class="darkMode ? 'text-gray-300' : 'text-gray-700'"
        @click="handleSort('modified')"
        :title="t('mount.fileList.clickToSort')"
      >
        <span>{{ t("mount.fileList.modifiedTime") }}</span>
        <!-- 排序圖示 -->
        <template v-if="getSortIcon('modified')">
          <IconChevronDown v-if="sortField === 'modified' && sortOrder === 'asc'" size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
          <IconChevronUp v-else size="xs" class="ml-1 flex-shrink-0" aria-hidden="true" />
        </template>
        <!-- 預設排序提示圖示 -->
        <IconHamburger v-else size="xs" class="ml-1 flex-shrink-0 opacity-40" aria-hidden="true" />
      </div>

      <div v-if="showActionButtons" class="min-w-[80px] sm:min-w-32 text-center font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("mount.fileList.actions") }}</div>
    </div>

    <div v-if="loading">
      <!-- 骨架屏載入 -->
      <SkeletonLoader :dark-mode="darkMode" :count="8" />
    </div>

    <div v-else-if="!items.length" class="py-8 flex flex-col items-center justify-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <IconFolderOpen size="3xl" class="mb-2" aria-hidden="true" />
      <div>{{ isVirtual ? t("mount.fileList.noMountPoints") : t("mount.fileList.empty") }}</div>
    </div>

    <div v-else>
      <!-- 列表檢視 -->
      <div v-if="viewMode === 'list'" ref="listContainerRef">
        <!-- 虛擬滾動模式（檔案數量超過閾值時啟用） -->
        <div 
          v-if="shouldVirtualize"
          class="virtual-scroll-wrapper"
          :style="{ height: `${totalVirtualSize}px`, width: '100%', position: 'relative' }"
        >
          <FileItem
            v-for="virtualRow in virtualItems"
            :key="sortedItems[virtualRow.index].path"
            :item="sortedItems[virtualRow.index]"
            :index="virtualRow.index"
            :dark-mode="darkMode"
            :show-checkboxes="showCheckboxes"
            :is-selected="isItemSelected(sortedItems[virtualRow.index])"
            :is-context-highlight="isContextHighlight(sortedItems[virtualRow.index])"
            :current-path="currentPath"
            :animations-enabled="animationsEnabled"
            :file-name-overflow="fileNameOverflow"
            :show-action-buttons="showActionButtons"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }"
            @click="handleItemClick(sortedItems[virtualRow.index])"
            @download="handleDownload"
            @rename="handleRename"
            @delete="handleDelete"
            @select="handleItemSelect"
            @getLink="handleGetLink"
            @show-message="handleShowMessage"
            @contextmenu="handleContextMenu"
          />
        </div>
        
        <!-- 普通渲染模式（檔案數量較少時使用） -->
        <template v-else>
          <FileItem
            v-for="(item, index) in sortedItems"
            :key="item.path"
            :item="item"
            :index="index"
            :dark-mode="darkMode"
            :show-checkboxes="showCheckboxes"
            :is-selected="isItemSelected(item)"
            :is-context-highlight="isContextHighlight(item)"
            :current-path="currentPath"
            :animations-enabled="animationsEnabled"
            :file-name-overflow="fileNameOverflow"
            :show-action-buttons="showActionButtons"
            @click="handleItemClick(item)"
            @download="handleDownload"
            @rename="handleRename"
            @delete="handleDelete"
            @select="handleItemSelect"
            @getLink="handleGetLink"
            @show-message="handleShowMessage"
            @contextmenu="handleContextMenu"
          />
        </template>
      </div>

      <!-- 網格檢視 - 使用 auto-fill + minmax 實現平滑響應式 -->
      <div v-else-if="viewMode === 'grid'" class="directory-grid p-4">
        <div
          v-for="item in sortedItems"
          :key="item.path"
          class="relative flex flex-col items-center p-2 sm:p-3 rounded-lg transition-colors hover:cursor-pointer group"
          :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'"
          @click="handleItemClick(item)"
        >
          <!-- 勾選框 (根據全域性設定顯示) -->
          <div v-if="showCheckboxes" class="absolute top-1 left-1 z-10" @click.stop="toggleItemSelect(item)">
            <input
              type="checkbox"
              :checked="isItemSelected(item)"
              class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
            />
          </div>

          <!-- 檔案/資料夾圖示 -->
          <div class="mb-2 w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12">
            <span v-html="getFileIcon(item, darkMode)"></span>
          </div>

          <!-- 檔案/資料夾名稱 -->
          <div class="text-center truncate w-full text-xs sm:text-sm md:text-base" :class="darkMode ? 'text-gray-200' : 'text-gray-700'" :title="item.name">
            {{ item.name }}
          </div>

          <!-- 操作按鈕 -->
          <div class="mt-2 flex space-x-0.5 sm:space-x-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <!-- 下載按鈕 (僅檔案) -->
            <button
              v-if="!item.isDirectory"
              @click.stop="handleDownload(item)"
              class="p-1 sm:p-1 rounded-full"
              :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
            >
              <IconDownload class="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
            </button>

            <!-- 直鏈按鈕 (僅檔案) -->
            <button
              v-if="!item.isDirectory"
              @click.stop="handleGetLink(item)"
              class="p-1 sm:p-1 rounded-full"
              :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
            >
              <IconLink class="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
            </button>

            <!-- 重新命名按鈕 - 只對檔案顯示，資料夾暫時不顯示重新命名按鈕 -->
            <button
              v-if="!item.isDirectory"
              @click.stop="handleRename(item)"
              class="p-1 sm:p-1 rounded-full"
              :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
            >
              <IconRename class="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
            </button>

            <!-- 刪除按鈕 -->
            <button @click.stop="handleDelete(item)" class="p-1 sm:p-1 rounded-full" :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'">
              <IconDelete class="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
            </button>
          </div>

          <!-- 檔案大小與修改時間提示 -->
          <div class="mt-1 text-xs text-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            <span v-if="item.isDirectory && item.isVirtual">-</span>
            <span v-else>{{ formatSize(item.size) }}</span>
          </div>
        </div>
      </div>

      <!-- 圖廊檢視 -->
      <GalleryView
        v-else-if="viewMode === 'gallery'"
        :items="sortedItems"
        :dark-mode="darkMode"
        :is-checkbox-mode="showCheckboxes"
        :selected-items="selectedItems"
        @item-click="handleItemClick"
        @item-select="handleItemSelect"
        @download="handleDownload"
        @getLink="handleGetLink"
        @rename="handleRename"
        @delete="handleDelete"
        @contextmenu="handleContextMenu"
      />

      <!-- 目錄分頁：載入更多（通用能力：上游分頁/超大目錄時按頁拉取） -->
      <div v-if="hasMore" class="px-4 pb-6 flex flex-col items-center gap-2">
        <!-- 哨兵：用於“滾動到底自動觸發載入更多”（無感） -->
        <!-- 注意：必須有非零尺寸，否則部分瀏覽器不會穩定觸發 IntersectionObserver -->
        <div ref="loadMoreSentinelRef" class="h-2 w-full" aria-hidden="true"></div>
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="[
            darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-100' : 'bg-gray-200 hover:bg-gray-300 text-gray-800',
            loadingMore ? 'opacity-70 cursor-not-allowed' : '',
          ]"
          :disabled="loadingMore"
          @click="emit('load-more')"
        >
          {{ loadingMore ? t("common.loading") : t("mount.fileList.loadMore") }}
        </button>
        <div class="text-xs text-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("mount.fileList.pagedHint") }}
        </div>
      </div>
    </div>

    <!-- 通用 InputDialog 元件替換內聯重新命名對話方塊 -->
    <InputDialog
      :is-open="showRenameDialog"
      :title="t('mount.rename.title')"
      :description="t('mount.rename.enterNewName')"
      :label="t('mount.rename.newName')"
      :initial-value="newName"
      :validator="validateFsItemNameDialog"
      :confirm-text="t('mount.rename.confirm')"
      :cancel-text="t('mount.rename.cancel')"
      :loading="renameLoading"
      :loading-text="t('mount.rename.renaming')"
      :dark-mode="darkMode"
      @confirm="handleRenameConfirm"
      @cancel="handleRenameCancel"
      @close="handleRenameDialogClose"
    />

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch, defineAsyncComponent } from "vue";
import { useEventListener, useWindowScroll } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useWindowVirtualizer } from "@tanstack/vue-virtual";
import FileItem from "./FileItem.vue";
// 僅當切到 viewMode=gallery 時才需要載入。
const GalleryView = defineAsyncComponent(() => import("./GalleryView.vue"));
import SkeletonLoader from "../shared/SkeletonLoader.vue";
import { IconChevronDown, IconChevronUp, IconDelete, IconDocument, IconDownload, IconFolderOpen, IconHamburger, IconLink, IconRename } from "@/components/icons";
import { getFileIcon } from "@/utils/fileTypeIcons.js";
import { useDirectorySort } from "@/composables/file-system/useDirectorySort.js";
import { useFileOperations } from "@/composables/file-system/useFileOperations.js";
import InputDialog from "@/components/common/dialogs/InputDialog.vue";
import { createFsItemNameDialogValidator, validateFsItemName } from "@/utils/fsPathUtils.js";

const { t } = useI18n();

const validateFsItemNameDialog = createFsItemNameDialogValidator(t);

// ===== 虛擬滾動配置 =====
// 虛擬滾動閾值：超過此數量啟用虛擬滾動
const VIRTUAL_SCROLL_THRESHOLD = 500;
// FileItem 高度（畫素），包含 margin
const FILE_ITEM_HEIGHT = 52;
// 緩衝區專案數
const OVERSCAN = 10;

// 使用新的組合式函式
const { sortField, sortOrder, handleSort, getSortIcon, createSortedItems, initializeSortState } = useDirectorySort();

const { getFileLink } = useFileOperations();

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  // 目錄分頁：是否還有下一頁（由父元件/後端決定）
  hasMore: {
    type: Boolean,
    default: false,
  },
  // 目錄分頁：載入更多按鈕的 loading 狀態
  loadingMore: {
    type: Boolean,
    default: false,
  },
  isVirtual: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  viewMode: {
    type: String,
    default: "list", // 'list' | 'grid' | 'gallery'
  },
  showCheckboxes: {
    type: Boolean,
    default: false,
  },
  selectedItems: {
    type: Array,
    default: () => [],
  },
  // 右鍵選單高亮的專案路徑（用於臨時高亮顯示）
  contextHighlightPath: {
    type: String,
    default: null,
  },
  currentPath: {
    type: String,
    required: true,
  },
  animationsEnabled: {
    type: Boolean,
    default: true,
  },
  // 檔名過長處理模式: ellipsis(省略號) | scroll(滾動) | wrap(換行)
  fileNameOverflow: {
    type: String,
    default: 'ellipsis',
  },
  // 是否顯示操作按鈕列
  showActionButtons: {
    type: Boolean,
    default: true,
  },
  // 重新命名操作的 loading 狀態（由父元件控制）
  renameLoading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["navigate", "download", "getLink", "rename", "delete", "preview", "item-select", "toggle-select-all", "show-message", "contextmenu", "load-more"]);

const sortedItems = createSortedItems(computed(() => props.items));

// ===== 虛擬滾動實現（Window Virtualizer 模式）=====
// 虛擬列表容器引用（用於計算 scrollMargin）
const listContainerRef = ref(null);
// 容器距離文件頂部的偏移量（用於 Window Virtualizer 的 scrollMargin）
const scrollMargin = ref(0);
const { y: windowScrollY } = useWindowScroll();

// ===== 目錄分頁：無感載入（滾動到底自動載入下一頁）=====
const loadMoreSentinelRef = ref(null);
const hasUserScrolled = ref(false);
const lastAutoLoadAt = ref(0);
let loadMoreObserver = null;

const AUTO_LOAD_THROTTLE_MS = 800;

const cleanupLoadMoreObserver = () => {
  try {
    if (loadMoreObserver) {
      loadMoreObserver.disconnect();
      loadMoreObserver = null;
    }
  } catch {
    loadMoreObserver = null;
  }
};

const tryAutoLoadMore = () => {
  // 只在“確實往下滑了”之後，才自動載入。
  // 這樣可以避免：剛進入目錄時因為列表太短、哨兵在視口裡，導致自動連刷很多頁。
  if (!hasUserScrolled.value) return;
  if (!props.hasMore || props.loadingMore || props.loading) return;

  const now = Date.now();
  if (now - lastAutoLoadAt.value < AUTO_LOAD_THROTTLE_MS) return;
  lastAutoLoadAt.value = now;
  emit("load-more");
};

const setupLoadMoreObserver = async () => {
  cleanupLoadMoreObserver();

  // 沒有更多頁就不用觀察
  if (!props.hasMore) return;

  // SSR / 不支援 IntersectionObserver：直接退化為按鈕點選
  if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return;

  await nextTick();
  const el = loadMoreSentinelRef.value;
  if (!el) return;

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries?.some?.((e) => e && e.isIntersecting);
      if (hit) tryAutoLoadMore();
    },
    {
      root: null, // window 級別滾動
      // 提前一點點觸發（離底部還有 200px 就開始拉下一頁），體驗更順滑
      rootMargin: "200px 0px 200px 0px",
      threshold: 0,
    },
  );
  loadMoreObserver.observe(el);
};

// 是否啟用虛擬滾動（檔案數量超過閾值時啟用）
const shouldVirtualize = computed(() => {
  return sortedItems.value && sortedItems.value.length > VIRTUAL_SCROLL_THRESHOLD;
});

// 更新 scrollMargin（容器距離文件頂部的絕對偏移量）
// 使用 getBoundingClientRect + scrollY 獲取準確的文件偏移
const updateScrollMargin = () => {
  if (listContainerRef.value) {
    const rect = listContainerRef.value.getBoundingClientRect();
    // 計算元素相對於文件頂部的絕對位置
    scrollMargin.value = rect.top + windowScrollY.value;
  }
};

// 虛擬滾動器 - 使用 useWindowVirtualizer（視窗級別滾動）
// 這樣虛擬滾動會使用整個視窗作為滾動容器，不會建立獨立的滾動區域
const rowVirtualizer = useWindowVirtualizer(
  computed(() => ({
    count: sortedItems.value?.length || 0,
    estimateSize: () => FILE_ITEM_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin: scrollMargin.value,
  }))
);

// 虛擬專案列表
const virtualItems = computed(() => {
  if (!shouldVirtualize.value) return [];
  return rowVirtualizer.value.getVirtualItems();
});

// 虛擬滾動總高度
const totalVirtualSize = computed(() => {
  if (!shouldVirtualize.value) return 0;
  return rowVirtualizer.value.getTotalSize();
});

// 監聽容器位置變化，更新 scrollMargin
onMounted(() => {
  // 初始化時更新 scrollMargin
  nextTick(() => {
    updateScrollMargin();
  });
  // 監聽視窗 resize/scroll（VueUse 自動管理監聽器與清理）
  useEventListener(window, 'resize', updateScrollMargin);
  useEventListener(window, 'scroll', updateScrollMargin, { once: true });

  // 記錄“使用者確實滾動過”，用於避免進入目錄時自動瘋狂拉頁
  useEventListener(
    window,
    "scroll",
    () => {
      hasUserScrolled.value = true;
    },
    { passive: true, once: true },
  );

  // 初始化目錄分頁的觀察器
  setupLoadMoreObserver();
});

onUnmounted(() => {
  cleanupLoadMoreObserver();
});

// 目錄分頁狀態變化時，重新掛載/解除安裝觀察器
watch(
  () => props.hasMore,
  () => {
    setupLoadMoreObserver();
  },
);

watch(
  () => props.items?.length,
  () => {
    // items 變多後，哨兵的位置變化，保險起見重建一次 observer
    setupLoadMoreObserver();
  },
);

// 切目錄時重置自動載入狀態，避免“從上一個目錄的滾動狀態”串到新目錄導致誤觸發連拉
watch(
  () => props.currentPath,
  () => {
    hasUserScrolled.value = false;
    lastAutoLoadAt.value = 0;
    setupLoadMoreObserver();
  },
);


// 計算表頭網格佈局類 - 根據勾選框顯示和操作按鈕顯示狀態動態調整
const headerGridClass = computed(() => {
  const hasCheckbox = props.showCheckboxes;
  const hasActions = props.showActionButtons;
  
  if (hasCheckbox && hasActions) {
    // 顯示勾選框 + 操作列
    return 'grid-cols-[auto_var(--explorer-icon-size,20px)_1fr_auto] sm:grid-cols-[auto_var(--explorer-icon-size,20px)_1fr_6rem_9rem_auto]';
  } else if (hasCheckbox && !hasActions) {
    // 顯示勾選框 + 無操作列
    return 'grid-cols-[auto_var(--explorer-icon-size,20px)_1fr] sm:grid-cols-[auto_var(--explorer-icon-size,20px)_1fr_6rem_9rem]';
  } else if (!hasCheckbox && hasActions) {
    // 不顯示勾選框 + 操作列
    return 'grid-cols-[var(--explorer-icon-size,20px)_1fr_auto] sm:grid-cols-[var(--explorer-icon-size,20px)_1fr_6rem_9rem_auto]';
  } else {
    // 不顯示勾選框 + 無操作列
    return 'grid-cols-[var(--explorer-icon-size,20px)_1fr] sm:grid-cols-[var(--explorer-icon-size,20px)_1fr_6rem_9rem]';
  }
});

// 匯入統一的工具函式
import { formatFileSize } from "@/utils/fileUtils.js";

// 格式化大小：未知則顯示 "-"
const formatSize = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-";
  return formatFileSize(value);
};

// 判斷一個專案是否被選中
const isItemSelected = (item) => {
  return props.selectedItems.some((selectedItem) => selectedItem.path === item.path);
};

// 判斷一個專案是否是右鍵選單高亮狀態
const isContextHighlight = (item) => {
  return props.contextHighlightPath === item.path;
};

// 判斷是否全部選中
const isAllSelected = computed(() => {
  return props.items.length > 0 && props.items.every((item) => isItemSelected(item));
});

// 切換單個專案的選中狀態
const toggleItemSelect = (item) => {
  emit("item-select", item, !isItemSelected(item));
};

// 全選/取消全選
const toggleSelectAll = (select) => {
  emit("toggle-select-all", select);
};

// 處理檔案/資料夾點選
// 無論是否顯示勾選框，點選檔案/資料夾都應該正常導航或預覽
// 只有點選勾選框本身才切換選中狀態
const handleItemClick = (item) => {
  if (item.isDirectory) {
    // 對於目錄，導航進入
    emit("navigate", item.path);
  } else {
    // 對於檔案，觸發預覽
    emit("preview", item);
  }
};

// 處理下載
const handleDownload = (item) => {
  emit("download", item);
};

// 重新命名相關
const showRenameDialog = ref(false);
const itemToRename = ref(null);
const newName = ref("");
const renameInput = ref(null);

// 處理重新命名
const handleRename = (item) => {
  itemToRename.value = item;
  newName.value = item.name;
  showRenameDialog.value = true;

  // 在下一個DOM更新週期聚焦輸入框
  nextTick(() => {
    renameInput.value?.focus();
  });
};

// 處理重新命名確認 - 不立即關閉對話方塊，等待父元件完成操作後關閉
const handleRenameConfirm = (fileName) => {
  if (itemToRename.value) {
    emit("rename", {
      item: itemToRename.value,
      newName: fileName,
    });
    // 注意：不在這裡關閉對話方塊，由父元件透過 closeRenameDialog 事件控制
  }
};

// 處理重新命名取消
const handleRenameCancel = () => {
  showRenameDialog.value = false;
  newName.value = "";
  itemToRename.value = null;
};

// 處理對話方塊關閉（僅在非 loading 狀態下允許關閉）
const handleRenameDialogClose = () => {
  if (!props.renameLoading) {
    showRenameDialog.value = false;
    newName.value = "";
    itemToRename.value = null;
  }
};

// 關閉重新命名對話方塊（供父元件呼叫）
const closeRenameDialog = () => {
  showRenameDialog.value = false;
  newName.value = "";
  itemToRename.value = null;
};

// 暴露方法給父元件
defineExpose({
  closeRenameDialog,
});

// 處理刪除
const handleDelete = (item) => {
  emit("delete", item);
};

// 處理專案選擇
const handleItemSelect = (item, selected) => {
  emit("item-select", item, selected);
};

// 處理檔案直鏈獲取（使用新的 composable）
const handleGetLink = async (item) => {
  const result = await getFileLink(item);

  emit("show-message", {
    type: result.success ? "success" : "error",
    message: result.message,
  });
};

// 處理訊息顯示
const handleShowMessage = (messageInfo) => {
  emit("show-message", messageInfo);
};

// 處理右鍵選單事件
const handleContextMenu = (payload) => {
  emit("contextmenu", payload);
};

// 元件掛載時初始化排序狀態
onMounted(() => {
  initializeSortState();
});
</script>


<style scoped>
/* ===== 虛擬滾動樣式（Window Virtualizer 模式）===== */
.virtual-scroll-wrapper {
  /* 虛擬滾動內容容器，使用相對定位 */
  position: relative;
  width: 100%;
  /* 啟用 GPU 加速 */
  will-change: contents;
  /* 最佳化渲染效能 */
  contain: layout style;
}

/* 網格檢視 - 使用 auto-fill + minmax 實現平滑響應式 */
.directory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--explorer-grid-min-width, 120px), 1fr));
  gap: var(--explorer-gap, 12px);
  transition: gap var(--duration-fast, 150ms);
}

/* 移動端最佳化 */
@media (max-width: 640px) {
  .directory-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 8px;
  }
}
</style>
