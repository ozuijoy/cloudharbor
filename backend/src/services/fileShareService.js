import { ApiStatus, UserType } from "../constants/index.js";
import { ValidationError, NotFoundError, DriverError } from "../http/errors.js";
import { ShareRecordService } from "./share/ShareRecordService.js";
import { StorageQuotaGuard } from "../storage/usage/StorageQuotaGuard.js";

export class FileShareService {
  constructor(db, encryptionSecret, repositoryFactory = null) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory);
    this.records = new ShareRecordService(db, encryptionSecret, repositoryFactory);
  }

  async _assertSystemMaxUploadSize(fileSizeBytes) {
    const size = Number(fileSizeBytes) || 0;
    if (size <= 0) return;

    const systemRepo = this.repositoryFactory?.getSystemRepository?.();
    if (!systemRepo) return;

    const DEFAULT_MAX_UPLOAD_SIZE_MB = 100;
    const setting = await systemRepo.getSettingMetadata("max_upload_size").catch(() => null);
    const limitMb = setting?.value ? parseInt(setting.value, 10) : DEFAULT_MAX_UPLOAD_SIZE_MB;
    const limitBytes = Number.isFinite(limitMb) ? limitMb * 1024 * 1024 : DEFAULT_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (limitBytes > 0 && size > limitBytes) {
      throw new ValidationError(`檔案大小超出系統限制（最大 ${limitMb} MB）`);
    }
  }

  async _assertShareStorageQuotaByKey({ storageConfig, storageKey, incomingBytes, context }) {
    const cfg = storageConfig;
    const key = String(storageKey || "");
    const size = Number(incomingBytes) || 0;
    if (!cfg?.id || !key || size <= 0) {
      return;
    }

    let oldBytes = null;
    try {
      const fileRepo = this.repositoryFactory.getFileRepository();
      if (cfg.storage_type) {
        const existing = await fileRepo.findByStoragePath(cfg.id, key, cfg.storage_type).catch(() => null);
        if (existing && typeof existing.size === "number" && existing.size >= 0) {
          oldBytes = existing.size;
        }
      }
    } catch {
      oldBytes = null;
    }

    await this.quota.assertCanConsume({
      storageConfigId: cfg.id,
      incomingBytes: size,
      oldBytes,
      context: context || "share",
    });
  }

  _getTelegramShareMaxDirectUploadBytes(storageConfig) {
    const mode = String(storageConfig?.bot_api_mode || "official").trim().toLowerCase();
    if (mode === "self_hosted") {
      // 自建 Bot API Server：按你的後端能力決定限制，這裡不強行限制
      return Infinity;
    }
    // 官方 Bot API：本專案約定 share 直傳只支援小檔案，避免“能傳不能下/不能預覽”的坑
    return 20 * 1024 * 1024;
  }

  _assertTelegramShareDirectUploadAllowed(storageConfig, fileSizeBytes) {
    const size = Number(fileSizeBytes) || 0;
    if (size <= 0) return;
    const maxBytes = this._getTelegramShareMaxDirectUploadBytes(storageConfig);
    if (Number.isFinite(maxBytes) && size > maxBytes) {
      throw new ValidationError(
        "Telegram 分享上傳：未勾選“自建 Bot API Server”時僅支援 ≤ 20MB；更大的檔案請用“掛載瀏覽器”的分片上傳，或勾選自建。",
      );
    }
  }

  _resolveAclSubject(userType, userIdOrInfo) {
    if (userType !== UserType.API_KEY) {
      return { subjectType: null, subjectId: null };
    }

    const subjectId =
      typeof userIdOrInfo === "string"
        ? userIdOrInfo
        : userIdOrInfo?.id ?? null;

    if (!subjectId) {
      return { subjectType: null, subjectId: null };
    }

    return { subjectType: "API_KEY", subjectId };
  }

  async resolveStorageConfig({
    storageConfigId = null,
    userType = UserType.ADMIN,
    withSecrets = false,
    subjectType = null,
    subjectId = null,
  } = {}) {
    const repo = this.repositoryFactory.getStorageConfigRepository();
    if (!repo) {
      return null;
    }
    const requirePublic = userType === UserType.API_KEY;
    const findByIdFn =
      withSecrets && typeof repo.findByIdWithSecrets === "function"
        ? repo.findByIdWithSecrets.bind(repo)
        : repo.findById.bind(repo);

    let allowedConfigIdsSet = null;

    if (
      requirePublic &&
      subjectType &&
      subjectId &&
      this.repositoryFactory?.getPrincipalStorageAclRepository
    ) {
      try {
        const aclRepo = this.repositoryFactory.getPrincipalStorageAclRepository();
        const allowedIds = await aclRepo.findConfigIdsBySubject(subjectType, subjectId);
        if (Array.isArray(allowedIds) && allowedIds.length > 0) {
          allowedConfigIdsSet = new Set(allowedIds);
        }
      } catch (error) {
        console.warn("載入儲存 ACL 失敗，將回退到僅基於 is_public 的儲存配置選擇：", error);
      }
    }

    const isAllowed = (cfg) => {
      if (!cfg) return false;
      if (requirePublic && cfg.is_public !== 1) return false;
      if (allowedConfigIdsSet && !allowedConfigIdsSet.has(cfg.id)) return false;
      return true;
    };

    // 顯式指定 ID 時優先使用該配置
    if (storageConfigId) {
      let existing = null;
      if (requirePublic && typeof repo.findPublicById === "function") {
        existing = await repo.findPublicById(storageConfigId).catch(() => null);
      } else {
        existing = await findByIdFn(storageConfigId).catch(() => null);
      }

      if (isAllowed(existing)) {
        return existing;
      }
    }

    // 其次嘗試預設配置
    let config = await repo.findDefault({ requirePublic, withSecrets }).catch(() => null);
    if (isAllowed(config)) {
      return config;
    }

    // 最後嘗試公開/全部列表中的第一個允許項
    const fallbackList = requirePublic ? await repo.findPublic().catch(() => []) : await repo.findAll().catch(() => []);
    if (!Array.isArray(fallbackList) || fallbackList.length === 0) {
      return null;
    }

    if (!allowedConfigIdsSet) {
      return fallbackList[0];
    }

    const firstAllowed = fallbackList.find((cfg) => isAllowed(cfg));
    return firstAllowed || null;
  }

  // 預簽名初始化
  async createPresignedShareUpload({
    filename,
    fileSize,
    contentType,
    path = null,
    storage_config_id = null,
    sha256 = null,
    userIdOrInfo,
    userType,
  }) {
    if (!filename) throw new ValidationError("缺少 filename");
    await this._assertSystemMaxUploadSize(fileSize);

    const { ObjectStore } = await import("../storage/object/ObjectStore.js");
    const { subjectType, subjectId } = this._resolveAclSubject(userType, userIdOrInfo);
    const cfg = await this.resolveStorageConfig({
      storageConfigId: storage_config_id,
      userType,
      subjectType,
      subjectId,
    });
    if (!cfg) throw new ValidationError("未找到可用的儲存配置，無法生成預簽名URL");

    const store = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
    const presign = await store.presignUpload({
      storage_config_id: cfg.id,
      directory: path,
      filename,
      fileSize,
      contentType,
      sha256,
    });
    if (!cfg.storage_type) throw new ValidationError("儲存配置缺少 storage_type");
    // 配額校驗：考慮覆蓋同路徑時排除舊記錄體積
    await this._assertShareStorageQuotaByKey({
      storageConfig: cfg,
      storageKey: presign.key,
      incomingBytes: Number(fileSize) || 0,
      context: "share-presign",
    });
    return {
      uploadUrl: presign.uploadUrl,
      contentType: presign.contentType,
      expiresIn: presign.expiresIn,
      key: presign.key,
      filename,
      provider_type: presign.provider_type,
      storage_config_id: presign.storage_config_id,
      headers: presign.headers || undefined,
      sha256: presign.sha256 || (sha256 ? String(sha256) : undefined),
      skipUpload: presign.skipUpload === true ? true : undefined,
    };
  }

  // 預簽名提交
  async commitPresignedShareUpload({
    key,
    storage_config_id,
    filename,
    size,
    etag,
    sha256 = null,
    slug,
    remark,
    password,
    expiresIn,
    maxViews,
    useProxy,
    originalFilename,
    userIdOrInfo,
    userType,
    request,
  }) {
    await this._assertSystemMaxUploadSize(Number(size));
    // 必須包含 key + storage_config_id
    const finalKey = key;
    const finalStorageConfigId = storage_config_id;
    if (!finalKey || !finalStorageConfigId) {
      throw new ValidationError("缺少 key 或 storage_config_id");
    }

    const { subjectType, subjectId } = this._resolveAclSubject(userType, userIdOrInfo);
    const storageConfig = await this.resolveStorageConfig({
      storageConfigId: finalStorageConfigId,
      userType,
      subjectType,
      subjectId,
    });
    if (!storageConfig) {
      throw new NotFoundError("儲存配置不存在");
    }

    await this._assertShareStorageQuotaByKey({
      storageConfig,
      storageKey: finalKey,
      incomingBytes: Number(size) || 0,
      context: "share-presign-commit",
    });

    const { ObjectStore } = await import("../storage/object/ObjectStore.js");
    const store = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
    const { getEffectiveMimeType } = await import("../utils/fileUtils.js");
    const mimeType = getEffectiveMimeType(undefined, filename);
    const commit = await store.commitUpload({
      storage_config_id: storageConfig.id,
      key: finalKey,
      filename,
      size,
      etag,
      sha256,
      contentType: mimeType,
    });

    // 根據命名策略決定是否覆蓋更新記錄
    const { shouldUseRandomSuffix } = await import("../utils/common.js");
    const useRandom = await shouldUseRandomSuffix(this.db).catch(() => false);
    return await this.records.createShareRecord({
      mount: null,
      fsPath: null,
      storageSubPath: commit.key,
      filename,
      size: Number(size) || 0,
      remark: remark || "",
      userIdOrInfo,
      userType,
      slug: slug || null,
      override: false,
      password: password || null,
      expiresInHours: Number(expiresIn) || 0,
      maxViews: Number(maxViews) || 0,
      useProxy: useProxy !== undefined ? !!useProxy : undefined,
      mimeType,
      request,
      uploadResult: commit.uploadResult,
      originalFilenameUsed: !!originalFilename,
      storageConfig,
      updateIfExists: !useRandom,
    });
  }

  // 直傳
  async uploadDirectToStorageAndShare(filename, bodyStream, fileSize, userIdOrInfo, userType, options = {}) {
    if (!filename) throw new ValidationError("缺少檔名引數");
    const normalizedSize = Number(fileSize) || 0;
    if (!bodyStream || normalizedSize <= 0) throw new ValidationError("上傳內容為空");
    await this._assertSystemMaxUploadSize(normalizedSize);
    const { ObjectStore } = await import("../storage/object/ObjectStore.js");
    const storedFilename = filename;
    const { getEffectiveMimeType } = await import("../utils/fileUtils.js");
    const mimeType = getEffectiveMimeType(options.contentType, storedFilename);

    // 選擇 storage_config：顯式優先，否則選預設（API Key 需公開 + ACL 白名單）
    const { subjectType, subjectId } = this._resolveAclSubject(userType, userIdOrInfo);
    const cfg = await this.resolveStorageConfig({
      storageConfigId: options.storage_config_id,
      userType,
      subjectType,
      subjectId,
    });
    if (!cfg) throw new ValidationError("未找到可用的儲存配置，無法上傳");

    // Telegram（Bot API）share 直傳：只支援小檔案（不走斷點續傳）
    if (String(cfg.storage_type) === "TELEGRAM") {
      this._assertTelegramShareDirectUploadAllowed(cfg, normalizedSize);
    }

    const store = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
    // 預先計算最終Key用於配額校驗（考慮命名策略與衝突重新命名）
    const plannedKey = await store.getPlannedKey(cfg.id, options.path || null, storedFilename);
    if (!cfg.storage_type) throw new ValidationError("儲存配置缺少 storage_type");
    await this._assertShareStorageQuotaByKey({
      storageConfig: cfg,
      storageKey: plannedKey,
      incomingBytes: normalizedSize,
      context: "share-upload-direct",
    });
    const result = await store.uploadDirect({
      storage_config_id: cfg.id,
      directory: options.path || null,
      filename: storedFilename,
      bodyStream,
      size: normalizedSize,
      contentType: mimeType,
      uploadId: options.uploadId || null,
      userIdOrInfo,
      userType,
    });

    const { shouldUseRandomSuffix } = await import("../utils/common.js");
    const useRandom = await shouldUseRandomSuffix(this.db).catch(() => false);
    return await this.records.createShareRecord({
      mount: null,
      fsPath: null,
      storageSubPath: result.storagePath,
      filename,
      size: normalizedSize,
      remark: options.remark || "",
      userIdOrInfo,
      userType,
      slug: options.slug || null,
      override: Boolean(options.override),
      password: options.password || null,
      expiresInHours: options.expiresIn || 0,
      maxViews: options.maxViews || 0,
      useProxy: options.useProxy,
      mimeType,
      request: options.request || null,
      uploadResult: { storagePath: result.storagePath, publicUrl: result.publicUrl, etag: result.etag },
      originalFilenameUsed: Boolean(options.originalFilename),
      storageConfig: cfg,
      updateIfExists: !useRandom,
    });
  }

  // 透過 ObjectStore + File/Blob 上傳並建立分享記錄（多儲存通用）
  async uploadFileViaObjectStoreAndShare(file, userIdOrInfo, userType, options = {}) {
    if (!file) throw new ValidationError("缺少檔案引數");
    const normalizedSize = Number(file.size ?? options.size ?? 0) || 0;
    if (normalizedSize <= 0) {
      throw new ValidationError("上傳內容為空");
    }
    await this._assertSystemMaxUploadSize(normalizedSize);

    const { ObjectStore } = await import("../storage/object/ObjectStore.js");
    const { getEffectiveMimeType } = await import("../utils/fileUtils.js");
    const storedFilename = file.name || options.filename || "upload.bin";
    const mimeType = getEffectiveMimeType(options.contentType || file.type || null, storedFilename);

    // 選擇 storage_config：顯式優先，否則選預設（API Key 需公開 + ACL 白名單）
    const { subjectType, subjectId } = this._resolveAclSubject(userType, userIdOrInfo);
    const cfg = await this.resolveStorageConfig({
      storageConfigId: options.storage_config_id,
      userType,
      subjectType,
      subjectId,
    });
    if (!cfg) throw new ValidationError("未找到可用的儲存配置，無法上傳");

    // Telegram（Bot API）share 表單上傳：只支援小檔案（不走斷點續傳）
    if (String(cfg.storage_type) === "TELEGRAM") {
      this._assertTelegramShareDirectUploadAllowed(cfg, normalizedSize);
    }

    const store = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);

    // 預先計算最終Key用於配額校驗（考慮命名策略與衝突重新命名）
    const plannedKey = await store.getPlannedKey(cfg.id, options.path || null, storedFilename);
    if (!cfg.storage_type) throw new ValidationError("儲存配置缺少 storage_type");
    await this._assertShareStorageQuotaByKey({
      storageConfig: cfg,
      storageKey: plannedKey,
      incomingBytes: normalizedSize,
      context: "share-upload-file",
    });

    const uploadResult = await store.uploadFileForShare({
      storage_config_id: cfg.id,
      directory: options.path || null,
      filename: storedFilename,
      file,
      size: normalizedSize,
      contentType: mimeType,
      uploadId: options.uploadId || null,
      userIdOrInfo,
      userType,
    });

    const { shouldUseRandomSuffix } = await import("../utils/common.js");
    const useRandom = await shouldUseRandomSuffix(this.db).catch(() => false);

    return await this.records.createShareRecord({
      mount: null,
      fsPath: null,
      storageSubPath: uploadResult.storagePath,
      filename: storedFilename,
      size: normalizedSize,
      remark: options.remark || "",
      userIdOrInfo,
      userType,
      slug: options.slug || null,
      override: Boolean(options.override),
      password: options.password || null,
      expiresInHours: options.expiresIn || 0,
      maxViews: options.maxViews || 0,
      useProxy: options.useProxy,
      mimeType,
      request: options.request || null,
      uploadResult: {
        storagePath: uploadResult.storagePath,
        publicUrl: uploadResult.publicUrl,
        etag: uploadResult.etag,
      },
      originalFilenameUsed: Boolean(options.originalFilename),
      storageConfig: cfg,
      updateIfExists: !useRandom,
    });
  }


  // 從 FS 建立分享
  async createShareFromFileSystem(fsPath, userIdOrInfo, userType, options = {}) {
    const { MountManager } = await import("../storage/managers/MountManager.js");
    const { FileSystem } = await import("../storage/fs/FileSystem.js");
    const mountManager = new MountManager(this.db, this.encryptionSecret, this.repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const fileInfo = await fileSystem.getFileInfo(fsPath, userIdOrInfo, userType);
    if (!fileInfo || fileInfo.isDirectory) {
      throw new ValidationError("只能為檔案建立分享");
    }
    const { mount, subPath } = await mountManager.getDriverByPath(fsPath, userIdOrInfo, userType);
    return await this.records.createShareRecord({
      mount,
      fsPath,
      storageSubPath: subPath || "",
      filename: fileInfo.name,
      size: fileInfo.size || 0,
      remark: options.remark || `來自檔案系統: ${fsPath}`,
      userIdOrInfo,
      userType,
      slug: options.slug || null,
      override: Boolean(options.override),
      password: options.password || null,
      expiresInHours: options.expiresIn || 0,
      maxViews: options.maxViews || 0,
      useProxy: options.useProxy,
      mimeType: fileInfo.mimetype || fileInfo.mimeType || undefined,
      request: options.request || null,
      uploadResult: null,
      originalFilenameUsed: true,
    });
  }

  // URL工具
  async validateUrlMetadata(url) {
    let metadata = null;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new ValidationError("僅支援 HTTP/HTTPS URL");
      }
      let response; let method = "HEAD"; let corsSupported = false;
      try {
        response = await fetch(url, { method: "HEAD" });
        corsSupported = response.ok;
        if (!response.ok) {
          throw new DriverError("HEAD 請求失敗", { details: { status: response.status } });
        }
      } catch {
        response = await fetch(url, { method: "GET" });
        method = "GET";
        corsSupported = response.ok;
      }
      if (!response.ok) {
        throw new DriverError("遠端服務返回錯誤狀態", {
          details: { status: response.status },
        });
      }
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const contentLength = response.headers.get("content-length");
      const lastModified = response.headers.get("last-modified");
      let filename = "";
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      if (segments.length > 0) { const last = segments[segments.length-1]; if (last.includes(".") && !last.endsWith(".")) { try { filename = decodeURIComponent(last);} catch { filename = last; } } }
      if (!filename) { const cd = response.headers.get("content-disposition"); const m = cd && cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i); if (m && m[1]) filename = m[1].replace(/['"]/g, ""); }
      if (!filename) filename = "download";
      metadata = { url, filename, contentType, size: contentLength ? parseInt(contentLength, 10) : null, lastModified, method, corsSupported };
      return metadata;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("Invalid URL")) {
        throw new ValidationError("無效的 URL 格式");
      }
      if (error instanceof DriverError) {
        throw error;
      }
      // 其它網路/上游錯誤歸類為 DriverError
      throw new DriverError("獲取 URL 元資訊失敗", {
        details: { cause: error?.message },
      });
    }
  }
  async proxyUrlContent(url) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ValidationError("僅支援 HTTP/HTTPS URL");
    }
    return await fetch(url);
  }
}

export default FileShareService;
