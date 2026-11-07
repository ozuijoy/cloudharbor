/**
 * 檔案二進位制獲取服務
 * 統一處理帶認證頭的二進位制拉取（文字編碼檢測/本地解碼等場景）
 */

import { fetchApi } from "../client.js";

/**
 * 獲取檔案的二進位制資料（帶鑑權）
 * - 對 /api/ 開頭的 URL 統一透過 fetchApi 複用認證與錯誤處理
 * - 對其他 URL 使用原生 fetch，保持最小封裝
 * @param {string} url - 檔案 URL（可以是 Down 路由或直鏈）
 * @param {Object} options - 選項
 * @param {AbortSignal} [options.signal] - 取消訊號
 * @param {number} [options.timeout] - 超時時間（毫秒），僅在未提供 signal 時用於原生 fetch
 * @param {number} [options.maxSize] - 最大允許大小（位元組），超出則丟擲錯誤
 * @param {Record<string,string>} [options.headers] - 額外請求頭（例如路徑密碼 token）
 * @returns {Promise<{ buffer: ArrayBuffer, size: number }>}
 */
export async function fetchFileBinaryWithAuth(url, options = {}) {
  if (!url) {
    throw new Error("URL不能為空");
  }

  const { signal, timeout, maxSize, headers } = options;

  // 對本服務的 API 路徑統一走 fetchApi，複用認證與錯誤處理
  if (url.startsWith("/api/")) {
    const endpoint = url.slice(5);

    const blob = await fetchApi(endpoint, {
      method: "GET",
      responseType: "blob",
      signal,
      timeout,
      headers,
    });

    if (maxSize && blob.size > maxSize) {
      throw new Error(
        `檔案過大: ${Math.round(
          blob.size / 1024 / 1024,
        )}MB，超過限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
      );
    }

    const buffer = await blob.arrayBuffer();

    return {
      buffer,
      size: buffer.byteLength,
    };
  }

  // 其他 URL（直鏈或相對路徑）：保持最小封裝，按需新增超時控制
  const effectiveTimeout = timeout ?? 30000;

  let controller = null;
  let finalSignal = signal;

  if (!finalSignal) {
    controller = new AbortController();
    finalSignal = controller.signal;
    setTimeout(() => {
      if (controller) {
        controller.abort();
      }
    }, effectiveTimeout);
  }

  const response = await fetch(url, {
    method: "GET",
    signal: finalSignal,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  if (maxSize && contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error(
      `檔案過大: ${Math.round(
        parseInt(contentLength, 10) / 1024 / 1024,
      )}MB，超過限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
    );
  }

  const buffer = await response.arrayBuffer();

  if (maxSize && buffer.byteLength > maxSize) {
    throw new Error(
      `檔案過大: ${Math.round(
        buffer.byteLength / 1024 / 1024,
      )}MB，超過限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
    );
  }

  return {
    buffer,
    size: buffer.byteLength,
  };
}
