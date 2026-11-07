import { ApiStatus } from "../../../constants/index.js";

/**
 * 通用搜尋結果排序工具
 * - 優先按檔名完全匹配
 * - 其次按檔名開頭匹配
 * - 最後按修改時間倒序
 * @param {Array<Object>} results
 * @param {string} query
 * @returns {Array<Object>}
 */
export function sortSearchResults(results, query) {
  const q = (query || "").toLowerCase();
  if (!Array.isArray(results) || results.length === 0 || !q) {
    return Array.isArray(results) ? results : [];
  }

  return [...results].sort((a, b) => {
    const aName = (a?.name || "").toLowerCase();
    const bName = (b?.name || "").toLowerCase();

    const aExact = aName === q;
    const bExact = bName === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aStarts = aName.startsWith(q);
    const bStarts = bName.startsWith(q);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    const aModified = a?.modified ? new Date(a.modified).getTime() : 0;
    const bModified = b?.modified ? new Date(b.modified).getTime() : 0;
    return bModified - aModified;
  });
}

