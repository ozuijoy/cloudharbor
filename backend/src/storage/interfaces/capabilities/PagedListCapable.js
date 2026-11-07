/**
 * 目錄分頁能力（可選）
 *
 * - 有些上游“列目錄 API”天然就是分頁的，
 *   不分頁就拿不全，或者會遇到上游限制/超時。
 * - 這個能力用於“/api/fs/list”自動啟用分頁返回。
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isPagedListCapable() 檢測：
 *
 * - supportsDirectoryPagination(): boolean
 *   返回 true 表示該驅動的 listDirectory 支援 cursor/limit/paged 這些引數，並且可以分頁返回。
 *
 */

/**
 * 檢查物件是否實現了 PagedList 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備目錄分頁能力
 */
export function isPagedListCapable(obj) {
  try {
    return !!(obj && typeof obj.listDirectory === "function" && typeof obj.supportsDirectoryPagination === "function" && obj.supportsDirectoryPagination());
  } catch {
    return false;
  }
}

/**
 * PagedList 能力的識別符號
 */
export const PAGED_LIST_CAPABILITY = "PagedListCapable";

