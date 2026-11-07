/**
 * FS 輸入校驗工具
 *
 */

const INVALID_FILENAME_CHARS = /[\/\\?<>*:|"]/;

/**
 * 規範化 FS 檢視路徑（用於比較/拆分，不直接用於儲存訪問）
 * - 把 \\ 視為分隔符，統一換成 /
 * - 合併重複 /
 * - 確保以 / 開頭
 * - 非根去掉末尾 /
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeFsViewPath(input) {
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);
  let p = raw.replace(/\\+/g, "/");
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p === "/") return "/";
  p = p.replace(/\/+$/g, "");
  return p || "/";
}

/**
 * 獲取路徑的父目錄（返回值以 / 結尾，根目錄返回 /）
 * @param {string} input
 * @returns {string}
 */
export function getParentDir(input) {
  const p = normalizeFsViewPath(input);
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx + 1);
}

/**
 * 獲取路徑最後一段名稱（basename）
 * @param {string} input
 * @returns {string}
 */
export function getBasename(input) {
  const p = normalizeFsViewPath(input);
  if (p === "/") return "";
  return p.slice(p.lastIndexOf("/") + 1);
}

/**
 * 校驗“檔案/目錄名稱”是否合法（不是路徑）
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateFsItemName(input) {
  const name = typeof input === "string" ? input.trim() : input == null ? "" : String(input).trim();

  if (!name) {
    return { valid: false, message: "名稱不能為空" };
  }

  if (name === "." || name === "..") {
    return { valid: false, message: "名稱不能是 . 或 .." };
  }

  if (INVALID_FILENAME_CHARS.test(name)) {
    return { valid: false, message: "名稱包含非法字元（/ \\\\ ? < > * : | \")" };
  }

  return { valid: true, value: name };
}

/**
 * 校驗重新命名：必須在同一目錄內修改最後一段名稱
 * @param {unknown} oldPath
 * @param {unknown} newPath
 * @returns {{ valid: true } | { valid: false, message: string }}
 */
export function validateRenameSameDirectory(oldPath, newPath) {
  const oldParent = getParentDir(oldPath);
  const newParent = getParentDir(newPath);

  if (oldParent !== newParent) {
    return {
      valid: false,
      message: "重新命名只允許修改名稱，不支援輸入路徑層級（包含 / 或 \\\\ 會被當成目錄分隔符）",
    };
  }

  const newName = getBasename(newPath);
  const nameValidation = validateFsItemName(newName);
  if (!nameValidation.valid) {
    return nameValidation;
  }

  return { valid: true };
}

/**
 * 校驗目錄路徑：逐段檢查每個 segment 是否為合法 name
 * - 允許多級目錄（例如 /a/b/c/）
 * - 只要某一段 name 不合法，就返回失敗
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateDirectoryPathSegments(input) {
  const normalized = normalizeFsViewPath(input);
  if (normalized === "/") return { valid: true, value: "/" };

  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    const r = validateFsItemName(segment);
    if (!r.valid) return r;
  }
  return { valid: true, value: normalized };
}
