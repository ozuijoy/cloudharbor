/**
 * TelegramStorageDriver
 *
 * - share（storage-first）上傳後，返回 storagePath = vfs:<vfs_node_id>
 * - share 下載/刪除透過 vfs:<id> 反查 vfs_nodes，再按 manifest 下載/刪除索引
 *
 * - 本驅動當前不做“真實刪除 Telegram 訊息/檔案”，只做索引層刪除
 * - 大檔案分片上傳/斷點續傳在 Multipart 階段（upload_sessions + upload_parts）
 */

import { ApiStatus, UserType } from "../../../constants/index.js";
import { ValidationError, NotFoundError, DriverError } from "../../../http/errors.js";
import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { buildFileInfo, inferNameFromPath } from "../../utils/FileInfoBuilder.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getEffectiveMimeType } from "../../../utils/fileUtils.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";
import { TelegramMultipartOperations } from "./TelegramMultipartOperations.js";
import { getCachedTelegramFileInfo, setCachedTelegramFileInfo } from "./TelegramFileInfoCache.js";
import {
  batchRemoveItems as telegramBatchRemoveItems,
  buildBotApiUrl as telegramBuildBotApiUrl,
  buildBotFileUrl as telegramBuildBotFileUrl,
  copyItem as telegramCopyItem,
  deleteObjectByStoragePath as telegramDeleteObjectByStoragePath,
  getFileInfo as telegramGetFileInfo,
  normalizeApiBaseUrl,
  normalizePartList,
  renameItem as telegramRenameItem,
  resolveUploadDirAndName,
  safeJsonParse,
  sendDocument as telegramSendDocument,
  splitDirAndName,
  stripTrailingSlash,
  toPosixPath,
} from "./TelegramOperations.js";
import { resolveOwner } from "../../fs/utils/OwnerResolver.js";
import { smartWrapStreamWithByteSlice } from "../../streaming/ByteSliceStream.js";

const VFS_STORAGE_PATH_PREFIX = "vfs:";
// 直傳限制（share/表單/非分片 FS 上傳）
// - official（未勾選自建）：按“能下載/能預覽”的最保守限制走（20MB）
// - self_hosted（勾選自建）：不做硬限制
const TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL = 20 * 1024 * 1024;

// 除錯用：展示TG代理上游地址
function maskTelegramBotTokenInUrl(url) {
  const s = String(url || "");
  if (!s) return s;

  const mask = (tokenLike) => {
    const t = String(tokenLike || "");
    if (!t) return t;
    if (t.length <= 10) return "***";
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
  };

  // 覆蓋 /bot<TOKEN>/... 與 /file/bot<TOKEN>/... 等形態
  return s.replace(/(\/bot)([^/]+)/g, (_m, pfx, token) => `${pfx}${mask(token)}`);
}

