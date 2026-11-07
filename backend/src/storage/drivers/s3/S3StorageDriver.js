/**
 * S3儲存驅動實現協調各個操作模組提供統一的儲存介面
 * 實現所有能力介面
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { createS3Client, generateCustomHostDirectUrl } from "./utils/s3Utils.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { normalizeS3SubPath, isCompleteFilePath } from "./utils/S3PathUtils.js";
import { updateMountLastUsed } from "../../fs/utils/MountResolver.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { S3DriverError, AppError } from "../../../http/errors.js";

// 匯入各個操作模組
import { S3FileOperations } from "./operations/S3FileOperations.js";
import { S3DirectoryOperations } from "./operations/S3DirectoryOperations.js";
import { S3BatchOperations } from "./operations/S3BatchOperations.js";
import { S3UploadOperations } from "./operations/S3UploadOperations.js";
export class S3StorageDriver extends BaseDriver {
  /**
   * 建構函式
   * @param {Object} config - S3配置物件
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "S3";
    this.encryptionSecret = encryptionSecret;
    this.s3Client = null;
    this.customHost = config.custom_host || null;


    // S3儲存驅動支援所有能力
    this.capabilities = [
      CAPABILITIES.READER, // 讀取能力：list, get, getInfo
      CAPABILITIES.WRITER, // 寫入能力：put, mkdir, remove
      CAPABILITIES.DIRECT_LINK, // 直鏈能力（custom_host/預簽名等）：generateDownloadUrl/generateUploadUrl
      CAPABILITIES.MULTIPART, // 分片上傳能力：multipart upload
      CAPABILITIES.ATOMIC, // 原子操作能力：rename, copy
      CAPABILITIES.PROXY, // 代理能力：generateProxyUrl
      CAPABILITIES.PAGED_LIST, // 目錄分頁能力：S3 ListObjectsV2 天然分頁（ContinuationToken）
    ];

    // 操作模組例項
    this.fileOps = null;
    this.directoryOps = null;
    this.batchOps = null;
    this.uploadOps = null;
    this.backendMultipartOps = null;
  }

  /**
   * 將底層異常標準化為 S3DriverError（統一 error model）
   * 保留必要上下文，避免洩露敏感值
   */
  _asDriverError(error, message, extra = {}) {
    try {
      const base = {
        provider: this?.config?.provider_type,
        bucket: this?.config?.bucket_name,
        region: this?.config?.region,
        endpoint: this?.config?.endpoint_url,
      };
      return new S3DriverError(message, { details: { ...base, ...extra, cause: error?.message } });
    } catch (_) {
      return new S3DriverError(message);
    }
  }

  _rethrow(error, message, extra = {}) {
    if (error instanceof AppError) {
      return error;
    }
    return this._asDriverError(error, message, extra);
  }

  /**
   * 初始化S3儲存驅動
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // 建立S3客戶端
      this.s3Client = await createS3Client(this.config, this.encryptionSecret);

      // 初始化各個操作模組
      this.fileOps = new S3FileOperations(this.s3Client, this.config, this.encryptionSecret, this);
      this.directoryOps = new S3DirectoryOperations(this.s3Client, this.config, this.encryptionSecret);
      this.batchOps = new S3BatchOperations(this.s3Client, this.config, this.encryptionSecret);
      this.uploadOps = new S3UploadOperations(this.s3Client, this.config, this.encryptionSecret);
      // this.backendMultipartOps = new S3BackendMultipartOperations(this.s3Client, this.config, this.encryptionSecret); // 已廢棄，使用前端分片上傳

      this.initialized = true;
      console.log(`S3儲存驅動初始化成功: ${this.config.name} (${this.config.provider_type})`);
    } catch (error) {
      console.error("S3儲存驅動初始化失敗:", error);
      throw this._rethrow(error, "S3儲存驅動初始化失敗");
    }
  }

  /**
   * 列出目錄內容
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/...）
   * @returns {Promise<Object>} 目錄內容
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, true);

    // 更新掛載點的最後使用時間
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委託給目錄操作模組，傳遞所有選項引數
      return await this.directoryOps.listDirectory(s3SubPath, {
        mount,
        subPath, // 使用正確的子路徑用於快取鍵生成
        path: fsPath,
        db,
        ...ctx,
      });
    } catch (error) {
      throw this._rethrow(error, "列出目錄失敗");
    }
  }

  /**
   * 獲取檔案資訊
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/...）
   * @returns {Promise<Object>} 檔案資訊
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db, userType, userId, request } = ctx;
    const fsPath = ctx?.path;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新掛載點的最後使用時間
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    // 特殊處理：當s3SubPath為空字串時（訪問掛載點根目錄），直接作為目錄處理，跳過檔案檢查
    // 因為S3物件Key不能為空字串，所以空字串永遠不可能是有效的檔案
    if (s3SubPath === "") {
      console.log(`getFileInfo - 檢測到掛載點根目錄訪問，直接作為目錄處理: ${fsPath}`);
      return await this.directoryOps.getDirectoryInfo(s3SubPath, {
        mount,
        path: fsPath,
      });
    }

    try {
      // 首先嚐試作為檔案獲取資訊
      return await this.fileOps.getFileInfo(s3SubPath, {
        mount,
        path: fsPath,
        userType,
        userId,
        request,
        db,
      });
    } catch (error) {
      if (error.status === ApiStatus.NOT_FOUND) {
        // 如果檔案不存在，嘗試作為目錄處理
        try {
          return await this.directoryOps.getDirectoryInfo(s3SubPath, {
            mount,
            path: fsPath,
          });
        } catch (dirError) {
          // 如果目錄也不存在，丟擲原始錯誤
          throw this._rethrow(error, "獲取資源資訊失敗");
        }
      }
      throw this._rethrow(error, "獲取資源資訊失敗");
    }
  }

  /**
   * 下載檔案
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/request/...）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>} 流描述物件
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db, request } = ctx;
    const fsPath = ctx?.path;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新掛載點的最後使用時間（僅在有掛載點上下文時）
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    // 提取檔名
    const fileName = typeof fsPath === "string" ? fsPath.split("/").filter(Boolean).pop() || "file" : "file";

    try {
      // 委託給檔案操作模組
      return await this.fileOps.downloadFile(s3SubPath, fileName, request);
    } catch (error) {
      throw this._rethrow(error, "下載檔案失敗");
    }
  }

  /**
   * 統一上傳入口（檔案 / 流）
   * - 外部只呼叫此方法，內部根據資料型別選擇流式或表單實現
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();

    const isNodeStream = fileOrStream && (typeof fileOrStream.pipe === "function" || fileOrStream.readable);
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    // 有 Stream 能力時優先走“流式上傳”路徑
    if (isNodeStream || isWebStream) {
      return await this.uploadStream(subPath, fileOrStream, ctx);
    }

    // 其它情況按“表單上傳”（一次性完整緩衝後上傳）處理
    return await this.uploadForm(subPath, fileOrStream, ctx);
  }

  /**
   * 內部流式上傳實現
   */
  async uploadStream(subPath, stream, ctx = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType, filename, contentType, contentLength, uploadId } = ctx;
    const fsPath = ctx?.path || "";

    const s3SubPath = normalizeS3SubPath(subPath, false);
    const s3Key = this._normalizeFilePath(s3SubPath, fsPath, filename);

    // 統一交由 S3UploadOperations.uploadStream 使用 Upload 處理流式上傳，
    // 包含自動的單請求/多分片選擇和進度回撥
    try {
      return await this.uploadOps.uploadStream(s3Key, /** @type {any} */ (stream), {
        mount,
        db,
        userIdOrInfo,
        userType,
        filename,
        contentType,
        contentLength,
        uploadId,
      });
    } catch (error) {
      throw this._rethrow(error, "流式上傳失敗");
    }
  }

  /**
   * 內部表單上傳實現（一次性讀入記憶體）
   */
  async uploadForm(subPath, fileOrData, ctx = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType, filename, contentType } = ctx;
    const fsPath = ctx?.path || "";

    const s3SubPath = normalizeS3SubPath(subPath, false);
    const s3Key = this._normalizeFilePath(s3SubPath, fsPath, filename);

    try {
      return await this.uploadOps.uploadForm(s3Key, /** @type {any} */ (fileOrData), {
        mount,
        db,
        userIdOrInfo,
        userType,
        filename,
        contentType,
      });
    } catch (error) {
      throw this._rethrow(error, "表單上傳失敗");
    }
  }

  /**
   * 建立目錄
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/...）
   * @returns {Promise<Object>} 建立結果
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, true);

    // 更新掛載點的最後使用時間
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委託給目錄操作模組
      return await this.directoryOps.createDirectory(s3SubPath, {
        mount,
        subPath,
        path: fsPath,
      });
    } catch (error) {
      throw this._rethrow(error, "建立目錄失敗");
    }
  }

  /**
   * 重新命名檔案或目錄
   * @param {string} oldSubPath - 原子路徑（subPath-only）
   * @param {string} newSubPath - 新子路徑（subPath-only）
   * @param {Object} ctx - 上下文（oldPath/newPath/oldSubPath/newSubPath/mount/db/...）
   * @returns {Promise<Object>} 重新命名結果
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();

    try {
      // 委託給批次操作模組
      return await this.batchOps.renameItem(oldSubPath, newSubPath, ctx);
    } catch (error) {
      throw this._rethrow(error, "重新命名失敗");
    }
  }

  /**
   * 批次刪除檔案
   * @param {Array<string>} subPaths - 子路徑陣列（subPath-only）
   * @param {Object} ctx - 上下文（paths/subPaths/mount/db/...）
   * @returns {Promise<Object>} 批次刪除結果
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();

    try {
      // 委託給批次操作模組
      return await this.batchOps.batchRemoveItems(subPaths, ctx);
    } catch (error) {
      throw this._rethrow(error, "批次刪除失敗");
    }
  }

  /**
   * 透過儲存路徑直接刪除物件（storage-first 場景）
   * @param {string} storagePath - 物件 Key
   * @param {Object} options - 擴充套件選項（預留）
   * @returns {Promise<Object>} 刪除結果
   */
  async deleteObjectByStoragePath(storagePath, options = {}) {
    this._ensureInitialized();

    try {
      const params = {
        Bucket: this.config.bucket_name,
        Key: storagePath,
      };
      const cmd = new DeleteObjectCommand(params);
      await this.s3Client.send(cmd);
      return { success: true };
    } catch (error) {
      throw this._rethrow(error, "刪除物件失敗");
    }
  }

  /**
   * 複製檔案或目錄
   * @param {string} sourceSubPath - 源子路徑（subPath-only）
   * @param {string} targetSubPath - 目標子路徑（subPath-only）
   * @param {Object} ctx - 上下文（sourcePath/targetPath/sourceSubPath/targetSubPath/...）
   * @returns {Promise<Object>} 複製結果
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    try {
      // 委託給批次操作模組
      return await this.batchOps.copyItem(sourceSubPath, targetSubPath, ctx);
    } catch (error) {
      throw this._rethrow(error, "複製失敗");
    }
  }

  /**
   * 生成預簽名下載URL
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/request/...）
   * @returns {Promise<Object>} 預簽名URL資訊
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      const { expiresIn, forceDownload, userType, userId, mount } = ctx;
      return await this.fileOps.generateDownloadUrl(s3SubPath, {
        expiresIn,
        forceDownload,
        userType,
        userId,
        mount,
      });
    } catch (error) {
      throw this._rethrow(error, "生成下載URL失敗");
    }
  }

  /**
   * 上游 HTTP 能力：為 S3 生成可由反向代理/Worker 直接訪問的上游請求資訊
   * - 基於現有 generateDownloadUrl 生成預簽名 URL
   * - headers 通常為空或僅包含補充標頭
   * @param {string} path - 檔案路徑（FS 檢視路徑或 storage_path）
   * @param {Object} [options] - 選項引數
   * @returns {Promise<{ url: string, headers: Record<string,string[]> }>}
   */
  async generateUpstreamRequest(path, options = {}) {
    this._ensureInitialized();

    const { subPath, expiresIn, forceDownload = true, userType, userId, mount } = options;

    // 對於 FS 場景優先使用 subPath（掛載內相對路徑），storage-first 場景則使用傳入的 path 作為物件 Key
    const effectiveSubPath = subPath != null ? subPath : path;

    const downloadInfo = await this.generateDownloadUrl(effectiveSubPath, {
      path,
      subPath: effectiveSubPath,
      expiresIn,
      forceDownload,
      userType,
      userId,
      mount,
    });

    const url = downloadInfo?.url || null;

    /** @type {Record<string,string[]>} */
    const headers = {};

    return {
      url,
      headers,
    };
  }

  /**
   * 生成預簽名上傳URL
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/fileName/...）
   * @returns {Promise<Object>} 預簽名URL資訊
   */
  async generateUploadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const s3SubPath = normalizeS3SubPath(subPath, false);

    if (db && mount?.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      const { fileName, fileSize, expiresIn } = ctx;
      return await this.uploadOps.generateUploadUrl(s3SubPath, {
        fileName,
        fileSize,
        expiresIn,
      });
    } catch (error) {
      throw this._rethrow(error, "生成上傳URL失敗");
    }
  }

  /**
   * 處理上傳完成後的邏輯（用於預簽名上傳後端對齊）
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文 { mount, path, subPath, db, fileName, fileSize, contentType, etag }
   * @returns {Promise<Object>} 處理結果
   */
  async handleUploadComplete(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db, fileName, fileSize, contentType, etag } = ctx;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      const result = await this.uploadOps.handleUploadComplete(s3SubPath, {
        mount,
        db,
        fileName,
        fileSize,
        contentType,
        etag,
      });

      // 更新掛載點的最後使用時間
      if (db && mount?.id) {
        await updateMountLastUsed(db, mount.id);
      }

      return result;
    } catch (error) {
      throw this._rethrow(error, "處理上傳完成失敗");
    }
  }

  /**
   * 更新檔案內容
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {string} content - 新內容
   * @param {Object} ctx - 上下文（mount/path/subPath/db/...）
   * @returns {Promise<Object>} 更新結果
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 提取檔名
    const fileName =
      (typeof fsPath === "string" && fsPath ? fsPath.split("/").filter(Boolean).pop() : null) ||
      (typeof subPath === "string" && subPath ? subPath.split("/").filter(Boolean).pop() : null) ||
      "file";

    // 委託給檔案操作模組
    const result = await this.fileOps.updateFile(s3SubPath, content, {
      fileName,
    });

    // 更新掛載點的最後使用時間
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    const resolvedPath =
      typeof fsPath === "string" && fsPath
        ? fsPath
        : typeof result?.path === "string" && result.path
          ? result.path
          : typeof subPath === "string"
            ? subPath
            : "";

    return {
      ...result,
      path: resolvedPath,
    };
  }


  /**
   * 檢查路徑是否存在
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（mount/path/subPath/db/...）
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委託給檔案操作模組檢查存在性
      const exists = await this.fileOps.exists(s3SubPath);
      if (db && mount?.id) {
        await updateMountLastUsed(db, mount.id);
      }
      return exists;
    } catch (error) {
      throw this._rethrow(error, "存在性檢查失敗");
    }
  }

  // ===== 可選能力：目錄分頁 =====
  // S3 的 ListObjectsV2 天然分頁（MaxKeys<=1000 + NextContinuationToken）。
  // - UI 列目錄：可以按頁返回，避免一次性返回太多導致卡頓
  // - 索引重建：可以按頁迭代，避免漏資料
  supportsDirectoryPagination() {
    return true;
  }

  /**
   * 獲取儲存統計資訊
   * @returns {Promise<Object>} 統計資訊
   */
  async getStats() {
    this._ensureInitialized();

    return {
      type: this.type,
      provider: this.config.provider_type,
      bucket: this.config.bucket_name,
      endpoint: this.config.endpoint_url,
      region: this.config.region || "auto",
      initialized: this.initialized,
    };
  }

  /**
   * 清理資源
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.s3Client = null;
    this.fileOps = null;
    this.directoryOps = null;
    this.batchOps = null;
    this.uploadOps = null;
    this.initialized = false;
    console.log(`S3儲存驅動已清理: ${this.config.name}`);
  }

  /**
   * 初始化前端分片上傳（生成預簽名URL列表）
   * @param {string} subPath - 子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 初始化結果
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { fileName, fileSize, partSize = 5 * 1024 * 1024, partCount, mount, db, userIdOrInfo, userType } = options;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委託給上傳操作模組
      return await this.uploadOps.initializeFrontendMultipartUpload(s3SubPath, {
        fileName,
        fileSize,
        partSize,
        partCount,
        mount,
        db,
        userIdOrInfo,
        userType,
        rawSubPath: subPath,
      });
    } catch (error) {
      throw this._rethrow(error, "初始化分片上傳失敗");
    }
  }

  /**
   * 完成前端分片上傳
   * @param {string} subPath - 子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 完成結果
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, parts, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委託給上傳操作模組
      return await this.uploadOps.completeFrontendMultipartUpload(s3SubPath, {
        uploadId,
        parts,
        fileName,
        fileSize,
        mount,
        db,
        userIdOrInfo,
        userType,
      });
    } catch (error) {
      throw this._rethrow(error, "完成分片上傳失敗");
    }
  }

  /**
   * 中止前端分片上傳
   * @param {string} subPath - 子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 中止結果
   */
  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, fileName, mount, db, userIdOrInfo, userType } = options;

    // 規範化S3子路徑
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委託給上傳操作模組
      return await this.uploadOps.abortFrontendMultipartUpload(s3SubPath, {
        uploadId,
        fileName,
        mount,
        db,
        userIdOrInfo,
        userType,
      });
    } catch (error) {
      throw this._rethrow(error, "中止分片上傳失敗");
    }
  }

  /**
   * 列出進行中的分片上傳
   * @param {string} subPath - 子路徑（可選，用於過濾特定檔案的上傳）
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 進行中的上傳列表
   */
  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 更新掛載點的最後使用時間
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委託給上傳操作模組
      // subPath 是“FS 檢視的相對路徑”，用於過濾 upload_sessions.fs_path 字首
      return await this.uploadOps.listMultipartUploads(subPath, options);
    } catch (error) {
      throw this._rethrow(error, "列出進行中的分片上傳失敗");
    }
  }

  /**
   * 列出已上傳的分片
   * @param {string} subPath - 子路徑
   * @param {string} uploadId - 上傳ID
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 已上傳的分片列表
   */
  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 更新掛載點的最後使用時間
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委託給上傳操作模組
      return await this.uploadOps.listMultipartParts(subPath, uploadId, options);
    } catch (error) {
      throw this._rethrow(error, "列出已上傳分片失敗");
    }
  }

  /**
   * 為現有上傳重新整理預簽名URL
   * @param {string} subPath - 子路徑
   * @param {string} uploadId - 現有的上傳ID
   * @param {Array} partNumbers - 需要重新整理URL的分片編號陣列
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 重新整理的預簽名URL列表
   */
  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 更新掛載點的最後使用時間
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委託給上傳操作模組
      return await this.uploadOps.signMultipartParts(subPath, uploadId, partNumbers, options);
    } catch (error) {
      throw this._rethrow(error, "簽名分片上傳引數失敗");
    }
  }

  /**
   * 規範化檔案路徑（用於後端分片上傳）
   * @param {string} subPath - 子路徑
   * @param {string} path - 完整路徑，用於提取檔名
   * @param {string} customFilename - 自定義檔名（可選）
   * @returns {string} 規範化後的S3路徑
   * @private
   */
  _normalizeFilePath(subPath, path, customFilename) {
    // 規範化S3子路徑 (不新增斜槓，因為是檔案)
    let s3SubPath = normalizeS3SubPath(subPath, false);

    // 獲取檔名，優先使用自定義檔名，其次從路徑中提取
    const fileName = customFilename || path.split("/").filter(Boolean).pop() || "unnamed_file";

    // 智慧檢查s3SubPath是否已經包含完整的檔案路徑
    if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
      // 新增root_prefix（如果有）
      const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";
      return rootPrefix + s3SubPath;
    }

    // 否則，s3SubPath是目錄路徑，需要拼接檔名
    // 與目錄列表邏輯保持一致，只使用root_prefix
    const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";

    let fullPrefix = rootPrefix;

    // 新增s3SubPath (如果不是空)
    if (s3SubPath && s3SubPath !== "/") {
      fullPrefix += s3SubPath;
    }

    // 確保字首總是以斜槓結尾 (如果不為空)
    if (fullPrefix && !fullPrefix.endsWith("/")) {
      fullPrefix += "/";
    }

    // 構建最終路徑
    return fullPrefix + fileName;
  }

  /**
   * 生成代理URL（ProxyCapable介面實現）
   * @param {string} subPath - 子路徑（subPath-only）
   * @param {Object} ctx - 上下文（path/request/download/channel/...）
   * @returns {Promise<Object>} 代理URL物件
   */
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
   * 檢查是否支援代理模式（ProxyCapable介面實現）
   * @param {Object} mount - 掛載點資訊
   * @returns {boolean} 是否支援代理模式
   */
  supportsProxyMode() {
    return true;
  }

  /**
   * 獲取代理配置（ProxyCapable介面實現）
   * @param {Object} mount - 掛載點資訊
   * @returns {Object} 代理配置物件
   */
  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  /**
   * 確保驅動已初始化
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new S3DriverError("儲存驅動未初始化");
    }
  }
}
