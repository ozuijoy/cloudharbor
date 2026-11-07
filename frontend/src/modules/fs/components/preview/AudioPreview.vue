<template>
  <div class="audio-preview-container">
    <!-- 音訊預覽提示 -->
    <div class="audio-preview p-4">
      <!-- 載入中狀態 -->
      <div v-if="isLoadingPlaylist" class="text-center py-8">
        <LoadingIndicator
          :text="$t('mount.audioPreview.loadingAudio')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>

      <!-- 已傳送到全域性播放器的提示 -->
      <div v-else-if="sentToGlobalPlayer" class="flex flex-col items-center max-w-sm mx-auto py-8">
        <!-- 標題和描述 -->
        <div class="text-center mb-6">
          <h3
            class="text-lg font-semibold mb-1.5"
            :class="darkMode ? 'text-gray-100' : 'text-gray-900'"
          >
            {{ $t('mount.audioPreview.playingInGlobalPlayer') }}
          </h3>
          <p
            class="text-sm"
            :class="darkMode ? 'text-gray-400' : 'text-gray-600'"
          >
            {{ currentFileName }}
          </p>
        </div>
        <!-- 按鈕 -->
        <div class="flex w-full gap-2">
          <button
            class="flex-1 px-4 py-2 rounded-md border transition-colors flex items-center justify-center gap-1.5 text-sm font-medium"
            :class="[
              darkMode
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            ]"
            @click="backToLocalPreview"
          >
            <span>{{ $t('mount.audioPreview.backToPreview') }}</span>
          </button>
        </div>
      </div>

      <!-- 本地預覽模式（可選，用於首次載入時顯示） -->
      <div v-else-if="!sentToGlobalPlayer && audioUrl && audioData" class="audio-player-wrapper">
        <AudioPlayer
          ref="audioPlayerRef"
          :audio-list="finalAudioList"
          :current-audio="null"
          :dark-mode="darkMode"
          :autoplay="false"
          :show-playlist="true"
          :list-folded="true"
          :list-max-height="'380px'"
          :mode="'normal'"
          :volume="0.7"
          :loop="'all'"
          :order="'list'"
          @play="handlePlay"
          @pause="handlePause"
          @error="handleError"
          @canplay="handleCanPlay"
          @ended="handleAudioEnded"
          @listswitch="handleListSwitch"
        />
        <!-- 傳送到全域性播放器按鈕 - 懸浮在播放器右上角 -->
        <button
          class="send-to-global-btn"
          :class="{ 'dark': darkMode }"
          :title="$t('mount.audioPreview.sendToGlobalPlayer')"
          @click="sendToGlobalPlayer"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- 無音訊資料 -->
      <div v-else class="text-center py-8">
        <LoadingIndicator
          :text="$t('mount.audioPreview.loadingAudio')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener } from "@vueuse/core";
import AudioPlayer from "@/components/common/AudioPlayer.vue";
import { FileType } from "@/utils/fileTypes.js";
import { useFsService } from "@/modules/fs";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useGlobalPlayer } from "@/composables/useGlobalPlayer.js";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("AudioPreview");
const fsService = useFsService();

// 全域性播放器
const globalPlayer = useGlobalPlayer();

// Props 定義
const props = defineProps({
  // 檔案資訊
  file: {
    type: Object,
    required: true,
  },
  // 音訊URL
  audioUrl: {
    type: String,
    default: null,
  },
  // 是否為深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否為管理員
  isAdmin: {
    type: Boolean,
    default: false,
  },
  // 當前目錄路徑
  currentPath: {
    type: String,
    default: "",
  },
  // 目錄專案列表
  directoryItems: {
    type: Array,
    default: () => [],
  },
});

// Emits 定義
const emit = defineEmits(["play", "pause", "error", "canplay", "loaded"]);

// 響應式資料
const audioPlayerRef = ref(null);
const isPlaying = ref(false);
const originalTitle = ref("");

// 是否已傳送到全域性播放器
const sentToGlobalPlayer = ref(false);

// 播放列表相關
const audioPlaylist = ref([]);
const isLoadingPlaylist = ref(false);

// 當前音訊資料（響應式）
const currentAudioData = ref(null);

// ===== “按需獲取直鏈”快取（避免同一首反覆打 /fs/file-link）=====
const audioUrlCache = new Map();
const audioUrlPending = new Map();

