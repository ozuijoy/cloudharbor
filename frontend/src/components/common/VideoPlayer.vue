<template>
  <div class="video-player-container" :class="{ 'dark-theme': darkMode, 'is-fullscreen': isFullscreen }">
    <div ref="artplayerContainer" class="artplayer-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import Artplayer from "artplayer";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("VideoPlayer");

const getExtLower = (name) => {
  const n = String(name || "");
  const idx = n.lastIndexOf(".");
  if (idx < 0) return "";
  return n.slice(idx + 1).toLowerCase();
};

// Props 定義
const props = defineProps({
  // 影片檔案資訊
  video: {
    type: Object,
    required: true,
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
  // 播放器主題色
  theme: {
    type: String,
    default: "#3b82f6",
  },
  // 播放器模式：'normal', 'mini', 'fullscreen'
  mode: {
    type: String,
    default: "normal",
  },
  // 是否迴圈播放
  loop: {
    type: Boolean,
    default: false,
  },
  // 音量
  volume: {
    type: Number,
    default: 0.7,
  },
  // 是否靜音
  muted: {
    type: Boolean,
    default: false,
  },
  // 播放速度由 Artplayer 內建功能提供，無需額外配置
  // 是否顯示字幕
  showSubtitle: {
    type: Boolean,
    default: false,
  },
  // 字幕檔案URL
  subtitleUrl: {
    type: String,
    default: "",
  },
  // 是否顯示全屏按鈕
  showFullscreenControl: {
    type: Boolean,
    default: true,
  },
  // 外層容器是否處於全屏狀態（用於樣式控制）
  isFullscreen: {
    type: Boolean,
    default: false,
  },

  // 自定義控制器陣列
  customControls: {
    type: Array,
    default: () => [],
  },
  // 預載入策略
  preload: {
    type: String,
    default: "metadata", // none, metadata, auto
  },
});

// Emits 定義
const emit = defineEmits([
  // 基礎播放事件
  "play",
  "pause",
  "ended",
  "timeupdate",
  "loadstart",
  "canplay",
  "error",
  "ready",
  "loaded",

  // 全屏事件
  "fullscreen",
  "fullscreenExit",
  "fullscreenWeb",

  // 音訊和進度事件
  "volumechange",
  "seeked",

  "flip", // 影片翻轉事件
  "aspectRatio", // 長寬比變化事件
  "pip", // 畫中畫事件
  "lock", // 移動端鎖定事件
  "screenshot", // 截圖事件
  "gesture", // 移動端手勢事件
]);

// 響應式資料
const artplayerContainer = ref(null);
const artplayerInstance = ref(null);
const didAutoApplyDefaultSubtitle = ref(false);

// 計算主題色
const getThemeColor = () => {
  if (props.darkMode) {
    return "#8b5cf6"; // 深色模式下使用紫色，與影片檔案型別色彩一致
  }
  return props.theme;
};

const getVideoSourceKey = () => {
  const v = props.video || {};
  const url = String(v.url || "");
  const name = String(v.name || v.title || "");
  const contentType = String(v.contentType || v.mimetype || "");
  const linkType = String(v.linkType || v.originalFile?.linkType || "");
  return `${url}::${name}::${contentType}::${linkType}`;
};

const getEffectiveSubtitleTracks = () => {
  const rawTracks = Array.isArray(props.video?.subtitleTracks) ? props.video.subtitleTracks : [];
  if (rawTracks.length > 0) return rawTracks;
  if (props.showSubtitle && props.subtitleUrl) {
    return [{ name: "字幕", url: props.subtitleUrl, type: "srt", default: true }];
  }
  return [];
};

const buildSubtitleSettingPayload = (tracks) => {
  const effectiveTracks = Array.isArray(tracks) ? tracks : [];
  if (effectiveTracks.length <= 0) return null;

  const defaultTrack =
    effectiveTracks.find((t) => t && t.default && t.url) ||
    effectiveTracks.find((t) => t && t.url) ||
    null;

  const selector = [
    { default: !defaultTrack, html: "關閉字幕", url: "" },
    ...effectiveTracks.map((t) => ({
      default: !!t?.default,
      html: String(t?.name || "字幕"),
      url: String(t?.url || ""),
      type: String(t?.type || getExtLower(t?.name) || "srt"),
    })),
  ];

  return {
    name: "subtitle",
    html: "字幕",
    width: 260,
    tooltip: defaultTrack?.name || "關閉字幕",
    selector,
    onSelect: function (item) {
      const art = artplayerInstance.value;
      if (!art) return item?.html;
      const nextUrl = String(item?.url || "");
      if (!nextUrl) {
        if (art.subtitle) art.subtitle.show = false;
        didAutoApplyDefaultSubtitle.value = true;
        return "關閉字幕";
      }
      if (art.subtitle) {
        art.subtitle.url = nextUrl;
        art.subtitle.show = true;
      }
      didAutoApplyDefaultSubtitle.value = true;
      return String(item?.html || "字幕");
    },
  };
};

const applySubtitleSettingsToInstance = () => {
  const art = artplayerInstance.value;
  if (!art) return;

  const tracks = getEffectiveSubtitleTracks();
  const payload = buildSubtitleSettingPayload(tracks);
  if (!payload) return;

  if (art.setting && typeof art.setting.update === "function" && art.__cpSubtitleInstalled) {
    art.setting.update(payload);
  } else if (art.setting && typeof art.setting.add === "function" && !art.__cpSubtitleInstalled) {
    art.setting.add(payload);
    art.__cpSubtitleInstalled = true;
  }

  const defaultTrack =
    tracks.find((t) => t && t.default && t.url) ||
    tracks.find((t) => t && t.url) ||
    null;

  if (!defaultTrack?.url) return;

  const currentUrl = String(art.subtitle?.url || "");
  if (!didAutoApplyDefaultSubtitle.value && !currentUrl) {
    if (art.subtitle) {
      art.subtitle.url = String(defaultTrack.url);
      art.subtitle.show = true;
    }
    didAutoApplyDefaultSubtitle.value = true;
  }
};

// 是否應當為當前影片 URL 啟用 CORS 模式
// - 同源資源：啟用 CORS 模式可支援截圖等高階能力
// - 代理鏈路（linkType=proxy）：預期返回 ACAO 頭，啟用更安全
// - 第三方直鏈（linkType=direct 且跨域）：禁用 CORS 模式，避免 PWA Service Worker 以 cors 請求導致播放失敗（如 GitHub Releases 302 鏈）
const shouldEnableCorsMode = (rawUrl, linkType) => {
  if (!rawUrl) return false;
  try {
    const resolvedUrl = new URL(rawUrl, window.location.href);
    if (resolvedUrl.origin === window.location.origin) {
      return true;
    }
    if (linkType === "proxy") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// 初始化 Artplayer
const initArtplayer = async () => {
  if (!artplayerContainer.value || !props.video?.url) return;
  didAutoApplyDefaultSubtitle.value = false;

  // 銷燬現有例項
  if (artplayerInstance.value) {
    // 清理流媒體播放器例項
    if (artplayerInstance.value.streamPlayer) {
      try {
        if (artplayerInstance.value.streamPlayer.pause) {
          artplayerInstance.value.streamPlayer.pause();
        }
        if (artplayerInstance.value.streamPlayer.unload) {
          artplayerInstance.value.streamPlayer.unload();
        }
        if (artplayerInstance.value.streamPlayer.detachMediaElement) {
          artplayerInstance.value.streamPlayer.detachMediaElement();
        }
        if (artplayerInstance.value.streamPlayer.destroy) {
          artplayerInstance.value.streamPlayer.destroy();
        }
        log.debug("流媒體播放器清理完成");
      } catch (error) {
        log.warn("清理流媒體播放器時出錯:", error);
      }
    }

    artplayerInstance.value.destroy();
    artplayerInstance.value = null;
  }

  // Artplayer 配置 - 使用最簡化配置確保相容性
  const options = {
    container: artplayerContainer.value,
    url: props.video.url,
  };

  // 安全地新增可選配置
  if (props.video.name || props.video.title) {
    options.title = props.video.name || props.video.title || "影片播放";
  }

  if (props.video.poster || props.video.cover) {
    options.poster = props.video.poster || props.video.cover;
  }

  // 基礎播放配置
  options.autoplay = props.autoplay;
  options.volume = props.volume;
  options.muted = props.muted;
  options.loop = props.loop;
  options.theme = getThemeColor();
  options.lang = "zh-cn";

  // 功能配置
  options.playbackRate = true;
  options.setting = true;
  options.settings = [];
  options.hotkey = true;
  options.pip = true;
  options.screenshot = true;
  options.miniProgressBar = true;
  options.fullscreen = props.showFullscreenControl;
  options.fullscreenWeb = props.showFullscreenControl;
  options.flip = true;
  options.aspectRatio = true;

  // 移動端最佳化
  options.autoOrientation = true; // 移動端自動旋轉
  options.fastForward = true; // 長按快進功能
  options.lock = true; // 移動端鎖定功能

  // 播放體驗最佳化
  options.autoPlayback = true; // 自動記憶播放進度
  options.mutex = true; // 互斥播放（同時只能播放一個）
  options.subtitleOffset = true; // 字幕偏移功能

  // 控制器配置
  options.controls = props.customControls;

  // 只有在需要字幕時才新增 subtitle 選項
  if (props.showSubtitle && props.subtitleUrl) {
    options.subtitle = {
      url: props.subtitleUrl,
      type: "srt",
      encoding: "utf-8",
      escape: true,
    };
  }

  // 字幕列表
  const effectiveTracks = getEffectiveSubtitleTracks();
  let initialSubtitleSettingPayload = null;

  if (effectiveTracks.length > 0) {
    const defaultTrack = effectiveTracks.find((t) => t && t.default && t.url) || effectiveTracks.find((t) => t && t.url) || null;

    // 如果外層沒顯式給 subtitleUrl，但我們有預設字幕，就自動帶上
    if (!options.subtitle && defaultTrack?.url) {
      options.subtitle = {
        url: defaultTrack.url,
        type: String(defaultTrack.type || getExtLower(defaultTrack.name) || "srt"),
        encoding: "utf-8",
        escape: true,
      };
    }

    initialSubtitleSettingPayload = buildSubtitleSettingPayload(effectiveTracks);
    if (initialSubtitleSettingPayload) options.settings.push(initialSubtitleSettingPayload);
  }

  // 新增跨域支援以啟用截圖功能
  const effectiveLinkType =
    props.video?.linkType || props.video?.originalFile?.linkType || null;
  const enableCorsMode = shouldEnableCorsMode(
    props.video.url,
    effectiveLinkType
  );
  options.moreVideoAttr = enableCorsMode
    ? { crossOrigin: "anonymous", preload: "metadata" }
    : { preload: "metadata" };

  // 根據模式調整配置
  if (props.mode === "mini") {
    options.autoSize = true;
    // mini 模式下隱藏控制欄，透過 CSS 控制
    options.controls = [];
  }

  // 檢測並新增流媒體支援
  await addStreamingSupport(options);

  try {
    // 建立 Artplayer 例項
    artplayerInstance.value = new Artplayer(options);
    if (initialSubtitleSettingPayload) {
      artplayerInstance.value.__cpSubtitleInstalled = true;
    }

    // 如果是流媒體播放器，將播放器例項從video元素轉移到artplayerInstance
    if (artplayerInstance.value.video) {
      if (artplayerInstance.value.video.streamPlayer) {
        artplayerInstance.value.streamPlayer = artplayerInstance.value.video.streamPlayer;
        log.debug("流媒體播放器例項已轉移到Artplayer例項");
      }
    }

    // 繫結事件監聽器
    bindEvents();

    // 應用主題樣式
    applyThemeStyles();

    // 字幕列表可能是非同步補齊的，例項建立後再做一次“熱更新”兜底
    applySubtitleSettingsToInstance();

    emit("ready", artplayerInstance.value);
  } catch (error) {
    log.error("Artplayer 初始化失敗:", error);
    emit("error", error);
  }
};

// 檢測流媒體格式
const detectStreamingFormat = (url, contentType, fileName) => {
  // HLS 檢測
  if (
    url.toLowerCase().includes(".m3u8") ||
    fileName.toLowerCase().endsWith(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("application/vnd.apple.mpegurl")
  ) {
    return "m3u8";
  }
  // MPEG-TS 檢測
  if (
    url.toLowerCase().includes(".ts") ||
    url.toLowerCase().includes(".m2ts") ||
    contentType.includes("mp2t") ||
    fileName.toLowerCase().endsWith(".ts") ||
    fileName.toLowerCase().endsWith(".m2ts")
  ) {
    return "mpegts";
  }
  // FLV 檢測
  if (url.toLowerCase().includes(".flv") || contentType.includes("flv") || contentType === "video/x-flv" || fileName.toLowerCase().endsWith(".flv")) {
    return "flv";
  }
  return null;
};

// 新增流媒體支援函式
const addStreamingSupport = async (options) => {
  const videoUrl = props.video?.url || "";
  const contentType = props.video?.contentType || props.video?.mimetype || "";
  const fileName = props.video?.name || "";

  // 檢測流媒體格式
  const streamingFormat = detectStreamingFormat(videoUrl, contentType, fileName);

  if (!streamingFormat) {
    log.debug("非流媒體格式，使用預設播放器");
    return;
  }

  log.debug(`檢測到${streamingFormat.toUpperCase()}格式，正在載入相應播放器...`);

  try {
    // 初始化customType物件
    options.customType = options.customType || {};

    if (streamingFormat === "m3u8") {
      await setupHLSPlayer(options, videoUrl);
    } else if (streamingFormat === "flv" || streamingFormat === "mpegts") {
      await setupMpegTSPlayer(options, videoUrl, streamingFormat);
    }
  } catch (error) {
    log.error(`載入${streamingFormat}播放器失敗:`, error);
    emit("error", {
      type: `${streamingFormat}_load_error`,
      message: `載入${streamingFormat.toUpperCase()}播放器失敗: ${error.message}`,
      originalError: error,
    });
  }
};

// 設定 HLS 播放器
const setupHLSPlayer = async (options, videoUrl) => {
  // 動態匯入 hls.js
  const Hls = await import("hls.js");

  // 檢查瀏覽器支援
  if (!Hls.default.isSupported()) {
    log.warn(" 當前瀏覽器不支援HLS播放");
    emit("error", {
      type: "hls_not_supported",
      message: "當前瀏覽器不支援HLS播放，請使用Chrome、Firefox或Edge瀏覽器",
    });
    return;
  }

  // 配置HLS自定義型別
  options.customType.m3u8 = function (video, url, art) {
    const urlTransform = typeof props.video?.hlsUrlTransform === "function" ? props.video.hlsUrlTransform : null;

    const installHlsMenus = (targetArt, hlsInstance) => {
      // 只在 setting 開啟時才加選單
      if (!targetArt?.setting || typeof targetArt.setting.add !== "function") return;

      // 1) 清晰度（levels）
      const updateQuality = () => {
        const levels = Array.isArray(hlsInstance.levels) ? hlsInstance.levels : [];
        if (!levels.length) return;

        const auto = hlsInstance.currentLevel === -1 || hlsInstance.autoLevelEnabled === true;
        const selector = [
          { default: auto, html: "自動", level: -1 },
          ...levels.map((lvl, idx) => {
            const label = lvl?.height ? `${lvl.height}P` : lvl?.bitrate ? `${Math.round(lvl.bitrate / 1000)}kbps` : `L${idx}`;
            return { default: !auto && hlsInstance.currentLevel === idx, html: label, level: idx };
          }),
        ];

        const currentLabel = auto
          ? "自動"
          : selector.find((x) => x.default)?.html || "自動";

        const payload = {
          name: "hls-quality",
          html: "清晰度",
          width: 180,
          tooltip: currentLabel,
          selector,
          onSelect: function (item) {
            const level = Number(item?.level);
            if (!Number.isFinite(level)) return String(item?.html || "自動");
            if (level < 0) {
              hlsInstance.currentLevel = -1;
              return "自動";
            }
            hlsInstance.currentLevel = level;
            return String(item?.html || "清晰度");
          },
        };

        if (!targetArt.__cpHlsQualityInstalled) {
          targetArt.setting.add(payload);
          targetArt.__cpHlsQualityInstalled = true;
        } else if (typeof targetArt.setting.update === "function") {
          targetArt.setting.update(payload);
        }
      };

      // 2) 音軌（audioTracks）
      const updateAudio = () => {
        const tracks = Array.isArray(hlsInstance.audioTracks) ? hlsInstance.audioTracks : [];
        if (tracks.length <= 1) return;
        const selector = tracks.map((tr, idx) => ({
          default: hlsInstance.audioTrack === idx,
          html: String(tr?.name || tr?.lang || `音軌 ${idx + 1}`),
          track: idx,
        }));
        const currentLabel = selector.find((x) => x.default)?.html || "音軌";
        const payload = {
          name: "hls-audio",
          html: "音軌",
          width: 220,
          tooltip: currentLabel,
          selector,
          onSelect: function (item) {
            const track = Number(item?.track);
            if (!Number.isFinite(track) || track < 0) return String(item?.html || "音軌");
            hlsInstance.audioTrack = track;
            return String(item?.html || "音軌");
          },
        };
        if (!targetArt.__cpHlsAudioInstalled) {
          targetArt.setting.add(payload);
          targetArt.__cpHlsAudioInstalled = true;
        } else if (typeof targetArt.setting.update === "function") {
          targetArt.setting.update(payload);
        }
      };

      // 觸發一次 + 後續在事件裡更新
      updateQuality();
      updateAudio();

      try {
        hlsInstance.on(Hls.default.Events.MANIFEST_PARSED, () => updateQuality());
        hlsInstance.on(Hls.default.Events.LEVEL_SWITCHED, () => updateQuality());
        hlsInstance.on(Hls.default.Events.AUDIO_TRACKS_UPDATED, () => updateAudio());
        hlsInstance.on(Hls.default.Events.AUDIO_TRACK_SWITCHED, () => updateAudio());
      } catch {
        // ignore
      }
    };

    const hlsPlayer = new Hls.default({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 120,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.25,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      abrBandWidthFactor: 0.8,
      //重試配置
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 10000,
          maxLoadTimeMs: 120000,
          timeoutRetry: {
            maxNumRetry: 2, // 最多重試2次
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
          errorRetry: {
            maxNumRetry: 1, // 錯誤重試最多1次
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
        },
      },
      playlistLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 10000,
          maxLoadTimeMs: 120000,
          timeoutRetry: {
            maxNumRetry: 2,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
          errorRetry: {
            maxNumRetry: 1,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
        },
      },
      // 用自定義 loader 在載入前“改 URL”
      ...(urlTransform
        ? {
            pLoader: class extends Hls.default.DefaultConfig.loader {
              constructor(config) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = function (context, config, callbacks) {
                  urlTransform(context.url, true)
                    .then((nextUrl) => {
                      const finalUrl = nextUrl || context.url;
                      const complete = callbacks.onSuccess;
                      callbacks.onSuccess = (loaderResponse, stats, successContext, networkDetails) => {
                        loaderResponse.url = finalUrl;
                        complete(loaderResponse, stats, successContext, networkDetails);
                      };
                      originalLoad({ ...context, url: finalUrl }, config, callbacks);
                    })
                    .catch(() => originalLoad(context, config, callbacks));
                };
              }
            },
            fLoader: class extends Hls.default.DefaultConfig.loader {
              constructor(config) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = function (context, config, callbacks) {
                  urlTransform(context.url, false)
                    .then((nextUrl) => {
                      const finalUrl = nextUrl || context.url;
                      const complete = callbacks.onSuccess;
                      callbacks.onSuccess = (loaderResponse, stats, successContext, networkDetails) => {
                        loaderResponse.url = finalUrl;
                        complete(loaderResponse, stats, successContext, networkDetails);
                      };
                      // fragment 需要同時改 frag 的 url 欄位
                      originalLoad(
                        { ...context, frag: { ...(context.frag || {}), relurl: finalUrl, _url: finalUrl }, url: finalUrl },
                        config,
                        callbacks,
                      );
                    })
                    .catch(() => originalLoad(context, config, callbacks));
                };
              }
            },
          }
        : {}),
      // 兜底：禁用憑據傳遞
      xhrSetup: function (xhr) {
        xhr.withCredentials = false;
      },
    });

    // HLS播放器事件處理
    hlsPlayer.on(Hls.default.Events.ERROR, (event, data) => {
      let errorMessage = "HLS播放出現錯誤";
      if (data.fatal) {
        switch (data.type) {
          case Hls.default.ErrorTypes.NETWORK_ERROR:
            errorMessage = "網路錯誤，HLS.js將自動重試";
            break;
          case Hls.default.ErrorTypes.MEDIA_ERROR:
            errorMessage = "媒體解碼錯誤，HLS.js將自動恢復";
            break;
          default:
            errorMessage = `HLS播放錯誤: ${data.details || "未知錯誤"}`;
            log.error("HLS致命錯誤，銷燬播放器:", data.details);
            hlsPlayer.destroy();
            break;
        }

        emit("error", {
          type: "hls_error",
          errorType: data.type,
          errorDetail: data,
          message: errorMessage,
        });
      }
    });

    // 載入HLS源
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    // 兜底：讓 video 元素也拿到 src
    if (!video.src) {
      try {
        video.src = url;
      } catch {
        // ignore
      }
    }

    // 儲存hlsPlayer例項以便後續清理
    video.streamPlayer = hlsPlayer;
    if (art) {
      art.hls = hlsPlayer;
      try {
        art.on("destroy", () => hlsPlayer.destroy());
      } catch {
        // ignore
      }
      // 選單：只在 HLS 時出現
      installHlsMenus(art, hlsPlayer);
    }
    log.debug("HLS播放器初始化完成");
  };

  // 設定URL型別為 m3u8
  options.type = "m3u8";
};

// 設定 mpegts.js 播放器 (支援 FLV 和 MPEG-TS)
const setupMpegTSPlayer = async (options, videoUrl, format) => {
  log.debug(`正在載入 mpegts.js 用於 ${format.toUpperCase()} 播放...`);

  // 動態匯入 mpegts.js
  const mpegts = await import("mpegts.js");

  // 檢查瀏覽器支援
  if (!mpegts.isSupported?.()) {
    log.warn("當前瀏覽器不支援MPEG-TS/FLV播放");
    emit("error", {
      type: `${format}_not_supported`,
      message: `當前瀏覽器不支援${format.toUpperCase()}播放，請使用Chrome、Firefox或Edge瀏覽器`,
    });
    return;
  }

  log.debug(`mpegts.js載入成功，配置${format.toUpperCase()}播放器...`);

  // 配置自定義型別
  options.customType[format] = function (video, url) {
    log.debug(`初始化${format.toUpperCase()}播放器，URL:`, url);

    const inferredTsType =
      format === "flv"
        ? "flv"
        : url.toLowerCase().includes(".m2ts") || (props.video?.name || "").toLowerCase().endsWith(".m2ts")
          ? "m2ts"
          : "mpegts";

    const playerConfig = {
      type: inferredTsType,
      isLive: false,
      cors: true,
      withCredentials: false,
      url: url,
    };

    const mediaConfig = {
      accurateSeek: true,
      seekType: "range",
      lazyLoadMaxDuration: 5 * 60,
      reuseRedirectedURL: true,
    };

    const streamPlayer = mpegts.createPlayer(playerConfig, mediaConfig);

    // 播放器事件處理
    streamPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
      log.error(`${format.toUpperCase()}播放錯誤:`, errorType, errorDetail);

      let errorMessage = `${format.toUpperCase()}播放出現錯誤`;
      switch (errorType) {
        case mpegts.ErrorTypes.NETWORK_ERROR:
          errorMessage = `網路錯誤，無法載入${format.toUpperCase()}影片`;
          break;
        case mpegts.ErrorTypes.MEDIA_ERROR:
          errorMessage = `媒體解碼錯誤，${format.toUpperCase()}格式可能不相容`;
          break;
        case mpegts.ErrorTypes.OTHER_ERROR:
          errorMessage = `載入錯誤，無法獲取${format.toUpperCase()}影片資料`;
          break;
        default:
          errorMessage = `${format.toUpperCase()}播放錯誤: ${errorDetail?.info || "未知錯誤"}`;
      }

      emit("error", {
        type: `${format}_error`,
        errorType,
        errorDetail,
        message: errorMessage,
      });
    });

    streamPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
      log.debug(`${format.toUpperCase()}載入完成`);
    });

    streamPlayer.on(mpegts.Events.RECOVERED_EARLY_EOF, () => {
      log.debug(`${format.toUpperCase()}早期EOF恢復`);
    });

    streamPlayer.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
      log.debug(`${format.toUpperCase()}媒體資訊:`, mediaInfo);
    });

    // 繫結到video元素並載入
    streamPlayer.attachMediaElement(video);
    streamPlayer.load();

    // 儲存streamPlayer例項以便後續清理
    video.streamPlayer = streamPlayer;

    log.debug(`${format.toUpperCase()}播放器初始化完成`);
  };

  // 設定URL型別
  options.type = format;

  log.debug(`${format.toUpperCase()}支援配置完成`);
};

