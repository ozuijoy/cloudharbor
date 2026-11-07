/**
 * 快取模組統一匯出
 * 提供所有快取相關類和例項的統一入口
 */
import "./cacheListeners.js";
// ==================== 基礎快取類 ====================
export { BaseCache } from "./BaseCache.js";

// ==================== 目錄快取 ====================
export { DirectoryCacheManager, directoryCacheManager } from "./DirectoryCache.js";

// ==================== URL快取 ====================
export { UrlCacheManager, urlCacheManager, clearUrlCache } from "./UrlCache.js";

// ==================== 搜尋快取 ====================
export { SearchCacheManager, searchCacheManager, clearSearchCache } from "./SearchCache.js";

// ==================== FS 目錄摘要快取 ====================
export { FsFolderSummaryCacheManager, fsFolderSummaryCacheManager } from "./FsFolderSummaryCache.js";

// ==================== 預覽設定快取 ====================
export { PreviewSettingsCache, previewSettingsCache } from "./PreviewSettingsCache.js";

// ==================== 相容匯出 ====================
// 相容的預設匯出
export { default as previewSettingsCacheDefault } from "./PreviewSettingsCache.js";

// ==================== 事件匯流排與狀態 ====================
export { default as cacheBus, CACHE_EVENTS } from "./cacheBus.js";
export { getMountsVersion, bumpMountsVersion } from "./cacheState.js";
export { invalidateFsCache, invalidatePreviewCache, invalidateAllCaches } from "./invalidation.js";
