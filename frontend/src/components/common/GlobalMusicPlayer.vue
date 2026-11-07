<template>
  <Teleport to="body">
    <!-- 全域性播放器容器 - 支援拖動 -->
    <div
      v-if="store.isVisible && store.hasPlaylist"
      ref="playerRef"
      class="global-player-wrapper"
      :class="{ 'is-mini': isMiniMode, 'dark-theme': isDarkMode }"
      :style="playerStyle"
      @click="handleClick"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <!-- APlayer 容器 -->
      <div ref="aplayerContainer" class="aplayer-global-container"></div>

      <!-- 自定義 Mini Switcher -->
      <div
        class="custom-mini-switcher"
        @click.stop="toggleMiniMode"
        :title="isMiniMode ? t('mount.audioPreview.expandPlayer') : t('mount.audioPreview.collapsePlayer')"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" :class="{ 'rotated': !isMiniMode }">
          <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
        </svg>
      </div>

      <!-- 關閉按鈕 -->
      <div
        class="custom-close-btn"
        @click.stop="handleClose"
        :title="t('mount.audioPreview.closePlayer')"
      >
        <svg viewBox="0 0 24 24" width="10" height="10">
          <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </div>

      <!-- 鍵盤快捷鍵提示（hover 時顯示） -->
      <div class="keyboard-hints" v-if="!isMiniMode">
        <span>空格: 播放/暫停</span>
        <span>↑↓: 音量</span>
        <span>←→: 快進/快退</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useDraggable, useWindowSize } from "@vueuse/core";
import { useGlobalPlayerStore } from "@/stores/globalPlayerStore.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useFsService } from "@/modules/fs";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();

// Store
const store = useGlobalPlayerStore();
const log = createLogger("GlobalMusicPlayer");
const fsService = useFsService();

// 主題
const { isDarkMode } = useThemeMode();

// 播放器引用
const playerRef = ref(null);
const aplayerContainer = ref(null);
const aplayerInstance = ref(null);

// 預設不需要在首屏就載入。
let APlayerConstructor = null;
let aplayerCssLoaded = false;
let initTaskId = 0;
let suppressNextListSwitch = false;

const ensureAPlayerLoaded = async () => {
  if (APlayerConstructor) return APlayerConstructor;
  const mod = await import("aplayer");
  APlayerConstructor = mod?.default || mod;
  if (!aplayerCssLoaded) {
    await import("aplayer/dist/APlayer.min.css");
    aplayerCssLoaded = true;
  }
  return APlayerConstructor;
};

// 拖動相關狀態（VueUse useDraggable）
const initializedDragPosition = ref(false);
const { width: windowWidth, height: windowHeight } = useWindowSize();
const { x, y, style: draggableStyle } = useDraggable(playerRef, {
  initialValue: { x: 20, y: 20 },
  preventDefault: true,
  onStart: (_pos, event) => {
    // 點選播放器時聚焦，以支援鍵盤操作
    playerRef.value?.focus();

    const target = event?.target;
    const isControl =
      target?.closest?.(".aplayer-icon") ||
      target?.closest?.(".aplayer-bar-wrap") ||
      target?.closest?.(".aplayer-list") ||
      target?.closest?.(".aplayer-volume-wrap") ||
      target?.closest?.(".custom-mini-switcher") ||
      target?.closest?.(".custom-close-btn");

    // 點到控制區不允許拖動（避免誤觸）
    if (isControl) return false;
  },
});

// Mini 模式狀態（由 store 控制）
const isMiniMode = computed(() => store.displayMode === "mini");

// 計算播放器樣式
const playerStyle = computed(() => ([
  {
    position: "fixed",
    zIndex: 9999,
    display: "flex",
    alignItems: "stretch",
  },
  draggableStyle.value,
]));

// 計算主題色
const getThemeColor = () => {
  return isDarkMode.value ? "#60a5fa" : "#3b82f6";
};

// 生成預設封面
const generateDefaultCover = (name) => {
  const firstChar = (name || "M")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = getThemeColor();
  ctx.fillRect(0, 0, 100, 100);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 50, 50);

  return canvas.toDataURL();
};

