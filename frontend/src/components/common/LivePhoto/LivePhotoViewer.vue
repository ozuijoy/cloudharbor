<template>
  <div
    ref="containerRef"
    class="live-photo-viewer"
    :class="{
      'live-photo-viewer--playing': state.isPlaying,
      'live-photo-viewer--loading': state.isLoading,
      'live-photo-viewer--error': state.hasError,
      'live-photo-viewer--dark': darkMode,
    }"
    :style="containerStyle"
  >
    <!-- 內容框：按“contain”規則計算，保證長圖不裁切且影片/圖片幾何區域一致 -->
    <div class="live-photo-viewer__content" :style="contentStyle">
      <!-- 媒體容器 -->
      <div class="live-photo-viewer__media">
        <!-- 影片層 -->
        <video
          ref="videoRef"
          class="live-photo-viewer__video"
          :src="lazyLoad ? undefined : videoSrc"
          :data-src="lazyLoad ? videoSrc : undefined"
          playsinline
          preload="metadata"
          :muted="muted"
          :loop="loop"
          @loadedmetadata="handleVideoLoadedMetadata"
        />

        <!-- 圖片層 -->
        <img
          ref="imageRef"
          class="live-photo-viewer__image"
          :src="photoSrc"
          :alt="alt"
          loading="lazy"
          @load="handleImageLoad"
          @error="handleImageError"
        />
      </div>

      <!-- 進度條 -->
      <div v-if="showProgress && state.isLoading" class="live-photo-viewer__progress">
        <div class="live-photo-viewer__progress-bar" :style="{ width: `${state.progress}%` }" />
      </div>

      <!-- 徽章圖示 -->
      <div
        v-if="showBadge"
        class="live-photo-viewer__badge"
        :class="{ 'live-photo-viewer__badge--static': staticBadge }"
        @mouseenter="!isMobileDevice && handleMouseEnter()"
        @mouseleave="!isMobileDevice && handleMouseLeave()"
      >
        <!-- 錯誤圖示 -->
        <IconExclamationSolid v-if="state.hasError" class="live-photo-viewer__badge-icon live-photo-viewer__badge-icon--error" />
        <!-- Live Photo 圖示 -->
        <span v-else v-html="livePhotoBadgeIconSvg" />
        <span v-if="showBadgeText" class="live-photo-viewer__badge-text">{{ badgeText || t("livePhoto.badge") }}</span>
      </div>

      <!-- 觸控覆蓋層（移動端） -->
      <div
        v-if="isMobileDevice"
        class="live-photo-viewer__overlay"
        @touchstart.prevent="handleTouchStart"
        @touchend="handleTouchEnd"
        @touchcancel="handleTouchEnd"
      />

      <!-- 警告提示 -->
      <Transition name="live-photo-warning">
        <div v-if="state.hasError && state.errorMessage" class="live-photo-viewer__warning">
          {{ warningMessage }}
        </div>
      </Transition>

      <!-- 載入指示器 -->
      <div v-if="state.isLoading && showLoadingIndicator" class="live-photo-viewer__loading">
        <LoadingIndicator size="xl" icon-class="text-white" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch, onMounted, onBeforeUnmount, ref, toRef } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useLivePhoto, PlaybackStyle, LivePhotoErrorType } from "./useLivePhoto.js";
import { LIVE_PHOTO_BADGE_ICON_SVG } from "./livePhotoBadgeIconSvg.js";
import { IconExclamationSolid } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

const { t } = useI18n();
const livePhotoBadgeIconSvg = LIVE_PHOTO_BADGE_ICON_SVG;

// Props 定義
const props = defineProps({
  // 必需屬性
  photoSrc: {
    type: String,
    required: true,
  },
  videoSrc: {
    type: String,
    required: true,
  },

  // 尺寸控制
  width: {
    type: [Number, String],
    default: null,
  },
  height: {
    type: [Number, String],
    default: null,
  },
  aspectRatio: {
    type: [Number, String],
    default: null,
  },
  maxWidth: {
    type: [Number, String],
    default: "100%",
  },
  maxHeight: {
    type: [Number, String],
    default: null,
  },

  // 行為控制
  autoplay: {
    type: Boolean,
    default: false,
  },
  lazyLoad: {
    type: Boolean,
    default: true,
  },
  longPressDelay: {
    type: Number,
    default: 300,
  },
  enableVibration: {
    type: Boolean,
    default: true,
  },
  muted: {
    type: Boolean,
    default: true,
  },
  loop: {
    type: Boolean,
    default: false,
  },
  playbackStyle: {
    type: String,
    default: PlaybackStyle.FULL,
    validator: (value) => Object.values(PlaybackStyle).includes(value),
  },
  stillImageTime: {
    type: Number,
    default: null,
  },

  // 外觀控制
  darkMode: {
    type: Boolean,
    default: false,
  },
  borderRadius: {
    type: [Number, String],
    default: 8,
  },
  showBadge: {
    type: Boolean,
    default: true,
  },
  showBadgeText: {
    type: Boolean,
    default: true,
  },
  badgeText: {
    type: String,
    default: "",
  },
  staticBadge: {
    type: Boolean,
    default: false,
  },
  showProgress: {
    type: Boolean,
    default: true,
  },
  showLoadingIndicator: {
    type: Boolean,
    default: false,
  },
  alt: {
    type: String,
    default: "Live Photo",
  },

  // 樣式定製
  imageStyle: {
    type: Object,
    default: () => ({}),
  },
  videoStyle: {
    type: Object,
    default: () => ({}),
  },
});

// Emits 定義
const emit = defineEmits(["play", "pause", "ended", "error", "load", "progress", "canplay", "click"]);

