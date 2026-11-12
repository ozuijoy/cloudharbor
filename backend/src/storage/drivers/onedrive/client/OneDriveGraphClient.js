/**
 * OneDriveGraphClient
 *
 * Microsoft Graph API 客戶端
 * - 封裝所有 Graph API 呼叫
 * - 處理路徑編碼和 API URL 構建
 * - 支援多區域（global/cn/us/de）
 *
 */

import { DriverError } from "../../../../http/errors.js";
import { readStreamInChunks } from "../../../../utils/streamBody.js";

/**
 * 區域到 Graph API 基礎 URL 的對映
 */
const GRAPH_ENDPOINTS = {
  global: "https://graph.microsoft.com/v1.0",
  cn: "https://microsoftgraph.chinacloudapi.cn/v1.0",
  us: "https://graph.microsoft.us/v1.0",
  de: "https://graph.microsoft.de/v1.0",
};

/**
 * 最大重試次數
 */
const MAX_RETRIES = 3;

export class OneDriveGraphClient {
  /**
   * @param {Object} config 客戶端配置
   * @param {string} config.region 區域（global/cn/us/de）
   * @param {Object} config.authManager 認證管理器例項
   */
  constructor(config) {
    this.region = config.region || "global";
    this.authManager = config.authManager;

    // Graph API 基礎 URL
    this.baseUrl = GRAPH_ENDPOINTS[this.region] || GRAPH_ENDPOINTS.global;

    // v1 版本使用 /me/drive 路徑模型
    this.drivePath = "/me/drive";
  }

  // ========== 目錄操作 ==========

  /**
   * 獲取 Drive 基礎資訊（含 quota）
   * - 用於讀取上游配額（quota.total/used/remaining/deleted/state）
   * @param {{ selectQuotaOnly?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async getDrive(options = {}) {
    const selectQuotaOnly = options?.selectQuotaOnly === true;
    if (selectQuotaOnly) {
      return await this._graphRequest(this.drivePath, { params: { $select: "quota" } });
    }
    return await this._graphRequest(this.drivePath);
  }

  /**
   * 列出目錄內容（單頁）
   * - 用於分頁場景：跟隨 @odata.nextLink
   *
   * @param {string} path 相對路徑（僅在 cursor 為空時使用）
   * @param {{ cursor?: string|null, limit?: number|null }} options
   * @returns {Promise<{ items: Array<any>, nextCursor: string|null }>}
   */
  async listChildrenPage(path, options = {}) {
    const cursorRaw = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
    const limitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
    const top =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(999, Math.floor(limitRaw))) : 999;

    // 1) nextLink 分頁
    if (cursorRaw) {
      const response = await this._graphRequest(cursorRaw);
      const items = Array.isArray(response?.value) ? response.value : [];
      const nextCursor = response?.["@odata.nextLink"] ? String(response["@odata.nextLink"]) : null;
      return { items, nextCursor };
    }

    // 2) 首頁：用 driveItem children 介面
    const normalized = this._normalizePath(path);
    const apiPath = normalized
      ? `${this.drivePath}/root:/${this._encodePath(normalized)}:/children`
      : `${this.drivePath}/root/children`;

    const response = await this._graphRequest(apiPath, {
      params: {
        $top: String(top),
        $orderby: "name",
      },
    });

