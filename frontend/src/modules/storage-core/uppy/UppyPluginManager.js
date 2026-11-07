/**
 * Uppy 外掛管理器
 * 負責管理所有媒體外掛的狀態、配置和生命週期
 */

import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("UppyPluginManager");

/**
 * 外掛管理器類
 */
export class UppyPluginManager {
  constructor(uppyInstance, locale = "zh-TW") {
    this.uppy = uppyInstance;
    this.locale = locale;

    // 外掛狀態
    this.pluginStates = this.loadPluginStates();

    // 外掛定義
    this.pluginDefinitions = this.createPluginDefinitions();

    // 外掛建構函式快取（避免重複動態載入）
    this._pluginCtorCache = new Map();
  }

  /**
   * 從localStorage載入外掛狀態
   */
  loadPluginStates() {
    const defaultState = {
      webcam: true,
      screen: false,
      audio: false,
      imageEditor: true,
      urlImport: true,
    };

    try {
      this._storedPluginStates = useLocalStorage("uppy-plugin-states", defaultState);
      const stored = this._storedPluginStates.value;
      if (stored && typeof stored === "object") {
        return { ...defaultState, ...stored };
      }
    } catch (e) {
      log.warn("Failed to load plugin states:", e);
    }
    // 預設狀態：攝像頭和URL匯入開啟，其他關閉
    return defaultState;
  }

  /**
   * 儲存外掛狀態到localStorage
   */
  savePluginStates() {
    try {
      if (this._storedPluginStates) this._storedPluginStates.value = { ...(this.pluginStates || {}) };
    } catch (e) {
      log.warn("Failed to save plugin states:", e);
    }
  }

