/**
 * 壓縮檔案預覽 Composable
 * 提供壓縮檔案解壓、預覽、下載等功能的響應式狀態管理
 * 支援 ZIP、RAR、7Z、TAR、GZIP、BZIP2、XZ 等多種格式
 */

import { ref, computed, onUnmounted } from "vue";
import { archiveService } from "./archiveService.js";
import { cleanupZipJS } from "./zipService.js";
import { lookupMimeType, detectFileTypeFromFilename, FileType, getFileName } from "@/utils/fileTypes.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 壓縮檔案預覽 Composable
 * @returns {Object} 響應式狀態和方法
 */
export function useArchivePreview() {
  const log = createLogger("ArchivePreview");
  // ===== 響應式狀態 =====

  /** 是否正在解壓 */
  const isExtracting = ref(false);

  /** 解壓錯誤資訊 */
  const extractError = ref(null);

  /** 壓縮包檔案列表 */
  const archiveEntries = ref([]);

  /** 是否已解壓完成 */
  const isExtracted = ref(false);

  /** 當前預覽的檔案 */
  const currentPreviewFile = ref(null);

  /** 是否正在預覽檔案 */
  const isPreviewing = ref(false);

  /** 解壓進度 (0-100) */
  const extractProgress = ref(0);

  /** 當前處理階段 */
  const currentStage = ref("");

  // ===== 快取狀態 =====

  /** 快取的檔名 */
  const cachedFileName = ref("");

  /** 快取的檔案URL */
  const cachedFileUrl = ref("");

  // ===== 計算屬性 =====

  /** 總解壓後大小 */
  const totalSize = computed(() => archiveEntries.value.reduce((total, entry) => total + (entry.size || 0), 0));

  // ===== 內部工具函式 =====

  /**
   * 統一的 Blob 資料建立（消除重複程式碼）
   * @param {ArrayBuffer|File} fileData - 檔案資料
   * @param {string} mimeType - MIME型別
   * @returns {Blob} 標準化的 Blob 物件
   */
  const createBlobFromFileData = (fileData, mimeType) => {
    if (fileData instanceof File) {
      // libarchive.js 返回的 File 物件，MIME 型別可能不正確，需要重新建立
      return new Blob([fileData], { type: mimeType });
    } else {
      // Zip 返回的 ArrayBuffer，直接建立 Blob
      return new Blob([fileData], { type: mimeType });
    }
  };

  /**
   * 智慧 URL 清理（根據檔案大小調整延遲）
   * @param {string} url - 要清理的 URL
   * @param {number} fileSize - 檔案大小
   */
  const smartUrlCleanup = (url, fileSize = 0) => {
    let delay = 10000; // 預設 10 秒

    // 大檔案延長清理時間
    if (fileSize > 10 * 1024 * 1024) {
      // 10MB 以上
      delay = 20000; // 20 秒
    } else if (fileSize < 1024 * 1024) {
      // 1MB 以下
      delay = 5000; // 5 秒
    }

    setTimeout(() => URL.revokeObjectURL(url), delay);
  };

  // ===== 核心方法 =====

  /**
   * 解壓壓縮檔案
   * @param {string} fileUrl - 檔案下載URL
   * @param {string} fileName - 檔名
   * @param {string|null} password - 可選的解壓密碼
   * @returns {Promise<void>}
   */
  const extractArchive = async (fileUrl, fileName, password = null) => {
    if (isExtracting.value) {
      log.warn("正在解壓中，請勿重複操作");
      return;
    }

    isExtracting.value = true;
    extractError.value = null;
    archiveEntries.value = [];
    isExtracted.value = false;
    extractProgress.value = 0;
    currentStage.value = "下載";

    try {
      log.debug("開始處理壓縮檔案:", fileName);
      if (password) {
        log.debug("使用提供的密碼進行解壓");
      }

      // 直接委託給archiveService，傳遞密碼引數
      const processedEntries = await archiveService.extractArchive(
        fileUrl,
        fileName,
        fileUrl,
        (progress, stage) => {
          extractProgress.value = Math.round(progress * 10) / 10;
          if (stage) {
            currentStage.value = stage;
          }
        },
        password
      );

      // 只快取必要資訊
      cachedFileName.value = fileName;
      cachedFileUrl.value = fileUrl;

      archiveEntries.value = processedEntries;
      isExtracted.value = true;
      extractProgress.value = 100;
      currentStage.value = "完成";

      log.debug("壓縮檔案處理完成，檔案數量:", processedEntries.length);
    } catch (error) {
      log.error("解壓失敗:", error);

      // 檢查是否是加密檢測錯誤，如果是則重新丟擲讓上層處理
      if (error.message && (error.message.includes("ENCRYPTED_ARCHIVE_DETECTED") || error.message.includes("INVALID_ARCHIVE_PASSWORD"))) {
        log.debug("檢測到加密相關錯誤，重新丟擲給上層處理");
        // 重置狀態但不設定錯誤資訊，讓上層元件處理
        extractProgress.value = 0;
        currentStage.value = "";
        isExtracted.value = false;
        isExtracting.value = false;

        // 重新丟擲錯誤給上層元件處理
        throw error;
      }

      // 其他錯誤正常處理
      extractError.value = error.message;
      extractProgress.value = 0; // 重置進度
      currentStage.value = "錯誤";
      isExtracted.value = false;
    } finally {
      isExtracting.value = false;
    }
  };

  /**
   * 預覽檔案 - 完整複製原有邏輯
   * @param {Object} entry - 檔案條目
   * @returns {Promise<void>}
   */
  const previewFile = async (entry) => {
    if (entry.isDirectory) {
      log.warn("無法預覽目錄:", entry.name);
      return;
    }

    if (isPreviewing.value) {
      log.warn("正在預覽其他檔案，請稍候");
      return;
    }

    isPreviewing.value = true;
    currentPreviewFile.value = entry;

    try {
      log.debug("開始預覽檔案:", entry.name);

      // 獲取檔案內容
      const arrayBuffer = await archiveService.getFileContent(entry.entry);

      // 根據檔案型別進行不同的預覽處理
      const fileName = entry.name;
      const type = detectFileTypeFromFilename(fileName);

      log.debug(`預覽檔案: ${fileName}, 檢測型別: ${type}`);

      if (type === FileType.TEXT) {
        // 文字檔案：建立HTML頁面在新標籤頁顯示
        // 確保 arrayBuffer 是正確的型別
        let textBuffer;
        if (arrayBuffer instanceof ArrayBuffer) {
          textBuffer = arrayBuffer;
        } else if (arrayBuffer instanceof File) {
          // 如果是 File 物件，轉換為 ArrayBuffer
          textBuffer = await arrayBuffer.arrayBuffer();
        } else if (arrayBuffer instanceof Uint8Array) {
          textBuffer = arrayBuffer.buffer;
        } else {
          throw new Error(`不支援的資料型別: ${typeof arrayBuffer}`);
        }

        const text = new TextDecoder("utf-8").decode(textBuffer);
        const htmlContent = createTextPreviewHtml(entry.name, text);
        const blob = new Blob([htmlContent], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");

        smartUrlCleanup(url, entry.size);
      } else if (type === FileType.IMAGE) {
        // 圖片檔案：使用正確的MIME型別
        const mimeType = lookupMimeType(fileName) || "image/jpeg";
        const blobData = createBlobFromFileData(arrayBuffer, mimeType);
        const url = URL.createObjectURL(blobData);
        window.open(url, "_blank");
        smartUrlCleanup(url, entry.size);
      } else if (type === FileType.DOCUMENT) {
        // PDF檔案：直接在新標籤頁顯示
        const blobData = createBlobFromFileData(arrayBuffer, "application/pdf");
        const url = URL.createObjectURL(blobData);
        window.open(url, "_blank");
        smartUrlCleanup(url, entry.size);
      } else if (type === FileType.VIDEO) {
        // 影片檔案：直接開啟（瀏覽器支援則預覽，不支援則下載）
        const mimeType = lookupMimeType(fileName) || "video/mp4";
        const blobData = createBlobFromFileData(arrayBuffer, mimeType);
        const url = URL.createObjectURL(blobData);
        window.open(url, "_blank");
        smartUrlCleanup(url, entry.size);
      } else if (type === FileType.AUDIO) {
        // 音訊檔案：直接在新標籤頁顯示
        const mimeType = lookupMimeType(fileName) || "audio/mpeg";
        const blobData = createBlobFromFileData(arrayBuffer, mimeType);
        const url = URL.createObjectURL(blobData);
        window.open(url, "_blank");
        smartUrlCleanup(url, entry.size);
      } else {
        // 不支援的型別（如Office檔案）：下載檔案
        const blobData = createBlobFromFileData(arrayBuffer, "application/octet-stream");
        const url = URL.createObjectURL(blobData);
        const a = document.createElement("a");
        a.href = url;
        a.download = getFileName(entry.name);
        a.click();
        URL.revokeObjectURL(url);
      }

      log.debug("檔案預覽成功:", entry.name);
    } catch (error) {
      log.error("預覽檔案失敗:", error);
      extractError.value = error.message || "預覽失敗";
    } finally {
      isPreviewing.value = false;
      currentPreviewFile.value = null;
    }
  };

  /**
   * 下載單個檔案
   * @param {Object} entry - 檔案條目
   * @returns {Promise<void>}
   */
  const downloadFile = async (entry) => {
    if (entry.isDirectory) {
      log.warn("無法下載目錄:", entry.name);
      return;
    }

    try {
      log.debug("開始下載檔案:", entry.name);

      // 獲取檔案內容
      const fileData = await archiveService.getFileContent(entry.entry);

      // 建立 Blob 物件（使用工具函式）
      const mimeType = lookupMimeType(entry.name) || "application/octet-stream";
      const blob = createBlobFromFileData(fileData, mimeType);

      // 建立下載連結
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getFileName(entry.name);

      // 觸發下載
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 釋放 URL
      URL.revokeObjectURL(url);

      log.debug("檔案下載成功:", entry.name);
    } catch (error) {
      log.error("下載檔案失敗:", error);
      extractError.value = error.message || "下載失敗";
    }
  };

  /**
   * 重置狀態
   */
  const resetState = () => {
    isExtracting.value = false;
    extractError.value = null;
    archiveEntries.value = [];
    isExtracted.value = false;
    currentPreviewFile.value = null;
    isPreviewing.value = false;
    extractProgress.value = 0;
    currentStage.value = "";

    // 清理快取資料
    cachedFileName.value = "";
    cachedFileUrl.value = "";

    log.debug("壓縮檔案預覽狀態已重置");
  };

  // ===== 工具函式 =====

  /**
   * 建立文字預覽HTML頁面
   * @param {string} fileName - 檔名
   * @param {string} content - 文字內容
   * @returns {string} HTML內容
   */
  const createTextPreviewHtml = (fileName, content) => {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${fileName}</title>
<style>body{font-family:monospace;padding:20px;white-space:pre-wrap;}</style>
</head><body>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
  };

  // ===== 生命週期 =====

  onUnmounted(async () => {
    // 清理資源
    resetState();

    // 清理zip.js Worker資源
    try {
      await cleanupZipJS();
    } catch (error) {
      log.warn("清理zip.js資源時出錯:", error);
    }
  });

  // ===== 返回介面 =====

  return {
    // 狀態
    isExtracting,
    extractError,
    archiveEntries,
    isExtracted,
    currentPreviewFile,
    isPreviewing,
    extractProgress,
    currentStage,

    // 計算屬性
    totalSize,

    // 方法
    extractArchive,
    previewFile,
    downloadFile,
    resetState,

    // 服務例項（用於高階用法）
    archiveService,
  };
}
