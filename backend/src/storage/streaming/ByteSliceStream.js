/**
 * ByteSliceStream - 軟體層面的位元組切片流
 *
 * 當上遊儲存不支援 HTTP Range 請求（返回 200 而非 206）時，
 * 使用此 TransformStream 在記憶體中實現位元組範圍切片。
 *
 * - 跳過前 `start` 個位元組
 * - 輸出從 start 到 end 的位元組
 * - 到達 end 後立即關閉流
 *
 * - WebDAV 伺服器不支援 Range 請求
 * - 任何返回完整流但需要部分內容的場景
 * - 對於大檔案前部偏移量較大的情況，仍需讀取並丟棄大量資料
 * - 建議優先使用驅動原生 Range 支援，此類作為降級方案
 */

/**
 * 建立位元組切片 TransformStream
 * @param {number} start - 起始位元組（包含）
 * @param {number} end - 結束位元組（包含）
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
export function createByteSliceStream(start, end) {
  let position = 0;
  let finished = false;

  return new TransformStream({
    transform(chunk, controller) {
      if (finished) {
        // 已完成，忽略後續資料
        return;
      }

      const chunkStart = position;
      const chunkEnd = position + chunk.byteLength - 1;
      position += chunk.byteLength;

      // 情況1：整個 chunk 在範圍之前，跳過
      if (chunkEnd < start) {
        return;
      }

      // 情況2：整個 chunk 在範圍之後，結束
      if (chunkStart > end) {
        finished = true;
        controller.terminate();
        return;
      }

      // 情況3：chunk 與範圍有交集，計算需要輸出的部分
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = Math.min(chunk.byteLength, end - chunkStart + 1);

      if (sliceStart < sliceEnd) {
        const slice = chunk.subarray(sliceStart, sliceEnd);
        controller.enqueue(slice);
      }

      // 檢查是否已到達結束位置
      if (chunkEnd >= end) {
        finished = true;
        controller.terminate();
      }
    },

    flush(controller) {
      // 流正常結束時無需額外操作
    },
  });
}

/**
 * 將完整流包裝為範圍流
 * @param {ReadableStream<Uint8Array>} fullStream - 完整檔案流
 * @param {number} start - 起始位元組（包含）
 * @param {number} end - 結束位元組（包含）
 * @returns {ReadableStream<Uint8Array>} 切片後的流
 */
export function wrapStreamWithByteSlice(fullStream, start, end) {
  const reader = fullStream.getReader();
  let position = 0;
  let finished = false;

  const closeUpstream = async () => {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  };

  return new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          controller.close();
          return;
        }

        const data = value instanceof Uint8Array ? value : new Uint8Array(value);
        const chunkStart = position;
        const chunkEnd = position + data.byteLength - 1;
        position += data.byteLength;

        if (chunkEnd < start) {
          return;
        }

        if (chunkStart > end) {
          finished = true;
          await closeUpstream();
          controller.close();
          return;
        }

        const sliceStart = Math.max(0, start - chunkStart);
        const sliceEnd = Math.min(data.byteLength, end - chunkStart + 1);
        if (sliceStart < sliceEnd) {
          controller.enqueue(data.subarray(sliceStart, sliceEnd));
        }

        if (chunkEnd >= end) {
          finished = true;
          await closeUpstream();
          controller.close();
        }
      } catch (e) {
        finished = true;
        await closeUpstream();
        controller.error(e);
      }
    },
    async cancel() {
      finished = true;
      await closeUpstream();
    },
  });
}

/**
 * 為 Node.js Readable 流建立位元組切片包裝
 * 返回 Web ReadableStream 以保持 API 一致性
 * @param {import('stream').Readable} nodeStream - Node.js 可讀流
 * @param {number} start - 起始位元組（包含）
 * @param {number} end - 結束位元組（包含）
 * @returns {ReadableStream<Uint8Array>} 切片後的 Web ReadableStream
 */
export function wrapNodeStreamWithByteSlice(nodeStream, start, end) {
  let position = 0;
  let finished = false;

  return new ReadableStream({
    async start(controller) {
      nodeStream.on("data", (chunk) => {
        if (finished) {
          return;
        }

        // 確保 chunk 是 Uint8Array
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

        const chunkStart = position;
        const chunkEnd = position + data.byteLength - 1;
        position += data.byteLength;

        // 整個 chunk 在範圍之前，跳過
        if (chunkEnd < start) {
          return;
        }

        // 整個 chunk 在範圍之後，結束
        if (chunkStart > end) {
          finished = true;
          nodeStream.destroy();
          controller.close();
          return;
        }

        // chunk 與範圍有交集
        const sliceStart = Math.max(0, start - chunkStart);
        const sliceEnd = Math.min(data.byteLength, end - chunkStart + 1);

        if (sliceStart < sliceEnd) {
          const slice = data.subarray(sliceStart, sliceEnd);
          controller.enqueue(slice);
        }

        // 檢查是否已到達結束位置
        if (chunkEnd >= end) {
          finished = true;
          nodeStream.destroy();
          controller.close();
        }
      });

      nodeStream.on("end", () => {
        if (!finished) {
          controller.close();
        }
      });

      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },

    cancel(reason) {
      finished = true;
      nodeStream.destroy();
    },
  });
}

/**
 * 智慧包裝流以支援位元組切片
 * 自動檢測流型別（Web ReadableStream 或 Node.js Readable）並應用切片
 * @param {ReadableStream<Uint8Array> | import('stream').Readable} stream - 輸入流
 * @param {number} start - 起始位元組（包含）
 * @param {number} end - 結束位元組（包含）
 * @returns {ReadableStream<Uint8Array>} 切片後的流
 */
export function smartWrapStreamWithByteSlice(stream, start, end) {
  // 檢測是否為 Web ReadableStream
  if (stream && typeof stream.getReader === "function") {
    return wrapStreamWithByteSlice(stream, start, end);
  }

  // 檢測是否為 Node.js Readable
  if (stream && typeof stream.pipe === "function" && typeof stream.on === "function") {
    return wrapNodeStreamWithByteSlice(stream, start, end);
  }

  // 未知型別，丟擲錯誤
  throw new Error("不支援的流型別，無法應用位元組切片");
}
