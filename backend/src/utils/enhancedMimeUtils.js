/**
 * 增強的MIME型別檢測工具
 * 副檔名優先，魔術位元組補充，適配url解析mime的
 */

import { fileTypeFromBuffer } from "file-type";
import { getEffectiveMimeType } from "./fileUtils.js";

/**
 * 從URL獲取檔案內容並檢測MIME型別
 * @param {string} url - 檔案URL
 * @param {string} realFilename - 真實檔名（從資料庫獲取）
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 檢測結果
 */
export async function detectMimeTypeFromUrl(url, realFilename = null, options = {}) {
  const { maxBytes = 4096, timeout = 10000, useFileType = true, abortSignal = null } = options;

  const result = {
    url,
    realFilename,
    detectedMimeType: null,
    filenameMimeType: null,
    finalMimeType: null,
    detectionMethod: null,
    confidence: 0,
    error: null,
  };

  try {
    // 優先使用真實檔名推斷MIME型別
    if (realFilename) {
      result.filenameMimeType = getEffectiveMimeType(null, realFilename);
      result.finalMimeType = result.filenameMimeType;
      result.detectionMethod = "filename";
      result.confidence = 0.9;
    } else {
      // 回退到從URL路徑提取檔名
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split("/").pop() || "";
      if (filename) {
        result.filenameMimeType = getEffectiveMimeType(null, filename);
        result.finalMimeType = result.filenameMimeType;
        result.detectionMethod = "url-filename";
        result.confidence = 0.7;
      }
    }

    // 如果檔名檢測失敗或需要驗證，使用file-type庫
    if (useFileType && (!result.finalMimeType || result.finalMimeType === "application/octet-stream")) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Range: `bytes=0-${maxBytes - 1}`,
            "User-Agent": "CloudHarbor-Backend/1.0",
          },
          signal: abortSignal || AbortSignal.timeout(timeout),
        });

        if (response.ok || response.status === 206) {
          const arrayBuffer = await response.arrayBuffer();
          const fileTypeResult = await fileTypeFromBuffer(arrayBuffer);

          if (fileTypeResult) {
            result.detectedMimeType = fileTypeResult.mime;
            result.finalMimeType = fileTypeResult.mime;
            result.detectionMethod = "file-type";
            result.confidence = 0.85;
          }
        }
      } catch (fetchError) {
        // file-type檢測失敗，保持檔名檢測結果
      }
    }

    // 如果沒有任何檢測結果，使用預設型別
    if (!result.finalMimeType) {
      result.finalMimeType = "application/octet-stream";
      result.detectionMethod = "default";
      result.confidence = 0.1;
    }
  } catch (error) {
    result.error = error.message;
    result.finalMimeType = "application/octet-stream";
    result.detectionMethod = "error";
    result.confidence = 0.1;
  }

  return result;
}

/**
 * 增強的URL後設資料獲取函式
 * @param {string} url - 檔案URL
 * @param {string} realFilename - 真實檔名（可選）
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 後設資料物件
 */
