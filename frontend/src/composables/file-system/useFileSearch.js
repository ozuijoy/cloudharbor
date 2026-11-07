/**
 * 檔案搜尋組合式函式
 */
import { ref, computed, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { useAuthStore } from "@/stores/authStore.js";
import { api } from "@/api";
import { useI18n } from "vue-i18n";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { createLogger } from "@/utils/logger.js";

export function useFileSearch() {
  const authStore = useAuthStore();
  const { t } = useI18n();
  const { getPathToken, getAllPathTokens } = usePathPassword();
  const log = createLogger("FileSearch");

  // API呼叫函式 - 使用統一API，自動根據認證資訊處理使用者型別
  const searchApi = computed(() => {
    return api.fs.searchFiles;
  });

  // 狀態管理
  const searchQuery = ref("");
  const searchResults = ref([]);
  const isSearching = ref(false);
  const searchError = ref(null);
  const hasPerformedSearch = ref(false);
  const searchNotices = ref([]);
  const passwordFilteredTotal = ref(0);
  const pathRestrictedPrefix = ref(null);
  const searchParams = ref({
    scope: "global", // 'global', 'mount', 'directory'
    mountId: "",
    path: "",
    limit: 50,
    cursor: null,
  });

  // 搜尋歷史
  const searchHistory = useLocalStorage("fileSearchHistory", []);
  const maxHistoryItems = 10;

  // 計算屬性
  // 後端統一最小長度：FTS5 trigram contains（>=3 字元）
  const hasSearchQuery = computed(() => searchQuery.value.trim().length >= 3);
  const hasSearchResults = computed(() => searchResults.value.length > 0);
  const searchResultsCount = computed(() => searchResults.value.length);
  const canSearch = computed(() => hasSearchQuery.value && !isSearching.value);

  // 搜尋結果統計
  const searchStats = ref({
    total: 0,
    hasMore: false,
    mountsSearched: 0,
    nextCursor: null,
  });

  /**
   * 執行搜尋
   * @param {string} query - 搜尋查詢字串
   * @param {Object} options - 搜尋選項
   */
  const performSearch = async (query = null, options = {}) => {
    try {
      const searchTerm = query || searchQuery.value;

      if (!searchTerm || searchTerm.trim().length < 3) {
        searchError.value = t("search.errors.queryTooShort");
        return;
      }

      isSearching.value = true;
      searchError.value = null;
      searchNotices.value = [];
      passwordFilteredTotal.value = 0;
      pathRestrictedPrefix.value = null;

      // 合併搜尋引數
      const finalSearchParams = {
        ...searchParams.value,
        ...options,
        // 執行新搜尋時強制從第一頁開始
        cursor: null,
      };

      const tokenPath = finalSearchParams.path || "/";
      const token = getPathToken(tokenPath);
      if (token) {
        finalSearchParams.pathToken = token;
      }
      const tokens = getAllPathTokens();
      if (tokens.length > 0) {
        finalSearchParams.pathTokens = tokens;
      }

      log.debug("開始搜尋檔案:", searchTerm, finalSearchParams);

      // 標記已執行搜尋
      hasPerformedSearch.value = true;

      // 呼叫搜尋API
      const response = await searchApi.value(searchTerm, finalSearchParams);

      if (response.success) {
        const searchData = response.data;
        searchResults.value = searchData.results || [];
        searchStats.value = {
          total: searchData.total || 0,
          hasMore: searchData.hasMore || false,
          mountsSearched: searchData.mountsSearched || 0,
          nextCursor: searchData.nextCursor || null,
        };

        if (searchData.pathRestricted && searchData.pathRestrictedPrefix) {
          pathRestrictedPrefix.value = searchData.pathRestrictedPrefix;
        }
        if (searchData.passwordFilteredCount) {
          passwordFilteredTotal.value += Number(searchData.passwordFilteredCount) || 0;
        }
        const notices = [];
        if (pathRestrictedPrefix.value) {
          notices.push(t("search.notices.pathRestricted", { path: pathRestrictedPrefix.value }));
        }
        if (passwordFilteredTotal.value > 0) {
          notices.push(t("search.notices.passwordFiltered", { count: passwordFilteredTotal.value }));
        }
        searchNotices.value = notices;

        // 索引未就緒：用結構化提示引導管理員
        if (searchData && searchData.indexReady === false && searchData.hint) {
          searchError.value = searchData.hint;
        }

        // 新增到搜尋歷史
        addToSearchHistory(searchTerm);

        log.debug("搜尋完成:", {
          query: searchTerm,
          results: searchResults.value.length,
          total: searchStats.value.total,
        });
      } else {
        throw new Error(response.message || t("search.errors.searchFailed"));
      }
    } catch (err) {
      log.error("搜尋失敗:", err);
      searchError.value = err.message || t("search.errors.searchFailed");
      searchResults.value = [];
      searchStats.value = { total: 0, hasMore: false, mountsSearched: 0, nextCursor: null };
    } finally {
      isSearching.value = false;
    }
  };

  /**
   * 載入更多搜尋結果（分頁）
   */
  const loadMoreResults = async () => {
    if (!searchStats.value.hasMore || !searchStats.value.nextCursor || isSearching.value) {
      return;
    }

    try {
      isSearching.value = true;
      searchError.value = null;

      const paginationParams = {
        ...searchParams.value,
        cursor: searchStats.value.nextCursor,
      };

      const tokenPath = paginationParams.path || "/";
      const token = getPathToken(tokenPath);
      if (token) {
        paginationParams.pathToken = token;
      }
      const tokens = getAllPathTokens();
      if (tokens.length > 0) {
        paginationParams.pathTokens = tokens;
      }

      log.debug("載入更多搜尋結果:", { cursor: searchStats.value.nextCursor });

      const response = await searchApi.value(searchQuery.value, paginationParams);

      if (response.success) {
        const searchData = response.data;
        // 追加新結果到現有結果
        searchResults.value.push(...(searchData.results || []));
        const existingTotal = searchStats.value.total || 0;
        const incomingTotal = Number(searchData.total || 0);
        searchStats.value = {
          total: incomingTotal > existingTotal ? incomingTotal : existingTotal,
          hasMore: searchData.hasMore || false,
          mountsSearched: searchData.mountsSearched || 0,
          nextCursor: searchData.nextCursor || null,
        };

        log.debug("載入更多結果完成:", {
          newResults: searchData.results?.length || 0,
          totalResults: searchResults.value.length,
        });
      } else {
        throw new Error(response.message || t("search.errors.loadMoreFailed"));
      }
    } catch (err) {
      log.error("載入更多結果失敗:", err);
      searchError.value = err.message || t("search.errors.loadMoreFailed");
    } finally {
      isSearching.value = false;
    }
  };

  /**
   * 清除搜尋結果
   */
  const clearSearch = () => {
    searchQuery.value = "";
    searchResults.value = [];
    searchError.value = null;
    hasPerformedSearch.value = false;
    searchNotices.value = [];
    passwordFilteredTotal.value = 0;
    pathRestrictedPrefix.value = null;
    searchStats.value = { total: 0, hasMore: false, mountsSearched: 0, nextCursor: null };
    // 重置分頁遊標
    searchParams.value.cursor = null;
    log.debug("搜尋結果已清除");
  };

  /**
   * 更新搜尋引數
   * @param {Object} params - 新的搜尋引數
   */
  const updateSearchParams = (params) => {
    searchParams.value = {
      ...searchParams.value,
      ...params,
      cursor: null, // 重置分頁遊標
    };
    log.debug("搜尋引數已更新:", searchParams.value);
  };

  /**
   * 設定搜尋範圍
   * @param {string} scope - 搜尋範圍 ('global', 'mount', 'directory')
   * @param {Object} options - 額外選項
   */
  const setSearchScope = (scope, options = {}) => {
    const newParams = {
      scope,
      mountId: options.mountId || "",
      path: options.path || "",
      cursor: null,
    };
    updateSearchParams(newParams);
  };

  /**
   * 新增到搜尋歷史
   * @param {string} query - 搜尋查詢
   */
  const addToSearchHistory = (query) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // 移除重複項
    const filteredHistory = searchHistory.value.filter((item) => item !== trimmedQuery);

    // 新增到開頭
    searchHistory.value = [trimmedQuery, ...filteredHistory].slice(0, maxHistoryItems);
  };

  /**
   * 載入搜尋歷史
   */
  const loadSearchHistory = () => {
    if (!Array.isArray(searchHistory.value)) {
      searchHistory.value = [];
    }
  };

  /**
   * 清除搜尋歷史
   */
  const clearSearchHistory = () => {
    searchHistory.value = [];
  };

  /**
   * 清除搜尋錯誤
   */
  const clearSearchError = () => {
    searchError.value = null;
  };

  /**
   * 獲取搜尋錯誤資訊
   * @returns {string|null} 錯誤資訊
   */
  const getSearchError = () => {
    return searchError.value;
  };

  // 初始化時載入搜尋歷史
  loadSearchHistory();

  // 監聽認證狀態變化，清除搜尋結果
  watch(
    () => authStore.isAuthenticated,
    (newValue) => {
      if (!newValue) {
        clearSearch();
      }
    }
  );

  return {
    // 狀態
    searchQuery,
    searchResults,
    isSearching,
    searchError,
    searchNotices,
    searchParams,
    searchHistory,
    searchStats,
    hasPerformedSearch,

    // 計算屬性
    hasSearchQuery,
    hasSearchResults,
    searchResultsCount,
    canSearch,

    // 方法
    performSearch,
    loadMoreResults,
    clearSearch,
    updateSearchParams,
    setSearchScope,
    addToSearchHistory,
    loadSearchHistory,
    clearSearchHistory,
    clearSearchError,
    getSearchError,
  };
}