// 格式化音訊資料為 APlayer 格式
const formatAudioList = (playlist) => {
  return playlist.map((audio) => ({
    name: audio.name || audio.title || t('mount.audioPreview.unknownAudio'),
    artist: audio.artist || t('mount.audioPreview.unknownArtist'),
    url: audio.url || PLACEHOLDER_AUDIO_URL,
    cover: audio.cover || audio.poster || generateDefaultCover(audio.name),
    lrc: audio.lrc || audio.lyrics,
    theme: getThemeColor(),
    // 透傳原始檔案資訊：用於“切歌時按需獲取直鏈”
    originalFile: audio.originalFile || null,
  }));
};

// ===== “按需獲取直鏈”快取 =====
const audioUrlCache = new Map();
const audioUrlPending = new Map();

// 用一個“很短的靜音 wav”當佔位 url：避免 APlayer 遇到空 url 就直接報錯/自動跳歌
const PLACEHOLDER_AUDIO_URL =
  "data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

const safePlayAudioEl = (audioEl) => {
  if (!audioEl?.play) return;
  try {
    const p = audioEl.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
      });
    }
  } catch {
    // 忽略同步異常
  }
};

const waitForAPlayerListDomReady = async (ap, { minItems = 1, timeoutMs = 1500 } = {}) => {
  const start = performance.now?.() ?? Date.now();
  // “輪詢 + 短等待”是為了等 APlayer 把列表 DOM 插入
  while (true) {
    const now = performance.now?.() ?? Date.now();
    if (now - start > timeoutMs) return false;

    try {
      const items = ap?.container?.querySelectorAll?.(".aplayer-list ol li");
      if (items && items.length >= minItems) return true;
    } catch {
      // 忽略 DOM 探測異常
    }

    // 讓出一幀，給 APlayer 自己渲染 DOM
    await new Promise((r) => setTimeout(r, 50));
  }
};

