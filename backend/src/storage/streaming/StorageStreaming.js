/**
 * StorageStreaming - 統一的儲存內容訪問層
 *
 * - 作為所有內容訪問路徑的唯一入口（FS/WebDAV/Proxy/Share/Object/Preview）
 * - 呼叫驅動獲取 StorageStreamDescriptor
 * - 處理 Range/條件請求
 * - 返回 RangeReader 供協議層構造 HTTP 響應
 * - 驅動層不再構造 HTTP Response
 * - Node/Worker 執行時差異在此層處理
 * - 統一的錯誤對映和日誌
 */

import {
  parseRangeHeader,
  parseMultiRangeHeader,
  evaluateConditionalHeaders,
  buildResponseHeaders,
  mapDriverErrorToHttpStatus,
  shouldIgnoreRangeForIfRange,
} from "./utils.js";
import { STREAMING_CHANNELS } from "./types.js";
import { NotFoundError, DriverError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { smartWrapStreamWithByteSlice } from "./ByteSliceStream.js";

// 影片“超大跳轉”保護閾值（固定值，跟隨 OpenList 的經驗閾值）：
// - OpenList 在“上游不支援 Range，只能讀掉 offset 再丟棄”的兜底裡，對 offset > 100MB 會明確警告浪費頻寬
//   參考：D:/github-project/OpenList/internal/net/util.go:314
// - 我們這裡用於“影片大跳轉”場景：當 Range start 超過該閾值時，會先探測上游是否真支援 Range
//   - 上游不支援：忽略 Range 返回 200（避免讀掉大量位元組導致流量爆炸）
//   - 上游支援：正常返回 206
const VIDEO_SOFTWARE_SLICE_MAX_START_BYTES = 100 * 1024 * 1024; // 100MB

const isLikelyVideoPath = (p) => {
  const s = (p || "").toLowerCase();
  return s.endsWith(".mp4") || s.endsWith(".m4v") || s.endsWith(".mov") || s.endsWith(".webm") || s.endsWith(".mkv") || s.endsWith(".avi");
};

const isVideoLikeRequest = (request, descriptor, path) => {
  const ct = descriptor?.contentType ? String(descriptor.contentType).toLowerCase() : "";
  if (ct.startsWith("video/")) return true;

  const dest = request?.headers?.get?.("sec-fetch-dest");
  if (dest && String(dest).toLowerCase() === "video") return true;

  const accept = request?.headers?.get?.("accept");
  if (accept && String(accept).toLowerCase().includes("video/")) return true;

  return isLikelyVideoPath(path);
};

/**
 * 將 Node.js Readable 轉換為 Web ReadableStream（用於 Response body）
 * 目標：在 Node/Docker 場景下也能“邊讀邊回”，避免整檔案 Buffer.concat 導致大檔案一直載入。
 *
 * @param {any} nodeStream
 * @param {() => Promise<void> | void} [onClose]
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
async function wrapNodeReadableToWebStream(nodeStream, onClose) {
  // 設計原則：
  // 1) 優先用 Node 原生 Readable.toWeb 做橋接（自帶背壓，不會把 1GB 影片“瘋狂塞進記憶體佇列”）。
  // 2) 不監聽 "close" 事件；只把 "end" 當作正常結束，避免 Content-Length mismatch 導致瀏覽器“拖動不了進度條”。

  try {
    const { Readable } = await import("node:stream");
    if (Readable?.toWeb) {
      const webStream = Readable.toWeb(nodeStream);
      const reader = webStream.getReader();
      let cleaned = false;

      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        try {
          await onClose?.();
        } catch {
          // ignore
        }
      };

      return new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              await cleanup();
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            await cleanup();
            controller.error(err);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } catch {
            // ignore
          }
          try {
            nodeStream.destroy?.();
          } catch {
            // ignore
          }
          await cleanup();
        },
      });
    }
  } catch {
    // ignore (Worker 環境/相容層可能沒有 node:stream)
  }

  // 兜底：事件橋接（帶簡單背壓）
  return new ReadableStream({
    start(controller) {
      let cleaned = false;

      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        try {
          nodeStream.off?.("data", onData);
          nodeStream.off?.("error", onError);
          nodeStream.off?.("end", onEnd);
        } catch {
          // ignore
        }
        try {
          await onClose?.();
        } catch {
          // ignore
        }
      };

      const onData = (chunk) => {
        // 相容：某些 Node 流若設定了 encoding，chunk 可能是 string
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        // Buffer 本身就是 Uint8Array，直接 enqueue 即可（避免額外複製）
        controller.enqueue(data);
        // ReadableStream 的 desiredSize <= 0 表示消費者跟不上，暫停 Node 讀取，避免記憶體無限增長
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          try {
            nodeStream.pause?.();
          } catch {
            // ignore
          }
        }
      };

      const onError = (err) => {
        void cleanup().finally(() => {
          controller.error(err);
        });
      };

      const onEnd = () => {
        void cleanup().finally(() => {
          controller.close();
        });
      };

      nodeStream.on?.("data", onData);
      nodeStream.on?.("error", onError);
      nodeStream.on?.("end", onEnd);

      // 預設先暫停，等消費者 pull 再開始讀
      try {
        nodeStream.pause?.();
      } catch {
        // ignore
      }
    },
    pull() {
      try {
        nodeStream.resume?.();
      } catch {
        // ignore
      }
    },
    async cancel() {
      try {
        nodeStream.destroy?.();
      } catch {
        // ignore
      }
      try {
        await onClose?.();
      } catch {
        // ignore
      }
    },
  });
}

/**
 * 將 Web ReadableStream 包裝為“可感知 close”的流
 * 目標：當客戶端讀完/中斷/報錯時，確保呼叫 handle.close() 釋放底層資源（例如遠端連線、上游下載、檔案控制代碼等）。
 *
 * @param {ReadableStream<Uint8Array>} webStream
 * @param {() => Promise<void> | void} [onClose]
 * @returns {ReadableStream<Uint8Array>}
 */
function wrapWebReadableStreamWithClose(webStream, onClose) {
  const reader = webStream.getReader();
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      reader.releaseLock?.();
    } catch {
      // ignore
    }
    try {
      await onClose?.();
    } catch {
      // ignore
    }
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await cleanup();
          controller.close();
          return;
        }
        const data = value instanceof Uint8Array ? value : new Uint8Array(value);
        controller.enqueue(data);
      } catch (err) {
        await cleanup();
        controller.error(err);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // ignore
      }
      await cleanup();
    },
  });
}

