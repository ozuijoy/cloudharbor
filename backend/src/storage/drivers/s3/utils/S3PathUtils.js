import path from "node:path";

/**
 * S3路徑處理工具
 * 提供S3儲存驅動專用的路徑規範化功能
 */

/**
 * 規範化S3子路徑
 * @param {string} subPath - 子路徑
 * @param {boolean} asDirectory - 是否作為目錄處理
 * @returns {string} 規範化的S3子路徑
 */
export function normalizeS3SubPath(subPath, asDirectory = false) {
  // 規範化S3子路徑，移除開頭的斜槓
  const __raw = subPath == null ? "" : String(subPath);
  let s3SubPath = __raw.startsWith("/") ? __raw.substring(1) : __raw;

  // 如果路徑為空，設定為根路徑
  if (!s3SubPath) {
    s3SubPath = "";
  }

  // 規範化S3子路徑，移除多餘的斜槓
  s3SubPath = s3SubPath.replace(/\/+/g, "/");

  // 如果作為目錄處理，確保路徑以斜槓結尾
  if (asDirectory && s3SubPath !== "" && !s3SubPath.endsWith("/")) {
    s3SubPath += "/";
  }

  // 注意：root_prefix在呼叫時單獨處理，避免重複新增
  // 在getS3DirectoryListing中會將s3SubPath與root_prefix組合

  return s3SubPath;
}

/**
 * 智慧檢查路徑是否已經是完整的檔案路徑
 * @param {string} s3SubPath - S3子路徑
 * @param {string} originalFileName - 原始檔名
 * @returns {boolean} 是否為完整檔案路徑
 */
export function isCompleteFilePath(s3SubPath, originalFileName) {
  if (!s3SubPath || !originalFileName) return false;

  const pathInfo = path.parse(s3SubPath);
  const originalInfo = path.parse(originalFileName);

  // 檢查是否有副檔名（區分檔案和目錄）
  if (!pathInfo.ext) {
    // 無副檔名情況：檢查是否為原始檔名或帶隨機字尾的版本
    return pathInfo.base === originalFileName || pathInfo.base.startsWith(originalFileName + "-");
  }

  // 有副檔名情況：檢查副檔名匹配 + 檔名模式
  if (pathInfo.ext === originalInfo.ext) {
    // 檢查檔名是否匹配或者是帶隨機字尾的版本（如 black-abc123）
    return pathInfo.name === originalInfo.name || pathInfo.name.startsWith(originalInfo.name + "-");
  }

  return false;
}

/**
 * 組合 S3 物件 Key（目錄字首 + 檔名）。
 * - 相容：subPath 可能已經是完整檔案路徑（例如 share upload / ObjectStore 等場景）
 * - 相容：subPath 可能帶前導 /（統一去掉，保持 AWS SDK Key 習慣）
 * @param {string} s3SubPath
 * @param {string} originalFileName
 * @returns {string}
 */
export function resolveS3ObjectKey(s3SubPath, originalFileName) {
  const raw = s3SubPath == null ? "" : String(s3SubPath);
  let base = raw.startsWith("/") ? raw.slice(1) : raw;
  base = base.replace(/\/+/g, "/");

  const safeNameRaw = originalFileName == null ? "" : String(originalFileName);
  const safeName = safeNameRaw.replace(/^\/+/, "");
  if (!safeName) return base;

  if (base && isCompleteFilePath(base, safeName)) {
    return base;
  }
  if (base && !base.endsWith("/")) {
    return `${base}/${safeName}`;
  }
  return `${base || ""}${safeName}`;
}

/**
 * 檢查S3子路徑是否為掛載點根目錄（空字串）
 * @param {string} s3SubPath - S3子路徑
 * @returns {boolean} 是否為掛載點根目錄
 */
export function isMountRootPath(s3SubPath) {
  return !s3SubPath || s3SubPath.trim() === "";
}

/**
 * 規範化 S3 的 root_prefix
 * - 去掉前導 /
 * - 合併重複 /
 * - 非空時確保以 / 結尾
 * @param {unknown} rootPrefix
 * @returns {string}
 */
export function normalizeS3RootPrefix(rootPrefix) {
  const raw = String(rootPrefix || "").trim();
  if (!raw) return "";
  let p = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return "";
  return p.endsWith("/") ? p : `${p}/`;
}

/**
 * 把“掛載內的相對路徑”對映到“真實 S3 Key”（包含 root_prefix）
 * - 如果 key 已經包含 root_prefix，則不重複新增
 * - 相容 key 為空（代表掛載根目錄）
 * @param {Object} s3ConfigOrDriverConfig
 * @param {string} key
 * @returns {string}
 */
export function applyS3RootPrefix(s3ConfigOrDriverConfig, key) {
  const prefix = normalizeS3RootPrefix(s3ConfigOrDriverConfig?.root_prefix);
  const raw = key == null ? "" : String(key);
  const normalizedKey = raw.replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");

  if (!prefix) return normalizedKey;
  if (!normalizedKey) return prefix;
  if (normalizedKey.startsWith(prefix)) return normalizedKey;
  return `${prefix}${normalizedKey}`.replace(/\/+/g, "/");
}
