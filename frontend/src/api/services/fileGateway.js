import * as fileService from "./fileService.js";
import { getFilePassword } from "@/utils/filePasswordUtils.js";

function normalizeListResponse(response, limit, offset) {
  const payload = response?.data ?? response?.files ?? response;
  const files = Array.isArray(payload?.files) ? payload.files : Array.isArray(payload) ? payload : [];
  const rawPagination = payload?.pagination;
  const pagination = rawPagination
    ? {
        total: rawPagination.total ?? files.length,
        limit: rawPagination.limit ?? limit,
        offset: rawPagination.offset ?? offset,
        hasMore: rawPagination.hasMore ?? rawPagination.has_more ?? false,
      }
    : { total: files.length, limit, offset, hasMore: false };
  return { files, pagination };
}

/**
 * 檢查URL是否為檔案分享代理URL
 * @param {string} url - 要檢查的URL
 * @returns {{ isFileShare: boolean, type?: "preview"|"download", slug?: string, password?: string|null, mode?: "inline"|"attachment" }}
 */
function parseFileShareUrl(url) {
  if (!url) return { isFileShare: false };

  // Share 文字內容口：/api/share/content/:slug
  // 相容：/api/share/content/:slug 以及 /api/share/content/:slug/:filename
  const contentMatch = url.match(/\/api\/share\/content\/([^/?#]+)(?:\/[^?]*)?/);
  if (contentMatch) {
    const slug = contentMatch[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    return {
      isFileShare: true,
      type: "preview",
      slug,
      password,
      mode: "inline",
    };
  }

  // Share 本地代理入口：/api/s/:slug
  // 相容：/api/s/:slug 以及 /api/s/:slug/:filename
  const legacyMatch = url.match(/\/api\/s\/([^/?#]+)(?:\/[^?]*)?/);
  if (legacyMatch) {
    const slug = legacyMatch[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    const down = urlObj.searchParams.get("down");
    const mode = urlObj.searchParams.get("mode") || "inline";
    const isDownload =
      (down && down !== "0" && down !== "false") ||
      mode === "attachment" ||
      mode === "download";

    return {
      isFileShare: true,
      type: isDownload ? "download" : "preview",
      slug,
      password,
      mode: isDownload ? "attachment" : "inline",
    };
  }

  return { isFileShare: false };
}

function ensurePasswordInUrl(url, password, file) {
  if (!url || !password) return url || "";

  // 僅對 share 同源路由（/api/share/content/:slug 或 /api/s/:slug）追加密碼
  // 以及標記為 use_proxy 的檔案，避免汙染直鏈/CDN URL
  const shareInfo = parseFileShareUrl(url);
  const isProxy = shareInfo.isFileShare || file?.use_proxy;

  if (!isProxy) return url;
  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

function resolvePassword(file, explicitPassword) {
  if (explicitPassword !== undefined) return explicitPassword;
  return getFilePassword({ file });
}

export async function listSharedFiles(limit = 50, offset = 0, options = {}) {
  const response = await fileService.getFiles(limit, offset, options);
  if (!response?.success) {
    throw new Error(response?.message || "載入檔案列表失敗");
  }
  return normalizeListResponse(response, limit, offset);
}

export async function getSharedFileById(id, options = {}) {
  const response = await fileService.getFile(id, options);
  if (!response?.success) {
    throw new Error(response?.message || "獲取檔案詳情失敗");
  }
  return response.data;
}

export async function getSharedFileBySlug(slug) {
  const response = await fileService.getPublicFile(slug);
  if (!response?.success) {
    throw new Error(response?.message || "獲取檔案詳情失敗");
  }
  return response.data;
}

export function buildPreviewUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  // 預覽統一基於 Link JSON 的 previewUrl（已由後端決策為 inline 語義入口）
  let url = file.previewUrl || "";

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

/**
 * 構建“內容訪問” URL（用於文字類預覽 / 編碼檢測）
 * - 語義：始終透過 share 內容路由 /api/share/content/:slug 訪問（同源），避免直鏈 CORS
 * - 與 buildPreviewUrl 的區別：buildPreviewUrl 更偏向“外部預覽入口”（新視窗/嵌入），這裡專注於同源內容訪問
 * @param {FileshareItem} file
 * @param {{ password?: string }} [options]
 * @returns {string}
 */
export function buildContentUrl(file, options = {}) {
  if (!file || !file.slug) return "";
  const password = resolvePassword(file, options.password);

  // 文字/編碼檢測專用同源內容口
  let url = `/api/share/content/${file.slug}`;

  // 僅在檔案分享場景或 use_proxy=1 時追加密碼引數
  url = ensurePasswordInUrl(url, password, file);

  return url;
}

export function buildDownloadUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  // 下載統一基於 Link JSON 的 downloadUrl
  let url = file.downloadUrl || "";

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

export async function getOfficePreviewUrl(file, options = {}) {
  const preview = file?.previewSelection;

  // 未提供 previewSelection 或不支援預覽時直接返回 null
  const providers = preview?.providers || {};
  if (!preview || !Object.keys(providers).length) {
    return null;
  }

  const returnAll = options.returnAll || false;

  if (!returnAll) {
    // 預設使用 providers 中的 microsoft 作為推薦入口
    return providers.microsoft || null;
  }

  // 返回所有可用的預覽 URL（如果服務端提供了 providers）
  return {
    directUrl: buildPreviewUrl(file, options) || null,
    microsoft: providers.microsoft || "",
    google: providers.google || "",
  };
}

export function parseShareUrl(url) {
  return parseFileShareUrl(url);
}

export function addPasswordToUrl(url, password) {
  if (!url || !password) return url;

  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

export function getFileErrorKey(statusCode) {
  switch (statusCode) {
    case 401:
      return "fileView.errors.unauthorized";
    case 403:
      return "fileView.errors.forbidden";
    case 404:
      return "fileView.errors.notFound";
    case 410:
      return "fileView.errors.forbidden";
    default:
      return "fileView.errors.serverError";
  }
}
