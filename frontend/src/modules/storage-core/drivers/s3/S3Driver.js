import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import XHRUpload from "@uppy/xhr-upload";
import { getUploadTimeoutMs } from "../../uppy/xhrUploadDefaults.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("S3Driver");

export class S3Driver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: true,
        backendForm: true,
        presigned: true,
        url: true,
      },
      fs: {
        backendStream: true,
        backendForm: true,
        presignedSingle: true,
        multipart: true,
      },
    });

    this.share = {
      applyShareUploader: this.applyShareUploader.bind(this),
      applyUrlUploader: this.applyUrlUploader.bind(this),
      applyDirectShareUploader: this.applyDirectShareUploader.bind(this),
    };

    this.fs = {
      // 只讀輔助：供斷點續傳外掛查詢進行中的上傳和已上傳分片
      listUploads: this.listUploads.bind(this),
      listParts: this.listParts.bind(this),
      applyFsUploader: this.applyFsUploader.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  // FS --------------------------------------------------------------------
  /**
   * 在給定的 Uppy 例項上安裝 FS 上傳所需的 Uppy 外掛
   * - presigned-single: 使用 AwsS3 + getUploadParameters（單請求 PUT 直傳）
   * - presigned-multipart: 使用 AwsS3 多分片 hooks（create/sign/complete/listParts/abort）
   * @param {object} uppy 已建立的 Uppy 例項
   * @param {object} options { strategy, path }
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) throw new Error("applyFsUploader 需要提供 Uppy 例項");

    // 後續如需在同一 Uppy 上切換策略，交由上層重新初始化 Uppy
    if (strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE || strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;
      const MB = 1024 * 1024;
      // 分片大小/併發數由儲存配置控制
      // - 預設分片大小 5MB
      // - 預設併發 3
      const partSizeMbRaw = Number(this.config?.multipart_part_size_mb);
      const partSizeMb = Number.isFinite(partSizeMbRaw) && partSizeMbRaw > 0 ? Math.floor(partSizeMbRaw) : 5;
      const partSizeBytes = Math.max(5 * MB, Math.min(partSizeMb * MB, 5 * 1024 * MB)); // 5MB ~ 5GB

      const concurrencyRaw = Number(this.config?.multipart_concurrency);
      const multipartConcurrency =
        Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.max(1, Math.min(Math.floor(concurrencyRaw), 10)) : 3;

      const adapter = new StorageAdapter(path || "/", uppy, {
        // per_part_url 場景：後端可能會調整 partSize（例如 S3 的 10k parts 上限），需要預初始化來拿到真實 chunkSize
        enableMultipartPreinit: isMultipart,
        ...(isMultipart ? { partSize: partSizeBytes } : {}),
      });

      // 多分片：提供完整 hooks；單請求：僅提供 getUploadParameters 並強制 shouldUseMultipart=false
      const awsS3Opts = {
        id: "AwsS3",
        limit: isMultipart ? multipartConcurrency : 3,
        shouldUseMultipart: () => isMultipart,
        getChunkSize: (data) => adapter.getChunkSizeForAwsS3(data),
      };

      if (isMultipart) {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.createMultipartUpload = adapter.createMultipartUpload.bind(adapter);
        awsS3Opts.signPart = adapter.signPart.bind(adapter);
        // 為了相容暫停/恢復期間的分片上傳，顯式提供 uploadPartBytes，避免走預設 HTTPCommunicationQueue
        awsS3Opts.uploadPartBytes = adapter.uploadPartBytes.bind(adapter);
        awsS3Opts.completeMultipartUpload = adapter.completeMultipartUpload.bind(adapter);
        awsS3Opts.abortMultipartUpload = adapter.abortMultipartUpload.bind(adapter);
        awsS3Opts.listParts = adapter.listParts.bind(adapter);
      } else {
        // 單檔案上傳:提供 getUploadParameters 和 uploadPartBytes
        // uploadPartBytes 使用 XMLHttpRequest 可以讀取 ETag,避免 CORS 錯誤
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadSingleFile.bind(adapter);
      }

      uppy.use(AwsS3, awsS3Opts);
      return {
        adapter,
        mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE,
      };
    }

    // S3 後端直傳：透過後端閘道器 /fs/upload，支援流式與表單兩種模式
    if (strategy === STORAGE_STRATEGIES.BACKEND_STREAM || strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      const headers = buildAuthHeadersForRequest({});

      // 統一注入 path / use_multipart 到所有檔案的 meta
      try {
        uppy.setMeta({ path: path || "/", use_multipart: "false" });
      } catch {}

      if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
        // 表單模式：沿用 multipart/form-data 行為
        uppy.use(XHRUpload, {
          timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
          id: "S3BackendForm",
          endpoint: getFullApiUrl("/fs/upload"),
          method: "POST",
          formData: true,
          fieldName: "file",
          limit: 3,
          allowedMetaFields: ["path", "use_multipart", "upload_id"],
          headers,
        });
      } else {
        // 流式模式：PUT + 原始 body，引數透過 query/header 傳遞
        uppy.use(XHRUpload, {
          timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
          id: "S3BackendStream",
          endpoint: (file) => {
            const meta = file.meta || {};
            const basePath = meta.path || path || "/";
            const uploadId = meta.upload_id;
            const params = new URLSearchParams();
            params.set("path", basePath);
            if (uploadId) {
              params.set("upload_id", uploadId);
            }
            return `${getFullApiUrl("/fs/upload")}?${params.toString()}`;
          },
          method: "PUT",
          formData: false,
          limit: 3,
          headers: (file) => {
            const meta = file.meta || {};
            const uploadOptions = {
              overwrite: !!meta.overwrite,
              originalFilename: !!meta.original_filename,
            };
            const rawName = meta.name || file.name || "upload-file";
            const encodedName = encodeURIComponent(rawName);
            return {
              ...headers,
              "x-fs-filename": encodedName,
              "x-fs-options": btoa(JSON.stringify(uploadOptions)),
            };
          },
        });
      }

      // 在上傳前同步使用者修改的檔名
      uppy.on("upload", () => {
        const files = uppy.getFiles();
        files.forEach((file) => {
          if (file.meta?.name && file.meta.name !== file.name) {
            uppy.setFileState(file.id, { name: file.meta.name });
          }
        });
      });

      return {
        adapter: null,
        mode: strategy,
      };
    }

    // 其它驅動若需要自定義實現，可在各自 Driver 層安裝外掛；此處預設僅處理 S3 系列策略
    return null;
  }

  /**
   * 在 Uppy 上安裝用於“檔案分享（本地）”的一致上傳實現（一次性替換版）
   * - 統一走 AwsS3 單請求（getUploadParameters），暫停=取消、恢復=重傳
   * - 在 'upload-success' 內部完成 share/commit（/share/presign + /share/commit）
   * @param {object} uppy Uppy 例項
   * @param {object} options { payload }
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 例項");

    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "AwsS3Share";

    // 避免重複安裝
    if (uppy.getPlugin(pluginId)) return;

    // 建立 StorageAdapter 例項用於單檔案上傳(使用 XMLHttpRequest 避免 CORS)
    const adapter = new StorageAdapter("/", uppy);

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: () => false,
      limit: 3,
      getUploadParameters: async (file) => {
        // 合併 per-file meta 覆蓋（例如 slug）
        const meta = file?.meta || {};
        const fileName = typeof meta?.name === "string" && meta.name ? meta.name : file.name;
        const merged = {
          ...basePayload,
          slug: meta.slug ?? basePayload.slug,
          path: meta.path ?? basePayload.path,
        };

        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: merged.storage_config_id,
          filename: fileName,
          mimetype: file.type || "application/octet-stream",
          path: merged.path,
          size: file.size,
        });

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "獲取預簽名URL失敗");
        }

        const data = presign.data;
        const uploadUrl = data.uploadUrl || data.upload_url;
        // 持久化 commit 所需後設資料
        try {
          uppy.setFileMeta(file.id, {
            key: data.key,
            storage_config_id: data.storage_config_id || merged.storage_config_id,
            filename: typeof data?.filename === "string" && data.filename ? data.filename : fileName,
            path: merged.path,
            slug: merged.slug,
            password: basePayload.password || meta.password || null,
            expires_in: basePayload.expires_in,
            max_views: basePayload.max_views,
          });
        } catch {}

        return {
          method: "PUT",
          url: uploadUrl,
          headers: data.headers || {},
        };
      },
      // 使用 XMLHttpRequest 避免 CORS 問題
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    // 在成功後執行 commit
    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.file.completeFileUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename:
            typeof meta?.filename === "string" && meta.filename
              ? meta.filename
              : typeof meta?.name === "string" && meta.name
                ? meta.name
                : file.name,
          size: file.size,
          etag: undefined, // ETag 可能因 CORS 不可用，後端相容
          slug: meta.slug,
          remark: basePayload.remark,
          password: basePayload.password,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          use_proxy: basePayload.use_proxy,
          original_filename: basePayload.original_filename ?? false,
          path: meta.path,
        });
        // 暴露 fileId 以便上層需要時可讀取
        if (commitRes?.data) {
          const shareRecord = commitRes.data;
          log.debug("[ShareUploader] commit result", shareRecord);
          try {
            uppy.setFileMeta(file.id, {
              fileId: shareRecord.id,
              shareRecord,
            });
          } catch {}
          try {
            uppy.emit("share-record", { file, shareRecord });
          } catch {}
          try {
            onShareRecord?.({ file, shareRecord });
          } catch {}
        }
      } catch (e) {
        // 發出錯誤事件以便 UI 感知
        try { uppy.emit("upload-error", file, e); } catch {}
      }
    };

    // 避免重複繫結
    uppy.on("upload-success", onSuccess);
  }

  /**
   * Share 直傳上傳：透過 Uppy + XHRUpload 呼叫後端 /share/upload（ObjectStore 多儲存通用）
   * S3 在這一模式下與 WebDAV 一致，由後端統一處理寫入與建檔。
   */
  applyDirectShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) throw new Error("applyDirectShareUploader 需要提供 Uppy 例項");

    const basePayload = this.#withStorageConfig(payload || {});
    const mode = (shareMode || "stream").toLowerCase();

    const baseMeta = {
      storage_config_id: basePayload.storage_config_id,
      path: basePayload.path || "",
      slug: basePayload.slug || "",
      remark: basePayload.remark || "",
      password: basePayload.password || "",
      expires_in: basePayload.expires_in || "0",
      max_views: basePayload.max_views ?? 0,
      use_proxy: basePayload.use_proxy,
      original_filename: basePayload.original_filename,
    };

    const authHeaders = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta(baseMeta);
    } catch {}

    if (mode === "stream") {
      // 流式分享：PUT /share/upload + 原始 body，引數透過頭部傳遞
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "S3ShareUploadStream",
        endpoint: getFullApiUrl("/share/upload"),
        method: "PUT",
        formData: false,
        limit: 3,
        headers: (file) => {
          const meta = file.meta || {};
          const options = {
            storage_config_id: meta.storage_config_id,
            path: meta.path,
            slug: meta.slug,
            remark: meta.remark,
            password: meta.password,
            expires_in: meta.expires_in,
            max_views: meta.max_views,
            use_proxy: meta.use_proxy,
            original_filename: meta.original_filename,
            upload_id: meta.upload_id,
          };
          let encodedOptions = "";
          try {
            encodedOptions = btoa(JSON.stringify(options));
          } catch {
            encodedOptions = "";
          }
          const rawName = meta.name || file.name || "upload-file";
          const encodedName = encodeURIComponent(rawName);
          return {
            ...authHeaders,
            "x-share-filename": encodedName,
            ...(encodedOptions ? { "x-share-options": encodedOptions } : {}),
          };
        },
      });
    } else {
      // 表單分享：POST /share/upload multipart/form-data
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "S3ShareUploadDirect",
        endpoint: getFullApiUrl("/share/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: [
          "storage_config_id",
          "path",
          "slug",
          "remark",
          "password",
          "expires_in",
          "max_views",
          "use_proxy",
          "original_filename",
          "upload_id",
        ],
        headers: authHeaders,
      });
    }

    // 在上傳前同步使用者修改的檔名
    uppy.on("upload", () => {
      const files = uppy.getFiles();
      files.forEach((file) => {
        if (file.meta?.name && file.meta.name !== file.name) {
          uppy.setFileState(file.id, { name: file.meta.name });
        }
      });
    });

    const onSuccess = (file, response) => {
      try {
        const body = response && (response.body || response);
        if (!body || body.success !== true) return;
        const shareRecord = body.data;
        if (!shareRecord) return;

        try {
          uppy.setFileMeta(file.id, {
            ...(file.meta || {}),
            shareRecord,
            fileId: shareRecord.id,
          });
        } catch {}

        try {
          uppy.emit("share-record", { file, shareRecord });
        } catch {}

        try {
          onShareRecord?.({ file, shareRecord });
        } catch {}
      } catch {}
    };

    uppy.on("upload-success", onSuccess);
  }

  /**
   * URL 分享：使用通用 share/presign + AwsS3 單請求 + 在 'upload-success' 提交 share/commit
   */
  applyUrlUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyUrlUploader 需要提供 Uppy 例項");
    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "AwsS3UrlShare";
    if (uppy.getPlugin(pluginId)) return;

    // 建立 StorageAdapter 例項用於單檔案上傳(使用 XMLHttpRequest 避免 CORS)
    const adapter = new StorageAdapter("/", uppy);

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: () => false,
      limit: 3,
      getUploadParameters: async (file) => {
        const meta = file?.meta || {};
        const fileName = typeof meta?.name === "string" && meta.name ? meta.name : file.name;
        const merged = {
          ...basePayload,
          slug: meta.slug ?? basePayload.slug,
          path: meta.path ?? basePayload.path,
        };
        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: merged.storage_config_id,
          filename: fileName,
          mimetype: file.type || "application/octet-stream",
          path: merged.path,
          size: file.size,
        });
        if (!presign?.success || !presign?.data) throw new Error(presign?.message || "獲取URL上傳預簽名失敗");
        const presignData = presign.data;
        const uploadUrl = presignData.uploadUrl || presignData.upload_url;
        const resolvedKey = presignData.key;
        const resolvedStorageConfigId = presignData.storage_config_id || merged.storage_config_id;
        const resolvedFilename =
          typeof presignData?.filename === "string" && presignData.filename ? presignData.filename : fileName;
        if (!uploadUrl || !resolvedKey || !resolvedStorageConfigId) {
          throw new Error("URL上傳預簽名缺少必要的 key 或上傳地址");
        }
        try {
          uppy.setFileMeta(file.id, {
            key: resolvedKey,
            storage_config_id: resolvedStorageConfigId,
            filename: resolvedFilename,
            path: merged.path,
            slug: merged.slug,
            remark: merged.remark,
            password: merged.password,
            expires_in: merged.expires_in,
            max_views: merged.max_views,
          });
        } catch {}
        return { method: "PUT", url: uploadUrl, headers: presignData.headers || {} };
      },
      // 使用 XMLHttpRequest 避免 CORS 問題
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.file.completeFileUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename:
            typeof meta?.filename === "string" && meta.filename
              ? meta.filename
              : typeof meta?.name === "string" && meta.name
                ? meta.name
                : file.name,
          size: file.size,
          etag: undefined,
          path: meta.path,
          slug: meta.slug,
          remark: meta.remark ?? basePayload.remark,
          password: meta.password ?? basePayload.password,
          expires_in: meta.expires_in ?? basePayload.expires_in,
          max_views: meta.max_views ?? basePayload.max_views,
        });
        if (commitRes?.data) {
          const shareRecord = commitRes.data;
          log.debug("[UrlShareUploader] commit result", shareRecord);
          try {
            uppy.setFileMeta(file.id, {
              fileId: shareRecord.id,
              shareRecord,
            });
          } catch {}
          try {
            uppy.emit("share-record", { file, shareRecord });
          } catch {}
          try {
            onShareRecord?.({ file, shareRecord });
          } catch {}
        }
      } catch (e) {
        try { uppy.emit('upload-error', file, e); } catch {}
      }
    };
    uppy.on('upload-success', onSuccess);
  }

  // Read-only helpers for resume plugin -------------------------------------
  async listUploads({ path } = {}) {
    // 後端接受目錄或空字串，返回該作用域下的未完成上傳
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    // path 為檔案完整路徑，後端使用它定位資源；同時需要 uploadId 和 fileName
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }

  // Helpers ---------------------------------------------------------------
  #withStorageConfig(payload) {
    if (payload?.storage_config_id) {
      return payload;
    }
    if (!this.storageConfigId) {
      throw new Error("缺少 storage_config_id，可在 payload 中指定或配置預設值");
    }
    return { ...payload, storage_config_id: this.storageConfigId };
  }
}

export const SUPPORTED_STRATEGIES = [
  STORAGE_STRATEGIES.BACKEND_STREAM,
  STORAGE_STRATEGIES.PRESIGNED_SINGLE,
  STORAGE_STRATEGIES.PRESIGNED_MULTIPART,
];
