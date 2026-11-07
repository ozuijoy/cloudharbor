/**
 * 程式碼高亮 Composable
 * 基於 highlight.js 實現程式碼語法高亮
 */

import { ref, computed } from "vue";
import { VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { createLogger } from "@/utils/logger.js";

export function useCodeHighlight() {
  const log = createLogger("CodeHighlight");
  // 狀態
  const isHighlightLoaded = ref(false);
  const highlightInstance = ref(null);
  const loadingError = ref(null);

  // 支援的語言列表
  const supportedLanguages = ref([
    "javascript",
    "typescript",
    "python",
    "java",
    "cpp",
    "c",
    "csharp",
    "php",
    "ruby",
    "go",
    "rust",
    "swift",
    "kotlin",
    "scala",
    "dart",
    "r",
    "html",
    "css",
    "scss",
    "less",
    "sass",
    "xml",
    "json",
    "yaml",
    "toml",
    "sql",
    "bash",
    "shell",
    "powershell",
    "dockerfile",
    "nginx",
    "markdown",
    "latex",
    "makefile",
    "cmake",
    "gradle",
    "maven",
    "vue",
    "jsx",
    "tsx",
    "svelte",
    "angular",
    "react",
    "perl",
    "lua",
    "vim",
    "ini",
    "properties",
    "diff",
    "patch",
  ]);

  // 主題列表
  const availableThemes = ref([
    { value: "github", label: "GitHub", description: "經典GitHub風格" },
    { value: "vs2015", label: "VS2015", description: "Visual Studio 2015暗色主題" },
    { value: "atom-one-dark", label: "Atom One Dark", description: "Atom編輯器暗色主題" },
    { value: "atom-one-light", label: "Atom One Light", description: "Atom編輯器亮色主題" },
    { value: "monokai", label: "Monokai", description: "經典Monokai主題" },
    { value: "dracula", label: "Dracula", description: "Dracula暗色主題" },
    { value: "tomorrow", label: "Tomorrow", description: "Tomorrow亮色主題" },
    { value: "tomorrow-night", label: "Tomorrow Night", description: "Tomorrow暗色主題" },
    { value: "solarized-light", label: "Solarized Light", description: "Solarized亮色主題" },
    { value: "solarized-dark", label: "Solarized Dark", description: "Solarized暗色主題" },
  ]);

  // 計算屬性
  const isReady = computed(() => isHighlightLoaded.value && !loadingError.value);

  /**
   * 載入 highlight.js 庫（複用 Vditor 的 highlight.js）
   * @returns {Promise<Object>} highlight.js 例項
   */
  const loadHighlightJs = async () => {
    if (highlightInstance.value) {
      return highlightInstance.value;
    }

    try {
      loadingError.value = null;

      // 檢查是否已經載入了 highlight.js（透過 Vditor）
      if (window.hljs) {
        log.debug("使用已載入的 highlight.js 例項");
        highlightInstance.value = window.hljs;
        isHighlightLoaded.value = true;
        return highlightInstance.value;
      }

      // 如果沒有載入，則透過 Vditor 的方式載入
      log.debug("透過 Vditor 方式載入 highlight.js");

      // 載入 highlight.js 主檔案
      await loadScript(`${VDITOR_ASSETS_BASE}/dist/js/highlight.js/highlight.min.js`);

      // 載入第三方語言包
      await loadScript(`${VDITOR_ASSETS_BASE}/dist/js/highlight.js/third-languages.js`);

      // 等待 hljs 全域性變數可用
      await waitForGlobal("hljs", 5000);

      highlightInstance.value = window.hljs;
      isHighlightLoaded.value = true;

      log.debug("highlight.js 載入成功，支援語言:", window.hljs.listLanguages());

      return highlightInstance.value;
    } catch (error) {
      log.error("載入 highlight.js 失敗:", error);
      loadingError.value = error.message;
      throw error;
    }
  };

  /**
   * 動態載入指令碼
   * @param {string} src - 指令碼路徑
   * @returns {Promise<void>}
   */
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      // 檢查是否已經載入
      const existingScript = document.querySelector(`script[src="${src}"]`);
      if (existingScript) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`無法載入指令碼: ${src}`));
      document.head.appendChild(script);
    });
  };

  /**
   * 等待全域性變數可用
   * @param {string} globalName - 全域性變數名
   * @param {number} timeout - 超時時間（毫秒）
   * @returns {Promise<void>}
   */
  const waitForGlobal = (globalName, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        if (window[globalName]) {
          resolve();
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`等待全域性變數 ${globalName} 超時`));
        } else {
          setTimeout(check, 100);
        }
      };

      check();
    });
  };

  /**
   * 高亮程式碼
   * @param {string} code - 程式碼內容
   * @param {string} language - 語言型別
   * @param {Object} options - 高亮選項
   * @returns {Promise<Object>} 高亮結果
   */
  const highlightCode = async (code, language = "", options = {}) => {
    if (!code || typeof code !== "string") {
      return {
        success: false,
        html: "",
        language: "",
        error: "程式碼內容為空或無效",
      };
    }

    try {
      const hljs = await loadHighlightJs();

      let result;

      if (language && supportedLanguages.value.includes(language.toLowerCase())) {
        // 指定語言高亮
        try {
          result = hljs.highlight(code, { language: language.toLowerCase() });
        } catch (err) {
          log.warn(`指定語言 ${language} 高亮失敗，嘗試自動檢測:`, err);
          result = hljs.highlightAuto(code);
        }
      } else {
        // 自動檢測語言
        result = hljs.highlightAuto(code);
      }

      return {
        success: true,
        html: result.value,
        language: result.language || "plaintext",
        relevance: result.relevance || 0,
        error: null,
      };
    } catch (error) {
      log.error("程式碼高亮失敗:", error);

      return {
        success: false,
        html: escapeHtml(code), // 返回轉義的原始程式碼
        language: language || "plaintext",
        relevance: 0,
        error: error.message,
      };
    }
  };

  /**
   * 根據副檔名推測語言
   * @param {string} filename - 檔名
   * @returns {string} 語言型別
   */
  const detectLanguageFromFilename = (filename) => {
    if (!filename) return "";

    const ext = filename.split(".").pop()?.toLowerCase();

    const extensionMap = {
      // JavaScript 系列
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      vue: "vue",
      mjs: "javascript",
      cjs: "javascript",

      // Python
      py: "python",
      pyw: "python",
      pyi: "python",

      // Java 系列
      java: "java",
      kt: "kotlin",
      kts: "kotlin",
      scala: "scala",

      // C 系列
      c: "c",
      h: "c",
      cpp: "cpp",
      cxx: "cpp",
      cc: "cpp",
      hpp: "cpp",
      hxx: "cpp",
      cs: "csharp",

      // Web 技術
      html: "html",
      htm: "html",
      xhtml: "html",
      css: "css",
      scss: "scss",
      sass: "sass",
      less: "less",

      // 資料格式
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      ini: "ini",
      cfg: "ini",
      conf: "ini",

      // 指令碼語言
      php: "php",
      rb: "ruby",
      go: "go",
      rs: "rust",
      swift: "swift",
      dart: "dart",
      r: "r",
      R: "r",
      perl: "perl",
      pl: "perl",
      lua: "lua",

      // Shell 指令碼
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      fish: "bash",
      ps1: "powershell",
      psm1: "powershell",

      // 資料庫
      sql: "sql",

      // 配置檔案
      dockerfile: "dockerfile",
      makefile: "makefile",
      cmake: "cmake",
      gradle: "gradle",
      maven: "xml",

      // 文件
      md: "markdown",
      markdown: "markdown",
      tex: "latex",
      latex: "latex",

      // 其他
      vim: "vim",
      diff: "diff",
      patch: "diff",
    };

    return extensionMap[ext] || "";
  };

  /**
   * 載入主題樣式
   * @param {string} theme - 主題名稱
   * @param {boolean} darkMode - 是否暗色模式
   * @returns {Promise<void>}
   */
  const loadTheme = async (theme, darkMode = false) => {
    // 根據暗色模式自動選擇主題
    if (!theme) {
      theme = darkMode ? "vs2015" : "github";
    }

    try {
      // 移除舊的主題樣式
      const oldStyle = document.getElementById("hljs-theme");
      if (oldStyle) {
        oldStyle.remove();
      }

      // 檢查主題檔案是否存在的路徑列表
      const possiblePaths = [
        `${VDITOR_ASSETS_BASE}/dist/js/highlight.js/styles/${theme}.min.css`,
        `${VDITOR_ASSETS_BASE}/dist/js/highlight.js/styles/${theme}.css`,
      ];

      // 嘗試載入主題
      let loaded = false;
      for (const path of possiblePaths) {
        try {
          await loadStylesheet(path, "hljs-theme");
          log.debug(`成功載入主題: ${theme} from ${path}`);
          loaded = true;
          break;
        } catch (err) {
          log.warn(`無法從 ${path} 載入主題 ${theme}:`, err.message);
        }
      }

      if (!loaded) {
        log.warn(`所有路徑都無法載入主題 ${theme}，使用預設樣式`);
        // 不丟擲錯誤，允許使用預設樣式
      }
    } catch (error) {
      log.error("載入主題失敗:", error);
      // 不丟擲錯誤，允許使用預設樣式
    }
  };

  /**
   * 動態載入樣式表
   * @param {string} href - 樣式表路徑
   * @param {string} id - 樣式表ID
   * @returns {Promise<void>}
   */
  const loadStylesheet = (href, id) => {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;

      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`無法載入樣式表: ${href}`));

      document.head.appendChild(link);
    });
  };

  /**
   * 轉義 HTML 字元
   * @param {string} text - 原始文字
   * @returns {string} 轉義後的文字
   */
  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * 獲取推薦主題
   * @param {boolean} darkMode - 是否暗色模式
   * @returns {string} 主題名稱
   */
  const getRecommendedTheme = (darkMode) => {
    return darkMode ? "vs2015" : "github";
  };

  return {
    // 狀態
    isHighlightLoaded,
    loadingError,
    supportedLanguages,
    availableThemes,

    // 計算屬性
    isReady,

    // 方法
    loadHighlightJs,
    highlightCode,
    detectLanguageFromFilename,
    loadTheme,
    getRecommendedTheme,
  };
}
