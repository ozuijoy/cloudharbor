/**
 * StorageStreaming 型別定義
 * - StorageStreamDescriptor: 驅動層返回的流描述物件
 * - RangeReader: StorageStreaming 層返回的讀取器
 * - StreamingChannel: 訪問通道列舉
 */

/**
 * 訪問通道列舉
 * @typedef {'fs-web' | 'webdav' | 'proxy' | 'share' | 'object-api' | 'preview' | 'internal-job'} StreamingChannel
 */

/**
 * 位元組範圍
 * @typedef {Object} ByteRange
 * @property {number} start - 起始位元組（包含）
 * @property {number} [end] - 結束位元組（包含），省略表示到檔案末尾
 */

/**
 * 流選項
 * @typedef {Object} StreamOptions
 * @property {AbortSignal} [signal] - AbortSignal 用於取消
 */

/**
 * 流控制代碼
 * @typedef {Object} StreamHandle
 * @property {import('stream').Readable | ReadableStream<Uint8Array>} stream - 可讀流
 * @property {() => Promise<void>} close - 顯式關閉方法
 */

/**
 * 儲存流描述物件（驅動層返回）
 * @typedef {Object} StorageStreamDescriptor
 * @property {number | null} size - 檔案總大小（位元組）
 * @property {string | null} contentType - MIME 型別
 * @property {string | null} [etag] - ETag
 * @property {Date | null} [lastModified] - 最後修改時間
 * @property {(options?: StreamOptions) => Promise<StreamHandle>} getStream - 獲取完整流
 * @property {(range: ByteRange, options?: StreamOptions) => Promise<StreamHandle>} [getRange] - 獲取範圍流（可選）
 */

/**
 * RangeReader 選項
 * @typedef {Object} RangeReaderOptions
 * @property {string} path - FS 掛載路徑或儲存路徑
 * @property {StreamingChannel} channel - 訪問通道
 * @property {Object} [mount] - 掛載上下文
 * @property {string} [storageConfigId] - 儲存配置 ID
 * @property {string} [rangeHeader] - HTTP Range 頭值
 * @property {Request} [request] - 原始 HTTP 請求
 * @property {any} [userIdOrInfo] - 使用者上下文
 * @property {string} [userType] - 使用者型別
 * @property {Object} [db] - 資料庫連線
 */

/**
 * RangeReader 介面
 * @typedef {Object} RangeReader
 * @property {number} status - HTTP 狀態碼
 * @property {Headers} headers - 響應頭
 * @property {() => Promise<StreamHandle | null>} getBody - 獲取響應體流
 * @property {() => Promise<void>} close - 關閉讀取器
 */

export const STREAMING_CHANNELS = {
  FS_WEB: "fs-web",
  WEBDAV: "webdav",
  PROXY: "proxy",
  SHARE: "share",
  OBJECT_API: "object-api",
  PREVIEW: "preview",
  INTERNAL_JOB: "internal-job",
};

/**
 * 檢查是否為 Node.js 原生 Readable 流
 * @param {any} stream
 * @returns {boolean}
 */
export function isNodeReadable(stream) {
  return stream && typeof stream.pipe === "function" && typeof stream.on === "function";
}

/**
 * 檢查是否為 Web ReadableStream
 * @param {any} stream
 * @returns {boolean}
 */
export function isWebReadableStream(stream) {
  return stream && typeof stream.getReader === "function";
}
