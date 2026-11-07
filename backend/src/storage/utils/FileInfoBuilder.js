import { FILE_TYPES, FILE_TYPE_NAMES } from "../../constants/index.js";

/**
 * FileInfo 構造工具
 *
 * - 為所有儲存驅動提供統一的 FileInfo 構造邏輯
 * - 避免在各個驅動內部重複實現 name/type/typeName/mimetype 等細節
 * - 僅關注“掛載檢視下的檔案/目錄資訊”這一領域模型
 */

/**
 * 基於通用後設資料構造 FileInfo
 * @param {Object} params
 * @param {string} params.fsPath        掛載檢視下的完整路徑（例如 /s3/docs/file.txt）
 * @param {string} [params.name]        檔名（可選，不傳則從 fsPath 中推導）
 * @param {boolean} params.isDirectory  是否為目錄
 * @param {number|null|undefined} [params.size]           大小（位元組）；未知請傳 null/undefined（不要偽造 0）
 * @param {Date|string|null|undefined} [params.modified]   最後修改時間；未知請傳 null/undefined（不要偽造當前時間）
 * @param {string|null|undefined} [params.mimetype]        MIME 型別（檔案時可選）
 * @param {Object|null|undefined} [params.mount]           掛載物件
 * @param {string|null|undefined} [params.storageType]     儲存型別（優先顯式傳入，其次 mount.storage_type）
 * @param {D1Database|null|undefined} [params.db]          資料庫例項，用於型別推斷
 * @returns {Promise<Object>} 標準 FileInfo 物件
 */
export async function buildFileInfo({
  fsPath,
  name,
  isDirectory,
  size,
  modified,
  mimetype,
  mount,
  storageType,
  db,
}) {
  const finalName = name || inferNameFromPath(fsPath, isDirectory);

  // 動態 import，避免在模組載入階段引入大串依賴（觸發迴圈依賴：StorageFactory <-> fileTypeDetector/PreviewSettingsCache）
  let type = FILE_TYPES.UNKNOWN;
  let typeName = FILE_TYPE_NAMES[FILE_TYPES.UNKNOWN];
  if (isDirectory) {
    type = FILE_TYPES.FOLDER;
    typeName = FILE_TYPE_NAMES[FILE_TYPES.FOLDER];
  } else {
    try {
      const { GetFileType, getFileTypeName } = await import("../../utils/fileTypeDetector.js");
      type = await GetFileType(finalName, db);
      typeName = await getFileTypeName(finalName, db);
    } catch (error) {
      // 失敗時回退 unknown
      console.warn("buildFileInfo: 檔案型別檢測載入失敗，已回退 unknown", error);
      type = FILE_TYPES.UNKNOWN;
      typeName = FILE_TYPE_NAMES[FILE_TYPES.UNKNOWN];
    }
  }

  // - 目錄大小：儲存無法直接給出“資料夾總大小”，未知就保持 null，顯示 “-”。
  // - 檔案大小：若儲存未給出也保持 null
  const finalSize = typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null;

  let finalModified;
  if (modified instanceof Date) {
    finalModified = modified.toISOString();
  } else if (typeof modified === "string") {
    finalModified = modified;
  } else if (modified && typeof modified.toISOString === "function") {
    finalModified = modified.toISOString();
  } else {
    // 不要偽造“當前時間”，未知就保持 null
    finalModified = null;
  }

  const finalMimetype = isDirectory
    ? "application/x-directory"
    : mimetype || null;

  return {
    path: fsPath,
    name: finalName,
    isDirectory,
    size: finalSize,
    modified: finalModified,
    mimetype: finalMimetype,
    mount_id: mount?.id ?? null,
    storage_type: storageType || mount?.storage_type || null,
    type,
    typeName,
  };
}

/**
 * 根據掛載檢視路徑推導名稱
 * - 對目錄：若路徑以 / 結尾則去除尾部 / 再取最後一段
 * - 對根路徑：返回 "" 或 "root" 由呼叫方控制（此處僅兜底）
 * @param {string} fsPath
 * @param {boolean} isDirectory
 * @returns {string}
 */
export function inferNameFromPath(fsPath, isDirectory) {
  if (!fsPath || typeof fsPath !== "string") {
    return isDirectory ? "" : "file";
  }

  let normalized = fsPath;
  if (isDirectory && normalized.endsWith("/")) {
    normalized = normalized.replace(/\/+$/, "");
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return isDirectory ? "" : "file";
  }
  return segments[segments.length - 1];
}

export default {
  buildFileInfo,
  inferNameFromPath,
};