const syncAPlayerAudioUrl = (index, url) => {
  const ap = aplayerInstance.value;
  if (!ap?.list?.audios || typeof index !== "number") return;

  const audio = ap.list.audios[index];
  if (audio) {
    audio.url = url;
  }

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

const ensureTrackUrlReady = async (index, { playAfter = false } = {}) => {
  const track = store.playlist?.[index];
  if (!track) return null;

  const syncUrlAndMaybeResume = (url) => {
    const ap = aplayerInstance.value;
    const wasPlayingBeforeSwap = !!ap?.audio && !ap.audio.paused;

    track.url = url;
    syncAPlayerAudioUrl(index, url);

    const shouldResume = playAfter || wasPlayingBeforeSwap;
    if (!shouldResume) return;
    safePlayAudioEl(ap?.audio);
  };

  // 已有真實 url：直接返回
  if (track.url && track.url !== PLACEHOLDER_AUDIO_URL) {
    if (playAfter) {
      safePlayAudioEl(aplayerInstance.value?.audio);
    }
    return track.url;
  }

  const filePath = track.originalFile?.path;
  if (!filePath) return null;

  if (audioUrlCache.has(filePath)) {
    const cachedUrl = audioUrlCache.get(filePath);
    syncUrlAndMaybeResume(cachedUrl);
    return cachedUrl;
  }

  if (audioUrlPending.has(filePath)) {
    const pending = audioUrlPending.get(filePath);
    const url = await pending;
    if (url) {
      syncUrlAndMaybeResume(url);
    }
    return url;
  }

  const task = (async () => {
    try {
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
      syncUrlAndMaybeResume(url);
    }
    return url;
  } finally {
    audioUrlPending.delete(filePath);
  }
};

// 初始化 APlayer
const initAPlayer = () => {
  if (!aplayerContainer.value) return;

  // 銷燬現有例項
  destroyAPlayer();

  // 檢查是否有播放列表
  if (!store.playlist || store.playlist.length === 0) return;

  // 準備音訊資料
  const audioData = formatAudioList(store.playlist);

  // APlayer 配置
  const options = {
    container: aplayerContainer.value,
    audio: audioData,
    autoplay: false,
    theme: getThemeColor(),
    loop: store.loopMode,
    order: store.orderMode,
    preload: "metadata",
    volume: store.volume,
    mutex: true,
    mini: isMiniMode.value,
    listFolded: true,
    listMaxHeight: "200px",
    storageName: "cloudharbor-aplayer-global",
  };

  // 動態載入 APlayer
  const taskId = ++initTaskId;
  Promise.resolve()
    .then(async () => {
      const APlayer = await ensureAPlayerLoaded();
      return new APlayer(options);
    })
    .then((ap) => {
      const shouldAbort =
        taskId !== initTaskId || !store.isVisible || !store.hasPlaylist || !aplayerContainer.value || !playerRef.value;
      if (shouldAbort) {
        try {
          ap?.destroy?.();
        } catch {
          // 忽略銷燬異常
        }
        return;
      }

      aplayerInstance.value = ap;

      // 繫結事件
      bindAPlayerEvents();

      // 儲存例項引用到 store
      store.setAPlayerInstance(aplayerInstance.value);

      // 聚焦播放器以支援鍵盤操作
      nextTick(() => {
        playerRef.value?.focus();
      });

      log.debug("全域性播放器 APlayer 初始化成功");

      // 等 APlayer 列表 DOM 真正就緒後再 switch
      void (async () => {
        await nextTick();
        if (taskId !== initTaskId) return;

        const maxIndex = Math.max(0, (ap?.list?.audios?.length || 1) - 1);
        const idx = Math.min(Math.max(store.currentIndex || 0, 0), maxIndex);

        // 等列表 DOM（至少要有 idx+1 個 li）
        const ok = await waitForAPlayerListDomReady(ap, { minItems: idx + 1, timeoutMs: 2000 });
        if (taskId !== initTaskId) return;

        if (ok && idx > 0) {
          suppressNextListSwitch = true;
          try {
            ap.list.switch(idx);
          } catch {
            // 忽略同步異常（真正的崩潰通常是 APlayer 內部非同步觸發，這裡已經透過 wait 儘量避免）
          }
        }

        // 切到目標曲目後，再按需補齊直鏈並播放
        void ensureTrackUrlReady(idx, { playAfter: true });
      })();
    })
    .catch((error) => {
      log.error("APlayer 初始化失敗:", error);
    });
};

// 避免同一時刻被多處 watch/onMounted 重複觸發 init
let initScheduled = false;
const scheduleInitAPlayer = () => {
  if (initScheduled) return;
  initScheduled = true;
  nextTick(() => {
    initScheduled = false;
    initAPlayer();
  });
};

// 繫結 APlayer 事件
const bindAPlayerEvents = () => {
  if (!aplayerInstance.value) return;

  const ap = aplayerInstance.value;

  ap.on("play", () => {
    store.syncPlayState(true);
  });

  ap.on("pause", () => {
    store.syncPlayState(false);
  });

  ap.on("timeupdate", () => {
    store.syncProgress(ap.audio.currentTime, ap.audio.duration);
  });

  ap.on("listswitch", (index) => {
    const resolvedIndex = index && typeof index === "object" && "index" in index ? index.index : index;
    store.syncCurrentIndex(resolvedIndex);

    // 初始化階段我們會主動 switch 到目標曲目，這一次不需要再觸發“按需取直鏈”
    if (suppressNextListSwitch) {
      suppressNextListSwitch = false;
      return;
    }

    // 切到某一首時再取直鏈
    const wasPlaying = !!ap?.audio && !ap.audio.paused;

    // 如果切到的是“佔位靜音”，先強制 loop，避免它瞬間結束→APlayer 自動跳走
    try {
      const currentUrl = ap?.list?.audios?.[resolvedIndex]?.url;
      if (ap?.audio && currentUrl === PLACEHOLDER_AUDIO_URL) {
        ap.audio.loop = true;
      }
    } catch {
      // 忽略
    }

    void ensureTrackUrlReady(resolvedIndex, { playAfter: wasPlaying });
  });

  ap.on("error", (error) => {
    // “按需獲取直鏈”場景：如果當前這首還沒拿到 url，APlayer 可能會先拋一次錯誤，先忽略即可
    try {
      const idx = ap?.list?.index;
      const current = typeof idx === "number" ? ap?.list?.audios?.[idx] : null;
      if (current && (!current.url || current.url === "" || current.url === PLACEHOLDER_AUDIO_URL)) {
        log.debug("正在按需獲取音訊直鏈，先忽略一次播放錯誤");
        return;
      }
    } catch {
      // 忽略探測異常
    }
    log.error("APlayer 播放錯誤:", error);
  });
};

// 銷燬 APlayer
const destroyAPlayer = () => {
  // 任何銷燬都視為“取消當前 init 任務”，防止非同步 init 回來後又把例項塞回去
  initTaskId++;
  if (aplayerInstance.value) {
    try {
      aplayerInstance.value.destroy();
    } catch (e) {
      log.warn("銷燬 APlayer 時出錯:", e);
    }
    aplayerInstance.value = null;
    store.setAPlayerInstance(null);
  }
};

// 同步顯示模式
const applyDisplayMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.setMode(mode === "mini" ? "mini" : "normal");
};

// 同步迴圈模式
const applyLoopMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.options.loop = mode;
  aplayerInstance.value.audio.loop = mode === "one";
};

