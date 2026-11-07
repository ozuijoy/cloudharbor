/**
 * StorageStreaming 工具函式
 * - Range 解析
 * - 條件請求評估
 * - 響應頭構造
 * - 錯誤對映
 */

import { ApiStatus } from "../../constants/index.js";

/**
 * 解析 HTTP Range 頭
 * @param {string | null} rangeHeader - Range 頭值（如 "bytes=0-1023"）
 * @param {number | null} fileSize - 檔案總大小（可為 null，此時無法計算字尾範圍和滿足性）
 * @returns {{ start: number, end: number, isValid: boolean, isSatisfiable: boolean, unknownSize?: boolean } | null}
 */
export function parseRangeHeader(rangeHeader, fileSize) {
  // 沒有 Range 頭，返回 null
  if (!rangeHeader) {
    return null;
  }

  // 說明：當前函式只解析 single-range（例如 bytes=0-1023 / bytes=500- / bytes=-500）。
  // multi-range（例如 bytes=0-99,200-299）由上層（StorageStreaming）單獨處理。
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return { start: 0, end: 0, isValid: false, isSatisfiable: false };
  }

  const [, startStr, endStr] = match;
  let start, end;

  // 檔案大小未知的情況（WebDAV HEAD 可能不返回 Content-Length）
  const sizeUnknown = fileSize === null || fileSize <= 0;

  if (startStr === "" && endStr !== "") {
    // 字尾範圍：bytes=-500 表示最後 500 位元組
    // 需要知道檔案大小才能計算
    if (sizeUnknown) {
      // 無法計算字尾範圍，但語法有效
      return { start: 0, end: 0, isValid: true, isSatisfiable: false, unknownSize: true };
    }
    const suffixLength = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // 開放範圍：bytes=500- 表示從 500 到末尾
    start = parseInt(startStr, 10);
    if (sizeUnknown) {
      // 檔案大小未知，無法確定 end，但可以嘗試請求
      // 標記為 unknownSize，讓上層決定如何處理
      return { start, end: Infinity, isValid: true, isSatisfiable: true, unknownSize: true };
    }
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    // 完整範圍：bytes=0-1023
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (!sizeUnknown) {
      end = Math.min(end, fileSize - 1);
    }
  } else {
    return { start: 0, end: 0, isValid: false, isSatisfiable: false };
  }

  // 基本語法檢查
  if (start > end && end !== Infinity) {
    return { start, end, isValid: true, isSatisfiable: false, unknownSize: sizeUnknown };
  }

  // 如果知道檔案大小，檢查範圍是否可滿足
  if (!sizeUnknown && start >= fileSize) {
    return { start, end, isValid: true, isSatisfiable: false };
  }

  return { start, end, isValid: true, isSatisfiable: true, unknownSize: sizeUnknown };
}

/**
 * 解析 HTTP Multi-Range（多段 Range）頭
 * - 僅支援 bytes=... 形式
 * - 需要 fileSize 已知（否則無法計算字尾範圍/滿足性）
 *
 * @param {string|null} rangeHeader
 * @param {number|null} fileSize
 * @returns {{ ranges: Array<{ start: number, end: number }>, isValid: boolean, hasNoOverlap: boolean } | null}
 */
export function parseMultiRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  if (!String(rangeHeader).startsWith("bytes=")) return { ranges: [], isValid: false, hasNoOverlap: false };

  const sizeUnknown = fileSize === null || fileSize <= 0;
  if (sizeUnknown) {
    // size 未知無法可靠解析 multi-range（尤其是 suffix-range）
    return { ranges: [], isValid: true, hasNoOverlap: false };
  }

  const spec = String(rangeHeader).slice("bytes=".length);
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { ranges: [], isValid: false, hasNoOverlap: false };
  }

  /** @type {Array<{start:number,end:number}>} */
  const ranges = [];
  let noOverlap = false;

  for (const part of parts) {
    const [startRaw, endRaw, extra] = part.split("-");
    if (extra !== undefined) {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }
    const startStr = (startRaw ?? "").trim();
    const endStr = (endRaw ?? "").trim();
    if (startStr === "" && endStr === "") {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }

    // suffix-range: bytes=-500
    if (startStr === "") {
      if (endStr.startsWith("-")) return { ranges: [], isValid: false, hasNoOverlap: false };
      const suffixLength = parseInt(endStr, 10);
      if (!Number.isFinite(suffixLength) || suffixLength < 0) {
        return { ranges: [], isValid: false, hasNoOverlap: false };
      }
      const n = Math.min(suffixLength, fileSize);
      const start = Math.max(0, fileSize - n);
      const end = fileSize - 1;
      ranges.push({ start, end });
      continue;
    }

    // start-end or start-
    const start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }
    if (start >= fileSize) {
      noOverlap = true;
      continue;
    }

    let end;
    if (endStr === "") {
      end = fileSize - 1;
    } else {
      end = parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) {
        return { ranges: [], isValid: false, hasNoOverlap: false };
      }
      end = Math.min(end, fileSize - 1);
    }

    ranges.push({ start, end });
  }

  return { ranges, isValid: true, hasNoOverlap: noOverlap && ranges.length === 0 };
}

/**
 * If-Range 語義：
 * - 若 If-Range 與當前資源的 ETag/Last-Modified 不匹配 → 必須忽略 Range（返回 200 全量），避免客戶端拼接錯亂/破圖。
 * - 若匹配 → 才允許繼續按 Range 返回 206。
 *
 * @param {Request|null} request
 * @param {string|null} etag
 * @param {Date|null} lastModified
 * @returns {boolean} true 表示應忽略 Range
 */
