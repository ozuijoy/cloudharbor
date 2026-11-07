<template>
  <div
    ref="previewContainerRef"
    class="video-preview rounded-lg overflow-hidden mb-2 w-full relative border border-gray-200 dark:border-gray-700 flex flex-col"
    :class="isFullscreen ? 'h-screen' : ''"
  >
    <PreviewProviderHeader
      :title="filename || t('fileView.preview.video.title')"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 影片預覽內容 -->
    <div
      class="relative bg-gray-900"
      :class="isFullscreen ? 'flex-1 min-h-0' : 'h-[calc(100vh-350px)] min-h-[300px]'"
    >
      <VideoPlayer
        ref="videoPlayerRef"
        v-if="currentPreviewUrl && videoData && !shareHlsBlocked"
        :video="videoData"
        :dark-mode="darkMode"
        :autoplay="false"
        :volume="0.7"
        :muted="false"
        :loop="false"
        :custom-controls="[]"
        class="w-full h-full"
        @play="handlePlay"
        @pause="handlePause"
        @error="handleError"
        @canplay="handleCanPlay"
        @ended="handleVideoEnded"
        @timeupdate="handleTimeUpdate"
        @fullscreen="handlePlayerFullscreen"
        @fullscreenExit="handleFullscreenExit"
        @ready="handlePlayerReady"
      />

      <!-- 分享頁：m3u8 如果引用了相對分片（ts/m4s/key），單檔案分享會 404，直接提示即可 -->
      <div
        v-if="shareHlsBlocked"
        class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 p-6"
      >
        <div class="max-w-xl w-full rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-4">
          <div class="text-base font-semibold text-gray-900 dark:text-white mb-2">
            {{ t("fileView.preview.video.hlsShareNotSupportedTitle") }}
          </div>
          <div class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
            {{ t("fileView.preview.video.hlsShareNotSupportedTip") }}
          </div>
        </div>
      </div>

      <!-- 載入狀態 -->
      <div
        v-if="!videoData && !shareHlsBlocked"
        class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700"
      >
        <LoadingIndicator
          :text="t('fileView.preview.video.loading')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener } from "@vueuse/core";
import VideoPlayer from "@/components/common/VideoPlayer.vue";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("VideoPreview");

// Props 定義
const props = defineProps({
  // 多源預覽架構
  providers: {
    type: Object,
    default: () => ({}),
  },
  nativeUrl: {
    type: String,
    default: "",
  },
  // 相容舊呼叫
  previewUrl: {
    type: String,
    default: "",
  },
  linkType: {
    type: String,
    default: null,
  },
  mimetype: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits 定義
const emit = defineEmits(["load", "error", "play", "pause", "fullscreen", "fullscreenExit"]);

// 容器 ref 和全屏狀態
const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

// 解析 nativeUrl
const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

// 使用統一的 provider 選擇器
const {
  providerOptions,
  selectedKey: selectedProviderKey,
  currentUrl: currentPreviewUrl,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.video.browserNative")),
});

// 響應式資料
const videoPlayerRef = ref(null);
const isPlaying = ref(false);
const originalTitle = ref("");
const currentTime = ref(0);
const duration = ref(0);

// 當前影片資料（響應式）
const currentVideoData = ref(null);

// 為了相容性，保留 videoData 計算屬性
const videoData = computed(() => currentVideoData.value);

const shareHlsBlocked = ref(false);

// 分享頁的 m3u8 識別（只靠檔名/MIME，不依賴 URL 字尾）
const isHlsByMeta = computed(() => {
  const name = String(props.filename || "").toLowerCase();
  const mt = String(props.mimetype || "").toLowerCase();
  return name.endsWith(".m3u8") || mt.includes("mpegurl") || mt.includes("application/vnd.apple.mpegurl");
});

// 分享頁 HLS：只做最輕量的“相對路徑 -> 絕對 URL”糾正
const createShareHlsUrlTransform = () => {
  return async (requestUrl) => {
    const raw = String(requestUrl || "").trim();
    if (!raw) return requestUrl;
    // 已經是絕對地址/根路徑/資料URL，直接放行
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//") || raw.startsWith("/") || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return requestUrl;
    }
    // 禁止跳目錄
    if (raw.split("/").includes("..")) return requestUrl;
    try {
      const base = new URL(currentPreviewUrl.value, window.location.href);
      return new URL(raw, base).toString();
    } catch {
      return requestUrl;
    }
  };
};

const shareHlsUrlTransform = computed(() => (isHlsByMeta.value ? createShareHlsUrlTransform() : null));

