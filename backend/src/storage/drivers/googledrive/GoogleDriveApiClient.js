/**
 * GoogleDriveApiClient
 *
 * Google Drive v3 REST 客戶端
 * - 封裝 Drive v3 呼叫：列表/獲取/建立目錄/刪除/更新後設資料/分片上傳/配額查詢等
 * - 依賴 GoogleDriveAuthManager 提供的 withAccessToken，用於掛載 Authorization 並處理 401 自動重新整理
 * - 不直接依賴具體 Driver，保持職責單一
 */

import { isNodeJSEnvironment } from "../../../utils/environmentUtils.js";

export class GoogleDriveApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, errors?: any[], reason?: string, context?: any }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "GoogleDriveApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "GOOGLE_DRIVE_API_ERROR";
    this.errors = options.errors || null;
    this.reason = options.reason || null;
    this.context = options.context || null;
  }
}

const DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";

export class GoogleDriveApiClient {
  /**
   * @param {{
   *   authManager: import("./GoogleDriveAuthManager.js").GoogleDriveAuthManager,
   *   baseUrl?: string,
   *   uploadBaseUrl?: string,
   * }} options
   */
  constructor(options) {
    this.authManager = options.authManager;
    this.baseUrl = options.baseUrl || DRIVE_BASE_URL;
    this.uploadBaseUrl = options.uploadBaseUrl || DRIVE_UPLOAD_BASE_URL;
  }

  // ========== 基礎請求封裝 ==========