// 用一個“很短的靜音 wav”當佔位 url：避免 APlayer 遇到空 url 就直接報錯/自動跳歌
// 說明：這不是最終播放內容，真正播放前會被我們替換成 /fs/file-link 返回的真實直鏈
const PLACEHOLDER_AUDIO_URL =
  "data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

// 當前檔名
const currentFileName = computed(() => props.file?.name || t("mount.audioPreview.unknownAudio"));

// 計算最終的播放列表
const finalAudioList = computed(() => {
  if (audioPlaylist.value.length > 0) {
    return audioPlaylist.value;
  } else if (currentAudioData.value) {
    return [currentAudioData.value];
  }
  return [];
});

// 為了相容性，保留 audioData 計算屬性
const audioData = computed(() => currentAudioData.value);

// 更新頁面標題
const updatePageTitle = (playing = false, fileName = null) => {
  const title = fileName || t("mount.audioPreview.audioPlayer");
  document.title = playing ? `🎵 ${title}` : `${title}`;
};

// 恢復原始頁面標題
const restoreOriginalTitle = () => {
  if (originalTitle.value) {
    document.title = originalTitle.value;
  }
};

// 傳送到全域性播放器
const sendToGlobalPlayer = () => {
  if (finalAudioList.value.length === 0) {
    log.warn("沒有可播放的音訊");
    return;
  }

  // 找到當前檔案在播放列表中的索引
  const currentIndex = finalAudioList.value.findIndex(
    (audio) => audio.originalFile?.path === props.file?.path || audio.name === props.file?.name
  );

  // 傳送到全域性播放器
  globalPlayer.playAudio(finalAudioList.value, Math.max(0, currentIndex));

  // 標記已傳送
  sentToGlobalPlayer.value = true;

  // 停止本地播放器
  if (audioPlayerRef.value) {
    const player = audioPlayerRef.value.getInstance?.();
    if (player) {
      player.pause();
    }
  }
};

// 返回本地預覽模式
const backToLocalPreview = () => {
  sentToGlobalPlayer.value = false;
};

// 事件處理函式
const handlePlay = (data) => {
  isPlaying.value = true;
  const audioName = data?.audio?.name;
  updatePageTitle(true, audioName);
  emit("play", data);
};

const handlePause = (data) => {
  isPlaying.value = false;
  const audioName = data?.audio?.name;
  updatePageTitle(false, audioName);
  emit("pause", data);
};

const handleError = (error) => {
  // “按需獲取直鏈”場景：如果當前這首還沒拿到 url，APlayer 可能會先拋一次錯誤，先忽略即可
  try {
    const ap = audioPlayerRef.value?.getInstance?.();
    const idx = ap?.list?.index;
    const current = typeof idx === "number" ? ap?.list?.audios?.[idx] : null;
    if (current && (!current.url || current.url === "" || current.url === PLACEHOLDER_AUDIO_URL)) {
      return;
    }
  } catch {
    // 忽略探測異常
  }

  if (error?.target?.src?.includes(window.location.origin) && currentAudioData.value?.url) {
    return;
  }
  isPlaying.value = false;
  emit("error", error);
};

const handleCanPlay = () => {
  emit("canplay");
  emit("loaded");
};

const handleAudioEnded = () => {
  isPlaying.value = false;
  updatePageTitle(false);
};

const handleListSwitch = (data) => {
  const audioIndex = data?.index?.index ?? data?.index;
  let audioName = null;
  if (data?.audio?.name) {
    audioName = data.audio.name;
  } else if (typeof audioIndex === "number" && finalAudioList.value[audioIndex]) {
    audioName = finalAudioList.value[audioIndex].name;
  }
  updatePageTitle(isPlaying.value, audioName);

  // 切歌時再去拿這首歌的直鏈（而不是進入預覽就把目錄裡所有音訊都打一次 file-link）
  if (typeof audioIndex === "number") {
    const ap = audioPlayerRef.value?.getInstance?.();
    const wasPlaying = !!ap?.audio && !ap.audio.paused;

    // 關鍵：如果當前曲目還是“佔位靜音”，讓 audio 自己 loop，避免它瞬間結束→APlayer 自動跳回上一首
    try {
      const currentUrl = ap?.list?.audios?.[audioIndex]?.url;
      if (ap?.audio && currentUrl === PLACEHOLDER_AUDIO_URL) {
        ap.audio.loop = true;
      }
    } catch {
      // 忽略
    }

    void ensureAudioUrlReady(audioIndex, { playAfter: wasPlaying });
  }
};

