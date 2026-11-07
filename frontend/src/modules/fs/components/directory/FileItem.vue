<template>
  <div
    class="file-item group"
    :class="[
      isSelected ? 'file-item--selected' : '',
      isContextHighlight && !isSelected ? 'file-item--context-highlight' : '',
      isEntering && animationsEnabled ? 'file-item--entering' : '',
      darkMode ? 'file-item--dark' : 'file-item--light'
    ]"
    :style="{ '--enter-delay': `${enterDelay}ms` }"
    @click="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 勾選框 (根據全域性設定顯示) -->
    <div v-if="showCheckboxes" class="file-item__checkbox" @click.stop="toggleSelect">
      <input
        type="checkbox"
        :checked="isSelected"
        class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
        :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
      />
    </div>

    <!-- 檔案/資料夾圖示 -->
    <div class="file-item__icon">
      <span v-html="fileIcon"></span>
    </div>

    <!-- 檔案/資料夾名稱 -->
    <div class="file-item__info" @click="handleClick">
      <div 
        class="file-item__name" 
        :class="[
          darkMode ? 'text-gray-200' : 'text-gray-700'
        ]"
        :title="fileNameOverflow === 'ellipsis' ? item.name : undefined"
      >
        <span
          class="file-item__name-text"
          :class="`file-item__name--${fileNameOverflow}`"
          :data-name="item.name"
        >
          {{ item.name }}
        </span>
        <span
          v-if="storageBackendBadge"
          class="file-item__backend-badge"
          :class="storageBackendBadgeClass"
          :title="storageBackendBadgeTitle"
        >
          {{ storageBackendBadge }}
        </span>
      </div>
      <!-- 移動端檔案大小顯示 -->
      <div class="file-item__size-mobile" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <span v-if="item.isDirectory && item.isVirtual">-</span>
        <span v-else :title="sizeTitle">
          {{ formatSize(item.size) }}
          <span v-if="sizeMarker" class="file-item__meta-marker">{{ sizeMarker }}</span>
        </span>
      </div>
    </div>

    <!-- 檔案大小（桌面端） -->
    <div class="file-item__size" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <span v-if="item.isDirectory && item.isVirtual">-</span>
      <span v-else :title="sizeTitle">
        {{ formatSize(item.size) }}
        <span v-if="sizeMarker" class="file-item__meta-marker">{{ sizeMarker }}</span>
      </span>
    </div>

    <!-- 修改時間（桌面端） -->
    <div class="file-item__time" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <span v-if="item.isDirectory && item.isVirtual">-</span>
      <span v-else :title="modifiedTitle">
        {{ formatDate(item.modified) }}
        <span v-if="modifiedMarker" class="file-item__meta-marker">{{ modifiedMarker }}</span>
      </span>
    </div>

    <!-- 操作按鈕 (根據設定顯示/隱藏) -->
    <div v-if="showActionButtons" class="file-item__actions">
      <div class="file-item__actions-inner">
        <!-- 下載按鈕（只對檔案顯示）-->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('download', item)"
          class="file-item__action-btn w-8 h-8 rounded-full flex items-center justify-center transition-all bg-transparent text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transform hover:scale-110"
          :title="t('mount.fileItem.download')"
        >
          <IconDownload class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 直鏈按鈕（只對檔案顯示）-->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('getLink', item)"
          class="file-item__action-btn w-8 h-8 rounded-full flex items-center justify-center transition-all bg-transparent text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transform hover:scale-110"
          :title="t('mount.fileItem.getLink')"
        >
          <IconLink class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 重新命名按鈕 -->
        <button
          v-if="!item.isDirectory"
          @click.stop="$emit('rename', item)"
          class="file-item__action-btn w-8 h-8 rounded-full flex items-center justify-center transition-all bg-transparent text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transform hover:scale-110"
          :title="t('mount.fileItem.rename')"
        >
          <IconRename class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>

        <!-- 刪除按鈕 -->
        <button
          @click.stop="$emit('delete', item)"
          class="file-item__action-btn w-8 h-8 rounded-full flex items-center justify-center transition-all bg-transparent text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transform hover:scale-110"
          :title="t('mount.fileItem.delete')"
        >
          <IconDelete class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { IconDelete, IconDownload, IconLink, IconRename } from "@/components/icons";