    const items = Array.isArray(response?.value) ? response.value : [];
    const nextCursor = response?.["@odata.nextLink"] ? String(response["@odata.nextLink"]) : null;
    return { items, nextCursor };
  }

  /**
   * 列出目錄內容（全量）
   * @param {string} path 相對路徑
   * @returns {Promise<Array>} driveItem 陣列
   */
  async listChildren(path) {
    /** @type {any[]} */
    const all = [];
    let cursor = null;
    while (true) {
      const page = await this.listChildrenPage(path, { cursor, limit: 999 });
      all.push(...(Array.isArray(page?.items) ? page.items : []));
      const nextCursor = page?.nextCursor ? String(page.nextCursor) : null;
      if (!nextCursor) break;
      if (nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return all;
  }

  /**
   * 獲取單個專案資訊
   * @param {string} path 相對路徑
   * @returns {Promise<Object>} driveItem
   */
  async getItem(path) {
    const normalized = this._normalizePath(path);
    const apiPath = normalized
      ? `${this.drivePath}/root:/${this._encodePath(normalized)}`
      : `${this.drivePath}/root`;

    return await this._graphRequest(apiPath);
  }

  // ========== 檔案下載 ==========

  /**
   * 下載檔案內容
   * @param {string} path 相對路徑
   * @param {Object} options 選項
   * @returns {Promise<ReadableStream>} 檔案內容流
   */
  async downloadContent(path, options = {}) {
    const response = await this.downloadContentResponse(path, options);
    return response.body;
  }

  /**
   * 下載檔案內容（返回 Response，便於上層處理 Range / 響應頭）
   * @param {string} path 相對路徑
   * @param {{ signal?: AbortSignal, rangeHeader?: string }} options
   * @returns {Promise<Response>}
   */
  async downloadContentResponse(path, options = {}) {
    const { signal, rangeHeader } = options;
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/content`;

    const accessToken = await this.authManager.getAccessToken();
    const url = `${this.baseUrl}${apiPath}`;

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal,
      redirect: "follow",
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    return response;
  }

  // ========== 檔案上傳 ==========

  /**
   * 小檔案上傳（< 4MB）
   * @param {string} path 目標路徑
   * @param {any} content 檔案內容
   * @param {Object} options 選項
   * @returns {Promise<Object>} 建立的 driveItem
   */
  async uploadSmall(path, content, options = {}) {
    const { contentType = "application/octet-stream" } = options;
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/content`;

    const accessToken = await this.authManager.getAccessToken();
    const url = `${this.baseUrl}${apiPath}`;

    // 將內容轉換為可用於 fetch 的格式
    let body = content;
    if (content instanceof ReadableStream) {
      // 對於 ReadableStream，直接傳遞
      body = content;
    } else if (typeof content === "string") {
      body = content;
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      body = content;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body,
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    return await response.json();
  }

  /**
   * 使用上傳會話 URL 單次上傳完整檔案
   * - 適用於後端流式上傳大檔案但暫不做分片迴圈的場景
   * - 要求提供 contentLength 以構造 Content-Range 頭
   * @param {string} uploadUrl 上傳會話返回的 uploadUrl
   * @param {any} content 檔案內容（ReadableStream/Buffer/ArrayBuffer/Uint8Array/string 等）
   * @param {Object} options 選項
   * @param {number} options.contentLength 檔案總大小（位元組）
   * @param {string} [options.contentType] MIME 型別
   * @returns {Promise<Object|null>} 最終的 driveItem 資訊（若有）
   */
  async uploadSessionSingleChunk(uploadUrl, content, options = {}) {
    const { contentLength, contentType = "application/octet-stream" } = options;

    if (typeof contentLength !== "number" || !Number.isFinite(contentLength) || contentLength <= 0) {
      throw new DriverError("OneDrive uploadSessionSingleChunk 需要有效的 contentLength", {
        status: 400,
      });
    }

    // 將內容轉換為可用於 fetch 的格式（與 uploadSmall 保持一致）
    let body = content;
    if (content instanceof ReadableStream) {
      body = content;
    } else if (typeof content === "string") {
      body = content;
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      body = content;
    }

    const end = contentLength - 1;
    const headers = {
      "Content-Type": contentType,
      "Content-Range": `bytes 0-${end}/${contentLength}`,
    };

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body,
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, uploadUrl);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * 建立上傳會話（用於可恢復/直傳上傳）
   * - 基於 Graph driveItem createUploadSession 介面
   * - 返回 uploadUrl 供後續 PUT 使用
   * @param {string} path 相對路徑（包含檔名）
   * @param {Object} options 選項
   * @param {"rename"|"fail"} [options.conflictBehavior] 衝突行為
   * @returns {Promise<{ uploadUrl: string, expirationDateTime?: string|null, nextExpectedRanges?: string[]|null, raw: any }>}
   */
  async createUploadSession(path, options = {}) {
    const { conflictBehavior = "rename" } = options;

    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/createUploadSession`;

    const body = {
      item: {
        "@microsoft.graph.conflictBehavior": conflictBehavior,
      },
    };

    const response = await this._graphRequest(apiPath, {
      method: "POST",
      body,
    });

    const uploadUrl = response?.uploadUrl || response?.upload_url;
    if (!uploadUrl) {
      throw new DriverError("OneDrive createUploadSession 未返回 uploadUrl", {
        status: 500,
        details: { path: fullPath },
      });
    }

    return {
      uploadUrl,
      expirationDateTime: response.expirationDateTime || null,
      nextExpectedRanges: response.nextExpectedRanges || null,
      raw: response,
    };
  }

  /**
   * 獲取上傳會話資訊（用於斷點續傳場景）
   * - 基於 uploadSession 返回的 uploadUrl 直接請求
   * - 返回 expirationDateTime 與 nextExpectedRanges
   * @param {string} uploadUrl 上傳會話返回的 uploadUrl
   * @returns {Promise<{ expirationDateTime: string|null, nextExpectedRanges: string[]|null, raw: any }>}
   */
  /**
   * 以 uploadSession 分段上傳（後端串流 → Graph）
   * - Graph 規定單次 PUT ≤ 60 MiB，且每段大小須為 320 KiB 的整數倍（最後一段除外）
   * - 原本的 uploadSessionSingleChunk 一次 PUT 整檔，> 60MiB 必定失敗
   * - 每次只在記憶體保留一段（預設 10 MiB），Workers 128MB 記憶體上限也能跑
   * @param {string} uploadUrl
   * @param {any} content ReadableStream / Blob / Uint8Array / ArrayBuffer / string
   * @param {{ contentLength: number, chunkSize?: number, maxAttempts?: number }} options
   * @returns {Promise<Object|null>} 最終 driveItem
   */
  async uploadSessionChunked(uploadUrl, content, options = {}) {
    const { contentLength } = options;
    if (typeof contentLength !== "number" || !Number.isFinite(contentLength) || contentLength <= 0) {
      throw new DriverError("OneDrive uploadSessionChunked 需要有效的 contentLength", { status: 400 });
    }
    const UNIT = 320 * 1024;
    const requested = Number(options.chunkSize) || 10 * 1024 * 1024;
    const chunkSize = Math.max(UNIT, Math.min(60 * 1024 * 1024, Math.floor(requested / UNIT) * UNIT));
    const maxAttempts = Number(options.maxAttempts) > 0 ? Math.floor(Number(options.maxAttempts)) : 4;

    /** @type {ReadableStream<Uint8Array>} */
    let stream;
    if (content && typeof content.getReader === "function") {
      stream = content;
    } else if (typeof Blob !== "undefined" && content instanceof Blob) {
      stream = content.stream();
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array || typeof content === "string") {
      stream = new Blob([content]).stream();
    } else {
      throw new DriverError("OneDrive uploadSessionChunked 不支援的內容型別", { status: 400 });
    }

    let offset = 0;
    let lastJson = null;
    for await (const chunk of readStreamInChunks(stream, chunkSize)) {
      const start = offset;
      const end = offset + chunk.byteLength - 1;
      if (end >= contentLength) {
        throw new DriverError("OneDrive 上傳資料超過宣告的檔案大小", {
          status: 400,
          details: { contentLength, received: end + 1 },
        });
      }

      let attempt = 0;
      while (true) {
        attempt += 1;
        let response;
        try {
          response = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Length": String(chunk.byteLength),
              "Content-Range": `bytes ${start}-${end}/${contentLength}`,
            },
            body: chunk,
          });
        } catch (networkError) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** (attempt - 1))));
            continue;
          }
          throw new DriverError(`OneDrive 分段上傳網路錯誤: ${networkError?.message || networkError}`, {
            status: 502,
            cause: networkError,
          });
        }

        if (response.status === 202 || response.status === 200 || response.status === 201) {
          const text = await response.text();
          if (text) {
            try {
              lastJson = JSON.parse(text);
            } catch {
              lastJson = null;
            }
          }
          break;
        }

        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (retryable && attempt < maxAttempts) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30000, retryAfter * 1000)
            : Math.min(8000, 500 * 2 ** (attempt - 1));
          try {
            await response.text();
          } catch {}
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        await this._handleErrorResponse(response, uploadUrl);
      }

      offset = end + 1;
    }

    if (offset !== contentLength) {
      throw new DriverError("OneDrive 上傳資料不完整（請求體提前結束）", {
        status: 400,
        details: { contentLength, received: offset },
      });
    }
    return lastJson;
  }

  async getUploadSessionInfo(uploadUrl) {
    if (!uploadUrl) {
      throw new DriverError("OneDrive getUploadSessionInfo 需要有效的 uploadUrl", {
        status: 400,
      });
    }

    const response = await fetch(uploadUrl, {
      method: "GET",
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, uploadUrl);
    }

    const json = await response.json();

    return {
      expirationDateTime: json.expirationDateTime || null,
      nextExpectedRanges: json.nextExpectedRanges || null,
      raw: json,
    };
  }

  // ========== 目錄建立 ==========

  /**
   * 建立目錄
   * @param {string} path 目錄路徑
   * @returns {Promise<Object>} 建立的 driveItem
   */
  async createFolder(path) {
    const normalized = this._normalizePath(path);
    const parentPath = this._getParentPath(normalized);
    const folderName = this._getFileName(normalized);

    const apiPath = parentPath
      ? `${this.drivePath}/root:/${this._encodePath(parentPath)}:/children`
      : `${this.drivePath}/root/children`;

    return await this._graphRequest(apiPath, {
      method: "POST",
      body: {
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      },
    });
  }

  // ========== 重新命名/移動 ==========

  /**
   * 重新命名專案
   * @param {string} oldPath 原路徑
   * @param {string} newPath 新路徑
   * @returns {Promise<Object>} 更新後的 driveItem
   */
  async renameItem(oldPath, newPath) {
    const fullOldPath = this._normalizePath(oldPath);
    const fullNewPath = this._normalizePath(newPath);

    const oldParent = this._getParentPath(fullOldPath);
    const newParent = this._getParentPath(fullNewPath);
    const newName = this._getFileName(fullNewPath);

    const apiPath = `${this.drivePath}/root:/${this._encodePath(fullOldPath)}`;

    const patchBody = { name: newName };

    // 如果父目錄不同，需要移動
    if (oldParent !== newParent) {
      const parentItem = await this.getItem(newParent || "");
      patchBody.parentReference = { id: parentItem.id };
    }

    return await this._graphRequest(apiPath, {
      method: "PATCH",
      body: patchBody,
    });
  }

  // ========== 刪除 ==========

  /**
   * 刪除專案
   * @param {string} path 路徑
   */
  async deleteItem(path) {
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}`;

    await this._graphRequest(apiPath, {
      method: "DELETE",
    });
  }

  // ========== 複製 ==========

  /**
   * 複製專案
   * @param {string} sourcePath 源路徑
   * @param {string} targetPath 目標路徑
   * @returns {Promise<void>}
   */
  async copyItem(sourcePath, targetPath) {
    const fullSourcePath = this._normalizePath(sourcePath);
    const fullTargetPath = this._normalizePath(targetPath);

    const targetParent = this._getParentPath(fullTargetPath);
    const targetName = this._getFileName(fullTargetPath);

    // 獲取目標父目錄的 driveItem
    const parentItem = await this.getItem(targetParent || "");

    const apiPath = `${this.drivePath}/root:/${this._encodePath(fullSourcePath)}:/copy`;

    await this._graphRequest(apiPath, {
      method: "POST",
      body: {
        parentReference: { driveId: parentItem.parentReference?.driveId, id: parentItem.id },
        name: targetName,
      },
    });
  }

  // ========== 私有輔助方法 ==========

  /**
   * 傳送 Graph API 請求
   * @private
   */
  async _graphRequest(apiPath, options = {}) {
    const { method = "GET", body, params } = options;

    const accessToken = await this.authManager.getAccessToken();

    // 支援兩種輸入：
    // 1) 相對路徑：/me/drive/...（按 baseUrl 拼接）
    // 2) 完整 URL：用於 @odata.nextLink 分頁
    let url =
      typeof apiPath === "string" && (apiPath.startsWith("http://") || apiPath.startsWith("https://"))
        ? apiPath
        : `${this.baseUrl}${apiPath}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    // 帶重試的請求
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        // 處理 429 限流
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
          await this._sleep(retryAfter * 1000);
          continue;
        }

        // DELETE 請求成功返回 204 No Content
        if (method === "DELETE" && response.status === 204) {
          return null;
        }

        if (!response.ok) {
          await this._handleErrorResponse(response, apiPath);
        }

        // 某些請求可能返回空響應
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES - 1) {
          await this._sleep(1000 * (attempt + 1)); // 指數退避
        }
      }
    }

    throw lastError;
  }

  /**
   * 處理錯誤響應
   * @private
   */
  async _handleErrorResponse(response, context) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = {};
    }

    const errorCode = errorData.error?.code || "unknown";
    const errorMessage = errorData.error?.message || response.statusText;

    // 對映 Graph API 錯誤到 HTTP 狀態碼
    let status = response.status;
    if (errorCode === "itemNotFound") {
      status = 404;
    } else if (errorCode === "accessDenied") {
      status = 403;
    } else if (errorCode === "nameAlreadyExists") {
      status = 409;
    }

    throw new DriverError(`Graph API 錯誤: ${errorMessage}`, {
      status,
      details: { code: errorCode, context },
    });
  }

  /**
   * 規範化路徑
   * @private
   */
  _normalizePath(path) {
    if (!path) return "";
    return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  }

  /**
   * 編碼路徑用於 Graph API URL
   * @private
   */
  _encodePath(path) {
    if (!path) return "";
    // 對每個路徑段進行 URL 編碼，但保留斜槓
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  /**
   * 獲取父路徑
   * @private
   */
  _getParentPath(path) {
    if (!path) return "";
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  }

  /**
   * 獲取檔名
   * @private
   */
  _getFileName(path) {
    if (!path) return "";
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  /**
   * 延遲函式
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
