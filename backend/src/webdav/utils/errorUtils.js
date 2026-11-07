/**
 * WebDAV錯誤處理工具函式
 * 提供統一的錯誤日誌記錄和響應建立功能
 */

import { getWebDAVErrorHeaders } from "./headerUtils.js";

/**
 * 生成唯一錯誤ID
 * @returns {string} 錯誤ID
 */
export function generateErrorId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * 轉義XML特殊字元，確保生成有效的XML
 * @param {string} text - 需要轉義的文字
 * @returns {string} 轉義後的文字
 */
function escapeXmlChars(text) {
  if (typeof text !== "string") return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * 獲取HTTP狀態碼對應的文字描述
 * @param {number} statusCode - HTTP狀態碼
 * @returns {string} 狀態描述文字
 */
function getStatusText(statusCode) {
  const statusTexts = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    412: "Precondition Failed",
    415: "Unsupported Media Type",
    423: "Locked",
    500: "Internal Server Error",
    501: "Not Implemented",
    507: "Insufficient Storage",
  };

  return statusTexts[statusCode] || "Unknown Status";
}

/**
 * 建立標準WebDAV XML錯誤響應
 * @param {string} message - 錯誤訊息
 * @param {number} status - HTTP狀態碼
 * @returns {Response} 符合WebDAV標準的XML錯誤響應
 */
export function createStandardWebDAVErrorResponse(message, status) {
  // 轉義錯誤訊息中的XML特殊字元
  const escapedMessage = escapeXmlChars(message);
  const statusText = getStatusText(status);

  // 構建符合WebDAV標準的XML錯誤響應
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:error xmlns:D="DAV:">
  <D:status>HTTP/1.1 ${status} ${statusText}</D:status>
  <D:message>${escapedMessage}</D:message>
</D:error>`;

  const headers = getWebDAVErrorHeaders("application/xml; charset=utf-8");

  return new Response(xml, {
    status: status,
    headers: headers,
  });
}

/**
 * 記錄WebDAV操作錯誤並建立統一的錯誤響應
 * @param {string} operation - 操作名稱，如 "GET", "PUT" 等
 * @param {Error} error - 錯誤物件
 * @param {boolean} [includeDetails=false] - 是否在響應中包含錯誤詳細資訊（僅用於開發環境）
 * @param {boolean} [useXmlResponse=true] - 是否使用XML格式的錯誤響應
 * @returns {Response} 格式化的錯誤響應
 */
export function handleWebDAVError(operation, error, includeDetails = false, useXmlResponse = true) {
  // 生成唯一錯誤ID
  const errorId = generateErrorId();

  // 記錄錯誤資訊
  console.error(`WebDAV ${operation} 操作錯誤 [${errorId}]:`, error);

  if (error.status && typeof error.status === "number") {
    const statusCode = error.status;
    const message = error.message || `${operation}操作失敗`;

    return useXmlResponse
      ? createStandardWebDAVErrorResponse(message, statusCode)
      : new Response(message, {
          status: statusCode,
          headers: getWebDAVErrorHeaders("text/plain"),
        });
  }

  // 特殊處理S3的404錯誤
  if (error.$metadata && error.$metadata.httpStatusCode === 404) {
    return useXmlResponse
      ? createStandardWebDAVErrorResponse("檔案或目錄不存在", 404)
      : new Response("檔案或目錄不存在", {
          status: 404,
          headers: getWebDAVErrorHeaders("text/plain"),
        });
  }

  // 建立安全的錯誤響應
  const errorMessage = includeDetails ? `內部伺服器錯誤: ${error.message} (錯誤ID: ${errorId})` : `內部伺服器錯誤 (錯誤ID: ${errorId})`;

  return useXmlResponse
    ? createStandardWebDAVErrorResponse(errorMessage, 500)
    : new Response(errorMessage, {
        status: 500,
        headers: getWebDAVErrorHeaders("text/plain"),
      });
}

export async function withWebDAVErrorHandling(operation, handler, { includeDetails = false, useXmlResponse = true } = {}) {
  try {
    return await handler();
  } catch (error) {
    return handleWebDAVError(operation, error, includeDetails, useXmlResponse);
  }
}

/**
 * 建立WebDAV錯誤響應
 * @param {string} message - 錯誤訊息
 * @param {number} status - HTTP狀態碼
 * @param {boolean} [useXmlResponse=true] - 是否使用XML格式的錯誤響應
 * @returns {Response} 錯誤響應
 */
export function createWebDAVErrorResponse(message, status, useXmlResponse = true) {
  return useXmlResponse
    ? createStandardWebDAVErrorResponse(message, status)
    : new Response(message, {
        status,
        headers: getWebDAVErrorHeaders("text/plain"),
      });
}
