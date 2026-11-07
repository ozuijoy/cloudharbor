import { isNodeReadable, isWebReadableStream } from "./types.js";
import { NotFoundError, AppError, DriverError } from "../../http/errors.js";

/**
 * StorageStreamDescriptor 構造工具
 *
 * - 為各驅動提供統一的 StorageStreamDescriptor 構造方式
 * - 封裝 NodeReadable / Web ReadableStream 差異
 * - 簡化 AbortSignal / 關閉邏輯
 */

/**
 * 基於本地檔案路徑構造 Node 流描述（通常用於 LocalStorageDriver）
 * @param {Object} params
 * @param {() => Promise<import("stream").Readable>} params.openStream - 開啟 NodeReadable 的工廠函式
 * @param {number|null} params.size
 * @param {string|null} params.contentType
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createNodeStreamDescriptor({ openStream, openRangeStream, size, contentType, etag = null, lastModified = null }) {
  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream(options = {}) {
      const { signal } = options;
      const stream = await openStream();

      if (signal) {
        signal.addEventListener("abort", () => {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        });
      }

      return {
        stream,
        async close() {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        },
      };
    },
    async getRange(range, options = {}) {
      if (typeof openRangeStream !== "function") {
        throw new DriverError("當前驅動未實現原生 Range 讀取");
      }

      const { signal } = options;
      const stream = await openRangeStream(range);

      if (signal) {
        signal.addEventListener("abort", () => {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        });
      }

      return {
        stream,
        async close() {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        },
      };
    },
  };
}

/**
 * 基於 fetch/HTTP 響應構造 Web 流描述（WebDAV/OneDrive/GoogleDrive 等）
 * @param {Object} params
 * @param {() => Promise<Response>} params.fetchResponse - 拉取 Response 的工廠函式
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @param {boolean} [params.supportsRange] - 若已知伺服器支援 Range，可顯式傳入
 * @returns {import("./types.js").StorageStreamDescriptor & { supportsRange?: boolean }}
 */
