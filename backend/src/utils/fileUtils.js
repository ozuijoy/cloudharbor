/**
 * 檔案處理工具
 * 基於mime-types標準庫和可配置的預覽設定
 */

import mime from "mime-types";

/**
 * 獲取副檔名
 * @param {string} filename - 檔名
 * @returns {string} 副檔名
 */
export function getFileExtension(filename) {
  if (!filename) return "";
  return filename.split(".").pop().toLowerCase();
}

/**
 * 獲取有效的MIME型別
 * @param {string} mimetype - 傳入的MIME型別
 * @param {string} filename - 檔名
 * @returns {string} 有效的MIME型別
 */
export function getEffectiveMimeType(mimetype, filename) {
  if (mimetype && mimetype !== "application/octet-stream" && mimetype !== "unknown/unknown" && mimetype !== "" && mimetype !== "undefined") {
    console.log(`getEffectiveMimeType: 使用傳入MIME型別 "${mimetype}" (檔案: ${filename || "N/A"})`);
    return mimetype;
  }
  const detectedMime = mime.lookup(filename) || "application/octet-stream";
  console.log(`getEffectiveMimeType: 從檔名 "${filename}" 推斷MIME型別 -> "${detectedMime}"`);
  return detectedMime;
}

/**
 * 獲取響應的Content-Type
 * @param {string} filename - 檔名
 * @param {string} mimetype - MIME型別
 * @param {Object} options - 選項
 * @returns {Object} Content-Type和Content-Disposition
 */
export function getContentTypeAndDisposition(filename, mimetype, options = {}) {
  const { forceDownload = false } = options;
  const contentType = getEffectiveMimeType(mimetype, filename);

  if (forceDownload) {
    return {
      contentType,
      contentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    };
  }

  return {
    contentType,
    contentDisposition: `inline; filename="${encodeURIComponent(filename)}"`,
  };
}

/**
 * 從檔名推斷MIME型別（相容性函式）
 * @param {string} filename - 檔名
 * @returns {string} MIME型別
 */
export function getMimeTypeFromFilename(filename) {
  return getEffectiveMimeType(null, filename);
}

/**
 * 檢查是否為Office檔案（相容性函式）
 * @param {string} mimeType - MIME型別
 * @param {string} filename - 檔名（忽略）
 * @returns {boolean}
 */
export function isOfficeFile(mimeType, filename = "") {
  const officeMimeTypes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/msword",
  ];
  const isOffice = officeMimeTypes.includes(mimeType);
  console.log(`isOfficeFile: "${mimeType}" (檔案: ${filename || "N/A"}) -> ${isOffice ? "✅ Office檔案" : "❌ 非Office檔案"}`);
  return isOffice;
}

/**
 * 檢查是否為文件檔案（可直接預覽）
 * @param {string} mimeType - MIME型別
 * @param {string} filename - 檔名（忽略）
 * @returns {boolean}
 */
export function isDocumentFile(mimeType, filename = "") {
  const documentMimeTypes = ["application/pdf"];
  const isDocument = documentMimeTypes.includes(mimeType);
  console.log(`isDocumentFile: "${mimeType}" (檔案: ${filename || "N/A"}) -> ${isDocument ? "✅ 文件檔案" : "❌ 非文件檔案"}`);
  return isDocument;
}

// 匯出標準庫（便於直接使用）
export { mime };
