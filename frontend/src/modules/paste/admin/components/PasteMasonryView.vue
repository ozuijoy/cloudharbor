<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { onClickOutside } from "@vueuse/core";
import MasonryWall from "@yeger/vue-masonry-wall";
import PasteMasonryCard from "./PasteMasonryCard.vue";
import { usePasteMasonryView } from "../usePasteMasonryView";
import { IconAdjustments, IconArchive, IconGrid, IconRefresh } from "@/components/icons";

/**
 * Paste 瀑布流檢視元件
 */
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  pastes: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedPastes: {
    type: Array,
    required: true,
  },
  copiedTexts: {
    type: Object,
    default: () => ({}),
  },
  copiedRawTexts: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["toggle-select-all", "toggle-select-item", "view", "copy-link", "copy-raw-link", "preview", "edit", "delete", "show-qrcode", "quick-edit-content"]);

const toolbarRef = ref(null);

// 使用瀑布流檢視配置
const {
  // 設定狀態
  columnCount,
  horizontalGap,
  verticalGap,
  showViewSettings,

  // MasonryWall配置
  baseGap,
  columnWidth,
  minColumns,
  maxColumns,

  // 設定管理
  isDefaultSettings,
  resetMasonrySettings,

  // 工具欄互動
  toggleViewSettings,

  // 初始化和清理方法
  setupWatchers,
  cleanupWatchers,
} = usePasteMasonryView();

// 點選外部關閉選單（VueUse 自動管理監聽器與清理）
onClickOutside(toolbarRef, () => {
  if (!showViewSettings.value) return;
  showViewSettings.value = false;
});

