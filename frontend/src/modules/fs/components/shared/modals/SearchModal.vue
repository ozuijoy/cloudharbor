<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div
      class="relative w-full max-w-sm sm:max-w-2xl lg:max-w-3xl min-h-[300px] rounded-lg shadow-xl flex flex-col transition-all duration-300"
      :class="[darkMode ? 'bg-gray-800' : 'bg-white', modalHeight]"
    >
      <!-- 標題欄 -->
      <div class="px-4 py-3 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-lg font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ t("search.title") }}</h3>
        <button @click="closeModal" class="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400">
          <IconClose size="lg" aria-hidden="true" />
        </button>
      </div>

      <!-- 搜尋輸入區域 -->
      <div class="px-4 py-4 border-b bg-gradient-to-r" :class="darkMode ? 'border-gray-700 from-gray-800 to-gray-800' : 'border-gray-200 from-gray-50 to-white'">
        <div class="flex gap-2 sm:gap-3 items-center">
          <!-- 搜尋範圍選擇 -->
          <div class="flex-shrink-0 w-20 sm:w-32 lg:w-36">
            <select
              v-model="searchParams.scope"
              @change="handleScopeChange"
              class="w-full h-10 px-2 sm:px-3 text-xs sm:text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent truncate"
              :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
            >
              <option value="global">{{ t("search.scope.global") }}</option>
              <option value="mount">{{ t("search.scope.mount") }}</option>
              <option value="directory">{{ t("search.scope.directory") }}</option>
            </select>
          </div>

          <!-- 搜尋輸入框 -->
          <div class="flex-1 relative min-w-0">
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              @keydown.enter="handleEnterSearch"
              @keydown.esc="clearSearch"
              type="text"
              :placeholder="t('search.placeholder')"
              class="w-full h-10 px-3 sm:px-4 pr-10 rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 shadow-sm focus:shadow-md"
              :class="
                darkMode
                  ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:bg-gray-600'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:bg-gray-50'
              "
              :disabled="isSearching"
            />

            <!-- 清除按鈕 -->
            <button
              v-if="searchQuery && !isSearching"
              @click="clearSearch"
              class="absolute right-3 top-1/2 transform -translate-y-1/2 p-1"
              :class="darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-500'"
            >
              <IconClose size="sm" aria-hidden="true" />
            </button>
          </div>

          <!-- 搜尋按鈕 -->
          <div class="flex-shrink-0 w-10 sm:w-auto">
            <button
              @click="handleSearchClick"
              :disabled="!canSearch"
              class="w-full h-10 px-2 sm:px-3 rounded-md border transition-all duration-200 flex items-center justify-center shadow-sm hover:shadow-md transform hover:scale-105"
              :class="[
                canSearch
                  ? darkMode
                    ? 'bg-blue-600 hover:bg-blue-700 border-blue-600 text-white shadow-blue-500/25'
                    : 'bg-blue-500 hover:bg-blue-600 border-blue-500 text-white shadow-blue-500/25'
                  : darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed',
              ]"
            >
              <IconSearch v-if="!isSearching" class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
              <IconRefresh v-else class="animate-spin h-4 w-4 sm:h-5 sm:w-5 text-white" aria-hidden="true" />
            </button>
          </div>
        </div>

        <!-- 搜尋歷史 -->
        <div v-if="searchHistory.length > 0 && !searchQuery && !hasSearchResults" class="mt-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ t("search.history.recent") }}
            </div>
            <button @click="clearSearchHistory" class="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">
              {{ t("search.history.clear") }}
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(historyItem, index) in searchHistory.slice(0, 5)"
              :key="index"
              @click="useHistorySearch(historyItem)"
              class="px-3 py-1.5 text-sm rounded-full transition-all duration-200 border hover:shadow-sm transform hover:scale-105"
              :class="
                darkMode
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600 border-gray-600 hover:border-gray-500'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-200 hover:border-gray-300'
              "
            >
              {{ historyItem }}
            </button>
          </div>
        </div>
      </div>

      <!-- 搜尋結果區域 -->
      <div class="flex-1 flex flex-col min-h-0">
        <!-- 搜尋狀態和統計 -->
        <div v-if="isSearching || (hasPerformedSearch && searchStats.total > 0)" class="px-4 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            <span v-if="isSearching">{{ t("search.status.searching") }}</span>
            <span v-else-if="searchStats.total > 0">
              {{ t("search.results.foundInMounts", { count: searchStats.total, mounts: searchStats.mountsSearched }) }}
            </span>
          </div>
        </div>

        <!-- 搜尋提示資訊 -->
        <div v-if="searchNotices.length > 0" class="px-4 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="space-y-1 text-xs" :class="darkMode ? 'text-blue-300' : 'text-blue-600'">
            <div v-for="(notice, index) in searchNotices" :key="index">
              {{ notice }}
            </div>
          </div>
        </div>

        <!-- 搜尋結果列表 -->
        <SearchResultList
          :results="searchResults"
          :loading="isSearching"
          :error="searchError"
          :has-more="searchStats.hasMore"
          :dark-mode="darkMode"
          :has-search-query="hasSearchQuery"
          :has-search-results="hasSearchResults"
          :has-performed-search="hasPerformedSearch"
          :search-query="searchQuery"
          @item-click="handleItemClick"
          @load-more="loadMoreResults"
          class="flex-1"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { IconClose, IconRefresh, IconSearch } from "@/components/icons";
