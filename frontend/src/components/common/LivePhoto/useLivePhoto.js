/**
 * Live Photo 核心邏輯 Composable
 *
 *
 * @module useLivePhoto
 */

import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, unref } from "vue";
import { useEventListener, useIntersectionObserver } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

/**
 * 錯誤型別定義
 */
export const LivePhotoErrorType = {
  VIDEO_LOAD_ERROR: "VIDEO_LOAD_ERROR",
  PHOTO_LOAD_ERROR: "PHOTO_LOAD_ERROR",
  PLAYBACK_ERROR: "PLAYBACK_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  FORMAT_NOT_SUPPORTED: "FORMAT_NOT_SUPPORTED",
};

/**
 * 播放模式
 */
export const PlaybackStyle = {
  HINT: "hint", // 短預覽（約1秒）
  FULL: "full", // 完整播放
};

/**
 * 建立 Live Photo 錯誤物件
 */
const createLivePhotoError = (type, message, originalError = null) => ({
  type,
  message,
  originalError,
  timestamp: Date.now(),
});

/**
 * 檢測是否為移動裝置
 */
const isMobile = () => {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
};

/**
 * Live Photo Composable
 *
 * @param {Object} options - 配置選項
 * @param {string | import("vue").Ref<string>} options.photoSrc - 圖片 URL（支援 Ref）
 * @param {string | import("vue").Ref<string>} options.videoSrc - 影片 URL（支援 Ref）
 * @param {boolean} [options.autoplay=false] - 是否自動播放
 * @param {boolean} [options.lazyLoad=true] - 是否懶載入影片
 * @param {number} [options.longPressDelay=300] - 長按觸發延遲（毫秒）
 * @param {boolean} [options.enableVibration=true] - 是否啟用觸覺反饋
 * @param {number} [options.stillImageTime=null] - 關鍵幀時間點（秒）
 * @param {string} [options.playbackStyle='full'] - 播放模式
 * @param {Function} [options.onPlay] - 播放開始回撥
 * @param {Function} [options.onPause] - 暫停回撥
 * @param {Function} [options.onEnded] - 播放結束回撥
 * @param {Function} [options.onError] - 錯誤回撥
 * @param {Function} [options.onProgress] - 載入進度回撥
 * @param {Function} [options.onCanPlay] - 可播放回撥
 */
