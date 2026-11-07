/**
 * 文字編碼處理工具
 * 提供文字解碼、編碼轉換等功能
 */

import { SUPPORTED_ENCODINGS, normalizeEncoding } from "./encodingDetector.js";
import { fetchFileBinaryWithAuth } from "@/api/services/fileDownloadService.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("TextUtils");

/**
 * 使用指定編碼解碼二進位制資料為文字
 * @param {ArrayBuffer|Uint8Array} buffer - 二進位制資料
 * @param {string} encoding - 編碼格式
 * @returns {Promise<string>} 解碼後的文字
 */
export async function decodeText(buffer, encoding = "utf-8") {
  try {
    // 確保是Uint8Array
    const uint8Array = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

    // 標準化編碼名稱
    const normalizedEncoding = normalizeEncoding(encoding);

    // 使用TextDecoder進行解碼
    const decoder = new TextDecoder(normalizedEncoding, {
      fatal: false, // 不丟擲錯誤，用替換字元
      ignoreBOM: false, // 保留BOM
    });

    const text = decoder.decode(uint8Array);

    // 檢查解碼結果是否包含過多替換字元
    const replacementCharCount = (text.match(/\uFFFD/g) || []).length;
    const replacementRatio = replacementCharCount / text.length;

    // 如果替換字元比例過高，可能編碼不正確
    if (replacementRatio > 0.1) {
      log.warn(`編碼 ${encoding} 解碼質量較差，替換字元比例: ${(replacementRatio * 100).toFixed(2)}%`);
    }

    return {
      success: true,
      text,
      encoding: normalizedEncoding,
      replacementCharCount,
      replacementRatio,
      error: null,
    };
  } catch (error) {
    log.error(`使用編碼 ${encoding} 解碼失敗:`, error);

    // 嘗試使用UTF-8作為後備
    if (encoding !== "utf-8") {
      log.debug("嘗試使用UTF-8後備編碼...");
      return await decodeText(buffer, "utf-8");
    }

    return {
      success: false,
      text: "",
      encoding,
      replacementCharCount: 0,
      replacementRatio: 0,
      error: error.message,
    };
  }
}

/**
 * 從URL獲取檔案並使用指定編碼解碼
 * @param {string} url - 檔案URL
 * @param {string} encoding - 編碼格式
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 解碼結果
 */
export async function fetchAndDecodeText(url, encoding = "utf-8", options = {}) {
  const { timeout = 30000, maxSize = 10 * 1024 * 1024, signal } = options; // 預設最大10MB

  try {
    // 透過統一的帶鑑權工具獲取二進位制資料
    const { buffer, size } = await fetchFileBinaryWithAuth(url, {
      signal,
      timeout,
      maxSize,
    });

    // 解碼文字
    const decodeResult = await decodeText(buffer, encoding);

    return {
      ...decodeResult,
      fileSize: size,
      rawBuffer: buffer,
      url,
    };
  } catch (error) {
    log.error("獲取和解碼檔案失敗:", error);

    return {
      success: false,
      text: "",
      encoding,
      replacementCharCount: 0,
      replacementRatio: 0,
      fileSize: 0,
      url,
      error: error.message,
    };
  }
}

/**
 * 檢測文字是否可能是二進位制檔案
 * @param {string} text - 文字內容
 * @param {number} threshold - 二進位制字元閾值，預設0.3
 * @returns {boolean} 是否可能是二進位制檔案
 */
export function isBinaryContent(text, threshold = 0.3) {
  if (!text || text.length === 0) return false;

  let binaryCharCount = 0;
  const sampleSize = Math.min(text.length, 1000); // 只檢查前1000個字元

  for (let i = 0; i < sampleSize; i++) {
    const charCode = text.charCodeAt(i);

    // 檢查是否為控制字元（除了常見的換行、製表符等）
    if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
      binaryCharCount++;
    }

    // 檢查是否為替換字元
    if (charCode === 0xfffd) {
      binaryCharCount++;
    }
  }

  const binaryRatio = binaryCharCount / sampleSize;
  return binaryRatio > threshold;
}

