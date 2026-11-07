/* eslint-disable no-console */
/**
 * 統一前端日誌工具
 *
 * 預設不刷屏：debug/info 需要“開開關”才會輸出
 * warn/error 永遠輸出
 *
 * 開關規則：
 * 1) 執行時（推薦，隨時開關）：瀏覽器控制檯執行：
 *    - 開啟全部除錯：localStorage.setItem('cloudharbor_debug', '1')
 *    - 關閉：        localStorage.removeItem('cloudharbor_debug')
 * 2) 構建時（需要重新構建）：Vite 環境變數 `VITE_DEBUG`
 *    - VITE_DEBUG=1        → 開啟全部除錯
 *
 */

const DEBUG_KEY = "cloudharbor_debug";

const readEnvDebugValue = () => {
  try {
    return String(import.meta?.env?.VITE_DEBUG || "").trim();
  } catch {
    return "";
  }
};

const readLocalDebugValue = () => {
  try {
    if (typeof window === "undefined") return "";
    return String(window.localStorage?.getItem(DEBUG_KEY) || "").trim();
  } catch {
    return "";
  }
};

const readDebugValue = () => {
  // localStorage 優先（執行時隨時可改），env 兜底（構建時決定）
  const local = readLocalDebugValue();
  if (local) return local;
  return readEnvDebugValue();
};

const isAllDebugValue = (raw) => {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "all" || v === "yes" || v === "on";
};

/**
 * 是否開啟“全域性除錯輸出”
 *
 * - localStorage: cloudharbor_debug=1
 * - env: VITE_DEBUG=1
 */
export function isDebugEnabled() {
  const raw = readDebugValue();
  if (!raw) return false;
  if (isAllDebugValue(raw)) return true;
  return false;
}

const normalizePrefix = (prefix) => {
  const raw = String(prefix || "").trim();
  if (!raw) return "";
  if (raw.startsWith("[") && raw.endsWith("]")) return raw;
  return `[${raw}]`;
};

/**
 * 建立一個“帶字首的 logger”
 * @param {string} prefix - 控制檯字首，比如 "API" / "Router" / "Upload"
 */
export function createLogger(prefix) {
  const tag = normalizePrefix(prefix || "log");

  const debug = (...args) => {
    if (!isDebugEnabled()) return;
    console.debug(tag, ...args);
  };

  const info = (...args) => {
    if (!isDebugEnabled()) return;
    console.info(tag, ...args);
  };

  const warn = (...args) => {
    console.warn(tag, ...args);
  };

  const error = (...args) => {
    console.error(tag, ...args);
  };

  return { debug, info, warn, error };
}
