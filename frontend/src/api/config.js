/**
 * API統一配置檔案
 * 管理API請求的基礎URL和其他配置
 * 支援本地開發、生產和Docker部署環境
 */

import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

// 預設的開發環境API基礎URL
const DEFAULT_DEV_API_URL = "http://localhost:8787";
const log = createLogger("ApiConfig");

// 檢查是否在Docker環境中執行
const isDockerEnvironment = () => {
  return import.meta.env.VITE_IS_DOCKER === "true";
};

// 統一規範化後端 Base URL：
// - 去掉首尾空白
// - 去掉結尾多餘的 `/`，避免拼出 `https://host//api/...`（部分反向代理不會合併雙斜線，
//   會直接 404，表現為「部署後上傳/請求全部失敗」）
function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

// 優先從全域性配置讀取，然後根據環境選擇不同的回退策略
function getApiBaseUrl() {
  // 首先檢查執行時配置 (window.appConfig) - 所有環境通用
  if (typeof window !== "undefined" && window.appConfig && window.appConfig.backendUrl) {
    const runtimeUrl = normalizeBaseUrl(window.appConfig.backendUrl);
    // 統一使用__BACKEND_URL__作為佔位符，避免不同環境處理邏輯不一致
    if (runtimeUrl && runtimeUrl !== "__" + "BACKEND_URL__") {
      log.debug("使用執行時配置的後端URL:", runtimeUrl);
      return runtimeUrl;
    }
  }

  // 非Docker環境下才檢查localStorage
  if (!isDockerEnvironment() && typeof window !== "undefined" && window.localStorage) {
    const storedUrl = normalizeBaseUrl(useLocalStorage("vite-api-base-url", "").value);
    if (storedUrl) {
      log.debug("非Docker環境：使用localStorage中的後端URL:", storedUrl);
      return storedUrl;
    }
  }

  // 所有環境都檢查環境變數
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);
  if (envUrl) {
    return envUrl;
  }

  // 生產環境：單 Worker 部署時使用同源（Cloudflare Workers SPA 模式）
  if (import.meta.env.PROD && typeof window !== "undefined") {
    log.debug("生產環境：使用同源後端", window.location.origin);
    return window.location.origin;
  }

  // 最後使用預設值
  return DEFAULT_DEV_API_URL;
}

// 獲取API基礎URL
export const API_BASE_URL = getApiBaseUrl();

// API版本字首，與後端保持一致
export const API_PREFIX = "/api";

// 完整的API基礎URL（包含字首）
export const getFullApiUrl = (endpoint) => {
  // 如果endpoint已經包含了完整URL，則直接返回
  if (endpoint.startsWith("http")) {
    return endpoint;
  }

  // 確保endpoint以/開頭
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // 新增API字首
  return `${API_BASE_URL}${API_PREFIX}${normalizedEndpoint}`;
};

// 匯出環境資訊方法，便於除錯
export const getEnvironmentInfo = () => {
  return {
    apiBaseUrl: API_BASE_URL,
    apiPrefix: API_PREFIX,
    mode: import.meta.env.MODE,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    backendUrl: window?.appConfig?.backendUrl || import.meta.env.VITE_BACKEND_URL,
    isDockerBuild: isDockerEnvironment(),
  };
};
