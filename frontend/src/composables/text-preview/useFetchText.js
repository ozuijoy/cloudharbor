/**
 * 文字獲取和編碼處理 Composable
 * 提供文字檔案的獲取、編碼檢測和解碼功能
 */

import { ref, computed, onUnmounted } from "vue";
import { useEncodingDetection } from "./useEncodingDetection.js";
import { SUPPORTED_ENCODINGS, decodeText, fetchAndDecodeText, isBinaryContent, cleanText, getTextStats } from "@/utils/textUtils.js";
import { createLogger } from "@/utils/logger.js";

export function useFetchText() {
  const log = createLogger("FetchText");
  //非同步操作取消機制
  let currentAbortController = null;

  // 狀態
  const loading = ref(false);
  const error = ref(null);
  const textContent = ref("");
  const rawBuffer = ref(null);
  const fileInfo = ref(null);
  // 使用 computed 快取文字統計，避免重複計算
  const textStats = computed(() => {
    return textContent.value ? getTextStats(textContent.value) : null;
  });

  // 使用編碼檢測
  const { selectedEncoding, detectionResult, hasDetectionResult, selectEncoding, resetDetection, detectEncoding, availableEncodings } = useEncodingDetection();

  // 計算屬性
  const hasContent = computed(() => !!textContent.value);
  const isTextValid = computed(() => hasContent.value && !error.value);
  const isBinary = computed(() => {
    return textContent.value ? isBinaryContent(textContent.value) : false;
  });

  /**
   * 取消當前的非同步操作
   */
  const cancelCurrentOperation = () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  };

  /**
   * 清理原始緩衝區以釋放記憶體
   */
  const clearRawBuffer = () => {
    if (rawBuffer.value) {
      rawBuffer.value = null;
    }
  };

  /**
   * 獲取檔案並自動檢測編碼
   * @param {string} url - 檔案URL
   * @param {Object} fileData - 檔案資訊
   * @param {Object} options - 選項
   * @returns {Promise<Object>} 獲取結果
   */
  const fetchText = async (url, fileData = null, options = {}) => {
    if (!url) {
      throw new Error("URL不能為空");
    }

    // 記憶體管理：檢查檔案大小限制
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (fileData?.size && fileData.size > MAX_FILE_SIZE) {
      throw new Error(`檔案過大 (${(fileData.size / 1024 / 1024).toFixed(1)}MB)，最大支援 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    //取消之前的操作（如果有的話）
    if (currentAbortController) {
      currentAbortController.abort();
    }

    //建立新的 AbortController
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      loading.value = true;
      error.value = null;

      // 儲存檔案資訊
      fileInfo.value = fileData;

      // 首先檢測編碼（傳遞 signal 用於取消）
      const filename = fileData?.name || fileData?.filename || "";
      const detectionResult = await detectEncoding(url, filename, {
        ...options,
        signal, // 傳遞取消訊號
      });

      // 檢查是否已被取消
      if (signal.aborted) {
        throw new Error("操作已取消");
      }

      if (detectionResult.success) {
        log.debug("編碼自動檢測成功:", {
          檔名: filename,
          檢測編碼: detectionResult.encoding,
          可信度: `${detectionResult.confidence}%`,
          檢測方法: detectionResult.method || "智慧檢測",
          所有候選: detectionResult.allResults?.slice(0, 3).map((r) => `${r.encoding}(${r.confidence}%)`) || [],
          檔案大小: detectionResult.fullFileSize ? `${(detectionResult.fullFileSize / 1024).toFixed(1)}KB` : "未知",
        });
      } else {
        log.warn(" 編碼檢測失敗，使用預設編碼 utf-8:", detectionResult.error);
      }

      // 如果編碼檢測已經返回了完整的原始資料，直接使用
      let fetchResult;
      if (detectionResult.success && detectionResult.rawBuffer) {
        // 使用編碼檢測時已下載的資料，避免重複下載
        const encoding = detectionResult.encoding || "utf-8";
        const decodeResult = await decodeText(detectionResult.rawBuffer, encoding);

        fetchResult = {
          ...decodeResult,
          fileSize: detectionResult.fullFileSize || detectionResult.rawBuffer.byteLength,
          rawBuffer: detectionResult.rawBuffer,
          url,
        };
      } else {
        // 降級：使用原有的下載方式
        const encoding = detectionResult.encoding || "utf-8";
        fetchResult = await fetchAndDecodeText(url, encoding, {
          ...options,
          signal, // 傳遞取消訊號
        });
      }

      if (fetchResult.success) {
        textContent.value = cleanText(fetchResult.text, {
          removeNullBytes: true,
          normalizeLineEndings: true,
          maxLength: options.maxLength,
        });

        // 儲存原始資料供編碼切換使用
        rawBuffer.value = fetchResult.rawBuffer;

        // 記憶體管理：如果不需要重新編碼功能，延遲清理 rawBuffer
        if (!options.keepRawBuffer) {
          setTimeout(clearRawBuffer, 2000); // 2秒後清理，確保其他操作完成
        }

        // textStats 透過 computed 自動計算，無需手動賦值

        return {
          success: true,
          text: textContent.value,
          encoding: fetchResult.encoding,
          stats: textStats.value,
          fileSize: fetchResult.fileSize,
        };
      } else {
        throw new Error(fetchResult.error || "文字獲取失敗");
      }
    } catch (err) {
      // 如果是取消操作，不記錄為錯誤
      if (err.name === "AbortError" || err.message === "操作已取消") {
        log.debug("文字獲取操作已取消");
        return {
          success: false,
          text: "",
          encoding: "utf-8",
          stats: null,
          fileSize: 0,
          error: "操作已取消",
          cancelled: true,
        };
      }

      log.error("獲取文字失敗:", err);
      error.value = err.message;

      return {
        success: false,
        text: "",
        encoding: "utf-8",
        stats: null,
        fileSize: 0,
        error: err.message,
      };
    } finally {
      loading.value = false;
      //條件清理 AbortController
      currentAbortController = null;
    }
  };

  /**
   * 使用指定編碼重新解碼文字
   * @param {string} encoding - 編碼格式
   * @returns {Promise<Object>} 解碼結果
   */
  const reDecodeWithEncoding = async (encoding) => {
    if (!rawBuffer.value) {
      // 如果沒有原始資料，嚴格依賴內容 URL（contentUrl）重新獲取一次原始資料
      const info = fileInfo.value;
      const retryUrl = info && info.contentUrl;

      if (!retryUrl) {
        throw new Error("沒有可用的內容 URL（contentUrl）用於重新解碼");
      }

      const retryResult = await fetchText(retryUrl, info, { keepRawBuffer: true });
      if (!retryResult.success) {
        throw new Error(retryResult.error || "重新獲取檔案內容失敗");
      }
    }

    try {
      loading.value = true;
      error.value = null;

      // 選擇新編碼
      selectEncoding(encoding);

      // 重新解碼
      const decodeResult = await decodeText(rawBuffer.value, encoding);

      if (decodeResult.success) {
        textContent.value = cleanText(decodeResult.text, {
          removeNullBytes: true,
          normalizeLineEndings: true,
        });

        return {
          success: true,
          text: textContent.value,
          encoding: decodeResult.encoding,
          stats: textStats.value,
        };
      } else {
        throw new Error(decodeResult.error || "重新解碼失敗");
      }
    } catch (err) {
      log.error("重新解碼失敗:", err);
      error.value = err.message;

      return {
        success: false,
        text: textContent.value, // 保持原有內容
        encoding: selectedEncoding.value,
        stats: textStats.value,
        error: err.message,
      };
    } finally {
      loading.value = false;
    }
  };

  /**
   * 檢測編碼並解碼文字
   * @param {string} filename - 檔名（用於編碼提示）
   */
  const detectAndDecodeText = async (filename) => {
    if (!rawBuffer.value) {
      throw new Error("沒有原始資料");
    }

    try {
      // 使用簡單的編碼檢測（因為我們已經有了二進位制資料）
      const detection = { encoding: "utf-8", confidence: 1.0 };
      detectionResult.value = detection;

      // 使用檢測到的編碼解碼
      const encoding = detection.encoding || "utf-8";
      selectEncoding(encoding);
      await decodeWithEncoding(encoding);
    } catch (err) {
      log.error("編碼檢測失敗:", err, "檔案:", filename);
      // 降級到UTF-8
      selectEncoding("utf-8");
      await decodeWithEncoding("utf-8");
    }
  };

  /**
   * 使用指定編碼解碼
   * @param {string} encoding - 編碼格式
   */
  const decodeWithEncoding = async (encoding) => {
    if (!rawBuffer.value) {
      throw new Error("沒有原始資料");
    }

    const decodeResult = await decodeText(rawBuffer.value, encoding);

    if (decodeResult.success) {
      textContent.value = cleanText(decodeResult.text);
    } else {
      throw new Error(decodeResult.error || "解碼失敗");
    }
  };

  /**
   * 重置狀態
   */
  const reset = () => {
    // 取消當前操作
    cancelCurrentOperation();

    // 清理所有狀態
    loading.value = false;
    error.value = null;
    textContent.value = "";
    rawBuffer.value = null;
    fileInfo.value = null;
    resetDetection();
  };

  /**
   * 獲取支援的編碼列表
   */
  const getSupportedEncodings = () => {
    return SUPPORTED_ENCODINGS;
  };

  /**
   * 檢查編碼是否支援
   * @param {string} encoding - 編碼格式
   */
  const isEncodingSupported = (encoding) => {
    return SUPPORTED_ENCODINGS.some((enc) => enc.value === encoding);
  };

  // 元件銷燬時清理資源
  onUnmounted(() => {
    cancelCurrentOperation();
  });

  return {
    // 狀態
    loading,
    error,
    textContent,
    rawBuffer,
    fileInfo,
    textStats,
    selectedEncoding,
    detectionResult,
    hasDetectionResult,

    // 計算屬性
    hasContent,
    isTextValid,
    isBinary,
    availableEncodings,

    // 方法
    fetchText,
    reDecodeWithEncoding,
    reset,
    getSupportedEncodings,
    isEncodingSupported,
    cancelCurrentOperation,
    clearRawBuffer, // 記憶體管理

    // 內部方法（供高階使用者使用）
    detectAndDecodeText,
    decodeWithEncoding,
  };
}
