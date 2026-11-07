/**
 * OneDriveStorageDriver
 *
 * Microsoft OneDrive / SharePoint 儲存驅動實現
 * - 基於 Microsoft Graph API 實現檔案操作
 * - 支援 READER/WRITER/ATOMIC/PROXY/SEARCH 能力（首版）
 * - 可選支援 DIRECT_LINK/MULTIPART 能力（後續擴充套件）
 *
 *
 * ========== 返回值契約規範（遵循 storage-driver 規範）==========
 *
 * renameItem: 返回 { success: boolean, source: string, target: string, message?: string }
 * copyItem:   返回 { status: "success"|"skipped"|"failed", source: string, target: string, message?: string, skipped?: boolean, reason?: string }
 * batchRemoveItems: 返回 { success: number, failed: Array<{path, error}>, results?: Array<{path, success, error?}> }
 * uploadFile: 返回 { success: boolean, storagePath: string, message?: string }
 * createDirectory: 返回 { success: boolean, path: string, alreadyExists?: boolean }
 * listDirectory: 返回 { path, type: "directory", isRoot, isVirtual, mount_id?, storage_type?, items: Array<FileInfo> }
 * getFileInfo: 返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName, mount_id?, storage_type? }
 * downloadFile: 返回 StorageStreamDescriptor 物件
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { OneDriveAuthManager } from "./auth/OneDriveAuthManager.js";
import { OneDriveGraphClient } from "./client/OneDriveGraphClient.js";
import { DriverError } from "../../../http/errors.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import {
  createUploadSessionRecord,
  listActiveUploadSessions,
  findUploadSessionById,
  updateUploadSessionById,
} from "../../../utils/uploadSessions.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";

// 簡單上傳（Simple Upload）上限：4MB
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export class OneDriveStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  儲存配置物件
   * @param {string} encryptionSecret 加密金鑰
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "ONEDRIVE";
    this.encryptionSecret = encryptionSecret;

    // 能力：READER/WRITER/ATOMIC/PROXY/DIRECT_LINK/MULTIPART
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
      CAPABILITIES.DIRECT_LINK,
      CAPABILITIES.MULTIPART,
      CAPABILITIES.PAGED_LIST,
    ];

    // 配置欄位
    this.region = config.region || "global";
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
    this.refreshToken = config.refresh_token;
    this.tokenRenewEndpoint = config.token_renew_endpoint || null;
    this.redirectUri = config.redirect_uri || null;
    this.useOnlineApi = config?.use_online_api === 1;
    this.enableDiskUsage = config?.enable_disk_usage === 1;

    // 內部元件（延遲初始化）
    this.authManager = null;
    this.graphClient = null;
  }

  /**
   * 初始化儲存驅動
   * - 建立 AuthManager 和 GraphClient
   * - 驗證配置有效性
   */
  async initialize() {
    // secret 欄位可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
    const decryptedClientSecret = await decryptIfNeeded(this.clientSecret, this.encryptionSecret);
    this.clientSecret = typeof decryptedClientSecret === "string" ? decryptedClientSecret : this.clientSecret;

    const decryptedRefreshToken = await decryptIfNeeded(this.refreshToken, this.encryptionSecret);
    this.refreshToken = typeof decryptedRefreshToken === "string" ? decryptedRefreshToken : this.refreshToken;

    // 建立認證管理器
    this.authManager = new OneDriveAuthManager({
      region: this.region,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      tokenRenewEndpoint: this.tokenRenewEndpoint,
      redirectUri: this.redirectUri,
      useOnlineApi: this.useOnlineApi,
    });

    // 建立 Graph API 客戶端
    this.graphClient = new OneDriveGraphClient({
      region: this.region,
      authManager: this.authManager,
    });

    // 驗證 token 可用性（嘗試獲取一次 access token）
    try {
      await this.authManager.getAccessToken();
    } catch (error) {
      const reason = error?.message || "未知錯誤";
      throw new DriverError(`OneDrive 驅動初始化失敗：無法獲取訪問令牌（${reason}）`, {
        status: 500,
        cause: error,
        details: { region: this.region },
      });
    }

    this.initialized = true;
  }

  /**
   * 規範化 OneDrive 遠端路徑（相對路徑，不帶前後斜槓）
   * - 統一處理：去掉開頭/結尾的 / 或 \\，並把多餘分隔符歸一成 /
   * - 只做字串層面的整理，不做 URL 編碼
   */
  _normalizeRemoteBase(value) {
    const raw = typeof value === "string" ? value : "";
    return raw.replace(/^[/\\\\]+|[/\\\\]+$/g, "").replace(/[\\\\/]+/g, "/");
  }

  /**
   * 規範化遠端檔案路徑：目錄(base) + 檔名(fileName)
   * - 如果 base 已經以 fileName 結尾（忽略大小寫），則不重複拼接
   * - base 允許為空（表示根目錄）
   */
  _resolveRemoteFilePath(base, fileName) {
    const normalizedBase = this._normalizeRemoteBase(base);
    const safeName = fileName ? String(fileName) : "";

    if (!safeName) {
      return normalizedBase;
    }
    if (!normalizedBase) {
      return safeName;
    }

    const segments = normalizedBase.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (lastSegment.toLowerCase() === safeName.toLowerCase()) {
      return normalizedBase;
    }
    return `${normalizedBase}/${safeName}`;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目錄內容
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/userType 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;
    const remotePath = subPath;

    const cursorRaw = ctx?.cursor != null && String(ctx.cursor).trim() ? String(ctx.cursor).trim() : null;
    const limitRaw = ctx?.limit != null && ctx.limit !== "" ? Number(ctx.limit) : null;
    const limit =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(999, Math.floor(limitRaw))) : null;
    const paged = ctx?.paged === true || !!cursorRaw || limit != null;

    let pageNextCursor = null;
    let items = [];
    if (paged) {
      const page = await this.graphClient.listChildrenPage(remotePath || "", {
        cursor: cursorRaw,
        limit,
      });
      items = Array.isArray(page?.items) ? page.items : [];
      pageNextCursor = page?.nextCursor ? String(page.nextCursor) : null;
    } else {
      items = await this.graphClient.listChildren(remotePath || "");
    }

    // 轉換為標準格式（path 仍然使用掛載檢視路徑，保證與 FileSystem 約定一致）
    const formattedItems = await Promise.all(
      items.map((item) => this._formatDriveItem(item, fsPath, mount, db)),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: !remotePath || remotePath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: this.type,
      items: formattedItems,
      ...(paged ? { hasMore: !!pageNextCursor, nextCursor: pageNextCursor } : {}),
    };
  }

  // ===== 可選能力：目錄分頁 =====
  // OneDrive / Microsoft Graph children 介面是分頁返回的（@odata.nextLink）。
  supportsDirectoryPagination() {
    return true;
  }

  /**
   * 獲取檔案或目錄資訊
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;
    const remotePath = subPath;

    const item = await this.graphClient.getItem(remotePath || "");

    let parentPath = fsPath;
    if (typeof fsPath === "string") {
      const segments = fsPath.split("/").filter(Boolean);
      if (segments.length > 1) {
        parentPath = `/${segments.slice(0, -1).join("/")}`;
      } else if (mount?.mount_path) {
        parentPath = mount.mount_path;
      } else {
        parentPath = "/";
      }
    }

    return this._formatDriveItem(item, parentPath, mount, db);
  }

  /**
   * 下載檔案，返回 StorageStreamDescriptor
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();

    const remotePath = subPath;

    // 獲取檔案後設資料
    const item = await this.graphClient.getItem(remotePath || "");

    if (item.folder) {
      throw new DriverError("無法下載目錄", { status: 400 });
    }

    const size = item.size || null;
    const contentType = item.file?.mimeType || getMimeTypeFromFilename(item.name) || "application/octet-stream";
    const etag = item.eTag || null;
    const lastModified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;

    return createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      fetchResponse: async (signal) => {
        return await this.graphClient.downloadContentResponse(remotePath || "", { signal });
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        return await this.graphClient.downloadContentResponse(remotePath || "", { signal, rangeHeader });
      },
    });
  }

  // ========== WRITER 能力：uploadFile / createDirectory / rename / copy / remove ==========

  /**
   * 統一上傳入口（檔案 / 流）
   * @param {string} subPath       掛載內子路徑（subPath-only）
   * @param {any} fileOrStream     資料來源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文選項（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();

    const { contentLength, contentType, filename } = ctx;
    const fsPath = ctx?.path;

    // 規範化遠端檔案路徑：目錄(subPath) + 檔名
    const remoteBase = subPath;
    const safeName =
      filename ||
      (typeof fsPath === "string"
        ? fsPath.split("/").filter(Boolean).pop() || "upload.bin"
        : "upload.bin");
    const remotePath = this._resolveRemoteFilePath(remoteBase, safeName);

    const effectiveContentType =
      contentType || getMimeTypeFromFilename(safeName) || "application/octet-stream";

    try {
      let item;

      // 小檔案：走 Simple Upload（PUT .../content）
      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength <= SIMPLE_UPLOAD_MAX_BYTES
      ) {
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=簡單上傳 status=開始 路徑=${fsPath} 子路徑=${subPath ?? ""} 遠端=${remotePath} 大小=${contentLength}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大檔案：使用 Upload Session + 單次 PUT（後端流式上傳，不做分片迴圈）
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=會話上傳 status=開始 路徑=${fsPath} 子路徑=${subPath ?? ""} 遠端=${remotePath} 大小=${contentLength}`,
        );

        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "rename",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 未知大小：保守起見使用 Simple Upload，依賴環境自身的大小限制
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=簡單上傳-未知大小 status=開始 路徑=${fsPath} 子路徑=${subPath ?? ""} 遠端=${remotePath}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      return {
        success: true,
        storagePath: fsPath || (typeof subPath === "string" ? subPath : ""),
        message: "檔案上傳成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`檔案上傳失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath },
      });
    }
  }

  /**
   * 更新檔案內容
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {string|Uint8Array|ArrayBuffer} content 新內容
   * @param {Object} ctx 上下文選項（mount/path/subPath/db 等）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) {
      throw new DriverError("OneDrive 更新檔案缺少 path 上下文（ctx.path）", {
        status: 500,
        details: { subPath },
      });
    }

    if (typeof subPath !== "string") {
      throw new DriverError("OneDrive 更新檔案缺少子路徑上下文（subPath）", {
        status: 500,
        details: { path: fsPath },
      });
    }

    // subPath 已經是掛載內的完整相對路徑（包含檔名）
    const remotePath = this._normalizeRemoteBase(subPath);

    const safeName =
      (typeof fsPath === "string"
        ? fsPath.split("/").filter(Boolean).pop()
        : null) || "file";

    const effectiveContentType =
      getMimeTypeFromFilename(safeName) || "text/plain; charset=utf-8";

    // 計算內容長度（僅在字串時計算，用於大檔案判斷）
    let contentLength = undefined;
    if (typeof content === "string") {
      contentLength = Buffer.byteLength(content, "utf8");
    }

    try {
      let item;

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=內容更新 status=開始 路徑=${fsPath} 子路徑=${remotePath} 大小=${contentLength ?? "未知"}`,
      );

      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大檔案更新：使用 Upload Session 單塊覆蓋
        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "replace",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, content, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 小檔案更新：直接 Simple Upload 覆蓋
        item = await this.graphClient.uploadSmall(remotePath || "", content, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=內容更新 status=完成 路徑=${fsPath} 子路徑=${remotePath}`,
      );

      return {
        success: true,
        path: fsPath,
        message: "檔案更新成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`更新檔案失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath, subPath: remotePath },
      });
    }
  }

  /**
   * 生成預簽名上傳URL（基於 OneDrive 上傳會話）
   * - 供 /api/fs/presign 使用，前端透過 StorageAdapter 執行直鏈上傳
   * - 這裡使用 Graph createUploadSession + uploadUrl，前端一次性 PUT 完整檔案
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/fileName/fileSize 等）
   */
  async generateUploadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    const { fileName, fileSize } = ctx;

    if (!fileName) {
      throw new DriverError("生成上傳URL失敗: 缺少檔名", { status: 400 });
    }

    // 對於 FS 檢視，使用 subPath/targetPath 作為完整遠端路徑（包含檔名）；
    // 對於 storage-first 場景，則直接使用傳入的 path 作為物件 Key。
    const remoteBase = subPath;
    const remotePath =
      typeof remoteBase === "string"
        ? remoteBase
            .replace(/^[/\\]+/, "")
            .replace(/[/\\]+$/, "")
            .replace(/[\\/]+/g, "/")
        : "";
    const safeName = fileName;

    try {
      console.log(
        `[StorageUpload] type=ONEDRIVE mode=預簽名上傳 status=開始 路徑=${fsPath} 子路徑=${remotePath} 檔案=${safeName} 大小=${fileSize ?? "未知"}`,
      );

      const session = await this.graphClient.createUploadSession(remotePath || "", {
        conflictBehavior: "rename",
      });

      const detectedContentType = getMimeTypeFromFilename(safeName) || "application/octet-stream";

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=預簽名上傳 status=生成完成 遠端=${remotePath}`,
      );

      // OneDrive uploadUrl 本身是預認證 URL，前端透過 PUT + Content-Range 直接上傳
      let headers = {};
      if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) {
        const end = fileSize - 1;
        headers["Content-Range"] = `bytes 0-${end}/${fileSize}`;
      }

      return {
        uploadUrl: session.uploadUrl,
        storagePath: remotePath,
        fileName: safeName,
        fileSize: typeof fileSize === "number" ? fileSize : null,
        contentType: detectedContentType,
        // 額外附帶會話資訊，供需要時使用
        expirationDateTime: session.expirationDateTime || null,
        headers,
      };
    } catch (error) {
      throw new DriverError(`生成上傳URL失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath, subPath },
      });
    }
  }

  /**
   * 建立目錄
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    const rawRemotePath = subPath;
    const remotePath = this._normalizeRemoteBase(rawRemotePath);

    // 特殊處理：掛載點根目錄在邏輯上總是存在，
    // 對應的 OneDrive 根目錄不需要真正建立，避免向 Graph 傳送空名稱導致
    // “The item must have a name.” 錯誤。
    if (!remotePath) {
      console.log(
        `[OneDriveStorageDriver] 跳過建立掛載點根目錄（邏輯上總是存在）: ${fsPath}`,
      );
      return {
        success: true,
        path: fsPath,
        alreadyExists: true,
      };
    }

    try {
      const result = await this.graphClient.createFolder(remotePath);
      return {
        success: true,
        path: fsPath,
        alreadyExists: false,
        item: result,
      };
    } catch (error) {
      // 如果目錄已存在，返回 alreadyExists: true
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          success: true,
          path: fsPath,
          alreadyExists: true,
        };
      }
      throw new DriverError(`建立目錄失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath },
      });
    }
  }

  /**
   * 重新命名檔案或目錄
   * @param {string} oldSubPath 原子路徑（subPath-only）
   * @param {string} newSubPath 目標子路徑（subPath-only）
   * @param {Object} ctx        上下文選項（oldPath/newPath/oldSubPath/newSubPath/...）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();

    const remoteOldPath = this._normalizeRemoteBase(oldSubPath);
    const remoteNewPath = this._normalizeRemoteBase(newSubPath);

    try {
      await this.graphClient.renameItem(remoteOldPath || "", remoteNewPath || "");
      return {
        success: true,
        source: ctx?.oldPath,
        target: ctx?.newPath,
      };
    } catch (error) {
      throw new DriverError(`重新命名失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { oldPath: ctx?.oldPath, newPath: ctx?.newPath, remoteOldPath, remoteNewPath },
      });
    }
  }

  /**
   * 批次刪除檔案/目錄
   * @param {Array<string>} subPaths 子路徑陣列（subPath-only）
   * @param {Object} ctx            上下文選項（paths/subPaths/mount/...）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new DriverError("OneDrive batchRemoveItems 需要 ctx.paths 與 subPaths 一一對應（不做相容）", {
        status: 500,
        details: { pathsType: typeof ctx?.paths, pathsLen: ctx?.paths?.length, subPathsLen: subPaths.length },
      });
    }

    const results = [];
    const failed = [];
    let successCount = 0;

    const fsPaths = ctx.paths;

    for (let i = 0; i < subPaths.length; i += 1) {
      const fsPath = fsPaths[i];
      const itemSubPath = subPaths[i];
      const remotePath = this._normalizeRemoteBase(itemSubPath);

      try {
        await this.graphClient.deleteItem(remotePath || "");
        results.push({ path: fsPath, success: true });
        successCount += 1;
      } catch (error) {
        results.push({ path: fsPath, success: false, error: error.message });
        failed.push({ path: fsPath, error: error.message });
      }
    }

    return {
      success: successCount,
      failed,
      results,
    };
  }

  /**
   * 複製單個檔案或目錄
   * @param {string} sourceSubPath 源子路徑（subPath-only）
   * @param {string} targetSubPath 目標子路徑（subPath-only）
   * @param {Object} ctx            上下文選項（sourcePath/targetPath/sourceSubPath/targetSubPath/...）
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;

    const remoteSourcePath = this._normalizeRemoteBase(sourceSubPath);
    const remoteTargetPath = this._normalizeRemoteBase(targetSubPath);

    try {
      await this.graphClient.copyItem(remoteSourcePath || "", remoteTargetPath || "");
      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
      };
    } catch (error) {
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目標已存在",
        };
      }
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: error.message,
      };
    }
  }

  // ========== SEARCH 能力 ==========

  // ========== DIRECT_LINK 能力 ==========

  /**
   * 生成下載直鏈（DIRECT_LINK 能力）
   * - 基於 Graph API @microsoft.graph.downloadUrl 生成直鏈
   * - 返回 { url, type, expiresIn?, expiresAt? }
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/request/forceDownload/...）
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    try {
      const remotePath = subPath;

      // 獲取檔案後設資料，包含 downloadUrl
      const item = await this.graphClient.getItem(remotePath || "");

      if (item.folder) {
        throw new DriverError("無法為目錄生成下載連結", { status: 400 });
      }

      const downloadUrl = item["@microsoft.graph.downloadUrl"];

      if (!downloadUrl) {
        throw new DriverError("OneDrive 未返回可用的 downloadUrl（無法生成直鏈）", {
          status: 502,
          expose: false,
          details: { subPath: remotePath },
        });
      }

      // Graph API downloadUrl 通常有效期約 1 小時
      const expiresIn = 3600; // 1 小時（秒）
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      return {
        url: downloadUrl,
        type: "native_direct",
        expiresIn,
        expiresAt,
      };
    } catch (error) {
      // 直鏈能力失敗時，交給上層策略（FsLinkStrategy / LinkService）決定是否降級為 proxy
      throw new DriverError(`OneDrive 獲取直鏈失敗: ${error?.message || "unknown"}`, {
        status: error?.status || 502,
        expose: false,
        cause: error,
        details: { subPath },
      });
    }
  }

  // ========== PROXY 能力 ==========

  /**
   * 生成代理 URL（PROXY 能力）
   * - 返回 { url, type: "proxy", channel? }
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/request/download/channel/...）
   */
  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;

    // 使用統一的代理 URL 構建器
    const url = buildFullProxyUrl(request, fsPath, download);

    return {
      url,
      type: "proxy",
      channel,
    };
  }

  // ========== MULTIPART 能力：前端分片上傳（單會話 uploadUrl + Content-Range） ==========

  /**
   * 初始化前端分片上傳（基於 OneDrive Upload Session）
   * - 策略：single_session
   * - 由前端負責將檔案切分為多個 chunk，並對同一個 uploadUrl 連續傳送帶 Content-Range 的 PUT 請求
   *
   * @param {string} subPath 掛載檢視下的子路徑（目錄或完整相對路徑）
   * @param {Object} options 選項引數
   * @returns {Promise<Object>} 初始化結果（InitResult）
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const {
      fileName,
      fileSize,
      partSize = 5 * 1024 * 1024,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DriverError("OneDrive 分片上傳初始化失敗：缺少有效的 fileName 或 fileSize", {
        status: 400,
      });
    }

    // 規範化遠端檔案路徑：目錄(subPath) + 檔名
    const remotePath = this._resolveRemoteFilePath(typeof subPath === "string" ? subPath : "", fileName);

    try {
      const session = await this.graphClient.createUploadSession(remotePath || "", {
        conflictBehavior: "replace",
      });

      const effectivePartSize = partSize || 5 * 1024 * 1024;
      const calculatedPartCount =
        partCount || Math.max(1, Math.ceil(fileSize / effectivePartSize));

      // uploadId 使用 CloudHarbor 的 upload_sessions.id（upl_xxx）
      // session.uploadUrl 仍然返回 Graph 的 uploadUrl（瀏覽器直傳 OneDrive）
      // 斷點續傳統一用 uploadId 查本地會話，再去 Graph 拉取 nextExpectedRanges
      if (!db || !mount?.storage_config_id || !mount?.id) {
        throw new DriverError("OneDrive 分片上傳初始化失敗：缺少 db 或 mount 資訊", {
          status: 400,
          expose: true,
        });
      }
      let uploadId = null;

      // 規範化 FS 檢視路徑：mount_path + "/" + remotePath
      let fsPath = remotePath || "";
      if (mount?.mount_path) {
        const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
        const rel = (remotePath || "").replace(/^\/+/g, "");
        fsPath = rel ? `${basePath}/${rel}` : basePath;
      }
      if (!fsPath.startsWith("/")) {
        fsPath = `/${fsPath}`;
      }

      // 將會話寫入通用 upload_sessions 表：這是斷點續傳的“控制面”
      //（Graph uploadUrl 會過期，但我們用 uploadId 作為穩定標識，再透過 sign-parts 去重新整理 session 資訊） 
      const { id } = await createUploadSessionRecord(db, {
        userIdOrInfo,
        userType: userType || null,
        storageType: this.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        source: "FS",
        fileName,
        fileSize,
        mimeType: getMimeTypeFromFilename(fileName) || null,
        checksum: null,
        strategy: "single_session",
        partSize: effectivePartSize,
        totalParts: calculatedPartCount,
        bytesUploaded: 0,
        uploadedParts: 0,
        nextExpectedRange:
          Array.isArray(session.nextExpectedRanges) && session.nextExpectedRanges.length > 0
            ? session.nextExpectedRanges[0]
            : "0-",
        providerUploadId: null,
        providerUploadUrl: session.uploadUrl,
        providerMeta: null,
        status: "initiated",
        expiresAt: session.expirationDateTime || null,
      });
      uploadId = id;

      return {
        success: true,
        uploadId,
        strategy: "single_session",
        fileName,
        fileSize,
        partSize: effectivePartSize,
        partCount: calculatedPartCount,
        totalParts: calculatedPartCount,
        key: fsPath.replace(/^\/+/, ""),
        session: {
          uploadUrl: session.uploadUrl,
          expirationDateTime: session.expirationDateTime || null,
          nextExpectedRanges: session.nextExpectedRanges || null,
        },
        policy: {
          refreshPolicy: "server_decides",
          partsLedgerPolicy: "server_records",
          retryPolicy: { maxAttempts: 3 },
        },
        mount_id: mount?.id ?? null,
        path: fsPath,
        storage_type: this.type,
        userType: userType || null,
        userIdOrInfo: userIdOrInfo || null,
      };
    } catch (error) {
      throw new DriverError(`初始化 OneDrive 分片上傳失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { subPath, fileName },
      });
    }
  }

  /**
   * 完成前端分片上傳
   * - 對 OneDrive 而言，最後一個 chunk PUT 成功即視為完成
   * - 這裡主要用於對齊 FS 層行為並返回統一結果結構
   *
   * @param {string} subPath 掛載檢視下的子路徑
   * @param {Object} options 選項引數
   * @returns {Promise<Object>} 完成結果（CompleteResult）
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType, parts } = options;

    // 規範化遠端路徑（與 initialize 保持一致）
    const remotePath = fileName
      ? this._resolveRemoteFilePath(typeof subPath === "string" ? subPath : "", fileName)
      : this._normalizeRemoteBase(typeof subPath === "string" ? subPath : "");

    try {
      // 嘗試獲取最終檔案資訊（非嚴格必要，僅用於返回更完整的後設資料）
      let item = null;
      try {
        item = await this.graphClient.getItem(remotePath || "");
      } catch {
        // 如果獲取失敗，不影響整體完成邏輯
      }

      const contentType =
        item?.file?.mimeType || (fileName ? getMimeTypeFromFilename(fileName) : null);

      if (db && mount?.storage_config_id && uploadId) {
        try {
          const effectiveSize =
            typeof fileSize === "number" && Number.isFinite(fileSize)
              ? fileSize
              : item?.size ?? null;

          // uploadId 即 upload_sessions.id，直接按 id 更新狀態即可。
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: this.type,
            status: "completed",
            bytesUploaded: typeof effectiveSize === "number" && Number.isFinite(effectiveSize) ? effectiveSize : 0,
            uploadedParts: Array.isArray(parts) ? parts.length : 0,
            nextExpectedRange: null,
            errorCode: null,
            errorMessage: null,
          });
        } catch (e) {
          console.warn(
            "[OneDriveStorageDriver] 更新 upload_sessions 狀態為 completed 失敗:",
            e,
          );
        }
      }

      return {
        success: true,
        fileName: fileName || (remotePath ? remotePath.split("/").pop() : null),
        size: typeof fileSize === "number" ? fileSize : item?.size ?? null,
        contentType: contentType || null,
        storagePath: remotePath || "",
        publicUrl: null,
        etag: item?.eTag || null,
        uploadId: uploadId || null,
        message: "OneDrive 分片上傳完成",
      };
    } catch (error) {
      throw new DriverError(`完成 OneDrive 分片上傳失敗: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { subPath, uploadId, fileName },
      });
    }
  }

  /**
   * 中止前端分片上傳
   * - 當前實現不主動呼叫 Graph 的會話中止介面，依賴 OneDrive 上傳會話的過期機制
   * - 若後續需要嚴格釋放資源，可在此處補充呼叫
   */
  async abortFrontendMultipartUpload(_subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, db, mount } = options;

    if (db && mount?.storage_config_id && uploadId) {
      try {
        // uploadId 即 upload_sessions.id，直接按 id 更新即可。
        await updateUploadSessionById(db, {
          id: String(uploadId),
          storageType: this.type,
          status: "aborted",
          errorMessage: "aborted_by_client",
        });
      } catch (e) {
        console.warn(
          "[OneDriveStorageDriver] 更新 upload_sessions 狀態為 aborted 失敗:",
          e,
        );
      }
    }

    // 目前僅返回成功標記，表示後續不再使用該 uploadId
    return {
      success: true,
      uploadId: uploadId || null,
      message: "OneDrive 分片上傳已標記為中止（會話將自然過期）",
    };
  }

  /**
   * 列出進行中的分片上傳
   */
  async listMultipartUploads(_subPath = "", _options = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType } = _options || {};

    if (!db || !mount?.id) {
      return {
        success: true,
        uploads: [],
      };
    }

    // 計算 FS 檢視下的字首路徑（與 initializeFrontendMultipartUpload 中 fsPath 的計算方式保持一致）
    let fsPathPrefix = mount.mount_path || "/";
    if (typeof _subPath === "string" && _subPath.trim() !== "") {
      const rel = _subPath.replace(/^\/+/g, "");
      const basePath = (fsPathPrefix || "/").replace(/\/+$/g, "") || "/";
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPathPrefix.startsWith("/")) {
      fsPathPrefix = `/${fsPathPrefix}`;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: this.type,
      mountId: mount.id,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = sessions.map((row) => ({
      key: (row.fs_path || "/").replace(/^\/+/, ""),
      uploadId: row.id,
      initiated: row.created_at,
      storageClass: null,
      owner: null,
      // 額外後設資料（當前前端不會直接使用，但便於以後擴充套件）
      fileName: row.file_name,
      fileSize: row.file_size,
      partSize: row.part_size,
      strategy: row.strategy,
      sessionId: row.id,
      bytesUploaded: Number(row.bytes_uploaded) || 0,
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    }));

    return {
      success: true,
      uploads,
    };
  }

  /**
   * 列出指定上傳任務的已上傳分片
   * - 由於 OneDrive uploadSession 不暴露 per-part 列表，這裡根據 upload_sessions 記錄和
   *   Graph uploadSession 的 nextExpectedRanges 估算“已上傳的完整分片”數量。
   * - 用於配合 Uppy 的恢復邏輯：僅在存在至少一個完整分片時返回分片資訊，最後一塊可能是未對齊的部分資料，將始終由前端重新上傳。
   */
  async listMultipartParts(_subPath, uploadId, _options = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType } = _options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId || !db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }

    try {
      // 從本地 upload_sessions 表中獲取會話配置資訊（檔案大小與分片大小）
      const sessionRow = await findUploadSessionById(db, { id: uploadId });

      if (!sessionRow) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }
      if (String(sessionRow.storage_type) !== String(this.type)) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const providerUploadUrl = sessionRow.provider_upload_url ? String(sessionRow.provider_upload_url) : "";
      if (!providerUploadUrl) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const totalSize = Number(sessionRow.file_size) || null;
      const partSize = Number(sessionRow.part_size) || 5 * 1024 * 1024;

      if (!totalSize || !Number.isFinite(partSize) || partSize <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 呼叫 Graph 獲取最新的 nextExpectedRanges，以推導已上傳位元組數
      let bytesUploaded = 0;
      try {
        const sessionInfo = await this.graphClient.getUploadSessionInfo(providerUploadUrl);
        const ranges = Array.isArray(sessionInfo.nextExpectedRanges)
          ? sessionInfo.nextExpectedRanges
          : null;
        const firstRange = ranges && ranges.length > 0 ? String(ranges[0]) : null;
        if (firstRange) {
          const startStr = firstRange.split("-")[0];
          const parsed = Number.parseInt(startStr, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            bytesUploaded = parsed;
          }
        }
      } catch (error) {
        console.warn(
          "[OneDriveStorageDriver] listMultipartParts 獲取 uploadSession 資訊失敗，將回退為空分片列表:",
          error,
        );
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 若尚未上傳任何位元組，直接視為無可恢復分片
      if (!Number.isFinite(bytesUploaded) || bytesUploaded <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 取整計算“已完成的完整分片”數量，最後一塊未對齊的資料將由前端重新上傳
      const completedParts = Math.floor(bytesUploaded / partSize);
      if (completedParts <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const parts = [];
      for (let partNumber = 1; partNumber <= completedParts; partNumber += 1) {
        parts.push({
          partNumber,
          size: partSize,
          etag: `onedrive-part-${partNumber}`,
        });
      }

      return {
        success: true,
        uploadId: uploadId || null,
        parts,
        policy,
      };
    } catch (error) {
      console.warn("[OneDriveStorageDriver] listMultipartParts 異常，回退為空分片列表:", error);
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }
  }

  /**
   * 重新整理分片上傳端點
   * - 對於 single_session 策略，通常直接複用原始 uploadUrl
   * - 當前實現回傳 uploadId 及最新的 nextExpectedRanges，呼叫方可將其視為 uploadUrl + 會話資訊
   */
  async signMultipartParts(_subPath, uploadId, _partNumbers, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId) {
      throw new DriverError("OneDrive 重新整理分片會話失敗：缺少 uploadId", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
      });
    }

    // FS 分片上傳鏈路依賴 upload_sessions 表（控制面）
    if (!db || !mount?.storage_config_id) {
      throw new DriverError("OneDrive 重新整理分片會話失敗：缺少 db/mount 資訊", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
        details: { hasDb: !!db, mountId: mount?.id ?? null, storageConfigId: mount?.storage_config_id ?? null },
      });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow || String(sessionRow.storage_type) !== String(this.type)) {
      throw new DriverError("OneDrive 上傳會話不存在或不匹配，無法繼續斷點續傳", {
        status: 404,
        code: "UPLOAD_SESSION_NOT_FOUND",
        expose: true,
      });
    }

    const providerUploadUrl = sessionRow.provider_upload_url ? String(sessionRow.provider_upload_url) : "";
    if (!providerUploadUrl) {
      throw new DriverError("OneDrive 上傳會話缺少 provider uploadUrl，無法繼續斷點續傳", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
      });
    }

    let sessionInfo = null;
    try {
      sessionInfo = await this.graphClient.getUploadSessionInfo(providerUploadUrl);
    } catch (error) {
      if (error?.status === 404 || error?.details?.code === "itemNotFound") {
        try {
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: this.type,
            status: "error",
            errorCode: "UPLOAD_SESSION_NOT_FOUND",
            errorMessage: "OneDrive upload session not found or expired",
          });
        } catch (e) {
          console.warn("[OneDriveStorageDriver] 標記 upload_sessions 會話為失效失敗:", e);
        }

        throw new DriverError("OneDrive 上傳會話不存在或已過期，無法繼續斷點續傳", {
          status: 404,
          code: "UPLOAD_SESSION_NOT_FOUND",
          expose: true,
        });
      }

      console.warn("[OneDriveStorageDriver] 獲取 uploadSession 資訊失敗，將回退為舊會話資訊:", error);
      sessionInfo = null;
    }

    try {
      const ranges = Array.isArray(sessionInfo?.nextExpectedRanges) ? sessionInfo.nextExpectedRanges : null;
      const firstRange = ranges && ranges.length > 0 ? String(ranges[0]) : null;
      let bytesUploaded = null;

      if (firstRange) {
        const startStr = firstRange.split("-")[0];
        const parsed = Number.parseInt(startStr, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          bytesUploaded = parsed;
        }
      }

      const expiresAt = sessionInfo?.expirationDateTime ? String(sessionInfo.expirationDateTime) : null;
      await updateUploadSessionById(db, {
        id: String(uploadId),
        storageType: this.type,
        status: "uploading",
        bytesUploaded: typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded) ? bytesUploaded : (Number(sessionRow.bytes_uploaded) || 0),
        nextExpectedRange: firstRange ?? (sessionRow.next_expected_range || null),
        expiresAt,
      });
    } catch (e) {
      console.warn("[OneDriveStorageDriver] 重新整理 upload_sessions 狀態失敗（可忽略）:", e);
    }

    return {
      success: true,
      uploadId: String(uploadId),
      strategy: "single_session",
      policy,
      session: {
        uploadUrl: providerUploadUrl,
        expirationDateTime: sessionInfo?.expirationDateTime || null,
        nextExpectedRanges: sessionInfo?.nextExpectedRanges || null,
      },
    };
  }

  // ========== 基礎方法 ==========

  /**
   * 基礎存在性檢查
   * @param {string} subPath
   * @param {Object} _ctx 上下文選項（保留用於介面一致性）
   * @returns {Promise<boolean>}
   */
  async exists(subPath, _ctx = {}) {
    this._ensureInitialized();

    const remotePath = subPath;

    try {
      await this.graphClient.getItem(remotePath || "");
      return true;
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 獲取儲存驅動統計資訊
   * @returns {Promise<Object>}
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      region: this.region,
      timestamp: new Date().toISOString(),
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "OneDrive 磁碟佔用統計未啟用（enable_disk_usage = false）",
      };
    }

    // 上游配額（quota）讀取
    try {
      const drive = await this.graphClient.getDrive({ selectQuotaOnly: true });
      const quota = drive?.quota || null;
      if (!quota || typeof quota !== "object") {
        return {
          ...base,
          supported: false,
          message: "OneDrive 未返回配額資訊（quota）",
        };
      }

      const parseQuotaNumber = (value) => {
        if (value == null) return null;
        const n = Number.parseInt(String(value), 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };

      const totalBytes = parseQuotaNumber(quota.total);
      const remainingBytes = parseQuotaNumber(quota.remaining);
      const deletedBytes = parseQuotaNumber(quota.deleted);
      const usedBytes = parseQuotaNumber(quota.used) ?? (totalBytes != null && remainingBytes != null ? Math.max(0, totalBytes - remainingBytes) : null);
      const state = quota.state != null ? String(quota.state) : null;

      let usagePercent = null;
      if (totalBytes && usedBytes != null && totalBytes > 0) {
        usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
      }

      return {
        ...base,
        supported: true,
        quota: {
          raw: quota,
          totalBytes,
          usedBytes,
          remainingBytes,
          deletedBytes,
          state,
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

  // ========== 私有輔助方法 ==========

  /**
   * 將 Graph driveItem 的 parentReference.path 對映到 FS 檢視下的父路徑
   * - 利用掛載路徑 mountPath 構造統一的 /mount/subDir 形式
   * - 不再依賴 root_folder，直接按 OneDrive 根進行對映
   *
   * @param {Object} item Graph API driveItem
   * @param {string} mountPath 規範化後的掛載路徑（無結尾斜槓，至少為 "/"）
   * @param {string|null} scopedBasePath 搜尋限定路徑（FS 檢視下，目錄級別，無結尾斜槓）
   * @returns {string|null} FS 檢視下的父路徑（不含檔名）；若應過濾則返回 null
   */
  _resolveFsParentPathForItem(item, mountPath, scopedBasePath) {
    const parentDrivePath = item?.parentReference?.path || "/drive/root:";
    const prefix = "/drive/root:";
    let relativeDir = "";

    if (parentDrivePath.startsWith(prefix)) {
      // 形如 "/drive/root:/cloudharbor/subdir" → "/cloudharbor/subdir"
      relativeDir = parentDrivePath.slice(prefix.length);
    }

    if (relativeDir) {
      relativeDir = relativeDir.replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    }

    // 直接以 OneDrive 根為基準對映到掛載路徑
    const subPathFromRoot = relativeDir;
    let fsParentPath = mountPath || "/";
    if (subPathFromRoot) {
      fsParentPath = `${fsParentPath}/${subPathFromRoot}`;
    }

    fsParentPath = fsParentPath.replace(/\/+/g, "/");
    if (!fsParentPath.startsWith("/")) {
      fsParentPath = `/${fsParentPath}`;
    }

    if (scopedBasePath) {
      const base = scopedBasePath.replace(/\/+$/g, "") || "/";
      if (!(fsParentPath === base || fsParentPath.startsWith(`${base}/`))) {
        return null;
      }
    }

    return fsParentPath;
  }

  /**
   * 將 Graph API driveItem 轉換為標準檔案資訊格式
   * @param {Object} item Graph API driveItem
   * @param {string} parentPath 父路徑
   * @param {Object} mount 掛載資訊
   * @param {D1Database} [db] 資料庫例項（用於檔案型別檢測）
   */
  async _formatDriveItem(item, parentPath, mount, db) {
    const isDirectory = !!item.folder;
    const name = item.name;
    const path = parentPath ? `${parentPath}/${name}`.replace(/[\\/]+/g, "/") : name;

    // 統一目錄路徑約定：目錄在 FS 檢視中始終以斜槓結尾
    const displayPath =
      isDirectory && typeof path === "string" && !path.endsWith("/") ? `${path}/` : path;

    const size = isDirectory ? null : Number(item.size ?? 0);
    const modified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;
    const mimetype = isDirectory ? null : (item.file?.mimeType || getMimeTypeFromFilename(name));

    const info = await buildFileInfo({
      fsPath: displayPath,
      name,
      isDirectory,
      size,
      modified,
      mimetype,
      mount,
      storageType: this.type,
      db,
    });

    return {
      ...info,
      // OneDrive 特有欄位（可選）
      webUrl: item.webUrl || null,
      downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
    };
  }
}
