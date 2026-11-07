/**
 * 圖片預覽解碼工具（前端）
 *
 */

import { getExtension } from "@/utils/fileTypes.js";

/** @type {Promise<any>|null} */
let libheifModulePromise = null;

async function loadLibheif() {
  if (!libheifModulePromise) {
    libheifModulePromise = import("libheif-js/wasm-bundle");
  }
  const mod = await libheifModulePromise;
  return mod?.default ?? mod;
}

const createAbortError = () => {
  // DOMException 在部分環境可能不可用
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
  }
};

const createSemaphore = (max) => {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  const acquire = () => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve)).then(() => {
      active += 1;
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  };

  const run = async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return { run };
};

// HEIC/HEIF 解碼：
// - 解碼在 Worker 內執行，主執行緒不會被阻塞
// 預設值取 2
const HEIF_DECODE_WORKER_POOL_SIZE = 2;
const heifDecodeSemaphore = createSemaphore(HEIF_DECODE_WORKER_POOL_SIZE);

/** @type {Worker[]|null} */
let heifDecodeWorkers = null;
/** @type {Array<Map<string, { resolve: Function, reject: Function }>>} */
let heifWorkerPendingByIndex = [];
/** @type {Map<string, number>} */
const heifWorkerIndexById = new Map();
let heifWorkerRoundRobin = 0;

const createHeifWorker = (index) => {
  const worker = new Worker(new URL("../workers/heifDecodeWorker.js", import.meta.url), { type: "module" });

  worker.addEventListener("message", (event) => {
    const data = event?.data || {};
    const { id, ok } = data;
    if (!id) return;
    const pendingMap = heifWorkerPendingByIndex[index];
    const pending = pendingMap?.get(id);
    if (!pending) return;
    pendingMap.delete(id);
    heifWorkerIndexById.delete(id);
    if (ok) {
      pending.resolve(data);
    } else {
      const err = new Error(data?.error?.message || "HEIF Worker 解碼失敗");
      err.name = data?.error?.name || "Error";
      err.code = data?.error?.code;
      pending.reject(err);
    }
  });

  worker.addEventListener("error", (e) => {
    // 單 worker 崩潰：拒絕當前 worker 下全部 pending，並允許後續重建
    const pendingMap = heifWorkerPendingByIndex[index];
    if (pendingMap) {
      pendingMap.forEach(({ reject }, id) => {
        heifWorkerIndexById.delete(id);
        reject(e);
      });
      pendingMap.clear();
    }
    try {
      worker.terminate();
    } catch {
      // ignore
    }
    if (heifDecodeWorkers) {
      heifDecodeWorkers[index] = null;
    }
  });

  return worker;
};

const getHeifDecodeWorkers = () => {
  if (typeof Worker === "undefined") return null;
  if (heifDecodeWorkers && heifDecodeWorkers.length === HEIF_DECODE_WORKER_POOL_SIZE) return heifDecodeWorkers;

  heifDecodeWorkers = new Array(HEIF_DECODE_WORKER_POOL_SIZE);
  heifWorkerPendingByIndex = new Array(HEIF_DECODE_WORKER_POOL_SIZE).fill(null).map(() => new Map());

  for (let i = 0; i < HEIF_DECODE_WORKER_POOL_SIZE; i += 1) {
    heifDecodeWorkers[i] = createHeifWorker(i);
  }

  return heifDecodeWorkers;
};

const pickHeifWorkerIndex = () => {
  const index = heifWorkerRoundRobin % HEIF_DECODE_WORKER_POOL_SIZE;
  heifWorkerRoundRobin += 1;
  return index;
};