import { formatFileSize } from "@/utils/fileUtils.js";
import { getFileIcon as getFileIconSvg } from "@/utils/fileTypeIcons.js";
import { formatDateTime } from "@/utils/timeUtils.js";

const { t } = useI18n();

const props = defineProps({
  item: { type: Object, required: true },
  darkMode: { type: Boolean, default: false },
  showCheckboxes: { type: Boolean, default: false },
  isSelected: { type: Boolean, default: false },
  // 右鍵選單高亮狀態（臨時高亮，不是勾選選中）
  isContextHighlight: { type: Boolean, default: false },
  currentPath: { type: String, required: true },
  index: { type: Number, default: 0 },
  animationsEnabled: { type: Boolean, default: true },
  // 檔名過長處理模式: ellipsis(省略號) | scroll(滾動) | wrap(換行)
  fileNameOverflow: { type: String, default: 'ellipsis' },
  // 是否顯示操作按鈕列
  showActionButtons: { type: Boolean, default: true },
});

const emit = defineEmits(["click", "download", "rename", "delete", "select", "getLink", "contextmenu"]);

// 快取檔案圖示 SVG，避免每次渲染重複計算
const fileIcon = computed(() => getFileIconSvg(props.item, props.darkMode));

// 入場動畫狀態
const isEntering = ref(true);
const enterDelay = computed(() => Math.min(props.index * 30, 300));

// 元件掛載後移除入場動畫狀態
onMounted(() => {
  if (props.animationsEnabled) {
    setTimeout(() => {
      isEntering.value = false;
    }, 300 + enterDelay.value);
  } else {
    isEntering.value = false;
  }
});

// 處理點選事件
const handleClick = () => {
  emit("click", props.item);
};

// 新增選擇功能
const toggleSelect = () => {
  emit("select", props.item, !props.isSelected);
};

// 處理右鍵選單
const handleContextMenu = (event) => {
  emit("contextmenu", { event, item: props.item });
};

const isValidSize = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return "-";
  return formatDateTime(dateString);
};

// 格式化大小：未知則顯示 "-"
const formatSize = (value) => {
  if (!isValidSize(value)) return "-";
  return formatFileSize(value);
};

const sizeMarker = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return "";
  if (!isValidSize(props.item?.size)) return "";
  if (props.item?.size_source === "index") return "≈";
  if (props.item?.size_source === "compute") return "*";
  return "";
});

const sizeTitle = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return undefined;
  if (!isValidSize(props.item?.size)) return undefined;
  if (props.item?.size_source === "index") return "索引計算（無法實時）";
  if (props.item?.size_source === "compute") return "遞迴計算（效能損耗）";
  return undefined;
});

const modifiedMarker = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return "";
  if (!props.item?.modified) return "";
  if (props.item?.modified_source === "index") return "≈";
  if (props.item?.modified_source === "compute") return "*";
  return "";
});

const modifiedTitle = computed(() => {
  if (!props.item?.isDirectory || props.item?.isVirtual) return undefined;
  if (!props.item?.modified) return undefined;
  if (props.item?.modified_source === "index") return "時間來自索引兜底（不一定實時）";
  if (props.item?.modified_source === "compute") return "時間來自遞迴計算（可能較慢）";
  return undefined;
});

// HuggingFace / 儲存後端提示（小徽章）
const storageBackendBadge = computed(() => {
  if (props.item?.isDirectory) return "";
  const backend = String(props.item?.storage_backend || "").toLowerCase();
  if (backend === "xet") return "Xet";
  if (backend === "lfs") return "LFS";
  return "";
});