// 更新CSS變數以控制垂直間距（水平間距由MasonryWall的gap屬性控制）
const updateSpacingCSSVariables = () => {
  const masonryElement = document.querySelector(".paste-masonry-wall");
  if (masonryElement) {
    masonryElement.style.setProperty("--vertical-gap", `${verticalGap.value}px`);
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

onMounted(() => {
  // 設定監聽器
  setupWatchers();

  // 初始化CSS變數
  nextTick(() => {
    updateSpacingCSSVariables();
  });
});

onUnmounted(() => {
  // 清理瀑布流檢視的監聽器
  cleanupWatchers();
});

/**
 * 處理卡片點選（開啟預覽模態框）
 * @param {Object} paste - 文字物件
 */
const handleCardClick = (paste) => {
  emit("preview", paste);
};
</script>

<template>
  <div class="paste-masonry-view">
    <!-- 瀑布流工具欄 -->
    <div ref="toolbarRef" class="paste-masonry-toolbar mb-4" :class="darkMode ? 'bg-gray-800/80' : 'bg-white/90'">
      <!-- 主工具欄 -->
      <div class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex items-center justify-between">
          <!-- 左側：統計資訊 -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <!-- 瀑布流圖示 -->
              <IconGrid class="w-5 h-5" :class="darkMode ? 'text-primary-400' : 'text-primary-600'" />
              <span class="font-medium text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">瀑布流檢視</span>
            </div>

            <!-- 分隔符 -->
            <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>

            <!-- 統計資訊 -->
            <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
              {{ pastes.length }} 條文字
            </span>
          </div>

          <!-- 右側：設定按鈕 -->
          <div class="flex items-center gap-2">
            <!-- 檢視設定按鈕 -->
            <button
              @click="toggleViewSettings"
              class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
            >
              <IconAdjustments class="w-4 h-4" />
              <span class="hidden sm:inline">檢視設定</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 展開的檢視設定面板 -->
      <div v-if="showViewSettings" class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- 列數控制 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">列數</label>
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
                自動
              </button>

              <!-- 列數按鈕組 -->
              <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                <button
                  v-for="cols in [1, 2, 3, 4]"
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
          <div class="space-y-3 sm:col-span-2">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">間距</label>
              <button
                @click="resetMasonrySettings"
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
                :title="isDefaultSettings ? '已是預設設定' : '重置為預設'"
              >
                重置
              </button>
            </div>

            <!-- 水平排列的間距控制 -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- 水平間距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">水平間距（列間距）</label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ horizontalGap }}px</span>
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
                    <span>緊湊</span>
                    <span>寬鬆</span>
                  </div>
                </div>
              </div>

              <!-- 垂直間距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">垂直間距（行間距）</label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ verticalGap }}px</span>
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
                    <span>緊湊</span>
                    <span>寬鬆</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 載入狀態 -->
    <div v-if="loading" class="flex justify-center items-center py-12" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
      <IconRefresh class="animate-spin h-8 w-8 text-primary-500 mr-3" />
      <span class="text-lg">載入中...</span>
    </div>

    <!-- 空資料狀態 -->
    <div v-else-if="pastes.length === 0" class="flex flex-col items-center justify-center py-16" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <IconArchive class="h-16 w-16 mb-4 opacity-50" />
      <p class="text-lg font-medium">暫無文字分享資料</p>
      <p class="text-sm mt-2">建立第一個文字分享來開始使用瀑布流檢視</p>
    </div>

    <!-- 瀑布流佈局 -->
    <MasonryWall
      v-else
      :items="pastes"
      :column-width="columnWidth"
      :gap="baseGap"
      :min-columns="minColumns"
      :max-columns="maxColumns"
      :ssr-columns="1"
      class="paste-masonry-wall"
    >
      <template #default="{ item }">
        <PasteMasonryCard
          :key="item.id"
          :dark-mode="darkMode"
          :paste="item"
          @click="handleCardClick(item)"
          @preview="emit('preview', item)"
          @edit="emit('edit', item)"
          @delete="emit('delete', item.id)"
          @copy-link="emit('copy-link', item.slug)"
          @copy-raw-link="emit('copy-raw-link', item.slug)"
          @show-qrcode="emit('show-qrcode', item.slug)"
          @quick-edit-content="emit('quick-edit-content', $event)"
        />
      </template>
    </MasonryWall>
  </div>
</template>

<style scoped>
/* 確保瀑布流容器寬度自適應 */
/* 上右下左：頂部和底部都留出呼吸空間 */
.paste-masonry-view {
  width: 100%;
  padding: 1.5rem 1rem 2rem 1rem;
}

/* 移動端最佳化 */
/* 移動端上下padding稍小 */
@media (max-width: 768px) {
  .paste-masonry-view {
    padding: 1rem 0.5rem 1.5rem 0.5rem;
  }
}

/* 瀑布流工具欄樣式 */
.paste-masonry-toolbar {
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
  position: relative;
  z-index: 10;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.dark .paste-masonry-toolbar {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.paste-masonry-toolbar:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.dark .paste-masonry-toolbar:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* 工具欄按鈕樣式 */
.paste-masonry-toolbar button {
  font-weight: 500;
  transition: background-color 0.2s ease, color 0.2s ease;
}

/* 瀑布流容器 - 支援垂直間距CSS變數 */
.paste-masonry-wall {
  width: 100%;
  margin: 0 auto;
  padding: 0;
}

/* 瀑布流卡片容器 - 使用CSS變數控制垂直間距 */
.paste-masonry-wall :deep(.paste-masonry-card) {
  /* 只控制垂直間距，水平間距由MasonryWall的gap屬性控制 */
  margin-bottom: var(--vertical-gap, 16px);
}

/* 間距滑塊樣式 */
.spacing-slider {
  background: linear-gradient(to right, #e5e7eb 0%, #e5e7eb 100%);
  transition: all 0.2s ease;
}

.dark .spacing-slider {
  background: linear-gradient(to right, #374151 0%, #374151 100%);
}

.spacing-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.horizontal-slider::-webkit-slider-thumb {
  background: #10b981; /* 綠色表示水平 */
}

.vertical-slider::-webkit-slider-thumb {
  background: #3b82f6; /* 藍色表示垂直 */
}

.dark .horizontal-slider::-webkit-slider-thumb {
  background: #34d399;
  border-color: #1f2937;
}

.dark .vertical-slider::-webkit-slider-thumb {
  background: #60a5fa;
  border-color: #1f2937;
}

.spacing-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

/* Firefox 滑塊樣式 */
.spacing-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.horizontal-slider::-moz-range-thumb {
  background: #10b981;
}

.vertical-slider::-moz-range-thumb {
  background: #3b82f6;
}

.dark .horizontal-slider::-moz-range-thumb {
  background: #34d399;
  border-color: #1f2937;
}

.dark .vertical-slider::-moz-range-thumb {
  background: #60a5fa;
  border-color: #1f2937;
}
</style>
