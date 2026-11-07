/**
 * 檔案型別檢測器
 * 基於預覽設定的可配置檔案型別判斷系統
 */

import { FILE_TYPES, FILE_TYPE_NAMES } from "../constants/index.js";
import previewSettingsCache from "../cache/PreviewSettingsCache.js";

/**
 * 從檔名提取副檔名
 * @param {string} filename - 檔名
 * @returns {string} 副檔名（小寫，不含點）
 */
export function getFileExtension(filename) {
  if (!filename || typeof filename !== "string") {
    return "";
  }

  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
    return "";
  }

  return filename.substring(lastDotIndex + 1).toLowerCase();
}

/**
 * 獲取檔案型別
 * 基於預覽設定的檔案型別判斷，返回整數常量
 * @param {string} filename - 檔名
 * @param {D1Database} db - 資料庫例項（可選）
 * @returns {Promise<number>} 檔案型別常量 (0-6)
 */
export async function GetFileType(filename, db = null) {
  try {
    const extension = getFileExtension(filename);

    // 優先使用預覽設定快取
    if (previewSettingsCache.isLoaded()) {
      const categoryFromProviders = previewSettingsCache.resolveTypeCategoryByProviders({ filename, extension });
      const previewType =
        categoryFromProviders !== "unknown" ? categoryFromProviders : extension ? await previewSettingsCache.getFileType(extension, db) : "unknown";

      switch (previewType) {
        case "text":
          return FILE_TYPES.TEXT;
        case "audio":
          return FILE_TYPES.AUDIO;
        case "video":
          return FILE_TYPES.VIDEO;
        case "image":
          return FILE_TYPES.IMAGE;
        case "office":
          return FILE_TYPES.OFFICE;
        case "document":
          return FILE_TYPES.DOCUMENT;
        default:
          // 如果預覽設定中沒有配置，回退到硬編碼檢測
          return getFileTypeByExtensionFallback(extension);
      }
    }

    // 如果快取未載入，嘗試載入快取
    if (db) {
      try {
        await previewSettingsCache.refresh(db);
        const categoryFromProviders = previewSettingsCache.resolveTypeCategoryByProviders({ filename, extension });
        const previewType =
          categoryFromProviders !== "unknown" ? categoryFromProviders : extension ? await previewSettingsCache.getFileType(extension, db) : "unknown";

        switch (previewType) {
          case "text":
            return FILE_TYPES.TEXT;
          case "audio":
            return FILE_TYPES.AUDIO;
          case "video":
            return FILE_TYPES.VIDEO;
          case "image":
            return FILE_TYPES.IMAGE;
          case "office":
            return FILE_TYPES.OFFICE;
          case "document":
            return FILE_TYPES.DOCUMENT;
          default:
            // 如果預覽設定中沒有配置，回退到硬編碼檢測
            console.log(`檔案型別檢測回退: ${filename} (副檔名: ${extension}) - 預覽設定未配置，使用硬編碼檢測`);
            return getFileTypeByExtensionFallback(extension);
        }
      } catch (cacheError) {
        console.warn(`預覽設定快取載入失敗，使用硬編碼檢測: ${cacheError.message}`);
      }
    }

    // 如果快取未載入且沒有資料庫例項，使用硬編碼回退
    console.log(`檔案型別檢測回退: ${filename} (副檔名: ${extension}) - 預覽設定快取未載入，使用硬編碼檢測`);
    return getFileTypeByExtensionFallback(extension);
  } catch (error) {
    console.error(`GetFileType 檢測失敗 "${filename}":`, error);
    return FILE_TYPES.UNKNOWN;
  }
}

/**
 * 硬編碼的副檔名檢測（回退機制）
 * @param {string} extension - 副檔名
 * @returns {number} 檔案型別常量
 */
function getFileTypeByExtensionFallback(extension) {
  if (!extension) return FILE_TYPES.UNKNOWN;

  const ext = extension.toLowerCase();

  // 文字型別（與預覽設定預設值保持一致）
  const textTypes = [
    "txt",
    "htm",
    "html",
    "xml",
    "java",
    "properties",
    "sql",
    "js",
    "md",
    "json",
    "conf",
    "ini",
    "vue",
    "php",
    "py",
    "bat",
    "yml",
    "yaml",
    "go",
    "sh",
    "c",
    "cpp",
    "h",
    "hpp",
    "tsx",
    "vtt",
    "srt",
    "ass",
    "rs",
    "lrc",
    "dockerfile",
    "makefile",
    "gitignore",
    "license",
    "readme",
  ];
  if (textTypes.includes(ext)) {
    return FILE_TYPES.TEXT;
  }

  // 音訊型別（與預覽設定預設值保持一致）
  const audioTypes = ["mp3", "flac", "ogg", "m4a", "wav", "opus", "wma"];
  if (audioTypes.includes(ext)) {
    return FILE_TYPES.AUDIO;
  }

  // 影片型別（與預覽設定預設值保持一致，但排除htm/html）
  const videoTypes = ["mp4", "mkv", "avi", "mov", "rmvb", "webm", "flv", "m3u8"];
  if (videoTypes.includes(ext)) {
    return FILE_TYPES.VIDEO;
  }

  // 圖片型別（與預覽設定預設值保持一致）
  const imageTypes = ["jpg", "tiff", "jpeg", "png", "gif", "bmp", "svg", "ico", "swf", "webp", "avif", "heic", "heif"];
  if (imageTypes.includes(ext)) {
    return FILE_TYPES.IMAGE;
  }

  // Office文件型別（需要線上轉換預覽）
  const officeTypes = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf"];
  if (officeTypes.includes(ext)) {
    return FILE_TYPES.OFFICE;
  }

  // 文件型別（可直接預覽）
  const documentTypes = ["pdf"];
  if (documentTypes.includes(ext)) {
    return FILE_TYPES.DOCUMENT;
  }

  return FILE_TYPES.UNKNOWN;
}

/**
 * 獲取檔案型別名稱
 * @param {string} filename - 檔名
 * @param {D1Database} db - 資料庫例項（可選）
 * @returns {Promise<string>} 檔案型別名稱
 */
export async function getFileTypeName(filename, db = null) {
  const typeCode = await GetFileType(filename, db);
  return FILE_TYPE_NAMES[typeCode] || "unknown";
}
