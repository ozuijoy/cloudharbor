/**
 * S3上傳操作模組
 * 負責檔案上傳相關操作：直接上傳、分片上傳（前端分片）、預簽名上傳等
 */

import { ApiStatus } from "../../../../constants/index.js";
import { AppError, ValidationError, S3DriverError } from "../../../../http/errors.js";
import { generateUploadUrl, buildS3Url } from "../utils/s3Utils.js";
import { S3Client, PutObjectCommand, ListMultipartUploadsCommand, ListPartsCommand, UploadPartCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { updateMountLastUsed } from "../../../fs/utils/MountResolver.js";
import { getMimeTypeFromFilename } from "../../../../utils/fileUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { applyS3RootPrefix, resolveS3ObjectKey } from "../utils/S3PathUtils.js";
import { getEnvironmentOptimizedUploadConfig, isNodeJSEnvironment } from "../../../../utils/environmentUtils.js";
import { updateUploadProgress } from "../../../utils/UploadProgressTracker.js";
import {
  createUploadSessionRecord,
  computeUploadSessionFingerprintMetaV1,
  findUploadSessionById,
  listActiveUploadSessions,
  updateUploadSessionById,
} from "../../../../utils/uploadSessions.js";

const DEFAULT_S3_MULTIPART_CONCURRENCY = 3;

function resolveS3MultipartConcurrency(config) {
  const raw = Number(config?.multipart_concurrency);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_S3_MULTIPART_CONCURRENCY;
}

function resolveS3MaxPartsPerRequest(config, { metaMaxPartsPerRequest = null } = {}) {
  // 相容舊配置：multipart_sign_max_parts / multipart_sign_batch_size 仍然允許作為硬覆蓋。
  const overrideRaw = Number(
    metaMaxPartsPerRequest ??
      config?.multipart_sign_max_parts ??
      config?.multipart_sign_batch_size,
  );
  if (Number.isFinite(overrideRaw) && overrideRaw > 0) {
    return Math.min(Math.floor(overrideRaw), 1000);
  }

  // 批次大小 = 併發數
  const concurrency = resolveS3MultipartConcurrency(config);
  return Math.min(Math.max(concurrency, 1), 1000);
}

export class S3UploadOperations {
  /**
   * 建構函式
   * @param {S3Client} s3Client - S3客戶端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(s3Client, config, encryptionSecret) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 上傳流式資料
   * @param {string} s3SubPath - S3子路徑
   * @param {ReadableStream} stream - 資料流
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 上傳結果
   */
  async uploadStream(s3SubPath, stream, options = {}) {
    const { mount, db, filename, contentType, contentLength } = options;

    return handleFsError(
      async () => {
        // 1. 規範化最終 Key
        const finalS3Path = applyS3RootPrefix(this.config, resolveS3ObjectKey(s3SubPath, filename));

        let result;
        let etag;
        const progressId = options.uploadId || finalS3Path;

        // 2. 構造適配當前環境的 Body，並統一使用 Upload（lib-storage）
        const { Upload } = await import("@aws-sdk/lib-storage");
        const uploadConfig = getEnvironmentOptimizedUploadConfig();
        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=開始 路徑=${finalS3Path}`
        );

        /** @type {any} */
        let bodyForUpload = stream;

        // 在 Node.js/Docker 環境中，如果收到的是 Web ReadableStream，
        // 使用 Readable.fromWeb 轉換為 Node.js Readable 流式。
        if (isNodeJSEnvironment() && stream && typeof stream.getReader === "function") {
          try {
            const { Readable } = await import("stream");
            if (typeof Readable.fromWeb === "function") {
              bodyForUpload = Readable.fromWeb(stream);
            }
          } catch (e) {
            console.warn("S3 流式上傳: Readable.fromWeb 轉換失敗，回退為原始流:", e?.message || e);
            bodyForUpload = stream;
          }
        }

        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: this.config.bucket_name,
            Key: finalS3Path,
            Body: bodyForUpload,
            ContentType: contentType,
          },
          queueSize: uploadConfig.queueSize,
          partSize: uploadConfig.partSize,
          leavePartsOnError: false,
        });

        // 3. 只從 Upload 的 httpUploadProgress 裡拿整體進度
        let lastProgressLog = 0;
        upload.on("httpUploadProgress", (progress) => {
          const { loaded = 0, total = contentLength } = progress;
          const REDUCED_LOG_INTERVAL = 50 * 1024 * 1024;
          const shouldLog = total > 0 ? loaded === total || loaded - lastProgressLog >= REDUCED_LOG_INTERVAL : loaded - lastProgressLog >= REDUCED_LOG_INTERVAL;

          if (shouldLog) {
            const progressMB = (loaded / (1024 * 1024)).toFixed(2);
            const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(2) : "未知";
            const percentage = total > 0 ? ((loaded / total) * 100).toFixed(1) : "未知";
            console.log(
              `[StorageUpload] type=S3 mode=流式分片 status=進度 已傳=${progressMB}MB 總=${totalMB}MB 進度=${percentage}% 路徑=${finalS3Path}`
            );
            lastProgressLog = loaded;
          }

          try {
            updateUploadProgress(progressId, {
              loaded,
              total,
              path: finalS3Path,
              storageType: "S3",
            });
          } catch {}
        });

        // 4. 等 Upload 完成，然後統一做目錄更新時間等收尾
        const startTime = Date.now();
        result = await upload.done();
        const duration = Date.now() - startTime;
        const speedMBps = contentLength > 0 ? (contentLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";

        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=完成 用時=${duration}ms 速度=${speedMBps}MB/s 路徑=${finalS3Path}`
        );
        etag = result.ETag ? result.ETag.replace(/"/g, "") : undefined;

        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, finalS3Path, this.config.root_prefix);
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        const s3Url = buildS3Url(this.config, finalS3Path);

        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=成功 路徑=${finalS3Path}`
        );
        return {
          success: true,
          message: "S3_STREAM_UPLOAD",
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag,
          contentType,
        };
      },
      "流式上傳",
      "流式上傳失敗"
    );
  }

  /**
   * 表單上傳（一次性讀取全部資料）
   * @param {string} s3SubPath - S3子路徑
   * @param {File|Blob|Uint8Array|ArrayBuffer|Buffer|string} data - 完整資料來源
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 上傳結果
   */
  async uploadForm(s3SubPath, data, options = {}) {
    const { mount, db, filename, contentType } = options;

    return handleFsError(
      async () => {
        // 構建最終的S3路徑
        const finalS3Path = applyS3RootPrefix(this.config, resolveS3ObjectKey(s3SubPath, filename));

        // 推斷 MIME 型別
        const effectiveContentType = contentType || getMimeTypeFromFilename(filename);

        // 規範化 Body 與長度
        let body;
        let size = 0;

        if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
          body = data;
          size = data.length;
        } else if (data instanceof Uint8Array) {
          body = data;
          size = data.byteLength;
        } else if (data instanceof ArrayBuffer) {
          body = new Uint8Array(data);
          size = body.byteLength;
        } else if (data && typeof data.arrayBuffer === "function") {
          const buf = await data.arrayBuffer();
          body = new Uint8Array(buf);
          size = body.byteLength;
        } else if (typeof data === "string") {
          body = typeof Buffer !== "undefined" ? Buffer.from(data) : new TextEncoder().encode(data);
          size = body.length ?? body.byteLength ?? 0;
        } else {
          throw new ValidationError("不支援的表單上傳資料型別");
        }

        const putParams = {
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          Body: body,
          ContentType: effectiveContentType,
          ContentLength: size,
        };

        const putCommand = new PutObjectCommand(putParams);
        const result = await this.s3Client.send(putCommand);

        // 更新父目錄的修改時間
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, finalS3Path, this.config.root_prefix);

        // 更新最後使用時間
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        const s3Url = buildS3Url(this.config, finalS3Path);

        console.log(
          `[StorageUpload] type=S3 mode=表單上傳 status=成功 路徑=${finalS3Path} 大小=${size}`
        );
        return {
          success: true,
          message: "S3_FORM_UPLOAD",
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag: result.ETag ? result.ETag.replace(/\"/g, "") : null,
          contentType: effectiveContentType,
        };
      },
      "表單上傳",
      "表單上傳失敗"
    );
  }

  /**
   * 生成預簽名上傳URL
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 預簽名上傳URL資訊
   */
  async generateUploadUrl(s3SubPath, options = {}) {
    const { fileName, fileSize, expiresIn = 3600 } = options;

    return handleFsError(
      async () => {
        // 推斷MIME型別
        const contentType = getMimeTypeFromFilename(fileName);

        // 構建最終的 S3 物件 Key（與直接上傳邏輯保持一致）
        const finalS3Path = applyS3RootPrefix(this.config, resolveS3ObjectKey(s3SubPath, fileName));

        const presignedUrl = await generateUploadUrl(this.config, finalS3Path, contentType, this.encryptionSecret, expiresIn);

        // 生成 S3 直接訪問 URL
        const s3Url = buildS3Url(this.config, finalS3Path);

        return {
          success: true,
          uploadUrl: presignedUrl,
          publicUrl: s3Url,
          contentType: contentType,
          expiresIn: expiresIn,
          storagePath: finalS3Path,
          fileName: fileName,
          fileSize: fileSize,
        };
      },
      "生成預簽名上傳URL",
      "生成預簽名上傳URL失敗"
    );
  }

  /**
   * 處理上傳完成後的操作
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 處理結果
   */
  async handleUploadComplete(s3SubPath, options = {}) {
    const { mount, db, fileName, fileSize, contentType, etag } = options;

    try {
      const fullKey = applyS3RootPrefix(this.config, s3SubPath);

      // 後端驗證檔案是否真實存在並獲取後設資料
      let verifiedETag = etag;
      let verifiedSize = fileSize;
      let verifiedContentType = contentType;

      try {
        const headParams = {
          Bucket: this.config.bucket_name,
          Key: fullKey,
        };
        const headCommand = new HeadObjectCommand(headParams);
        const headResult = await this.s3Client.send(headCommand);

        // 使用後端獲取的真實後設資料
        verifiedETag = headResult.ETag ? headResult.ETag.replace(/"/g, "") : verifiedETag;
        verifiedSize = headResult.ContentLength || verifiedSize;
        verifiedContentType = headResult.ContentType || verifiedContentType;

        console.log(`✅ 後端驗證上傳成功 - 檔案[${fullKey}], ETag[${verifiedETag}], 大小[${verifiedSize}]`);
      } catch (headError) {
        // 如果 HeadObject 失敗,說明檔案不存在,上傳實際失敗
        console.error(`❌ 後端驗證失敗 - 檔案[${fullKey}]不存在:`, headError);
        throw new ValidationError("檔案上傳失敗:檔案不存在於儲存桶中");
      }

      // 更新父目錄的修改時間
      await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix);

      // 更新最後使用時間
      if (db && mount && mount.id) {
        await updateMountLastUsed(db, mount.id);
      }

      // 構建公共URL
      const s3Url = buildS3Url(this.config, fullKey);

      return {
        success: true,
        message: "上傳完成處理成功",
        fileName: fileName,
        size: verifiedSize,
        contentType: verifiedContentType,
        storagePath: fullKey,
        publicUrl: s3Url,
        etag: verifiedETag,
      };
    } catch (error) {
      console.error("處理上傳完成失敗:", error);

      // 如果已經是 AppError，直接丟擲
      if (error instanceof AppError) {
        throw error;
      }

      throw new S3DriverError("處理上傳完成失敗", { details: { cause: error?.message } });
    }
  }

  /**
   * 取消上傳操作
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 取消結果
   */
  async cancelUpload(s3SubPath, options = {}) {
    const { uploadId } = options;

    try {
      if (uploadId) {
        // 取消分片上傳
        const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const abortParams = {
          Bucket: this.config.bucket_name,
          Key: s3SubPath,
          UploadId: uploadId,
        };

        const abortCommand = new AbortMultipartUploadCommand(abortParams);
        await this.s3Client.send(abortCommand);
      }

      return {
        success: true,
        message: "上傳已取消",
      };
    } catch (error) {
      console.error("取消上傳失敗:", error);
      throw new S3DriverError("取消上傳失敗", { details: { cause: error?.message } });
    }
  }

  /**
   * 初始化前端分片上傳（生成預簽名URL列表）
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 初始化結果
   */
  async initializeFrontendMultipartUpload(s3SubPath, options = {}) {
    const { fileName, fileSize, partSize = 5 * 1024 * 1024, partCount, mount, db, userIdOrInfo, userType } = options;

    console.log("[S3UploadOperations] 初始化分片上傳", { fileName, fileSize, mountId: mount?.id });

    return handleFsError(async () => {
      if (!db || !mount?.storage_config_id || !mount?.id) {
        throw new ValidationError("S3 分片上傳初始化失敗：缺少 db 或 mount 資訊");
      }

      // 基本引數校驗
      if (!fileName || !Number.isFinite(fileSize) || Number(fileSize) <= 0) {
        throw new ValidationError("S3 分片上傳初始化失敗：缺少有效的 fileName 或 fileSize");
      }

      const normalizedFileName = String(fileName || "").trim();
      if (!normalizedFileName) {
        throw new ValidationError("S3 分片上傳初始化失敗：fileName 不能為空");
      }

      const contentType =
        typeof options?.contentType === "string" && options.contentType
          ? String(options.contentType)
          : getMimeTypeFromFilename(normalizedFileName);

      // 計算分片大小
      // - 單個物件最大 5TB
      // - 單個分片最小 5MB（最後一片可以更小）
      // - 單個分片最大 5GB
      // - 分片總數最多 10000
      const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
      const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
      const MAX_PARTS = 10000;
      const MAX_OBJECT_SIZE = MAX_PART_SIZE * MAX_PARTS; // 5TB

      if (Number(fileSize) > MAX_OBJECT_SIZE) {
        throw new ValidationError("S3 分片上傳初始化失敗：檔案大小超過 S3 單物件最大限制（約 5TB）");
      }

      let effectivePartSize;
      if (Number.isFinite(partSize) && Number(partSize) > 0) {
        effectivePartSize = Math.floor(Number(partSize));
      } else {
        effectivePartSize = Math.ceil(Number(fileSize) / MAX_PARTS);
      }
      if (!Number.isFinite(effectivePartSize) || effectivePartSize < MIN_PART_SIZE) {
        effectivePartSize = MIN_PART_SIZE;
      }
      if (effectivePartSize > MAX_PART_SIZE) {
        effectivePartSize = MAX_PART_SIZE;
      }

      const totalParts = Number.isFinite(partCount) && Number(partCount) > 0
        ? Math.floor(Number(partCount))
        : Math.ceil(Number(fileSize) / effectivePartSize);

      if (!Number.isFinite(totalParts) || totalParts <= 0) {
        throw new ValidationError("S3 分片上傳初始化失敗：無法計算分片數量");
      }
      if (totalParts > MAX_PARTS) {
        throw new ValidationError(`S3 分片上傳初始化失敗：分片數量超過上限（${MAX_PARTS}），請增大分片大小或限制檔案尺寸`);
      }

      // 生成最終的 S3 Key（不帶前導 /）
      const base = String(s3SubPath || "").replace(/\/+$/g, "");
      const finalS3Key = base ? `${base}/${normalizedFileName}` : normalizedFileName;

      // 建立 S3 Multipart Upload（providerUploadId）
      const { CreateMultipartUploadCommand, UploadPartCommand } = await import("@aws-sdk/client-s3");
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: this.config.bucket_name,
        Key: finalS3Key,
        ContentType: contentType,
      });
      const createResponse = await this.s3Client.send(createCommand);
      const providerUploadId = String(createResponse?.UploadId || "").trim();
      if (!providerUploadId) {
        throw new ValidationError("S3 分片上傳初始化失敗：S3 未返回 UploadId");
      }

      const signatureExpiresInCandidate = Number(this.config.signature_expires_in);
      const signatureExpiresIn =
        Number.isFinite(signatureExpiresInCandidate) && signatureExpiresInCandidate > 0
          ? Math.floor(signatureExpiresInCandidate)
          : 3600;

      // 簽名策略
      // - init 階段只籤一小批，避免一次性生成 1w 個 URL
      const multipartConcurrency = resolveS3MultipartConcurrency(this.config);
      const maxPartsPerRequest = resolveS3MaxPartsPerRequest(this.config);

      const initialBatchSize = Math.min(totalParts, maxPartsPerRequest);
      const presignedUrls = [];
      for (let partNumber = 1; partNumber <= initialBatchSize; partNumber += 1) {
        const uploadPartCommand = new UploadPartCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Key,
          UploadId: providerUploadId,
          PartNumber: partNumber,
        });
        const presignedUrl = await getSignedUrl(this.s3Client, uploadPartCommand, {
          expiresIn: signatureExpiresIn,
        });
        presignedUrls.push({ partNumber, url: presignedUrl });
      }

      // 更新掛載點最後使用時間
      if (mount?.id) {
        await updateMountLastUsed(db, mount.id);
      }

      // 規範化 FS 檢視路徑：mount_path + rawSubPath + fileName
      const relDir = String(options?.rawSubPath ?? s3SubPath ?? "")
        .replace(/^\/+/g, "")
        .replace(/\/+$/g, "");
      const relFile = relDir ? `${relDir}/${normalizedFileName}` : normalizedFileName;
      const baseMountPath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const fsPath = baseMountPath === "/" ? `/${relFile}` : `${baseMountPath}/${relFile}`;

      const fingerprint = computeUploadSessionFingerprintMetaV1({
        userIdOrInfo,
        userType: userType || null,
        storageType: "S3",
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        fileName: normalizedFileName,
        fileSize: Number(fileSize),
      });

      const expiresAt = new Date(Date.now() + signatureExpiresIn * 1000).toISOString();
      const providerMeta = JSON.stringify({
        bucket: this.config.bucket_name,
        key: finalS3Key,
        urlTtlSeconds: signatureExpiresIn,
        maxPartsPerRequest,
        multipartConcurrency,
      });

      const created = await createUploadSessionRecord(db, {
        userIdOrInfo,
        userType: userType || null,
        storageType: "S3",
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        source: "FS",
        fileName: normalizedFileName,
        fileSize: Number(fileSize),
        mimeType: contentType || null,
        checksum: null,
        fingerprintAlgo: fingerprint.algo,
        fingerprintValue: fingerprint.value,
        strategy: "per_part_url",
        partSize: effectivePartSize,
        totalParts,
        bytesUploaded: 0,
        uploadedParts: 0,
        nextExpectedRange: null,
        providerUploadId,
        providerUploadUrl: providerUploadId,
        providerMeta,
        status: "initiated",
        expiresAt,
      });

      const sessionId = created?.id;
      if (!sessionId) {
        throw new ValidationError("S3 分片上傳初始化失敗：無法建立 upload_sessions 會話");
      }

      return {
        success: true,
        uploadId: sessionId,
        strategy: "per_part_url",
        presignedUrls,
        partSize: effectivePartSize,
        totalParts,
        fileName: normalizedFileName,
        fileSize: Number(fileSize),
        key: fsPath.replace(/^\/+/, ""),
        expiresIn: signatureExpiresIn,
        policy: {
          refreshPolicy: "server_decides",
          signingMode: "batched",
          maxPartsPerRequest,
          partsLedgerPolicy: "server_can_list",
          urlTtlSeconds: signatureExpiresIn,
          retryPolicy: { maxAttempts: 3 },
        },
      };
    }, "初始化前端分片上傳", "初始化前端分片上傳失敗");
  }

  /**
   * 完成前端分片上傳
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 完成結果
   */
  async completeFrontendMultipartUpload(s3SubPath, options = {}) {
    const { uploadId, parts, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;
    void s3SubPath;
    void userIdOrInfo;
    void userType;

    console.log("[S3UploadOperations] 完成分片上傳", {
      fileName,
      fileSize,
      mountId: mount?.id,
    });

    return handleFsError(
      async () => {
        if (!db || !uploadId) {
          throw new ValidationError("完成前端分片上傳失敗：缺少 uploadId 或 db");
        }

        const sessionRow = await findUploadSessionById(db, { id: uploadId });
        if (!sessionRow) {
          throw new ValidationError("完成前端分片上傳失敗：未找到對應的上傳會話");
        }
        if (String(sessionRow.storage_type) !== "S3") {
          throw new ValidationError("完成前端分片上傳失敗：會話儲存型別不匹配");
        }

        let meta = {};
        try {
          meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
        } catch {
          meta = {};
        }

        const providerUploadId = String(
          sessionRow.provider_upload_id || sessionRow.provider_upload_url || "",
        ).trim();
        const finalS3Path = String(meta?.key || "").trim();
        if (!providerUploadId || !finalS3Path) {
          throw new ValidationError("完成前端分片上傳失敗：會話缺少 providerUploadId 或 s3Key");
        }

        // 優先使用前端（Uppy AwsS3）傳入的 parts
        const incomingParts = Array.isArray(parts) ? parts : [];
        let sortedParts = incomingParts
          .map((part) => ({
            PartNumber: Number(part?.PartNumber ?? part?.partNumber),
            ETag: part?.ETag ?? part?.etag ?? null,
          }))
          .filter((x) => Number.isFinite(x.PartNumber) && x.PartNumber > 0 && !!x.ETag)
          .sort((a, b) => a.PartNumber - b.PartNumber);

        // 兜底：如果前端沒傳 parts，按策略從上游 ListParts 取回權威 ETag 列表
        if (sortedParts.length === 0) {
          try {
            const listed = await this.listMultipartParts("", uploadId, { db });
            const providerParts = Array.isArray(listed?.parts) ? listed.parts : [];
            sortedParts = providerParts
              .map((p) => ({ PartNumber: Number(p?.partNumber), ETag: p?.etag ?? null }))
              .filter((x) => Number.isFinite(x.PartNumber) && x.PartNumber > 0 && !!x.ETag)
              .sort((a, b) => a.PartNumber - b.PartNumber);
          } catch (e) {
            console.warn("[S3UploadOperations] complete 兜底 ListParts 失敗:", e?.message || e);
          }
        }

        if (sortedParts.length === 0) {
          throw new ValidationError("完成前端分片上傳失敗：缺少 parts（無法完成 multipart）");
        }

        // 完成分片上傳
        const { CompleteMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const completeCommand = new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          UploadId: providerUploadId,
          MultipartUpload: {
            Parts: sortedParts,
          },
        });

        const completeResponse = await this.s3Client.send(completeCommand);

        // 更新最後使用時間
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 推斷MIME型別
        const contentType = getMimeTypeFromFilename(sessionRow.file_name || fileName);

        // 構建公共URL
        const s3Url = buildS3Url(this.config, finalS3Path);

        // 檔案上傳完成後：更新 upload_sessions 狀態
        try {
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: "S3",
            status: "completed",
            bytesUploaded: Number(sessionRow.file_size) || Number(fileSize) || 0,
            uploadedParts: Array.isArray(sortedParts) ? sortedParts.length : 0,
            nextExpectedRange: null,
          });
        } catch (e) {
          console.warn("[S3UploadOperations] 更新 upload_sessions 狀態為 completed 失敗:", e?.message || e);
        }

        return {
          success: true,
          fileName: sessionRow.file_name || fileName,
          size: Number(sessionRow.file_size) || fileSize,
          contentType: contentType,
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag: completeResponse.ETag ? completeResponse.ETag.replace(/"/g, "") : null,
          location: completeResponse.Location,
          message: "前端分片上傳完成",
        };
      },
      "完成前端分片上傳",
      "完成前端分片上傳失敗"
    );
  }

  /**
   * 中止前端分片上傳
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 中止結果
   */
  async abortFrontendMultipartUpload(s3SubPath, options = {}) {
    const { uploadId, fileName, mount, db, userIdOrInfo, userType } = options;
    void s3SubPath;
    void fileName;
    void userIdOrInfo;
    void userType;

    return handleFsError(
      async () => {
        if (!db || !uploadId) {
          throw new ValidationError("中止前端分片上傳失敗：缺少 uploadId 或 db");
        }

        const sessionRow = await findUploadSessionById(db, { id: uploadId });
        if (!sessionRow) {
          throw new ValidationError("中止前端分片上傳失敗：未找到對應的上傳會話");
        }
        if (String(sessionRow.storage_type) !== "S3") {
          throw new ValidationError("中止前端分片上傳失敗：會話儲存型別不匹配");
        }

        let meta = {};
        try {
          meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
        } catch {
          meta = {};
        }

        const providerUploadId = String(
          sessionRow.provider_upload_id || sessionRow.provider_upload_url || "",
        ).trim();
        const finalS3Path = String(meta?.key || "").trim();
        if (!providerUploadId || !finalS3Path) {
          throw new ValidationError("中止前端分片上傳失敗：會話缺少 providerUploadId 或 s3Key");
        }

        console.log(
          `中止前端分片上傳: Bucket=${this.config.bucket_name}, Key=${finalS3Path}, UploadId=${providerUploadId}`,
        );

        // 中止分片上傳
        const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          UploadId: providerUploadId,
        });

        try {
          await this.s3Client.send(abortCommand);
        } catch (error) {
          const code = error?.Code || error?.name;
          if (code === "AccessDenied" || code === "NoSuchUpload") {
            const friendly = new Error(`當前儲存不支援清除分片：${code}`);
            friendly.code = code;
            throw friendly;
          }
          throw error;
        }

        // 更新最後使用時間
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 更新 upload_sessions 狀態為 aborted（不影響主流程）
        try {
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: "S3",
            status: "aborted",
          });
        } catch (e) {
          console.warn("[S3UploadOperations] 更新 upload_sessions 狀態為 aborted 失敗:", e?.message || e);
        }

        return {
          success: true,
          message: "前端分片上傳已中止",
        };
      },
      "中止前端分片上傳",
      "中止前端分片上傳失敗"
    );
  }

  /**
   * 列出進行中的分片上傳
   * @param {string} s3SubPath - S3子路徑（可選，用於過濾特定檔案的上傳）
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 進行中的上傳列表
   */
  async listMultipartUploads(s3SubPath = "", options = {}) {
    const { mount, db, userIdOrInfo, userType } = options || {};
    if (!db || !mount?.id) {
      return { success: true, uploads: [] };
    }

    let fsPathPrefix = s3SubPath || "";
    if (mount.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (s3SubPath || "").replace(/^\/+/g, "");
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: "S3",
      mountId: mount.id ?? null,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = (sessions || []).map((row) => {
      // 續傳進度以 ListParts 為準
      let bytesUploaded = null;
      if (typeof row.bytes_uploaded === "number" && Number.isFinite(row.bytes_uploaded) && row.bytes_uploaded > 0) {
        bytesUploaded = Number(row.bytes_uploaded);
      }

      let providerMeta = {};
      try {
        providerMeta = row?.provider_meta ? JSON.parse(String(row.provider_meta)) : {};
      } catch {
        providerMeta = {};
      }

      const urlTtlSeconds = Number(providerMeta?.urlTtlSeconds);
      const urlTtl =
        Number.isFinite(urlTtlSeconds) && urlTtlSeconds > 0 ? Math.floor(urlTtlSeconds) : null;

      const maxPartsPerRequestRaw = Number(providerMeta?.maxPartsPerRequest);
      const maxPartsPerRequest =
        Number.isFinite(maxPartsPerRequestRaw) && maxPartsPerRequestRaw > 0
          ? Math.floor(maxPartsPerRequestRaw)
          : 100;

      return {
        key: (row.fs_path || "/").replace(/^\/+/, ""),
        uploadId: row.id,
        initiated: row.created_at,
        fileName: row.file_name,
        fileSize: row.file_size,
        partSize: row.part_size,
        totalParts: row.total_parts ?? null,
        strategy: row.strategy || "per_part_url",
        storageType: row.storage_type,
        sessionId: row.id,
        bytesUploaded,
        policy: {
          refreshPolicy: "server_decides",
          signingMode: "batched",
          maxPartsPerRequest,
          partsLedgerPolicy: "server_can_list",
          ...(urlTtl ? { urlTtlSeconds: urlTtl } : {}),
          retryPolicy: { maxAttempts: 3 },
        },
      };
    });

    return { success: true, uploads };
  }

  /**
   * 列出已上傳的分片
   * @param {string} s3SubPath - S3子路徑
   * @param {string} uploadId - 上傳ID
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 已上傳的分片列表
   */
  async listMultipartParts(s3SubPath, uploadId, options = {}) {
    // S3：服務端具備 ListParts 能力
    // uploadId 是 CloudHarbor 會話 id（upl_xxx），我們從 upload_sessions 裡拿到 providerUploadId + key
    const { db } = options || {};
    void s3SubPath;
    if (!db || !uploadId) {
      return { success: true, uploadId: uploadId || null, parts: [], errors: [] };
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      const maxPartsPerRequest = resolveS3MaxPartsPerRequest(this.config);
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        errors: [],
        policy: {
          refreshPolicy: "server_decides",
          signingMode: "batched",
          maxPartsPerRequest,
          partsLedgerPolicy: "server_can_list",
          retryPolicy: { maxAttempts: 3 },
        },
      };
    }
    if (String(sessionRow.storage_type) !== "S3") {
      throw new ValidationError("列出已上傳的分片失敗：會話儲存型別不匹配");
    }

    let meta = {};
    try {
      meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
    } catch {
      meta = {};
    }

    const maxPartsPerRequest = resolveS3MaxPartsPerRequest(this.config, {
      metaMaxPartsPerRequest: meta?.maxPartsPerRequest,
    });
    const urlTtlSeconds = Number(meta?.urlTtlSeconds);
    const urlTtl = Number.isFinite(urlTtlSeconds) && urlTtlSeconds > 0 ? Math.floor(urlTtlSeconds) : null;
    const policy = {
      refreshPolicy: "server_decides",
      signingMode: "batched",
      maxPartsPerRequest,
      partsLedgerPolicy: "server_can_list",
      ...(urlTtl ? { urlTtlSeconds: urlTtl } : {}),
      retryPolicy: { maxAttempts: 3 },
    };

    const providerUploadId =
      String(sessionRow.provider_upload_id || sessionRow.provider_upload_url || "").trim();
    const s3Key = String(meta?.key || "").trim();
    if (!providerUploadId || !s3Key) {
      throw new ValidationError("列出已上傳的分片失敗：會話缺少 providerUploadId 或 s3Key");
    }

    const { maxParts = 1000, partNumberMarker } = options || {};

    try {
      const listCommand = new ListPartsCommand({
        Bucket: this.config.bucket_name,
        Key: s3Key,
        UploadId: providerUploadId,
        MaxParts: maxParts,
        PartNumberMarker: partNumberMarker,
      });

      const response = await this.s3Client.send(listCommand);

      const parts = (response.Parts || []).map((part) => ({
        partNumber: part.PartNumber,
        lastModified: part.LastModified,
        etag: part.ETag,
        size: part.Size,
      }));

      return {
        success: true,
        uploadId: uploadId || null,
        parts,
        errors: [],
        bucket: response.Bucket,
        key: response.Key,
        providerUploadId: response.UploadId,
        partNumberMarker: response.PartNumberMarker,
        nextPartNumberMarker: response.NextPartNumberMarker,
        maxParts: response.MaxParts,
        isTruncated: response.IsTruncated,
        storageClass: response.StorageClass,
        owner: response.Owner,
        policy,
      };
    } catch (error) {
      // 特殊處理 NoSuchUpload：這是生命週期策略/中止導致的正常業務場景
      if (
        error?.name === "NoSuchUpload" ||
        (error?.message && String(error.message).includes("The specified multipart upload does not exist"))
      ) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          errors: [],
          uploadNotFound: true,
          message: "多部分上傳已被 S3 生命週期策略清理或已完成/已中止",
          policy,
        };
      }
      throw new S3DriverError("列出已上傳的分片失敗", { details: { cause: error?.message } });
    }
  }

  /**
   * 為現有上傳重新整理預簽名URL
   * @param {string} s3SubPath - S3子路徑
   * @param {string} uploadId - 現有的上傳ID
   * @param {Array} partNumbers - 需要重新整理URL的分片編號陣列
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 重新整理的預簽名URL列表
   */
  async signMultipartParts(_s3SubPath, uploadId, partNumbers, options = {}) {
    // providerUploadId / s3Key 從 upload_sessions 中取
    // 簽名策略：批次簽名（預設批次大小=併發數，例如 3；並受 maxPartsPerRequest 上限約束）
    const { db } = options || {};
    if (!db || !uploadId) {
      throw new ValidationError("簽名分片上傳引數失敗：缺少必要引數");
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new ValidationError("簽名分片上傳引數失敗：未找到對應的上傳會話");
    }
    if (String(sessionRow.storage_type) !== "S3") {
      throw new ValidationError("簽名分片上傳引數失敗：會話儲存型別不匹配");
    }

    let meta = {};
    try {
      meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
    } catch {
      meta = {};
    }

    const providerUploadId = String(sessionRow.provider_upload_id || sessionRow.provider_upload_url || "").trim();
    const s3Key = String(meta?.key || "").trim();
    if (!providerUploadId || !s3Key) {
      throw new ValidationError("簽名分片上傳引數失敗：會話缺少 providerUploadId 或 s3Key");
    }

    const expiresInCandidate =
      Number(options?.expiresIn) ||
      Number(options?.expires_in) ||
      Number(meta?.urlTtlSeconds) ||
      Number(this.config.signature_expires_in) ||
      3600;
    const expiresIn =
      Number.isFinite(expiresInCandidate) && expiresInCandidate > 0 ? Math.floor(expiresInCandidate) : 3600;

    const requested = Array.isArray(partNumbers)
      ? partNumbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];

    const maxPartsPerRequest = resolveS3MaxPartsPerRequest(this.config, {
      metaMaxPartsPerRequest: meta?.maxPartsPerRequest,
    });

    // 統一 totalParts：優先用會話記錄，其次用 fileSize/partSize 推導（用於 server_decides）
    const totalPartsCandidate = Number(sessionRow.total_parts);
    const partSizeCandidate = Number(sessionRow.part_size);
    const fileSizeCandidate = Number(sessionRow.file_size);
    const totalPartsResolved =
      Number.isFinite(totalPartsCandidate) && totalPartsCandidate > 0
        ? Math.floor(totalPartsCandidate)
        : Number.isFinite(fileSizeCandidate) && fileSizeCandidate > 0 && Number.isFinite(partSizeCandidate) && partSizeCandidate > 0
          ? Math.ceil(fileSizeCandidate / partSizeCandidate)
          : null;

    // server_decides：partNumbers=[] 代表“後端決定返回哪些 URL”
    // 透過 ListParts 找到“第一片缺失的 partNumber”，然後按 maxPartsPerRequest 返回一批 URL
    let partNumbersToSign = requested;
    if (partNumbersToSign.length === 0) {
      if (!totalPartsResolved) {
        throw new ValidationError("簽名分片上傳引數失敗：無法確定 totalParts（會話缺少 fileSize/partSize）");
      }

      let expected = 1;
      let marker = null;
      const MAX_LIST_PAGES = 50; // 1000/page，最多覆蓋 5w 分片，足夠 S3 1w 上限

      for (let page = 0; page < MAX_LIST_PAGES && expected <= totalPartsResolved; page += 1) {
        let resp;
        try {
          const cmd = new ListPartsCommand({
            Bucket: this.config.bucket_name,
            Key: s3Key,
            UploadId: providerUploadId,
            MaxParts: 1000,
            ...(marker != null ? { PartNumberMarker: marker } : {}),
          });
          resp = await this.s3Client.send(cmd);
        } catch (error) {
          if (
            error?.name === "NoSuchUpload" ||
            (error?.message && String(error.message).includes("The specified multipart upload does not exist"))
          ) {
            throw new ValidationError("簽名分片上傳引數失敗：多部分上傳已失效（可能已完成/已中止/被清理）");
          }
          throw error;
        }

        const parts = Array.isArray(resp?.Parts) ? resp.Parts : [];
        let foundGap = false;
        for (const part of parts) {
          const pn = Number(part?.PartNumber);
          if (!Number.isFinite(pn) || pn <= 0) continue;
          if (pn === expected) {
            expected += 1;
            continue;
          }
          if (pn > expected) {
            foundGap = true;
            break;
          }
        }

        if (foundGap) break;

        if (resp?.IsTruncated) {
          const nextMarker = resp?.NextPartNumberMarker ?? null;
          if (nextMarker == null || nextMarker === "") break;
          marker = nextMarker;
          continue;
        }

        break;
      }

      if (expected <= totalPartsResolved) {
        const endPn = Math.min(expected + maxPartsPerRequest - 1, totalPartsResolved);
        partNumbersToSign = Array.from({ length: endPn - expected + 1 }, (_, i) => expected + i);
      } else {
        partNumbersToSign = [];
      }
    }

    if (partNumbersToSign.length > maxPartsPerRequest) {
      throw new ValidationError(`簽名分片上傳引數失敗：partNumbers 數量過多（最多 ${maxPartsPerRequest}）`);
    }

    const presignedUrls = [];
    for (const partNumber of partNumbersToSign) {
      const command = new UploadPartCommand({
        Bucket: this.config.bucket_name,
        Key: s3Key,
        UploadId: providerUploadId,
        PartNumber: partNumber,
      });
      const presignedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      presignedUrls.push({ partNumber, url: presignedUrl });
    }

    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      const nextMeta = {
        ...(meta && typeof meta === "object" ? meta : {}),
        urlTtlSeconds: expiresIn,
        maxPartsPerRequest,
      };
      await updateUploadSessionById(db, {
        id: String(uploadId),
        storageType: "S3",
        providerMeta: nextMeta,
        expiresAt,
      });
    } catch (e) {
      console.warn("[S3UploadOperations] sign 更新 upload_sessions.expires_at 失敗（可忽略）:", e?.message || e);
    }

    return {
      success: true,
      uploadId,
      strategy: "per_part_url",
      presignedUrls,
      expiresIn,
      partSize: sessionRow.part_size || null,
      totalParts: totalPartsResolved || sessionRow.total_parts || null,
      policy: {
        refreshPolicy: "server_decides",
        signingMode: "batched",
        maxPartsPerRequest,
        partsLedgerPolicy: "server_can_list",
        urlTtlSeconds: expiresIn,
        retryPolicy: { maxAttempts: 3 },
      },
    };
  }
}
