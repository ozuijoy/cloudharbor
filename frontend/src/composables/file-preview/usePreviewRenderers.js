/**
 * 檔案預覽渲染器 Composable
 * 專注預覽渲染
 */

import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useEventListener } from "@vueuse/core";
import { formatDateTime } from "@/utils/timeUtils.js";
import { formatFileSize as formatFileSizeUtil, FileType, getExtension, isArchiveFile } from "@/utils/fileTypes.js";
import { decodeImagePreviewUrlToPngObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode.js";
import { createLogger } from "@/utils/logger.js";

const EBOOK_EXTS = new Set(["epub", "mobi", "azw3", "azw", "fb2", "cbz"]);
const EBOOK_MIMES = new Set([
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/x-fictionbook+xml",
  "application/vnd.comicbook+zip",
  "application/x-cbz",
]);

export function usePreviewRenderers(file, emit, darkMode) {
  const log = createLogger("Preview");
  // ===== 狀態管理 =====

  // 基本狀態
  const loadError = ref(false);
  const authenticatedPreviewUrl = ref(null);
  const hasTriedImageDecodeFallback = ref(false);
  const isDecodingImage = ref(false);
  const imageDecodeAbortController = ref(null);

  // Office預覽相關
  const officePreviewLoading = ref(false);
  const officePreviewError = ref("");
  const officePreviewTimedOut = ref(false);
  const previewTimeoutId = ref(null);

  // 全屏狀態
  const isOfficeFullscreen = ref(false);

  // DOM 引用
  const officePreviewRef = ref(null);

  // ===== 計算屬性 =====

  /**
   * 檔案型別資訊
   */
  const fileTypeInfo = computed(() => {
    if (!file.value) return null;
    const mimeType = file.value.mimetype;
    return {
      mimeType,
      filename: file.value.name,
      displayName: file.value.name || file.value.filename || "",
    };
  });

  // 檔案型別判斷計算屬性 - 直接依賴後端返回的列舉型別
  const isImageFile = computed(() => file.value?.type === FileType.IMAGE);
  const isVideoFile = computed(() => file.value?.type === FileType.VIDEO);
  const isAudioFile = computed(() => file.value?.type === FileType.AUDIO);
  const isOfficeFile = computed(() => file.value?.type === FileType.OFFICE);
  const isTextFile = computed(() => file.value?.type === FileType.TEXT);

  // 基於檔案型別的判斷
  const isPdfFile = computed(() => file.value?.type === FileType.DOCUMENT);
  const isEbookFile = computed(() => {
    if (!file.value) return false;
    const filename = file.value?.name || file.value?.filename || "";
    const ext = getExtension(filename);
    const mime = String(file.value?.mimetype || "").toLowerCase();
    if (EBOOK_EXTS.has(ext)) return true;
    return EBOOK_MIMES.has(mime);
  });

  /**
   * 預覽URL - 基於 Link JSON 中的 previewUrl
   * 在 FS 檢視下由後端統一構造為最終可訪問的 inline 入口
   */
  const previewUrl = computed(() => {
    if (!file.value) return "";
    return file.value.previewUrl || "";
  });

  /**
   * 獲取認證預覽URL（保留方法以相容可能的工具場景）
   * FS 檢視下預設直接使用 previewUrl，正常預覽不再依賴 Blob 模式
   */
  const fetchAuthenticatedUrl = async () => {
    const url = previewUrl.value;
    if (!url) {
      log.warn("預覽URL為空，無法獲取認證預覽URL");
      return;
    }
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = url;
  };

  // ===== Office預覽處理 =====

  /**
   * 更新Office預覽URLs
   * FS 檢視下不再在前端生成 Office 直鏈，只保留載入/錯誤狀態佔位
   */
  const updateOfficePreviewUrls = async () => {
    officePreviewLoading.value = false;
    officePreviewError.value = "";
    officePreviewTimedOut.value = false;
  };

  /**
   * 清除預覽載入超時計時器（佔位實現）
   */
  const clearPreviewLoadTimeout = () => {
    if (previewTimeoutId.value) {
      clearTimeout(previewTimeoutId.value);
      previewTimeoutId.value = null;
    }
  };

  // ===== 全屏功能 =====

  /**
   * 通用全屏處理函式
   */
  const toggleFullscreen = (elementRef, isFullscreenState, onEnter, onExit) => {
    if (!isFullscreenState.value) {
      // 進入全屏
      if (elementRef.value && document.fullscreenEnabled) {
        elementRef.value
          .requestFullscreen()
          .then(() => {
            isFullscreenState.value = true;
            if (onEnter) onEnter();
            log.debug("進入全屏模式");
          })
          .catch((error) => {
            log.error("進入全屏失敗:", error);
            // 降級處理：使用CSS全屏效果
            isFullscreenState.value = true;
            if (onEnter) onEnter();
          });
      } else {
        // 降級處理：使用CSS全屏效果
        isFullscreenState.value = true;
        if (onEnter) onEnter();
      }
    } else {
      // 退出全屏
      if (document.fullscreenElement) {
        document
          .exitFullscreen()
          .then(() => {
            isFullscreenState.value = false;
            if (onExit) onExit();
            log.debug("退出全屏模式");
          })
          .catch((error) => {
            log.error("退出全屏失敗:", error);
            isFullscreenState.value = false;
            if (onExit) onExit();
          });
      } else {
        isFullscreenState.value = false;
        if (onExit) onExit();
      }
    }
  };

  /**
   * 切換Office全屏
   */
  const toggleOfficeFullscreen = () => {
    toggleFullscreen(
      officePreviewRef,
      isOfficeFullscreen,
      () => {
        // 進入全屏時的回撥
        log.debug("Office預覽進入全屏");
      },
      () => {
        // 退出全屏時的回撥
        log.debug("Office預覽退出全屏");
      }
    );
  };

  // ===== HTML全屏功能已移除 =====

  /**
   * 監聽全屏變化事件
   */
  const handleFullscreenChange = () => {
    // 如果不在全屏狀態，重置全屏標誌
    if (!document.fullscreenElement) {
      isOfficeFullscreen.value = false;
      log.debug("全屏狀態已重置");
    }
  };

  /**
   * 監聽Esc鍵退出全屏
   */
  const handleKeyDown = (e) => {
    // 瀏覽器原生全屏API會自動處理Esc鍵退出全屏
    // 這裡可以新增其他鍵盤快捷鍵處理邏輯
    if (e.key === "Escape") {
      log.debug("檢測到Esc鍵，全屏狀態將由瀏覽器處理");
    }
  };
  
  //自動清理
  useEventListener(document, "fullscreenchange", handleFullscreenChange);
  useEventListener(document, "keydown", handleKeyDown);

  // ===== 事件處理 =====

  let lastContentLoadedKey = "";

  const buildContentLoadedKey = () => {
    const f = file.value;
    const fp = f?.path || f?.id || f?.name || "";
    const url = authenticatedPreviewUrl.value || previewUrl.value || "";
    return `${fp}::${url}`;
  };

  /**
   * 處理內容載入完成
   */
  const handleContentLoaded = () => {
    const key = buildContentLoadedKey();
    if (key && key === lastContentLoadedKey) return;
    lastContentLoadedKey = key;
    log.debug("內容載入完成");
    emit("loaded");
  };

  /**
   * 處理內容載入錯誤
   */
  const handleContentError = async (error) => {
    log.error("內容載入錯誤:", error);

    const currentFile = file.value;
    const currentUrl = authenticatedPreviewUrl.value || "";
    const filename = currentFile?.name || "";
    const mimetype = currentFile?.mimetype || "";

    // 僅在“圖片預覽 + 首次載入失敗 + 可解碼格式”時做解碼回退
    if (
      isImageFile.value &&
      !hasTriedImageDecodeFallback.value &&
      shouldAttemptDecodeImagePreview({ filename, mimetype }) &&
      typeof currentUrl === "string" &&
      !currentUrl.startsWith("blob:")
    ) {
      hasTriedImageDecodeFallback.value = true;
      try {
        log.debug("圖片解碼回退開始:", { filename, mimetype, url: currentUrl });
        const { objectUrl } = await decodeImagePreviewUrlToPngObjectUrl({ url: currentUrl, filename, mimetype });
        revokeObjectUrl(authenticatedPreviewUrl.value);
        authenticatedPreviewUrl.value = objectUrl;
        loadError.value = false;
        log.debug("圖片解碼回退成功:", { filename, objectUrl });
        return;
      } catch (decodeError) {
        log.error("圖片解碼回退失敗:", decodeError);
        // 繼續走通用錯誤處理
      }
    }

    loadError.value = true;
    emit("error", error);
  };

  // ===== 工具方法 =====

  /**
   * 格式化檔案大小
   */
  const formatFileSize = (size) => {
    return formatFileSizeUtil(size);
  };

  /**
   * 格式化日期
   */
  const formatDate = (dateString) => {
    if (!dateString) return "";
    return formatDateTime(dateString);
  };

  // ===== 初始化和清理 =====

  /**
   * 初始化預覽（僅保留基本功能）
   */
  const initializePreview = async () => {
    // 文字/程式碼/Markdown/HTML預覽已移除
    // 圖片、影片、音訊、PDF、Office預覽由模板中的條件渲染處理
    log.debug("預覽初始化完成");
  };

  /**
   * 為檔案初始化
   */
  const initializeForFile = async (newFile) => {
    // 重置基本狀態
    loadError.value = false;
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = null;
    hasTriedImageDecodeFallback.value = false;

    // 重置Office預覽狀態
    officePreviewLoading.value = false;
    officePreviewError.value = "";
    officePreviewTimedOut.value = false;
    isOfficeFullscreen.value = false;
    clearPreviewLoadTimeout();

    log.debug("檔案預覽渲染器已重置，準備預覽新檔案:", newFile?.name || "無檔案");
  };

  /**
   * 重新初始化預覽（主題變化時）
   */
  const reinitializePreviewOnThemeChange = async () => {
    // 文字/程式碼/Markdown/HTML預覽已移除
    // 圖片、影片、音訊、PDF、Office預覽不需要主題重新初始化
    log.debug("主題變化預覽重新初始化完成");
  };

  // ===== 監聽器 =====

  /**
   * 監聽暗色模式變化
   */
  watch(
    () => darkMode?.value,
    () => {
      reinitializePreviewOnThemeChange();
    }
  );

  /**
   * 監聽檔案變化
   */
  watch(
    () => file.value,
    async (newFile) => {
      // 檔案變更：允許下一次 loaded 重新觸發
      lastContentLoadedKey = "";
      // 重置基本狀態
      loadError.value = false;
      revokeObjectUrl(authenticatedPreviewUrl.value);
      authenticatedPreviewUrl.value = null;
      hasTriedImageDecodeFallback.value = false;
      isDecodingImage.value = false;
      if (imageDecodeAbortController.value) {
        imageDecodeAbortController.value.abort();
        imageDecodeAbortController.value = null;
      }

      // 重置Office預覽狀態
      officePreviewLoading.value = false;
      officePreviewError.value = "";
      officePreviewTimedOut.value = false;
      clearPreviewLoadTimeout();

      // 重置全屏狀態
      isOfficeFullscreen.value = false;

      // 只有當檔案存在時才初始化預覽
      if (newFile) {
        // 新增詳細的檔案型別判斷日誌
        log.debug(`檔案預覽型別分析: ${newFile.name}`);
        log.debug("檔案資訊:", {
          name: newFile.name,
          mimetype: newFile.mimetype,
          size: newFile.size,
          path: newFile.path,
        });

        // 獲取檔案型別資訊
        const typeInfo = fileTypeInfo.value;
        log.debug("檔案型別檢測結果:", typeInfo);

        // 顯示保留的型別判斷結果
        const typeChecks = {
          isImage: isImageFile.value,
          isVideo: isVideoFile.value,
          isAudio: isAudioFile.value,
          isPdf: isPdfFile.value,
          isEbook: isEbookFile.value,
          isOffice: isOfficeFile.value,
          isText: isTextFile.value,
        };
        log.debug("型別判斷結果:", typeChecks);

        // 顯示最終選擇的預覽型別
        const selectedType = Object.entries(typeChecks).find(([, value]) => value)?.[0] || "unknown";
        log.debug(`最終預覽型別: ${selectedType}`);

        if (typeChecks.isImage) {
          const filename = newFile?.name || "";
          const mimetype = newFile?.mimetype || "";
          const url = previewUrl.value || "";

          if (url && shouldAttemptDecodeImagePreview({ filename, mimetype })) {
            const expectedFileName = filename;
            const controller = new AbortController();
            imageDecodeAbortController.value = controller;
            isDecodingImage.value = true;
            hasTriedImageDecodeFallback.value = true;

            try {
              log.debug("圖片預解碼開始:", { filename, mimetype, url });
              const decoded = await decodeImagePreviewUrlToPngObjectUrl({
                url,
                filename,
                mimetype,
                signal: controller.signal,
              });

              if (controller.signal.aborted) return;
              if (file.value?.name !== expectedFileName) return;
              
              log.debug("圖片預解碼成功:", { filename, objectUrl: decoded.objectUrl });

              revokeObjectUrl(authenticatedPreviewUrl.value);
              authenticatedPreviewUrl.value = decoded.objectUrl;
              loadError.value = false;
            } catch (decodeError) {
              if (controller.signal.aborted) return;
              log.error("圖片預解碼失敗:", decodeError);
              loadError.value = true;
              emit("error", decodeError);
            } finally {
              if (!controller.signal.aborted) {
                isDecodingImage.value = false;
              }
              if (imageDecodeAbortController.value === controller) {
                imageDecodeAbortController.value = null;
              }
            }

            return;
          }

          authenticatedPreviewUrl.value = url;
        } else if (
          typeChecks.isVideo ||
          typeChecks.isAudio ||
          typeChecks.isPdf ||
          typeChecks.isEbook ||
          typeChecks.isText ||
          (file.value?.name && isArchiveFile(file.value.name))
        ) {
          // 直接使用 previewUrl 作為預覽入口
          authenticatedPreviewUrl.value = previewUrl.value;
        }

        // 如果是Office檔案，更新Office預覽URL
        if (typeChecks.isOffice) {
          updateOfficePreviewUrls();
        }
      }
    },
    { immediate: true }
  );

  // ===== 生命週期鉤子 =====

  /**
   * 元件掛載時的初始化
   */
  onMounted(() => {
    log.debug("檔案預覽元件已掛載");
  });

  /**
   * 元件解除安裝時的清理
   */
  onUnmounted(() => {
    // 清理URL資源
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = null;
    if (imageDecodeAbortController.value) {
      imageDecodeAbortController.value.abort();
      imageDecodeAbortController.value = null;
    }

    // 清除計時器
    if (previewTimeoutId.value) {
      clearTimeout(previewTimeoutId.value);
      previewTimeoutId.value = null;
    }

    log.debug("檔案預覽元件已解除安裝");
  });

  // ===== 擴充套件功能將在上層整合 =====
  // 移除了對 useFilePreviewExtensions 的直接呼叫以避免迴圈依賴

  return {
    // 保留的狀態
    loadError,
    authenticatedPreviewUrl,
    officePreviewLoading,
    officePreviewError,
    officePreviewTimedOut,
    previewTimeoutId,
    isOfficeFullscreen,

    // 保留的計算屬性
    fileTypeInfo,
    isImage: isImageFile,
    isVideo: isVideoFile,
    isAudio: isAudioFile,
    isPdf: isPdfFile,
    isOffice: isOfficeFile,
    isText: isTextFile,
    previewUrl,

    // 保留的DOM引用
    officePreviewRef,

    // 保留的方法
    fetchAuthenticatedUrl,
    updateOfficePreviewUrls,
    initializePreview,
    toggleFullscreen,
    handleFullscreenChange,
    handleKeyDown,
    handleContentLoaded,
    handleContentError,
    formatFileSize,
    formatDate,
    toggleOfficeFullscreen,
    reinitializePreviewOnThemeChange,
    initializeForFile,

    // 擴充套件功能將在上層整合
  };
}