export function createHttpStreamDescriptor({
  fetchResponse,
  fetchRangeResponse,
  fetchHeadResponse,
  size = null,
  contentType = null,
  etag = null,
  lastModified = null,
  supportsRange,
}) {
  let currentSize = typeof size === "number" ? size : null;

  const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

  const isAbortError = (error) => error?.name === "AbortError";

  const sleep = async (ms, signal) => {
    if (!ms || ms <= 0) return;
    if (signal?.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timer);
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  const fetchWithRetry = async (label, fn, { signal } = {}) => {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fn();
        const retryable = resp && RETRYABLE_HTTP_STATUS.has(resp.status);

        if (retryable && attempt < maxAttempts) {
          console.warn(`[StreamDescriptorUtils] ${label} HTTP ${resp.status}，將重試 (${attempt}/${maxAttempts})`);
          await sleep(200 * attempt, signal);
          continue;
        }

        return resp;
      } catch (error) {
        if (isAbortError(error) || attempt >= maxAttempts) throw error;
        console.warn(`[StreamDescriptorUtils] ${label} fetch 失敗，將重試 (${attempt}/${maxAttempts}):`, error?.message || error);
        await sleep(200 * attempt, signal);
      }
    }

    throw new DriverError(`${label} fetch 失敗（重試耗盡）`);
  };

  const tryInferSizeFromResponse = (resp) => {
    if (!resp || !resp.headers) return null;
    const contentRange = resp.headers.get("content-range");
    if (contentRange) {
      const match = String(contentRange).match(/\/(\d+)\s*$/);
      if (match && match[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    const contentLength = resp.headers.get("content-length");
    if (contentLength) {
      const parsed = Number(contentLength);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return null;
  };

  const descriptor = {
    get size() {
      return currentSize;
    },
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    supportsRange,
    async probeSize(options = {}) {
      if (typeof currentSize === "number" && currentSize >= 0) return currentSize;
      const { signal } = options;

      // 1) 優先 HEAD
      if (typeof fetchHeadResponse === "function") {
        const resp = await fetchWithRetry("HEAD", () => fetchHeadResponse(signal), { signal });
        if (resp && resp.ok) {
          const inferred = tryInferSizeFromResponse(resp);
          if (typeof inferred === "number") {
            currentSize = inferred;
            return currentSize;
          }
        }
      }

      // 2) 某些上游不支援 HEAD 或不返回 Content-Length：用 bytes=0-0 探測
      if (typeof fetchRangeResponse === "function") {
        const rangeHeader = "bytes=0-0";
        const resp = await fetchWithRetry("GET(RangeProbe)", () => fetchRangeResponse(signal, rangeHeader, { start: 0, end: 0 }), {
          signal,
        });
        if (resp && resp.ok) {
          const inferred = tryInferSizeFromResponse(resp);
          if (typeof inferred === "number") {
            currentSize = inferred;
          }
        }
        try {
          await resp?.body?.cancel?.();
        } catch {}
      }

      return currentSize;
    },
    async getStream(options = {}) {
      const { signal } = options;
      const resp = await fetchWithRetry("GET", () => fetchResponse(signal), { signal });

      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError("檔案不存在");
        }
        throw new DriverError(`下載失敗: HTTP ${resp.status}`);
      }

      if (currentSize === null) {
        const inferred = tryInferSizeFromResponse(resp);
        if (typeof inferred === "number") currentSize = inferred;
      }

      const stream = resp.body;

      return {
        stream,
        async close() {
          if (stream && typeof stream.cancel === "function") {
            try {
              await stream.cancel();
            } catch {}
          }
        },
      };
    },
  };

  // 僅當上遊提供了 Range 拉取函式時，才暴露 getRange
  // - 避免呼叫方誤判“支援 getRange”，導致 Range 請求拋錯而不是回退軟體切片
  if (typeof fetchRangeResponse === "function") {
    descriptor.getRange = async (range, options = {}) => {
      const { signal } = options;
      const rangeHeader = `bytes=${range.start}-${range.end}`;
      let resp = await fetchWithRetry("GET(Range)", () => fetchRangeResponse(signal, rangeHeader, range), { signal });

      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError("檔案不存在");
        }
        throw new DriverError(`下載失敗: HTTP ${resp.status}`);
      }

      if (currentSize === null) {
        const inferred = tryInferSizeFromResponse(resp);
        if (typeof inferred === "number") currentSize = inferred;
      }

      // 判斷上游是否“真的”按 Range 返回了部分內容：
      let contentRange = resp.headers.get("content-range");
      let isPartial = false;
      if (resp.status === 206) {
        isPartial = true;
      }
      if (!isPartial && contentRange) {
        const m = String(contentRange).match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
        if (m && m[1]) {
          const start = Number(m[1]);
          if (Number.isFinite(start) && start === range.start) {
            isPartial = true;
          }
        }
      }

      return {
        stream: resp.body,
        supportsRange: isPartial,
        upstreamStatus: resp.status,
        upstreamContentRange: contentRange || null,
        async close() {
          const responseStream = resp.body;
          if (responseStream && typeof responseStream.cancel === "function") {
            try {
              await responseStream.cancel();
            } catch {}
          }
        },
      };
    };
  }

  return descriptor;
}

/**
 * 基於 Web ReadableStream 構造流描述（GoogleDrive/OneDrive 等）
 * @param {Object} params
 * @param {(signal?: AbortSignal) => Promise<ReadableStream<Uint8Array>>} params.openStream
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createWebStreamDescriptor({ openStream, size = null, contentType = null, etag = null, lastModified = null }) {
  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream(options = {}) {
      const { signal } = options;
      const stream = await openStream(signal);

      return {
        stream,
        async close() {
          if (stream && stream.locked === false && typeof stream.cancel === "function") {
            try {
              await stream.cancel();
            } catch {}
          }
        },
      };
    },
  };
}

/**
 * 從已知的底層流構造通用 StorageStreamDescriptor
 * - 適用於 provider SDK 已經返回 NodeReadable 或 Web ReadableStream 的場景
 * @param {Object} params
 * @param {import('stream').Readable|ReadableStream<Uint8Array>} params.stream
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createGenericStreamDescriptor({ stream, size = null, contentType = null, etag = null, lastModified = null }) {
  const isNode = isNodeReadable(stream);
  const isWeb = !isNode && isWebReadableStream(stream);

  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream() {
      return {
        stream,
        async close() {
          try {
            if (isNode && stream.destroy) {
              stream.destroy();
            } else if (isWeb && typeof stream.cancel === "function") {
              await stream.cancel();
            }
          } catch {}
        },
      };
    },
  };
}

export default {
  createNodeStreamDescriptor,
  createHttpStreamDescriptor,
  createGenericStreamDescriptor,
};
