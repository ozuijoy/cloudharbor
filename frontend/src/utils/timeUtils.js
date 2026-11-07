/**
 * 統一的時間處理工具函式
 * 用於處理從後端接收的 UTC 時間戳，並轉換為使用者本地時區的時間顯示
 *
 * 後端現在統一使用 CURRENT_TIMESTAMP 儲存 UTC 時間
 * 前端負責根據使用者的時區設定進行本地化顯示
 */

import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const storedLanguage = useLocalStorage("language", "zh-TW");
const log = createLogger("TimeUtils");

// 獲取當前語言設定
const getCurrentLanguage = () => {
  try {
    return storedLanguage.value || "zh-TW";
  } catch {
    return "zh-TW";
  }
};

// 簡單的翻譯對映 - 避免在工具函式中使用複雜的國際化
const translations = {
  "zh-TW": {
    unknown: "未知",
    dateInvalid: "日期無效",
    dateFormatError: "日期格式錯誤",
    soon: "即將",
    justNow: "剛剛",
    minutesAgo: "{count}分鐘前",
    minutesLater: "{count}分鐘後",
    hoursAgo: "{count}小時前",
    hoursLater: "{count}小時後",
    daysAgo: "{count}天前",
    daysLater: "{count}天后",
    weeksAgo: "{count}周前",
    weeksLater: "{count}周後",
    monthsAgo: "{count}個月前",
    monthsLater: "{count}個月後",
    yearsAgo: "{count}年前",
    yearsLater: "{count}年後",
    neverExpires: "永不過期",
    expired: "已過期",
  },
  "en-US": {
    unknown: "Unknown",
    dateInvalid: "Invalid Date",
    dateFormatError: "Date Format Error",
    soon: "Soon",
    justNow: "Just now",
    minutesAgo: "{count} minutes ago",
    minutesLater: "{count} minutes later",
    hoursAgo: "{count} hours ago",
    hoursLater: "{count} hours later",
    daysAgo: "{count} days ago",
    daysLater: "{count} days later",
    weeksAgo: "{count} weeks ago",
    weeksLater: "{count} weeks later",
    monthsAgo: "{count} months ago",
    monthsLater: "{count} months later",
    yearsAgo: "{count} years ago",
    yearsLater: "{count} years later",
    neverExpires: "Never expires",
    expired: "Expired",
  },
};

// 獲取翻譯文字
const t = (key, params = {}) => {
  const lang = getCurrentLanguage();
  const langTranslations = translations[lang] || translations["zh-TW"];
  let text = langTranslations[key] || key;

  // 簡單的引數替換
  if (params.count !== undefined) {
    text = text.replace("{count}", params.count);
  }

  return text;
};

/**
 * 時間格式化選項配置
 */
const TIME_FORMAT_OPTIONS = {
  // 完整日期時間格式（年-月-日 時:分）
  FULL_DATETIME: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // 使用24小時制
  },

  // 完整日期時間格式（包含秒）
  FULL_DATETIME_WITH_SECONDS: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },

  // 相對時間單位（毫秒）
  RELATIVE_TIME_UNITS: {
    MINUTE: 60,
    HOUR: 3600,
    DAY: 86400,
    WEEK: 604800,
    MONTH: 2592000, // 30天
    YEAR: 31536000, // 365天
  },
};

/**
 * 將 UTC 時間字串轉換為本地 Date 物件
 * @param {string|Date|number} utcDateString - UTC 時間字串、Date物件或時間戳
 * @returns {Date|null} 本地 Date 物件，如果無效則返回 null
 */
export const parseUTCDate = (utcDateString) => {
  if (!utcDateString) {
    return null;
  }

  try {
    // 如果已經是 Date 物件，直接返回
    if (utcDateString instanceof Date) {
      return isNaN(utcDateString.getTime()) ? null : utcDateString;
    }

    // 如果不是字串，說明資料型別不正確，返回 null
    if (typeof utcDateString !== "string") {
      return null;
    }

    let dateString = utcDateString.trim();

    // 處理不同的UTC時間格式
    // 1. 如果已經是ISO格式（帶Z或時區偏移），直接解析
    if (dateString.includes("T") && (dateString.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateString))) {
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date;
    }

    // 2. 如果是SQLite CURRENT_TIMESTAMP格式 "YYYY-MM-DD HH:mm:ss"，需要明確指定為UTC
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateString)) {
      // 將空格替換為T，並新增Z表示UTC時間
      dateString = dateString.replace(" ", "T") + "Z";
    }
    // 3. 如果是日期格式 "YYYY-MM-DD"，新增時間和UTC標識
    else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      dateString = dateString + "T00:00:00Z";
    }
    // 4. 如果是ISO格式但沒有Z，新增Z
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateString)) {
      dateString = dateString + "Z";
    }

    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  } catch (error) {
    log.error("解析 UTC 時間失敗:", error, "輸入:", utcDateString);
    return null;
  }
};

/**
 * 獲取使用者的首選語言設定
 * @returns {string} 使用者的語言程式碼
 */
export const getUserLocale = () => {
  // 優先使用瀏覽器語言設定
  if (navigator.language) {
    return navigator.language;
  }
  // 備選方案：使用瀏覽器語言列表的第一個
  if (navigator.languages && navigator.languages.length > 0) {
    return navigator.languages[0];
  }
  // 最後備選：預設中文
  return "zh-TW";
};

/**
 * 格式化日期時間為本地時間顯示
 * @param {string} utcDateString - UTC 時間字串
 * @param {Object} options - 格式化選項，預設為完整日期時間格式
 * @param {string} locale - 地區設定，預設自動檢測使用者語言
 * @returns {string} 格式化後的本地時間字串
 */
