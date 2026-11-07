/**
 * 編碼檢測工具
 * 基於 chardet 庫實現檔案編碼自動檢測
 */

import chardet from "chardet";
import { fetchFileBinaryWithAuth } from "@/api/services/fileDownloadService.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("EncodingDetector");

/**
 * 支援的編碼格式列表
 */
export const SUPPORTED_ENCODINGS = [
  // Unicode編碼（現代主流）
  { value: "utf-8", label: "UTF-8", description: "通用Unicode編碼" },
  { value: "utf-16le", label: "UTF-16 LE", description: "Unicode 16位小端" },
  { value: "utf-16be", label: "UTF-16 BE", description: "Unicode 16位大端" },

  // 中文編碼
  { value: "gb18030", label: "GB18030", description: "中文國家標準(最完整)" },
  { value: "gbk", label: "GBK", description: "中文簡體擴充套件" },
  { value: "gb2312", label: "GB2312", description: "中文簡體基礎" },
  { value: "big5", label: "Big5", description: "中文繁體" },

  // 日韓編碼
  { value: "shift_jis", label: "Shift_JIS", description: "日文" },
  { value: "euc-jp", label: "EUC-JP", description: "日文擴充套件" },
  { value: "euc-kr", label: "EUC-KR", description: "韓文" },

  // 西歐編碼
  { value: "iso-8859-1", label: "ISO-8859-1", description: "西歐語言" },
  { value: "iso-8859-15", label: "ISO-8859-15", description: "西歐語言(含歐元符號)" },
  { value: "windows-1252", label: "Windows-1252", description: "西歐Windows" },

  // 中歐編碼
  { value: "iso-8859-2", label: "ISO-8859-2", description: "中歐語言" },
  { value: "windows-1250", label: "Windows-1250", description: "中歐Windows(波蘭/捷克/匈牙利)" },

  // 西裡爾字母編碼
  { value: "iso-8859-5", label: "ISO-8859-5", description: "西裡爾字母(俄語/保加利亞語)" },
  { value: "windows-1251", label: "Windows-1251", description: "西裡爾字母Windows" },
  { value: "koi8-r", label: "KOI8-R", description: "俄文Unix/Linux" },

  // 中東編碼
  { value: "iso-8859-6", label: "ISO-8859-6", description: "阿拉伯文" },
  { value: "windows-1256", label: "Windows-1256", description: "阿拉伯文Windows" },

  // 其他編碼
  { value: "iso-8859-7", label: "ISO-8859-7", description: "希臘文" },
  { value: "iso-8859-8", label: "ISO-8859-8", description: "希伯來文" },
  { value: "ascii", label: "ASCII", description: "基本ASCII" },
];

/**
 * 從URL獲取檔案的二進位制資料並檢測編碼
 * @param {string} url - 檔案URL
 * @param {Object} options - 選項
 * @param {number} options.sampleSize - 取樣大小，預設4096位元組
 * @param {number} options.timeout - 超時時間，預設10秒
 * @param {AbortSignal} [options.signal] - 取消訊號
 * @returns {Promise<Object>} 檢測結果
 */
export async function detectEncodingFromUrl(url, options = {}) {
  const { sampleSize = 4096, timeout = 10000, signal } = options;

  try {
    // 透過統一的帶鑑權工具獲取二進位制資料
    const { buffer, size } = await fetchFileBinaryWithAuth(url, {
      signal,
      timeout,
    });

    const fullUint8Array = new Uint8Array(buffer);

    // 只使用前 sampleSize 位元組進行編碼檢測
    const uint8Array = fullUint8Array.length > sampleSize ? fullUint8Array.slice(0, sampleSize) : fullUint8Array;

    // 使用chardet檢測編碼
    const detectionResults = chardet.analyse(uint8Array);

    // 獲取最可能的編碼
    const bestMatch = detectionResults[0];

    return {
      success: true,
      encoding: bestMatch?.name?.toLowerCase() || "utf-8",
      confidence: bestMatch?.confidence || 0,
      allResults: detectionResults.map((result) => ({
        encoding: result.name?.toLowerCase(),
        confidence: result.confidence,
        language: result.lang,
      })),
      sampleSize: uint8Array.length,
      fullFileSize: size,
      rawBuffer: fullUint8Array,
      error: null,
    };
  } catch (error) {
    log.error("編碼檢測失敗:", error);

    return {
      success: false,
      encoding: "utf-8", // 預設編碼
      confidence: 0,
      allResults: [],
      sampleSize: 0,
      fullFileSize: 0,
      rawBuffer: null,
      error: error.message,
    };
  }
}

