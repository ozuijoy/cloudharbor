<template>
  <div class="audio-player-container" :class="{ 'dark-theme': darkMode }">
    <div ref="aplayerContainer" class="aplayer-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import APlayer from "aplayer";
import "aplayer/dist/APlayer.min.css";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("AudioPlayer");

// Props 定義
const props = defineProps({
  // 音訊檔案列表
  audioList: {
    type: Array,
    default: () => [],
  },
  // 當前播放的音訊資訊
  currentAudio: {
    type: Object,
    default: () => null,
  },
  // 是否為深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否自動播放
  autoplay: {
    type: Boolean,
    default: false,
  },
  // 是否顯示播放列表
  showPlaylist: {
    type: Boolean,
    default: true,
  },
  // 播放器主題色
  theme: {
    type: String,
    default: "#3b82f6",
  },
  // 播放器模式：'normal', 'mini', 'fixed'
  mode: {
    type: String,
    default: "normal",
  },
  // 是否迴圈播放
  loop: {
    type: String,
    default: "all", // 'all', 'one', 'none'
  },
  // 播放順序
  order: {
    type: String,
    default: "list", // 'list', 'random'
  },
  // 播放列表是否摺疊
  listFolded: {
    type: Boolean,
    default: true,
  },
  // 播放列表最大高度
  listMaxHeight: {
    type: String,
    default: "250px",
  },
  // 音量
  volume: {
    type: Number,
    default: 0.7,
  },
  // 是否顯示歌詞
  showLrc: {
    type: Boolean,
    default: false,
  },
});

// Emits 定義
const emit = defineEmits(["play", "pause", "ended", "timeupdate", "loadstart", "canplay", "error", "listswitch", "listadd", "listremove", "listclear", "noticeshow", "noticehide"]);

// 響應式資料
const aplayerContainer = ref(null);
const aplayerInstance = ref(null);

// 計算主題色
const getThemeColor = () => {
  if (props.darkMode) {
    return "#60a5fa"; // 深色模式下使用較亮的藍色
  }
  return props.theme;
};

// 初始化 APlayer
const initAPlayer = () => {
  if (!aplayerContainer.value) return;

  // 銷燬現有例項
  if (aplayerInstance.value) {
    aplayerInstance.value.destroy();
    aplayerInstance.value = null;
  }

  // 準備音訊資料
  const audioData = prepareAudioData();
  if (audioData.length === 0) return;

  // APlayer 配置
  const options = {
    container: aplayerContainer.value,
    audio: audioData,
    autoplay: props.autoplay,
    theme: getThemeColor(),
    loop: props.loop,
    order: props.order,
    preload: "metadata",
    volume: props.volume,
    mutex: true,
    listFolded: props.listFolded,
    listMaxHeight: props.listMaxHeight,
    lrcType: props.showLrc ? 3 : 0,
    storageName: "cloudharbor-aplayer",
  };

  // 根據模式調整配置
  if (props.mode === "mini") {
    options.mini = true;
  } else if (props.mode === "fixed") {
    options.fixed = true;
  }

  try {
    // 建立 APlayer 例項
    aplayerInstance.value = new APlayer(options);

    // 繫結事件監聽器
    bindEvents();

    // 應用主題樣式
    applyThemeStyles();
  } catch (error) {
    log.error("APlayer 初始化失敗:", error);
    emit("error", error);
  }
};

// 準備音訊資料
const prepareAudioData = () => {
  const audioData = [];

  // 如果有當前音訊，優先新增
  if (props.currentAudio) {
    audioData.push(formatAudioItem(props.currentAudio));
  }

  // 新增播放列表中的其他音訊
  if (props.audioList && props.audioList.length > 0) {
    props.audioList.forEach((audio) => {
      // 避免重複新增當前音訊
      if (!props.currentAudio || audio.url !== props.currentAudio.url) {
        audioData.push(formatAudioItem(audio));
      }
    });
  }

  return audioData;
};

// 格式化音訊項
const formatAudioItem = (audio) => {
  return {
    name: audio.name || audio.title || "未知音訊",
    artist: audio.artist || "未知藝術家",
    url: audio.url,
    cover: audio.cover || audio.poster || generateDefaultCover(audio.name),
    lrc: audio.lrc || audio.lyrics,
    theme: getThemeColor(),
    originalFile: audio.originalFile || null,
  };
};