  /**
   * 獲取外掛國際化文字
   */
  getPluginTexts() {
    // 只要是華語語系（zh-TW / zh-Hant / 其他 zh 開頭的語系）都使用中文外掛文案
    const isZh = String(this.locale || "").toLowerCase().startsWith("zh");
    return {
      webcam: {
        label: isZh ? "攝像頭" : "Webcam",
        description: isZh ? "拍照和錄製影片" : "Take photos and record videos",
        strings: {
          pluginNameCamera: isZh ? "攝像頭" : "Camera",
          smile: isZh ? "微笑！" : "Smile!",
          takePicture: isZh ? "拍照" : "Take a picture",
          startRecording: isZh ? "開始錄製" : "Begin recording",
          stopRecording: isZh ? "停止錄製" : "Stop recording",
          allowAccessTitle: isZh ? "請允許訪問您的攝像頭" : "Please allow access to your camera",
          allowAccessDescription: isZh
            ? "為了拍照或錄製影片，請允許此網站訪問攝像頭。"
            : "In order to take pictures or record video with your camera, please allow camera access for this site.",
        },
      },
      screen: {
        label: isZh ? "螢幕錄製" : "Screen Capture",
        description: isZh ? "錄製螢幕或應用視窗" : "Record screen or application window",
        strings: {
          startCapturing: isZh ? "開始螢幕錄製" : "Begin screen capture",
          stopCapturing: isZh ? "停止螢幕錄製" : "Stop screen capture",
          submitRecordedFile: isZh ? "提交錄製檔案" : "Submit recorded file",
          streamActive: isZh ? "錄製中" : "Recording active",
          streamPassive: isZh ? "錄製暫停" : "Recording stopped",
          micDisabled: isZh ? "麥克風被禁用" : "Microphone disabled",
          recording: isZh ? "錄製中" : "Recording",
        },
      },
      audio: {
        label: isZh ? "音訊錄製" : "Audio Recording",
        description: isZh ? "錄製音訊檔案" : "Record audio files",
        strings: {
          pluginNameAudio: isZh ? "音訊" : "Audio",
          startAudioRecording: isZh ? "開始錄音" : "Begin audio recording",
          stopAudioRecording: isZh ? "停止錄音" : "Stop audio recording",
          allowAudioAccessTitle: isZh ? "請允許訪問您的麥克風" : "Please allow access to your microphone",
          allowAudioAccessDescription: isZh
            ? "為了錄製音訊，請允許此網站訪問麥克風。"
            : "In order to record audio with your microphone, please allow microphone access for this site.",
          noAudioTitle: isZh ? "麥克風不可用" : "Microphone not available",
          noAudioDescription: isZh ? "為了錄製音訊，請連線麥克風或其他音訊輸入裝置" : "To record audio, please connect a microphone or other audio input device",
          recordingStoppedMaxSize: isZh ? "錄製已停止，因為檔案大小即將超出限制" : "Recording stopped because file size is about to exceed the limit",
          recordingLength: isZh ? "錄製時長 %{recording_length}" : "Recording length %{recording_length}",
          submitRecordedFile: isZh ? "提交錄製檔案" : "Submit recorded file",
          discardRecordedFile: isZh ? "丟棄錄製檔案" : "Discard recorded file",
        },
      },
      imageEditor: {
        label: isZh ? "圖片編輯" : "Image Editor",
        description: isZh ? "編輯和最佳化圖片" : "Edit and optimize images",
        strings: {
          edit: isZh ? "編輯" : "Edit",
          save: isZh ? "儲存" : "Save",
          cancel: isZh ? "取消" : "Cancel",
          revert: isZh ? "還原" : "Revert",
          crop: isZh ? "裁剪" : "Crop",
          rotate: isZh ? "旋轉" : "Rotate",
          flip: isZh ? "翻轉" : "Flip",
          brightness: isZh ? "亮度" : "Brightness",
          contrast: isZh ? "對比度" : "Contrast",
          saturation: isZh ? "飽和度" : "Saturation",
        },
      },
      urlImport: {
        label: isZh ? "URL匯入" : "URL Import",
        description: isZh ? "從連結匯入檔案" : "Import files from URL",
        strings: {
          pluginName: isZh ? "URL" : "URL",
          importFromUrl: isZh ? "從URL匯入" : "Import from URL",
          enterUrl: isZh ? "輸入檔案URL" : "Enter file URL",
          analyzing: isZh ? "分析中..." : "Analyzing...",
          downloading: isZh ? "下載中..." : "Downloading...",
          analyzeUrl: isZh ? "分析 URL" : "Analyze URL",
          download: isZh ? "下載" : "Download",
          fileInfoReady: isZh ? "檔案資訊已獲取" : "File info retrieved",
          unknownFile: isZh ? "未知檔案" : "Unknown file",
          reInput: isZh ? "重新輸入" : "Re-enter",
          cannotGetUrlInfo: isZh ? "無法獲取URL資訊" : "Cannot retrieve URL info",
          analysisFailed: isZh ? "URL分析失敗" : "URL analysis failed",
          missingFileInfo: isZh ? "缺少檔案資訊" : "Missing file info",
          downloadFailed: isZh ? "下載失敗" : "Download failed",
          downloadComplete: isZh ? "下載完成" : "Download complete",
          progressPercent: "%{progress}%",
          cancelDownload: isZh ? "取消下載" : "Cancel",
          downloadCancelled: isZh ? "下載已取消" : "Download cancelled",
        },
      },
    };
  }

