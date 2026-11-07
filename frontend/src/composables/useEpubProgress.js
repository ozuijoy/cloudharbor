/**
 * EPUB 閱讀進度管理 Composable
 *
 * - 閱讀進度自動儲存/恢復
 * - 書籤管理（新增、刪除、跳轉）
 * - 閱讀歷史導航（前進、後退）
 *
 * 儲存結構：
 * {
 *   [bookId]: {
 *     cfi: "epubcfi(...)",           // 當前位置 CFI
 *     fraction: 0.25,                // 閱讀進度百分比
 *     lastReadTime: timestamp,       // 最後閱讀時間
 *     bookmarks: [{ cfi, title, createdAt }], // 書籤列表
 *   }
 * }
 */

import { ref, computed, onBeforeUnmount } from "vue";
import { useDebounceFn, useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const STORAGE_KEY = "cloudharbor-epub-progress";
const MAX_BOOKS = 30; // 最多儲存 30 本書的進度
const SAVE_DEBOUNCE_MS = 1000; // 儲存防抖時間
const log = createLogger("EpubProgress");

// 全量進度儲存
const storedAllProgress = useLocalStorage(STORAGE_KEY, {});

/**
 * 從 localStorage 載入所有進度資料
 */
function loadAllProgress() {
  try {
    return storedAllProgress.value || {};
  } catch (e) {
    log.warn("[EpubProgress] 載入進度資料失敗:", e);
    return {};
  }
}

/**
 * 儲存所有進度資料到 localStorage
 */
function saveAllProgress(data) {
  try {
    // 清理過期資料：只保留最近的 MAX_BOOKS 本書
    const entries = Object.entries(data);
    if (entries.length > MAX_BOOKS) {
      // 按最後閱讀時間排序，保留最新的
      entries.sort((a, b) => (b[1].lastReadTime || 0) - (a[1].lastReadTime || 0));
      data = Object.fromEntries(entries.slice(0, MAX_BOOKS));
    }
    storedAllProgress.value = data;
    return true;
  } catch (e) {
    log.warn("[EpubProgress] 儲存進度資料失敗:", e);
    return false;
  }
}

/**
 * 生成書籍唯一標識
 * @param {string} url - 書籍 URL
 * @param {string} title - 書籍標題
 * @param {string} author - 書籍作者
 */
export function generateBookId(url, title = "", author = "") {
  // 優先使用 URL 的 hash，因為同一本書的 URL 通常是唯一的
  if (url) {
    // 提取 URL 中的檔名部分作為標識
    try {
      const urlObj = new URL(url, window.location.origin);
      const pathname = urlObj.pathname;
      // 移除查詢引數和 hash，只保留路徑
      const filename = pathname.split("/").pop() || pathname;
      if (filename) {
        return `url:${filename}`;
      }
    } catch {
      // URL 解析失敗，使用整個 URL
      return `url:${btoa(url).slice(0, 32)}`;
    }
  }

  // 如果沒有 URL，使用標題和作者
  if (title) {
    const id = `${title}-${author}`.replace(/\s+/g, "-").toLowerCase();
    return `meta:${id}`;
  }

  // 最後的 fallback
  return `unknown:${Date.now()}`;
}

/**
 * EPUB 閱讀進度管理 Hook
 * @param {string} bookId - 書籍唯一標識
 */
export function useEpubProgress(bookId) {
  // 響應式狀態
  const currentCfi = ref("");
  const currentFraction = ref(0);
  const bookmarks = ref([]);
  const isLoaded = ref(false);

  // 防抖儲存
  const saveProgressDebounced = useDebounceFn(() => {
    const allData = loadAllProgress();
    allData[bookId] = {
      cfi: currentCfi.value,
      fraction: currentFraction.value,
      lastReadTime: Date.now(),
      bookmarks: bookmarks.value,
    };
    saveAllProgress(allData);
  }, SAVE_DEBOUNCE_MS);

  /**
   * 載入書籍進度
   */
  function loadProgress() {
    if (!bookId) return null;

    const allData = loadAllProgress();
    const bookData = allData[bookId];

    if (bookData) {
      currentCfi.value = bookData.cfi || "";
      currentFraction.value = bookData.fraction || 0;
      bookmarks.value = Array.isArray(bookData.bookmarks) ? bookData.bookmarks : [];
      isLoaded.value = true;
      return bookData;
    }

    isLoaded.value = true;
    return null;
  }

  /**
   * 儲存當前進度（防抖）
   */
  function saveProgress(cfi, fraction) {
    if (!bookId) return;

    currentCfi.value = cfi || currentCfi.value;
    currentFraction.value = fraction ?? currentFraction.value;

    // 防抖儲存
    saveProgressDebounced();
  }

  /**
   * 立即儲存進度（不防抖）
   */
  function saveProgressImmediate() {
    if (!bookId) return;

    saveProgressDebounced.cancel?.();

    const allData = loadAllProgress();
    allData[bookId] = {
      cfi: currentCfi.value,
      fraction: currentFraction.value,
      lastReadTime: Date.now(),
      bookmarks: bookmarks.value,
    };
    saveAllProgress(allData);
  }

  /**
   * 新增書籤
   * @param {string} cfi - 書籤位置 CFI
   * @param {string} title - 書籤標題（章節名或自定義）
   * @param {string} excerpt - 書籤摘要文字
   */
  function addBookmark(cfi, title = "", excerpt = "") {
    if (!cfi) return false;

    // 檢查是否已存在
    const exists = bookmarks.value.some((b) => b.cfi === cfi);
    if (exists) return false;

    bookmarks.value.push({
      cfi,
      title: title || `書籤 ${bookmarks.value.length + 1}`,
      excerpt: excerpt || "",
      createdAt: Date.now(),
    });

    saveProgressImmediate();
    return true;
  }

  /**
   * 刪除書籤
   * @param {string} cfi - 書籤位置 CFI
   */
  function removeBookmark(cfi) {
    const index = bookmarks.value.findIndex((b) => b.cfi === cfi);
    if (index === -1) return false;

    bookmarks.value.splice(index, 1);
    saveProgressImmediate();
    return true;
  }

  /**
   * 檢查當前位置是否有書籤
   * @param {string} cfi - 位置 CFI
   */
  function hasBookmark(cfi) {
    if (!cfi) return false;
    return bookmarks.value.some((b) => b.cfi === cfi);
  }

  /**
   * 清除書籍所有資料
   */
  function clearProgress() {
    if (!bookId) return;

    currentCfi.value = "";
    currentFraction.value = 0;
    bookmarks.value = [];

    const allData = loadAllProgress();
    delete allData[bookId];
    saveAllProgress(allData);
  }

  // 元件解除安裝時立即儲存
  onBeforeUnmount(() => {
    saveProgressDebounced.cancel?.();
    saveProgressImmediate();
  });

  return {
    // 狀態
    currentCfi,
    currentFraction,
    bookmarks,
    isLoaded,

    // 方法
    loadProgress,
    saveProgress,
    saveProgressImmediate,
    addBookmark,
    removeBookmark,
    hasBookmark,
    clearProgress,
  };
}

/**
 * 閱讀歷史導航 Hook
 * 管理閱讀器內的前進/後退導航
 */
export function useReadingHistory(maxSize = 50) {
  const history = ref([]); // 歷史記錄棧
  const currentIndex = ref(-1); // 當前位置索引

  /**
   * 新增歷史記錄
   * @param {string} cfi - 位置 CFI
   * @param {string} title - 章節標題
   */
  function push(cfi, title = "") {
    if (!cfi) return;

    // 如果當前不在歷史末尾，刪除後面的記錄
    if (currentIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, currentIndex.value + 1);
    }

    // 避免重複新增相同位置
    const last = history.value[history.value.length - 1];
    if (last?.cfi === cfi) return;

    // 新增新記錄
    history.value.push({ cfi, title, timestamp: Date.now() });

    // 限制歷史記錄大小
    if (history.value.length > maxSize) {
      history.value.shift();
    } else {
      currentIndex.value = history.value.length - 1;
    }
  }

  /**
   * 是否可以後退
   */
  const canGoBack = computed(() => currentIndex.value > 0);

  /**
   * 是否可以前進
   */
  const canGoForward = computed(() => currentIndex.value < history.value.length - 1);

  /**
   * 後退
   * @returns {object|null} 後退到的位置
   */
  function goBack() {
    if (!canGoBack.value) return null;
    currentIndex.value--;
    return history.value[currentIndex.value];
  }

  /**
   * 前進
   * @returns {object|null} 前進到的位置
   */
  function goForward() {
    if (!canGoForward.value) return null;
    currentIndex.value++;
    return history.value[currentIndex.value];
  }

  /**
   * 清空歷史
   */
  function clear() {
    history.value = [];
    currentIndex.value = -1;
  }

  return {
    history,
    currentIndex,
    canGoBack,
    canGoForward,
    push,
    goBack,
    goForward,
    clear,
  };
}

export default {
  useEpubProgress,
  useReadingHistory,
  generateBookId,
};
