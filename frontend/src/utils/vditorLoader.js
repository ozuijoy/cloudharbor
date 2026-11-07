/**
 * Vditor 資源懶載入工具
 *
 * - 版本號常量：VDITOR_VERSION
 * - 資源基礎路徑：VDITOR_ASSETS_BASE
 *   - ${VDITOR_ASSETS_BASE}/dist/index.css
 *   - ${VDITOR_ASSETS_BASE}/dist/index.min.js
 *
 */

// Vditor 版本常量（與靜態資源版本對應，用於後續升級）
export const VDITOR_VERSION = "3.11.1";

// Vditor 靜態資源基礎路徑
// 目錄結構：public/assets/vditor/<版本>/dist/**
export const VDITOR_ASSETS_BASE = `/assets/vditor/${VDITOR_VERSION}`;

// 複用相同的 id，提前載入並對 mermaid.initialize 打“補丁”，用於規避 foreignObject 寬度出現極小負數導致的控制檯報錯。
const VDITOR_MERMAID_SCRIPT_ID = "vditorMermaidScript";
const VDITOR_MERMAID_VERSION = "11.6.0";
const VDITOR_MERMAID_SCRIPT_SRC = `${VDITOR_ASSETS_BASE}/dist/js/mermaid/mermaid.min.js?v=${VDITOR_MERMAID_VERSION}`;

let VditorClass = null;
let vditorCSSLoaded = false;
let vditorLoading = false;
let vditorLoadFailed = false;
let pendingResolvers = [];

const VDITOR_SCRIPT_SRC = `${VDITOR_ASSETS_BASE}/dist/index.min.js`;
const VDITOR_CSS_HREF = `${VDITOR_ASSETS_BASE}/dist/index.css`;

/**
 * 載入 Vditor CSS（冪等）
 */
export const loadVditorCSS = async () => {
  if (vditorCSSLoaded) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = VDITOR_CSS_HREF;
  document.head.appendChild(link);

  vditorCSSLoaded = true;
};

/**
 * 懶載入 Vditor JS 單例
 */
export const loadVditor = async () => {
  // 已有例項，直接返回
  if (VditorClass) {
    return VditorClass;
  }

  if (vditorLoading) {
    return new Promise((resolve, reject) => {
      pendingResolvers.push({ resolve, reject });
    });
  }

  if (vditorLoadFailed) {
    vditorLoadFailed = false;
  }

  vditorLoading = true;

  try {
    await loadVditorCSS();

    const script = document.createElement("script");
    script.src = VDITOR_SCRIPT_SRC;

    await new Promise((resolve, reject) => {
      script.onload = () => {
        // 重試機制：10次重試，每次100ms，總等待1秒
        const maxRetries = 10;
        const checkInterval = 100;
        let retryCount = 0;

        const checkReady = () => {
          if (window.Vditor) {
            VditorClass = window.Vditor;
            resolve(VditorClass);
            return;
          }

          retryCount += 1;
          if (retryCount >= maxRetries) {
            reject(new Error("Vditor API 不可用（超時）"));
            return;
          }

          setTimeout(checkReady, checkInterval);
        };

        checkReady();
      };

      script.onerror = () => {
        reject(new Error("Vditor 指令碼載入失敗"));
      };

      document.head.appendChild(script);
    });

    // 載入成功，通知呼叫者
    pendingResolvers.forEach(({ resolve }) => resolve(VditorClass));
    pendingResolvers = [];
  } catch (error) {
    vditorLoadFailed = true;
    pendingResolvers.forEach(({ reject }) => reject(error));
    pendingResolvers = [];
    throw error;
  } finally {
    vditorLoading = false;
  }

  return VditorClass;
};

/**
 * 判斷 Markdown 文字里是否“可能包含 Mermaid 圖”
 * - 只做快速判斷，避免每次 preview 都提前載入 mermaid 資源
 * @param {string} markdown
 * @returns {boolean}
 */
export const mightContainMermaid = (markdown) => {
  if (!markdown || typeof markdown !== "string") return false;
  // 支援 ```mermaid 和 ~~~mermaid
  return /(?:```|~~~)\s*mermaid\b/i.test(markdown);
};

/**
 * 確保 Mermaid 指令碼已載入（複用 Vditor 的 script id，避免重複插入）
 * @returns {Promise<any>} - window.mermaid
 */
export const ensureVditorMermaidLoaded = async () => {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (window.mermaid) return window.mermaid;

  const existing = document.getElementById(VDITOR_MERMAID_SCRIPT_ID);
  if (!existing) {
    const script = document.createElement("script");
    script.id = VDITOR_MERMAID_SCRIPT_ID;
    script.src = VDITOR_MERMAID_SCRIPT_SRC;
    document.head.appendChild(script);
  }

  // 簡單輪詢：最多等 1 秒（10 次 * 100ms），和 loadVditor 的邏輯保持一致
  const maxRetries = 10;
  const checkInterval = 100;
  let retryCount = 0;

  await new Promise((resolve, reject) => {
    const checkReady = () => {
      if (window.mermaid) {
        resolve();
        return;
      }
      retryCount += 1;
      if (retryCount >= maxRetries) {
        reject(new Error("Mermaid API 不可用（超時）"));
        return;
      }
      setTimeout(checkReady, checkInterval);
    };
    checkReady();
  });

  return window.mermaid;
};

/**
 * 給 Mermaid.initialize 打補丁：強制 flowchart.htmlLabels=false
 * 目的：避免 Mermaid 用 foreignObject 渲染邊標籤時出現極小負數 width，觸發瀏覽器控制檯報錯。
 *
 * 說明：Mermaid 官方配置裡 flowchart.htmlLabels 預設是 true。
 * 但在某些佈局/字型/縮放場景下，foreignObject 的 width 可能被算成 -2.7e-7 這類“接近 0 的負數”，瀏覽器會報錯。
 *
 * @returns {Promise<void>}
 */
export const ensureMermaidPatchedForVditor = async () => {
  const mermaid = await ensureVditorMermaidLoaded();
  if (!mermaid) return;
  if (mermaid.__cloudharborPatchedForVditor === true) return;
  if (typeof mermaid.initialize !== "function") return;

  const originalInitialize = mermaid.initialize.bind(mermaid);

  mermaid.initialize = (config) => {
    try {
      if (config && typeof config === "object") {
        const nextFlowchart = { ...(config.flowchart || {}) };
        // 關鍵點：只要有人想開啟 htmlLabels，就強制關掉（避免 foreignObject）
        if (nextFlowchart.htmlLabels === true) {
          nextFlowchart.htmlLabels = false;
        }
        config = { ...config, flowchart: nextFlowchart };
      }
    } catch {
      // 忽略：補丁失敗也不能影響正常渲染
    }
    return originalInitialize(config);
  };

  mermaid.__cloudharborPatchedForVditor = true;
};
