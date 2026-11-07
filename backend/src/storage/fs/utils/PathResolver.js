/**
 * 路徑處理工具
 * 提供基礎的路徑規範化功能
 */

/**
 * 規範化路徑格式
 * @param {string} path - 輸入路徑
 * @param {boolean} isDirectory - 是否為目錄路徑
 * @returns {string} 規範化的路徑
 */
export function normalizePath(path, isDirectory = false) {
  // 確保路徑以斜槓開始
  path = path.startsWith("/") ? path : "/" + path;
  // 如果是目錄，確保路徑以斜槓結束
  if (isDirectory) {
    path = path.endsWith("/") ? path : path + "/";
  }
  return path;
}

/**
 * 判斷 FS 檢視路徑是否表示目錄
 * 約定：以斜槓結尾的路徑視為目錄（包括根路徑）
 * @param {string} path - FS 檢視路徑
 * @returns {boolean}
 */
export function isDirectoryPath(path) {
  return typeof path === "string" && path.endsWith("/");
}

/**
 * 解析複製目標路徑：
 * - 源是檔案且目標是目錄時，自動拼接原始檔名
 * - 其它情況保持原樣
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {string}
 */
export function resolveCopyTargetPath(sourcePath, targetPath) {
  if (isDirectoryPath(sourcePath) || !isDirectoryPath(targetPath)) {
    return targetPath;
  }

  const fileName = getPathBasename(sourcePath);
  if (!fileName) {
    return targetPath;
  }

  const targetDir = normalizePath(targetPath, true);
  return `${targetDir}${fileName}`;
}

function getPathBasename(path) {
  const normalized = String(path || "").replace(/\\\\/g, "/");
  const trimmed = normalized.replace(/\/+$/g, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

/**
 * 判斷目標路徑是否為源路徑本身或其子路徑
 * - 統一處理 / 與 \\ 分隔符，並去除首尾多餘分隔符
 * - 僅用於邏輯判斷，不訪問底層儲存
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isSelfOrSubPath(sourcePath, targetPath) {
  const normalize = (p) =>
    (p || "")
      .replace(/^[/\\]+|[/\\]+$/g, "")
      .replace(/[\\\/]+/g, "/");

  const srcNorm = normalize(sourcePath);
  const dstNorm = normalize(targetPath);

  if (!srcNorm) return false;
  return dstNorm === srcNorm || (dstNorm && dstNorm.startsWith(`${srcNorm}/`));
}