// 繫結事件監聽器
const bindEvents = () => {
  if (!artplayerInstance.value) return;

  const art = artplayerInstance.value;

  art.on("play", () => {
    emit("play", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("pause", () => {
    emit("pause", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("ended", () => {
    emit("ended", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("timeupdate", () => {
    emit("timeupdate", {
      currentTime: art.currentTime,
      duration: art.duration,
      percentage: art.duration > 0 ? (art.currentTime / art.duration) * 100 : 0,
    });
  });

  art.on("loadstart", () => {
    emit("loadstart");
  });

  art.on("canplay", () => {
    emit("canplay");
  });

  art.on("error", (error) => {
    log.error("Artplayer 播放錯誤:", error);
    emit("error", error);
  });

  art.on("fullscreen", (state) => {
    if (state) {
      emit("fullscreen");
    } else {
      emit("fullscreenExit");
    }
  });

  art.on("volumechange", () => {
    emit("volumechange", {
      volume: art.volume,
      muted: art.muted,
    });
  });

  art.on("seeked", () => {
    emit("seeked", {
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  // 新增的高階功能事件
  art.on("flip", (flip) => {
    emit("flip", flip);
  });

  art.on("aspectRatio", (ratio) => {
    emit("aspectRatio", ratio);
  });

  art.on("pip", (state) => {
    emit("pip", state);
  });

  art.on("lock", (state) => {
    emit("lock", state);
  });

  art.on("screenshot", (dataUri) => {
    emit("screenshot", dataUri);
  });

  // 移動端手勢事件
  art.on("gesture", (event) => {
    emit("gesture", event);
  });

  // 網頁全屏事件
  art.on("fullscreenWeb", (state) => {
    emit("fullscreenWeb", state);
  });
};

// 應用主題樣式
const applyThemeStyles = () => {
  if (!artplayerContainer.value) return;

  nextTick(() => {
    const artplayerElement = artplayerContainer.value.querySelector(".art-video-player");
    if (!artplayerElement) return;

    // 更新主題色
    const themeColor = getThemeColor();
    artplayerElement.style.setProperty("--art-theme", themeColor);

    // 應用暗色主題類
    if (props.darkMode) {
      artplayerContainer.value.classList.add("dark-theme");
    } else {
      artplayerContainer.value.classList.remove("dark-theme");
    }
  });
};

// 公開的方法
const play = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.play();
  }
};

const pause = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pause();
  }
};

const toggle = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.toggle();
  }
};

const seek = (time) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.seek = time;
  }
};

const setVolume = (volume) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.volume = volume;
  }
};

const setMuted = (muted) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.muted = muted;
  }
};

const setPlaybackRate = (rate) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.playbackRate = rate;
  }
};

