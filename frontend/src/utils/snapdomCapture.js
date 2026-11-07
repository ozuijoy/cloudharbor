/**
 * SnapDOM 截圖封裝
 *
 */

import { saveAs } from "file-saver";
import { createLogger } from "@/utils/logger.js";

const TEMP_EXPORT_STYLE_ID = "temp-export-style";
const DEFAULT_PASTE_URL_PROXY_PREFIX = "/api/paste/url/proxy";
const log = createLogger("SnapdomCapture");

let cachedPasteUrlProxyTicket = "";
let cachedPasteUrlProxyTicketExpiresAtMs = 0;

const VDITOR_EXPORT_CSS = `
  .vditor-reset {
    padding: 20px !important;
    box-sizing: border-box !important;
  }
  .vditor-reset pre {
    white-space: pre-wrap !important;
    word-break: break-all !important;
    overflow: visible !important;
    background-color: #f6f8fa !important;
    border-radius: 4px !important;
    padding: 12px 16px !important;
    margin: 1em 0 !important;
  }
  .vditor-reset pre code {
    font-family: monospace, Consolas, "Courier New", monospace !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    white-space: pre-wrap !important;
    tab-size: 4 !important;
    word-break: keep-all !important;
  }
  .vditor-reset img {
    max-width: 100% !important;
    image-rendering: auto !important;
  }
  .vditor-reset table {
    display: table !important;
    width: auto !important;
    max-width: 100% !important;
    overflow: visible !important;
    border-collapse: collapse !important;
    margin: 1em 0 !important;
  }
  .vditor-reset table th,
  .vditor-reset table td {
    border: 1px solid #ddd !important;
    padding: 8px 12px !important;
  }
`;

function isDarkBackground(backgroundColor) {
  if (!backgroundColor) return false;
  const color = String(backgroundColor).toLowerCase();
  return color.includes("#1") || color.includes("#2") || color.includes("#3") || color.includes("dark") || color.includes("black");
}

function ensureTempExportStyle() {
  const existing = document.getElementById(TEMP_EXPORT_STYLE_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const style = document.createElement("style");
  style.id = TEMP_EXPORT_STYLE_ID;
  style.textContent = VDITOR_EXPORT_CSS;
  document.head.appendChild(style);
}

function cleanupTempExportStyle() {
  const style = document.getElementById(TEMP_EXPORT_STYLE_ID);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
  }
}

function markImagesCrossOrigin(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const images = root.querySelectorAll("img");
  images.forEach((img) => {
    if (!img.hasAttribute("crossorigin")) {
      img.setAttribute("crossorigin", "anonymous");
    }
  });
}