import { useFileSearch } from "@/composables/file-system/useFileSearch.js";
import { useUIState } from "@/composables/ui-interaction/useUIState.js";
import SearchResultList from "./SearchResultList.vue";

// 元件屬性
const props = defineProps({
  isOpen: {
    type: Boolean,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  currentPath: {
    type: String,
    default: "/",
  },
  currentMountId: {
    type: String,
    default: "",
  },
});

// 元件事件
const emit = defineEmits(["close", "item-click"]);

// 組合式函式
const { t } = useI18n();
const { showMessage } = useUIState();
const {
  searchQuery,
  searchResults,
  isSearching,
  searchError,
  searchNotices,
  searchParams,
  searchHistory,
  searchStats,
  hasSearchQuery,
  hasSearchResults,
  hasPerformedSearch,
  canSearch,
  performSearch,
  loadMoreResults,
  clearSearch,
  clearSearchHistory,
} = useFileSearch();

// 本地狀態
const searchInputRef = ref(null);

// 動態高度計算
const modalHeight = computed(() => {
  // 如果有搜尋結果或正在搜尋，使用正常高度
  if (hasSearchResults.value || isSearching.value || (hasPerformedSearch.value && searchStats.value.total > 0)) {
    return "h-[75vh] sm:h-[70vh]";
  }
  // 未搜尋時使用較小高度
  return "h-auto max-h-[60vh]";
});

// 處理回車搜尋
const handleEnterSearch = async () => {
  if (searchQuery.value.trim().length >= 2) {
    await performSearch();
  }
};

// 處理搜尋按鈕點選
const handleSearchClick = async () => {
  if (searchQuery.value.trim().length >= 2) {
    await performSearch();
  }
};

// 處理搜尋範圍變化
const handleScopeChange = () => {
  // 根據搜尋範圍設定相應的引數
  if (searchParams.value.scope === "mount") {
    searchParams.value.mountId = props.currentMountId;
    searchParams.value.path = "";
  } else if (searchParams.value.scope === "directory") {
    searchParams.value.mountId = props.currentMountId;
    searchParams.value.path = props.currentPath;
  } else {
    searchParams.value.mountId = "";
    searchParams.value.path = "";
  }
};

// 使用歷史搜尋
const useHistorySearch = (historyItem) => {
  searchQuery.value = historyItem;
  performSearch();
};

// 處理搜尋結果項點選
const handleItemClick = (item) => {
  emit("item-click", item);
  closeModal();
};

// 關閉模態框
const closeModal = () => {
  if (isSearching.value) return; // 如果正在搜尋，不允許關閉
  emit("close");
};

// 鍵盤事件處理：按 ESC 關閉
onKeyStroke("Escape", () => {
  if (props.isOpen) {
    closeModal();
  }
});

// 監聽模態框開啟狀態
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      // 模態框開啟時，聚焦搜尋輸入框
      nextTick(() => {
        if (searchInputRef.value) {
          searchInputRef.value.focus();
        }
      });

      // 設定預設搜尋範圍為當前目錄
      if (props.currentMountId) {
        searchParams.value.scope = "directory";
        searchParams.value.mountId = props.currentMountId;
        searchParams.value.path = props.currentPath;
      }
    } else {
      // 模態框關閉時，清除搜尋狀態
      clearSearch();
    }
  }
);

</script>