export function useLivePhoto(options = {}) {
  const log = createLogger("LivePhoto");
  const readSources = () => ({
    photoSrc: unref(options.photoSrc) || "",
    videoSrc: unref(options.videoSrc) || "",
  });

  // 預設配置
  const initialSources = readSources();
  const config = reactive({
    photoSrc: initialSources.photoSrc,
    videoSrc: initialSources.videoSrc,
    autoplay: options.autoplay ?? false,
    lazyLoad: options.lazyLoad ?? true,
    longPressDelay: options.longPressDelay ?? 300,
    enableVibration: options.enableVibration ?? true,
    stillImageTime: options.stillImageTime ?? null,
    playbackStyle: options.playbackStyle ?? PlaybackStyle.FULL,
  });

  // 狀態管理
  const state = reactive({
    isPlaying: false,
    isLoading: false,
    isLoaded: false,
    hasError: false,
    errorMessage: "",
    progress: 0,
    duration: 0,
    currentTime: 0,
    isWarmed: false, // 影片是否已預熱
    isVisible: false, // 是否在視口內
  });

  // DOM 引用
  const containerRef = ref(null);
  const videoRef = ref(null);
  const imageRef = ref(null);

  // 內部狀態
  let touchStartTime = 0;
  let isWithin = false; // 用於處理觸控中斷
  let stopIntersectionObserver = null;
  let previewTimeoutId = null;
  let isLazyLoadSetup = false;

  // 計算屬性
  const canPlay = computed(() => state.isLoaded && !state.hasError);
  const isMobileDevice = computed(() => isMobile());

  /**
   * 影片預熱 - 解決移動端自動播放限制
   */
  const warmVideo = async () => {
    const video = videoRef.value;
    if (!video || state.isWarmed || !video.src) return;

    try {
      const wasMuted = video.muted;
      video.muted = true;

      await video.play();
      video.pause();

      video.muted = wasMuted;
      video.currentTime = 0;
      state.isWarmed = true;
    } catch (e) {
      // 預熱失敗不影響後續操作
      log.warn("[LivePhoto] Video warm-up failed:", e.message);
    }
  };

  /**
   * 設定懶載入
   */
  const setupLazyLoad = () => {
    if (!config.lazyLoad || !containerRef.value || isLazyLoadSetup) return;

    const { stop } = useIntersectionObserver(
      containerRef,
      (entries) => {
        entries.forEach((entry) => {
          state.isVisible = entry.isIntersecting;

          if (entry.isIntersecting && videoRef.value && !videoRef.value.src && config.videoSrc) {
            videoRef.value.src = config.videoSrc;
            state.isLoading = true;
          }
        });
      },
      { rootMargin: "100px" }
    );
    stopIntersectionObserver = stop;
    isLazyLoadSetup = true;
  };

  /**
   * 更新載入進度
   */
  const updateProgress = () => {
    const video = videoRef.value;
    if (!video || !video.buffered.length) return;

    const lastRangeIndex = Math.max(0, video.buffered.length - 1);
    const buffered = video.buffered.end(lastRangeIndex);
    const duration = video.duration || 1;
    state.progress = Math.floor((buffered / duration) * 100);
    state.duration = duration;

    options.onProgress?.(state.progress);

    if (state.progress >= 100) {
      state.isLoading = false;
    }
  };

  /**
   * 播放影片
   */
  const play = async () => {
    const video = videoRef.value;
    if (!video || state.isPlaying || state.hasError) return;

    try {
      // 如果影片未載入，先載入
      if (!video.src && config.videoSrc) {
        video.src = config.videoSrc;
        state.isLoading = true;
      }

      // 根據播放模式設定起始時間
      if (config.playbackStyle === PlaybackStyle.HINT && config.stillImageTime) {
        // HINT 模式：從關鍵幀前約1秒開始播放
        const previewStart = Math.max(0, config.stillImageTime - 1);
        video.currentTime = previewStart;
      } else {
        video.currentTime = 0;
      }

      await video.play();

      state.isPlaying = true;

      // 觸覺反饋
      if (config.enableVibration && navigator.vibrate) {
        navigator.vibrate(50);
      }

      options.onPlay?.();

      // HINT 模式下設定自動停止
      if (config.playbackStyle === PlaybackStyle.HINT && config.stillImageTime) {
        const duration = config.stillImageTime - video.currentTime;
        previewTimeoutId = setTimeout(() => {
          stop();
        }, duration * 1000);
      }
    } catch (error) {
      handleError(error);
    }
  };

  /**
   * 暫停影片
   */
  const pause = () => {
    const video = videoRef.value;
    if (!video || !state.isPlaying) return;

    video.pause();
    state.isPlaying = false;
    clearTimeout(previewTimeoutId);

    options.onPause?.();
  };

  /**
   * 停止影片並重置
   */
  const stop = () => {
    const video = videoRef.value;
    if (!video) return;

    video.pause();
    state.isPlaying = false;
    clearTimeout(previewTimeoutId);

    options.onPause?.();
  };

  /**
   * 切換播放狀態
   */
  const toggle = () => {
    state.isPlaying ? pause() : play();
  };

  /**
   * 錯誤處理
   */
  const handleError = (error) => {
    // 忽略使用者離開導致的中斷
    if (!isWithin && error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    state.hasError = true;
    state.isPlaying = false;
    state.isLoading = false;
    state.isLoaded = false;

    let errorType = LivePhotoErrorType.PLAYBACK_ERROR;
    let messageKey = "livePhoto.errors.playbackFailed";

    if (error instanceof DOMException) {
      const nameToKey = {
        NotAllowedError: "livePhoto.errors.notAllowed",
        AbortError: "livePhoto.errors.aborted",
        NotSupportedError: "livePhoto.errors.notSupported",
        NetworkError: "livePhoto.errors.networkError",
      };
      messageKey = nameToKey[error.name] || "livePhoto.errors.playbackFailed";
      if (error.name === "NotSupportedError") {
        errorType = LivePhotoErrorType.FORMAT_NOT_SUPPORTED;
      }
    } else if (error.target?.error) {
      const mediaError = error.target.error;
      const codeToKey = {
        1: "livePhoto.errors.aborted",
        2: "livePhoto.errors.networkError",
        3: "livePhoto.errors.decodeFailed",
        4: "livePhoto.errors.notSupported",
      };
      messageKey = codeToKey[mediaError.code] || "livePhoto.errors.videoLoadFailed";
      errorType = mediaError.code === 2 ? LivePhotoErrorType.NETWORK_ERROR : LivePhotoErrorType.VIDEO_LOAD_ERROR;
    }

    state.errorMessage = messageKey;

    const livePhotoError = createLivePhotoError(errorType, messageKey, error);
    options.onError?.(livePhotoError);
  };

  /**
   * 處理觸控開始
   */
  const handleTouchStart = (e) => {
    e.preventDefault();
    touchStartTime = Date.now();
    isWithin = true;
    play();
  };

  /**
   * 處理觸控結束
   */
  const handleTouchEnd = (e) => {
    const touchDuration = Date.now() - touchStartTime;
    isWithin = false;

    // 短按視為點選
    if (touchDuration < config.longPressDelay) {
      options.onClick?.(e);
    }

    stop();
  };

  /**
   * 處理滑鼠進入（桌面端）
   */
  const handleMouseEnter = () => {
    if (!state.hasError) {
      play();
    }
  };

  /**
   * 處理滑鼠離開（桌面端）
   */
  const handleMouseLeave = () => {
    if (!state.hasError) {
      stop();
    }
  };

  /**
   * 影片事件處理
   */
  const handleLoadedMetadata = () => {
    const video = videoRef.value;
    if (!video) return;
    state.duration = video.duration;
    if (config.stillImageTime === null) {
      // 如果沒有指定關鍵幀時間，預設使用影片中點
      config.stillImageTime = video.duration / 2;
    }
  };

  const handleCanPlayThrough = () => {
    state.isLoaded = true;
    state.isLoading = false;
    options.onCanPlay?.();
  };

  const handleEnded = () => {
    state.isPlaying = false;
    options.onEnded?.();
  };

  const handleTimeUpdate = () => {
    const video = videoRef.value;
    if (!video) return;
    state.currentTime = video.currentTime;
  };

  const handleProgressEvent = () => updateProgress();

  /** @type {Array<Function>} */
  let stopVideoEventListeners = [];

  const setupVideoEvents = () => {
    const video = videoRef.value;
    if (!video) return;

    cleanupVideoEvents();

    stopVideoEventListeners = [
      useEventListener(video, "progress", handleProgressEvent),
      useEventListener(video, "loadedmetadata", handleLoadedMetadata),
      useEventListener(video, "canplaythrough", handleCanPlayThrough),
      useEventListener(video, "ended", handleEnded),
      useEventListener(video, "error", handleError),
      useEventListener(video, "timeupdate", handleTimeUpdate),
    ];
  };

  /**
   * 清理影片事件
   */
  const cleanupVideoEvents = () => {
    if (Array.isArray(stopVideoEventListeners) && stopVideoEventListeners.length > 0) {
      stopVideoEventListeners.forEach((stop) => {
        try {
          stop?.();
        } catch {
          // ignore
        }
      });
    }
    stopVideoEventListeners = [];
  };

  /**
   * 銷燬例項
   */
  const destroy = () => {
    // 清理觀察器
    stopIntersectionObserver?.();
    stopIntersectionObserver = null;

    // 清理定時器
    clearTimeout(previewTimeoutId);

    // 清理事件
    cleanupVideoEvents();

    // 釋放媒體資源
    const video = videoRef.value;
    if (video) {
      video.pause();
      // 避免設定 video.src="" 導致瀏覽器將當前頁面 URL 解析為媒體地址
      video.removeAttribute("src");
      video.load();
    }

    const image = imageRef.value;
    if (image) {
      image.removeAttribute("src");
    }
  };

  /**
   * 更新配置
   */
  const updateConfig = (newOptions) => {
    Object.assign(config, newOptions);
  };

  /**
   * 重置狀態
   */
  const reset = () => {
    state.isPlaying = false;
    state.isLoading = false;
    state.hasError = false;
    state.errorMessage = "";
    state.progress = 0;
    state.currentTime = 0;

    const video = videoRef.value;
    if (video) {
      video.currentTime = 0;
    }
  };

  // 監聽配置變化
  watch(
    () => [unref(options.photoSrc), unref(options.videoSrc)],
    ([newPhotoSrc, newVideoSrc]) => {
      const nextPhotoSrc = newPhotoSrc || "";
      const nextVideoSrc = newVideoSrc || "";
      if (nextPhotoSrc === config.photoSrc && nextVideoSrc === config.videoSrc) return;

      reset();
      config.photoSrc = nextPhotoSrc;
      config.videoSrc = nextVideoSrc;
      state.isLoaded = false;
      state.isWarmed = false;

      // 懶載入場景下，影片 URL 變更時必須清理舊的 src；並在可見時立即觸發載入
      const video = videoRef.value;
      if (video && config.lazyLoad) {
        video.pause();
        video.removeAttribute("src");
        video.load();

        if (state.isVisible && config.videoSrc) {
          video.src = config.videoSrc;
          state.isLoading = true;
        }
      }
    }
  );

  // 生命週期
  onMounted(() => {
    setupVideoEvents();
    setupLazyLoad();

    // 首次使用者互動時預熱影片
    const warmOnInteraction = () => {
      warmVideo();
      stopWarmTouch?.();
      stopWarmMouse?.();
      stopWarmTouch = null;
      stopWarmMouse = null;
    };

    let stopWarmTouch = useEventListener(containerRef, "touchstart", warmOnInteraction, { once: true, passive: true });
    let stopWarmMouse = useEventListener(containerRef, "mouseenter", warmOnInteraction, { once: true });
  });

  onBeforeUnmount(() => {
    destroy();
  });

  return {
    // 狀態
    state,
    config,

    // DOM 引用
    containerRef,
    videoRef,
    imageRef,

    // 計算屬性
    canPlay,
    isMobileDevice,

    // 方法
    play,
    pause,
    stop,
    toggle,
    warmVideo,
    destroy,
    reset,
    updateConfig,

    // 事件處理器
    handleTouchStart,
    handleTouchEnd,
    handleMouseEnter,
    handleMouseLeave,
  };
}

export default useLivePhoto;