// 同步播放順序
const applyOrderMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.options.order = mode;
};

// 切換 Mini 模式
const toggleMiniMode = () => {
  const nextMode = isMiniMode.value ? "expanded" : "mini";
  store.setDisplayMode(nextMode);
};

// 關閉播放器
const handleClose = () => {
  destroyAPlayer();
  store.closePlayer();
};

// ===== 鍵盤快捷鍵 =====
const handleKeydown = (event) => {
  if (!aplayerInstance.value) return;

  const ap = aplayerInstance.value;

  switch (event.key) {
    case ' ':  // 空格 - 播放/暫停
      event.preventDefault();
      ap.toggle();
      break;
    case 'ArrowUp':  // 上箭頭 - 增加音量
      event.preventDefault();
      {
        const newVol = Math.min(1, store.volume + 0.1);
        ap.volume(newVol, true);
        store.setVolume(newVol);
      }
      break;
    case 'ArrowDown':  // 下箭頭 - 減少音量
      event.preventDefault();
      {
        const newVol = Math.max(0, store.volume - 0.1);
        ap.volume(newVol, true);
        store.setVolume(newVol);
      }
      break;
    case 'ArrowLeft':  // 左箭頭 - 快退 5 秒
      event.preventDefault();
      ap.seek(Math.max(0, ap.audio.currentTime - 5));
      break;
    case 'ArrowRight':  // 右箭頭 - 快進 5 秒
      event.preventDefault();
      ap.seek(Math.min(ap.audio.duration, ap.audio.currentTime + 5));
      break;
    case 'm':  // M 鍵 - 靜音切換
    case 'M':
      event.preventDefault();
      if (store.volume > 0) {
        ap.volume(0, true);
        store.setVolume(0);
      } else {
        ap.volume(0.7, true);
        store.setVolume(0.7);
      }
      break;
    case 'n':  // N 鍵 - 下一首
    case 'N':
      event.preventDefault();
      ap.skipForward();
      break;
    case 'p':  // P 鍵 - 上一首
    case 'P':
      event.preventDefault();
      ap.skipBack();
      break;
    case 'Escape':  // ESC - 收起到 mini 模式
      event.preventDefault();
      if (!isMiniMode.value) {
        toggleMiniMode();
      }
      break;
  }
};

// ===== 拖動功能 =====

