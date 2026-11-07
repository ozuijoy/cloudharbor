/**
 * 文字預覽公共邏輯 Composable
 */

import { ref } from "vue";
import { useFetchText } from "./useFetchText.js";
import { useCodeHighlight } from "./useCodeHighlight.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 文字預覽公共邏輯
 * @param {Object} options - 配置選項
 * @param {boolean} options.checkCancelled - 是否檢查取消狀態
 * @param {boolean} options.emitEncodingChange - 是否觸發編碼變化事件
 * @returns {Object} 文字預覽相關的狀態和方法
 */
export function useTextPreview(options = {}) {
  const log = createLogger("TextPreview");
  const {
    checkCancelled = false,
    emitEncodingChange = false,
  } = options;

  // 統一的狀態管理
  const textContent = ref("");
  const detectedLanguage = ref("");
  const currentEncoding = ref("utf-8");
  const loading = ref(false);
  const error = ref(null);

  // 統一的 composable 使用
  const { fetchText, reDecodeWithEncoding } = useFetchText();
  const { detectLanguageFromFilename } = useCodeHighlight();

  /**
   * 統一的文字載入邏輯
   * @param {Object} fileData - 檔案資料物件
   * @param {Function} emitFn - emit 函式
   * @returns {Promise<Object>} 載入結果
   */
  const loadTextContent = async (fileData, emitFn) => {
    // 解析/預覽嚴格依賴同源內容 URL（contentUrl），不再退回外部預覽/下載入口
    const effectiveUrl = fileData?.contentUrl;
    if (!effectiveUrl) {
      log.error("檔案資料缺少 contentUrl，無法進行文字載入:", fileData);
      return { success: false, error: "缺少可用的內容預覽 URL（contentUrl）" };
    }

    try {
      loading.value = true;
      error.value = null;

      const url = effectiveUrl;
      // 一次拉取原始位元組後複用 rawBuffer，編碼切換僅做本地 TextDecoder 解碼
      const result = await fetchText(url, fileData, { keepRawBuffer: true });

      if (result.success) {
        textContent.value = result.text;
        currentEncoding.value = result.encoding || "utf-8";
        
        // 檢測語言
        const filename = fileData.name || "";
        detectedLanguage.value = detectLanguageFromFilename(filename);

        log.debug("文字載入成功:", {
          encoding: result.encoding,
          textLength: result.text.length,
          filename: filename,
        });

        emitFn?.("load", result);
        return { success: true, result };
      } else {
        // 支援可選的 cancelled 檢查
        if (!result.cancelled || !checkCancelled) {
          emitFn?.("error", result.error);
        }
        return { success: false, error: result.error };
      }
    } catch (err) {
      log.error("載入文字內容失敗:", err);
      error.value = err.message;
      emitFn?.("error", err.message);
      return { success: false, error: err.message };
    } finally {
      loading.value = false;
    }
  };

  /**
   * 統一的編碼切換邏輯
   * @param {string} encoding - 新編碼
   * @param {Function} emitFn - emit 函式
   * @returns {Promise<Object>} 切換結果
   */
  const handleEncodingChange = async (encoding, emitFn) => {
    try {
      loading.value = true;
      error.value = null;

      const result = await reDecodeWithEncoding(encoding);
      
      if (result.success) {
        textContent.value = result.text;
        currentEncoding.value = encoding;

        log.debug("編碼切換成功:", {
          encoding: encoding,
          textLength: result.text.length,
        });

        // 支援可選的編碼變化事件
        if (emitEncodingChange) {
          emitFn?.("encoding-change", encoding);
        }
        
        return { success: true };
      } else {
        log.error("編碼切換失敗:", result.error);
        error.value = result.error;
        emitFn?.("error", result.error);
        return { success: false, error: result.error };
      }
    } catch (err) {
      log.error("編碼切換失敗:", err);
      error.value = err.message;
      emitFn?.("error", err.message);
      return { success: false, error: err.message };
    } finally {
      loading.value = false;
    }
  };

  /**
   * 重置狀態
   */
  const reset = () => {
    textContent.value = "";
    detectedLanguage.value = "";
    currentEncoding.value = "utf-8";
    loading.value = false;
    error.value = null;
  };

  return {
    // 狀態
    textContent,
    detectedLanguage,
    currentEncoding,
    loading,
    error,
    
    // 方法
    loadTextContent,
    handleEncodingChange,
    reset,
  };
}
