/**
 * 檔案相關展示工具函式
 * 統一處理檔案大小與剩餘訪問次數的格式化
 */

import { formatFileSize as formatFileSizeUtil } from "./fileTypes.js";

/**
 * 格式化檔案大小
 * @param {number} bytes - 檔案大小（位元組）
 * @param {boolean} useChineseUnits - 是否使用中文單位
 * @returns {string}
 */
export const formatFileSize = (bytes, useChineseUnits = false) => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  return formatFileSizeUtil(bytes, useChineseUnits);
};

/**
 * 計算剩餘可訪問次數
 * @param {Object} item - 檔案或文字分享物件
 * @returns {number} - Infinity 表示無限制，0 表示已用完，正整數表示剩餘次數
 */
export const getRemainingViews = (item) => {
  if (!item || !item.max_views || item.max_views === 0) {
    // 無限制
    return Infinity;
  }

  // 相容不同欄位：優先使用後端提供的 view_count，其次是 views
  const viewCount = item.view_count !== undefined ? item.view_count : item.views || 0;
  const remaining = item.max_views - viewCount;

  // 已用完
  if (remaining <= 0) {
    return 0;
  }

  // 返回剩餘次數
  return remaining;
};

/**
 * 獲取剩餘訪問次數對應的樣式類（基於數值模型）
 * @param {number} remaining - 剩餘次數（Infinity 表示無限制，0 表示已用完）
 * @param {boolean} darkMode - 是否為暗色模式
 * @returns {string}
 */
export const getRemainingViewsClass = (remaining, darkMode = false) => {
  if (remaining === 0) {
    // 已用完：紅色高亮
    return darkMode ? "text-red-400" : "text-red-600";
  }

  if (remaining !== Infinity && remaining < 10) {
    // 剩餘次數很少（<10）：黃色提醒
    return darkMode ? "text-yellow-400" : "text-yellow-600";
  }

  // 正常狀態
  return darkMode ? "text-gray-300" : "text-gray-700";
};
