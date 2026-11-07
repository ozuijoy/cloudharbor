<!--
  圖廊檢視元件
  專門用於展示圖片檔案的瀑布流佈局
  基於@yeger/vue-masonry-wall實現專業的瀑布流效果
-->
<template>
  <div class="gallery-view">
    <!-- 現代化圖廊工具欄 -->
    <div ref="toolbarRef" class="gallery-toolbar mb-4" :class="darkMode ? 'bg-gray-800/80' : 'bg-white/90'">
      <!-- 主工具欄 -->
      <div class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex items-center justify-between">
          <!-- 左側：統計資訊 -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <!-- 圖廊圖示 -->
              <IconGallery :class="darkMode ? 'text-blue-400' : 'text-blue-600'" aria-hidden="true" />
              <span class="font-medium text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">
                {{ t("gallery.viewModeName") }}
              </span>
            </div>

            <!-- 分隔符 -->
            <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>

            <!-- 統計資訊 -->
            <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
              {{ getContentSummary() }}
            </span>
          </div>

          <!-- 右側：快速操作 -->
          <div class="flex items-center gap-2">
            <!-- 排序按鈕 -->
            <div class="relative">
              <button
                @click="toggleSortMenu"
                class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
              >
                <IconSortAscending size="sm" aria-hidden="true" />
                <span class="hidden sm:inline">{{ t("gallery.sort") }}</span>
                <IconChevronDown size="xs" aria-hidden="true" />
              </button>

              <!-- 排序選單 -->
              <div
                v-if="showSortMenu"
                class="absolute right-0 top-full mt-1 w-48 rounded-md shadow-lg z-[9999]"
                :class="darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'"
              >
                <div class="py-1">
                  <button
                    v-for="option in sortOptions"
                    :key="option.value"
                    @click="handleSortChange(option.value)"
                    class="w-full text-left px-3 py-2 text-sm transition-colors"
                    :class="[
                      sortBy === option.value
                        ? darkMode
                          ? 'bg-gray-700 text-white'
                          : 'bg-gray-100 text-gray-900'
                        : darkMode
                        ? 'text-gray-300 hover:bg-gray-700'
                        : 'text-gray-700 hover:bg-gray-50',
                    ]"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 檢視設定按鈕 -->
            <button
              @click="toggleViewSettings"
              class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
            >
              <IconAdjustments size="sm" aria-hidden="true" />
              <span class="hidden sm:inline">{{ t("gallery.settings") }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 展開的檢視設定面板 -->
      <div v-if="showViewSettings" class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- 列數控制 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ t("gallery.columns") }}
            </label>
            <div class="flex items-center gap-2">
              <!-- 自動按鈕 -->
              <button
                @click="columnCount = 'auto'"
                class="px-3 py-1.5 text-xs rounded-md transition-colors"
                :class="[
                  columnCount === 'auto'
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
                ]"
              >
                {{ t("gallery.auto") }}
              </button>

              <!-- 列數按鈕組 -->
              <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                <button
                  v-for="cols in [2, 3, 4, 5, 6]"
                  :key="cols"
                  @click="columnCount = cols.toString()"
                  class="px-2 py-1.5 text-xs transition-colors"
                  :class="[
                    columnCount === cols.toString()
                      ? darkMode
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-200 text-gray-900'
                      : darkMode
                      ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      : 'bg-white text-gray-600 hover:bg-gray-50',
                  ]"
                >
                  {{ cols }}
                </button>
              </div>
            </div>
          </div>

          <!-- 間距控制 -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ t("gallery.spacing") }}
              </label>
              <button
                @click="resetGallerySettings"
                :disabled="isDefaultSettings"
                class="text-xs px-2 py-1 rounded transition-colors"
                :class="[
                  isDefaultSettings
                    ? darkMode
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-gray-400 cursor-not-allowed'
                    : darkMode
                    ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-700 hover:bg-gray-100',
                ]"
                :title="isDefaultSettings ? t('gallery.alreadyDefault') : t('gallery.resetSettings')"
              >
                {{ t("gallery.reset") }}
              </button>
            </div>

            <!-- 水平排列的間距控制 -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- 水平間距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                    {{ t("gallery.horizontalSpacing") }}
                  </label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ horizontalGap }}px </span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="horizontalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider horizontal-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>{{ t("gallery.tight") }}</span>
                    <span>{{ t("gallery.loose") }}</span>
                  </div>
                </div>
              </div>

              <!-- 垂直間距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                    {{ t("gallery.verticalSpacing") }}
                  </label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ verticalGap }}px </span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="verticalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider vertical-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>{{ t("gallery.tight") }}</span>
                    <span>{{ t("gallery.loose") }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 瀑布流容器 + 漸進渲染哨兵 -->
    <template v-if="allImages.length > 0">
      <MasonryWall
        :items="masonryItems"
        :column-width="columnWidth"
        :gap="baseGap"
        :min-columns="minColumns"
        :max-columns="maxColumns"
        :ssr-columns="1"
        :key-mapper="(item, column, row, index) => item.id || index"
        class="masonry-wall-gallery"
      >
        <template #default="{ item }">
          <div
            class="masonry-item"
            @click="handleItemClick(item.image)"
            @contextmenu.prevent="(event) => handleContextMenu(event, item.image)"
          >
            <div class="masonry-image-container">
              <!-- 選擇框 -->
              <div v-if="isCheckboxMode" class="absolute top-2 left-2 z-10" @click.stop="toggleItemSelect(item.image)">
                <input
                  type="checkbox"
                  :checked="isItemSelected(item.image)"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
                />
              </div>

              <!-- 圖片容器：始終渲染，懶載入 -->
              <div class="masonry-image-wrapper">
                <!-- Live Photo 標誌（僅展示，不觸發播放；播放在燈箱/預覽區處理）-->
                <div v-if="isLivePhotoInGallery(item.image)" class="pointer-events-none" :class="{ 'live-photo-viewer--dark': darkMode }">
                  <div class="live-photo-viewer__badge live-photo-viewer__badge--static" :title="t('livePhoto.badge')">
                    <span v-html="livePhotoBadgeIconSvg" />
                  </div>
                </div>

                <!-- 真實圖片：只有URL時才顯示 -->
                <img
                  v-if="getImageSrc(item.image)"
                  :src="getImageSrc(item.image)"
                  :alt="item.image.name"
                  class="masonry-image"
                  decoding="async"
                  @load="(event) => handleImageLoad(item.image, event)"
                  @error="handleImageError(item.image)"
                />

                <!-- 錯誤佔點陣圖：圖片載入失敗時顯示 -->
                <div v-else-if="getImageState(item.image)?.status === 'error'" class="masonry-placeholder bg-red-100 dark:bg-red-900/20" :style="getPlaceholderStyle()">
                  <div class="placeholder-content">
                    <div class="w-8 h-8 mx-auto mb-2 opacity-50">
                      <IconExclamation class="w-full h-full text-red-500" aria-hidden="true" />
                    </div>
                    <span class="text-xs opacity-75 text-red-600 dark:text-red-400"> {{ t("gallery.loadError") }} </span>
                  </div>
                </div>

                <!-- 懶載入佔點陣圖：用於IntersectionObserver觀察 -->
                <div v-else class="masonry-placeholder lazy-image bg-gray-200 dark:bg-gray-700 animate-pulse" :data-image-path="item.image.path" :style="getPlaceholderStyle()">
                  <div class="placeholder-content">
                    <div class="w-8 h-8 mx-auto mb-2 opacity-50">
                      <div v-html="getFileIcon(item.image, darkMode)" class="w-full h-full"></div>
                    </div>
                    <span class="text-xs opacity-75" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ t("gallery.loading") }} </span>
                  </div>
                </div>
              </div>

              <!-- 懸浮操作層 - 現在使用上下文選單 -->
              <div class="masonry-overlay">
                <!-- 圖片資訊（保留原有的懸浮資訊） -->
                <div class="masonry-info">
                  <div class="text-sm font-medium truncate">{{ item.image.name }}</div>
                  <div class="text-xs opacity-75 mt-1">{{ formatFileSize(item.image.size) }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </MasonryWall>

      <!-- 漸進渲染哨兵：進入視口時擴充套件渲染視窗 -->
      <div v-if="hasMoreImages" ref="loadMoreSentinelRef" class="h-1"></div>
    </template>

    <!-- 空狀態提示 -->
    <div v-else class="text-center py-16">
      <div class="max-w-md mx-auto">
        <!-- 圖片圖示 -->
        <div class="w-24 h-24 mx-auto mb-6 opacity-30">
          <IconGallery class="w-full h-full" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
        </div>

        <!-- 主要訊息 -->
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          {{ t("gallery.noImagesTitle") }}
        </h3>

        <!-- 詳細說明 -->
        <p class="text-sm mb-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("gallery.noImagesDescription") }}
        </p>

        <!-- 統計資訊 -->
        <div class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          <span v-if="allFolders.length > 0">{{ allFolders.length }} {{ t("gallery.foldersCount") }}</span>
          <span v-if="allFolders.length > 0 && allOtherFiles.length > 0"> • </span>
          <span v-if="allOtherFiles.length > 0">{{ allOtherFiles.length }} {{ t("gallery.otherFilesCount") }}</span>
          <span v-if="allFolders.length === 0 && allOtherFiles.length === 0">{{ t("gallery.emptyFolder") }}</span>
        </div>
      </div>
    </div>

    <!-- 懶載入模式下不需要載入更多按鈕 -->
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { onClickOutside, useIntersectionObserver } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useGalleryView } from "@/composables/ui-interaction/useGalleryView";
import { useContextMenu } from "@/composables/useContextMenu";
import { detectLivePhoto } from "@/utils/livePhotoUtils.js";
import { IconAdjustments, IconChevronDown, IconExclamation, IconGallery, IconSortAscending } from "@/components/icons";
import { getFileIcon } from "@/utils/fileTypeIcons";
import { formatFileSize } from "@/utils/fileUtils";
import MasonryWall from "@yeger/vue-masonry-wall";
import "@/components/common/LivePhoto/LivePhotoViewer.css";
import { LIVE_PHOTO_BADGE_ICON_SVG } from "@/components/common/LivePhoto/livePhotoBadgeIconSvg.js";
import { useFsMediaLightbox } from "@/modules/fs/composables/useFsMediaLightbox";