const storageBackendBadgeClass = computed(() => {
  const backend = String(props.item?.storage_backend || "").toLowerCase();
  if (backend === "xet") return "file-item__backend-badge--xet";
  if (backend === "lfs") return "file-item__backend-badge--lfs";
  return "";
});

const storageBackendBadgeTitle = computed(() => {
  const backend = String(props.item?.storage_backend || "").toLowerCase();
  if (backend === "xet") return "HF Xet 儲存";
  if (backend === "lfs") return "Git LFS 指標檔案";
  return undefined;
});
</script>

<style scoped>
/* 基礎樣式 - 使用 CSS 變數 */
.file-item {
  display: grid;
  align-items: center;
  height: var(--explorer-item-height, 48px);
  padding: 0 var(--explorer-padding, 12px);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all var(--duration-fast, 150ms) var(--easing-default, cubic-bezier(0.4, 0, 0.2, 1));
  /* 使用 CSS 變數控制檔案間距 */
  margin: var(--explorer-item-spacing, 2px) 4px;
}

/* 網格佈局 - 預設無操作列 */
.file-item {
  grid-template-columns: var(--explorer-icon-size, 20px) 1fr;
  gap: var(--explorer-gap, 12px);
}

@media (min-width: 640px) {
  .file-item {
    grid-template-columns: var(--explorer-icon-size, 20px) 1fr 6rem 9rem;
  }
}

/* 有操作列時的網格佈局 */
.file-item:has(.file-item__actions) {
  grid-template-columns: var(--explorer-icon-size, 20px) 1fr auto;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__actions) {
    grid-template-columns: var(--explorer-icon-size, 20px) 1fr 6rem 9rem auto;
  }
}

/* 顯示勾選框時的網格佈局 - 無操作列 */
.file-item:has(.file-item__checkbox):not(:has(.file-item__actions)) {
  grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__checkbox):not(:has(.file-item__actions)) {
    grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr 6rem 9rem;
  }
}

/* 顯示勾選框時的網格佈局 - 有操作列 */
.file-item:has(.file-item__checkbox):has(.file-item__actions) {
  grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr auto;
}

@media (min-width: 640px) {
  .file-item:has(.file-item__checkbox):has(.file-item__actions) {
    grid-template-columns: auto var(--explorer-icon-size, 20px) 1fr 6rem 9rem auto;
  }
}

.file-item__meta-marker {
  margin-left: 4px;
  font-size: 0.75em;
  opacity: 0.7;
}

/* 亮色模式 hover */
.file-item--light:hover {
  background: var(--explorer-hover, rgba(0, 0, 0, 0.04));
  transform: scale(1.005);
}

/* 暗色模式 hover */
.file-item--dark:hover {
  background: var(--explorer-hover, rgba(255, 255, 255, 0.06));
  transform: scale(1.005);
}

/* 選中狀態 - 亮色（僅背景高亮，無左邊框） */
.file-item--light.file-item--selected {
  background: var(--explorer-selected, rgba(59, 130, 246, 0.12));
}

/* 選中狀態 - 暗色（僅背景高亮，無左邊框） */
.file-item--dark.file-item--selected {
  background: var(--explorer-selected, rgba(59, 130, 246, 0.25));
}

/* 右鍵選單高亮狀態 - 亮色（臨時高亮，不是勾選） */
.file-item--light.file-item--context-highlight {
  background: var(--explorer-hover, rgba(59, 130, 246, 0.08));
}

/* 右鍵選單高亮狀態 - 暗色 */
.file-item--dark.file-item--context-highlight {
  background: var(--explorer-hover, rgba(59, 130, 246, 0.15));
}