// 生成預設封面
const generateDefaultCover = (name) => {
  // 使用檔名首字母生成簡單的預設封面
  const firstChar = (name || "M")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  // 背景色
  ctx.fillStyle = getThemeColor();
  ctx.fillRect(0, 0, 100, 100);

  // 文字
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 50, 50);

  return canvas.toDataURL();
};

// 繫結事件監聽器
const bindEvents = () => {
  if (!aplayerInstance.value) return;

  const ap = aplayerInstance.value;

  ap.on("play", () => {
    emit("play", {
      audio: ap.list.audios[ap.list.index],
      index: ap.list.index,
    });
  });

  ap.on("pause", () => {
    emit("pause", {
      audio: ap.list.audios[ap.list.index],
      index: ap.list.index,
    });
  });

  ap.on("ended", () => {
    emit("ended", {
      audio: ap.list.audios[ap.list.index],
      index: ap.list.index,
    });
  });

  ap.on("timeupdate", () => {
    emit("timeupdate", {
      currentTime: ap.audio.currentTime,
      duration: ap.audio.duration,
      percentage: (ap.audio.currentTime / ap.audio.duration) * 100,
    });
  });

  ap.on("loadstart", () => {
    emit("loadstart");
  });

  ap.on("canplay", () => {
    emit("canplay");
  });

  ap.on("error", (error) => {
    if (!error?.target) {
      log.debug("忽略一次無 target 的播放錯誤事件");
      return;
    }

    // “按需獲取直鏈”場景：如果當前曲目還沒補上真實 url，audio 會先報一次 error（先靜默）
    const currentUrl = ap?.list?.audios?.[ap.list.index]?.url;
    if (!currentUrl) {
      log.debug("正在按需獲取音訊直鏈，先忽略一次播放錯誤");
      return;
    }

    // 佔位靜音 audio（data:）本身不重要，報錯也不影響最終播放，直接忽略減少噪音
    if (typeof currentUrl === "string" && currentUrl.startsWith("data:audio/")) {
      log.debug("忽略佔位音訊的播放錯誤");
      return;
    }

    // 檢查是否是Service Worker相關的誤報錯誤
    if (error?.target?.src?.includes(window.location.origin) && ap?.list?.audios?.[ap.list.index]?.url?.startsWith("https://")) {
      log.debug("忽略Service Worker相關的誤報錯誤，音訊實際可以正常播放");
      return; // 忽略Service Worker誤報錯誤
    }

    log.error("APlayer 播放錯誤:", error);
    emit("error", error);
  });

  ap.on("listswitch", (index) => {
    const resolvedIndex = typeof index === "object" && index !== null && typeof index.index === "number" ? index.index : index;
    // 確保索引有效且音訊資料存在
    const audio = ap.list && ap.list.audios && ap.list.audios[resolvedIndex] ? ap.list.audios[resolvedIndex] : null;

    emit("listswitch", {
      audio: audio,
      index: resolvedIndex,
    });
  });
};

// 應用主題樣式
const applyThemeStyles = () => {
  if (!aplayerContainer.value) return;

  nextTick(() => {
    // nextTick 期間元件可能被解除安裝/重建，容器會變成 null（這裡必須二次判空）
    const container = aplayerContainer.value;
    if (!container) return;

    const aplayerElement = container.querySelector(".aplayer");
    if (!aplayerElement) return;

    // 更新主題色
    const themeColor = getThemeColor();
    aplayerElement.style.setProperty("--aplayer-theme", themeColor);

    // 應用暗色主題類
    if (props.darkMode) {
      container.classList.add("dark-theme");
    } else {
      container.classList.remove("dark-theme");
    }
  });
};

// 公開的方法
const play = () => {
  if (aplayerInstance.value) {
    aplayerInstance.value.play();
  }
};

const pause = () => {
  if (aplayerInstance.value) {
    aplayerInstance.value.pause();
  }
};

const toggle = () => {
  if (aplayerInstance.value) {
    aplayerInstance.value.toggle();
  }
};

const seek = (time) => {
  if (aplayerInstance.value) {
    aplayerInstance.value.seek(time);
  }
};

const setVolume = (volume) => {
  if (aplayerInstance.value) {
    aplayerInstance.value.volume(volume);
  }
};

const switchAudio = (index) => {
  if (aplayerInstance.value && aplayerInstance.value.list) {
    aplayerInstance.value.list.switch(index);
  }
};

