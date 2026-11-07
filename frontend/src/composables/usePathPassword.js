/**
 * 路徑密碼管理 Composable
 * 負責密碼驗證 token 的儲存和管理
 */

import { ref, reactive } from "vue";
import { useSessionStorage } from "@vueuse/core";
import { normalizeFsPath } from "@/utils/fsPathUtils.js";
import { createLogger } from "@/utils/logger.js";

const STORAGE_KEY = "fs_path_tokens_v1";
const log = createLogger("PathPassword");

// 全域性密碼 token 儲存（按規範化路徑儲存）
const pathTokens = reactive(new Map());

// sessionStorage 持久化
const storedTokens = typeof window === "undefined" ? ref({}) : useSessionStorage(STORAGE_KEY, {});

const loadTokensFromStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const data = storedTokens.value;
    if (!data || typeof data !== "object") return;
    Object.entries(data).forEach(([path, token]) => {
      if (typeof path === "string" && typeof token === "string" && token) {
        const normalized = normalizeFsPath(path);
        pathTokens.set(normalized, token);
      }
    });
  } catch (error) {
    log.warn("恢復路徑密碼 token 失敗，將僅使用記憶體儲存:", error);
  }
};

const persistTokensToStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const obj = {};
    pathTokens.forEach((token, path) => {
      if (typeof token === "string" && token) {
        obj[path] = token;
      }
    });
    storedTokens.value = obj;
  } catch (error) {
    log.warn("持久化路徑密碼 token 失敗:", error);
  }
};

// 初始化時從 sessionStorage 恢復一次
loadTokensFromStorage();

// 當前正在驗證的路徑
const pendingPath = ref(null);

// 是否正在顯示密碼彈窗
const showPasswordDialog = ref(false);

export function usePathPassword() {
  /**
   * 檢查路徑是否已驗證
   * @param {string} path - 路徑
   * @returns {boolean}
   */
  const hasPathToken = (path) => {
    const normalized = normalizeFsPath(path);
    // 從當前路徑向上查詢最近的有 token 的 ownerPath
    let current = normalized;
    while (true) {
      if (pathTokens.has(current)) {
        return true;
      }
      if (current === "/") {
        break;
      }
      const segments = current.split("/").filter(Boolean);
      if (segments.length === 0) {
        current = "/";
      } else {
        segments.pop();
        current = segments.length > 0 ? `/${segments.join("/")}` : "/";
      }
    }
    return false;
  };

  /**
   * 獲取路徑的驗證 token
   * @param {string} path - 路徑
   * @returns {string|null}
   */
  const getPathToken = (path) => {
    const normalized = normalizeFsPath(path);
    // 優先使用距離當前路徑最近的密碼域 token
    let current = normalized;
    while (true) {
      const token = pathTokens.get(current);
      if (token) {
        return token;
      }
      if (current === "/") {
        break;
      }
      const segments = current.split("/").filter(Boolean);
      if (segments.length === 0) {
        current = "/";
      } else {
        segments.pop();
        current = segments.length > 0 ? `/${segments.join("/")}` : "/";
      }
    }
    return null;
  };

  /**
   * 獲取全部路徑密碼 token（用於搜尋等需要彙總的場景）
   * @returns {string[]}
   */
  const getAllPathTokens = () => {
    const tokens = [];
    pathTokens.forEach((token) => {
      if (typeof token === "string" && token) {
        tokens.push(token);
      }
    });
    return tokens;
  };

  /**
   * 儲存路徑驗證 token
   * @param {string} path - 路徑
   * @param {string} token - 驗證token
   */
  const savePathToken = (path, token) => {
    const normalized = normalizeFsPath(path);
    pathTokens.set(normalized, token);
    // 注意：不要把 token 內容打到控制檯（可能被截圖/上報），只記錄長度用於排查
    log.debug("儲存路徑密碼token", { path: normalized, tokenLength: String(token || "").length });
    persistTokensToStorage();
  };

  /**
   * 移除路徑驗證 token
   * @param {string} path - 路徑
   */
  const removePathToken = (path) => {
    pathTokens.delete(normalizeFsPath(path));
    persistTokensToStorage();
  };

  /**
   * 清除所有驗證 token
   */
  const clearAllTokens = () => {
    pathTokens.clear();
    persistTokensToStorage();
  };

  /**
   * 設定待驗證路徑
   * @param {string} path - 路徑
   */
  const setPendingPath = (path) => {
    pendingPath.value = normalizeFsPath(path);
  };

  /**
   * 清除待驗證路徑
   */
  const clearPendingPath = () => {
    pendingPath.value = null;
  };

  /**
   * 顯示密碼彈窗
   */
  const openPasswordDialog = () => {
    showPasswordDialog.value = true;
  };

  /**
   * 關閉密碼彈窗
   */
  const closePasswordDialog = () => {
    showPasswordDialog.value = false;
  };

  /**
   * 請求路徑密碼驗證
   * @param {string} path - 需要驗證的路徑
   */
  const requestPasswordVerification = (path) => {
    setPendingPath(path);
    openPasswordDialog();
  };

  return {
    // 狀態
    pendingPath,
    showPasswordDialog,

    // Token 管理
    hasPathToken,
    getPathToken,
    getAllPathTokens,
    savePathToken,
    removePathToken,
    clearAllTokens,

    // 彈窗控制
    setPendingPath,
    clearPendingPath,
    openPasswordDialog,
    closePasswordDialog,
    requestPasswordVerification,
  };
}