/**
 * @typedef {import('./types.js').StorageStreamDescriptor} StorageStreamDescriptor
 * @typedef {import('./types.js').RangeReader} RangeReader
 * @typedef {import('./types.js').RangeReaderOptions} RangeReaderOptions
 * @typedef {import('./types.js').StreamHandle} StreamHandle
 */

export class StorageStreaming {
  /**
   * @param {Object} options
   * @param {Object} options.mountManager - MountManager 例項
   * @param {Object} options.storageFactory - StorageFactory 類
   * @param {string} options.encryptionSecret - 加密金鑰
   */
  constructor({ mountManager, storageFactory, encryptionSecret }) {
    this.mountManager = mountManager;
    this.storageFactory = storageFactory;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 獲取 RangeReader（主入口）
   * @param {RangeReaderOptions} options
   * @returns {Promise<RangeReader>}
   */
  async getRangeReader(options) {
    const { path, channel, mount, storageConfigId, request, userIdOrInfo, userType, ownerType, ownerId, db } = options;
    const rangeHeader = options?.rangeHeader ?? request?.headers?.get?.("range") ?? null;

    const logPrefix = `[StorageStreaming][${channel}]`;
    const ifRangeHeader = request?.headers?.get?.("if-range") ?? null;
    console.log(
      `${logPrefix} 開始處理: ${path}${rangeHeader ? ` | Range=${rangeHeader}` : ""}${ifRangeHeader ? ` | If-Range=${ifRangeHeader}` : ""}`,
    );

    try {
      // 1. 解析路徑到驅動
      const { driver, resolvedMount, subPath } = await this._resolveDriver(options);

      // 2. 獲取 StorageStreamDescriptor
      const downloadResult = await driver.downloadFile(subPath, {
        path,
        mount: resolvedMount,
        subPath,
        db,
        request,
        userIdOrInfo,
        userType,
        ownerType,
        ownerId,
      });

      // 驗證返回結構
      /** @type {StorageStreamDescriptor} */
      const descriptor = this._adaptToDescriptor(downloadResult);

      // 3. 評估條件請求
      const { shouldReturn304, shouldReturn412 } = evaluateConditionalHeaders(request, descriptor.etag, descriptor.lastModified);

      if (shouldReturn304) {
        console.log(`${logPrefix} 返回 304 Not Modified`);
        return this._create304Reader(descriptor, channel);
      }

      if (shouldReturn412) {
        console.log(`${logPrefix} 返回 412 Precondition Failed`);
        return this._create412Reader(descriptor, channel);
      }

      // If-Range：不匹配則必須忽略 Range（返回 200 全量），避免客戶端拼接錯亂/破圖
      if (rangeHeader && shouldIgnoreRangeForIfRange(request, descriptor.etag, descriptor.lastModified)) {
        console.log(`${logPrefix} If-Range 不匹配，忽略 Range，返回 200 OK`);
        return this._create200Reader(descriptor, channel);
      }

      // 解析 Range 請求
      // Range 場景：若檔案大小未知但描述符提供 probeSize，則優先探測 size 後再解析 Range
      if (rangeHeader && (descriptor.size === null || descriptor.size <= 0) && typeof descriptor.probeSize === "function") {
        try {
          // 不將探測失敗視為致命錯誤，失敗則回退為 200 全量響應
          await descriptor.probeSize({ signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
        } catch (e) {
          console.warn(`${logPrefix} Range size 探測失敗，將回退為 200: ${e?.message || String(e)}`);
        }
      }

      // multi-range（多段 Range）：按 RFC 語義返回 multipart/byteranges（僅在 size 已知且驅動具備原生 getRange 時啟用）
      if (rangeHeader && String(rangeHeader).includes(",")) {
        const parsed = parseMultiRangeHeader(rangeHeader, descriptor.size);
        if (!parsed || !parsed.isValid) {
          console.log(`${logPrefix} Multi-Range 格式無效，降級為 200 OK`);
          return this._create200Reader(descriptor, channel);
        }

        // size 未知：無法構造 multipart/byteranges（尤其 suffix-range），降級為 200
        if (descriptor.size === null || descriptor.size <= 0) {
          console.log(`${logPrefix} Multi-Range 但檔案大小未知，降級為 200 OK`);
          return this._create200Reader(descriptor, channel);
        }

        // 無可滿足範圍：416
        if (parsed.hasNoOverlap) {
          console.log(`${logPrefix} Multi-Range 無可滿足範圍，返回 416`);
          return this._create416Reader(descriptor, channel);
        }

        // 規範/安全：若總請求位元組數超過檔案大小，視為可疑，忽略 Range
        let total = 0;
        for (const r of parsed.ranges) total += r.end - r.start + 1;
        if (total > descriptor.size) {
          console.log(`${logPrefix} Multi-Range 總位元組數(${total})超過檔案大小(${descriptor.size})，忽略 Range，返回 200`);
          return this._create200Reader(descriptor, channel);
        }

        // 單段其實不該走 multi-range，但為了相容，回到單段 206
        if (parsed.ranges.length === 1) {
          const single = parsed.ranges[0];
          console.log(`${logPrefix} Multi-Range 解析後僅 1 段，回退為單段 206: ${single.start}-${single.end}`);
          return this._create206Reader(descriptor, { ...single, isSatisfiable: true }, channel);
        }

        // 關鍵限制：只有驅動具備 getRange（且上游真正返回 206）才啟用 multipart，
        // 否則會變成“每段都從頭讀再丟掉”的超浪費方案，反而更糟糕。
        if (typeof descriptor.getRange !== "function") {
          console.log(`${logPrefix} Multi-Range 但驅動未實現 getRange，降級為 200（避免超浪費的軟體多段切片）`);
          return this._create200Reader(descriptor, channel);
        }

        // 探測一次：確認上游真的支援 Range（避免“忽略 Range 返回 200”時我們卻輸出 multipart 頭）
        try {
          const probe = await descriptor.getRange({ start: parsed.ranges[0].start, end: parsed.ranges[0].start });
          const ok = probe && probe.supportsRange !== false;
          await probe?.close?.();
          if (!ok) {
            console.log(`${logPrefix} Multi-Range 探測發現上游不支援 Range，降級為 200`);
            return this._create200Reader(descriptor, channel);
          }
        } catch (e) {
          console.log(`${logPrefix} Multi-Range 探測失敗，降級為 200：${e?.message || String(e)}`);
          return this._create200Reader(descriptor, channel);
        }

        console.log(`${logPrefix} 返回 206 Multi-Range (multipart): ${parsed.ranges.map((r) => `${r.start}-${r.end}`).join(",")}`);
        return this._create206MultiRangeReader(descriptor, parsed.ranges, channel);
      }

      const range = parseRangeHeader(rangeHeader, descriptor.size);

      // 檔案大小未知（例如 WebDAV HEAD 未返回 Content-Length）時，
      // 無法構造符合規範的 206/416（缺少 Content-Range），統一降級為 200 全量響應。
      if (range && range.unknownSize) {
        console.log(`${logPrefix} 檔案大小未知，忽略 Range，返回 200 OK: ${range.start}-${range.end}`);
        return this._create200Reader(descriptor, channel);
      }

      if (range && !range.isValid) {
        console.log(`${logPrefix} Range 格式無效`);
        return this._create200Reader(descriptor, channel);
      }

      if (range && !range.isSatisfiable) {
        console.log(`${logPrefix} 返回 416 Range Not Satisfiable`);
        return this._create416Reader(descriptor, channel);
      }

      if (range && range.isSatisfiable) {
        // 影片“超大跳轉”保護：
        // - 當使用者拖動到很後面時，瀏覽器會發 Range: bytes=<很大>-...
        // - 如果上游不支援 Range，我們繼續用軟體切片會導致“先讀掉巨量位元組再丟棄”，流量與耗時非常誇張
        // - 因此：對影片場景的大 start，先探測上游是否真的支援 Range；不支援就直接忽略 Range 返回 200
        //   （這樣至少不會把頻寬打爆；但該上游本身也無法真正支援拖動）
        if (
          range.start > VIDEO_SOFTWARE_SLICE_MAX_START_BYTES &&
          isVideoLikeRequest(request, descriptor, path)
        ) {
          const startMb = Math.round((range.start / 1024 / 1024) * 10) / 10;
          const limitMb = Math.round((VIDEO_SOFTWARE_SLICE_MAX_START_BYTES / 1024 / 1024) * 10) / 10;
          console.warn(
            `${logPrefix} 檢測到影片大跳轉 Range(start=${range.start},約${startMb}MB，閾值=${limitMb}MB)，將先確認上游是否支援 Range`,
          );

          if (typeof descriptor.getRange !== "function") {
            console.warn(`${logPrefix} 驅動未實現 getRange，忽略 Range 返回 200（避免軟體切片讀掉大量位元組）`);
            return this._create200Reader(descriptor, channel);
          }

          try {
            const probe = await descriptor.getRange({ start: range.start, end: range.start });
            const ok = probe?.supportsRange !== false;
            if (probe?.upstreamStatus !== undefined || probe?.upstreamContentRange) {
              console.warn(
                `${logPrefix} Range 探測結果: upstreamStatus=${probe?.upstreamStatus ?? "?"}, contentRange=${probe?.upstreamContentRange ?? ""}, supportsRange=${ok}`,
              );
            }
            await probe?.close?.();
            if (!ok) {
              console.warn(`${logPrefix} 上游不支援 Range（將返回 200），避免軟體切片造成頻寬爆炸`);
              return this._create200Reader(descriptor, channel);
            }
          } catch (e) {
            console.warn(`${logPrefix} 上游 Range 探測失敗，將忽略 Range 返回 200（避免軟體切片造成頻寬爆炸）：${e?.message || String(e)}`);
            return this._create200Reader(descriptor, channel);
          }
        }

        console.log(`${logPrefix} 返回 206 Partial Content: ${range.start}-${range.end}`);
        return this._create206Reader(descriptor, range, channel);
      }

      // 5. 正常 200 響應
      console.log(`${logPrefix} 返回 200 OK`);
      return this._create200Reader(descriptor, channel);
    } catch (error) {
      console.error(`${logPrefix} 錯誤:`, error?.message || error);
      throw error;
    }
  }

  /**
   * 便捷方法：直接構造 HTTP Response
   * @param {RangeReaderOptions} options
   * @returns {Promise<Response>}
   */
  async createResponse(options) {
    try {
      const reader = await this.getRangeReader(options);
      let { status, headers } = reader;

      // 304/412 無響應體
      if (status === 304 || status === 412 || status === 416) {
        return new Response(null, { status, headers });
      }

      // HEAD：只返回 headers，不要觸發讀取/開啟底層流（避免浪費頻寬/IO）
      if (options?.request?.method === "HEAD") {
        return new Response(null, { status, headers });
      }

      const handle = await reader.getBody();
      if (!handle) {
        return new Response(null, { status, headers });
      }

      // 允許 Reader 在開啟底層流之後，根據上游真實響應情況“降級為 200”（例如：上游/平臺忽略 Range）。
      // 用於“關閉軟切片”模式，讓不支援 Range 的場景回退到標準 200 全量響應，避免 206 + 軟體切片導致播放卡死等問題。
      if (typeof handle?.overrideStatus === "number") {
        status = handle.overrideStatus;
      }
      if (handle?.overrideHeaders) {
        headers = handle.overrideHeaders;
      }

      const { stream } = handle;

      // 相容：當上遊不支援 Range 時，用 ByteSliceStream 做“軟體切片”。
      // 對軟體切片場景移除 Content-Length，讓客戶端以流結束為準。
      if (status === 206 && handle?.softwareSlice) {
        try {
          headers.delete("Content-Length");
        } catch {
          // ignore
        }
      }

      // 對於 WebReadableStream（有 getReader 方法），直接作為 Response body 交給執行時處理
      if (stream && typeof stream.getReader === "function") {
        const body = wrapWebReadableStreamWithClose(stream, handle?.close);
        return new Response(body, { status, headers });
      }

      // 對於 Node Readable（本地儲存等場景），必須轉換為 Web ReadableStream 並保持“邊讀邊回”。
      if (stream && (typeof stream.pipe === "function" || typeof stream.on === "function")) {
        const body = await wrapNodeReadableToWebStream(stream, handle?.close);
        return new Response(body, { status, headers });
      }

      // 相容：某些 Node 流物件只有 asyncIterator 特徵
      if (stream && typeof stream[Symbol.asyncIterator] === "function") {
        // 退回到“事件橋接”方式：將 asyncIterator 讀出來再推送到 Web Stream
        const asyncIterable = stream;
        const body = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of asyncIterable) {
                const data = chunk instanceof Uint8Array ? chunk : typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
                controller.enqueue(data);
              }
              controller.close();
            } catch (e) {
              controller.error(e);
            } finally {
              try {
                await handle?.close?.();
              } catch {
                // ignore
              }
            }
          },
          async cancel() {
            try {
              await handle?.close?.();
            } catch {
              // ignore
            }
          },
        });
        return new Response(body, { status, headers });
      }