const { t } = useI18n();
const livePhotoBadgeIconSvg = LIVE_PHOTO_BADGE_ICON_SVG;

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  isCheckboxMode: {
    type: Boolean,
    default: false,
  },
  selectedItems: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["item-click", "item-select", "download", "getLink", "rename", "delete", "contextmenu", "show-message"]);

// 使用圖廊檢視組合式函式
const {
  // 資料
  allFolders,
  allImages,
  allOtherFiles,
  masonryItems,
  hasMoreImages,
  loadMoreImages,

  // 設定狀態
  columnCount,
  horizontalGap,
  verticalGap,
  sortBy,
  showSortMenu,
  showViewSettings,

  // MasonryWall配置
  baseGap,
  columnWidth,
  minColumns,
  maxColumns,

  // 工具欄配置
  sortOptions,

  // 圖片狀態/載入
  imageStates,
  loadImageUrl,

  // 設定管理
  isDefaultSettings,
  resetGallerySettings,

  // 工具欄互動
  toggleSortMenu,
  toggleViewSettings,
  handleSortChange,

  // 初始化方法
  setupWatchers,
  clearImageStates,
  resetRenderWindow,
} = useGalleryView({ items: computed(() => props.items) });

const fsLightbox = useFsMediaLightbox();
const toolbarRef = ref(null);

