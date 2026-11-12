/**
 * ObjectStore: 獨立於掛載系統的“儲存直傳”服務層
 * 只負責以 storage-first 方式對接底層驅動（S3 等）以完成：預簽名、直傳、提交
 * 不做許可權判定、記錄建檔，這些由上層服務處理
 */

import { StorageFactory } from "../factory/StorageFactory.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { shouldUseRandomSuffix, getFileNameAndExt, generateShortId } from "../../utils/common.js";
import { ValidationError, NotFoundError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { PathPolicy } from "../../services/share/PathPolicy.js";
import { resolveStorageLinks } from "./ObjectLinkStrategy.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";

export class ObjectStore {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.storageConfigRepo = repositoryFactory.getStorageConfigRepository?.();
  }

  async _getStorageConfig(storage_config_id) {
    if (!storage_config_id) {
      throw new ValidationError("缺少 storage_config_id");
    }
    // 優先讀取帶金鑰版本，確保驅動初始化可用
    let storageConfig = null;
    if (this.storageConfigRepo?.findByIdWithSecrets) {
      storageConfig = await this.storageConfigRepo.findByIdWithSecrets(storage_config_id);
    } else {
      storageConfig = await this.storageConfigRepo.findById(storage_config_id);
    }
    if (!storageConfig) {
      throw new NotFoundError("儲存配置不存在");
    }
    return storageConfig;
  }

  async _composeKeyWithStrategy(storageConfig, directory, filename) {
    // 統一約定：storage_config.default_folder 僅作為“檔案上傳頁/分享上傳”的預設目錄字首；
    // 重要約定：directory 只能是“目錄”，不要把檔名也塞進來。
    // 否則會生成類似 a/file.txt/file.txt 的錯誤路徑，後續下載會 404。
    const normalizedDir = PathPolicy.normalizeFragment(directory);
    const normalizedFilename = PathPolicy.normalizeFragment(filename);
    if (normalizedDir && normalizedFilename) {
      const segs = normalizedDir.split("/").filter(Boolean);
      if (segs.length && segs[segs.length - 1] === normalizedFilename) {
        throw new ValidationError(
          `directory 引數只能填目錄（不要包含檔名）。收到: directory="${directory}", filename="${filename}"`,
        );
      }
    }

    const dir = PathPolicy.composeDirectory(storageConfig.default_folder, directory);
    let key = dir ? `${dir}/${filename}` : filename;

    // 命名策略：隨機字尾模式時，如發生衝突，則為物件Key加短ID字尾（DB層衝突檢測）
    try {
      // 無 db 時無法讀取系統設定
      if (!this.db) return key;

      const useRandom = await shouldUseRandomSuffix(this.db).catch(() => false);
      if (useRandom) {
        const fileRepo = this.repositoryFactory.getFileRepository();
        if (!storageConfig.storage_type) throw new ValidationError("儲存配置缺少 storage_type");
        const exists = await fileRepo.findByStoragePath(storageConfig.id, key, storageConfig.storage_type);
        if (exists) {
          const { name, ext } = getFileNameAndExt(filename);
          const shortId = generateShortId();
          const dirOnly = dir ? `${dir}/` : "";
          key = `${dirOnly}${name}-${shortId}${ext}`;
        }
      }
    } catch {}

    return key;
  }

  // 公開：根據策略返回計劃使用的物件Key（不產生副作用）
  async getPlannedKey(storage_config_id, directory, filename) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    return await this._composeKeyWithStrategy(storageConfig, directory, filename);
  }

  async presignUpload({ storage_config_id, directory, filename, fileSize, contentType, sha256 = null, multipart = false }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);

    // 分片預簽名（分享上傳的大檔）：驅動支援時回傳每片 URL，由瀏覽器分片直傳
    if (multipart && typeof driver.generateMultipartUploadUrls === "function") {
      const mp = await driver.generateMultipartUploadUrls(key, {
        path: key,
        subPath: key,
        fileName: filename,
        fileSize,
        contentType,
        sha256: sha256 || undefined,
      });
      return {
        multipart: true,
        mode: mp.mode,
        presignedUrls: mp.presignedUrls || [],
        partSize: mp.partSize,
        completionUrl: mp.completionUrl || null,
        urlTtlSeconds: mp.urlTtlSeconds || null,
        uploadUrl: null,
        key,
        filename,
        contentType: mp.contentType || contentType,
        storage_config_id,
        provider_type: storageConfig.provider_type,
        sha256: mp.sha256 || sha256 || undefined,
        skipUpload: mp.skipUpload === true ? true : undefined,
      };
    }

    if (typeof driver.generateUploadUrl !== "function" || (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.DIRECT_LINK))) {
      throw new ValidationError("當前儲存驅動不支援預簽名上傳");
    }

    const presign = await driver.generateUploadUrl(key, {
      path: key,
      subPath: key,
      fileName: filename,
      fileSize,
      contentType,
      sha256: sha256 || undefined,
    });

    return {
      uploadUrl: presign.uploadUrl,
      key,
      filename,
      contentType: presign.contentType,
      expiresIn: presign.expiresIn,
      storage_config_id,
      provider_type: storageConfig.provider_type,
      headers: presign.headers || undefined,
      sha256: presign.sha256 || sha256 || undefined,
      skipUpload: presign.skipUpload === true ? true : undefined,
    };
  }

  async uploadDirect({ storage_config_id, directory, filename, bodyStream, size, contentType, uploadId = null, userIdOrInfo = null, userType = null }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    // 僅允許具備寫入能力且支援檔案上傳的驅動使用 upload-direct
    if (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.WRITER)) {
      throw new ValidationError("當前儲存驅動不具備寫入能力，無法使用 upload-direct 介面");
    }
    if (typeof driver.uploadFile !== "function") {
      throw new ValidationError("當前儲存驅動不支援檔案直傳");
    }

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);

    const result = await driver.uploadFile(key, /** @type {any} */ (bodyStream), {
      path: key,
      subPath: key,
      db: this.db,
      contentType,
      contentLength: size,
      uploadId: uploadId || undefined,
      userIdOrInfo,
      userType,
    });

    // 觸發與儲存配置相關的快取失效（清理URL快取，聯動關聯掛載目錄快取）
    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-direct", db: this.db });
    } catch {}

    return {
      key,
      storagePath: result.storagePath || key,
      publicUrl: result.publicUrl || null,
      etag: result.etag || null,
      contentType: result.contentType || contentType,
      storage_config_id,
    };
  }

  /**
   * 基於 File/Blob 的統一上傳（用於分享上傳，多儲存通用，預設按“表單上傳”語義處理）
   * @param {Object} params
   * @param {string} params.storage_config_id
   * @param {string|null} params.directory
   * @param {string} params.filename
   * @param {File|Blob|ArrayBuffer|Uint8Array|Buffer|string} params.file
   * @param {number} params.size
   * @param {string|null} params.contentType
   */
  async uploadFileForShare({ storage_config_id, directory, filename, file, size, contentType, uploadId = null, userIdOrInfo = null, userType = null }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.WRITER)) {
      throw new ValidationError("當前儲存驅動不具備寫入能力");
    }
    if (typeof driver.uploadFile !== "function") {
      throw new ValidationError("當前儲存驅動不支援檔案上傳");
    }

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);

    // 分享上傳透過 /share/upload 走表單(multipart)通道，這裡保持 File/Blob 語義，交由驅動走表單上傳路徑
    const result = await driver.uploadFile(key, file, {
      path: key,
      subPath: key,
      db: this.db,
      contentType: contentType || undefined,
      contentLength: size,
      uploadId: uploadId || undefined,
      userIdOrInfo,
      userType,
    });

    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-share-file", db: this.db });
    } catch {}

    return {
      key,
      storagePath: result.storagePath || key,
      publicUrl: result.publicUrl || null,
      etag: result.etag || null,
      contentType: result.contentType || contentType,
      storage_config_id,
    };
  }

  async commitUpload({ storage_config_id, key, filename, size, etag, sha256 = null, contentType = null, multipart = null }) {
    // 物件儲存提交階段：
    // 大部分驅動（S3 等）：無需再與雲端互動（直傳/預簽名 PUT 已完成寫入），這裡只做建檔
    // 少數驅動（HuggingFace 等）：還需要一次“登記/提交”，讓倉庫樹裡能看見檔案
    let uploadResult = {
      storagePath: key,
      publicUrl: null,
      etag: etag || null,
    };

    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig?.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }

    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    // 分片上傳：先合併分片，再做驅動的登記/提交
    if (multipart && typeof multipart === "object" && multipart.completionUrl) {
      if (typeof driver.completeMultipartUploadUrls !== "function") {
        throw new ValidationError("當前儲存驅動不支援分片上傳完成");
      }
      await driver.completeMultipartUploadUrls(key, {
        path: key,
        subPath: key,
        sha256: sha256 || undefined,
        completionUrl: multipart.completionUrl,
        parts: Array.isArray(multipart.parts) ? multipart.parts : [],
      });
    }

    if (typeof driver.handleUploadComplete === "function") {
      const result = await driver.handleUploadComplete(key, {
        path: key,
        subPath: key,
        db: this.db,
        fileName: filename,
        fileSize: Number(size) || 0,
        contentType: contentType || undefined,
        etag: etag || undefined,
        sha256: sha256 || undefined,
      });

      uploadResult = {
        storagePath: result?.storagePath || key,
        publicUrl: result?.publicUrl || null,
        etag: etag || null,
      };
    }

    // 通知快取失效（上傳完成）
    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-complete", db: this.db });
    } catch {}

    return {
      key,
      uploadResult,
      filename,
      size: Number(size) || 0,
      storage_config_id,
    };
  }

  // 生成預覽/下載連結（storage-first 場景）
  async generateLinksByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const links = await resolveStorageLinks({
      driver,
      storageConfig,
      path: key,
      request: options.request || null,
      forceDownload: options.forceDownload || false,
      userType: options.userType || null,
      userId: options.userId || null,
    });

    return {
      preview: links.preview,
      download: links.download,
      proxyPolicy: links.proxyPolicy || null,
    };
  }

  /**
   * 按儲存路徑進行真實檔案下載代理
   * - storage-first 檢視下的“本機代理”能力
   * - 封裝 driver 初始化與 downloadFile 呼叫，供分享層複用
   */
  async downloadByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.downloadFile !== "function") {
      throw new ValidationError("當前驅動不支援按儲存路徑下載");
    }

    const request = options.request || null;

    return await driver.downloadFile(key, {
      path: key,
      subPath: key,
      db: this.db,
      request,
    });
  }

  // 刪除儲存物件（storage-first）
  async deleteByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("儲存配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.deleteObjectByStoragePath === "function") {
      await driver.deleteObjectByStoragePath(key, options);
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "delete-object", db: this.db });
      return { success: true };
    }

    if (typeof driver.batchRemoveItems === "function") {
      await driver.batchRemoveItems([key], { paths: [key], subPaths: [key], db: this.db, ...options });
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "delete-object", db: this.db });
      return { success: true };
    }

    throw new ValidationError("當前驅動不支援按儲存路徑刪除");
  }
}

export default ObjectStore;