// 點選播放器時聚焦
const handleClick = () => {
  playerRef.value?.focus();
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const clampInViewport = () => {
  const el = playerRef.value;
  if (!el) return;

  const maxX = Math.max(0, windowWidth.value - (el.offsetWidth || 0));
  const maxY = Math.max(0, windowHeight.value - (el.offsetHeight || 0));

  x.value = clamp(x.value, 0, maxX);
  y.value = clamp(y.value, 0, maxY);
};

const dockToBottomLeftIfNeeded = async () => {
  if (initializedDragPosition.value) return;
  await nextTick();
  const el = playerRef.value;
  if (!el) return;

  x.value = 20;
  y.value = clamp(windowHeight.value - (el.offsetHeight || 0) - 20, 0, windowHeight.value);
  clampInViewport();
  initializedDragPosition.value = true;
};

// ===== 監聽器 =====

watch(
  () => store.playlist,
  (newPlaylist, oldPlaylist) => {
    if (!newPlaylist || newPlaylist.length === 0 || !store.isVisible) return;
    if (newPlaylist === oldPlaylist) return;
    scheduleInitAPlayer();
  }
);

watch(
  () => store.isVisible,
  (visible) => {
    if (visible && store.hasPlaylist) {
      scheduleInitAPlayer();
    } else if (!visible) {
      destroyAPlayer();
    }
  }
);

watch(
  () => store.loopMode,
  (newLoop) => {
    applyLoopMode(newLoop);
  }
);

watch(
  () => store.orderMode,
  (newOrder) => {
    applyOrderMode(newOrder);
  }
);

watch(
  () => store.displayMode,
  (mode) => {
    applyDisplayMode(mode);
  }
);

// ===== 生命週期 =====

onMounted(() => {
  if (store.isVisible && store.hasPlaylist) {
    scheduleInitAPlayer();
  }
  void dockToBottomLeftIfNeeded();
});

onBeforeUnmount(() => {
  initTaskId++;
  destroyAPlayer();
});

watch(
  () => store.isVisible,
  async (visible) => {
    if (!visible) return;
    await dockToBottomLeftIfNeeded();
    await nextTick();
    clampInViewport();
  }
);

watch([windowWidth, windowHeight], async () => {
  await nextTick();
  clampInViewport();
});

watch(
  () => store.displayMode,
  async () => {
    await nextTick();
    clampInViewport();
  }
);
</script>

<style>
/* ===== 全域性播放器容器 ===== */
.global-player-wrapper {
  position: fixed !important;
  user-select: none;
  outline: none !important;
}

/* 播放器陰影和圓角 */
.global-player-wrapper .aplayer {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 2px 0 0 2px;
  margin: 0 !important;
}

/* 展開模式下加寬播放器 */
.global-player-wrapper .aplayer:not(.aplayer-narrow) {
  min-width: 280px;
}

/* Mini 模式下恢復原生寬度 */
.global-player-wrapper .aplayer.aplayer-narrow {
  width: 66px !important;
  min-width: 66px !important;
}

/* ===== 自定義 Mini Switcher ===== */
.custom-mini-switcher {
  width: 18px;
  background: #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  color: #666;
  flex-shrink: 0;
}

.custom-mini-switcher:hover {
  background: #d0d0d0;
}

.custom-mini-switcher svg {
  transition: transform 0.3s;
}

.custom-mini-switcher svg.rotated {
  transform: rotate(180deg);
}

/* ===== 自定義關閉按鈕 ===== */
.custom-close-btn {
  width: 18px;
  background: #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  color: #666;
  border-radius: 0 2px 2px 0;
  flex-shrink: 0;
}

.custom-close-btn:hover {
  background: #ff6b6b;
  color: white;
}

/* ===== 鍵盤快捷鍵提示 ===== */
.keyboard-hints {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  font-size: 10px;
  padding: 4px 8px;
  display: none;
  gap: 8px;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
}

.global-player-wrapper:focus .keyboard-hints,
.global-player-wrapper:hover .keyboard-hints {
  display: flex;
}

/* ===== 深色模式 ===== */
.global-player-wrapper.dark-theme .aplayer {
  background: #1f2937 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info {
  background: #1f2937 !important;
  border-bottom-color: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-title {
  color: #f9fafb !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-author {
  color: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller {
  background: #1f2937 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-time {
  color: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-icon {
  fill: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-icon:hover {
  fill: #f9fafb !important;
}

.global-player-wrapper.dark-theme .custom-mini-switcher {
  background: #374151;
  color: #9ca3af;
}

.global-player-wrapper.dark-theme .custom-mini-switcher:hover {
  background: #4b5563;
  color: #f9fafb;
}

.global-player-wrapper.dark-theme .custom-close-btn {
  background: #374151;
  color: #9ca3af;
}

.global-player-wrapper.dark-theme .custom-close-btn:hover {
  background: #ef4444;
  color: white;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list {
  background: #1f2937 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li {
  color: #d1d5db !important;
  border-bottom-color: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li:hover {
  background: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light {
  background: #3b82f6 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light .aplayer-list-title,
.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light .aplayer-list-author {
  color: #ffffff !important;
}

.global-player-wrapper.dark-theme .keyboard-hints {
  background: rgba(31, 41, 55, 0.9);
}

/* ===== 主題色 ===== */
.global-player-wrapper .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played {
  background: #3b82f6 !important;
}

.global-player-wrapper .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played .aplayer-thumb {
  background: #3b82f6 !important;
}

.global-player-wrapper .aplayer .aplayer-volume-wrap .aplayer-volume-bar .aplayer-volume {
  background: #3b82f6 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played {
  background: #60a5fa !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played .aplayer-thumb {
  background: #60a5fa !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-volume-wrap .aplayer-volume-bar .aplayer-volume {
  background: #60a5fa !important;
}

/* ===== 拖動時的游標 ===== */
.global-player-wrapper .aplayer .aplayer-pic {
  cursor: move;
}

/* 控制元素保持預設游標 */
.global-player-wrapper .aplayer .aplayer-icon,
.global-player-wrapper .aplayer .aplayer-bar-wrap,
.global-player-wrapper .aplayer .aplayer-volume-wrap,
.global-player-wrapper .aplayer .aplayer-list {
  cursor: pointer;
}
</style>