const enterFullscreen = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.fullscreen = true;
  }
};

const exitFullscreen = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.fullscreen = false;
  }
};

const screenshot = async (filename) => {
  if (artplayerInstance.value) {
    try {
      // 使用 Artplayer 的內建截圖功能，會自動下載
      artplayerInstance.value.screenshot(filename || `video-screenshot-${Date.now()}`);
      return true;
    } catch (error) {
      log.error("截圖失敗:", error);
      return false;
    }
  }
  return false;
};

const getScreenshotDataURL = async () => {
  if (artplayerInstance.value) {
    try {
      return await artplayerInstance.value.getDataURL();
    } catch (error) {
      log.error("獲取截圖 DataURL 失敗:", error);
      return null;
    }
  }
  return null;
};

const getScreenshotBlobUrl = async () => {
  if (artplayerInstance.value) {
    try {
      return await artplayerInstance.value.getBlobUrl();
    } catch (error) {
      log.error("獲取截圖 BlobUrl 失敗:", error);
      return null;
    }
  }
  return null;
};

// 影片翻轉控制
const setFlip = (flipType) => {
  if (artplayerInstance.value) {
    // flipType: 'normal', 'horizontal', 'vertical'
    artplayerInstance.value.flip = flipType;
  }
};

const getFlip = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.flip;
  }
  return "normal";
};