  /**
   * 建立外掛定義
   */
  createPluginDefinitions() {
    const texts = this.getPluginTexts();

    return [
      {
        key: "imageEditor",
        label: texts.imageEditor.label,
        description: texts.imageEditor.description,
        enabled: this.pluginStates.imageEditor,
        cssLoader: () => import("@uppy/image-editor/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/image-editor");
          return mod?.default || mod;
        },
        config: {
          quality: 0.8,
          locale: {
            strings: texts.imageEditor.strings,
          },
        },
      },
      {
        key: "webcam",
        label: texts.webcam.label,
        description: texts.webcam.description,
        enabled: this.pluginStates.webcam,
        cssLoader: () => import("@uppy/webcam/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/webcam");
          return mod?.default || mod;
        },
        config: {
          modes: ["video-audio", "video-only", "picture"],
          mirror: true,
          showRecordingLength: true,
          locale: {
            strings: texts.webcam.strings,
          },
        },
      },
      {
        key: "screen",
        label: texts.screen.label,
        description: texts.screen.description,
        enabled: this.pluginStates.screen,
        cssLoader: () => import("@uppy/screen-capture/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/screen-capture");
          return mod?.default || mod;
        },
        config: {
          displayMediaConstraints: {
            video: {
              width: { min: 640, ideal: 1920, max: 1920 },
              height: { min: 480, ideal: 1080, max: 1080 },
            },
            audio: true,
          },
          locale: {
            strings: texts.screen.strings,
          },
        },
      },
      {
        key: "audio",
        label: texts.audio.label,
        description: texts.audio.description,
        enabled: this.pluginStates.audio,
        cssLoader: () => import("@uppy/audio/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/audio");
          return mod?.default || mod;
        },
        config: {
          showRecordingLength: true,
          locale: {
            strings: texts.audio.strings,
          },
        },
      },
      {
        key: "urlImport",
        label: texts.urlImport.label,
        description: texts.urlImport.description,
        enabled: this.pluginStates.urlImport,
        pluginLoader: async () => {
          const mod = await import("./plugins/UrlImportPlugin.js");
          return mod?.default || mod?.UrlImportPlugin || mod;
        },
        config: {
          // 傳入語言包配置（會與外掛的 defaultLocale 合併）
          locale: {
            strings: texts.urlImport.strings,
          },
          // API回撥函式（由外部設定）
          validateUrlInfo: null,
          fetchUrlContent: null,
        },
      },
    ];
  }

  /**
   * 獲取外掛列表（用於UI顯示）
   */
  getPluginList() {
    return this.pluginDefinitions.map((plugin) => ({
      key: plugin.key,
      label: plugin.label,
      description: plugin.description,
      enabled: plugin.enabled,
    }));
  }

  /**
   * 切換外掛狀態
   */
  togglePlugin(pluginKey) {
    const plugin = this.pluginDefinitions.find((p) => p.key === pluginKey);
    if (plugin) {
      plugin.enabled = !plugin.enabled;
      this.pluginStates[pluginKey] = plugin.enabled;
      this.savePluginStates();
      return plugin.enabled;
    }
    return false;
  }

  /**
   * 設定URL匯入外掛的回撥函式
   * @param {Object} callbacks - 回撥函式物件
   * @param {Function} callbacks.validateUrlInfo - URL驗證函式
   * @param {Function} callbacks.fetchUrlContent - URL下載函式
   * @param {Function} callbacks.onShowModal - 顯示模態框回撥
   * @param {Function} callbacks.onHideModal - 隱藏模態框回撥
   */
  setUrlImportCallbacks(callbacks = {}) {
    const urlPlugin = this.pluginDefinitions.find(p => p.key === 'urlImport');
    if (urlPlugin && urlPlugin.config) {
      Object.assign(urlPlugin.config, callbacks);
    }
  }

  /**
   * 新增所有啟用的外掛到Uppy例項
   */
  async addPluginsToUppy() {
    if (!this.uppy) return;

    // 新增使用者選擇的外掛
    for (const plugin of this.pluginDefinitions) {
      if (!plugin?.enabled) continue;

      try {
        if (typeof plugin.cssLoader === "function") {
          await plugin.cssLoader();
        }

        const PluginCtor = await this._loadPluginCtor(plugin);
        if (!PluginCtor) continue;
        this.uppy.use(PluginCtor, plugin.config || {});
      } catch (e) {
        log.warn("[UppyPluginManager] 外掛載入失敗:", plugin?.key, e);
      }
    }
  }

  /**
   * 動態載入外掛建構函式（帶快取）
   * @param {Object} pluginDef - 外掛定義
   * @returns {Promise<any>}
   */
  async _loadPluginCtor(pluginDef) {
    const key = pluginDef?.key;
    if (!key) return null;

    if (this._pluginCtorCache?.has(key)) {
      return this._pluginCtorCache.get(key);
    }

    if (typeof pluginDef.pluginLoader !== "function") {
      return null;
    }

    const ctor = await pluginDef.pluginLoader();
    this._pluginCtorCache.set(key, ctor);
    return ctor;
  }

  /**
   * 更新語言設定
   */
  updateLocale(newLocale) {
    this.locale = newLocale;
    this.pluginDefinitions = this.createPluginDefinitions();
  }

  /**
   * 獲取啟用的外掛數量
   */
  getEnabledPluginsCount() {
    return this.pluginDefinitions.filter((p) => p.enabled).length;
  }
}

/**
 * 建立外掛管理器例項
 */
export function createUppyPluginManager(uppyInstance, locale = "zh-TW") {
  return new UppyPluginManager(uppyInstance, locale);
}
