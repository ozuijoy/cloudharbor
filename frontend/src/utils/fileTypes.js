/**
 * 檔案型別處理
 *
 */
import { getPreviewModeFromFilename, PREVIEW_MODES } from "./textUtils.js";
import mimeDb from "mime-db";

/**
 * 前端相容的MIME型別查詢函式
 * 基於mime-db資料庫，優先返回更合適的MIME型別
 * @param {string} filename - 檔名
 * @returns {string|false} MIME型別或false
 */
export function lookupMimeType(filename) {
  if (!filename) return false;

  const ext = getExtension(filename);
  if (!ext) return false;

  // 收集所有匹配的MIME型別
  const matchingMimeTypes = [];
  for (const [mimeType, data] of Object.entries(mimeDb)) {
    if (data.extensions && data.extensions.includes(ext)) {
      matchingMimeTypes.push(mimeType);
    }
  }

  if (matchingMimeTypes.length === 0) return false;
  if (matchingMimeTypes.length === 1) return matchingMimeTypes[0];

  // 如果有多個匹配，按優先順序選擇最合適的
  return selectBestMimeType(matchingMimeTypes);
}

/**
 * 從多個MIME型別中選擇最合適的
 * @param {string[]} mimeTypes - 匹配的MIME型別陣列
 * @returns {string} 最合適的MIME型別
 */
function selectBestMimeType(mimeTypes) {
  // 定義MIME型別優先順序規則
  const priorityRules = [
    // 影片檔案優先選擇video/*而不是application/*
    { condition: (mime) => mime.startsWith("video/"), priority: 10 },
    // 音訊檔案優先選擇audio/*而不是application/*
    { condition: (mime) => mime.startsWith("audio/"), priority: 9 },
    // 圖片檔案優先選擇image/*
    { condition: (mime) => mime.startsWith("image/"), priority: 8 },
    // 文字檔案優先選擇text/*
    { condition: (mime) => mime.startsWith("text/"), priority: 7 },
    // application/*型別優先順序較低
    { condition: (mime) => mime.startsWith("application/"), priority: 5 },
  ];

  // 計算每個MIME型別的優先順序分數
  const scoredMimeTypes = mimeTypes.map((mimeType) => {
    let score = 0;
    for (const rule of priorityRules) {
      if (rule.condition(mimeType)) {
        score = Math.max(score, rule.priority);
      }
    }
    return { mimeType, score };
  });

  // 按分數排序，返回最高分的MIME型別
  scoredMimeTypes.sort((a, b) => b.score - a.score);
  return scoredMimeTypes[0].mimeType;
}

// 檔案型別常量（與後端完全一致）
export const FileType = {
  UNKNOWN: 0, // 未知檔案
  FOLDER: 1, // 資料夾
  VIDEO: 2, // 影片檔案
  AUDIO: 3, // 音訊檔案
  TEXT: 4, // 文字檔案
  IMAGE: 5, // 圖片檔案
  OFFICE: 6, // Office文件
  DOCUMENT: 7, // 文件檔案
};

// 電子書副檔名（foliate-js 支援的主流格式）
const EBOOK_EXTENSIONS = new Set(["epub", "mobi", "azw3", "azw", "fb2", "cbz"]);

/**
 * 獲取副檔名
 * @param {string} filename - 檔名
 * @returns {string} 副檔名（小寫）
 */
export function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * 獲取檔案圖示型別（用於fileTypeIcons.js）
 * @param {Object} fileObject - 檔案物件，包含type欄位
 * @returns {string} 圖示型別
 */
export function getIconType(fileObject) {
  const filename = fileObject?.filename || fileObject?.name || "";
  const ext = getExtension(filename);
  if (EBOOK_EXTENSIONS.has(ext)) {
    return "book";
  }

  const iconMap = {
    [FileType.UNKNOWN]: "file",
    [FileType.FOLDER]: "folder",
    [FileType.VIDEO]: "video",
    [FileType.AUDIO]: "audio",
    [FileType.TEXT]: "text",
    [FileType.IMAGE]: "image",
    [FileType.OFFICE]: "document",
    [FileType.DOCUMENT]: "document",
  };
  return iconMap[fileObject?.type] || iconMap[FileType.UNKNOWN];
}

/**
 * 獲取預覽元件名稱
 * @param {Object} fileObject - 檔案物件，包含type和filename欄位
 * @returns {string} 預覽元件名稱
 */
export function getPreviewComponent(fileObject) {
  const type = fileObject?.type;
  const filename = fileObject?.filename || fileObject?.name || "";

  // 直接基於type欄位的對映
  if (type === FileType.IMAGE) return "ImagePreview";
  if (type === FileType.VIDEO) return "VideoPreview";
  if (type === FileType.AUDIO) return "AudioPreview";

  // Document型別（可直接預覽的文件，如PDF）
  if (type === FileType.DOCUMENT) return "PdfPreview";

  // Office型別
  if (type === FileType.OFFICE) return "OfficeSharePreview";

  // Text型別的細分
  if (type === FileType.TEXT) {
    const mode = getPreviewModeFromFilename(filename);

    if (mode === PREVIEW_MODES.CODE) return "CodePreview";
    if (mode === PREVIEW_MODES.MARKDOWN) return "MarkdownPreview";
    if (mode === PREVIEW_MODES.HTML) return "HtmlPreview";
    return "TextPreview";
  }

  // 預設預覽
  return "GenericPreview";
}

