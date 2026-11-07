import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { generateFileId, generateUniqueFileSlug } from "../../utils/common.js";
import { getSettingMetadata } from "../systemService.js";
import { hashPassword } from "../../utils/crypto.js";
import { getEffectiveMimeType } from "../../utils/fileUtils.js";

export class ShareRecordService {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  resolveCreatedBy(userIdOrInfo, userType) {
    if (userType === UserType.ADMIN || userType === "admin") {
      return userIdOrInfo;
    }
    if (userType === UserType.API_KEY || userType === "apiKey") {
      if (typeof userIdOrInfo === "object" && userIdOrInfo?.id) return `apikey:${userIdOrInfo.id}`;
      return `apikey:${userIdOrInfo}`;
    }
    return "anonymous";
  }

  async createShareRecord({
    mount,
    fsPath,
    storageSubPath = "",
    filename,
    size,
    remark = "",
    userIdOrInfo,
    userType,
    slug,
    override = false,
    password = null,
    expiresInHours = 0,
    maxViews = 0,
    useProxy = undefined,
    mimeType,
    request = null,
    uploadResult = null,
    originalFilenameUsed = true,
    storageConfig = null,
    updateIfExists = false,
  }) {
    if (!mount?.storage_config_id && !storageConfig) {
      throw new ValidationError("缺少掛載或儲存配置，無法建立分享");
    }

    const createdBy = this.resolveCreatedBy(userIdOrInfo, userType);

    const finalSlug = await generateUniqueFileSlug(this.db, slug, override, {
      userIdOrInfo,
      userType,
      encryptionSecret: this.encryptionSecret,
      repositoryFactory: this.repositoryFactory,
      db: this.db,
    });

    const fileRepository = this.repositoryFactory.getFileRepository();

    const fileId = generateFileId();
    const now = new Date().toISOString();
    const expiresAt = expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 3600000).toISOString() : null;
    const maxViewsValue = maxViews > 0 ? maxViews : null;
    // use_proxy 預設值：優先使用顯式傳入，其次根據全域性設定 default_use_proxy 決定
    let useProxyFlag;
    if (useProxy === true) {
      useProxyFlag = 1;
    } else if (useProxy === false) {
      useProxyFlag = 0;
    } else {
      // 未顯式傳入時，根據系統設定 default_use_proxy 決定
      try {
        const setting = await getSettingMetadata(this.db, "default_use_proxy", this.repositoryFactory);
        const defaultUseProxy = setting ? setting.value === "true" : false;
        useProxyFlag = defaultUseProxy ? 1 : 0;
      } catch (error) {
        console.warn("讀取 default_use_proxy 設定失敗，使用預設直鏈模式:", error);
        useProxyFlag = 0;
      }
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const normalizedMimeType = mimeType ?? getEffectiveMimeType(undefined, filename) ?? "application/octet-stream";

    // 儲存路徑語義：
    // - FS 掛載建立分享：storageSubPath 來自 MountManager，可能帶前導 "/"，這裡統一去掉
    // - storage-first（ObjectStore/share upload）：優先使用 uploadResult.storagePath（應為物件 key）
    const relativePath = (storageSubPath || "").replace(/^\/+/u, "");
    const storagePath = mount?.storage_config_id
      ? relativePath
      : (uploadResult?.storagePath || relativePath || fsPath || filename);
    const storageType = mount?.storage_type || storageConfig?.storage_type;
    if (!storageType) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const storageConfigId = mount?.storage_config_id || storageConfig?.id;

    let finalFileId = fileId;
    let createdAt = now;
    let views = 0;

    if (updateIfExists && storageConfigId && storagePath) {
      const existing = await fileRepository.findByStoragePath(storageConfigId, storagePath, storageType).catch(() => null);
      if (existing) {
        // 更新已有記錄（覆蓋模式）：不改變 slug/created_by/created_at
        await fileRepository.updateFile(existing.id, {
          filename,
          size,
          mimetype: normalizedMimeType,
          etag: uploadResult?.etag || null,
          remark,
          expires_at: expiresAt,
          max_views: maxViewsValue,
          use_proxy: useProxyFlag,
          updated_at: now,
        });

        if (password) {
          await fileRepository.upsertFilePasswordRecord(existing.id, password);
        }

        finalFileId = existing.id;
        createdAt = existing.created_at || now;
        views = existing.views || 0;

        const fileForUrl = {
          id: existing.id,
          slug: existing.slug,
          filename,
          mimetype: normalizedMimeType,
          size,
          remark,
          created_at: createdAt,
          storage_config_id: storageConfigId,
          storage_type: storageType,
          storage_path: storagePath,
          file_path: fsPath,
          use_proxy: useProxyFlag,
          public_url: uploadResult?.publicUrl || null,
          etag: uploadResult?.etag || null,
          max_views: maxViewsValue,
          expires_at: expiresAt,
          views,
          created_by: existing.created_by,
        };

        fileForUrl.password_plain = password || null;
        return {
          id: existing.id,
          slug: existing.slug,
          filename,
          mimetype: normalizedMimeType,
          size,
          remark,
          created_at: createdAt,
          requires_password: Boolean(password || existing.password),
          views: views,
          max_views: maxViewsValue,
          expires_at: expiresAt,
          url: `/file/${existing.slug}`,
          use_proxy: useProxyFlag,
          created_by: existing.created_by,
          used_original_filename: originalFilenameUsed,
          storage_path: storagePath,
          storage_type: storageType,
        };
      }
    }

    // 新建記錄（預設或不存在時）
    await fileRepository.createFile({
      id: fileId,
      slug: finalSlug,
      filename,
      storage_config_id: storageConfigId,
      storage_type: storageType,
      storage_path: storagePath,
      file_path: fsPath,
      mimetype: normalizedMimeType,
      size,
      etag: uploadResult?.etag || null,
      remark,
      password: passwordHash,
      expires_at: expiresAt,
      max_views: maxViewsValue,
      use_proxy: useProxyFlag,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    });

    if (password) {
      await fileRepository.upsertFilePasswordRecord(fileId, password);
    }

    const fileForUrl = {
      id: fileId,
      slug: finalSlug,
      filename,
      mimetype: normalizedMimeType,
      size,
      remark,
      created_at: now,
      storage_config_id: storageConfigId,
      storage_type: storageType,
      storage_path: storagePath,
      file_path: fsPath,
      use_proxy: useProxyFlag,
      public_url: uploadResult?.publicUrl || null,
      etag: uploadResult?.etag || null,
      max_views: maxViewsValue,
      expires_at: expiresAt,
      views: 0,
      created_by: createdBy,
      password_plain: password || null,
    };

    const response = {
      id: fileId,
      slug: finalSlug,
      filename,
      mimetype: normalizedMimeType,
      size,
      remark,
      created_at: now,
      requires_password: Boolean(password),
      views: 0,
      max_views: maxViewsValue,
      expires_at: expiresAt,
      // 分享頁 URL，前端透過該地址進入 fileshare 檢視
      url: `/file/${finalSlug}`,
      use_proxy: useProxyFlag,
      created_by: createdBy,
      used_original_filename: originalFilenameUsed,
      storage_path: storagePath,
      storage_type: storageType,
    };

    return response;
  }
}
