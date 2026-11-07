<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 載入狀態 -->
    <div v-if="loading && results.length === 0" class="flex-1 flex items-center justify-center">
      <LoadingIndicator
        :text="t('search.status.searching')"
        :dark-mode="darkMode"
        size="xl"
        icon-class="text-blue-500"
        :text-class="darkMode ? 'text-gray-400' : 'text-gray-500'"
      />
    </div>

    <!-- 錯誤狀態 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <IconError size="3xl" class="mx-auto mb-4 text-red-500" aria-hidden="true" />
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.status.failed") }}
        </h3>
        <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ error }}
        </p>
      </div>
    </div>

    <!-- 搜尋結果列表 -->
    <div v-else-if="results.length > 0" class="flex-1 overflow-y-auto custom-scrollbar min-h-0">
      <!-- 結果項列表 - 統一的卡片式佈局 -->
      <div class="p-4 space-y-2">
        <div
          v-for="(item, index) in results"
          :key="`${item.mount_id}-${item.s3_key}-${index}`"
          class="result-item p-3 rounded-lg border transition-all duration-200 hover:shadow-md cursor-pointer"
          :class="darkMode ? 'border-gray-700 hover:border-gray-600 bg-gray-800 hover:bg-gray-750' : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'"
          @click="handleItemClick(item)"
        >
          <div class="flex items-center space-x-3">
            <!-- 檔案圖示 -->
            <div class="flex-shrink-0">
              <div class="w-8 h-8 flex items-center justify-center" v-html="getFileIcon(item)"></div>
            </div>

            <!-- 檔案資訊 -->
            <div class="flex-1 min-w-0">
              <!-- 檔名和大小 -->
              <div class="flex items-center gap-2">
                <div class="font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="item.name" v-html="highlightSearchQuery(item.name, searchQuery)"></div>
                <span
                  class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium flex-shrink-0"
                  :class="darkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-800'"
                >
                  {{ typeof item.size === 'number' ? formatFileSize(item.size) : '-' }}
                </span>
              </div>

              <!-- 檔案路徑 -->
              <div class="text-xs truncate mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="item.path">
                {{ item.path }}
              </div>
            </div>

            <!-- 操作按鈕 -->
            <div class="flex-shrink-0 flex space-x-1">
              <button
                @click.stop="copyPath(item)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'text-gray-400 hover:text-green-400 hover:bg-gray-700' : 'text-gray-500 hover:text-green-600 hover:bg-gray-100'"
                :title="t('search.results.item.copyPath')"
              >
                <IconCopy size="sm" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 載入更多按鈕 -->
      <div v-if="hasMore" class="p-4 text-center border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="loadMore"
          :disabled="loading"
          class="px-4 py-2 rounded-md border transition-colors"
          :class="
            loading
              ? darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
              : darkMode
              ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          "
        >
          <span v-if="loading" class="flex items-center">
            <IconRefresh class="animate-spin h-4 w-4 mr-2" aria-hidden="true" />
            {{ t("search.results.loadingMore") }}
          </span>
          <span v-else>{{ t("search.results.loadMore") }}</span>
        </button>
      </div>
    </div>

    <!-- 空狀態 - 未開始搜尋 -->
    <div v-else-if="!hasPerformedSearch && !hasSearchResults && !loading" class="py-12">
      <div class="text-center">
        <IconSearch size="2xl" class="mx-auto mb-3" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
        <h3 class="text-base font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.status.idle") }}
        </h3>
        <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("search.tips.keywordTips") }}
        </p>
      </div>
    </div>

    <!-- 無結果狀態 -->
    <div v-else-if="hasPerformedSearch && !hasSearchResults && !loading" class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm mx-auto px-4">
        <!-- 更直觀的無結果圖示 - 空資料夾 + 搜尋 -->
        <div class="relative mx-auto h-16 w-16 mb-6">
          <!-- 空資料夾 -->
          <IconFolderOpen size="4xl" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
          <!-- 小搜尋圖示疊加 -->
          <div class="absolute -bottom-1 -right-1 bg-white dark:bg-gray-800 rounded-full p-1">
            <IconSearch size="sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" aria-hidden="true" />
          </div>
        </div>

        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.results.noResults") }}
        </h3>
        <p class="text-sm leading-relaxed" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("search.results.noResultsHint") }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from "vue";