/**
 * 檢測是否為壓縮檔案
 * 基於標準MIME型別檢測，避免硬編碼
 * @param {string} filename - 檔名
 * @returns {boolean} 是否為壓縮檔案
 */
export function isArchiveFile(filename) {
  if (!filename) return false;

  // 使用前端相容的MIME型別檢測
  const mimeType = lookupMimeType(filename);

  if (!mimeType) return false;

  // 完全基於MIME型別檢測壓縮檔案（基於mime-db資料庫）
  let isArchive =
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip") ||
    mimeType.includes("compress") ||
    mimeType.includes("archive") ||
    mimeType.includes("x-7z") ||
    mimeType.includes("x-bzip") ||
    mimeType.includes("x-xz") ||
    mimeType.includes("x-lzma") ||
    mimeType.includes("x-lz4") ||
    mimeType.includes("x-zstd") ||
    mimeType.includes("x-cpio") ||
    mimeType.includes("x-iso") ||
    mimeType.includes("x-cab") ||
    mimeType.includes("x-lha") ||
    mimeType.includes("x-lzh") ||
    mimeType.includes("x-xar") ||
    mimeType.includes("warc");

  // 特殊處理：當MIME型別為通用型別時，基於副檔名判斷
  if (!isArchive && mimeType === "application/octet-stream") {
    const ext = getExtension(filename);
    const archiveExtensions = ["iso", "cpio", "xar", "ar", "a", "mtree"];
    isArchive = archiveExtensions.includes(ext);
  }

  return isArchive;
}

/**
 * 獲取壓縮檔案型別資訊
 * @param {string} filename - 檔名
 * @returns {Object} 壓縮檔案型別資訊
 */
