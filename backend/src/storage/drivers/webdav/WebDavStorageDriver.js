/**
 * WebDAV 儲存驅動
 * 預設支援 Reader/Writer/Proxy/Atomic 能力，不提供儲存直鏈（DirectLink）
 */

import { buildUploadFetchInit } from "../../../utils/streamBody.js";
import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
/**
 * 模組說明：
 * - 作用：WebDAV 驅動，負責目錄/檔案的讀寫、重新命名/複製、搜尋、代理 URL 生成等。
 * - 能力：宣告 READER/WRITER/ATOMIC/PROXY/SEARCH，供 FS/features 按能力路由。
 * - 約定：路徑規範化與錯誤對映封裝在 _normalize/_buildDavPath/_wrapError 中，外層無需關心 webdav 客戶端細節。
 */
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus, FILE_TYPES } from "../../../constants/index.js";
import { DriverError, NotFoundError, AppError } from "../../../http/errors.js";
import { decryptValue } from "../../../utils/crypto.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { createClient } from "webdav";
import { Buffer } from "buffer";
import https from "https";
import { updateUploadProgress, completeUploadProgress } from "../../utils/UploadProgressTracker.js";
import { isNodeJSEnvironment } from "../../../utils/environmentUtils.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";

export class WebDavStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "WEBDAV";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY];
    this.client = null;
    this.defaultFolder = config.default_folder || "";
    this.endpoint = config.endpoint_url || "";
    this.username = config.username || "";
    this.passwordEncrypted = config.password || "";
    this.urlProxy = config.url_proxy || null;
    this.tlsSkipVerify = config?.tls_insecure_skip_verify === 1;
    this.enableDiskUsage = config?.enable_disk_usage === 1;
  }

  /**
   * 規範化 WebDAV endpoint_url：
   * - 必須是合法 http(s) URL
   * - pathname 確保以 / 結尾，避免某些 URL join 規則把最後一段當成“檔名”導致拼接錯誤
   * @param {unknown} value
   * @returns {string}
   */
  _normalizeClientEndpointUrl(value) {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) return "";
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new DriverError("WebDAV endpoint_url 不是合法的 URL", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DriverError("WebDAV endpoint_url 必須以 http:// 或 https:// 開頭", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  }

  /**
   * 初始化 WebDAV 客戶端
   */
  async initialize() {
    try {
      const password = await decryptValue(this.passwordEncrypted, this.encryptionSecret);
      if (!password) {
        throw new DriverError("WebDAV 憑據不可用", { status: ApiStatus.FORBIDDEN });
      }
      const endpointForClient = this._normalizeClientEndpointUrl(this.endpoint);
      if (!endpointForClient) {
        throw new DriverError("WebDAV 配置缺少 endpoint_url", { status: ApiStatus.BAD_REQUEST, expose: true });
      }

      const agent =
        endpointForClient.startsWith("https://") && this.tlsSkipVerify ? new https.Agent({ rejectUnauthorized: false }) : undefined;
      const clientOptions = agent ? { httpsAgent: agent } : {};
      this.client = createClient(endpointForClient, {
        username: this.username,
        password,
        ...clientOptions,
      });
      this.initialized = true;
      this.decryptedPassword = password;
      console.log(`WebDAV 驅動初始化完成: ${endpointForClient}`);
    } catch (error) {
      console.error("WebDAV 驅動初始化失敗", error);
      throw this._wrapError(error, "WebDAV 驅動初始化失敗", ApiStatus.INTERNAL_ERROR);
    }
  }

  /**
   * 目錄列表
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, refresh = false, db } = ctx;
    const davPath = this._buildDavPath(subPath, true);
    try {
      const entries = await this.client.getDirectoryContents(davPath, { deep: false, glob: "*" });
      const basePath = path;
      const items = await Promise.all(
        entries.map(async (item) => {
          const isDirectory = item.type === "directory";
          const rawName = item.basename || this._basename(item.filename);
          const name = this._decodeComponent(rawName);
          const mountPath = this._joinMountPath(basePath, name, isDirectory);

          // 無 MIME 時根據檔名推斷
          const rawMime = item.mime || null;
          let mimetype = null;
          if (isDirectory) {
            mimetype = "application/x-directory";
          } else if (rawMime && rawMime !== "httpd/unix-directory") {
            mimetype = rawMime;
          } else {
            // WebDAV 伺服器未返回有效 MIME，根據檔名推斷
            mimetype = getMimeTypeFromFilename(name);
          }

          let size = null;
          let modifiedDate = null;

          if (isDirectory) {
            // 目錄：大小通常無法直接給出；modified 只有上游提供時才使用，否則為 null（顯示 “-”）
            size = null;
            if (item.lastmod) {
              modifiedDate = new Date(item.lastmod);
            }
          } else {
            // 預設使用目錄列表中的 size
            size = typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : null;
            if (item.lastmod) {
              modifiedDate = new Date(item.lastmod);
            }

            // 部分 WebDAV 服務在目錄列表中返回錯誤 size（如恆為 2），
            // 僅在明顯異常時再發起一次 stat 精準獲取大小，避免每個檔案都額外請求。
            if (!Number.isFinite(size) || size <= 2) {
              try {
                const rel = subPath
                  ? `${subPath.replace(/^\\\\\+/, "")}/${rawName}`
                  : rawName;
                const fileDavPath = this._buildDavPath(rel, false);
                const stat = await this.client.stat(fileDavPath);
                if (stat && typeof stat.size === "number" && stat.size >= 0) {
                  size = stat.size;
                }
                if (stat?.lastmod) {
                  modifiedDate = new Date(stat.lastmod);
                }
              } catch {
                // stat 失敗時保持原始 size，交由上層決定如何展示
              }
            }
          }

          const info = await buildFileInfo({
            fsPath: mountPath,
            name,
            isDirectory,
            size,
            modified: modifiedDate,
            mimetype,
            mount,
            storageType: mount?.storage_type,
            db,
          });

          return {
            ...info,
            isVirtual: false,
          };
        })
      );

      return {
        path,
        type: "directory",
        isRoot: subPath === "" || subPath === "/",
        isVirtual: false,
        mount_id: mount?.id,
        storage_type: mount?.storage_type,
        items,
      };
    } catch (error) {
      throw this._wrapError(error, "列出目錄失敗", this._statusFromError(error));
    }
  }

  /**
   * 檔案資訊
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, db, request = null, userType = null, userId = null } = ctx;
    const davPath = this._buildDavPath(subPath, false);
    try {
      const stat = await this.client.stat(davPath);
      const isDirectory = stat.type === "directory";
      const name = this._decodeComponent(this._basename(path));
      const rawMime = stat.mime || null;
      // 處理 WebDAV 常見的錯誤 MIME 型別，並在無 MIME 時根據檔名推斷
      let effectiveMime = null;
      if (isDirectory) {
        effectiveMime = "application/x-directory";
      } else if (rawMime && rawMime !== "httpd/unix-directory") {
        effectiveMime = rawMime;
      } else {
        // WebDAV 伺服器未返回有效 MIME，根據檔名推斷
        effectiveMime = getMimeTypeFromFilename(name);
      }

      const size =
        isDirectory ? null : typeof stat.size === "number" && Number.isFinite(stat.size) && stat.size >= 0 ? stat.size : null;
      const modifiedDate = stat.lastmod ? new Date(stat.lastmod) : null;

      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory,
        size,
        modified: modifiedDate,
        mimetype: effectiveMime,
        mount,
        storageType: mount?.storage_type,
        db,
      });

      return {
        ...info,
        etag: stat.etag || undefined,
      };
    } catch (error) {
      if (this._isNotFound(error)) {
        throw new NotFoundError("檔案不存在");
      }
      throw this._wrapError(error, "獲取檔案資訊失敗", this._statusFromError(error));
    }
  }

  /**
   * 下載檔案（返回 StorageStreamDescriptor）
   * @param {string} subPath - 掛載內子路徑
   * @param {Object} ctx - 上下文（path/mount/subPath 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>} 流描述物件
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const davPath = this._buildDavPath(subPath, false);
    const url = this._buildRequestUrl(davPath);

    // 先獲取檔案後設資料（HEAD 請求）
    let metadata;
    try {
      const headResp = await fetch(url, {
        method: "HEAD",
        headers: { Authorization: this._basicAuthHeader() },
      });
      if (!headResp.ok) {
        if (headResp.status === 404) {
          throw new NotFoundError("檔案不存在");
        }
        throw this._wrapError(new Error(`HTTP ${headResp.status}`), "獲取檔案後設資料失敗", headResp.status);
      }
        metadata = {
          contentType: headResp.headers.get("content-type") || "application/octet-stream",
          contentLength: headResp.headers.get("content-length"),
          etag: headResp.headers.get("etag"),
          lastModified: headResp.headers.get("last-modified"),
        };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this._wrapError(error, "獲取檔案後設資料失敗", this._statusFromError(error));
    }

    // 優先使用 HEAD 的 Content-Length；部分 WebDAV 服務不會返回該頭，需降級為 stat
    let size = metadata.contentLength ? parseInt(metadata.contentLength, 10) : null;
    let contentType = metadata.contentType;
    let etag = metadata.etag || null;
    let lastModified = metadata.lastModified ? new Date(metadata.lastModified) : null;

    // 當 HEAD 未返回 Content-Length 或返回值明顯異常時，嘗試透過 WebDAV stat 精準獲取檔案大小
    if (size === null || !Number.isFinite(size) || size <= 0) {
      try {
        const stat = await this.client.stat(davPath);

        if (stat && typeof stat.size === "number" && stat.size >= 0) {
          size = stat.size;
        }

        // 僅在 HEAD 未提供對應後設資料時，使用 stat 結果進行補全，避免覆蓋上游更準確的 HTTP 頭資訊
        if (!contentType) {
          const rawMime = stat.mime || null;
          if (rawMime && rawMime !== "httpd/unix-directory") {
            contentType = rawMime;
          }
        }
        if (!etag && stat.etag) {
          etag = stat.etag;
        }
        if (!lastModified && stat.lastmod) {
          lastModified = new Date(stat.lastmod);
        }
      } catch (error) {
        // stat 404 統一視為檔案不存在，其餘錯誤僅記錄，保持 HEAD 資訊，由上層決定是否降級為 200
        if (this._isNotFound(error)) {
          throw new NotFoundError("檔案不存在");
        }
      }
    }

    // 儲存 url 和 auth 供閉包使用
    const fileUrl = url;
    const authHeader = this._basicAuthHeader();
    const wrapError = this._wrapError.bind(this);
    const statusFromError = this._statusFromError.bind(this);
    // 僅對 Range 請求顯式關閉快取
    const workerNoCacheOptionsForRange = typeof caches !== "undefined" ? { cf: { cacheEverything: false } } : {};

    const descriptor = createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      async fetchResponse(signal) {
        const resp = await fetch(fileUrl, {
          headers: { Authorization: authHeader },
          signal,
        });
        if (!resp.ok) {
          if (resp.status === 404) {
            throw new NotFoundError("檔案不存在");
          }
          throw wrapError(new Error(`HTTP ${resp.status}`), "下載失敗", resp.status);
        }
        return resp;
      },
      async fetchRangeResponse(signal, rangeHeader) {
        const resp = await fetch(fileUrl, {
          headers: {
            Authorization: authHeader,
            Range: rangeHeader,
            "Accept-Encoding": "identity",
            "Cache-Control": "no-store, no-transform",
            Pragma: "no-cache",
          },
          signal,
          cache: "no-store",
          ...workerNoCacheOptionsForRange,
        });
        if (!resp.ok) {
          if (resp.status === 404) {
            throw new NotFoundError("檔案不存在");
          }
          throw wrapError(new Error(`HTTP ${resp.status}`), "下載失敗", resp.status);
        }
        return resp;
      },
      async fetchHeadResponse(signal) {
        const resp = await fetch(fileUrl, {
          method: "HEAD",
          headers: { Authorization: authHeader },
          signal,
        });
        if (!resp.ok) {
          if (resp.status === 404) {
            throw new NotFoundError("檔案不存在");
          }
          throw wrapError(new Error(`HTTP ${resp.status}`), "獲取檔案後設資料失敗", resp.status);
        }
        return resp;
      },
    });

    // WebDAV 場景（尤其是 Cloudflare -> Cloudflare）裡，Range 經常被上游/平臺忽略，
    // 軟體切片會導致“看似 206 但一直載入/黑屏”。
    // 因此：WebDAV 若上游不支援 Range，就直接降級為 200 全量響應。
    descriptor.rangeFallbackPolicy = "full";

    return descriptor;
  }

  /**
   * 統一上傳入口（檔案 / 流）
   * - 外部統一呼叫此方法，內部根據資料型別選擇流式或表單實現
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    if (isWebStream) {
      // WebDAV 協議入口等場景：優先走真正的流式上傳
      return await this.uploadStream(subPath, fileOrStream, ctx);
    }

    // 其它場景統一視為“表單/一次性上傳”（讀取到 Buffer 再寫入）
    return await this.uploadForm(subPath, fileOrStream, ctx);
  }

  /**
   * 內部流式上傳實現（主要用於 Web ReadableStream）
   */
  async uploadStream(subPath, stream, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const davPath = this._resolveTargetDavPath(subPath, path, stream, ctx);
    const url = this._buildRequestUrl(davPath);
    const headers = {};
    const contentType = ctx.contentType || null;
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    headers["Authorization"] = this._basicAuthHeader();

    // 為流式上傳新增簡單的進度統計（僅在 Web ReadableStream 環境下生效）
    /** @type {ReadableStream<any>} */
    let body = stream;
    try {
      const hasGetReader = stream && typeof stream.getReader === "function";
      if (hasGetReader) {
        const total = ctx.contentLength || ctx.fileSize || null;
        const reader = stream.getReader();
        let loaded = 0;
        let lastLogged = 0;
        const LOG_INTERVAL = 50 * 1024 * 1024; // 每 50MB 列印一次，避免刷屏

        const progressId = ctx.uploadId || davPath;

        body = new ReadableStream({
          async pull(controller) {
            const { done, value } = await reader.read();
              if (done) {
                controller.close();
                // 結束時再列印一次總進度
                if (loaded > 0 && total) {
                  const percentage = ((loaded / total) * 100).toFixed(1);
                  console.log(
                    `[StorageUpload] type=WEBDAV mode=STREAM event=completed loaded=${loaded} total=${total} percent=${percentage} path=${davPath}`
                  );
                }
                try {
                  completeUploadProgress(progressId);
                } catch {}
                return;
              }

            const chunkSize = value?.byteLength ?? value?.length ?? 0;
            loaded += chunkSize;

            const shouldLog =
              total != null
                ? loaded === total || loaded - lastLogged >= LOG_INTERVAL
                : loaded - lastLogged >= LOG_INTERVAL;

              if (shouldLog) {
                const percentage = total ? ((loaded / total) * 100).toFixed(1) : "未知";
                const totalLabel = total ?? "未知";
                console.log(
                  `[StorageUpload] type=WEBDAV mode=流式上傳 status=進度 已傳=${loaded} 總=${totalLabel} 進度=${percentage}% 路徑=${davPath}`
                );
                lastLogged = loaded;
              }

            try {
              updateUploadProgress(progressId, {
                loaded,
                total,
                path: davPath,
                storageType: "WEBDAV",
              });
            } catch {}

            controller.enqueue(value);
          },
          cancel(reason) {
            try {
              reader.cancel(reason);
            } catch {
              // 取消失敗時靜默忽略
            }
          },
        });
      }
    } catch {
      // 若包裝失敗，退回原始 stream，避免影響主流程
      body = stream;
    }

    try {
      await this._ensureParentDirectories(davPath);
      /** @type {RequestInit} */
      const knownLength = Number(ctx.contentLength || ctx.fileSize || 0);
      const hasKnownLength = Number.isFinite(knownLength) && knownLength > 0;
      if (hasKnownLength) {
        // 許多 WebDAV 服務（堅果雲、部分 nginx/Apache 設定、Alist 等）不接受 chunked PUT，
        // 明確給出長度；Workers 上會改用 FixedLengthStream 讓長度真正生效
        headers["Content-Length"] = String(knownLength);
      }
      /** @type {RequestInit} */
      const init = buildUploadFetchInit(
        {
          method: "PUT",
          headers,
          body,
        },
        { contentLength: hasKnownLength ? knownLength : null },
      );
      const resp = await fetch(url, init);
      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        throw this._wrapError(new Error(`HTTP ${resp.status}`), "上傳檔案失敗", resp.status);
      }
      console.log(
        `[StorageUpload] type=WEBDAV mode=流式上傳 status=成功 路徑=${davPath}`
      );
      return { success: true, storagePath: davPath, message: "WEBDAV_STREAM_UPLOAD" };
    } catch (error) {
      throw this._wrapError(error, "上傳檔案失敗", this._statusFromError(error));
    }
  }

  /**
   * 內部表單上傳實現（一次性緩衝，適用於 Buffer / Uint8Array / ArrayBuffer / File / Blob / string 等）
   */
  async uploadForm(subPath, fileOrData, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const davPath = this._resolveTargetDavPath(subPath, path, fileOrData, ctx);
    const { body, length, contentType } = await this._normalizeBody(fileOrData, ctx);

    try {
      await this._ensureParentDirectories(davPath);
      await this.client.putFileContents(davPath, body, {
        overwrite: true,
        contentLength: length,
        contentType,
      });
      console.log(
        `[StorageUpload] type=WEBDAV mode=表單上傳 status=成功 路徑=${davPath} 大小=${length}`
      );

      return { success: true, storagePath: davPath, message: "WEBDAV_FORM_UPLOAD" };
    } catch (error) {
      throw this._wrapError(error, "上傳檔案失敗", this._statusFromError(error));
    }
  }

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const davPath = this._buildDavPath(subPath, true);
    try {
      await this.client.createDirectory(davPath);
    } catch (error) {
      const status = this._statusFromError(error);
      // 部分 WebDAV 服務對已存在目錄或根目錄返回 405/501，視為目錄已存在即可
      if (this._isConflict(error) || status === ApiStatus.NOT_IMPLEMENTED) {
        // 返回 FS 檢視路徑（契約）：path 欄位必須等於輸入引數
        return { success: true, path, alreadyExists: true };
      }
      throw this._wrapError(error, "建立目錄失敗", status);
    }
    // 返回 FS 檢視路徑（契約）：path 欄位必須等於輸入引數
    return { success: true, path };
  }

  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) {
      throw new DriverError("WebDAV 更新檔案缺少 path 上下文（ctx.path）", {
        status: ApiStatus.INTERNAL_ERROR,
        expose: false,
        details: { subPath },
      });
    }

    const result = await this.uploadFile(subPath, content, ctx);
    return {
      success: !!result?.success,
      path: fsPath,
      message: result?.message,
    };
  }

  /**
   * 獲取儲存驅動統計資訊
   * @returns {Promise<Object>} 統計資訊
   */
  async getStats() {
    this._ensureInitialized();
    const base = {
      type: this.type,
      endpoint: this.endpoint,
      defaultFolder: this.defaultFolder || "/",
      capabilities: this.capabilities,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "WebDAV 磁碟佔用統計未啟用（enable_disk_usage = false）",
      };
    }

    // WebDAV 配額（quota）讀取：RFC 4331 定義 quota-used-bytes / quota-available-bytes
    // 注意：並非所有 WebDAV 服務都支援；因此失敗時返回 supported=false，不拋異常
    try {
      const basePath = this._buildDavPath("", true);
      let quotaRes;
      try {
        quotaRes = this.client.getQuota.length >= 1 ? await this.client.getQuota(basePath) : await this.client.getQuota();
      } catch {
        quotaRes = await this.client.getQuota();
      }

      const quotaData = quotaRes && typeof quotaRes === "object" && "data" in quotaRes ? quotaRes.data : quotaRes;
      const used = quotaData && typeof quotaData === "object" && typeof quotaData.used === "number" ? quotaData.used : null;
      const available = quotaData && typeof quotaData === "object" && typeof quotaData.available === "number" ? quotaData.available : null;

      if (used == null && available == null) {
        return {
          ...base,
          supported: false,
          message: "WebDAV 伺服器未提供配額資訊（可能不支援 RFC 4331 quota 屬性）",
        };
      }

      const totalBytes = used != null && available != null ? used + available : null;
      const usedBytes = used != null ? used : null;
      const remainingBytes = available != null ? available : null;

      let usagePercent = null;
      if (totalBytes && usedBytes != null && totalBytes > 0) {
        usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
      }

      return {
        ...base,
        supported: true,
        quota: {
          raw: quotaData || null,
          totalBytes,
          usedBytes,
          remainingBytes,
          usagePercent,
        },
      };
    } catch (error) {
      return {
        ...base,
        supported: false,
        message: error?.message || String(error),
      };
    }
  }

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    const { oldPath, newPath } = ctx;
    const isDir = typeof oldSubPath === "string" && oldSubPath.endsWith("/");
    const from = this._buildDavPath(oldSubPath, isDir);
    const to = this._buildDavPath(newSubPath, isDir);
    try {
      await this.client.moveFile(from, to, { overwrite: false });
      return { success: true, source: oldPath, target: newPath };
    } catch (error) {
      if (this._isNotSupported(error)) {
        throw new DriverError("WebDAV 不支援移動操作", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
      }
      throw this._wrapError(error, "重新命名失敗", this._statusFromError(error));
    }
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    const { sourcePath, targetPath, skipExisting = false, _skipExistingChecked = false } = ctx;
    const isDir = typeof sourceSubPath === "string" && sourceSubPath.endsWith("/");
    const from = this._buildDavPath(sourceSubPath, isDir);
    const to = this._buildDavPath(targetSubPath, isDir);

    // skipExisting 檢查：在複製前檢查目標檔案是否已存在
    // 如果入口層已檢查（_skipExistingChecked=true），跳過重複檢查
    if (skipExisting && !_skipExistingChecked) {
      try {
        const targetExists = await this.client.exists(to);
        if (targetExists) {
          return {
            status: "skipped",
            skipped: true,
            reason: "target_exists",
            source: sourcePath,
            target: targetPath,
            contentLength: 0,
          };
        }
      } catch (checkError) {
        // exists 檢查失敗時繼續複製（降級處理）
        console.warn(`[WebDAV copyItem] skipExisting 檢查失敗 for ${to}:`, checkError?.message || checkError);
      }
    }

    try {
      const overwrite = !skipExisting;
      await this.client.copyFile(from, to, { overwrite });
      return { status: "success", source: sourcePath, target: targetPath };
    } catch (error) {
      if (this._isNotSupported(error)) {
        throw new DriverError("WebDAV 不支援複製操作", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
      }
      throw this._wrapError(error, "複製失敗", this._statusFromError(error));
    }
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    const results = [];
    const paths = Array.isArray(ctx?.paths) ? ctx.paths : null;
    for (let i = 0; i < (Array.isArray(subPaths) ? subPaths.length : 0); i++) {
      const sub = subPaths[i];
      const p = Array.isArray(paths) ? paths[i] : sub;
      const isDir = typeof sub === "string" && sub.endsWith("/");
      const davPath = this._buildDavPath(sub, isDir);
      try {
        await this.client.deleteFile(davPath);
        results.push({ path: p, success: true });
      } catch (error) {
        results.push({ path: p, success: false, error: error?.message || "刪除失敗" });
      }
    }
    return {
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success),
      results,
    };
  }

  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    const isDir = typeof subPath === "string" && subPath.endsWith("/");
    const davPath = this._buildDavPath(subPath, isDir);
    try {
      return await this.client.exists(davPath);
    } catch {
      return false;
    }
  }

  async stat(subPath, ctx = {}) {
    const isDir = typeof subPath === "string" && subPath.endsWith("/");
    return await this.client.stat(this._buildDavPath(subPath, isDir));
  }

  async generatePresignedUrl() {
    throw new DriverError("WebDAV 不支援預簽名直鏈", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
  }

  /**
   * WebDAV 不提供儲存直鏈能力（DirectLink），所有直鏈/代理決策由上層透過 url_proxy 或 native_proxy 處理。
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new DriverError("WebDAV 不支援儲存直鏈 URL", {
      status: ApiStatus.NOT_IMPLEMENTED,
      expose: true,
    });
  }

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;

    // 驅動層僅負責根據路徑構造基礎代理URL，不再做簽名與策略判斷
    const proxyUrl = buildFullProxyUrl(request, fsPath, download);

    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * 上游 HTTP 能力：為 WebDAV 生成可由反向代理/Worker 直接訪問的上游請求資訊
   * - 返回值僅描述 data plane 訪問方式，不做許可權與簽名判斷
   * - headers 中只包含訪問 WebDAV 必需的認證頭，由外層按需附加 Range 等業務頭
   * @param {string} path 掛載檢視下的完整路徑
   * @param {Object} [options]
   * @param {string} [options.subPath] 掛載內相對路徑（優先使用）
   * @returns {Promise<{ url: string, headers: Record<string,string[]> }>}
   */
  async generateUpstreamRequest(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;
    const relativePath = subPath || path;
    const davPath = this._buildDavPath(relativePath, false);
    const url = this._buildRequestUrl(davPath);

    /** @type {Record<string,string[]>} */
    const headers = {};
    const auth = this._basicAuthHeader();
    if (auth) {
      headers["Authorization"] = [auth];
    }

    return {
      url,
      headers,
    };
  }

  supportsProxyMode() {
    return true;
  }

  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  /**
   * 構建 WebDAV 路徑
   * - 僅基於掛載檢視下的 subPath
   * - 遠端根目錄由 endpoint_url 本身的路徑決定
   */
  _buildDavPath(subPath, ensureDir = false) {
    let raw = subPath || "";
    try {
      raw = decodeURI(raw);
    } catch {}
    const cleaned = this._normalize(raw);
    let full = cleaned;

    if (full && !full.startsWith("/")) {
      full = `/${full}`;
    }

    if (ensureDir) {
      if (!full) {
        full = "/";
      }
      if (!full.endsWith("/")) {
        full += "/";
      }
    }

    if (!full) {
      return "/";
    }

    return full;
  }

  _normalize(p) {
    const normalized = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    for (const seg of parts) {
      if (seg === "..") {
        throw new DriverError("路徑不允許包含 ..", { status: ApiStatus.FORBIDDEN, expose: true });
      }
    }
    return parts.join("/");
  }

  _decodeComponent(value) {
    if (!value) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      try {
        return decodeURI(value);
      } catch {
        return value;
      }
    }
  }

  _joinMountPath(basePath, name, isDirectory) {
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    return `${normalizedBase}${name}${isDirectory ? "/" : ""}`;
  }

  _buildMountPath(mount, subPath = "") {
    const mountRoot = mount?.mount_path || "/";
    const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const compact = normalized.replace(/\/+/g, "/");
    return mountRoot.endsWith("/") ? `${mountRoot.replace(/\/+$/, "")}${compact}` : `${mountRoot}${compact}`;
  }

  _relativeTargetPath(targetPath, mount) {
    if (!targetPath) return targetPath;
    let relative = targetPath;
    if (mount?.mount_path && targetPath.startsWith(mount.mount_path)) {
      relative = targetPath.slice(mount.mount_path.length);
    }
    relative = relative.startsWith("/") ? relative.slice(1) : relative;
    return relative;
  }

  _basename(p) {
    const parts = (p || "").split("/").filter(Boolean);
    return parts.pop() || "";
  }

  _buildRequestUrl(davPath) {
    const base = this.endpoint.endsWith("/") ? this.endpoint.slice(0, -1) : this.endpoint;
    return `${base}${davPath}`;
  }

  _basicAuthHeader() {
    const raw = `${this.username}:${this.decryptedPassword || ""}`;
    const encoded =
      typeof btoa === "function"
        ? btoa(raw)
        : Buffer.from(raw).toString("base64");
    return `Basic ${encoded}`;
  }

  _isNotFound(error) {
    const msg = error?.message || "";
    return msg.includes("404") || msg.includes("not found");
  }

  _isNotSupported(error) {
    const msg = error?.message?.toString?.() || "";
    return msg.includes("405") || msg.includes("501");
  }

  _isConflict(error) {
    const msg = error?.message?.toString?.() || "";
    return error?.statusCode === 409 || msg.includes("409");
  }

  _statusFromError(error) {
    const msg = error?.message || "";
    if (msg.includes("401") || msg.includes("403")) return ApiStatus.FORBIDDEN;
    if (msg.includes("404")) return ApiStatus.NOT_FOUND;
    if (msg.includes("405") || msg.includes("501")) return ApiStatus.NOT_IMPLEMENTED;
    return ApiStatus.INTERNAL_ERROR;
  }

  _wrapError(error, message, status = ApiStatus.INTERNAL_ERROR) {
    if (error instanceof DriverError || error instanceof AppError) return error;
    return new DriverError(message, { status, expose: status < 500, details: { cause: error?.message } });
  }

  async _normalizeBody(file, options = {}) {
    // 處理 Blob/File/ArrayBuffer/Uint8Array/Buffer/ReadableStream（Node 或 Web API）
    if (file === null || file === undefined) {
      throw new DriverError("上傳體為空", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    // Buffer 或 Uint8Array
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(file)) {
      return { body: file, length: file.length, contentType: options.contentType || null };
    }
    if (file instanceof Uint8Array) {
      return { body: file, length: file.byteLength, contentType: options.contentType || null };
    }

    // ArrayBuffer
    if (file instanceof ArrayBuffer) {
      const buf = Buffer.from(file);
      return { body: buf, length: buf.length, contentType: options.contentType || null };
    }

    // Web File/Blob
    if (typeof file.arrayBuffer === "function") {
      const buf = Buffer.from(await file.arrayBuffer());
      const length = file.size ?? buf.length;
      const type = options.contentType || file.type || null;
      return { body: buf, length, contentType: type };
    }

    // ReadableStream (Node 流或 Web API ReadableStream，例如 Cloudflare/Hono 請求體)
    const isNodeStream = file && (typeof file.pipe === "function" || file.readable);
    const isWebStream = file && typeof file.getReader === "function";
    if (isNodeStream || isWebStream) {
      // Node 流在 Node 環境下可以直接傳遞，由 webdav 客戶端負責消費
      if (isNodeStream && !isWebStream) {
        const length = options.fileSize || options.contentLength || null;
        const type = options.contentType || null;
        return { body: file, length, contentType: type };
      }

      // Web API ReadableStream（Cloudflare/Hono 環境）：
      // 為避免 webdav 客戶端與 WebStream 相容性問題，這裡統一讀取為 Buffer 再上傳，
      // 以確保上游儲存端能夠收到完整內容。
      try {
        const reader = file.getReader();
        /** @type {Uint8Array[]} */
        const chunks = [];
        let total = 0;
        // 按 Web Streams 標準逐塊讀取
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) {
            chunks.push(value);
            total += value.length;
          }
        }
        const buf = Buffer.allocUnsafe(total);
        let offset = 0;
        for (const chunk of chunks) {
          buf.set(chunk, offset);
          offset += chunk.length;
        }
        const length = total;
        const type = options.contentType || null;
        return { body: buf, length, contentType: type };
      } catch (e) {
        throw new DriverError("讀取上傳流失敗", {
          status: ApiStatus.INTERNAL_ERROR,
          expose: false,
          details: { cause: e?.message || String(e) },
        });
      }
    }

    // 字串
    if (typeof file === "string") {
      const buf = Buffer.from(file);
      return { body: buf, length: buf.length, contentType: options.contentType || "text/plain" };
    }

    throw new DriverError("不支援的上傳資料型別", { status: ApiStatus.BAD_REQUEST, expose: true });
  }

  async _ensureParentDirectories(davPath) {
    // davPath like /a/b/c.txt -> need ensure /a and /a/b
    const trimmed = davPath.endsWith("/") ? davPath.slice(0, -1) : davPath;
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    const dirs = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = "/" + parts.slice(0, i + 1).join("/") + "/";
      dirs.push(prefix);
    }
    for (const dir of dirs) {
      try {
        await this.client.createDirectory(dir);
      } catch (e) {
        // 如果目錄已存在則忽略
        if (this._isConflict(e) || this._isNotFound(e) || this._isNotSupported(e)) {
          // _isNotFound 對某些服務返回 409/404 混用，_isNotSupported 對 405/501，均視為無害
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * 解析目標路徑：當傳入目錄時自動拼接檔名
   */
  _resolveTargetDavPath(subPath, path, file, options = {}) {
    const fileName =
      options.filename ||
      options.fileName ||
      file?.name ||
      path.split("/").filter(Boolean).pop() ||
      "unnamed_file";

    const normalizedSub = this._normalize(subPath || "");

    const isFilePath = this._isCompleteFilePath(normalizedSub, fileName);
    let joined = "";
    if (normalizedSub) joined = normalizedSub;

    if (!isFilePath) {
      joined = joined ? `${joined}/${fileName}` : fileName;
    }

    const withPrefix = joined.startsWith("/") ? joined : `/${joined}`;
    return withPrefix;
  }

  _isCompleteFilePath(relativePath, originalFileName) {
    if (!relativePath || !originalFileName) return false;
    const relLast = relativePath.split("/").filter(Boolean).pop();
    if (!relLast) return false;
    const rel = this._splitName(relLast);
    const ori = this._splitName(originalFileName);
    if (!rel.ext) {
      return rel.name === ori.name;
    }
    return rel.ext === ori.ext && rel.name === ori.name;
  }

  _splitName(name = "") {
    const idx = name.lastIndexOf(".");
    if (idx <= 0) {
      return { name, ext: "" };
    }
    return { name: name.slice(0, idx), ext: name.slice(idx) };
  }
}