// 影片長寬比控制
const setAspectRatio = (ratio) => {
  if (artplayerInstance.value) {
    // ratio: '16:9', '4:3', '1:1', 'default' 等
    artplayerInstance.value.aspectRatio = ratio;
  }
};

const getAspectRatio = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.aspectRatio;
  }
  return "default";
};

// 移動端鎖定控制
const setLock = (locked) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.lock = locked;
  }
};

const getLock = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.lock;
  }
  return false;
};

// 畫中畫控制
const enterPip = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pip = true;
  }
};

const exitPip = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pip = false;
  }
};

// 暴露方法給父元件
defineExpose({
  play,
  pause,
  toggle,
  seek,
  setVolume,
  setMuted,
  setPlaybackRate,
  enterFullscreen,
  exitFullscreen,
  screenshot,
  getScreenshotDataURL,
  getScreenshotBlobUrl,
  setFlip,
  getFlip,
  setAspectRatio,
  getAspectRatio,
  setLock,
  getLock,
  enterPip,
  exitPip,
  getInstance: () => artplayerInstance.value,
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
    if (artplayerInstance.value) {
      artplayerInstance.value.theme = getThemeColor();
    }
    applyThemeStyles();
  }
);

watch(
  () => getVideoSourceKey(),
  () => {
    initArtplayer();
  }
);