export function getArchiveType(filename) {
  if (!filename) return null;

  const ext = getExtension(filename);
  const archiveTypes = {
    zip: { name: "ZIP", icon: "IconFolderZip", supported: true, description: "ZIP壓縮檔案" },
    rar: { name: "RAR", icon: "IconZipBox", supported: true, description: "RAR壓縮檔案" },
    "7z": { name: "7-Zip", icon: "IconZipBoxOutline", supported: true, description: "7-Zip壓縮檔案" },
    tar: { name: "TAR", icon: "IconPackageVariant", supported: true, description: "TAR歸檔檔案" },
    gz: { name: "Gzip", icon: "IconArchiveOutline", supported: true, description: "Gzip壓縮檔案" },
    bz2: { name: "Bzip2", icon: "IconArchiveOutline", supported: true, description: "Bzip2壓縮檔案" },
    xz: { name: "XZ", icon: "IconArchiveOutline", supported: true, description: "XZ壓縮檔案" },
    tgz: { name: "TAR.GZ", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Gzip壓縮檔案" },
    tbz: { name: "TAR.BZ2", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Bzip2壓縮檔案" },
    tbz2: { name: "TAR.BZ2", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Bzip2壓縮檔案" },
    txz: { name: "TAR.XZ", icon: "IconPackageVariantClosed", supported: true, description: "TAR + XZ壓縮檔案" },
    cpio: { name: "CPIO", icon: "IconArchive", supported: true, description: "CPIO歸檔檔案" },
    iso: { name: "ISO", icon: "IconDisc", supported: true, description: "ISO光碟映象檔案" },
    cab: { name: "CAB", icon: "IconZipBox", supported: true, description: "Microsoft CAB壓縮檔案" },
    xar: { name: "XAR", icon: "IconArchive", supported: true, description: "XAR歸檔檔案" },
    ar: { name: "AR", icon: "IconArchive", supported: true, description: "AR歸檔檔案" },
    a: { name: "AR", icon: "IconArchive", supported: true, description: "AR歸檔檔案" },
    mtree: { name: "MTREE", icon: "IconFileTree", supported: true, description: "mtree檔案系統描述" },
  };

  return (
    archiveTypes[ext] || {
      name: ext.toUpperCase(),
      icon: "IconArchive",
      supported: false,
      description: `${ext.toUpperCase()}壓縮檔案（暫不支援）`,
    }
  );
}

/**
 * 基於標準MIME型別庫的檔案型別檢測
 * 將MIME型別對映到專案的FileType常量系統
 * @param {string} filename - 檔名
 * @returns {number} FileType常量
 */
export function detectFileTypeFromFilename(filename) {
  if (!filename) return FileType.UNKNOWN;

  const ext = getExtension(filename);

  // 優先處理特殊副檔名（無標準MIME型別的檔案）
  const specialTextExtensions = ["vue", "tsx", "dockerfile", "makefile", "gitignore", "license", "readme", "conf", "ini", "rs", "vtt", "srt", "ass", "lrc"];
  if (specialTextExtensions.includes(ext)) {
    return FileType.TEXT;
  }

  // 使用前端相容的MIME型別檢測
  const mimeType = lookupMimeType(filename);
  if (!mimeType) return FileType.UNKNOWN;

  // 將MIME型別對映到專案的FileType常量
  return mapMimeTypeToFileType(mimeType, filename);
}

/**
 * 將MIME型別對映到專案的FileType常量
 * @param {string} mimeType - MIME型別
 * @param {string} filename - 檔名（用於特殊情況判斷）
 * @returns {number} FileType常量
 */
function mapMimeTypeToFileType(mimeType, filename = "") {
  const ext = getExtension(filename);

  // 文字型別
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-sh" ||
    mimeType === "application/x-python-code" ||
    ["vue", "tsx", "dockerfile", "makefile", "gitignore", "license", "readme", "conf", "ini", "yml", "yaml"].includes(ext)
  ) {
    return FileType.TEXT;
  }

  // 音訊型別
  if (mimeType.startsWith("audio/")) {
    return FileType.AUDIO;
  }

  // 影片型別
  if (mimeType.startsWith("video/") || mimeType === "application/mp4") {
    return FileType.VIDEO;
  }

  // 圖片型別
  if (mimeType.startsWith("image/")) {
    return FileType.IMAGE;
  }

  // Office文件型別
  if (mimeType.includes("officedocument") || mimeType.includes("ms-excel") || mimeType.includes("ms-powerpoint") || mimeType.includes("msword") || mimeType === "application/rtf") {
    return FileType.OFFICE;
  }

  // PDF文件型別
  if (mimeType === "application/pdf") {
    return FileType.DOCUMENT;
  }

  return FileType.UNKNOWN;
}

/**
 * 建立模擬的檔案物件，用於與現有圖示和預覽系統相容
 * @param {Object} fileEntry - 檔案條目（可以是壓縮檔案內容或其他來源）
 * @returns {Object} 模擬的檔案物件
 */
export function createMockFileObject(fileEntry) {
  if (!fileEntry) return null;

  const type = fileEntry.isDirectory ? FileType.FOLDER : detectFileTypeFromFilename(fileEntry.name);

  return {
    name: fileEntry.name,
    filename: fileEntry.name,
    isDirectory: fileEntry.isDirectory,
    type: type,
    size: fileEntry.size || 0,
    isMount: false,
  };
}

/**
 * 判斷檔案是否可以預覽
 * 壓縮檔案內支援更多型別的預覽（除了Office檔案）
 * @param {Object} fileEntry - 檔案條目
 * @param {boolean} isInArchive - 是否在壓縮檔案內（預設false）
 * @returns {boolean} 是否可以預覽
 */
export function canPreviewFile(fileEntry, isInArchive = false) {
  if (!fileEntry || fileEntry.isDirectory) return false;

  const type = detectFileTypeFromFilename(fileEntry.name);

  if (isInArchive) {
    // 壓縮檔案內支援：TEXT, IMAGE, DOCUMENT(PDF), VIDEO, AUDIO
    // 不支援：OFFICE（需要線上轉換，在壓縮檔案內不合適）
    return type === FileType.TEXT || type === FileType.IMAGE || type === FileType.DOCUMENT || type === FileType.VIDEO || type === FileType.AUDIO;
  }

  // 普通檔案預覽（保持原有邏輯）
  return type === FileType.TEXT || type === FileType.IMAGE;
}

/**
 * 獲取檔案的MIME型別描述
 * @param {Object} fileEntry - 檔案條目
 * @returns {string} MIME型別或簡單描述
 */
export function getMimeTypeDescription(fileEntry) {
  if (!fileEntry) return "Unknown";
  if (fileEntry.isDirectory) return "Directory";

  const mimeType = lookupMimeType(fileEntry.name);
  if (mimeType) {
    return mimeType;
  }
  const ext = getExtension(fileEntry.name);
  return ext ? `${ext.toUpperCase()}` : "Unknown";
}

/**
 * 獲取檔案路徑部分（不包含檔名）
 * @param {string} fullPath - 完整路徑
 * @returns {string} 路徑部分
 */
export function getFilePath(fullPath) {
  if (!fullPath) return "";
  const parts = fullPath.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/**
 * 獲取檔名部分（不包含路徑）
 * @param {string} fullPath - 完整路徑
 * @returns {string} 檔名部分
 */
export function getFileName(fullPath) {
  if (!fullPath) return "";
  const parts = fullPath.split("/");
  return parts[parts.length - 1];
}

/**
 * 格式化檔案大小
 * @param {number} bytes - 位元組數
 * @returns {string} 格式化後的大小
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * 獲取檔案顯示名稱（去除副檔名）
 * @param {string} filename - 檔名
 * @returns {string} 顯示名稱
 */
export function getDisplayName(filename) {
  if (!filename) return "";
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1) return filename;
  return filename.slice(0, lastDotIndex);
}