// 點選外部關閉選單（VueUse 自動管理監聽器與清理）
onClickOutside(toolbarRef, () => {
  if (!showSortMenu.value && !showViewSettings.value) return;
  showSortMenu.value = false;
  showViewSettings.value = false;
});

// ===== 操作選單相關方法 =====

// 處理下載操作
const handleDownload = (item) => {
  emit("download", item);
};

// 處理獲取連結操作
const handleGetLink = (item) => {
  emit("getLink", item);
};

// 處理重新命名操作
const handleRename = (item) => {
  emit("rename", item);
};

// 處理刪除操作
const handleDelete = (items) => {
  emit("delete", items);
};

// 處理複製操作 - 透過 contextmenu 事件傳遞
const handleCopy = (items) => {
  // 傳遞給父元件處理
  emit("contextmenu", { 
    event: null, 
    item: Array.isArray(items) ? items[0] : items,
    items: Array.isArray(items) ? items : [items],
    action: 'copy'
  });
};

// 處理新增到檔案籃操作 - 透過 contextmenu 事件傳遞
const handleAddToBasket = (items) => {
  // 傳遞給父元件處理
  emit("contextmenu", { 
    event: null, 
    item: Array.isArray(items) ? items[0] : items,
    items: Array.isArray(items) ? items : [items],
    action: 'add-to-basket'
  });
};

// 處理切換勾選框顯示 - 透過 contextmenu 事件傳遞
const handleToggleCheckboxes = () => {
  emit("contextmenu", { 
    event: null, 
    item: null,
    items: [],
    action: 'toggle-checkboxes'
  });
};

// 初始化右鍵選單（必須在操作函式定義之後）
const contextMenu = useContextMenu({
  onDownload: handleDownload,
  onGetLink: handleGetLink,
  onRename: handleRename,
  onDelete: handleDelete,
  onCopy: handleCopy,
  onAddToBasket: handleAddToBasket,
  onToggleCheckboxes: handleToggleCheckboxes,
  t,
});