/* 入場動畫 */
.file-item--entering {
  animation: fadeInScale var(--explorer-animation-duration, 200ms) var(--easing-out, cubic-bezier(0, 0, 0.2, 1)) forwards;
  animation-delay: var(--enter-delay, 0ms);
  opacity: 0;
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 勾選框 - 增加內邊距擴大點選區域 */
.file-item__checkbox {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px;
  margin: -8px;
  cursor: pointer;
}

/* 圖示 */
.file-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--explorer-icon-size, 20px);
  height: var(--explorer-icon-size, 20px);
  flex-shrink: 0;
}

.file-item__icon :deep(svg) {
  width: 100%;
  height: 100%;
}

/* 檔案資訊 */
.file-item__info {
  min-width: 0;
  flex-grow: 1;
}

.file-item__name {
  font-size: var(--explorer-font-size, 14px);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.file-item__name-text {
  min-width: 0;
  flex: 1;
}

/* 檔名過長處理模式 - 省略號（預設） */
.file-item__name--ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 檔名過長處理模式 - 滾動 */
.file-item__name--scroll {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
}

.file-item__name--scroll:hover {
  overflow: visible;
}

.file-item__name--scroll:hover::after {
  content: attr(data-name);
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  animation: scrollText 5s linear infinite;
  background: inherit;
  z-index: 10;
}

@keyframes scrollText {
  0%, 10% { transform: translateX(0); }
  90%, 100% { transform: translateX(calc(-100% + 100px)); }
}

/* 檔名過長處理模式 - 換行 */
.file-item__name--wrap {
  white-space: normal;
  word-break: break-word;
  line-height: 1.3;
}

.file-item__backend-badge {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 9999px;
  border: 1px solid transparent;
  user-select: none;
}

.file-item__backend-badge--lfs {
  background: rgba(107, 114, 128, 0.12);
  color: rgb(75, 85, 99);
  border-color: rgba(107, 114, 128, 0.25);
}

.file-item--dark .file-item__backend-badge--lfs {
  background: rgba(156, 163, 175, 0.15);
  color: rgb(229, 231, 235);
  border-color: rgba(156, 163, 175, 0.25);
}

.file-item__backend-badge--xet {
  background: rgba(59, 130, 246, 0.12);
  color: rgb(29, 78, 216);
  border-color: rgba(59, 130, 246, 0.25);
}

.file-item--dark .file-item__backend-badge--xet {
  background: rgba(96, 165, 250, 0.15);
  color: rgb(191, 219, 254);
  border-color: rgba(96, 165, 250, 0.25);
}

/* 移動端檔案大小 */
.file-item__size-mobile {
  font-size: calc(var(--explorer-font-size, 14px) - 2px);
  margin-top: 2px;
}

@media (min-width: 640px) {
  .file-item__size-mobile {
    display: none;
  }
}

/* 桌面端檔案大小和時間 */
.file-item__size,
.file-item__time {
  display: none;
  font-size: calc(var(--explorer-font-size, 14px) - 1px);
  text-align: center;
  white-space: nowrap;
}

@media (min-width: 640px) {
  .file-item__size,
  .file-item__time {
    display: block;
  }
}

/* 操作按鈕容器 */
.file-item__actions {
  min-width: 80px;
}

@media (min-width: 640px) {
  .file-item__actions {
    min-width: 120px;
  }
}

.file-item__actions-inner {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  /* 移動端始終顯示 */
  opacity: 1;
  transition: opacity var(--duration-fast, 150ms);
}

/* 桌面端：始終顯示操作按鈕 */
@media (min-width: 640px) {
  .file-item__actions-inner {
    justify-content: center;
  }
}

/* 操作按鈕基礎樣式 - Ghost Style Inlined in Template */
.file-item__action-btn {
}

/* 禁用動畫時移除所有過渡 */
@media (prefers-reduced-motion: reduce) {
  .file-item,
  .file-item__actions-inner,
  .file-item__action-btn {
    transition: none;
  }
  
  .file-item--entering {
    animation: none;
    opacity: 1;
  }
}
</style>