// 確保某一首歌有可播放的 url（沒有就現取一次 /fs/file-link）
const ensureAudioUrlReady = async (index, { playAfter = false } = {}) => {
  const list = finalAudioList.value;
  const item = list?.[index];
  if (!item) return null;

  const syncUrlAndMaybeResume = (url) => {
    const ap = audioPlayerRef.value?.getInstance?.();
    // 關鍵：要在替換 src 之前先記住“使用者是不是正在播放”
    const wasPlayingBeforeSwap = !!ap?.audio && !ap.audio.paused;

    syncAPlayerAudioUrl(index, url);

    const shouldResume = playAfter || wasPlayingBeforeSwap;
    if (!shouldResume) return;
    try { ap?.audio?.play?.(); } catch { /* 忽略 */ }
  };

  // 已有可用 url：直接返回
  if (item.url && item.url !== PLACEHOLDER_AUDIO_URL) {
    return item.url;
  }

  const filePath = item.originalFile?.path || props.file?.path;
  if (!filePath) return null;

  // 先查快取
  if (audioUrlCache.has(filePath)) {
    const cachedUrl = audioUrlCache.get(filePath);
    item.url = cachedUrl;
    syncUrlAndMaybeResume(cachedUrl);
    return cachedUrl;
  }

  // 同一路徑的併發請求合併
  if (audioUrlPending.has(filePath)) {
    const pending = audioUrlPending.get(filePath);
    const url = await pending;
    if (url) {
      item.url = url;
      syncUrlAndMaybeResume(url);
    }
    return url;
  }

  const task = (async () => {
    try {
      // 預覽用：forceDownload=false
      const url = await fsService.getFileLink(filePath, null, false);
      if (url) audioUrlCache.set(filePath, url);
      return url;
    } catch (error) {
      log.error(`獲取音訊直鏈失敗: ${filePath}`, error);
      return null;
    }
  })();

  audioUrlPending.set(filePath, task);
  try {
    const url = await task;
    if (url) {
      item.url = url;
      syncUrlAndMaybeResume(url);
    }
    return url;
  } finally {
    audioUrlPending.delete(filePath);
  }
};

// 把 url 同步進 APlayer 例項（避免因為 props 更新導致重建播放器）
const syncAPlayerAudioUrl = (index, url) => {
  const ap = audioPlayerRef.value?.getInstance?.();
  if (!ap?.list?.audios || typeof index !== "number") return;

  const audio = ap.list.audios[index];
  if (audio) {
    audio.url = url;
  }

  // 當前正好在播這一首：把 audio 標籤的 src 也補上
  if (ap.list.index === index && ap.audio) {
    try {
      ap.audio.src = url;
      // 恢復 loop 語義：佔位時強制 loop=true；真實音訊則按 APlayer 配置（loop==='one'）決定
      ap.audio.loop = url === PLACEHOLDER_AUDIO_URL ? true : ap.options?.loop === "one";
      ap.audio.load?.();
    } catch (e) {
      log.warn("同步 audio.src 失敗:", e);
    }
  }
};

// 獲取當前目錄下的音訊檔案列表
const loadAudioPlaylist = async () => {
  if (!props.currentPath || isLoadingPlaylist.value) {
    return;
  }

  if (audioPlaylist.value.length > 0) {
    return;
  }

  try {
    isLoadingPlaylist.value = true;

    let directoryItems = [];

    if (props.directoryItems && props.directoryItems.length > 0) {
      directoryItems = props.directoryItems;
    } else {
      const data = await fsService.getDirectoryList(props.currentPath);
      if (data?.items) {
        directoryItems = data.items;
      } else {
        return;
      }
    }

    const audioFileList = directoryItems.filter((item) => {
      if (item.isDirectory) return false;
      return item.type === FileType.AUDIO;
    });

    audioFileList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (audioFileList.length > 0) {
      await generateAudioPlaylist(audioFileList);
    }
  } catch (error) {
    log.error("❌ 載入音訊播放列表失敗:", error);
  } finally {
    isLoadingPlaylist.value = false;
  }
};