import { useI18n } from "vue-i18n";
import { IconCopy, IconError, IconFolderOpen, IconRefresh, IconSearch } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { getFileIcon as getFileIconUtil } from "@/utils/fileTypeIcons.js";
import { formatFileSize } from "@/utils/fileUtils.js";
import { formatDateTime } from "@/utils/timeUtils.js";
import { createLogger } from "@/utils/logger.js";

// 元件屬性
const props = defineProps({
  results: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: null,
  },
  hasMore: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  hasSearchQuery: {
    type: Boolean,
    default: false,
  },
  hasSearchResults: {
    type: Boolean,
    default: false,
  },
  searchQuery: {
    type: String,
    default: "",
  },
  hasPerformedSearch: {
    type: Boolean,
    default: false,
  },
});

// 元件事件
const emit = defineEmits(["item-click", "load-more"]);

// 組合式函式
const { t } = useI18n();
const log = createLogger("SearchResultList");

// 複製狀態管理 - 複用現有檔案列表的模式
const copiedPaths = reactive({});

// 獲取檔案圖示 - 複用現有檔案列表的圖示獲取模式
const getFileIcon = (item) => {
  return getFileIconUtil(
    {
      name: item.name,
      type: item.type,
      isDirectory: item.isDirectory || false,
      isMount: false,
    },
    props.darkMode
  );
};

// 高亮搜尋關鍵詞
const highlightSearchQuery = (text, query) => {
  if (!query || !text) {
    return text;
  }

  // 轉義特殊字元，防止正規表示式錯誤
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 建立不區分大小寫的正規表示式
  const regex = new RegExp(`(${escapedQuery})`, "gi");

  // 替換匹配的文字，新增高亮樣式
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 處理專案點選
const handleItemClick = (item) => {
  emit("item-click", item);
};

// 載入更多
const loadMore = () => {
  if (!props.loading && props.hasMore) {
    emit("load-more");
  }
};

// 複製路徑 - 複用現有檔案列表的複製功能
const copyPath = async (item) => {
  try {
    const success = await copyToClipboard(item.path);
    if (!success) {
      throw new Error("copy_failed");
    }

    // 設定複製狀態
    copiedPaths[item.s3_key] = true;

    // 2秒後重置狀態
    setTimeout(() => {
      copiedPaths[item.s3_key] = false;
    }, 2000);
  } catch (error) {
    log.error("複製路徑失敗:", error);
  }
};
</script>

<style scoped>
/* 搜尋結果網格佈局 */
.md\:grid-cols-search-result {
  grid-template-columns: 2fr 1fr 1fr 1.5fr auto;
}

.md\:grid-cols-search-result-simple {
  grid-template-columns: 2fr 1fr auto;
}

/* 結果項懸停效果 */
.result-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 暗色模式下的懸停效果 */
.dark .result-item:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* 自定義捲軸樣式 */
.custom-scrollbar {
  /* 確保滾動功能在所有瀏覽器中都能工作 */
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* 暗色模式捲軸 */
.dark .custom-scrollbar {
  scrollbar-color: rgba(75, 85, 99, 0.5) transparent;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(75, 85, 99, 0.7);
}

/* 強制確保滾動容器的高度約束 */
.custom-scrollbar {
  /* 確保容器可以收縮 */
  min-height: 0;
  /* 確保內容溢位時顯示捲軸 */
  overflow-y: auto !important;
}

/* 卡片懸停效果增強 */
.result-item {
  transition: all 0.2s ease-in-out;
}

.result-item:hover {
  transform: translateY(-1px);
}

/* 暗色模式下的灰色750 */
.hover\:bg-gray-750:hover {
  background-color: #374151;
}

/* 搜尋關鍵詞高亮樣式 */
.search-highlight {
  background-color: #fbbf24; /* 黃色背景 */
  color: #1f2937; /* 深色文字 */
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}

/* 暗色模式下的高亮樣式 */
.dark .search-highlight {
  background-color: #f59e0b; /* 更深的黃色 */
  color: #111827; /* 更深的文字 */
}
</style>