const decodeHeifToObjectUrlViaWorker = async ({ url, signal, outputType, quality } = {}) => {
  const workers = getHeifDecodeWorkers();
  if (!workers) {
    const err = new Error("Worker 不可用");
    err.code = "WORKER_UNAVAILABLE";
    throw err;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const index = pickHeifWorkerIndex();
  const worker = workers[index] || (workers[index] = createHeifWorker(index));

  const abortHandler = () => {
    try {
      worker.postMessage({ type: "abort", id });
    } catch {
      // ignore
    }
    const pendingMap = heifWorkerPendingByIndex[index];
    const pending = pendingMap?.get(id);
    if (!pending) return;
    pendingMap.delete(id);
    heifWorkerIndexById.delete(id);
    pending.reject(createAbortError());
  };

  if (signal?.aborted) {
    throw createAbortError();
  }

  return new Promise((resolve, reject) => {
    heifWorkerIndexById.set(id, index);
    heifWorkerPendingByIndex[index].set(id, { resolve, reject });
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    try {
      worker.postMessage({ type: "decode", id, url, outputType, quality });
    } catch (e) {
      heifWorkerIndexById.delete(id);
      heifWorkerPendingByIndex[index].delete(id);
      reject(e);
    }
  }).finally(() => {
    if (signal) {
      try {
        signal.removeEventListener("abort", abortHandler);
      } catch {
        // ignore
      }
    }
  });
};

/**
 * 判斷是否為 HEIC/HEIF 圖片
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function isHeifImage({ filename = "", mimetype = "" } = {}) {
  const ext = getExtension(filename);
  if (ext === "heic" || ext === "heif") return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("heic")) return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("heif")) return true;
  return false;
}

/**
 * 判斷是否為 AVIF 圖片
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function isAvifImage({ filename = "", mimetype = "" } = {}) {
  const ext = getExtension(filename);
  if (ext === "avif") return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("avif")) return true;
  return false;
}

/**
 * 是否應該嘗試做“圖片預覽解碼”
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function shouldAttemptDecodeImagePreview({ filename = "", mimetype = "" } = {}) {
  // 僅對 HEIC/HEIF 做前端 wasm 解碼：
  return isHeifImage({ filename, mimetype });
}

/**
 * @typedef {Object} DecodedPreview
 * @property {string} objectUrl
 * @property {number} width
 * @property {number} height
 */

/**
 * 將 HEIC/HEIF/AVIF 的預覽 URL 解碼為圖片 objectURL
 *
 * @param {{ url: string; filename?: string; mimetype?: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 * @returns {Promise<DecodedPreview>}
 */
export async function decodeImagePreviewUrlToObjectUrl({ url, filename = "", mimetype = "", signal, outputType = "image/png", quality } = {}) {
  if (!url) {
    throw new Error("缺少圖片預覽 URL，無法解碼");
  }

  if (isHeifImage({ filename, mimetype })) {
    return decodeHeifToObjectUrl({ url, signal, outputType, quality });
  }

  if (isAvifImage({ filename, mimetype })) {
    throw new Error("當前前端解碼器不支援 AVIF（請走瀏覽器原生渲染路徑）");
  }

  throw new Error(`不支援的解碼格式: ${filename || mimetype || "unknown"}`);
}

/**
 * 相容舊呼叫：預設輸出 PNG
 * @param {{ url: string; filename?: string; mimetype?: string; signal?: AbortSignal }} input
 */
export async function decodeImagePreviewUrlToPngObjectUrl({ url, filename = "", mimetype = "", signal } = {}) {
  return decodeImagePreviewUrlToObjectUrl({ url, filename, mimetype, signal, outputType: "image/png" });
}

/**
 * 解碼 HEIC/HEIF 為圖片 objectURL
 * - 優先使用 Worker + OffscreenCanvas
 * - Worker 不可用時降級到主執行緒解碼
 *
 * @param {{ url: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 * @returns {Promise<DecodedPreview>}
 */
export async function decodeHeifToObjectUrl({ url, signal, outputType = "image/png", quality } = {}) {
  return heifDecodeSemaphore.run(async () => {
    if (signal?.aborted) throw createAbortError();

    // 優先走 Worker
    try {
      const data = await decodeHeifToObjectUrlViaWorker({ url, signal, outputType, quality });
      const blob = data?.blob;
      if (!blob) {
        throw new Error("HEIF Worker 返回資料缺失（blob）");
      }
      const objectUrl = URL.createObjectURL(blob);
      return { objectUrl, width: data.width, height: data.height };
    } catch (e) {
      // Abort 直接丟擲
      if (e?.name === "AbortError") throw e;
      // OffscreenCanvas/Worker 不支援等場景：降級主執行緒
      return decodeHeifToPngObjectUrlMainThread({ url, signal, outputType, quality });
    }
  });
}

/**
 * 主執行緒降級解碼（保留舊邏輯）
 * @param {{ url: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 */
async function decodeHeifToPngObjectUrlMainThread({ url, signal, outputType = "image/png", quality } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`獲取 HEIC/HEIF 資料失敗: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // 同時相容 CJS/ESM 的 default interop
  const libheif = await loadLibheif();

  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(arrayBuffer));
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
  if (!image) {
    throw new Error("HEIC/HEIF 解碼失敗：未獲取到影象幀");
  }

  const width = image.get_width();
  const height = image.get_height();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D 上下文不可用");
  }

  const imageData = ctx.createImageData(width, height);
  await new Promise((resolve, reject) => {
    image.display(imageData, (displayData) => {
      if (!displayData) {
        reject(new Error("HEIC/HEIF 處理失敗（display 返回空）"));
        return;
      }
      resolve();
    });
  });

  ctx.putImageData(imageData, 0, 0);

  // 儘量釋放底層資源（若 API 存在）
  try {
    if (typeof image.free === "function") image.free();
    if (typeof decoder.free === "function") decoder.free();
  } catch {
    // 忽略釋放失敗（不影響結果）
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error("Canvas 轉換 PNG 失敗（toBlob 返回空）"));
          return;
        }
        resolve(b);
      },
      outputType,
      typeof quality === "number" ? quality : 1,
    );
  });

  const objectUrl = URL.createObjectURL(blob);
  return { objectUrl, width, height };
}

/**
 * 釋放 objectURL（工具函式）
 * @param {string|null|undefined} objectUrl
 */
export function revokeObjectUrl(objectUrl) {
  if (!objectUrl) return;
  if (typeof objectUrl !== "string") return;
  if (!objectUrl.startsWith("blob:")) return;
  URL.revokeObjectURL(objectUrl);
}