export function shouldIgnoreRangeForIfRange(request, etag, lastModified) {
  if (!request) return false;
  const ifRange = request.headers?.get?.("if-range");
  if (!ifRange) return false;

  // 1) ETag 形式（W/"..." 或 "..."）
  const trimmed = String(ifRange).trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("W/\"")) {
    if (!etag) return true;
    const a = String(etag).trim().replace(/^W\//, "");
    const b = trimmed.replace(/^W\//, "");
    return a !== b;
  }

  // 2) HTTP-date 形式
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) {
    // 無法解析，保守處理：忽略 Range
    return true;
  }
  if (!lastModified) return true;
  // 資源最後修改時間 <= If-Range 時間 → 認為未變化，允許 Range；否則忽略 Range
  return lastModified > date;
}

/**
 * 評估條件請求頭
 * @param {Request | null} request - HTTP 請求
 * @param {string | null} etag - 資源 ETag
 * @param {Date | null} lastModified - 資源最後修改時間
 * @returns {{ shouldReturn304: boolean, shouldReturn412: boolean }}
 */
export function evaluateConditionalHeaders(request, etag, lastModified) {
  if (!request) {
    return { shouldReturn304: false, shouldReturn412: false };
  }

  const ifNoneMatch = request.headers?.get?.("if-none-match");
  const ifMatch = request.headers?.get?.("if-match");
  const ifModifiedSince = request.headers?.get?.("if-modified-since");
  const ifUnmodifiedSince = request.headers?.get?.("if-unmodified-since");

  // If-None-Match: 如果 ETag 匹配，返回 304
  if (ifNoneMatch && etag) {
    const tags = ifNoneMatch.split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (tags.includes("*") || tags.includes(etag.replace(/^W\//, ""))) {
      return { shouldReturn304: true, shouldReturn412: false };
    }
  }

  // If-Match: 如果 ETag 不匹配，返回 412
  if (ifMatch && etag) {
    const tags = ifMatch.split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (!tags.includes("*") && !tags.includes(etag.replace(/^W\//, ""))) {
      return { shouldReturn304: false, shouldReturn412: true };
    }
  }

  // If-Modified-Since: 如果未修改，返回 304
  if (ifModifiedSince && lastModified) {
    const ifModifiedDate = new Date(ifModifiedSince);
    if (!isNaN(ifModifiedDate.getTime()) && lastModified <= ifModifiedDate) {
      return { shouldReturn304: true, shouldReturn412: false };
    }
  }

  // If-Unmodified-Since: 如果已修改，返回 412
  if (ifUnmodifiedSince && lastModified) {
    const ifUnmodifiedDate = new Date(ifUnmodifiedSince);
    if (!isNaN(ifUnmodifiedDate.getTime()) && lastModified > ifUnmodifiedDate) {
      return { shouldReturn304: false, shouldReturn412: true };
    }
  }

  return { shouldReturn304: false, shouldReturn412: false };
}

/**
 * 構建響應頭
 * @param {import('./types.js').StorageStreamDescriptor} descriptor - 流描述物件
 * @param {{ start: number, end: number } | null} range - 範圍（如果是 206 響應）
 * @param {import('./types.js').StreamingChannel} channel - 訪問通道
 * @returns {Headers}
 */
export function buildResponseHeaders(descriptor, range, channel) {
  const headers = new Headers();

  // Content-Type
  if (descriptor.contentType) {
    headers.set("Content-Type", descriptor.contentType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }

  // Content-Length
  if (range && descriptor.size !== null) {
    const contentLength = range.end - range.start + 1;
    headers.set("Content-Length", String(contentLength));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${descriptor.size}`);
  } else if (descriptor.size !== null) {
    headers.set("Content-Length", String(descriptor.size));
  }

  // Accept-Ranges
  headers.set("Accept-Ranges", "bytes");

  // ETag
  if (descriptor.etag) {
    headers.set("ETag", descriptor.etag);
  }

  // Last-Modified
  if (descriptor.lastModified) {
    headers.set("Last-Modified", descriptor.lastModified.toUTCString());
  }

  // Cache-Control（按 channel 設定）
  switch (channel) {
    case "fs-web":
    case "webdav":
      headers.set("Cache-Control", "private, no-cache");
      break;
    case "proxy":
    case "share":
      headers.set("Cache-Control", "public, max-age=3600");
      break;
    default:
      // internal channels: no cache headers
      break;
  }

  return headers;
}

/**
 * 將驅動錯誤對映到 HTTP 狀態碼
 * @param {Error} error - 驅動錯誤
 * @returns {{ status: number, message: string }}
 */
export function mapDriverErrorToHttpStatus(error) {
  // 某些驅動錯誤的 code 可能不是字串（例如物件/數字），這裡統一轉為字串避免執行時報錯
  const rawCode = error?.code;
  const code = typeof rawCode === "string" ? rawCode : String(rawCode ?? "");
  const status = error?.status || ApiStatus.INTERNAL_ERROR;

  if (code.includes("NOT_FOUND") || status === ApiStatus.NOT_FOUND) {
    return { status: ApiStatus.NOT_FOUND, message: "檔案不存在" };
  }

  if (code.includes("FORBIDDEN") || status === ApiStatus.FORBIDDEN) {
    return { status: ApiStatus.FORBIDDEN, message: "訪問被拒絕" };
  }

  if (code.includes("STREAM_CLOSED")) {
    return { status: ApiStatus.INTERNAL_ERROR, message: "流已關閉" };
  }

  return { status: ApiStatus.INTERNAL_ERROR, message: error?.message || "內部錯誤" };
}