watch(
  () => props.volume,
  (newVolume) => {
    setVolume(newVolume);
  }
);

watch(
  () => props.muted,
  (newMuted) => {
    setMuted(newMuted);
  }
);

watch(
  () => props.loop,
  (val) => {
    const art = artplayerInstance.value;
    if (!art) return;
    try {
      art.loop = !!val;
    } catch {
      initArtplayer();
    }
  }
);

watch(
  () => {
    const tracks = getEffectiveSubtitleTracks();
    const key = tracks
      .map((t) => `${String(t?.url || "")}:${t?.default ? 1 : 0}:${String(t?.type || "")}`)
      .join("|");
    return `${props.showSubtitle ? 1 : 0}::${String(props.subtitleUrl || "")}::${key}`;
  },
  () => {
    applySubtitleSettingsToInstance();
  }
);

// 生命週期
onMounted(() => {
  nextTick(() => {
    initArtplayer();
  });
});

onBeforeUnmount(() => {
  if (artplayerInstance.value) {
    // 清理流媒體播放器例項
    if (artplayerInstance.value.streamPlayer) {
      try {
        log.debug("清理流媒體播放器例項...");
        if (artplayerInstance.value.streamPlayer.pause) {
          artplayerInstance.value.streamPlayer.pause();
        }
        if (artplayerInstance.value.streamPlayer.unload) {
          artplayerInstance.value.streamPlayer.unload();
        }
        if (artplayerInstance.value.streamPlayer.detachMediaElement) {
          artplayerInstance.value.streamPlayer.detachMediaElement();
        }
        if (artplayerInstance.value.streamPlayer.destroy) {
          artplayerInstance.value.streamPlayer.destroy();
        }
        log.debug("流媒體播放器清理完成");
      } catch (error) {
        log.warn("清理流媒體播放器時出錯:", error);
      }
    }

    // 清理Artplayer例項
    artplayerInstance.value.destroy();
    artplayerInstance.value = null;
  }
});
</script>

<style scoped>
.video-player-container {
  width: 100%;
  position: relative;
}

.artplayer-container {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 80vh;
  min-height: 200px;
}

/* 全屏模式：透過 prop 控制，移除寬高比和最大高度限制 */
.is-fullscreen .artplayer-container {
  aspect-ratio: unset;
  max-height: none;
  height: 100%;
}
</style>

<style>
/* 播放器自身全屏時的樣式 */
.artplayer-container:fullscreen,
.art-video-player:fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  border-radius: 0 !important;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .artplayer-container {
    min-height: 180px;
  }
}

/* 確保播放器在容器中正確顯示 */
.artplayer-container .art-video-player {
  border-radius: 8px;
  overflow: hidden;
}
</style>
