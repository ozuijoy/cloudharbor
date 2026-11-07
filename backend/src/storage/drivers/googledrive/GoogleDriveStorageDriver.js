/**
 * GoogleDriveStorageDriver
 *
 * Google Drive 儲存驅動實現
 * - 基於 Google Drive v3 API 實現檔案操作
 * - 支援 READER/WRITER/ATOMIC/PROXY/SEARCH/DIRECT_LINK 能力（首版）
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
import { GoogleDriveAuthManager } from "./GoogleDriveAuthManager.js";
import { GoogleDriveApiClient } from "./GoogleDriveApiClient.js";
import { DriverError, ValidationError } from "../../../http/errors.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { isDirectoryPath } from "../../fs/utils/PathResolver.js";
import { GoogleDriveUploadOperations } from "./GoogleDriveUploadOperations.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import {
  SHARED_WITH_ME_SEGMENT,
  isSharedWithMePath,
  resolveSharedWithMePath,
  listSharedWithMeDirectory,
  injectSharedWithMeEntry,
} from "./GoogleDriveSharedView.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";


export class GoogleDriveStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  儲存配置物件
   * @param {string} encryptionSecret 加密金鑰
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GOOGLE_DRIVE";
    this.encryptionSecret = encryptionSecret;

    // 能力：READER/WRITER/ATOMIC/PROXY/MULTIPART
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
      CAPABILITIES.MULTIPART,
      CAPABILITIES.PAGED_LIST,
    ];

    // 配置欄位
    this.rootId = config.root_id || "root";
    this.enableDiskUsage = config?.enable_disk_usage === 1;
    this.useOnlineApi = config?.use_online_api === 1;
    this.apiAddress = config.endpoint_url || null;
    this.clientId = config.client_id || null;
    this.clientSecret = config.client_secret || null;
    this.refreshToken = config.refresh_token || "";
    this.enableSharedView = config?.enable_shared_view === undefined ? true : config?.enable_shared_view === 1;

    // 內部元件（延遲初始化）
    this.authManager = null;
    this.apiClient = null;
    this.uploadOps = null;
  }

  /**
   * 初始化儲存驅動
   * - 建立 AuthManager 和 ApiClient
   * - 驗證 token 可用性
   */
  async initialize() {
    // secret 欄位可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
    const decryptedClientSecret = await decryptIfNeeded(this.clientSecret, this.encryptionSecret);
    this.clientSecret = typeof decryptedClientSecret === "string" ? decryptedClientSecret : this.clientSecret;

    const decryptedRefreshToken = await decryptIfNeeded(this.refreshToken, this.encryptionSecret);
    this.refreshToken = typeof decryptedRefreshToken === "string" ? decryptedRefreshToken : this.refreshToken;

    this.authManager = new GoogleDriveAuthManager({
      useOnlineApi: this.useOnlineApi,
      apiAddress: this.apiAddress,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      rootId: this.rootId,
      disableDiskUsage: !this.enableDiskUsage,
      logger: console,
    });

    this.apiClient = new GoogleDriveApiClient({
      authManager: this.authManager,
    });

    try {
      await this.authManager.getAccessToken();
    } catch (error) {
      const reason = error?.message || "未知錯誤";
      throw new DriverError(`Google Drive 驅動初始化失敗：無法獲取訪問令牌（${reason}）`, {
        status: 500,
        cause: error,
      });
    }

    // 初始化上傳操作模組（分片上傳相關邏輯委託給該模組）
    this.uploadOps = new GoogleDriveUploadOperations(this);

    this.initialized = true;
  }

  // ========== 路徑與 Drive ID 對映輔助 ==========

  /**
   * 將掛載檢視路徑對映為 Drive 內部路徑片段陣列
   * - 按照 "/" 切分並過濾空片段
   * @param {string} path
   * @returns {string[]}
   */
  _splitPath(path) {
    if (!path) return [];
    return path.split("/").filter(Boolean);
  }

  /**
   * 透過路徑解析到最終 fileId
   * - rootId 對應掛載根目錄
   * - 其餘片段依次透過 listFiles(name = segment) 方式向下解析
   * - 該實現假設同一目錄下名稱唯一（與大多數場景一致）
   *
   * @param {string} path 掛載檢視下的路徑
   * @param {Object} options 上下文選項（mount/subPath）
   * @returns {Promise<{ fileId: string, isDirectory: boolean, name: string, driveItem: any | null }>}
   */
  async _resolvePathToFileId(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const segments = this._splitPath(effectivePath || "");

    // sharedWithMe 虛擬檢視路徑：交由獨立模組解析，便於按需開啟/刪除
    if (this.enableSharedView && isSharedWithMePath(segments)) {
      const resolved = await resolveSharedWithMePath(segments, this.apiClient);
      if (resolved) {
        return resolved;
      }
    }

    // 預設路徑解析邏輯：從 rootId 出發按名稱逐級向下解析
    const segmentsForNormal = segments;
    let currentId = this.rootId || "root";
    let lastItem = null;

    // 根路徑特殊處理：不呼叫 /files/root，直接返回目錄資訊
    if (segmentsForNormal.length === 0) {
      return {
        fileId: currentId,
        isDirectory: true,
        name: "",
        driveItem: null,
      };
    }

    for (let i = 0; i < segmentsForNormal.length; i++) {
      const segment = segmentsForNormal[i];
      const q = `'${currentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and trashed = false`;
      const res = await this.apiClient.listFiles(currentId, { q, pageSize: 2 });
      const files = Array.isArray(res.files) ? res.files : [];
      if (files.length === 0) {
        throw new DriverError(`指定路徑不存在: ${effectivePath}`, {
          status: 404,
          code: "DRIVER_ERROR.GDRIVE.NOT_FOUND",
        });
      }
      lastItem = files[0];
      currentId = lastItem.id;

      const isDirectory = lastItem.mimeType === "application/vnd.google-apps.folder";
      const hasMoreSegments = i < segmentsForNormal.length - 1;

      if (!isDirectory && hasMoreSegments) {
        throw new DriverError(`目標父路徑不是目錄: ${effectivePath}`, {
          status: 400,
          code: "DRIVER_ERROR.GDRIVE.NOT_DIRECTORY",
        });
      }
    }

    const isDirectory = lastItem.mimeType === "application/vnd.google-apps.folder";
    return {
      fileId: currentId,
      isDirectory,
      name: lastItem.name,
      driveItem: lastItem,
    };
  }

  /**
   * 在 storage-first 場景下，按給定子路徑確保目錄鏈存在
   * - 僅用於物件儲存視角（分享上傳等），不會影響 FS 掛載檢視
   * - 從 rootId 出發，逐級查詢/建立子目錄
   * @param {string} dirSubPath 目錄子路徑（如 /foo/bar）
   * @returns {Promise<string>} 最終目錄的 fileId
   */
  async _ensureDirectoryChainForStorage(dirSubPath) {
    this._ensureInitialized();
    const segments = this._splitPath(dirSubPath || "");
    if (segments.length === 0) {
      return this.rootId || "root";
    }

    let currentId = this.rootId || "root";
    for (const segment of segments) {
      const q = `'${currentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and trashed = false`;
      const res = await this.apiClient.listFiles(currentId, { q, pageSize: 2 });
      const files = Array.isArray(res.files) ? res.files : [];

      if (files.length === 0) {
        // 不存在則建立目錄
        const folder = await this.apiClient.createFolder(currentId, segment);
        currentId = folder.id;
      } else {
        const item = files[0];
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        if (!isDir) {
          throw new DriverError("目標父路徑不是目錄", { status: 400 });
        }
        currentId = item.id;
      }
    }

    return currentId;
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
    const effectiveSubPath = subPath;

    // 目錄分頁（可選）
    // - cursor：Google Drive 的 nextPageToken（不透明字串）
    // - limit：單頁數量（Drive API 支援 pageSize + nextPageToken）
    const cursorRaw = ctx?.cursor != null && String(ctx.cursor).trim() ? String(ctx.cursor).trim() : null;
    const limitRaw = ctx?.limit != null && ctx.limit !== "" ? Number(ctx.limit) : null;
    const limit =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : null;
    const paged = ctx?.paged === true || !!cursorRaw || limit != null;

    const segments = this._splitPath(effectiveSubPath || "");

    // sharedWithMe 虛擬目錄：路徑以 __shared_with_me__ 開頭時走專用分支
    if (this.enableSharedView && isSharedWithMePath(segments)) {
      return await listSharedWithMeDirectory({
        path: fsPath,
        segments,
        apiClient: this.apiClient,
        mount,
        db,
        options: { cursor: cursorRaw, limit, paged, refresh: ctx?.refresh === true },
      });
    }

    const { fileId, isDirectory } = await this._resolvePathToFileId(effectiveSubPath || "", ctx);
    if (!isDirectory) {
      throw new DriverError("目標路徑不是目錄", { status: 400 });
    }

    /** @type {any[]} */
    let files = [];
    let nextCursor = null;
    if (paged) {
      const res = await this.apiClient.listFiles(fileId, { pageSize: limit ?? 1000, pageToken: cursorRaw || undefined });
      files = Array.isArray(res?.files) ? res.files : [];
      nextCursor = res?.nextPageToken ? String(res.nextPageToken) : null;
    } else {
      let pageToken = undefined;
      while (true) {
        const res = await this.apiClient.listFiles(fileId, { pageSize: limit ?? 1000, pageToken });
        const pageFiles = Array.isArray(res?.files) ? res.files : [];
        files.push(...pageFiles);
        pageToken = res?.nextPageToken ? String(res.nextPageToken) : undefined;
        if (!pageToken) break;
      }
    }

    const formattedItems = await Promise.all(
      files.map(async (item) => {
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        const name = item.name;

        // 使用掛載檢視路徑作為父路徑，保證子項 path 始終帶上掛載字首（例如 /google/xxx）
        const parentPath =
          typeof fsPath === "string" && fsPath.length > 0 ? fsPath.replace(/\/+$/, "") : "";
        let childPath = `${parentPath}/${name}`.replace(/[\\/+]+/g, "/");
        if (isDir && typeof childPath === "string" && !childPath.endsWith("/")) {
          childPath = `${childPath}/`;
        }

        const size = isDir ? null : Number(item.size || 0);
        const modified = item.modifiedTime ? new Date(item.modifiedTime) : null;
        const mimetype = isDir ? "application/x-directory" : item.mimeType || null;

        const info = await buildFileInfo({
          fsPath: childPath,
          name,
          isDirectory: isDir,
          size,
          modified,
          mimetype,
          mount,
          storageType: this.type,
          db,
        });

        return info;
      }),
    );

    const isRoot = !effectiveSubPath || effectiveSubPath === "/" || effectiveSubPath === "";

    // 在掛載根目錄下注入一個虛擬的 sharedWithMe 目錄入口
    if (isRoot && this.enableSharedView) {
      injectSharedWithMeEntry({ path: fsPath, mount, items: formattedItems });
    }

    return {
      path: fsPath,
      type: "directory",
      isRoot,
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: this.type,
      items: formattedItems,
      ...(paged ? { hasMore: !!nextCursor, nextCursor } : {}),
    };
  }

  // ===== 可選能力：目錄分頁 =====
  // Google Drive 的 files.list 天然分頁（nextPageToken）。
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
    const effectiveSubPath = subPath;

    const { driveItem, name, isDirectory } = await this._resolvePathToFileId(effectiveSubPath || "", ctx);

    // 根路徑場景下 driveItem 可能為 null，此時構造一個虛擬目錄資訊
    const effectiveName = name || (mount?.mount_path ? mount.mount_path.replace(/^\/+/, "") || "root" : "root");
    const isDir = isDirectory;

    const size = isDir ? null : Number(driveItem?.size || 0);
    const modified = driveItem?.modifiedTime ? new Date(driveItem.modifiedTime) : null;
    const mimetype = isDir ? "application/x-directory" : driveItem?.mimeType || null;

    return await buildFileInfo({
      fsPath,
      name: effectiveName,
      isDirectory: isDir,
      size,
      modified,
      mimetype,
      mount,
      storageType: this.type,
      db,
    });
  }

  /**
   * 下載檔案，返回 StorageStreamDescriptor
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/request 等）
   * @returns {Promise<import("../../streaming/types.js").StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const effectiveSubPath = subPath;

    const { fileId, isDirectory, driveItem } = await this._resolvePathToFileId(effectiveSubPath || "", ctx);
    if (isDirectory) {
      throw new DriverError("無法下載目錄", { status: 400 });
    }

    const size = driveItem.size ? Number(driveItem.size) : null;
    const contentType = driveItem.mimeType || "application/octet-stream";
    const etag = driveItem.etag || null;
    const lastModified = driveItem.modifiedTime ? new Date(driveItem.modifiedTime) : null;

    return createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      fetchResponse: async (signal) => {
        return await this.apiClient.downloadFileResponse(fileId, { signal });
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        return await this.apiClient.downloadFileResponse(fileId, { signal, rangeHeader });
      },
    });
  }

  // ========== WRITER / ATOMIC 能力：uploadFile / createDirectory / remove / rename / copy ==========

  /**
   * 統一上傳入口（檔案 / 流）
   * @param {string} subPath       掛載內子路徑（subPath-only）
   * @param {any} fileOrStream     資料來源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文選項（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const { mount, contentType, contentLength, filename } = ctx;
    const fsPath = ctx?.path;

    // 統一從 subPath 推導目錄與檔名：
    // - subPath 為空或 "/" 視為根目錄
    // - subPath 以 "/" 結尾視為目錄路徑
    // - 其它情況視為完整檔案路徑，目錄為其父路徑
    let dirSubPath = "/";
    if (typeof subPath === "string") {
      const normalized = subPath || "/";
      if (normalized === "/") {
        dirSubPath = "/";
      } else if (normalized.endsWith("/")) {
        dirSubPath = normalized;
      } else {
        const segments = normalized.split("/").filter(Boolean);
        dirSubPath = segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
      }
    }

    const fileName =
      filename ||
      (typeof subPath === "string" && !subPath.endsWith("/")
        ? subPath.split("/").filter(Boolean).pop() || "unnamed"
        : typeof fsPath === "string"
          ? fsPath.split("/").filter(Boolean).pop() || "unnamed"
          : "unnamed");

    // 目錄子路徑為空或根時，parentId 指向 rootId，否則解析為對應目錄
    let parentId = this.rootId || "root";
    if (dirSubPath && dirSubPath !== "/" && dirSubPath !== "") {
      if (mount) {
        // FS 掛載檢視：嚴格要求目錄已存在
        const { fileId, isDirectory } = await this._resolvePathToFileId(dirSubPath, {
          subPath: dirSubPath,
          mount,
        });
        if (!isDirectory) {
          throw new DriverError("目標父路徑不是目錄", { status: 400 });
        }
        parentId = fileId;
      } else {
        // storage-first 檢視（分享上傳等）：按目錄鏈自動建立缺失目錄
        parentId = await this._ensureDirectoryChainForStorage(dirSubPath);
      }
    }

    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType: contentType || "application/octet-stream",
    };

    // storagePath 語義對齊：
    // - FS（mount 檢視）：返回掛載檢視的最終路徑（path + fileName）
    // - storage-first（ObjectStore/分享上傳/直傳）：返回 subPath/key（已包含檔名）
    const basePathRaw = mount
      ? fsPath
      : typeof subPath === "string" && subPath.length > 0
        ? subPath
        : fsPath;
    const basePath = String(basePathRaw || "").replace(/[\\]+/g, "/").replace(/\/+/g, "/");
    const safeFileName = String(fileName || "").trim() || "unnamed";

    let storagePath = basePath;
    if (!storagePath) {
      storagePath = safeFileName;
    } else if (isDirectoryPath(storagePath)) {
      storagePath = `${storagePath}${safeFileName}`;
    }
    storagePath = storagePath.replace(/[\\]+/g, "/").replace(/\/+/g, "/");

    // 特殊處理：空檔案（contentLength === 0）直接透過 metadata 建立
    if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength === 0) {
      const createUrl = new URL("files", "https://www.googleapis.com/drive/v3/");
      createUrl.searchParams.set("supportsAllDrives", "true");
      createUrl.searchParams.set("includeItemsFromAllDrives", "true");

      const json = await this.authManager.withAccessToken(async (token) => {
        const res = await fetch(createUrl.toString(), {
          method: "POST",
          redirect: "follow",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metadata),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new DriverError("Google Drive 建立空檔案失敗", {
            status: res.status,
            details: { response: text },
          });
        }

        const text = await res.text();
        return text ? JSON.parse(text) : null;
      });

      return {
        success: true,
        storagePath,
        message: json?.id ? `created-empty:${json.id}` : undefined,
      };
    }

    // 其餘情況：統一採用 resumable upload + 單次 PUT
    const initUrl = new URL("files", "https://www.googleapis.com/upload/drive/v3/");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("supportsAllDrives", "true");
    initUrl.searchParams.set("includeItemsFromAllDrives", "true");

    const uploadUrl = await this.authManager.withAccessToken(async (token) => {
      const res = await fetch(initUrl.toString(), {
        method: "POST",
        redirect: "follow",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": metadata.mimeType,
        },
        body: JSON.stringify(metadata),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("初始化 Google Drive 上傳會話失敗", {
          status: res.status,
          details: { response: text },
        });
      }

      const location = res.headers.get("location") || res.headers.get("Location");
      if (!location) {
        throw new DriverError("Google Drive 上傳會話未返回 Location", { status: 500 });
      }
      return location;
    });

    if (typeof contentLength !== "number" || !Number.isFinite(contentLength) || contentLength < 0) {
      throw new DriverError("GoogleDriveStorageDriver.uploadFile 需要有效的 contentLength", {
        status: 400,
      });
    }

    const body = fileOrStream;
    const end = contentLength - 1;

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(contentLength),
        "Content-Range": `bytes 0-${end}/${contentLength}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new DriverError("Google Drive 上傳檔案失敗", {
        status: res.status,
        details: { response: text },
      });
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    return {
      success: true,
      storagePath,
      message: json?.id ? `uploaded:${json.id}` : undefined,
    };
  }

  /**
   * 更新檔案內容（覆蓋寫入）
   * - 基於 Google Drive v3 files.update + uploadType=media 實現
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {string|Uint8Array|ArrayBuffer} content 新內容
   * @param {Object} ctx 上下文選項（mount/path/subPath/db/userIdOrInfo/userType/contentType 等）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) {
      throw new DriverError("GoogleDriveStorageDriver.updateFile 缺少 path 上下文（ctx.path）", {
        status: 500,
        details: { subPath },
      });
    }

    const effectiveSubPath = typeof subPath === "string" ? subPath : "";

    const { fileId, isDirectory, driveItem } = await this._resolvePathToFileId(
      effectiveSubPath || "",
      ctx,
    );
    if (isDirectory) {
      throw new DriverError("無法更新目錄內容", { status: 400 });
    }

    if (
      typeof content !== "string" &&
      !(content instanceof Uint8Array) &&
      !(content instanceof ArrayBuffer)
    ) {
      throw new DriverError("GoogleDriveStorageDriver.updateFile 僅支援字串或二進位制緩衝區內容", {
        status: 400,
      });
    }

    const body =
      typeof content === "string"
        ? content
        : content instanceof Uint8Array
          ? content
          : new Uint8Array(content);

    const contentType =
      ctx.contentType || driveItem?.mimeType || "application/octet-stream";

    const uploadUrl = new URL(
      `files/${encodeURIComponent(fileId)}`,
      "https://www.googleapis.com/upload/drive/v3/",
    );
    uploadUrl.searchParams.set("uploadType", "media");
    uploadUrl.searchParams.set("supportsAllDrives", "true");
    uploadUrl.searchParams.set("includeItemsFromAllDrives", "true");

    await this.authManager.withAccessToken(async (token) => {
      const res = await fetch(uploadUrl.toString(), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        body,
        redirect: "follow",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("Google Drive 更新檔案內容失敗", {
          status: res.status,
          details: { response: text },
        });
      }
    });

    return {
      success: true,
      path: fsPath,
      message: "Google Drive 檔案內容已更新",
    };
  }

  /**
   * 建立目錄
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const effectiveSubPath = subPath;

    const segments = this._splitPath(effectiveSubPath || "");
    if (segments.length === 0) {
      // 根目錄視為總是存在
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const parentSegments = segments.slice(0, -1);
    const dirName = segments[segments.length - 1];
    const parentPath = parentSegments.length > 0 ? `/${parentSegments.join("/")}` : "/";

    const { fileId: parentId, isDirectory } = await this._resolvePathToFileId(parentPath, {
      subPath: parentPath,
    });
    if (!isDirectory) {
      throw new DriverError("目標父路徑不是目錄", { status: 400 });
    }

    try {
      await this.apiClient.createFolder(parentId, dirName);
      return {
        success: true,
        path: fsPath,
        alreadyExists: false,
      };
    } catch (error) {
      // 當目錄已存在或命名衝突時，GoogleDriveApiClient 會丟擲 GoogleDriveApiError
      // 視為目錄已存在並返回 alreadyExists: true
      const status = typeof error?.status === "number" ? error.status : undefined;
      const code = error?.code;

      if (
        status === 409 ||
        code === "GOOGLE_DRIVE_API_ERROR" ||
        code === "fileAlreadyExists" ||
        code === "alreadyExists"
      ) {
        return {
          success: true,
          path: fsPath,
          alreadyExists: true,
        };
      }

      throw new DriverError(error?.message || "建立目錄失敗", {
        status: status || 500,
        cause: error,
        details: { fsPath, parentPath, dirName },
      });
    }
  }

  /**
   * 刪除單個路徑
   * @param {string} subPath
   * @param {Object} ctx
   */
  async remove(subPath, ctx = {}) {
    this._ensureInitialized();
    const effectiveSubPath = subPath;

    const { fileId } = await this._resolvePathToFileId(effectiveSubPath || "", ctx);
    await this.apiClient.deleteFile(fileId);
    return { success: true };
  }

  /**
   * 批次刪除路徑
   * @param {string[]} subPaths 需要刪除的子路徑陣列（subPath-only）
   * @param {Object} ctx         上下文選項（mount/paths/subPaths/db 等）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new DriverError("Google Drive batchRemoveItems 需要 ctx.paths 與 subPaths 一一對應（不做相容）", {
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
      try {
        await this.remove(itemSubPath, {
          ...ctx,
          path: fsPath,
          subPath: itemSubPath,
        });
        successCount += 1;
        results.push({ path: fsPath, success: true });
      } catch (error) {
        const message = error?.message || String(error);
        failed.push({ path: fsPath, error: message });
        results.push({ path: fsPath, success: false, error: message });
      }
    }

    return { success: successCount, failed, results };
  }

  /**
   * 基礎存在性檢查
   * - 用於上層在執行 copy/rename 等操作時進行 skipExisting 判斷
   * - 若路徑不存在或發生錯誤時返回 false，避免影響主流程
   * @param {string} subPath
   * @param {Object} ctx
   * @returns {Promise<boolean>}
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    const effectiveSubPath = subPath;

    // 掛載根路徑視為始終存在
    if (!effectiveSubPath || effectiveSubPath === "/" || effectiveSubPath === "") {
      return true;
    }

    try {
      await this._resolvePathToFileId(effectiveSubPath || "", ctx);
      return true;
    } catch (error) {
      const status = typeof error?.status === "number" ? error.status : undefined;
      const code = error?.code;

      // _resolvePathToFileId 針對不存在路徑會丟擲 404 + DRIVER_ERROR.GDRIVE.NOT_FOUND
      if (status === 404 || code === "DRIVER_ERROR.GDRIVE.NOT_FOUND") {
        return false;
      }

      // 其它異常預設視為不存在，避免中斷 skipExisting 流程
      return false;
    }
  }

  /**
   * stat 介面
   * @param {string} subPath
   * @param {Object} ctx
   * @returns {Promise<Object>}
   */
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  /**
   * 重新命名檔案或目錄
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    const { fileId, driveItem } = await this._resolvePathToFileId(oldSubPath || "", ctx);
    const segments = this._splitPath(newSubPath || "");
    const newName = segments.length > 0 ? segments[segments.length - 1] : driveItem.name;

    await this.apiClient.updateMetadata(fileId, { name: newName });

    return {
      success: true,
      source: ctx?.oldPath,
      target: ctx?.newPath,
    };
  }

  /**
   * 複製單個檔案/目錄
   * @param {string} sourceSubPath 源子路徑（subPath-only）
   * @param {string} targetSubPath 目標子路徑（subPath-only）
   * @param {Object} ctx            上下文選項（mount/sourcePath/targetPath/sourceSubPath/targetSubPath/db/...）
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;

    if (typeof sourceSubPath !== "string" || typeof targetSubPath !== "string") {
      throw new DriverError("Google Drive 複製缺少子路徑上下文（sourceSubPath/targetSubPath）", {
        status: 500,
        details: { sourcePath, targetPath },
      });
    }

    const normalize = (p) =>
      (p || "")
        .replace(/^[/\\]+|[/\\]+$/g, "")
        .replace(/[\\/]+/g, "/");

    const srcSub = normalize(sourceSubPath);
    const dstSub = normalize(targetSubPath);

    const srcPathForResolve = srcSub ? `/${srcSub}` : "/";
    const { fileId: sourceFileId, isDirectory } = await this._resolvePathToFileId(srcPathForResolve, {
      subPath: srcPathForResolve,
      mount,
    });

    // 目錄複製：在同一掛載的 Google Drive 內，直接透過 Drive API 遞迴複製目錄結構
    if (isDirectory) {
      const targetSegments = dstSub.split("/").filter(Boolean);
      if (targetSegments.length === 0) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: "目標路徑無效",
        };
      }

      const dirName = targetSegments[targetSegments.length - 1];
      const parentSegs = targetSegments.slice(0, -1);
      const parentSubPath = parentSegs.length > 0 ? `/${parentSegs.join("/")}` : "/";

      const { fileId: parentId, isDirectory: parentIsDir } = await this._resolvePathToFileId(parentSubPath, {
        subPath: parentSubPath,
        mount,
      });

      if (!parentIsDir) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: "目標父路徑不是目錄",
        };
      }

      try {
        await this._copyDriveDirectoryRecursive({
          sourceDirId: sourceFileId,
          targetParentId: parentId,
          targetDirName: dirName,
        });

        return {
          status: "success",
          source: sourcePath,
          target: targetPath,
        };
      } catch (error) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: error?.message || String(error),
        };
      }
    }

    const segments = dstSub.split("/").filter(Boolean);
    if (segments.length === 0) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "目標路徑無效",
      };
    }

    const newName = segments[segments.length - 1];
    const parentSegs = segments.slice(0, -1);
    const parentSubPath = parentSegs.length > 0 ? `/${parentSegs.join("/")}` : "/";

    const { fileId: parentId, isDirectory: parentIsDir } = await this._resolvePathToFileId(parentSubPath, {
      subPath: parentSubPath,
      mount,
    });

    if (!parentIsDir) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "目標父路徑不是目錄",
      };
    }

    try {
      await this.apiClient.copyFile(sourceFileId, {
        newName,
        parentId,
      });
      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
      };
    } catch (error) {
      // 目標已存在或命名衝突等，返回 skipped 以便任務統計
      if (error?.status === 409 || error?.code === "conflict") {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目標已存在或命名衝突",
        };
      }

      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: error?.message || String(error),
      };
    }
  }

  /**
   * 遞迴複製 Google Drive 目錄
   * - 在目標父目錄下建立同名目錄，並遞迴複製其中所有子目錄與檔案
   * @param {{ sourceDirId: string, targetParentId: string, targetDirName: string }} params
   */
  async _copyDriveDirectoryRecursive(params) {
    const { sourceDirId, targetParentId, targetDirName } = params;

    // 在目標父目錄下建立根目錄
    const created = await this.apiClient.createFolder(targetParentId, targetDirName);
    const targetDirId = created.id;

    // 深度優先遍歷源目錄
    let pageToken = undefined;
    while (true) {
      const res = await this.apiClient.listFiles(sourceDirId, {
        pageSize: 1000,
        pageToken,
      });
      const files = Array.isArray(res.files) ? res.files : [];

      for (const item of files) {
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        if (isDir) {
          await this._copyDriveDirectoryRecursive({
            sourceDirId: item.id,
            targetParentId: targetDirId,
            targetDirName: item.name,
          });
        } else {
          await this.apiClient.copyFile(item.id, {
            newName: item.name,
            parentId: targetDirId,
          });
        }
      }

      pageToken = res.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
  }

  // ========== SEARCH 能力 ==========

  /**
   * 根據 Drive 檔案項構造 FS 檢視路徑
   * - 利用 parents 鏈向上遍歷到 rootId/root，並對映到掛載路徑
   * @param {any} item
   * @param {Object} mount
   * @param {Map<string,string>} folderPathCache folderId -> FS 路徑（目錄）
   * @returns {Promise<string>} FS 檢視路徑（不保證目錄以 / 結尾）
   */
  async _buildFsPathFromDriveItem(item, mount, folderPathCache) {
    const mountPath = (mount?.mount_path || "/").replace(/\/+$/g, "") || "/";
    const names = [item.name];
    let parentId =
      Array.isArray(item.parents) && item.parents.length > 0 ? item.parents[0] : null;

    // 向上遍歷 parents 鏈，直到配置的 rootId 或頂層（My Drive / 共享盤根）
    while (parentId) {
      const cached = folderPathCache.get(parentId);
      if (cached) {
        const base = cached.replace(/\/+$/g, "") || "/";
        const rel = names.join("/");
        return `${base}/${rel}`.replace(/[\\/+]+/g, "/");
      }

      const parent = await this.apiClient.getFile(parentId, {
        fields: "id,name,parents",
      });

      const isConfiguredRoot =
        this.rootId && parent.id && String(parent.id) === String(this.rootId);
      const hasNoParents =
        !Array.isArray(parent.parents) || parent.parents.length === 0;

      // 到達 rootId 或頂層（如 My Drive 根目錄）時停止，但不把該層名稱加入路徑
      if (isConfiguredRoot || hasNoParents) {
        break;
      }

      names.unshift(parent.name);
      parentId =
        Array.isArray(parent.parents) && parent.parents.length > 0
          ? parent.parents[0]
          : null;
    }

    const relPath = names.join("/");
    const full = `${mountPath}/${relPath}`.replace(/[\\/+]+/g, "/");
    return full;
  }

  // ========== MULTIPART 能力委託（thin wrapper，委託給 GoogleDriveUploadOperations） ==========

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.initializeFrontendMultipartUpload(subPath, options);
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.completeFrontendMultipartUpload(subPath, options);
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.abortFrontendMultipartUpload(subPath, options);
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    return this.uploadOps.listMultipartUploads(subPath, options);
  }

  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.listMultipartParts(subPath, uploadId, options);
  }

  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.signMultipartParts(subPath, uploadId, partNumbers, options);
  }

  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.proxyFrontendMultipartChunk(sessionRow, body, options);
  }

  // ========== PROXY 能力 ==========

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;

    // 使用統一的代理 URL 構建邏輯，與 OneDrive/S3 等驅動保持一致
    const url = buildFullProxyUrl(request, fsPath, download);
    return {
      url,
      type: "proxy",
      channel,
    };
  }

  // ========== 可選方法：儲存統計資訊 ==========

  /**
   * 獲取儲存驅動統計資訊（可選實現）
   * - 對標 Google Drive about.get(storageQuota) 介面
   * - 當 disable_disk_usage = true 時，僅返回基礎資訊並標記不支援
   * @returns {Promise<Object>} 統計資訊
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      rootId: this.rootId,
      enableDiskUsage: this.enableDiskUsage,
      useOnlineApi: this.useOnlineApi,
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "Google Drive 磁碟佔用統計未啟用（enable_disk_usage = false）",
      };
    }

    try {
      const quota = await this.apiClient.getQuota();
      if (!quota) {
        return {
          ...base,
          supported: false,
          message: "Google Drive 未返回儲存配額資訊",
        };
      }

      const parseQuotaNumber = (value) => {
        if (value == null) return null;
        const n = Number.parseInt(String(value), 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };

      const totalBytes = parseQuotaNumber(quota.limit);
      const usedBytes = parseQuotaNumber(quota.usage) ?? parseQuotaNumber(quota.usageInDrive);
      const driveBytes = parseQuotaNumber(quota.usageInDrive);
      const trashBytes = parseQuotaNumber(quota.usageInDriveTrash);

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
          driveBytes,
          trashBytes,
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
}
