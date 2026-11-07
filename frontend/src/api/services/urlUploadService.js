/**
 * URL上傳服務API
 * 負責處理URL驗證、元資訊獲取和上傳邏輯的前端API介面
 * 支援桌面端和移動端使用，包括分片上傳功能
 */

import { post } from "../client";
import { getFullApiUrl } from "../config";
import { completeFileUpload } from "./fileService";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("UrlUpload");

/**
 * 驗證URL並獲取檔案元資訊
 * @param {string} url - 要驗證的URL
 * @returns {Promise<Object>} 包含檔案元資訊的響應
 */
export async function validateUrlInfo(url) {
  return await post("share/url/info", { url });
}

/**
 * 獲取URL代理地址（用於處理不支援CORS的資源）
 * @param {string} url - 原始URL
 * @returns {string} 代理URL
 */
export function getProxyUrl(url) {
  const params = new URLSearchParams({ url });
  return getFullApiUrl(`share/url/proxy?${params.toString()}`);
}

/**
 * 檢查錯誤是否是跨域(CORS)錯誤
 * @param {Error} error - 捕獲到的錯誤物件
 * @returns {boolean} - 是否是跨域錯誤
 */
function isCorsError(error) {
  // 典型的CORS錯誤特徵
  if (error.name === "NetworkError") return true;
  if (error.message.includes("CORS")) return true;
  if (error.message.includes("cross-origin")) return true;
  if (error.message.includes("access-control-allow-origin")) return true;
  if (error.message.includes("NetworkError")) return true;
  // XMLHttpRequest的錯誤檢測
  // 通常CORS錯誤會導致狀態為0和空statusText
  if (error.xhr && error.xhr.status === 0 && error.xhr.statusText === "") return true;

  return false;
}

/**
 * 通用的URL內容獲取函式
 * 先嚐試直接獲取URL內容，如果出現CORS錯誤或其他網路錯誤，則切換到使用代理URL
 * @param {Object} options - 獲取選項
 * @param {string} options.url - 要獲取的URL
 * @param {Function} [options.onProgress] - 進度回撥，引數為(progress, loaded, total, phase)
 * @param {Function} [options.setXhr] - 設定xhr引用的回撥函式，用於取消請求
 * @param {string} [options.statusText] - 可選的自定義狀態文字
 * @returns {Promise<Blob>} 獲取到的內容Blob
 */
export async function fetchUrlContent(options) {
  // 首先嚐試直接獲取URL內容
  try {
    log.debug(`嘗試直接獲取URL: ${options.url}`);
    return await fetchFromUrl(options.url, options.onProgress, options.setXhr, "directDownload");
  } catch (error) {
    // 使用者主動取消下載時，直接丟擲錯誤，不嘗試代理重試
    if (error.message === "下載已取消") {
      throw error;
    }

    log.warn(`直接獲取URL內容失敗: ${error.message}`);

    // 檢查是否是CORS錯誤或其他網路錯誤，如果是則嘗試使用代理
    if (isCorsError(error) || error.message.includes("獲取URL內容失敗")) {
      log.debug(`檢測到跨域問題，切換到代理模式獲取URL: ${options.url}`);
      // 使用代理URL重試
      const proxyUrl = getProxyUrl(options.url);
      return await fetchFromUrl(proxyUrl, options.onProgress, options.setXhr, "proxyDownload");
    }

    // 其他錯誤則直接丟擲
    throw error;
  }
}

/**
 * 內部輔助函式：從指定URL獲取內容
 * @param {string} url - 要獲取的URL
 * @param {Function} [onProgress] - 進度回撥函式
 * @param {Function} [setXhr] - 設定xhr引用的回撥函式
 * @param {string} [phaseType] - 下載階段型別
 * @returns {Promise<Blob>} 獲取到的內容Blob
 * @private
 */
function fetchFromUrl(url, onProgress, setXhr, phaseType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";

    // 如果提供了setXhr回撥，則傳遞xhr引用
    if (setXhr) {
      setXhr(xhr);
    }

    // 進度事件
    xhr.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // 下載進度從 0% 到 100%
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress, event.loaded, event.total, "downloading", phaseType);
      }
    };

    xhr.onerror = () => {
      // 將xhr新增到錯誤物件，方便檢測CORS錯誤
      const error = new Error("獲取URL內容失敗");
      error.xhr = xhr;
      reject(error);
    };

    xhr.onabort = () => {
      reject(new Error("下載已取消"));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        reject(new Error(`獲取URL內容失敗: HTTP ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.send();
  });
}