function hasCrossOriginImages(root) {
  if (!root || typeof root.querySelectorAll !== "function") return false;

  const images = Array.from(root.querySelectorAll("img")).filter((img) => img instanceof HTMLImageElement);
  if (images.length === 0) return false;

  for (const img of images) {
    const rawSrc = img.getAttribute("src") || img.src || "";
    if (!rawSrc) continue;
    if (rawSrc.startsWith("data:") || rawSrc.startsWith("blob:")) continue;

    try {
      const resolved = new URL(rawSrc, window.location.href);
      if (resolved.origin !== window.location.origin) {
        return true;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return false;
}

async function resolveShareUrlProxyPrefixIfAllowed() {
  try {
    const { useAuthStore } = await import("@/stores/authStore.js");
    const authStore = useAuthStore();
    if (typeof authStore.initialize === "function") {
      await authStore.initialize();
    }
    if (!authStore.isAuthenticated) return "";
    if (!authStore.hasTextSharePermission) return "";

    // SnapDOM useProxy 的資源請求無法攜帶 Authorization Header：
    // - 先用“正常 API 請求”（可帶 Authorization）換取短期 ticket
    // - 再把 ticket 填到 useProxy 字首裡，供瀏覽器後續 <img src> 請求攜帶 query 完成校驗
    const now = Date.now();
    if (cachedPasteUrlProxyTicket && now < cachedPasteUrlProxyTicketExpiresAtMs - 10_000) {
      return `${DEFAULT_PASTE_URL_PROXY_PREFIX}?ticket=${encodeURIComponent(cachedPasteUrlProxyTicket)}&url=`;
    }

    const { post } = await import("@/api/client.js");
    const ticketResponse = await post("paste/url/proxy-ticket", {});
    const ticket = ticketResponse?.data?.ticket ? String(ticketResponse.data.ticket) : "";
    if (!ticket) return "";

    cachedPasteUrlProxyTicket = ticket;
    const expiresAtSeconds = ticketResponse?.data?.expiresAt ? Number(ticketResponse.data.expiresAt) : 0;
    cachedPasteUrlProxyTicketExpiresAtMs = expiresAtSeconds > 0 ? expiresAtSeconds * 1000 : now + 5 * 60 * 1000;

    return `${DEFAULT_PASTE_URL_PROXY_PREFIX}?ticket=${encodeURIComponent(ticket)}&url=`;
  } catch {
    return "";
  }
}

function waitTimeout(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function waitForDocumentFonts(timeoutMs) {
  try {
    if (!document?.fonts?.ready) return;
    await Promise.race([document.fonts.ready, waitTimeout(timeoutMs)]);
  } catch {
    // 忽略字型等待異常，匯出流程繼續
  }
}

async function waitForImages(root, timeoutMs) {
  if (!root || typeof root.querySelectorAll !== "function") return;

  const images = Array.from(root.querySelectorAll("img")).filter((img) => img instanceof HTMLImageElement);
  if (images.length === 0) return;

  const decodeOrLoad = (img) => new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }

    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      resolve();
    };

    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });

    if (typeof img.decode === "function") {
      img.decode().then(() => {
        cleanup();
        resolve();
      }).catch(() => {
        // decode 失敗仍然嘗試等待 load/error
      });
    }
  });

  await Promise.race([
    Promise.all(images.map(decodeOrLoad)),
    waitTimeout(timeoutMs),
  ]);
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("讀取 Blob 失敗"));
    reader.readAsDataURL(blob);
  });
}

function buildSnapdomPngOptions(imageOptions = {}, snapdomOptions = {}) {
  const pixelRatio = typeof imageOptions.pixelRatio === "number" ? imageOptions.pixelRatio : undefined;
  const canvasWidth = typeof imageOptions.canvasWidth === "number" ? imageOptions.canvasWidth : undefined;
  const canvasHeight = typeof imageOptions.canvasHeight === "number" ? imageOptions.canvasHeight : undefined;

  const base = {
    fast: true,
    cache: "soft",
    embedFonts: true,
    placeholders: true,
    outerTransforms: true,
  };

  const options = {
    ...base,
    ...snapdomOptions,
    type: "png",
    // 匯出長圖時，瀏覽器 canvas 尺寸上限是最常見失敗原因（canvas.toBlob 返回 null）
    // 這裡預設把 dpr 固定為 1，保證“儘可能能匯出”；清晰度交給 scale 並在內部做安全降級。
    dpr: snapdomOptions.dpr ?? 1,
    scale: snapdomOptions.scale ?? (typeof pixelRatio === "number" ? Math.min(pixelRatio, 2) : 2),
    width: snapdomOptions.width ?? canvasWidth,
    height: snapdomOptions.height ?? canvasHeight,
    backgroundColor: snapdomOptions.backgroundColor ?? imageOptions.backgroundColor ?? "#ffffff",
  };

  if (typeof imageOptions.filter === "function") {
    options.filter = imageOptions.filter;
  }

  if (typeof snapdomOptions.fallbackURL !== "undefined") {
    options.fallbackURL = snapdomOptions.fallbackURL;
  } else if (typeof imageOptions.imagePlaceholder !== "undefined") {
    options.fallbackURL = imageOptions.imagePlaceholder;
  }

  // 跨域資源兜底：僅在資源被 CORS 阻斷時才會走 proxy 字首（同源或允許 CORS 的資源會跳過）
  // 接入後端代理，可傳入：snapdomOptions.useProxy = "/api/paste/url/proxy?ticket=<ticket>&url="
  if (typeof snapdomOptions.useProxy !== "undefined") {
    options.useProxy = snapdomOptions.useProxy;
  } else if (typeof imageOptions.useProxy !== "undefined") {
    options.useProxy = imageOptions.useProxy;
  }

  return options;
}

