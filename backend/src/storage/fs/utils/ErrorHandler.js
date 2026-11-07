/**
 * 檔案系統錯誤處理工具
 * 提供統一的錯誤處理和包裝機制
 */

import { DriverError, AppError } from "../../../http/errors.js";

/**
 * 通用錯誤處理包裝函式
 * 用於統一處理檔案系統操作中的錯誤，簡化程式碼重複
 * @param {Function} fn - 要執行的非同步函式
 * @param {string} operationName - 操作名稱，用於錯誤日誌
 * @param {string} defaultErrorMessage - 預設錯誤訊息
 * @returns {Promise<any>} - 函式執行結果
 * @throws {DriverError} - 統一處理後的驅動異常
 */
export async function handleFsError(fn, operationName, defaultErrorMessage) {
  try {
    return await fn();
  } catch (error) {
    console.error(`${operationName}錯誤:`, error);

    // 如果已經是規範化錯誤，直接丟擲
    if (error instanceof AppError) {
      console.log(`[ErrorHandler] 錯誤已經是AppError，直接丟擲 - Code: ${error.code}, Status: ${error.status}, Message: ${error.message}`);
      throw error;
    }

    // 新增詳細的錯誤轉換日誌
    console.error(`[ErrorHandler] 轉換原始錯誤為DriverError:`);
    console.error(`[ErrorHandler] 原始錯誤型別: ${error.constructor.name}`);
    console.error(`[ErrorHandler] 原始錯誤訊息: ${error.message}`);
    console.error(`[ErrorHandler] 使用訊息: ${error.message || defaultErrorMessage}`);

    // 其他錯誤轉換為統一的 DriverError
    throw new DriverError(error.message || defaultErrorMessage, { expose: false, details: { cause: error?.message, operationName } });
  }
}