export class TelegramStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "TELEGRAM";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.PROXY,
      CAPABILITIES.MULTIPART,
      CAPABILITIES.ATOMIC,
    ];

    this.botToken = null;
    this.targetChatId = null;
    this.apiBaseUrl = null;
    this.botApiMode = "official";
    // 分片大小（用於“掛載瀏覽器”的斷點續傳/分片上傳）
    // - 預設 15MB
    // - 由儲存配置 part_size_mb 控制
    this.partSizeBytes = 15 * 1024 * 1024;
    // 直傳大小上限（用於 share 流式/表單上傳、以及非分片的 FS 上傳）
    // - official：限制 20MB
    // - self_hosted：不限制
    this.directUploadMaxBytes = TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL;
    // 上傳併發閥門（限制同一 storage_config 的併發 Telegram API 呼叫數量）
    this.uploadConcurrency = 2;
    // 上傳後校驗（發完再 getFile 校驗 file_size，避免“回執成功但檔案壞/大小不對”）
    this.verifyAfterUpload = true;

    // ========== MULTIPART 能力委託 ==========
    this.uploadOps = new TelegramMultipartOperations(this);
  }

  async initialize() {
    const botTokenEncrypted = this.config?.bot_token || this.config?.botToken;
    const botToken = await decryptIfNeeded(botTokenEncrypted, this.encryptionSecret);
    const rawTargetChatId = this.config?.target_chat_id ?? this.config?.targetChatId;
    const apiBaseUrl = normalizeApiBaseUrl(this.config?.endpoint_url);
    const partSizeMb = Number(this.config?.part_size_mb ?? 15);
    const uploadConcurrency = Number(this.config?.upload_concurrency ?? 2);
    const botApiMode = String(this.config?.bot_api_mode || "official").trim().toLowerCase();
    const verifyAfterUpload = this.config?.verify_after_upload;

    if (!botToken || typeof botToken !== "string") {
      throw new DriverError("TELEGRAM 驅動缺少必填配置 bot_token", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }
    if (rawTargetChatId === null || rawTargetChatId === undefined || String(rawTargetChatId).trim() === "") {
      throw new DriverError("TELEGRAM 驅動缺少必填配置 target_chat_id", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }
    const targetChatId = String(rawTargetChatId).trim();
    if (!/^-?\d+$/.test(targetChatId)) {
      throw new DriverError("TELEGRAM 驅動 target_chat_id 必須是純數字字串（例如 -100...）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }

    this.botToken = botToken.trim();
    this.targetChatId = targetChatId;
    this.apiBaseUrl = apiBaseUrl;
    this.botApiMode = botApiMode === "self_hosted" ? "self_hosted" : "official";
    this.partSizeBytes = Number.isFinite(partSizeMb) && partSizeMb > 0 ? Math.floor(partSizeMb * 1024 * 1024) : 15 * 1024 * 1024;
    this.directUploadMaxBytes = this.botApiMode === "self_hosted" ? Infinity : TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL;
    this.uploadConcurrency = Number.isFinite(uploadConcurrency) && uploadConcurrency > 0 ? Math.floor(uploadConcurrency) : 2;
    this.verifyAfterUpload = verifyAfterUpload === false ? false : true;

    // 官方託管 Bot API 下，分片太大可能出現“能傳不能下”的坑
    // - self_hosted 模式不限制
    if (this.botApiMode !== "self_hosted" && this.partSizeBytes > 20 * 1024 * 1024) {
      throw new DriverError("TELEGRAM 配置不合理：未勾選“自建 Bot API”時（official），part_size_mb 建議 ≤ 20（否則可能出現能上傳但無法下載/預覽）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }

    this.initialized = true;
  }

  // ===== 基礎契約 =====

  async exists(subPath, ctx = {}) {
    try {
      await this.stat(subPath, ctx);
      return true;
    } catch {
      return false;
    }
  }

  async stat(subPath, ctx = {}) {
    // 這裡直接複用 getFileInfo 的查詢邏輯
    return await this.getFileInfo(subPath, ctx);
  }

  // ===== PROXY 能力 =====

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    return {
      url: buildFullProxyUrl(request || null, fsPath, download),
      type: "proxy",
      channel,
    };
  }

  supportsProxyMode() {
    return true;
  }

  getProxyConfig() {
    return { enabled: true };
  }

  // ===== 內部：VFS scope / path =====

  _getScopeFromOptions(options = {}) {
    // Telegram 的 VFS scope 按 storage_config 維度（無掛載也能寫）
    const mount = options?.mount || null;
    const scopeId = mount?.storage_config_id || this.config?.id || null;
    if (!scopeId) {
      throw new ValidationError("TELEGRAM: 缺少 scope_id（storage_config_id）");
    }
    return { scopeType: "storage_config", scopeId: String(scopeId) };
  }

  _getOwnerFromOptions(options = {}) {
    // 相容：如果上層顯式傳入 ownerType/ownerId（例如內部呼叫），仍優先使用。
    const ownerType = options?.ownerType;
    const ownerId = options?.ownerId;
    if (ownerType && ownerId) {
      return { ownerType: String(ownerType), ownerId: String(ownerId) };
    }

    const { mount, userIdOrInfo, userType } = options || {};

    // 目錄樹歸屬“storage_config”，不是“掛載”。
    // 因此優先使用 storage_config.admin_id 作為穩定 owner
    // - 沒有掛載時上傳 -> 以後建立掛載也能看到
    // - 同一個 storage_config 可被多個掛載複用
    const configAdminId = this.config?.admin_id ? String(this.config.admin_id) : null;
    if (configAdminId) {
      return { ownerType: UserType.ADMIN, ownerId: configAdminId };
    }

    // 兜底：如果歷史資料/特殊場景下 admin_id 為空，則退回 mount.created_by（掛載通常由管理員建立）
    const isTelegramMount = mount?.storage_type === this.type && !!mount;
    const mountCreatedBy = mount?.created_by ? String(mount.created_by) : null;
    if (isTelegramMount && mountCreatedBy) {
      return { ownerType: UserType.ADMIN, ownerId: mountCreatedBy };
    }

    // 最後兜底：按請求者身份對映
    return resolveOwner(userIdOrInfo, userType);
  }

  _isVfsStoragePath(path) {
    return typeof path === "string" && path.startsWith(VFS_STORAGE_PATH_PREFIX);
  }

  _parseVfsStoragePath(path) {
    if (!this._isVfsStoragePath(path)) return null;
    const id = String(path).slice(VFS_STORAGE_PATH_PREFIX.length).trim();
    return id || null;
  }

  // ===== READER 能力 =====

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.listDirectory: 缺少 db");

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const normalizedSubPath = toPosixPath(subPath || "/");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    let parentId = VFS_ROOT_PARENT_ID;

    // root 沒有節點記錄
    if (stripTrailingSlash(normalizedSubPath) !== "/") {
      const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
      if (!node) throw new NotFoundError("目錄不存在");
      if (node.node_type !== "dir") throw new ValidationError("目標不是目錄");
      parentId = String(node.id);
    }

    const children = await repo.listChildrenByParentId({ ownerType, ownerId, scopeType, scopeId, parentId });

    const basePath = fsPath;
    const items = await Promise.all(
      children.map(async (row) => {
        const isDirectory = row.node_type === "dir";
        const childPath = `${basePath.endsWith("/") ? basePath : `${basePath}/`}${row.name}${isDirectory ? "/" : ""}`;
        const info = await buildFileInfo({
          fsPath: childPath,
          name: row.name,
          isDirectory,
          size: row.size,
          modified: row.updated_at || row.created_at || null,
          mimetype: row.mime_type || null,
          mount,
          storageType: mount?.storage_type || this.type,
          db,
        });
        return { ...info, vfs_node_id: row.id };
      }),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: stripTrailingSlash(normalizedSubPath) === "/",
      mount_id: mount?.id ?? null,
      storage_type: mount?.storage_type || this.type,
      items,
    };
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.getFileInfo: 缺少 db");

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const normalizedSubPath = toPosixPath(subPath || "/");

    // root：返回虛擬目錄資訊
    if (stripTrailingSlash(normalizedSubPath) === "/") {
      return await buildFileInfo({
        fsPath,
        name: "",
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type || this.type,
        db,
      });
    }

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);
    const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
    if (!node) throw new NotFoundError("路徑不存在");

    const isDirectory = node.node_type === "dir";
    return await buildFileInfo({
      fsPath,
      name: node.name || inferNameFromPath(fsPath, isDirectory),
      isDirectory,
      size: node.size,
      modified: node.updated_at || node.created_at || null,
      mimetype: node.mime_type || null,
      mount,
      storageType: mount?.storage_type || this.type,
      db,
    });
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.downloadFile: 缺少 db");

    const repo = new VfsNodesRepository(db, null);

    let node = null;

    // storage-first：vfs:<id> 直達
    const vfsNodeId = this._parseVfsStoragePath(subPath);
    if (vfsNodeId) {
      node = await repo.getNodeByIdUnsafe(vfsNodeId);
    } else {
      // FS 掛載：按路徑解析（需要 owner/scope）
      const normalizedSubPath = toPosixPath(subPath || "/");

      const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
      const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
      node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
    }

    if (!node) throw new NotFoundError("檔案不存在");
    if (node.node_type === "dir") throw new ValidationError("不能下載目錄");

    const manifest = safeJsonParse(node.content_ref);
    const parts = normalizePartList(manifest);
    if (!parts.length) {
      throw new DriverError("TELEGRAM 檔案缺少可用的 manifest（content_ref）", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.TELEGRAM_MISSING_MANIFEST",
        expose: false,
      });
    }

    const computedSize = parts.reduce((sum, p) => sum + (Number.isFinite(p.size) ? p.size : 0), 0) || null;
    const size = Number.isFinite(Number(node.size)) ? Number(node.size) : computedSize;
    const contentType = node.mime_type || "application/octet-stream";
    const lastModified = node.updated_at ? new Date(node.updated_at) : null;

    const orderedParts = parts.slice().sort((a, b) => a.partNo - b.partNo);
    const canComputeOffsets =
      orderedParts.length > 0 &&
      orderedParts.every((p) => Number.isFinite(p.size) && Number(p.size) > 0);

    const partOffsets = canComputeOffsets
      ? (() => {
          let offset = 0;
          return orderedParts.map((p) => {
            const startOffset = offset;
            const endOffset = offset + Number(p.size) - 1;
            offset += Number(p.size);
            return { ...p, startOffset, endOffset, size: Number(p.size) };
          });
        })()
      : null;

    const driver = this;

    return {
      size,
      contentType,
      etag: null,
      lastModified,
      async getStream() {
        const aborter = new AbortController();
        const stream = new ReadableStream({
          start(controller) {
            (async () => {
              try {
                for (const part of orderedParts) {
                  if (aborter.signal.aborted) break;

                  const downloadUrl = await driver._getFileDownloadUrl(part.fileId, { signal: aborter.signal });
                  const resp = await driver._fetchTelegramDownloadResponse(
                    downloadUrl,
                    { method: "GET" },
                    { signal: aborter.signal, partNo: part.partNo },
                  );
                  if (!resp.ok || !resp.body) {
                    throw new DriverError("TELEGRAM 下載分片失敗", {
                      status: ApiStatus.BAD_GATEWAY,
                      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
                      expose: false,
                      details: { status: resp.status, partNo: part.partNo },
                    });
                  }

                  const reader = resp.body.getReader();
                  while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) controller.enqueue(value);
                  }
                }
                controller.close();
              } catch (e) {
                controller.error(e);
              }
            })();
          },
          cancel() {
            aborter.abort();
          },
        });

        return {
          stream,
          async close() {
            aborter.abort();
          },
        };
      },
      // 原生 Range（按分片定位 + 分片內軟體切片），避免“Range 從頭讀到尾”導致影片拖動巨卡
      // 只在能夠計算每片大小/偏移時開啟，否則讓 StorageStreaming 回退 ByteSlice
      async getRange(range, options = {}) {
        if (!partOffsets) {
          const handle = await this.getStream(options);
          return { ...handle, supportsRange: false };
        }
        const { start, end } = range || {};
        const startByte = Number(start);
        const endByte = Number.isFinite(Number(end)) ? Number(end) : (Number(size) > 0 ? Number(size) - 1 : Number.MAX_SAFE_INTEGER);

        const aborter = new AbortController();

        const stream = new ReadableStream({
          start(controller) {
            (async () => {
              try {
                const targets = partOffsets.filter((p) => p.endOffset >= startByte && p.startOffset <= endByte);
                for (const part of targets) {
                  if (aborter.signal.aborted) break;
                  const localStart = Math.max(0, startByte - part.startOffset);
                  const localEnd = Math.min(part.size - 1, endByte - part.startOffset);

                  const downloadUrl = await driver._getFileDownloadUrl(part.fileId, { signal: aborter.signal });
                  const headers = new Headers();
                  // 先嚐試 Range（如果 Telegram 檔案服務支援，會返回 206，省流量）
                  if (localStart > 0 || localEnd < part.size - 1) {
                    headers.set("Range", `bytes=${localStart}-${localEnd}`);
                  }
                  const resp = await driver._fetchTelegramDownloadResponse(
                    downloadUrl,
                    { method: "GET", headers },
                    { signal: aborter.signal, partNo: part.partNo },
                  );
                  if (!resp.ok || !resp.body) {
                    throw new DriverError("TELEGRAM Range 下載分片失敗", {
                      status: ApiStatus.BAD_GATEWAY,
                      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
                      expose: false,
                      details: { status: resp.status, partNo: part.partNo },
                    });
                  }

                  // Telegram 檔案服務可能忽略 Range，仍返回 200 全量，此時用軟體切片兜底
                  const bodyStream =
                    (localStart > 0 || localEnd < part.size - 1) && resp.status !== 206
                      ? smartWrapStreamWithByteSlice(resp.body, localStart, localEnd)
                      : resp.body;

                  const reader = bodyStream.getReader();
                  while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) controller.enqueue(value);
                  }
                }
                controller.close();
              } catch (e) {
                controller.error(e);
              }
            })();
          },
          cancel() {
            aborter.abort();
          },
        });

        return {
          stream,
          supportsRange: true,
          async close() {
            aborter.abort();
          },
        };
      },
    };
  }

  // ===== WRITER 能力 =====

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.createDirectory: 缺少 db");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    const fsPath = ctx?.path;
    const normalized = toPosixPath(subPath || "/");

    // root 不佔記錄，視為已存在
    if (stripTrailingSlash(normalized) === "/") {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const existing = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalized });
    if (existing) {
      if (existing.node_type !== "dir") throw new ValidationError("同名節點已存在但不是目錄");
      return { success: true, path: fsPath, alreadyExists: true };
    }

    await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: normalized });
    return { success: true, path: fsPath, alreadyExists: false };
  }

  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.uploadFile: 缺少 db");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const targetPath = toPosixPath(subPath || fsPath);

    const isDirectoryTarget =
      (typeof fsPath === "string" && fsPath.endsWith("/")) ||
      (typeof subPath === "string" && subPath.endsWith("/"));
    const { dirPath, name: inferredName } = resolveUploadDirAndName(targetPath, { isDirectoryTarget });
    const filename = ctx?.filename || inferredName || inferNameFromPath(fsPath, false) || "upload.bin";
    const contentType = ctx?.contentType || "application/octet-stream";
    const contentLength = Number(ctx?.contentLength ?? ctx?.fileSize ?? 0) || 0;

    // 直傳（share/表單/非分片 FS）
    // - official：限制 ≤20MB
    // - self_hosted：不限制
    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && contentLength && contentLength > this.directUploadMaxBytes) {
      throw new DriverError(`TELEGRAM 單次上傳過大：未勾選“自建 Bot API”時（official），直傳僅支援 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB；更大的檔案請使用“掛載瀏覽器”的分片上傳`, {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_FILE_TOO_LARGE",
        expose: true,
        details: { contentLength, directUploadMaxBytes: this.directUploadMaxBytes },
      });
    }

    const blob = await this._toBlob(fileOrStream, { contentType, filename });
    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && blob.size > this.directUploadMaxBytes) {
      throw new DriverError(`TELEGRAM 單次上傳過大：未勾選“自建 Bot API”時（official），直傳僅支援 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB；更大的檔案請使用“掛載瀏覽器”的分片上傳`, {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_FILE_TOO_LARGE",
        expose: true,
        details: { contentLength: blob.size, directUploadMaxBytes: this.directUploadMaxBytes },
      });
    }

    const sendRes = await this._sendDocument(blob, { filename, contentType });

    const manifest = {
      kind: "telegram_manifest_v1",
      storage_type: this.type,
      target_chat_id: this.targetChatId,
      parts: [
        {
          partNo: 1,
          size: blob.size,
          file_id: sendRes.fileId,
          file_unique_id: sendRes.fileUniqueId || null,
          message_id: sendRes.messageId,
          chat_id: this.targetChatId,
        },
      ],
    };

    // 1) sendDocument 成功後，只允許重試“寫索引”（vfs_nodes），不允許重試“再發一次訊息”。
    // 2) 對 DB 寫入做短暫重試
    // 3) 如果最終還是寫失敗：明確標記為不可重試（retryable=false），讓上層停止自動重試
    const MAX_INDEX_WRITE_ATTEMPTS = 6;
    const BASE_INDEX_BACKOFF_MS = 200;
    let lastIndexError = null;
    let node = null;

    for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
      try {
        // mkdir -p
        const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: dirPath });
        node = await repo.createOrUpdateFileNode({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: ensured?.parentId ?? VFS_ROOT_PARENT_ID,
          name: filename,
          mimeType: contentType,
          size: blob.size,
          storageType: this.type,
          contentRef: manifest,
        });
        lastIndexError = null;
        break;
      } catch (e) {
        lastIndexError = e;

        if (e instanceof ValidationError || e instanceof NotFoundError) {
          break;
        }

        if (attempt < MAX_INDEX_WRITE_ATTEMPTS) {
          const backoffMs = Math.min(2500, BASE_INDEX_BACKOFF_MS * Math.pow(2, attempt - 1));
          console.warn(
            `[TELEGRAM] 寫入索引失敗，將重試 (${attempt}/${MAX_INDEX_WRITE_ATTEMPTS}) filename=${filename} dir=${dirPath}:`,
            e?.message || e,
          );
          await this._sleep(backoffMs);
          continue;
        }
      }
    }

    if (!node) {
      const err = new DriverError(
        "Telegram 上傳已成功，但寫入目錄索引失敗：為避免重複上傳，已停止自動重試；請稍後手動重試一次複製/上傳。",
        {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.TELEGRAM_INDEX_WRITE_FAILED",
          expose: true,
          details: {
            filename,
            dirPath,
            fileSize: blob.size,
            messageId: sendRes?.messageId ?? null,
            fileId: sendRes?.fileId ?? null,
            cause: lastIndexError?.message || String(lastIndexError || ""),
          },
        },
      );
      err.retryable = false;
      throw err;
    }

    return {
      success: true,
      storagePath: `${VFS_STORAGE_PATH_PREFIX}${node.id}`,
      publicUrl: null,
      etag: null,
      contentType,
    };
  }

  /**
   * 更新檔案內容（覆蓋寫入）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.updateFile: 缺少 db");

    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) throw new ValidationError("TELEGRAM.updateFile: 缺少 path");

    const effectiveSubPath = typeof subPath === "string" ? subPath : "/";
    const targetPath = toPosixPath(effectiveSubPath || "/");
    const { name: inferredName } = splitDirAndName(targetPath);
    const filename = inferredName || inferNameFromPath(fsPath, false) || "file.txt";

    const contentType = getEffectiveMimeType(null, filename) || "application/octet-stream";

    const result = await this.uploadFile(effectiveSubPath || "/", content, {
      ...ctx,
      path: fsPath,
      subPath: effectiveSubPath || "/",
      contentType,
      filename,
    });

    return {
      ...result,
      success: !!result?.success,
      path: fsPath,
      message: result?.message || "檔案更新成功",
    };
  }

  // ===== MULTIPART 能力（前端分片：single_session + 後端中轉） =====

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

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    return await telegramRenameItem(this, oldSubPath, newSubPath, ctx);
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    return await telegramBatchRemoveItems(this, subPaths, ctx);
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    return await telegramCopyItem(this, sourceSubPath, targetSubPath, ctx);
  }

  // ===== storage-first：刪除物件（用於 /api/files delete_mode=both） =====

  async deleteObjectByStoragePath(storagePath, options = {}) {
    this._ensureInitialized();
    return await telegramDeleteObjectByStoragePath(this, storagePath, options);
  }

  // ===== 內部：TG Bot API） =====

  _buildBotApiUrl(method) {
    return telegramBuildBotApiUrl(this, method);
  }

  _buildBotFileUrl(filePath) {
    return telegramBuildBotFileUrl(this, filePath);
  }

  async _sendDocument(blob, { filename, contentType } = {}) {
    return await telegramSendDocument(this, blob, { filename, contentType });
  }

  async _getFileInfoUncached(fileId, options = {}) {
    return await telegramGetFileInfo(this, fileId, options);
  }

  async _getFileDownloadUrl(fileId, options = {}) {
    const info = await this._getFileInfo(fileId, options);
    const filePath = info?.filePath || null;
    if (!filePath) {
      throw new DriverError("TELEGRAM getFile 回執缺少 file_path", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
        expose: false,
        details: { fileId },
      });
    }
    let downloadUrl = this._buildBotFileUrl(filePath);
    if (this.botApiMode === "self_hosted" && fileId) {
      try {
        const u = new URL(downloadUrl);
        u.searchParams.set("file_id", String(fileId));
        downloadUrl = u.toString();
      } catch {
      }
    }
    return downloadUrl;
  }

  /**
   * Telegram 檔案下載（bot file url）的重試：
   * - 只在 429（限流）或“看起來像超時”的錯誤時重試
   * - 最多重試 2 次（也就是最多 3 次請求）
   */
  async _fetchTelegramDownloadResponse(downloadUrl, init = {}, options = {}) {
    const signal = options?.signal;
    const partNo = options?.partNo;
    const maxRetries = 2;
    const maxAttempts = 1 + maxRetries;

    const isTimeoutLikeError = (error) => {
      if (!error) return false;
      // 如果上游已經主動取消（例如使用者關閉預覽/斷開連線），不要當成“超時”重試
      if (signal?.aborted) return false;

      const name = String(error?.name || "").toUpperCase();
      const code = String(error?.code || "").toUpperCase();
      const message = String(error?.message || "").toUpperCase();

      // Node/Undici 可能出現的超時型別：UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT / TimeoutError
      if (code.includes("UND_ERR_CONNECT_TIMEOUT")) return true;
      if (code.includes("ETIMEDOUT")) return true;
      if (name.includes("TIMEOUT")) return true;
      if (message.includes("TIMEOUT")) return true;

      // AbortError：如果不是主動 abort，一般是平臺/請求超時觸發
      if (name === "ABORTERROR") return true;

      return false;
    };

    const calcBackoffMs = (attempt, retryAfterSeconds) => {
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(60_000, Math.floor(retryAfterSeconds * 1000));
      }
      // 指數退避
      return Math.min(5_000, 200 * Math.pow(2, Math.max(0, attempt - 1)));
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DriverError("請求被取消", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.ABORTED",
          expose: false,
        });
      }

      try {
        if (attempt === 1) {
          console.log(`[TELEGRAM][download] via=${maskTelegramBotTokenInUrl(downloadUrl)}${partNo != null ? ` partNo=${partNo}` : ""}`);
        }
        const resp = await fetch(downloadUrl, { ...init, signal });

        // 只對 429 做重試，其它 HTTP 狀態不自動重試
        if (resp?.status === 429 && attempt < maxAttempts) {
          try {
            await resp.body?.cancel?.();
          } catch {}

          const retryAfterHeader = resp.headers?.get?.("retry-after");
          const retryAfterSeconds = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
          const backoffMs = calcBackoffMs(attempt, retryAfterSeconds);

          console.warn(
            `[TelegramStorageDriver] Telegram 下載被限流(429)，將重試 ${attempt}/${maxAttempts}，等待 ${backoffMs}ms` +
              (partNo != null ? `，partNo=${partNo}` : ""),
          );
          await this._sleep(backoffMs, { signal });
          continue;
        }

        return resp;
      } catch (error) {
        if (isTimeoutLikeError(error) && attempt < maxAttempts) {
          const backoffMs = calcBackoffMs(attempt);
          console.warn(
            `[TelegramStorageDriver] Telegram 下載疑似超時，將重試 ${attempt}/${maxAttempts}，等待 ${backoffMs}ms` +
              (partNo != null ? `，partNo=${partNo}` : "") +
              `: ${error?.message || error}`,
          );
          await this._sleep(backoffMs, { signal });
          continue;
        }
        throw error;
      }
    }

    throw new DriverError("TELEGRAM 下載失敗（重試耗盡）", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
      expose: false,
    });
  }

  async _getFileInfo(fileId, options = {}) {
    // 先讀全域性快取：命中就直接返回，避免重複 getFile（預覽/拖動 Range 時特別有用）
    try {
      const cached = getCachedTelegramFileInfo(fileId);
      if (cached?.filePath) {
        return cached;
      }
    } catch {
      // 快取讀取失敗不影響主流程
    }

    // 回源 Telegram getFile
    const info = await this._getFileInfoUncached(fileId, options);
    try {
      setCachedTelegramFileInfo(fileId, info);
    } catch {
      // 快取寫入失敗不影響主流程
    }
    return info;
  }

  async _sleep(ms, options = {}) {
    const delay = Math.max(0, Number(ms) || 0);
    if (delay <= 0) return;

    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DriverError("請求被取消", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.ABORTED",
        expose: false,
      });
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(
              new DriverError("請求被取消", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.ABORTED",
                expose: false,
              }),
            );
          },
          { once: true },
        );
      }
    });
  }

  async _toBlob(fileOrStream, { contentType, filename }) {
    // File/Blob
    if (typeof Blob !== "undefined" && fileOrStream instanceof Blob) {
      return fileOrStream;
    }

    // ArrayBuffer / Uint8Array / Buffer
    if (fileOrStream instanceof ArrayBuffer) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }
    if (fileOrStream instanceof Uint8Array) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(fileOrStream)) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }

    // Web ReadableStream
    if (fileOrStream && typeof fileOrStream.getReader === "function") {
      const buf = await this._readWebStreamToUint8Array(fileOrStream);
      return new Blob([buf], { type: contentType || "application/octet-stream" });
    }

    // Node Readable（兜底：讀入記憶體）
    if (fileOrStream && typeof fileOrStream[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const chunk of fileOrStream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const buf = typeof Buffer !== "undefined" ? Buffer.concat(chunks) : new Uint8Array([]);
      return new Blob([buf], { type: contentType || "application/octet-stream" });
    }

    if (typeof fileOrStream === "string") {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }

    throw new ValidationError(`TELEGRAM.uploadFile: 不支援的上傳體型別（filename=${filename || ""}）`);
  }

  async _readWebStreamToUint8Array(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength || value.length || 0;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength || c.length || 0;
    }
    return out;
  }
}

export default TelegramStorageDriver;