// 內容摘要 - 只顯示圖片統計
const getContentSummary = () => {
  const imageCount = allImages.value.length;

  if (imageCount === 0) {
    return t("gallery.noImages");
  }

  return `${imageCount} ${t("gallery.imagesCount")}`;
};

// 懶載入：只返回狀態，不觸發載入
const getImageSrc = (image) => {
  const imageState = imageStates.value.get(image.path);

  // 如果狀態為loaded，返回URL
  if (imageState?.status === "loaded" && imageState.url) {
    return imageState.url;
  }

  // 不在這裡觸發載入，由IntersectionObserver負責
  return "";
};

// 獲取圖片狀態
const getImageState = (image) => {
  return imageStates.value.get(image.path);
};

// ===== Live Photo（圖廊僅標識，不播放）=====

const livePhotoInfoByPath = computed(() => {
  const map = new Map();
  for (const img of allImages.value) {
    if (!img?.path) continue;
    const result = detectLivePhoto(img, props.items);
    map.set(img.path, {
      isLive: !!result?.isLivePhoto,
      videoPath: result?.videoFile?.path || "",
    });
  }
  return map;
});

const isLivePhotoInGallery = (image) => {
  if (!image?.path) return false;
  return !!livePhotoInfoByPath.value.get(image.path)?.isLive;
};

const handleImageLoad = (image, event) => {
  const img = event.target;
  const aspectRatio = img.naturalWidth / img.naturalHeight;

  // 更新圖片狀態，新增尺寸資訊
  const currentState = imageStates.value.get(image.path);
  if (currentState) {
    imageStates.value.set(image.path, {
      ...currentState,
      aspectRatio,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }
};

// 圖片載入失敗：優先做一次“重新拉取 URL”（常見於預簽名 URL 過期）
const errorRetries = new Map(); // key: image.path => number
let galleryAbortController = null;

const handleImageError = (image) => {
  const current = errorRetries.get(image.path) || 0;
  if (current < 1) {
    errorRetries.set(image.path, current + 1);
    imageStates.value.set(image.path, { status: "idle", url: null });
    void loadImageUrl(image, { priority: "high", signal: galleryAbortController?.signal });
    return;
  }
  imageStates.value.set(image.path, { status: "error", url: null });
};

const getPlaceholderStyle = () => {
  // 瀑布流佔位符樣式
  return {
    width: "100%",
    height: "200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
};

// 當前目錄的圖片索引
const imagesByPath = computed(() => {
  return new Map(allImages.value.map((img) => [img.path, img]));
});

// 燈箱資料來源
const lightboxItems = computed(() => {
  const infoMap = livePhotoInfoByPath.value;
  return allImages.value.map((img) => {
    const info = infoMap.get(img.path);
    if (info?.isLive && info.videoPath) {
      return {
        ...img,
        __cloudharborLivePhotoVideoPath: info.videoPath,
      };
    }
    return img;
  });
});

// 上下文選單處理 - 使用統一的 useContextMenu
const handleContextMenu = (event, image) => {
  // 獲取當前已選中的專案
  const selectedFiles = props.selectedItems || [];
  const isImageSelected = selectedFiles.some((i) => i.path === image.path);

  let itemsForMenu;

  if (selectedFiles.length > 0) {
    // 有選中項時：
    // - 如果右鍵的專案已在選中列表中，操作所有選中專案
    // - 如果右鍵的專案不在選中列表中，只操作當前專案
    if (isImageSelected) {
      itemsForMenu = selectedFiles;
    } else {
      itemsForMenu = [image];
    }
  } else {
    // 無選中項：只操作當前右鍵的專案
    itemsForMenu = [image];
  }

  // 顯示右鍵選單（傳遞當前勾選框顯示狀態）
  contextMenu.showContextMenu(event, image, itemsForMenu, props.darkMode, props.isCheckboxMode);
};

// 懶載入：IntersectionObserver（VueUse）
const lazyImageTargets = ref([]);
const { stop: stopLazyImageObserver } = useIntersectionObserver(
  lazyImageTargets,
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const placeholder = /** @type {HTMLElement} */ (entry.target);
      const imagePath = placeholder?.dataset?.imagePath;
      if (!imagePath) return;

      // 查詢對應的圖片物件
      const image = imagesByPath.value.get(imagePath);
      if (!image) return;

      // 根據可見比例確定優先順序
      const priority = entry.intersectionRatio > 0.5 ? "high" : "normal";
      void loadImageUrl(image, { priority, signal: galleryAbortController?.signal });

      // 停止觀察這個佔位符，避免重複觸發
      try {
        observer?.unobserve?.(placeholder);
      } catch {
        // ignore
      }
    });
  },
  {
    rootMargin: "200px",
    threshold: [0.1, 0.5],
  }
);