// 使用 composable
const {
  state,
  config,
  containerRef,
  videoRef,
  imageRef,
  canPlay,
  isMobileDevice,
  play,
  pause,
  stop,
  toggle,
  warmVideo,
  destroy,
  reset,
  handleTouchStart: baseTouchStart,
  handleTouchEnd: baseTouchEnd,
  handleMouseEnter,
  handleMouseLeave,
} = useLivePhoto({
  // 傳入 Ref，確保 composable 內部 watch 能正確響應 prop 變化
  photoSrc: toRef(props, "photoSrc"),
  videoSrc: toRef(props, "videoSrc"),
  autoplay: props.autoplay,
  lazyLoad: props.lazyLoad,
  longPressDelay: props.longPressDelay,
  enableVibration: props.enableVibration,
  stillImageTime: props.stillImageTime,
  playbackStyle: props.playbackStyle,
  onPlay: () => emit("play"),
  onPause: () => emit("pause"),
  onEnded: () => emit("ended"),
  onError: (error) => emit("error", error),
  onProgress: (progress) => emit("progress", progress),
  onCanPlay: () => emit("canplay"),
  onClick: (e) => emit("click", e),
});

const warningMessage = computed(() => {
  if (!state.hasError || !state.errorMessage) return "";
  if (typeof state.errorMessage === "string" && state.errorMessage.startsWith("livePhoto.")) {
    return t(state.errorMessage);
  }
  return state.errorMessage;
});

const parseAspectRatio = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return value > 0 ? value : null;

  const text = value.toString().trim();
  if (!text) return null;

  if (text.includes("/")) {
    const [aRaw, bRaw] = text.split("/");
    const a = Number(aRaw?.trim());
    const b = Number(bRaw?.trim());
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) return a / b;
    return null;
  }

  const num = Number(text);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
};

const measuredAspectRatio = ref(null);
const containerSize = ref({ width: 0, height: 0 });

const measureContainer = () => {
  const el = containerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  containerSize.value = { width: rect.width, height: rect.height };
};

const { stop: stopResizeObserver } = useResizeObserver(containerRef, () => {
  measureContainer();
});

const baseAspectRatio = computed(() => {
  return parseAspectRatio(props.aspectRatio) ?? measuredAspectRatio.value ?? null;
});

const contentStyle = computed(() => {
  const ratio = baseAspectRatio.value;
  const { width, height } = containerSize.value;

  if (!ratio || !width || !height) {
    return { top: "0px", left: "0px", width: "100%", height: "100%" };
  }

  const containerRatio = width / height;
  let contentWidth = width;
  let contentHeight = height;
  let left = 0;
  let top = 0;

  // contain：保證內容完整可見，不裁切
  if (containerRatio > ratio) {
    contentHeight = height;
    contentWidth = height * ratio;
    left = (width - contentWidth) / 2;
    top = 0;
  } else {
    contentWidth = width;
    contentHeight = width / ratio;
    left = 0;
    top = (height - contentHeight) / 2;
  }

  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${contentWidth}px`,
    height: `${contentHeight}px`,
  };
});

// 計算樣式
const containerStyle = computed(() => {
  const style = {};

  if (!props.width && !props.height) {
    style.width = "100%";
  }

  if (props.width) {
    style.width = typeof props.width === "number" ? `${props.width}px` : props.width;
  }

  if (props.height) {
    style.height = typeof props.height === "number" ? `${props.height}px` : props.height;
  }

  if (props.aspectRatio) {
    style.aspectRatio = props.aspectRatio.toString();
  }

  if (props.maxWidth) {
    style.maxWidth = typeof props.maxWidth === "number" ? `${props.maxWidth}px` : props.maxWidth;
  }

  if (props.maxHeight) {
    style.maxHeight = typeof props.maxHeight === "number" ? `${props.maxHeight}px` : props.maxHeight;
  }

  if (props.borderRadius) {
    style["--live-photo-border-radius"] = typeof props.borderRadius === "number" ? `${props.borderRadius}px` : props.borderRadius;
  }

  return style;
});

// 事件處理
const handleTouchStart = (e) => {
  baseTouchStart(e);
};

const handleTouchEnd = (e) => {
  baseTouchEnd(e);
};

const handleImageLoad = (e) => {
  // 自動計算寬高比
  if (!props.aspectRatio && imageRef.value) {
    const img = imageRef.value;
    const ratio = img.naturalWidth / img.naturalHeight;
    measuredAspectRatio.value = ratio;
    if (containerRef.value && !props.width && !props.height) {
      containerRef.value.style.aspectRatio = ratio.toString();
    }
  }
  requestAnimationFrame(() => measureContainer());
  emit("load", e);
};

const handleImageError = (e) => {
  state.hasError = true;
  state.isPlaying = false;
  state.isLoading = false;
  state.isLoaded = false;
  state.errorMessage = "livePhoto.errors.photoLoadFailed";
  emit("error", { type: LivePhotoErrorType.PHOTO_LOAD_ERROR, message: state.errorMessage, originalError: e });
};

const handleVideoLoadedMetadata = () => {
  // 影片後設資料載入完成
};

// 自動播放：等影片可播後再觸發，避免 mounted 時 canPlay 仍為 false
watch(
  () => [props.autoplay, canPlay.value],
  ([autoplay, ready]) => {
    if (autoplay && ready) {
      play();
    }
  },
  { immediate: true }
);

// 暴露方法給父元件
defineExpose({
  play,
  pause,
  stop,
  toggle,
  reset,
  destroy,
  warmVideo,
  state,
  canPlay,
});

// 自動播放
onMounted(() => {
  measureContainer();
});

onBeforeUnmount(() => {
  stopResizeObserver?.();
});
</script>

<style src="./LivePhotoViewer.css"></style>