export const formatDateTime = (utcDateString, options = TIME_FORMAT_OPTIONS.FULL_DATETIME, locale = getUserLocale()) => {
  if (!utcDateString) return t("unknown");

  const date = parseUTCDate(utcDateString);
  if (!date) {
    log.warn("時間解析失敗:", utcDateString);
    return t("dateInvalid");
  }

  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch (error) {
    log.error("日期格式化錯誤:", error, "輸入:", utcDateString);
    return t("dateFormatError");
  }
};

/**
 * 格式化日期時間（包含秒）
 * @param {string} utcDateString - UTC 時間字串
 * @param {string} locale - 地區設定，預設自動檢測使用者語言
 * @returns {string} 格式化後的時間字串
 */
export const formatDateTimeWithSeconds = (utcDateString, locale = getUserLocale()) => {
  return formatDateTime(utcDateString, TIME_FORMAT_OPTIONS.FULL_DATETIME_WITH_SECONDS, locale);
};

/**
 * 計算相對時間（如：3天前、2小時後）
 * @param {string} utcDateString - UTC 時間字串
 * @param {Date} baseDate - 基準時間，預設為當前時間
 * @returns {string} 相對時間描述
 */
export const formatRelativeTime = (utcDateString, baseDate = new Date()) => {
  if (!utcDateString) return "";

  const targetDate = parseUTCDate(utcDateString);
  if (!targetDate) {
    return "";
  }

  try {
    // 計算時間差（秒）
    const diffInSeconds = Math.floor((targetDate - baseDate) / 1000);
    const absDiff = Math.abs(diffInSeconds);
    const isInFuture = diffInSeconds > 0;

    const { MINUTE, HOUR, DAY, WEEK, MONTH, YEAR } = TIME_FORMAT_OPTIONS.RELATIVE_TIME_UNITS;

    // 根據時間差返回不同的描述
    if (absDiff < MINUTE) {
      return isInFuture ? t("soon") : t("justNow");
    } else if (absDiff < HOUR) {
      const minutes = Math.floor(absDiff / MINUTE);
      return isInFuture ? t("minutesLater", { count: minutes }) : t("minutesAgo", { count: minutes });
    } else if (absDiff < DAY) {
      const hours = Math.floor(absDiff / HOUR);
      return isInFuture ? t("hoursLater", { count: hours }) : t("hoursAgo", { count: hours });
    } else if (absDiff < WEEK) {
      const days = Math.floor(absDiff / DAY);
      return isInFuture ? t("daysLater", { count: days }) : t("daysAgo", { count: days });
    } else if (absDiff < MONTH) {
      const weeks = Math.floor(absDiff / WEEK);
      return isInFuture ? t("weeksLater", { count: weeks }) : t("weeksAgo", { count: weeks });
    } else if (absDiff < YEAR) {
      const months = Math.floor(absDiff / MONTH);
      return isInFuture ? t("monthsLater", { count: months }) : t("monthsAgo", { count: months });
    } else {
      const years = Math.floor(absDiff / YEAR);
      return isInFuture ? t("yearsLater", { count: years }) : t("yearsAgo", { count: years });
    }
  } catch (error) {
    log.error("相對時間計算錯誤:", error);
    return "";
  }
};

/**
 * 格式化過期時間顯示
 * @param {string} expiryDateString - 過期時間的 UTC 字串
 * @returns {string} 格式化後的過期時間描述
 */
export const formatExpiry = (expiryDateString) => {
  if (!expiryDateString) return t("neverExpires");

  const expiryDate = parseUTCDate(expiryDateString);
  if (!expiryDate) {
    return t("dateInvalid");
  }

  const now = new Date();

  try {
    // 判斷是否已過期
    if (expiryDate < now) {
      return t("expired");
    }

    // 顯示具體日期和相對時間
    const formattedDate = formatDateTime(expiryDateString);
    const relativeTime = formatRelativeTime(expiryDateString, now);

    return `${formattedDate} (${relativeTime})`;
  } catch (error) {
    log.error("過期時間格式化錯誤:", error);
    return t("dateFormatError");
  }
};

/**
 * 檢查時間是否已過期
 * @param {string} expiryDateString - 過期時間的 UTC 字串
 * @returns {boolean} 是否已過期
 */
export const isExpired = (expiryDateString) => {
  if (!expiryDateString) return false;

  const expiryDate = parseUTCDate(expiryDateString);
  if (!expiryDate) return false;

  return expiryDate < new Date();
};

/**
 * 格式化時間用於顯示"最後重新整理時間"等場景
 * @returns {string} 當前本地時間的簡短格式
 */
export const formatCurrentTime = () => {
  const now = new Date();
  return now.toLocaleTimeString(getUserLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * 獲取當前日期時間的檔名存檔格式
 * 用於壓縮包、複製、匯出等場景
 * 格式: YYYY-MM-DD-HH-mm-ss
 */
export const formatNowForFilename = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
};

/**
 * 將Date/日期字串等轉換為本地化的日期+時間字串(包括秒)
 * @param {Date|string|number} date - Date物件/日期字串/時間戳
 * @returns {string} 格式化的本地日期時間字串
 */
export const formatLocalDateTimeWithSeconds = (date) => {
  if (!date) return t("unknown");

  const parsed = parseUTCDate(date);
  if (!parsed) {
    return t("dateInvalid");
  }

  try {
    return new Intl.DateTimeFormat(getUserLocale(), TIME_FORMAT_OPTIONS.FULL_DATETIME_WITH_SECONDS).format(parsed);
  } catch (error) {
    log.error("日期格式化錯誤:", error, "輸入:", date);
    return t("dateFormatError");
  }
};


// 匯出時間格式選項，供其他元件使用
export { TIME_FORMAT_OPTIONS };