// 定時器管理
const timers = new Set();

// 安全的定時器函式
const safeSetTimeout = (callback, delay) => {
  const id = setTimeout(() => {
    timers.delete(id);
    callback();
  }, delay);
  timers.add(id);
  return id;
};

// 初始化/重置懶載入觀察目標（Observer 例項由 VueUse 管理）
const initImageLazyLoading = () => {
  lazyImageTargets.value = [];
};

// 觀察所有懶載入佔位符（帶重試機制）
const observeLazyImages = (retryCount = 0) => {
  // 查詢所有懶載入佔位符
  const lazyPlaceholders = document.querySelectorAll(".lazy-image");

  if (lazyPlaceholders.length === 0 && retryCount < 2) {
    safeSetTimeout(() => {
      observeLazyImages(retryCount + 1);
    }, 200 * (retryCount + 1));
    return;
  }

  if (lazyPlaceholders.length === 0) {
    return;
  }

  /** @type {HTMLElement[]} */
  const targets = [];
  lazyPlaceholders.forEach((placeholder) => {
    // 只觀察還沒有URL的圖片
    const imagePath = placeholder.dataset.imagePath;
    const imageState = imageStates.value.get(imagePath);
    if (imageState?.status === "idle") {
      targets.push(/** @type {HTMLElement} */ (placeholder));
    }
  });

  lazyImageTargets.value = targets;
};

// 事件處理 - 整合 PhotoSwipe 預覽
const handleItemClick = async (item) => {
  // 勾選模式：不觸發預覽
  if (props.isCheckboxMode) {
    toggleItemSelect(item);
    return;
  }

  const currentIndex = lightboxItems.value.findIndex((img) => img.path === item.path);
  if (currentIndex === -1) {
    emit("item-click", item);
    return;
  }

  fsLightbox.open({
    items: lightboxItems.value,
    index: currentIndex,
    darkMode: props.darkMode,
    imageStates: imageStates.value,
    loadImageUrl,
    onDownload: (current) => emit("download", current),
    onGetLink: (current) => emit("getLink", current),
  });
};

const toggleItemSelect = (item) => {
  emit("item-select", item, !isItemSelected(item));
};

const isItemSelected = (item) => {
  return props.selectedItems.some((selected) => selected.path === item.path);
};

// 更新CSS變數以控制垂直間距（水平間距由MasonryWall的gap屬性控制）
const updateSpacingCSSVariables = () => {
  const galleryElement = document.querySelector(".masonry-wall-gallery");
  if (galleryElement) {
    galleryElement.style.setProperty("--vertical-gap", `${verticalGap.value}px`);
  }
};

// 監聽垂直間距變化
watch(
  verticalGap,
  () => {
    updateSpacingCSSVariables();
  },
  { immediate: true }
);

// 監聽masonryItems變化，重新觀察新的懶載入圖片
watch(
  masonryItems,
  () => {
    // 延遲觀察，等待MasonryWall重新渲染完成
    safeSetTimeout(() => {
      observeLazyImages();
    }, 100);
  },
  { flush: "post" }
);

// 漸進渲染：觀察底部哨兵，按需擴充套件渲染視窗
const loadMoreSentinelRef = ref(null);
const { stop: stopLoadMoreObserver } = useIntersectionObserver(
  loadMoreSentinelRef,
  (entries) => {
    const entry = entries?.[0];
    if (!entry?.isIntersecting) return;
    if (!hasMoreImages.value) return;
    loadMoreImages();
    nextTick(() => observeLazyImages());
  },
  { rootMargin: "800px" }
);

// 生命週期
onMounted(() => {
  setupWatchers();
  galleryAbortController = new AbortController();

  nextTick(() => {
    updateSpacingCSSVariables();
    initImageLazyLoading();
  });

  safeSetTimeout(() => observeLazyImages(), 100);
});

// 目錄切換/重新整理：取消在途載入，避免舊目錄請求回寫到新目錄的狀態
watch(
  () => props.items,
  () => {
    errorRetries.clear();
    galleryAbortController?.abort();
    galleryAbortController = new AbortController();
    initImageLazyLoading();
    nextTick(() => {
      observeLazyImages();
    });
  }
);

onBeforeUnmount(() => {
  timers.forEach((id) => clearTimeout(id));
  timers.clear();

  stopLazyImageObserver?.();
  stopLoadMoreObserver?.();

  galleryAbortController?.abort();
  galleryAbortController = null;

  clearImageStates();
  resetRenderWindow();
});
</script>

<style scoped>
@import "@/styles/pages/mount-explorer/gallery.css";
</style>