// 生成音訊播放列表資料
const generateAudioPlaylist = async (audioFileList) => {
  const playlist = [];

  for (const audioFile of audioFileList) {
    // 當前這首：優先複用父元件傳下來的 audioUrl（已經拿過一次 file-link 了）
    if (audioFile.path === props.file?.path && currentAudioData.value) {
      playlist.push(currentAudioData.value);
      // 順手把當前這首塞進快取，避免後面又去拿一次
      if (currentAudioData.value?.url) {
        audioUrlCache.set(audioFile.path, currentAudioData.value.url);
      }
      continue;
    }

    // 其他同目錄音訊：只做“列表展示資料”，url 先空著，等使用者切到這首時再按需獲取
    playlist.push({
      name: audioFile.name || "unknown",
      artist: "unknown",
      url: PLACEHOLDER_AUDIO_URL,
      cover: generateDefaultCover(audioFile.name),
      originalFile: audioFile,
    });
  }

  // 把當前檔案儘量放到列表第一首（使用者體驗更直觀）
  const currentFileIndex = playlist.findIndex((audio) => audio.originalFile?.path === props.file?.path);
  if (currentFileIndex > 0) {
    const currentFile = playlist.splice(currentFileIndex, 1)[0];
    playlist.unshift(currentFile);
  }

  audioPlaylist.value = playlist;
};

// 生成預設封面
const generateDefaultCover = (name) => {
  const firstChar = (name || "M")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = props.darkMode ? "#60a5fa" : "#3b82f6";
  ctx.fillRect(0, 0, 100, 100);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 50, 50);

  return canvas.toDataURL();
};

// 初始化當前音訊資料
const initializeCurrentAudio = async () => {
  if (!props.file) {
    return;
  }

  if (props.audioUrl) {
    currentAudioData.value = {
      name: props.file.name || "unknown",
      artist: "unknown",
      url: props.audioUrl,
      cover: generateDefaultCover(props.file.name),
      contentType: props.file.contentType,
      originalFile: props.file,
    };
    return;
  }

  log.warn("⚠️ audioUrl為空");
  currentAudioData.value = {
    name: props.file.name || "unknown",
    artist: "unknown",
    url: null,
    cover: generateDefaultCover(props.file.name),
    contentType: props.file.contentType,
    originalFile: props.file,
  };
};

// 監聽 audioUrl 變化
watch(
  () => props.audioUrl,
  async (newAudioUrl, oldAudioUrl) => {
    if (newAudioUrl && props.file && newAudioUrl !== oldAudioUrl) {
      await initializeCurrentAudio();
    }
  }
);

// 監聽全域性播放器狀態，自動同步 sentToGlobalPlayer
watch(
  [() => globalPlayer.isVisible.value, () => globalPlayer.hasPlaylist.value],
  ([visible, hasPlaylist]) => {
    // 當全域性播放器關閉或播放列表清空時，自動返回本地預覽
    if (sentToGlobalPlayer.value && (!visible || !hasPlaylist)) {
      sentToGlobalPlayer.value = false;
    }
  }
);

// 快捷鍵處理
const handleKeydown = (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  // 如果已傳送到全域性播放器，不處理本地快捷鍵
  if (sentToGlobalPlayer.value) {
    return;
  }

  const player = audioPlayerRef.value?.getInstance();
  if (!player) return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      player.toggle();
      break;
    case "ArrowLeft":
      event.preventDefault();
      player.seek(Math.max(0, player.audio.currentTime - 10));
      break;
    case "ArrowRight":
      event.preventDefault();
      player.seek(Math.min(player.audio.duration, player.audio.currentTime + 10));
      break;
    case "ArrowUp":
      event.preventDefault();
      player.volume(Math.min(1, player.audio.volume + 0.1));
      break;
    case "ArrowDown":
      event.preventDefault();
      player.volume(Math.max(0, player.audio.volume - 0.1));
      break;
  }
};

// 註冊鍵盤事件（自動清理）
useEventListener(document, "keydown", handleKeydown);

// 生命週期鉤子
onMounted(() => {
  originalTitle.value = document.title;

  nextTick(async () => {
    await initializeCurrentAudio();
    loadAudioPlaylist();
  });
});

onBeforeUnmount(() => {
  restoreOriginalTitle();
});
</script>

<style scoped>
@import "@/styles/pages/mount-explorer/audio-preview.css";
</style>
