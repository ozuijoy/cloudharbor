/**
 * WebDAV工具函式
 */

import { stripPrefix } from "../auth/config/WebDAVConfig.js";
import { AppError, ValidationError } from "../../http/errors.js";

/**
 * 統一路徑處理函式
 * @param {string} rawPath - 原始路徑
 * @param {boolean} throwOnError - 是否在錯誤時丟擲異常
 * @returns {string} 處理後的路徑
 */
export function processWebDAVPath(rawPath, throwOnError = false) {
  try {
    // URL解碼
    const decodedPath = decodeURIComponent(rawPath);

    // 安全檢查1：路徑遍歷防護
    if (decodedPath.includes("..")) {
      const message = `WebDAV安全警告: 檢測到路徑遍歷攻擊嘗試: ${decodedPath}`;
      console.warn(message);
      if (throwOnError) {
        throw new ValidationError("Path traversal detected");
      }
      return null;
    }

    // 安全檢查2：空位元組注入防護
    if (decodedPath.includes("\0")) {
      const message = `WebDAV安全警告: 檢測到空位元組注入嘗試: ${decodedPath}`;
      console.warn(message);
      if (throwOnError) {
        throw new ValidationError("Invalid path characters");
      }
      return null;
    }

    // 使用統一的stripPrefix函式處理WebDAV路徑字首
    let processedPath = stripPrefix(decodedPath);

    // 規範化路徑，移除多餘的斜槓
    processedPath = processedPath.replace(/\/+/g, "/");

    // 確保路徑以斜槓開始
    if (!processedPath.startsWith("/")) {
      processedPath = "/" + processedPath;
    }

    return processedPath;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const message = `WebDAV路徑解碼失敗: ${error.message}`;
    console.warn(message);
    if (throwOnError) {
      throw new ValidationError("Invalid path encoding");
    }
    return null;
  }
}

/**
 * 解析目標路徑
 * WebDAV特有功能：處理WebDAV的Destination頭
 * @param {string} destination - 目標路徑頭
 * @returns {string|null} 規範化的目標路徑或null（如果無效）
 */
export function parseDestinationPath(destination) {
  if (!destination) {
    return null;
  }

  let destPath;
  try {
    // 嘗試從完整URL中提取路徑
    const url = new URL(destination);
    destPath = url.pathname;
  } catch (error) {
    // 如果不是完整URL，直接使用值作為路徑
    destPath = destination;
  }

  // 使用統一的路徑處理函式
  return processWebDAVPath(destPath, false);
}
