// PasteViewUtils.js - 文字檢視頁面的通用工具方法
// - 提供 PasteView* 系列元件共享的工具函式（除錯日誌、過期時間格式化等）
// - 不直接依賴具體元件狀態，只依賴傳入引數和全域性工具

import { formatExpiry as formatExpiryUtil } from "@/utils/timeUtils.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PasteView");

/**
 * 統一的除錯日誌輸出函式
 * @param {boolean} enableDebug - 是否啟用除錯開關（來自元件 props 或本地 state）
 * @param {boolean} isDev - 是否為開發環境（import.meta.env.DEV）
 * @param  {...any} args - 要輸出的內容
 */
export function debugLog(enableDebug, isDev, ...args) {
  if (!enableDebug) return;
  if (!isDev) return;

  // 統一帶上字首，便於在控制檯過濾（還需要本地開啟 cloudharbor_debug=paste 或 cloudharbor_debug=1）
  log.debug(...args);
}

/**
 * 文字過期時間格式化封裝
 *
 * 說明：
 * - 實際邏輯委託給全域性 timeUtils.formatExpiry，保證 admin 檢視與 public 檢視展示一致
 * - 這裡保留一個簡單的包裝，方便未來在不影響其他呼叫方的前提下調整展示文案
 *
 * @param {string|null} expiryDateString - 過期時間字串（UTC ISO）
 * @returns {string}
 */
export function formatExpiry(expiryDateString) {
  return formatExpiryUtil(expiryDateString);
}

/**
 * 根據暗色/亮色模式返回統一的輸入框樣式類
 * 僅用於 PasteView 編輯/檢視頁面的表單控制元件，避免在各元件內重複拼接 class 字串
 *
 * @param {boolean} darkMode
 * @returns {string}
 */
export function getInputClasses(darkMode) {
  if (darkMode) {
    return "bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500 focus:ring-primary-500 focus:border-primary-500";
  }
  return "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-primary-500 focus:border-primary-500";
}
