/**
 * 全域性音樂播放器 Composable
 * 提供簡化的播放器控制 API，配合官方 APlayer 例項
 */

import { useGlobalPlayerStore } from "@/stores/globalPlayerStore.js";
import { storeToRefs } from "pinia";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("GlobalPlayer");

export function useGlobalPlayer() {
  const store = useGlobalPlayerStore();

  // 解構響應式狀態
  const {
    isVisible,
    isPlaying,
    isMiniMode,
    isExpandedMode,
    currentTrack,
    hasPlaylist,
    playlist,
    currentIndex,
    progress,
    volume,
    loopMode,
    orderMode,
    formattedCurrentTime,
    formattedDuration,
    error,
  } = storeToRefs(store);

  /**
   * 播放音訊列表
   * @param {Array} audioList - 音訊列表
   * @param {number} startIndex - 開始播放的索引
   */
  const playAudio = (audioList, startIndex = 0) => {
    if (!audioList || audioList.length === 0) {
      log.warn("playAudio: 音訊列表為空");
      return;
    }
    store.setPlaylist(audioList, startIndex);
    store.setDisplayMode("expanded");
  };

  /**
   * 播放單個音訊
   * @param {Object} audio - 音訊物件
   */
  const playSingleAudio = (audio) => {
    if (!audio || !audio.url) {
      log.warn("playSingleAudio: 音訊物件無效");
      return;
    }
    playAudio([audio], 0);
  };

  /**
   * 新增音訊到播放列表
   * @param {Object} audio - 音訊物件
   * @param {boolean} playNow - 是否立即播放
   */
  const addToPlaylist = (audio, playNow = false) => {
    store.addToPlaylist(audio);
    if (playNow) {
      const index = store.playlist.length - 1;
      store.switchTrack(index);
    }
    store.showPlayer();
  };

  /**
   * 切換播放/暫停
   */
  const togglePlay = () => {
    store.togglePlay();
  };

  /**
   * 播放
   */
  const play = () => {
    store.play();
  };

  /**
   * 暫停
   */
  const pause = () => {
    store.pause();
  };

  /**
   * 播放下一首
   */
  const playNext = () => {
    store.playNext();
  };

  /**
   * 播放上一首
   */
  const playPrev = () => {
    store.playPrev();
  };

  /**
   * 切換到指定索引的音訊
   * @param {number} index - 索引
   */
  const switchTo = (index) => {
    store.switchTrack(index);
  };

  /**
   * 設定音量
   * @param {number} vol - 音量 (0-1)
   */
  const setVolume = (vol) => {
    store.setVolume(vol);
  };

  /**
   * 跳轉到指定時間
   * @param {number} time - 時間（秒）
   */
  const seekTo = (time) => {
    store.seekTo(time);
  };

  /**
   * 顯示播放器
   */
  const showPlayer = () => {
    store.showPlayer();
  };

  /**
   * 隱藏播放器
   */
  const hidePlayer = () => {
    store.hidePlayer();
  };

  /**
   * 切換播放器顯示/隱藏
   */
  const togglePlayer = () => {
    store.toggleVisibility();
  };

  /**
   * 切換 mini/expanded 模式
   */
  const toggleDisplayMode = () => {
    store.toggleDisplayMode();
  };

  /**
   * 設定為 mini 模式
   */
  const setMiniMode = () => {
    store.setDisplayMode("mini");
  };

  /**
   * 設定為展開模式
   */
  const setExpandedMode = () => {
    store.setDisplayMode("expanded");
  };

  /**
   * 關閉播放器
   */
  const closePlayer = () => {
    store.closePlayer();
  };

  /**
   * 清空播放列表
   */
  const clearPlaylist = () => {
    store.clearPlaylist();
  };

  /**
   * 切換迴圈模式
   */
  const toggleLoopMode = () => {
    store.toggleLoopMode();
  };

  /**
   * 切換播放順序
   */
  const toggleOrderMode = () => {
    store.toggleOrderMode();
  };

  /**
   * 獲取 APlayer 例項（高階用法）
   */
  const getAPlayerInstance = () => {
    return store.getAPlayerInstance();
  };

  return {
    // 狀態（只讀）
    isVisible,
    isPlaying,
    isMiniMode,
    isExpandedMode,
    currentTrack,
    hasPlaylist,
    playlist,
    currentIndex,
    progress,
    volume,
    loopMode,
    orderMode,
    formattedCurrentTime,
    formattedDuration,
    error,

    // 播放控制
    playAudio,
    playSingleAudio,
    addToPlaylist,
    togglePlay,
    play,
    pause,
    playNext,
    playPrev,
    switchTo,
    setVolume,
    seekTo,

    // 顯示控制
    showPlayer,
    hidePlayer,
    togglePlayer,
    toggleDisplayMode,
    setMiniMode,
    setExpandedMode,
    closePlayer,
    clearPlaylist,

    // 模式控制
    toggleLoopMode,
    toggleOrderMode,

    // APlayer 例項（高階用法）
    getAPlayerInstance,

    // Store 引用（高階用法）
    store,
  };
}