async function elementToPng(element, options = {}) {
  const defaultOptions = {
    filename: "download.png",
    imageOptions: {},
    snapdomOptions: {},
    autoSave: true,
    // 當未顯式傳 useProxy 時：如果當前為登入態且具備 TEXT_SHARE（文字建立許可權），則自動啟用 /api/paste/url/proxy（Query Ticket）作為 CORS fallback
    autoUseProxy: false,
    // 可選：嚴格模式下預熱資源，降低“圖片/字型沒來得及載入導致空白”的機率（會增加匯出耗時）
    preCache: false,
    // 可選：等待 document.fonts 收斂（預設開啟；超時後繼續匯出）
    waitForFonts: true,
    // 可選：等待圖片 decode/load（預設關閉；超時後繼續匯出）
    waitForImages: false,
    // waitForFonts/waitForImages/preCache 的最長等待時間
    waitTimeoutMs: 1500,
    beforeCapture: null,
    afterCapture: null,
    onSuccess: null,
    onError: null,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  const {
    filename,
    imageOptions,
    snapdomOptions,
    autoSave,
    autoUseProxy,
    preCache: preCacheEnabled,
    waitForFonts: waitForFontsEnabled,
    waitForImages: waitForImagesEnabled,
    waitTimeoutMs,
    beforeCapture,
    afterCapture,
    onSuccess,
    onError,
  } = mergedOptions;

  let targetElement = null;
  const warnings = [];

  try {
    targetElement = typeof element === "string" ? document.querySelector(element) : element;
    if (!targetElement) {
      throw new Error("目標元素不存在");
    }

    if (typeof beforeCapture === "function") {
      await beforeCapture(targetElement);
    }

    const snapdomModule = await import("@zumer/snapdom");
    const { snapdom, preCache } = snapdomModule;
    const basePngOptions = buildSnapdomPngOptions(imageOptions, snapdomOptions);

    // useProxy 僅在 CORS 阻斷時作為 fallback 使用，但你的後端介面有許可權校驗；
    // 因此：僅在“已登入且有 TEXT_SHARE 許可權”時自動開啟，匿名/無許可權保持關閉，並給出提示。
    const hasExplicitUseProxy = typeof snapdomOptions.useProxy !== "undefined" || typeof imageOptions.useProxy !== "undefined";
    if (!hasExplicitUseProxy && autoUseProxy === true) {
      const prefix = await resolveShareUrlProxyPrefixIfAllowed();
      if (prefix) {
        basePngOptions.useProxy = prefix;
      } else if (hasCrossOriginImages(targetElement)) {
        warnings.push({
          code: "proxy_unavailable",
          message:
            "檢測到跨域圖片資源，但當前未登入或缺少 TEXT_SHARE 許可權，或無法獲取 proxy ticket，無法使用 /api/paste/url/proxy；匯出將使用佔位符或跳過跨域資源。",
        });
      }
    }

    const resolvedWaitTimeoutMs = typeof waitTimeoutMs === "number" && waitTimeoutMs > 0 ? waitTimeoutMs : 1500;
    if (preCacheEnabled && typeof preCache === "function") {
      try {
        await preCache(targetElement, {
          embedFonts: basePngOptions.embedFonts,
          localFonts: basePngOptions.localFonts,
          iconFonts: basePngOptions.iconFonts,
          useProxy: basePngOptions.useProxy,
          cache: basePngOptions.cache,
        });
      } catch (e) {
        // 預熱失敗不應阻塞匯出，直接繼續
        log.warn("snapdom preCache 預熱失敗，將繼續匯出:", e?.message || e);
      }
    }
    if (waitForFontsEnabled !== false) {
      await waitForDocumentFonts(resolvedWaitTimeoutMs);
    }
    if (waitForImagesEnabled === true) {
      await waitForImages(targetElement, resolvedWaitTimeoutMs);
    }

    // 基於內容尺寸估算可行 scale，避免超長內容觸發瀏覽器 canvas 尺寸上限導致 toBlob 返回 null。
    // 多數瀏覽器 canvas 單邊上限在 16k~32k，這裡按 16384 做保守處理。
    const MAX_CANVAS_DIMENSION = 16384;
    const rect = targetElement.getBoundingClientRect();
    const measuredWidth = Math.max(Number(rect.width) || 0, Number(targetElement.scrollWidth) || 0, Number(targetElement.offsetWidth) || 0);
    const measuredHeight = Math.max(Number(rect.height) || 0, Number(targetElement.scrollHeight) || 0, Number(targetElement.offsetHeight) || 0);
    const dpr = typeof basePngOptions.dpr === "number" && basePngOptions.dpr > 0 ? basePngOptions.dpr : 1;
    const maxScaleFromWidth = measuredWidth > 0 ? MAX_CANVAS_DIMENSION / (measuredWidth * dpr) : 1;
    const maxScaleFromHeight = measuredHeight > 0 ? MAX_CANVAS_DIMENSION / (measuredHeight * dpr) : 1;
    const HARD_MAX_SCALE = 4;
    const maxSafeScale = Math.max(0.1, Math.min(maxScaleFromWidth, maxScaleFromHeight, HARD_MAX_SCALE));
    const scaleCandidates = [];
    if (typeof basePngOptions.scale === "number") {
      scaleCandidates.push(basePngOptions.scale);
    }
    // 兜底：如果 canvas 太大導致 toBlob 返回 null，逐級降低 scale 重試
    scaleCandidates.push(2, 1, 0.75, 0.5);
    const uniqueScaleCandidates = Array.from(new Set(scaleCandidates))
      .filter((v) => typeof v === "number" && v > 0)
      .map((v) => Math.min(v, maxSafeScale));

    let blob = null;
    for (const scale of uniqueScaleCandidates) {
      const pngOptions = { ...basePngOptions, scale };
      const candidate = await (typeof snapdom.toBlob === "function"
        ? snapdom.toBlob(targetElement, pngOptions)
        : (async () => {
            const result = await snapdom(targetElement, pngOptions);
            return await result.toBlob();
          })());

      if (candidate instanceof Blob) {
        blob = candidate;
        break;
      }
    }

    if (!(blob instanceof Blob)) {
      throw new TypeError(
        "snapdom.toBlob 未返回 Blob（可能是內容過長導致 Canvas 超出瀏覽器限制，canvas.toBlob 返回 null）；建議降低清晰度(scale/pixelRatio)或改用分段匯出。",
      );
    }

    const dataUrl = await blobToDataUrl(blob);

    if (typeof afterCapture === "function") {
      await afterCapture(targetElement);
    }

    if (autoSave) {
      saveAs(blob, filename);
    }

    if (typeof onSuccess === "function") {
      onSuccess(dataUrl, blob);
    }

    return { success: true, dataUrl, blob, warnings };
  } catch (error) {
    log.error("使用 snapdom 轉換HTML為PNG時出錯:", error);

    if (typeof onError === "function") {
      onError(error);
    }

    try {
      if (targetElement && typeof options.afterCapture === "function") {
        await options.afterCapture(targetElement);
      }
    } catch (cleanupError) {
      log.warn("snapdom 截圖失敗後的清理(afterCapture)執行異常:", cleanupError?.message || cleanupError);
    }

    return { success: false, error, warnings };
  }
}

/**
 * 從 Vditor 編輯器獲取內容並使用 snapdom 匯出 PNG
 * - 優先捕獲“已渲染後的預覽 DOM”
 */
export async function editorContentToPng(editor, options = {}) {
  if (!editor) {
    return { success: false, error: new Error("編輯器例項不存在") };
  }

  const currentMode = editor.vditor?.currentMode;

  let targetElement = null;
  let tempContainer = null;
  let hiddenParentContainer = null;
  let previewScrollContainer = null;
  let previewScrollContainerStyleBackup = null;

  const originalBeforeCapture = options.beforeCapture;
  const originalAfterCapture = options.afterCapture;
  const imageOptions = options.imageOptions || {};
  const snapdomOptions = options.snapdomOptions || {};
  const backgroundColor = snapdomOptions.backgroundColor ?? imageOptions.backgroundColor;
  const darkModeDetected = isDarkBackground(backgroundColor);

  try {
    const editorContainer = document.getElementById("vditor");

    const canUseDetachedHtml = Boolean(editorContainer && typeof editor.getHTML === "function");
    const preferDetached = options.preferDetached !== false;
    const preferRenderedPreview = options.preferRenderedPreview !== false;

    const livePreviewScrollContainer = editorContainer?.querySelector?.(".vditor-preview") || null;
    const livePreviewRoot = livePreviewScrollContainer?.querySelector?.(".vditor-reset") || null;

    // 優先使用“已渲染的預覽 DOM”，圖表/腦圖等往往依賴執行時渲染
    if (preferRenderedPreview && livePreviewRoot) {
      previewScrollContainer = livePreviewScrollContainer;
      targetElement = livePreviewRoot;
    } else if (preferDetached && canUseDetachedHtml) {
      hiddenParentContainer = document.createElement("div");
      hiddenParentContainer.style.height = "0";
      hiddenParentContainer.style.overflow = "hidden";
      hiddenParentContainer.style.position = "absolute";
      hiddenParentContainer.style.left = "-9999px";
      hiddenParentContainer.style.top = "0";
      hiddenParentContainer.id = "vditor-snapdom-hidden-container";

      tempContainer = document.createElement("div");
      tempContainer.style.maxWidth = "100%";
      tempContainer.style.width = `${editorContainer?.offsetWidth || imageOptions.canvasWidth || 0}px`;
      tempContainer.style.backgroundColor = darkModeDetected ? "#1e1e1e" : "#ffffff";
      tempContainer.style.color = darkModeDetected ? "#d4d4d4" : "#24292e";

      const htmlContainer = document.createElement("div");
      htmlContainer.innerHTML = editor.getHTML();
      htmlContainer.className = "vditor-reset";
      htmlContainer.style.padding = "20px";
      htmlContainer.style.maxWidth = "100%";
      htmlContainer.style.overflow = "visible";
      htmlContainer.style.width = "100%";

      tempContainer.appendChild(htmlContainer);
      hiddenParentContainer.appendChild(tempContainer);
      document.body.appendChild(hiddenParentContainer);

      targetElement = htmlContainer;
    } else {
      if (editorContainer && (currentMode === "preview" || currentMode === "both")) {
        previewScrollContainer = editorContainer.querySelector(".vditor-preview");
        targetElement = previewScrollContainer?.querySelector(".vditor-reset") || previewScrollContainer;
      }

      if (!targetElement) {
        targetElement =
          document.querySelector(".vditor-preview .vditor-reset") ||
          document.querySelector(".vditor-preview") ||
          document.querySelector(".vditor-wysiwyg") ||
          document.querySelector(".vditor-ir") ||
          document.querySelector(".vditor-sv");
      }
    }

    if (!previewScrollContainer) {
      previewScrollContainer = targetElement?.closest?.(".vditor-preview") || null;
    }

    if (!targetElement) {
      throw new Error("無法找到編輯器內容元素");
    }

    const enhancedOptions = {
      ...options,
      beforeCapture: async (el) => {
        ensureTempExportStyle();
        markImagesCrossOrigin(el);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const expandScrollContainer = options.expandScrollContainer === true;
        if (expandScrollContainer && previewScrollContainer && !previewScrollContainerStyleBackup) {
          previewScrollContainerStyleBackup = {
            overflow: previewScrollContainer.style.overflow,
            height: previewScrollContainer.style.height,
            maxHeight: previewScrollContainer.style.maxHeight,
          };
          previewScrollContainer.style.overflow = "visible";
          previewScrollContainer.style.height = "auto";
          previewScrollContainer.style.maxHeight = "none";
        }

        if (typeof originalBeforeCapture === "function") {
          await originalBeforeCapture(el);
        }
      },
      afterCapture: async (el) => {
        if (typeof originalAfterCapture === "function") {
          await originalAfterCapture(el);
        }
        cleanupTempExportStyle();
        if (previewScrollContainer && previewScrollContainerStyleBackup) {
          previewScrollContainer.style.overflow = previewScrollContainerStyleBackup.overflow;
          previewScrollContainer.style.height = previewScrollContainerStyleBackup.height;
          previewScrollContainer.style.maxHeight = previewScrollContainerStyleBackup.maxHeight;
          previewScrollContainerStyleBackup = null;
        }
        if (hiddenParentContainer && document.body.contains(hiddenParentContainer)) {
          document.body.removeChild(hiddenParentContainer);
        } else if (tempContainer && document.body.contains(tempContainer)) {
          document.body.removeChild(tempContainer);
        }
      },
    };

    return await elementToPng(targetElement, enhancedOptions);
  } catch (error) {
    log.error("snapdom 匯出PNG過程中發生錯誤:", error);

    if (hiddenParentContainer && document.body.contains(hiddenParentContainer)) {
      document.body.removeChild(hiddenParentContainer);
    } else if (tempContainer && document.body.contains(tempContainer)) {
      document.body.removeChild(tempContainer);
    }
    cleanupTempExportStyle();

    return { success: false, error };
  }
}
