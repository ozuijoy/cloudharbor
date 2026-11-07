/**
 * FS 路徑工具
 *
 * - 系統內部只認 `/` 作為路徑分隔符
 * - 反斜槓 `\\` 被視為“分隔符”，會被統一替換為 `/`
 * - 合併重複的 `//`
 * - 根路徑固定為 `/`
 * - “檢視路徑”統一為方案 1：`/a/b`（非根不保留末尾 `/`）
 * - 呼叫“目錄類 API”時，才補尾巴 `/`
 *
 */

/**
 * 規範化“檢視路徑”
 * @param {unknown} input
 * @returns {string}
 */
export const normalizeFsPath = (input) => {
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);

  // 1) 把 Windows 風格路徑分隔符統一成 /
  let p = raw.replace(/\\+/g, "/");

  // 2) 空值兜底
  if (!p) return "/";

  // 3) 確保以 / 開頭
  if (!p.startsWith("/")) p = `/${p}`;

  // 4) 合併重複 /
  p = p.replace(/\/{2,}/g, "/");

  // 5) 根路徑固定為 /
  if (p === "/") return "/";

  // 6) 非根路徑：去掉末尾 /
  p = p.replace(/\/+$/g, "");

  return p || "/";
};

/**
 * 目錄 API 路徑：在檢視路徑基礎上確保目錄以 `/` 結尾
 * @param {unknown} input
 * @returns {string}
 */
export const toDirApiPath = (input) => {
  const normalized = normalizeFsPath(input);
  if (normalized === "/") return "/";
  return `${normalized}/`;
};

/**
 * 判斷 target 是否等於 ancestor，或在 ancestor 之下
 * - ancestor 為 `/` 時永遠 true
 * @param {unknown} ancestor
 * @param {unknown} target
 * @returns {boolean}
 */
export const isSameOrSubPath = (ancestor, target) => {
  const base = normalizeFsPath(ancestor);
  const cur = normalizeFsPath(target);
  if (base === "/") return true;
  return cur === base || cur.startsWith(`${base}/`);
};

const INVALID_FS_NAME_CHARS = /[\/\\?<>*:|"]/;

/**
 * 校驗檔案/資料夾“名稱”（不是路徑）
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export const validateFsItemName = (input) => {
  const name = typeof input === "string" ? input.trim() : input == null ? "" : String(input).trim();

  if (!name) {
    return { valid: false, message: "EMPTY" };
  }

  if (name === "." || name === "..") {
    return { valid: false, message: "DOTS" };
  }

  if (INVALID_FS_NAME_CHARS.test(name)) {
    return { valid: false, message: "CHARS" };
  }

  return { valid: true, value: name };
};

/**
 * 生成給 InputDialog 用的 validator
 * - InputDialog 約定：validator 返回 true 表示透過；返回 string 表示錯誤提示
 * - 這裡把 validateFsItemName 的錯誤碼對映成 i18n 文案
 *
 * @param {(key: string, params?: any) => string} t
 * @returns {(value: unknown) => true | string}
 */
export const createFsItemNameDialogValidator = (t) => {
  return (value) => {
    const result = validateFsItemName(value);
    if (result.valid) return true;

    const translate = typeof t === "function" ? t : (key) => String(key);
    switch (result.message) {
      case "EMPTY":
        return translate("common.dialogs.invalidNameEmpty");
      case "DOTS":
        return translate("common.dialogs.invalidNameDots");
      case "CHARS":
        return translate("common.dialogs.invalidNameChars");
      default:
        return translate("common.dialogs.invalidInput");
    }
  };
};