/**
 * 智慧編碼檢測
 * 結合檔名、內容特徵等進行更準確的編碼檢測
 * @param {string} url - 檔案URL
 * @param {string} filename - 檔名
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 檢測結果
 */
export async function smartDetectEncoding(url, filename = "", options = {}) {
  // 基礎編碼檢測
  const baseResult = await detectEncodingFromUrl(url, options);

  if (!baseResult.success) {
    return baseResult;
  }

  // 根據檔名推測可能的編碼
  const filenameHints = getEncodingHintsFromFilename(filename);

  // 如果檢測置信度較低，嘗試使用檔名提示
  if (baseResult.confidence < 70 && filenameHints.length > 0) {
    // 查詢檔名提示中是否有匹配的編碼
    const hintMatch = baseResult.allResults.find((result) => filenameHints.includes(result.encoding));

    if (hintMatch) {
      return {
        ...baseResult,
        encoding: hintMatch.encoding,
        confidence: Math.max(hintMatch.confidence, 60), // 提升置信度
        detectionMethod: "filename_hint",
      };
    }
  }

  return {
    ...baseResult,
    detectionMethod: "content_analysis",
  };
}

/**
 * 根據檔名獲取編碼提示
 * @param {string} filename - 檔名
 * @returns {string[]} 可能的編碼列表
 */
function getEncodingHintsFromFilename(filename) {
  const hints = [];
  const lowerName = filename.toLowerCase();

  // 中文檔名通常使用中文編碼
  if (/[\u4e00-\u9fff]/.test(filename)) {
    hints.push("gbk", "gb2312", "big5", "utf-8");
  }

  // 日文檔名
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(filename)) {
    hints.push("shift_jis", "euc-jp", "utf-8");
  }

  // 韓文檔名
  if (/[\uac00-\ud7af]/.test(filename)) {
    hints.push("euc-kr", "utf-8");
  }

  // 特定副檔名的編碼傾向
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".log")) {
    hints.push("utf-8", "gbk", "windows-1252");
  }

  return hints;
}

/**
 * 驗證編碼是否受支援
 * @param {string} encoding - 編碼名稱
 * @returns {boolean} 是否支援
 */
export function isEncodingSupported(encoding) {
  if (!encoding) return false;

  const normalizedEncoding = encoding.toLowerCase().replace(/[-_]/g, "");

  return SUPPORTED_ENCODINGS.some((supported) => {
    const normalizedSupported = supported.value.toLowerCase().replace(/[-_]/g, "");
    return normalizedSupported === normalizedEncoding;
  });
}

/**
 * 獲取編碼的顯示資訊
 * @param {string} encoding - 編碼名稱
 * @returns {Object|null} 編碼資訊
 */
export function getEncodingInfo(encoding) {
  if (!encoding) return null;

  const normalizedEncoding = encoding.toLowerCase();

  return SUPPORTED_ENCODINGS.find((supported) => supported.value.toLowerCase() === normalizedEncoding) || null;
}

/**
 * 標準化編碼名稱
 * @param {string} encoding - 原始編碼名稱
 * @returns {string} 標準化後的編碼名稱
 */
export function normalizeEncoding(encoding) {
  if (!encoding) return "utf-8";

  const normalized = encoding.toLowerCase();

  // 常見編碼名稱對映
  const mappings = {
    // Unicode別名
    utf8: "utf-8",
    utf16: "utf-16le",
    unicode: "utf-16le",

    // 中文編碼別名
    cp936: "gbk",
    ms936: "gbk",
    cp950: "big5",
    // 注意：gb18030不對映到gbk，它們是不同的編碼

    // 日韓編碼別名
    sjis: "shift_jis",
    cp932: "shift_jis",

    // 西歐編碼別名
    latin1: "iso-8859-1",
    latin9: "iso-8859-15",

    // Windows編碼別名
    cp1250: "windows-1250",
    cp1251: "windows-1251",
    cp1252: "windows-1252",
    cp1256: "windows-1256",

    // ISO編碼別名
    cyrillic: "iso-8859-5",
    arabic: "iso-8859-6",
    greek: "iso-8859-7",
    hebrew: "iso-8859-8",
  };

  return mappings[normalized] || normalized;
}