export async function getEnhancedUrlMetadata(url, realFilename = null, options = {}) {
  const { timeout = 10000, enableMimeDetection = true, abortSignal = null } = options;

  const metadata = {
    url,
    filename: "",
    contentType: "application/octet-stream",
    enhancedContentType: null,
    size: null,
    lastModified: null,
    corsSupported: false,
    detectionMethod: [],
    detectionConfidence: 0,
    fileTypeLibraryUsed: false,
    error: null,
  };

  try {
    // 設定檔名
    if (realFilename) {
      metadata.filename = realFilename;
    } else {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      metadata.filename = pathname.split("/").pop() || `file_${Date.now()}`;
    }

    // 獲取基本後設資料（HEAD請求）
    let headSuccess = false;
    try {
      const headResponse = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": "CloudHarbor-Backend/1.0",
        },
        signal: abortSignal || AbortSignal.timeout(timeout),
      });

      if (headResponse.ok) {
        metadata.contentType = headResponse.headers.get("content-type") || "application/octet-stream";
        const contentLength = headResponse.headers.get("content-length");
        metadata.size = contentLength ? parseInt(contentLength) : null;
        metadata.lastModified = headResponse.headers.get("last-modified") || null;
        metadata.corsSupported = true;
        headSuccess = true;
      }
    } catch (headError) {
      // HEAD請求失敗，繼續嘗試其他方法
    }

    // 如果HEAD請求失敗或沒有獲取到檔案大小，嘗試Range請求
    if (!headSuccess || metadata.size === null) {
      try {
        const rangeResponse = await fetch(url, {
          method: "GET",
          headers: {
            Range: "bytes=0-0", // 只請求第一個位元組
            "User-Agent": "CloudHarbor-Backend/1.0",
          },
          signal: abortSignal || AbortSignal.timeout(timeout),
        });

        if (rangeResponse.status === 206) {
          // 支援Range請求，從Content-Range頭獲取總大小
          const contentRange = rangeResponse.headers.get("content-range");
          if (contentRange) {
            // Content-Range: bytes 0-0/1234567
            const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
            if (match) {
              metadata.size = parseInt(match[1]);
            }
          }
        } else if (rangeResponse.ok) {
          // 不支援Range請求，但請求成功，嘗試從Content-Length獲取
          const contentLength = rangeResponse.headers.get("content-length");
          if (contentLength) {
            metadata.size = parseInt(contentLength);
          }

          // 如果還沒有獲取到Content-Type，從這個響應中獲取
          if (!metadata.contentType || metadata.contentType === "application/octet-stream") {
            metadata.contentType = rangeResponse.headers.get("content-type") || "application/octet-stream";
          }
        }
      } catch (rangeError) {
        // Range請求也失敗，嘗試最後的GET請求（只獲取前幾KB）
        try {
          const getResponse = await fetch(url, {
            method: "GET",
            headers: {
              Range: "bytes=0-4095", // 獲取前4KB
              "User-Agent": "CloudHarbor-Backend/1.0",
            },
            signal: abortSignal || AbortSignal.timeout(timeout),
          });

          if (getResponse.ok || getResponse.status === 206) {
            // 從Content-Length或Content-Range獲取大小資訊
            if (getResponse.status === 206) {
              const contentRange = getResponse.headers.get("content-range");
              if (contentRange) {
                const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                if (match) {
                  metadata.size = parseInt(match[1]);
                }
              }
            } else {
              const contentLength = getResponse.headers.get("content-length");
              if (contentLength) {
                metadata.size = parseInt(contentLength);
              }
            }

            // 獲取Content-Type
            if (!metadata.contentType || metadata.contentType === "application/octet-stream") {
              metadata.contentType = getResponse.headers.get("content-type") || "application/octet-stream";
            }
          }
        } catch (getError) {
          // 所有方法都失敗了，保持預設值
        }
      }
    }

    // MIME型別檢測
    if (enableMimeDetection) {
      const mimeResult = await detectMimeTypeFromUrl(url, metadata.filename, options);

      if (mimeResult.finalMimeType && mimeResult.finalMimeType !== "application/octet-stream") {
        metadata.enhancedContentType = mimeResult.finalMimeType;
        metadata.detectionMethod = [mimeResult.detectionMethod];
        metadata.detectionConfidence = mimeResult.confidence;
        metadata.fileTypeLibraryUsed = mimeResult.detectionMethod?.includes("file-type");
      }
    }

    // 如果沒有檢測結果，使用檔名推斷
    if (!metadata.enhancedContentType) {
      metadata.enhancedContentType = getEffectiveMimeType(null, metadata.filename);
      metadata.detectionMethod = ["filename-fallback"];
      metadata.detectionConfidence = 0.6;
    }
  } catch (error) {
    metadata.error = error.message;
  }

  return metadata;
}