  /**
   * 統一 JSON 請求封裝
   * - 使用 authManager.withAccessToken 處理 Authorization 和 401 重新整理
   * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
   * @param {string} path
   * @param {{ searchParams?: Record<string,string>, body?: any, useUploadBase?: boolean, headers?: Record<string,string> }} options
   */
  async _requestJson(method, path, options = {}) {
    const { searchParams = {}, body = undefined, useUploadBase = false, headers = {} } = options;
    const base = useUploadBase ? this.uploadBaseUrl : this.baseUrl;
    const baseUrl = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : path;

    return await this.authManager.withAccessToken(async (token) => {
      const url = new URL(normalizedPath, baseUrl);
      for (const [k, v] of Object.entries(searchParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }

      const finalHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...headers,
      };

      let bodyToSend = body;
      if (body && typeof body === "object" && !(body instanceof ReadableStream) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
        // 預設 JSON
        finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
        bodyToSend = JSON.stringify(body);
      }

      const res = await fetch(url.toString(), {
        method,
        headers: finalHeaders,
        body: bodyToSend,
        redirect: "follow",
      });

      const text = await res.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }

      if (!res.ok) {
        const errPayload = json && json.error ? json.error : null;
        const message = errPayload?.message || `Google Drive API 請求失敗 (${res.status})`;
        const code = errPayload?.code || "GOOGLE_DRIVE_API_ERROR";
        const errors = errPayload?.errors || null;
        throw new GoogleDriveApiError(message, {
          status: res.status,
          code,
          errors,
          reason: errPayload?.reason,
          context: { path: url.pathname, status: res.status },
        });
      }

      return json;
    });
  }

  /**
   * 統一流式下載介面
   * - 用於 downloadFile 內容
   * @param {string} path
   * @param {{ searchParams?: Record<string,string>, signal?: AbortSignal, headers?: Record<string,string> }} options
   * @returns {Promise<ReadableStream>}
   */
  async _requestStream(path, options = {}) {
    const { searchParams = {}, signal, headers = {} } = options;
    const base = this.baseUrl;
    const baseUrl = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : path;

    return await this.authManager.withAccessToken(async (token) => {
      const url = new URL(normalizedPath, baseUrl);
      for (const [k, v] of Object.entries(searchParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...headers,
        },
        signal,
        redirect: "follow",
      });

      if (!res.ok) {
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        const errPayload = json && json.error ? json.error : null;
        const message = errPayload?.message || `Google Drive API 下載失敗 (${res.status})`;
        const code = errPayload?.code || "GOOGLE_DRIVE_API_ERROR";
        const errors = errPayload?.errors || null;
        throw new GoogleDriveApiError(message, {
          status: res.status,
          code,
          errors,
          reason: errPayload?.reason,
          context: { path: url.pathname, status: res.status },
        });
      }

      return res.body;
    });
  }

  /**
   * 統一下載介面（返回 Response，便於上層處理 Range / 響應頭）
   * @param {string} path
   * @param {{ searchParams?: Record<string,string>, signal?: AbortSignal, headers?: Record<string,string> }} options
   * @returns {Promise<Response>}
   */
  async _requestResponse(path, options = {}) {
    const { searchParams = {}, signal, headers = {} } = options;
    const base = this.baseUrl;
    const baseUrl = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : path;

    return await this.authManager.withAccessToken(async (token) => {
      const url = new URL(normalizedPath, baseUrl);
      for (const [k, v] of Object.entries(searchParams)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...headers,
        },
        signal,
        redirect: "follow",
      });

      if (!res.ok) {
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        const errPayload = json && json.error ? json.error : null;
        const message = errPayload?.message || `Google Drive API 下載失敗 (${res.status})`;
        const code = errPayload?.code || "GOOGLE_DRIVE_API_ERROR";
        const errors = errPayload?.errors || null;
        throw new GoogleDriveApiError(message, {
          status: res.status,
          code,
          errors,
          reason: errPayload?.reason,
          context: { path: url.pathname, status: res.status },
        });
      }

      return res;
    });
  }

  // ========== 高階 API：列表/獲取/目錄/刪除/更新 ==========

  /**
   * 列出目錄下檔案
   * @param {string} parentId
   * @param {{ q?: string, pageSize?: number, pageToken?: string, fields?: string }} [options]
   */
  async listFiles(parentId, options = {}) {
    const { q, pageSize, pageToken, fields } = options;
    const searchParams = {
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: pageSize ? String(pageSize) : undefined,
      pageToken: pageToken || undefined,
      fields: fields || "files(id,name,mimeType,parents,modifiedTime,size,trashed),nextPageToken",
      q:
        q ||
        (parentId
          ? `'${parentId}' in parents and trashed = false`
          : "trashed = false"),
    };

    return await this._requestJson("GET", "/files", { searchParams });
  }

  /**
   * 獲取單個檔案資訊
   * @param {string} fileId
   * @param {{ fields?: string }} [options]
   */
  async getFile(fileId, options = {}) {
    const { fields } = options;
    const searchParams = {
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields:
        fields ||
        "id,name,mimeType,parents,modifiedTime,size,trashed,webViewLink,webContentLink,iconLink,driveId",
    };
    return await this._requestJson("GET", `/files/${encodeURIComponent(fileId)}`, {
      searchParams,
    });
  }

  /**
   * 建立目錄
   * @param {string} parentId
   * @param {string} name
   */
  async createFolder(parentId, name) {
    const body = {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    };

    return await this._requestJson("POST", "/files", {
      body,
      searchParams: {
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
    });
  }

  /**
   * 刪除檔案或目錄
   * @param {string} fileId
   */
  async deleteFile(fileId) {
    await this._requestJson("DELETE", `/files/${encodeURIComponent(fileId)}`, {
      searchParams: {
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
    });
    return { success: true };
  }

  /**
   * 複製單個檔案
   * @param {string} fileId        原始檔 ID
   * @param {{ newName?: string, parentId?: string }} [options]
   */
  async copyFile(fileId, options = {}) {
    const { newName, parentId } = options;
    const body = {};
    if (newName) body.name = newName;
    if (parentId) body.parents = [parentId];

    return await this._requestJson("POST", `/files/${encodeURIComponent(fileId)}/copy`, {
      body,
      searchParams: {
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
    });
  }

  /**
   * 更新檔案後設資料（例如名稱、父目錄）
   * @param {string} fileId
   * @param {Record<string,any>} patch
   */
  async updateMetadata(fileId, patch) {
    return await this._requestJson("PATCH", `/files/${encodeURIComponent(fileId)}`, {
      body: patch,
      searchParams: {
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
    });
  }

  /**
   * 獲取配額資訊
   */
  async getQuota() {
    // about.get 介面
    const res = await this._requestJson("GET", "/about", {
      searchParams: {
        fields: "storageQuota",
      },
    });
    return res.storageQuota || null;
  }

  // ========== 下載內容 ==========

  /**
   * 下載檔案內容（返回 ReadableStream）
   * @param {string} fileId
   * @param {{ signal?: AbortSignal }} [options]
   */
  async downloadFileContent(fileId, options = {}) {
    const resp = await this.downloadFileResponse(fileId, options);
    return resp.body;
  }

  /**
   * 下載檔案內容（返回 Response，支援 Range）
   * @param {string} fileId
   * @param {{ signal?: AbortSignal, rangeHeader?: string }} [options]
   * @returns {Promise<Response>}
   */
  async downloadFileResponse(fileId, options = {}) {
    const { signal, rangeHeader } = options;
    const headers = {};
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    // alt=media 直接返回檔案內容
    return await this._requestResponse(`/files/${encodeURIComponent(fileId)}`, {
      searchParams: {
        alt: "media",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
      signal,
      headers,
    });
  }

  // ========== 分片上傳 / Resumable Upload ==========

  /**
   * 初始化 Resumable Upload 會話
   * @param {{ name: string, parents?: string[], mimeType?: string }} metadata
   * @param {{ existingFileId?: string }} [options]
   * @returns {Promise<{ uploadUrl: string, raw: any }>}
   */
  async initResumableUpload(metadata, options = {}) {
    const { existingFileId } = options;
    const searchParams = {
      uploadType: "resumable",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };

    const path = existingFileId
      ? `/files/${encodeURIComponent(existingFileId)}`
      : "/files";

    const json = await this._requestJson("POST", path, {
      useUploadBase: true,
      searchParams,
      body: metadata,
      headers: {
        "X-Upload-Content-Type": metadata.mimeType || "application/octet-stream",
      },
    });

    // 對於 resumable 初始化，Google Drive 會把 uploadUrl 放在 Location header 中；
    // 但在 fetch 封裝中我們拿不到 header，這裡採用約定：上層 Driver 負責直接呼叫 fetch 初始化會話時讀取 Location。
    // 為了保持介面完整，這裡返回 raw JSON（通常為空），真正的 uploadUrl 建議由 Driver 單獨實現。
    return {
      uploadUrl: json?.uploadUrl || null,
      raw: json,
    };
  }

  /**
   * 使用 uploadUrl 上傳一個分片
   * - 呼叫方負責控制 offset/size 與流資料
   * @param {string} uploadUrl
   * @param {number} start
   * @param {number} endInclusive
   * @param {number} totalSize
   * @param {ReadableStream|ArrayBuffer|Uint8Array|Blob} body
   * @returns {Promise<{ status: number, done: boolean, json: any }>}
   */
  async uploadChunk(uploadUrl, start, endInclusive, totalSize, body) {
    const headers = {
      "Content-Length": String(endInclusive - start + 1),
      "Content-Range": `bytes ${start}-${endInclusive}/${totalSize}`,
    };

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body,
    });

    const status = res.status;
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (status === 308) {
      // 分片未完成，繼續上傳
      return { status, done: false, json };
    }

    if (status >= 200 && status < 300) {
      // 上傳完成
      return { status, done: true, json };
    }

    const errPayload = json && json.error ? json.error : null;
    const message = errPayload?.message || `Google Drive 分片上傳失敗 (${status})`;
    const code = errPayload?.code || "GOOGLE_DRIVE_API_UPLOAD_ERROR";
    const errors = errPayload?.errors || null;
    throw new GoogleDriveApiError(message, {
      status,
      code,
      errors,
      reason: errPayload?.reason,
      context: { uploadUrl, status },
    });
  }
}
