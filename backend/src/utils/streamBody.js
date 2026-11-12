/**
 * 串流請求體工具（跨 Node / Cloudflare Workers）
 *
 * 背景：
 * - Node 18+ 內建 fetch（undici）用 ReadableStream / AsyncIterable 當 body 時，
 *   必須帶 `duplex: "half"`，否則直接丟 `TypeError: RequestInit: duplex option is required`。
 * - Cloudflare Workers 對「長度未知」的 ReadableStream 一律用 chunked 傳輸，
 *   手動設定的 Content-Length 會被忽略。許多上游（部分 WebDAV、Google Drive resumable、
 *   OneDrive uploadSession 等）要求明確的 Content-Length，收到 chunked 會回 411 / 400 或直接斷線。
 *   Workers 提供 FixedLengthStream，可在串流的同時宣告長度。
 */

/**
 * @param {any} body
 * @returns {boolean}
 */
export function isWebReadableStream(body) {
  return !!body && typeof body === "object" && typeof body.getReader === "function";
}

/**
 * @param {any} body
 * @returns {boolean}
 */
export function isStreamingBody(body) {
  if (!body || typeof body !== "object") return false;
  if (isWebReadableStream(body)) return true;
  // Node Readable / AsyncIterable（排除 Buffer/TypedArray/Blob 等一次性內容）
  if (typeof body[Symbol.asyncIterator] === "function") return true;
  return false;
}

/**
 * 把串流 body 包成「長度已知」的 body（僅 Workers 有 FixedLengthStream 時生效）
 * @param {any} body
 * @param {number|null|undefined} contentLength
 * @returns {any}
 */
export function withKnownLength(body, contentLength) {
  const len = Number(contentLength);
  if (!isWebReadableStream(body) || !Number.isFinite(len) || len < 0) return body;
  const FLS = /** @type {any} */ (globalThis).FixedLengthStream;
  if (typeof FLS !== "function") return body;
  try {
    const { readable, writable } = new FLS(len);
    // 背景串接；錯誤會反映在 readable 端，讓 fetch 失敗
    body.pipeTo(writable).catch(() => {});
    return readable;
  } catch {
    return body;
  }
}

/**
 * 產生適用於「上傳到上游」的 fetch init：
 * - Workers：串流且長度已知時改用 FixedLengthStream（避免 chunked）
 * - Node：自動加 duplex: "half"
 * @param {RequestInit & { duplex?: string }} init
 * @param {{ contentLength?: number|null }} [options]
 * @returns {RequestInit & { duplex?: string }}
 */
export function buildUploadFetchInit(init = {}, options = {}) {
  const next = { ...init };
  if (next.body != null && isStreamingBody(next.body)) {
    next.body = withKnownLength(next.body, options.contentLength);
    if (!next.duplex) {
      // @ts-ignore Node undici 需要；Workers 會忽略
      next.duplex = "half";
    }
  }
  return next;
}

/**
 * Node 環境全域補丁：任何 fetch(…, { body: stream }) 自動補 duplex: "half"
 * 只需在 Node 入口呼叫一次；重複呼叫無副作用。
 */
export function installNodeFetchDuplexPatch() {
  const g = /** @type {any} */ (globalThis);
  if (typeof g.fetch !== "function" || g.__cloudharborFetchDuplexPatched) return;
  const originalFetch = g.fetch.bind(g);
  g.fetch = (input, init) => {
    if (init && init.body != null && !init.duplex && isStreamingBody(init.body)) {
      init = { ...init, duplex: "half" };
    }
    return originalFetch(input, init);
  };
  g.__cloudharborFetchDuplexPatched = true;
}

/**
 * 從 Web ReadableStream 依固定大小切塊讀取（最後一塊可能較小）
 * 每次只在記憶體保留一塊，適合 Workers（128MB 記憶體上限）。
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} chunkSize
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* readStreamInChunks(stream, chunkSize) {
  const reader = stream.getReader();
  let buffer = new Uint8Array(chunkSize);
  let filled = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      let offset = 0;
      const view = value instanceof Uint8Array ? value : new Uint8Array(value);
      while (offset < view.byteLength) {
        const take = Math.min(chunkSize - filled, view.byteLength - offset);
        buffer.set(view.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === chunkSize) {
          yield buffer;
          buffer = new Uint8Array(chunkSize);
          filled = 0;
        }
      }
    }
    if (filled > 0) {
      yield buffer.subarray(0, filled);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}
