/**
 * 統一的檔案密碼解析邏輯
 * 優先順序：plain_password > currentPassword > URL引數 > sessionStorage
 * @param {{ file?: any, slug?: string, url?: string }} options
 * @returns {string|null}
 */

import { useSessionStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FilePasswordUtils");

export function getFilePassword(options = {}) {
  const file = options.file || {};
  const slug = options.slug || file.slug;

  if (file.plain_password) {
    return file.plain_password;
  }

  if (file.currentPassword) {
    return file.currentPassword;
  }

  if (typeof window !== "undefined") {
    try {
      const currentUrl = new URL(options.url || window.location.href);
      const passwordParam = currentUrl.searchParams.get("password");
      if (passwordParam) {
        return passwordParam;
      }
    } catch (error) {
      log.warn("解析URL密碼引數失敗:", error);
    }
  }

  if (typeof window !== "undefined" && slug) {
    try {
      const stored = useSessionStorage(`file_password_${slug}`, "");
      return stored.value || null;
    } catch (error) {
      log.warn("從會話儲存獲取密碼失敗:", error);
    }
  }

  return null;
}

/**
 * 統一的檔案密碼寫入邏輯（寫入 sessionStorage）
 * @param {string} slug
 * @param {string} password
 */
export function setFilePassword(slug, password) {
  if (typeof window === "undefined" || !slug) return;
  try {
    const stored = useSessionStorage(`file_password_${slug}`, "");
    stored.value = password || "";
  } catch (error) {
    log.warn("寫入會話儲存密碼失敗:", error);
  }
}
