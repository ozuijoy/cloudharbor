/**
 * 檔案預覽擴充套件功能 Composable
 * 專注互動功能（編輯、儲存、下載等）
 */

import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "@/api";
import { copyToClipboard } from "@/utils/clipboard";
import { createLogger } from "@/utils/logger.js";

export function useFilePreviewExtensions(
  file,
  authInfo,
  officePreviewLoading,
  officePreviewError,
  officePreviewTimedOut,
  previewUrl,
  handleFullscreenChange,
  handleKeyDown,
  emit,
  authenticatedPreviewUrl,
  previewTimeoutId
) {
  const { t } = useI18n();
  const log = createLogger("PreviewExtensions");

  // ===== Office預覽處理 =====

  /**
   * Office預覽載入完成處理
   */
  const handleOfficePreviewLoaded = () => {
    officePreviewLoading.value = false;
    officePreviewError.value = "";
    officePreviewTimedOut.value = false;
    log.debug("Office預覽載入完成");
  };

  /**
   * Office預覽載入錯誤處理
   */
  const handleOfficePreviewError = (error) => {
    log.error("Office預覽載入錯誤:", error);

    // 清除載入狀態
    officePreviewLoading.value = false;
    officePreviewTimedOut.value = false;

    // 設定錯誤資訊
    if (error && error.message) {
      officePreviewError.value = error.message;
    } else {
      officePreviewError.value = t("mount.filePreview.previewError");
    }

    log.debug("Office預覽錯誤處理完成");
  };

  // ===== 編輯模式處理已移除 =====

  // ===== 音訊播放器事件處理 =====

  /**
   * 音訊播放事件處理
   */
  const handleAudioPlay = (data) => {
    log.debug("音訊開始播放:", data);
    // 可以在這裡新增播放統計或其他邏輯
  };

  /**
   * 音訊暫停事件處理
   */
  const handleAudioPause = (data) => {
    log.debug("音訊暫停播放:", data);
    // 可以在這裡新增暫停統計或其他邏輯
  };

  /**
   * 音訊錯誤事件處理
   */
  const handleAudioError = (error) => {
    // 忽略Service Worker相關的誤報錯誤（基於當前預覽URL）
    if (error?.target?.src?.includes(window.location.origin) && previewUrl.value?.startsWith("https://")) {
      log.debug("忽略Service Worker相關的誤報錯誤，音訊實際可以正常播放");
      return;
    }

    log.error("音訊播放錯誤:", error);
  };

  // ===== 其他功能 =====

  // S3直鏈預覽狀態
  const isGeneratingPreview = ref(false);

  /**
   * 處理下載按鈕點選
   */
  const handleDownload = () => {
    emit("download", file.value);
  };

  /**
   * 處理S3直鏈預覽
   */
  const handleS3DirectPreview = async () => {
    if (isGeneratingPreview.value) return;

    try {
      isGeneratingPreview.value = true;
      log.debug("開始生成直鏈/代理預覽...");

      const baseUrl = previewUrl.value;
      if (!baseUrl) {
        throw new Error("當前檔案缺少可用的預覽URL");
      }

      log.debug("直鏈/代理預覽使用原始URL:", baseUrl);
      window.open(baseUrl, "_blank");
      log.debug("預覽成功");
      return;
    } catch (error) {
      log.error("S3直鏈預覽失敗:", error);
      emit("show-message", {
        type: "error",
        message: t("mount.filePreview.s3PreviewError", { message: error.message }),
      });
    } finally {
      isGeneratingPreview.value = false;
    }
  };

  /**
   * 獲取當前目錄路徑
   */
  const getCurrentDirectoryPath = () => {
    if (!file.value?.path) return "";

    // 從檔案路徑中提取目錄路徑
    const filePath = file.value.path;
    const lastSlashIndex = filePath.lastIndexOf("/");

    if (lastSlashIndex === -1) {
      return "/"; // 根目錄
    }

    return filePath.substring(0, lastSlashIndex + 1);
  };

  // ===== 分享功能 =====

  const isCreatingShare = ref(false);

  /**
   * 處理建立分享連結
   */
  const handleCreateShare = async () => {
    if (!file.value || !file.value.path) {
      return;
    }

    isCreatingShare.value = true;

    try {
      const result = await api.fs.createShareFromFileSystem(file.value.path);

      if (result.success) {
        // 複製分享連結到剪貼簿
        const shareUrl = `${window.location.origin}${result.data.url}`;
        const success = await copyToClipboard(shareUrl);
        if (!success) {
          throw new Error("複製分享連結失敗");
        }

        // 顯示成功訊息
        emit("show-message", {
          type: "success",
          message: t("mount.messages.shareCreated", { url: shareUrl }),
        });
      } else {
        throw new Error(result.message || "建立分享失敗");
      }
    } catch (error) {
      log.error("建立分享失敗:", error);
      emit("show-message", {
        type: "error",
        message: t("mount.messages.shareCreateFailed", { message: error.message }),
      });
    } finally {
      isCreatingShare.value = false;
    }
  };

  // ===== 生命週期管理 =====

  /**
   * 元件掛載時的初始化
   */
  const initializeExtensions = () => {
    log.debug("檔案預覽擴充套件功能初始化完成");
  };

  /**
   * 元件解除安裝時的清理
   */
  const cleanupExtensions = () => {
    // 清理URL資源
    if (authenticatedPreviewUrl && authenticatedPreviewUrl.value) {
      URL.revokeObjectURL(authenticatedPreviewUrl.value);
      authenticatedPreviewUrl.value = null;
    }

    // 清除計時器
    if (previewTimeoutId && previewTimeoutId.value) {
      clearTimeout(previewTimeoutId.value);
      previewTimeoutId.value = null;
    }

    log.debug("檔案預覽擴充套件功能清理完成");
  };

  // 生命週期鉤子
  onMounted(initializeExtensions);
  onUnmounted(cleanupExtensions);

  return {
    // Office預覽處理
    handleOfficePreviewLoaded,
    handleOfficePreviewError,

    // 音訊處理
    handleAudioPlay,
    handleAudioPause,
    handleAudioError,

    // 其他功能
    isGeneratingPreview,
    handleDownload,
    handleS3DirectPreview,
    getCurrentDirectoryPath,

    // 分享功能
    isCreatingShare,
    handleCreateShare,

    // 生命週期
    initializeExtensions,
    cleanupExtensions,
  };
}