/**
 * 清理文字內容，移除或替換問題字元
 * @param {string} text - 原始文字
 * @param {Object} options - 清理選項
 * @returns {string} 清理後的文字
 */
export function cleanText(text, options = {}) {
  const { removeNullBytes = true, normalizeLineEndings = true, removeReplacementChars = false, maxLength = null } = options;

  let cleanedText = text;

  // 移除空位元組
  if (removeNullBytes) {
    cleanedText = cleanedText.replace(/\0/g, "");
  }

  // 標準化行結束符
  if (normalizeLineEndings) {
    cleanedText = cleanedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  // 移除替換字元
  if (removeReplacementChars) {
    cleanedText = cleanedText.replace(/\uFFFD/g, "");
  }

  // 限制長度
  if (maxLength && cleanedText.length > maxLength) {
    cleanedText = cleanedText.substring(0, maxLength) + "\n\n... (內容已截斷)";
  }

  return cleanedText;
}

/**
 * 獲取文字統計資訊
 * @param {string} text - 文字內容
 * @returns {Object} 統計資訊
 */
export function getTextStats(text) {
  if (!text) {
    return {
      length: 0,
      lines: 0,
      words: 0,
      characters: 0,
      bytes: 0,
      encoding: null,
    };
  }

  const lines = text.split("\n").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.length;
  const bytes = new TextEncoder().encode(text).length;

  return {
    length: characters,
    lines,
    words,
    characters,
    bytes,
    encoding: "utf-8", // 記憶體中的字串總是UTF-8
  };
}

/**
 * 檢測文字的主要語言
 * @param {string} text - 文字內容
 * @returns {string} 語言程式碼
 */
export function detectTextLanguage(text) {
  if (!text || text.length < 10) return "unknown";

  const sample = text.substring(0, 1000); // 只檢查前1000個字元

  // 中文檢測
  if (/[\u4e00-\u9fff]/.test(sample)) {
    return "zh";
  }

  // 日文檢測
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) {
    return "ja";
  }

  // 韓文檢測
  if (/[\uac00-\ud7af]/.test(sample)) {
    return "ko";
  }

  // 俄文檢測
  if (/[\u0400-\u04ff]/.test(sample)) {
    return "ru";
  }

  // 阿拉伯文檢測
  if (/[\u0600-\u06ff]/.test(sample)) {
    return "ar";
  }

  // 預設為英文或其他拉丁字母語言
  return "en";
}

/**
 * 匯出支援的編碼列表
 */
export { SUPPORTED_ENCODINGS };

/**
 * 預覽模式常量
 */
export const PREVIEW_MODES = {
  TEXT: "text", // 純文字預覽
  CODE: "code", // 程式碼語法高亮
  MARKDOWN: "markdown", // Markdown渲染
  HTML: "html", // HTML渲染
  EDIT: "edit", // 編輯模式
};

/**
 * 根據副檔名推測預覽模式
 * @param {string} filename - 檔名
 * @returns {string} 預覽模式
 */
export function getPreviewModeFromFilename(filename) {
  if (!filename) return PREVIEW_MODES.TEXT;

  const ext = filename.split(".").pop()?.toLowerCase();

  // Markdown檔案
  if (["md", "markdown", "mdown", "mkd"].includes(ext)) {
    return PREVIEW_MODES.MARKDOWN;
  }

  // HTML檔案
  if (["html", "htm", "xhtml"].includes(ext)) {
    return PREVIEW_MODES.HTML;
  }

  // 程式碼檔案
  const codeExtensions = [
    "js",
    "ts",
    "jsx",
    "tsx",
    "vue",
    "py",
    "java",
    "cpp",
    "c",
    "h",
    "cs",
    "php",
    "rb",
    "go",
    "rs",
    "swift",
    "kt",
    "scala",
    "sh",
    "bash",
    "ps1",
    "sql",
    "json",
    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
  ];

  if (codeExtensions.includes(ext)) {
    return PREVIEW_MODES.CODE;
  }

  // 預設為純文字
  return PREVIEW_MODES.TEXT;
}