const detectRelativeRefsInM3u8 = async (playlistUrl) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
  try {
    const res = await fetch(playlistUrl, {
      method: "GET",
      headers: { accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*" },
      signal: controller?.signal,
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text) return false;

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("#EXT-X-KEY")) {
        const m = /URI="([^"]+)"/i.exec(line);
        const uri = m?.[1] ? String(m[1]).trim() : "";
        if (uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !uri.startsWith("/") && !uri.startsWith("//")) return true;
        continue;
      }
      if (line.startsWith("#")) continue;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !line.startsWith("/") && !line.startsWith("//")) return true;
    }
    return false;
  } catch {
    // 拉不到 playlist（CORS/網路）就不攔截，避免誤傷“本來能播”的情況
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// 更新頁面標題
const updatePageTitle = (playing = false, fileName = null) => {
  const title = fileName || "影片預覽";
  document.title = playing ? `${title}` : `${title}`;
};

// 恢復原始頁面標題
const restoreOriginalTitle = () => {
  if (originalTitle.value) {
    document.title = originalTitle.value;
  }
};

// 生成預設海報
const generateDefaultPoster = (fileName) => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Arial";
  ctx.textAlign = "center";
  ctx.fillText("🎬", canvas.width / 2, canvas.height / 2 - 10);
  ctx.font = "12px Arial";
  ctx.fillText(fileName || "影片檔案", canvas.width / 2, canvas.height / 2 + 15);

  return canvas.toDataURL();
};

// 事件處理函式
const handlePlay = (data) => {
  isPlaying.value = true;
  const videoName = data?.video?.name || props.filename;
  updatePageTitle(true, videoName);
  emit("play", data);
};

const handlePause = (data) => {
  isPlaying.value = false;
  const videoName = data?.video?.name || props.filename;
  updatePageTitle(false, videoName);
  emit("pause", data);
};

const handleError = (error) => {
  // 忽略Service Worker相關的誤報錯誤
  if (error?.target?.src?.includes(window.location.origin) && currentVideoData.value?.url) {
    return;
  }

  isPlaying.value = false;
  log.error("影片播放錯誤:", error);
  emit("error", error);
};

const handleCanPlay = () => {
  emit("load");
};

const handleTimeUpdate = (data) => {
  currentTime.value = data.currentTime;
  duration.value = data.duration;
};

// 處理影片播放結束
const handleVideoEnded = () => {
  isPlaying.value = false;
  updatePageTitle(false, props.filename);
};

// 處理全屏事件（來自播放器內部）
const handlePlayerFullscreen = () => {
  emit("fullscreen");
};

const handleFullscreenExit = () => {
  emit("fullscreenExit");
};

// 處理播放器準備就緒
const handlePlayerReady = () => {
  // 播放器準備就緒
};

// 初始化當前影片資料
const initializeCurrentVideo = async () => {
  const url = currentPreviewUrl.value;
  if (!url) {
    return;
  }

  shareHlsBlocked.value = false;
  if (isHlsByMeta.value) {
    const hasRelative = await detectRelativeRefsInM3u8(url);
    if (hasRelative) {
      // 單檔案分享 + 相對分片：瀏覽器一定會去請求 /proxy/share/<ts>，導致 404
      shareHlsBlocked.value = true;
      currentVideoData.value = null;
      return;
    }
  }

  // 構建影片資料物件
  currentVideoData.value = {
    name: props.filename || "影片檔案",
    title: props.filename || "影片預覽",
    url: url,
    linkType: props.linkType || null,
    poster: generateDefaultPoster(props.filename),
    contentType: props.mimetype,
    mimetype: props.mimetype,
    isHLS: isHlsByMeta.value,
    hlsUrlTransform: isHlsByMeta.value ? shareHlsUrlTransform.value : null,
  };
};

// 監聽 currentPreviewUrl 變化
watch(
  currentPreviewUrl,
  async (newUrl) => {
    if (newUrl) {
      await initializeCurrentVideo();
    }
  },
  { immediate: true }
);

// 快捷鍵處理
const handleKeydown = (event) => {
  // 如果使用者正在輸入框中輸入，不處理快捷鍵
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  const player = videoPlayerRef.value?.getInstance();
  if (!player) return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      player.toggle();
      break;
    case "ArrowLeft":
      event.preventDefault();
      player.seek = Math.max(0, player.currentTime - 10);
      break;
    case "ArrowRight":
      event.preventDefault();
      player.seek = Math.min(player.duration, player.currentTime + 10);
      break;
    case "ArrowUp":
      event.preventDefault();
      player.volume = Math.min(1, player.volume + 0.1);
      break;
    case "ArrowDown":
      event.preventDefault();
      player.volume = Math.max(0, player.volume - 0.1);
      break;
    case "KeyF":
      event.preventDefault();
      player.fullscreen = !player.fullscreen;
      break;
  }
};

// 註冊鍵盤事件（自動清理）
useEventListener(document, "keydown", handleKeydown);

// 生命週期鉤子
onMounted(() => {
  originalTitle.value = document.title;
});

onBeforeUnmount(() => {
  restoreOriginalTitle();
});
</script>

<style scoped>
/* 全屏時預覽容器填滿螢幕 */
.video-preview :deep(:fullscreen),
.video-preview :deep(:-webkit-full-screen),
.video-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: #000;
}

/* 確保 VideoPlayer 和 Artplayer 填滿容器 */
.video-preview :deep(.video-player-container),
.video-preview :deep(.artplayer-container),
.video-preview :deep(.art-video-player) {
  width: 100% !important;
  height: 100% !important;
}

/* 移動端最佳化 */
@media (max-width: 768px) {
  .video-preview {
    min-height: 200px;
  }
}
</style>
