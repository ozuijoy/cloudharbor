/**
 * WebDAV響應頭統一管理工具
 */

import { getWebDAVConfig } from "../auth/config/WebDAVConfig.js";

/**
 * 獲取標準WebDAV響應頭
 * 統一管理所有WebDAV相關的響應頭設定
 * @param {Object} options - 頭部選項
 * @param {boolean} options.includeCORS - 是否包含CORS頭部（預設true）
 * @param {boolean} options.includeDAV - 是否包含DAV頭部（預設true）
 * @param {boolean} options.includeAllow - 是否包含Allow頭部（預設true）
 * @param {Object} options.customHeaders - 自定義頭部
 * @returns {Object} 標準化的WebDAV響應頭物件
 */
export function getStandardWebDAVHeaders(options = {}) {
  const { includeCORS = true, includeDAV = true, includeAllow = true, customHeaders = {} } = options;

  const config = getWebDAVConfig();
  const headers = {};

  // 基礎WebDAV協議頭部
  if (includeDAV) {
    headers.DAV = config.HEADERS.DAV;
    headers["MS-Author-Via"] = config.HEADERS["MS-Author-Via"];
  }

  // 允許的方法頭部
  if (includeAllow) {
    headers.Allow = config.METHODS.join(", ");
    headers.Public = config.METHODS.join(", ");
  }

  // CORS頭部
  if (includeCORS) {
    headers["Access-Control-Allow-Origin"] = config.HEADERS["Access-Control-Allow-Origin"];
    headers["Access-Control-Allow-Methods"] = config.HEADERS["Access-Control-Allow-Methods"];
    headers["Access-Control-Allow-Headers"] = config.HEADERS["Access-Control-Allow-Headers"];
    headers["Access-Control-Expose-Headers"] = config.HEADERS["Access-Control-Expose-Headers"];
    headers["Access-Control-Max-Age"] = config.HEADERS["Access-Control-Max-Age"];
  }

  // 合併自定義頭部
  Object.assign(headers, customHeaders);

  return headers;
}

/**
 * 為Response物件新增標準WebDAV頭部
 * @param {Response} response - 原始響應物件
 * @param {Object} options - 頭部選項（同getStandardWebDAVHeaders）
 * @returns {Response} 新增了WebDAV頭部的新響應物件
 */
export function addWebDAVHeaders(response, options = {}) {
  const webdavHeaders = getStandardWebDAVHeaders(options);
  const res = response;

  // 只新增還沒有的響應頭，避免覆蓋已有的頭部
  for (const [key, value] of Object.entries(webdavHeaders)) {
    if (!res.headers.has(key)) {
      res.headers.set(key, value);
    }
  }

  return res;
}

/**
 * 獲取WebDAV錯誤響應頭
 * 專門用於錯誤響應的頭部設定
 * @param {string} contentType - 內容型別（預設text/plain）
 * @returns {Object} 錯誤響應頭物件
 */
export function getWebDAVErrorHeaders(contentType = "text/plain") {
  return getStandardWebDAVHeaders({
    customHeaders: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/**
 * 獲取WebDAV Multi-Status響應頭
 * 專門用於207 Multi-Status響應的頭部設定
 * @returns {Object} Multi-Status響應頭物件
 */
export function getWebDAVMultiStatusHeaders() {
  return getStandardWebDAVHeaders({
    customHeaders: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

/**
 * 為Express響應設定WebDAV頭部
 * 專門用於Express中介軟體的頭部設定
 * @param {Object} res - Express響應物件
 * @param {Object} options - 頭部選項
 */
export function setExpressWebDAVHeaders(res, options = {}) {
  const webdavHeaders = getStandardWebDAVHeaders(options);

  for (const [key, value] of Object.entries(webdavHeaders)) {
    res.setHeader(key, value);
  }
}