const addAudio = (audio) => {
  if (aplayerInstance.value && aplayerInstance.value.list) {
    aplayerInstance.value.list.add(formatAudioItem(audio));
  }
};

const removeAudio = (index) => {
  if (aplayerInstance.value && aplayerInstance.value.list) {
    aplayerInstance.value.list.remove(index);
  }
};

// 暴露方法給父元件
defineExpose({
  play,
  pause,
  toggle,
  seek,
  setVolume,
  switchAudio,
  addAudio,
  removeAudio,
  getInstance: () => aplayerInstance.value,
});

// 監聽屬性變化
watch(
  () => props.darkMode,
  () => {
    applyThemeStyles();
  },
  { immediate: false }
);

watch(
  () => props.theme,
  () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.theme(getThemeColor());
    }
    applyThemeStyles();
  }
);

watch(
  () => [props.currentAudio, props.audioList, props.audioList?.length || 0, props.loop, props.order],
  () => {
    initAPlayer();
  },
  { deep: false }
);

watch(
  () => props.volume,
  (newVolume) => {
    setVolume(newVolume);
  }
);

// 生命週期
onMounted(() => {
  nextTick(() => {
    initAPlayer();
  });
});

onBeforeUnmount(() => {
  if (aplayerInstance.value) {
    aplayerInstance.value.destroy();
    aplayerInstance.value = null;
  }
});
</script>

<style scoped>
.audio-player-container {
  width: 100%;
  position: relative;
}

.aplayer-container {
  width: 100%;
}
</style>

<style>
/* APlayer 深色模式樣式 */
.dark-theme .aplayer {
  background: #1f2937 !important;
  border: 1px solid #374151 !important;
}

.dark-theme .aplayer .aplayer-info {
  background: #1f2937 !important;
  border-bottom: 1px solid #374151 !important;
}

.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-title {
  color: #f9fafb !important;
}

.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-author {
  color: #d1d5db !important;
}

.dark-theme .aplayer .aplayer-controller {
  background: #1f2937 !important;
}

.dark-theme .aplayer .aplayer-controller .aplayer-time {
  color: #d1d5db !important;
}

.dark-theme .aplayer .aplayer-controller .aplayer-time .aplayer-icon {
  fill: #d1d5db !important;
}

.dark-theme .aplayer .aplayer-controller .aplayer-icon {
  fill: #d1d5db !important;
}

.dark-theme .aplayer .aplayer-controller .aplayer-icon:hover {
  fill: #f9fafb !important;
}

.aplayer-dark .aplayer-list {
  background: #1f2937 !important;
  border: 1px solid #374151 !important;
}

.aplayer-dark .aplayer-list ol li {
  color: #d1d5db !important;
  border-bottom: 1px solid #374151 !important;
}

.aplayer-dark .aplayer-list ol li:hover {
  background: #374151 !important;
}

/* 暗色模式下選中項文字改為黑色，適配白色背景 */
.dark-theme .aplayer-list ol li.aplayer-list-light .aplayer-list-title {
  color: #1f2937 !important;
}

.dark-theme .aplayer-list ol li.aplayer-list-light .aplayer-list-author {
  color: #4b5563 !important;
}

/* 普通列表項保持白色文字 */
.dark-theme .aplayer-list ol li .aplayer-list-title {
  color: #f9fafb !important;
}

.dark-theme .aplayer-list ol li .aplayer-list-author {
  color: #9ca3af !important;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .aplayer-container {
    font-size: 14px;
  }

  .aplayer .aplayer-info .aplayer-music .aplayer-title {
    font-size: 14px !important;
  }

  .aplayer .aplayer-info .aplayer-music .aplayer-author {
    font-size: 12px !important;
  }
}

/* 自定義主題色變數 */
.aplayer {
  --aplayer-theme: #3b82f6;
}

.aplayer .aplayer-controller .aplayer-bar-wrap .aplayer-bar .aplayer-played {
  background: var(--aplayer-theme) !important;
}

.aplayer .aplayer-controller .aplayer-bar-wrap .aplayer-bar .aplayer-played .aplayer-thumb {
  background: var(--aplayer-theme) !important;
}

.aplayer .aplayer-controller .aplayer-volume-wrap .aplayer-volume-bar .aplayer-volume {
  background: var(--aplayer-theme) !important;
}
</style>