      // 兜底：未知型別，直接交給 Response 處理
      return new Response(stream, { status, headers });
    } catch (error) {
      // 統一將驅動/流層錯誤對映為標準 HTTP 響應，便於前端獲取 code/message
      const { status, message } = mapDriverErrorToHttpStatus(error);
      const code = error?.code || "STREAMING_ERROR";

      const body = JSON.stringify({
        success: false,
        code,
        message,
      });

      const headers = new Headers();
      headers.set("Content-Type", "application/json; charset=utf-8");

      return new Response(body, { status, headers });
    }
  }

  /**
   * 驗證驅動返回的 StorageStreamDescriptor 結構
   * @param {any} result - 驅動返回的結果
   * @returns {import('./types.js').StorageStreamDescriptor}
   * @private
   */
  _adaptToDescriptor(result) {
    // 驗證是否為有效的 StorageStreamDescriptor
    if (typeof result?.getStream === "function") {
      return result;
    }

    // 無法識別的結構，丟擲錯誤
    throw new DriverError("驅動返回了無效的 StorageStreamDescriptor 結構，缺少 getStream 方法", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.INVALID_DOWNLOAD_RESULT",
    });
  }

  /**
   * 解析路徑到驅動
   * @private
   */
  async _resolveDriver(options) {
    const { path, mount, storageConfigId, userIdOrInfo, userType, db, repositoryFactory } = options;

    // 如果提供了 storageConfigId，透過儲存配置建立驅動（儲存路徑模式）
    if (storageConfigId && db) {
      // 獲取儲存配置
      const storageConfigRepo = repositoryFactory?.getStorageConfigRepository?.();
      let storageConfig = null;

      if (storageConfigRepo?.findByIdWithSecrets) {
        storageConfig = await storageConfigRepo.findByIdWithSecrets(storageConfigId);
      } else if (storageConfigRepo?.findById) {
        storageConfig = await storageConfigRepo.findById(storageConfigId);
      }

      if (!storageConfig) {
        throw new NotFoundError("儲存配置不存在");
      }

      if (!storageConfig.storage_type) {
        throw new DriverError("儲存配置缺少 storage_type", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "STREAMING_ERROR.INVALID_CONFIG",
        });
      }

      // 使用 StorageFactory 建立驅動
      const { StorageFactory } = await import("../factory/StorageFactory.js");
      const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);
      return { driver, resolvedMount: null, subPath: path };
    }

    // 否則透過 MountManager 解析（FS 路徑模式）
    if (this.mountManager) {
      const { driver, mount: resolvedMount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);
      return { driver, resolvedMount, subPath };
    }

    throw new DriverError("無法解析儲存路徑：缺少 mountManager 或 storageConfigId", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.NO_RESOLVER",
    });
  }

  /**
   * 建立 200 OK RangeReader
   * @private
   */
  _create200Reader(descriptor, channel) {
    const headers = buildResponseHeaders(descriptor, null, channel);
    let streamHandle = null;
    let closed = false;

    return {
      status: 200,
      headers,
      async getBody() {
        if (closed) return null;
        streamHandle = await descriptor.getStream();
        return streamHandle;
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 建立 206 Partial Content RangeReader
   *
   * 核心邏輯：
   * 1. 優先使用驅動原生 getRange 方法
   * 2. 檢測驅動是否真正返回了部分內容（supportsRange 標記）
   * 3. 如果驅動返回完整流（200 而非 206），使用 ByteSliceStream 進行軟體切片
   * 4. 如果驅動不支援 getRange，直接使用 ByteSliceStream 包裝完整流
   *
   * @private
   */
  _create206Reader(descriptor, range, channel) {
    let streamHandle = null;
    let closed = false;
    const { start, end } = range;

    // 這裡 range 已由 parseRangeHeader 基於 descriptor.size 解析並校驗，
    // start/end 均為有限整數且在檔案範圍內，可直接用於構造響應頭與位元組切片。
    const headers = buildResponseHeaders(descriptor, range, channel);

    return {
      status: 206,
      headers,
      async getBody() {
        if (closed) return null;

        // 優先使用驅動原生 Range 支援
        if (typeof descriptor.getRange === "function") {
          streamHandle = await descriptor.getRange(range);

          // 關鍵檢測：驅動是否真正支援 Range 請求
          // 部分 WebDAV 伺服器會忽略 Range 頭，返回完整內容
          const supportsRange = streamHandle.supportsRange !== false;

          if (!supportsRange) {
            // 預設行為：用 ByteSliceStream 做軟體切片（相容不支援 Range 的上游）。
            // WebDAV 在 Cloudflare->Cloudflare 場景下，軟體切片容易出現“黑屏一直載入”，因此可配置為直接降級 200。
            const fallbackPolicy = descriptor?.rangeFallbackPolicy || "software";

            if (fallbackPolicy === "full") {
              console.log(`[StorageStreaming] 檢測到驅動不支援 Range，降級為 200 全量響應（忽略 Range）: ${start}-${end}`);
              if (streamHandle?.upstreamStatus !== undefined || streamHandle?.upstreamContentRange) {
                console.warn(
                  `[StorageStreaming] 上游 Range 證據: upstreamStatus=${streamHandle?.upstreamStatus ?? "?"}, contentRange=${streamHandle?.upstreamContentRange ?? ""}`,
                );
              }

              const fallbackHeaders = buildResponseHeaders(descriptor, null, channel);
              return {
                stream: streamHandle.stream,
                overrideStatus: 200,
                overrideHeaders: fallbackHeaders,
                async close() {
                  await streamHandle?.close?.();
                },
              };
            }

            console.log(`[StorageStreaming] 檢測到驅動不支援 Range，使用 ByteSliceStream 切片: ${start}-${end}`);
            if (streamHandle?.upstreamStatus !== undefined || streamHandle?.upstreamContentRange) {
              console.warn(
                `[StorageStreaming] 上游 Range 證據: upstreamStatus=${streamHandle?.upstreamStatus ?? "?"}, contentRange=${streamHandle?.upstreamContentRange ?? ""}`,
              );
            }
            if (start > 0) {
              const mb = Math.round((start / 1024 / 1024) * 10) / 10;
              console.warn(`[StorageStreaming] 警告：該切片需要先讀取並丟棄前 ${start} 位元組（約 ${mb}MB），大跳轉會很費流量且很慢`);
            }

            const originalStream = streamHandle.stream;
            const originalClose = streamHandle.close;
            const slicedStream = smartWrapStreamWithByteSlice(originalStream, start, end);

            return {
              stream: slicedStream,
              softwareSlice: true,
              async close() {
                if (originalClose) {
                  await originalClose();
                }
              },
            };
          }

          // 相容：有些上游會返回 200 但帶 Content-Range（我們在 StreamDescriptorUtils 裡會判定 supportsRange=true）
          // 這裡額外打一個提示日誌，方便你排查“上游到底回了啥”。
          if (supportsRange && streamHandle?.upstreamStatus === 200 && streamHandle?.upstreamContentRange) {
            console.log(
              `[StorageStreaming] 上游 Range 相容模式：status=200 但 Content-Range 存在（按 start 匹配視為 Range 生效）`,
            );
          }

          // 驅動原生支援 Range，直接返回
          return streamHandle;
        }

        // 驅動不支援 getRange 方法，降級使用 ByteSliceStream
        const fallbackPolicy = descriptor?.rangeFallbackPolicy || "software";
        if (fallbackPolicy === "full") {
          console.log(`[StorageStreaming] 驅動不支援 getRange 方法，降級為 200 全量響應（忽略 Range）: ${start}-${end}`);
          streamHandle = await descriptor.getStream();
          const fallbackHeaders = buildResponseHeaders(descriptor, null, channel);
          return {
            stream: streamHandle.stream,
            overrideStatus: 200,
            overrideHeaders: fallbackHeaders,
            async close() {
              await streamHandle?.close?.();
            },
          };
        }

        console.log(`[StorageStreaming] 驅動不支援 getRange 方法，使用 ByteSliceStream 切片: ${start}-${end}`);
        if (start > 0) {
          const mb = Math.round((start / 1024 / 1024) * 10) / 10;
          console.warn(`[StorageStreaming] 警告：該切片需要先讀取並丟棄前 ${start} 位元組（約 ${mb}MB），大跳轉會很費流量且很慢`);
        }

        streamHandle = await descriptor.getStream();
        const originalStream = streamHandle.stream;
        const originalClose = streamHandle.close;
        const slicedStream = smartWrapStreamWithByteSlice(originalStream, start, end);

        return {
          stream: slicedStream,
          softwareSlice: true,
          async close() {
            if (originalClose) {
              await originalClose();
            }
          },
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 建立 206 Multi-Range (multipart/byteranges) RangeReader
   * 注意：只在“驅動原生支援 getRange 且上游真正返回 206”時使用。
   *
   * @private
   */
  _create206MultiRangeReader(descriptor, ranges, channel) {
    let closed = false;
    let activeHandle = null;
    const boundary = `cp_${Math.random().toString(16).slice(2)}`;

    const headers = buildResponseHeaders(descriptor, null, channel);
    headers.set("Content-Type", `multipart/byteranges; boundary=${boundary}`);
    headers.delete("Content-Length");
    headers.delete("Content-Range");

    const encoder = new TextEncoder();

    const closeActive = async () => {
      try {
        await activeHandle?.close?.();
      } catch {
        // ignore
      } finally {
        activeHandle = null;
      }
    };

    return {
      status: 206,
      headers,
      async getBody() {
        if (closed) return null;
        if (typeof descriptor.getRange !== "function") {
          throw new DriverError("Multi-Range 需要驅動實現 getRange", {
            status: ApiStatus.INTERNAL_ERROR,
            code: "STREAMING_ERROR.MULTI_RANGE_NO_GETRANGE",
          });
        }

        const stream = new ReadableStream({
          async start(controller) {
            try {
              for (const r of ranges) {
                const contentType = descriptor.contentType || "application/octet-stream";
                const partHeader =
                  `--${boundary}\r\n` +
                  `Content-Type: ${contentType}\r\n` +
                  `Content-Range: bytes ${r.start}-${r.end}/${descriptor.size}\r\n` +
                  `\r\n`;
                controller.enqueue(encoder.encode(partHeader));

                activeHandle = await descriptor.getRange(r);
                const partStream = activeHandle?.stream;
                const webPartStream =
                  partStream && typeof partStream.getReader === "function"
                    ? partStream
                    : partStream && (typeof partStream.pipe === "function" || typeof partStream.on === "function")
                      ? await wrapNodeReadableToWebStream(partStream)
                      : partStream && typeof partStream[Symbol.asyncIterator] === "function"
                        ? new ReadableStream({
                            async start(inner) {
                              try {
                                for await (const chunk of partStream) {
                                  const data =
                                    chunk instanceof Uint8Array
                                      ? chunk
                                      : typeof chunk === "string"
                                        ? Buffer.from(chunk)
                                        : new Uint8Array(chunk);
                                  inner.enqueue(data);
                                }
                                inner.close();
                              } catch (e) {
                                inner.error(e);
                              }
                            },
                          })
                        : null;

                if (!webPartStream) {
                  throw new Error("Multi-Range part stream 型別不支援");
                }

                const reader = webPartStream.getReader();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const data = value instanceof Uint8Array ? value : new Uint8Array(value);
                    controller.enqueue(data);
                  }
                } finally {
                  try {
                    reader.releaseLock?.();
                  } catch {
                    // ignore
                  }
                }

                await closeActive();
                controller.enqueue(encoder.encode("\r\n"));
              }

              controller.enqueue(encoder.encode(`--${boundary}--\r\n`));
              controller.close();
            } catch (e) {
              await closeActive();
              controller.error(e);
            }
          },
          async cancel() {
            await closeActive();
          },
        });

        return {
          stream,
          async close() {
            await closeActive();
          },
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        await closeActive();
      },
    };
  }

  /**
   * 建立 304 Not Modified RangeReader
   * @private
   */
  _create304Reader(descriptor, channel) {
    // 304 也應攜帶快取相關頭（Cache-Control 等），否則客戶端可能無法更新快取策略
    const headers = buildResponseHeaders(descriptor, null, channel);
    // 304 不應返回實體相關頭（例如 Content-Length/Content-Type）
    headers.delete("Content-Length");
    headers.delete("Content-Type");
    headers.delete("Content-Range");

    return {
      status: 304,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 建立 412 Precondition Failed RangeReader
   * @private
   */
  _create412Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.etag) headers.set("ETag", descriptor.etag);
    if (descriptor.lastModified) headers.set("Last-Modified", descriptor.lastModified.toUTCString());

    return {
      status: 412,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 建立 416 Range Not Satisfiable RangeReader
   * @private
   */
  _create416Reader(descriptor, channel) {
    const headers = new Headers();
    if (typeof descriptor.size === "number" && descriptor.size > 0) {
      headers.set("Content-Range", `bytes */${descriptor.size}`);
    }

    return {
      status: 416,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }
}

export { STREAMING_CHANNELS };
