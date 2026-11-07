/**
 * 全域性音樂播放器狀態管理 Store
 * 使用 Pinia 管理全域性播放器狀態，配合官方 APlayer 例項
 */

import { defineStore } from "pinia";
import { ref, computed, shallowRef } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("GlobalPlayerStore");

// localStorage 儲存鍵
const STORAGE_KEY = "cloudharbor-global-player";

export const useGlobalPlayerStore = defineStore("globalPlayer", () => {
  // ===== 狀態定義 =====

  // 播放器可見性
  const isVisible = ref(false);

  // 播放器模式：'mini' | 'expanded'
  const displayMode = ref("mini");

  // 播放狀態
  const isPlaying = ref(false);


  // 播放列表
  const playlist = ref([]);

  // 當前播放索引
  const currentIndex = ref(0);

  // 播放進度（秒）
  const currentTime = ref(0);

  // 音訊總時長（秒）
  const duration = ref(0);

  // 音量 (0-1)
  const volume = ref(0.7);

  // 迴圈模式：'all' | 'one' | 'none'
  const loopMode = ref("all");

  // 播放順序：'list' | 'random'
  const orderMode = ref("list");

  // APlayer 例項引用（由 GlobalMusicPlayer 元件設定）
  const aplayerInstance = shallowRef(null);

  // 錯誤資訊
  const error = ref(null);

  // ===== 計算屬性 =====

  // 當前播放的音訊
  const currentTrack = computed(() => {
    if (playlist.value.length === 0) return null;
    return playlist.value[currentIndex.value] || null;
  });

  // 是否有播放列表
  const hasPlaylist = computed(() => playlist.value.length > 0);

  // 是否為 mini 模式
  const isMiniMode = computed(() => displayMode.value === "mini");

  // 是否為展開模式
  const isExpandedMode = computed(() => displayMode.value === "expanded");

  // 播放進度百分比
  const progress = computed(() => {
    if (!duration.value) return 0;
    return (currentTime.value / duration.value) * 100;
  });

  // 格式化當前時間
  const formattedCurrentTime = computed(() => formatTime(currentTime.value));

  // 格式化總時長
  const formattedDuration = computed(() => formatTime(duration.value));

  // ===== 工具函式 =====

  /**
   * 格式化時間為 mm:ss
   */
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // ===== APlayer 例項管理 =====

  /**
   * 設定 APlayer 例項引用
   */
  const setAPlayerInstance = (instance) => {
    aplayerInstance.value = instance;
  };

  /**
   * 獲取 APlayer 例項
   */
  const getAPlayerInstance = () => {
    return aplayerInstance.value;
  };

  // ===== 狀態同步方法（由 GlobalMusicPlayer 呼叫） =====

  /**
   * 同步播放狀態
   */
  const syncPlayState = (playing) => {
    isPlaying.value = playing;
  };

  /**
   * 同步播放進度
   */
  const syncProgress = (time, dur) => {
    currentTime.value = time || 0;
    duration.value = dur || 0;
  };

  /**
   * 同步當前索引
   */
  const syncCurrentIndex = (index) => {
    currentIndex.value = index;
  };

  // ===== 播放控制方法 =====

  /**
   * 播放
   */
  const play = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.play();
    }
  };

  /**
   * 暫停
   */
  const pause = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.pause();
    }
  };

  /**
   * 切換播放/暫停
   */
  const togglePlay = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.toggle();
    }
  };

  /**
   * 跳轉到指定時間
   */
  const seekTo = (time) => {
    if (aplayerInstance.value) {
      aplayerInstance.value.seek(time);
    }
  };

  /**
   * 根據百分比跳轉
   */
  const seekToPercent = (percent) => {
    if (duration.value && aplayerInstance.value) {
      aplayerInstance.value.seek((percent / 100) * duration.value);
    }
  };

  // ===== 顯示控制 =====

  /**
   * 顯示播放器
   */
  const showPlayer = () => {
    isVisible.value = true;
  };

  /**
   * 隱藏播放器
   */
  const hidePlayer = () => {
    isVisible.value = false;
  };

  /**
   * 切換播放器顯示/隱藏
   */
  const toggleVisibility = () => {
    isVisible.value = !isVisible.value;
  };

  /**
   * 切換 mini/expanded 模式
   */
  const toggleDisplayMode = () => {
    displayMode.value = displayMode.value === "mini" ? "expanded" : "mini";
    saveToStorage();
  };

  /**
   * 設定顯示模式
   */
  const setDisplayMode = (mode) => {
    if (mode === "mini" || mode === "expanded") {
      displayMode.value = mode;
      saveToStorage();
    }
  };

  // ===== 播放列表管理 =====

  /**
   * 設定播放列表並開始播放
   */
  const setPlaylist = (audioList, startIndex = 0) => {
    if (!audioList || audioList.length === 0) return;

    playlist.value = audioList.map((audio) => ({
      name: audio.name || audio.title || "未知音訊",
      artist: audio.artist || "未知藝術家",
      url: audio.url,
      cover: audio.cover || audio.poster || null,
      originalFile: audio.originalFile || null,
    }));

    currentIndex.value = Math.min(startIndex, audioList.length - 1);
    isVisible.value = true;

    saveToStorage();
  };

  /**
   * 新增音訊到播放列表
   */
  const addToPlaylist = (audio) => {
    if (!audio || !audio.url) return;

    const exists = playlist.value.some((item) => item.url === audio.url);
    if (exists) return;

    playlist.value.push({
      name: audio.name || audio.title || "未知音訊",
      artist: audio.artist || "未知藝術家",
      url: audio.url,
      cover: audio.cover || audio.poster || null,
      originalFile: audio.originalFile || null,
    });

    // 如果 APlayer 例項存在，也新增到 APlayer
    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.add({
        name: audio.name || audio.title || "未知音訊",
        artist: audio.artist || "未知藝術家",
        url: audio.url,
        cover: audio.cover || audio.poster || null,
      });
    }

    saveToStorage();
  };

  /**
   * 從播放列表移除音訊
   */
  const removeFromPlaylist = (index) => {
    if (index < 0 || index >= playlist.value.length) return;

    playlist.value.splice(index, 1);

    // 如果 APlayer 例項存在，也從 APlayer 移除
    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.remove(index);
    }

    if (playlist.value.length === 0) {
      currentIndex.value = 0;
    } else if (index < currentIndex.value) {
      currentIndex.value--;
    } else if (index === currentIndex.value && currentIndex.value >= playlist.value.length) {
      currentIndex.value = playlist.value.length - 1;
    }

    saveToStorage();
  };

  /**
   * 清空播放列表
   */
  const clearPlaylist = () => {
    playlist.value = [];
    currentIndex.value = 0;
    currentTime.value = 0;
    duration.value = 0;

    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.clear();
    }

    saveToStorage();
  };

  /**
   * 切換到指定曲目
   */
  const switchTrack = (index) => {
    if (index >= 0 && index < playlist.value.length) {
      currentIndex.value = index;
      if (aplayerInstance.value && aplayerInstance.value.list) {
        aplayerInstance.value.list.switch(index);
      }
      saveToStorage();
    }
  };

  /**
   * 播放下一首
   */
  const playNext = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.skipForward();
    }
  };

  /**
   * 播放上一首
   */
  const playPrev = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.skipBack();
    }
  };

  /**
   * 設定音量
   */
  const setVolume = (vol) => {
    volume.value = Math.max(0, Math.min(1, vol));
    if (aplayerInstance.value) {
      aplayerInstance.value.volume(volume.value, true);
    }
    saveToStorage();
  };

  /**
   * 切換迴圈模式
   */
  const toggleLoopMode = () => {
    const modes = ["all", "one", "none"];
    const currentModeIndex = modes.indexOf(loopMode.value);
    loopMode.value = modes[(currentModeIndex + 1) % modes.length];
    saveToStorage();
  };

  /**
   * 設定迴圈模式
   */
  const setLoopMode = (mode) => {
    if (["all", "one", "none"].includes(mode)) {
      loopMode.value = mode;
      saveToStorage();
    }
  };

  /**
   * 切換播放順序
   */
  const toggleOrderMode = () => {
    orderMode.value = orderMode.value === "list" ? "random" : "list";
    saveToStorage();
  };

  /**
   * 設定播放順序
   */
  const setOrderMode = (order) => {
    if (["list", "random"].includes(order)) {
      orderMode.value = order;
      saveToStorage();
    }
  };

  /**
   * 關閉播放器
   */
  const closePlayer = () => {
    isVisible.value = false;
    isPlaying.value = false;
    playlist.value = [];
    currentIndex.value = 0;
    currentTime.value = 0;
    duration.value = 0;
    displayMode.value = "mini";
    error.value = null;
    aplayerInstance.value = null;

    clearStorage();
  };

  // ===== 持久化方法 =====

  const storedState = useLocalStorage(STORAGE_KEY, null, { writeDefaults: false });

  const saveToStorage = () => {
    try {
      const state = {
        displayMode: displayMode.value,
        volume: volume.value,
        loopMode: loopMode.value,
        orderMode: orderMode.value,
      };
      storedState.value = state;
    } catch (e) {
      log.warn("儲存播放器狀態失敗:", e);
    }
  };

  const loadFromStorage = () => {
    try {
      const state = storedState.value;
      if (!state || typeof state !== "object") return;
      if (state.displayMode) displayMode.value = state.displayMode;
      if (typeof state.volume === "number") volume.value = state.volume;
      if (state.loopMode) loopMode.value = state.loopMode;
      if (state.orderMode) orderMode.value = state.orderMode;
    } catch (e) {
      log.warn("載入播放器狀態失敗:", e);
    }
  };

  const clearStorage = () => {
    try {
      storedState.remove?.();
    } catch (e) {
      log.warn("清除播放器狀態失敗:", e);
    }
  };

  const initialize = () => {
    loadFromStorage();
  };

  initialize();

  return {
    // 狀態
    isVisible,
    displayMode,
    isPlaying,
    playlist,
    currentIndex,
    currentTime,
    duration,
    volume,
    loopMode,
    orderMode,
    error,

    // 計算屬性
    currentTrack,
    hasPlaylist,
    isMiniMode,
    isExpandedMode,
    progress,
    formattedCurrentTime,
    formattedDuration,

    // APlayer 例項管理
    setAPlayerInstance,
    getAPlayerInstance,

    // 狀態同步
    syncPlayState,
    syncProgress,
    syncCurrentIndex,

    // 播放控制
    play,
    pause,
    togglePlay,
    seekTo,
    seekToPercent,

    // 顯示控制
    showPlayer,
    hidePlayer,
    toggleVisibility,
    toggleDisplayMode,
    setDisplayMode,

    // 播放列表管理
    setPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    clearPlaylist,
    switchTrack,
    playNext,
    playPrev,
    setVolume,
    toggleLoopMode,
    setLoopMode,
    toggleOrderMode,
    setOrderMode,
    closePlayer,

    // 持久化
    saveToStorage,
    loadFromStorage,
    clearStorage,
    initialize,
  };
});
