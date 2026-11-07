import XHRUpload from "@uppy/xhr-upload";
import { getUploadTimeoutMs } from "../../uppy/xhrUploadDefaults.js";
import AwsS3 from "@uppy/aws-s3";
import { api } from "@/api";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";

/**
 * OneDriveDriver
 *
 */
export class OneDriveDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: true,
        backendForm: true,
        presigned: true,
        url: false,
      },
      fs: {
        backendStream: true,
        backendForm: true,
        presignedSingle: true,
        multipart: true,
      },
    });

    this.share = {
      // 預簽名分享上傳（/share/presign + /share/commit）
      applyShareUploader: this.applyShareUploader.bind(this),
      // 直傳分享上傳（/share/upload）
      applyDirectShareUploader: this.applyDirectShareUploader.bind(this),
      // URL 分享暫不支援
      applyUrlUploader: () => {
        throw new Error("OneDrive 暫不支援外鏈拉取上傳");
      },
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
      // 供 ServerResumePlugin 使用的只讀查詢能力
      listUploads: this.listUploads.bind(this),
      listParts: this.listParts.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  // Share ------------------------------------------------------------------

  /**
   * 預簽名分享上傳（單請求 PUT）
   * - 使用 /api/share/presign 獲取上傳 URL 與 key
   * - 使用 StorageAdapter + AwsS3 執行單請求上傳（底層實際走 XMLHttpRequest）
   * - 在 upload-success 中呼叫 /api/share/commit 建立分享記錄
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 例項");

    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "OneDriveSharePresigned";

    // 避免重複安裝
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

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "獲取預簽名URL失敗");
        }

        const data = presign.data;
        const uploadUrl = data.uploadUrl || data.upload_url;

        // 計算基礎請求頭：始終帶上 Content-Type，避免依賴後端
        const headers = {
          ...(data.headers || {}),
        };
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = file.type || "application/octet-stream";
        }

        // 如果後端暫未透傳 OneDrive 的 Content-Range，則在前端兜底一次
        const providerType = (data.provider_type || "").toUpperCase();
        const isOneDrive = providerType === "ONEDRIVE";
        if (
          isOneDrive &&
          typeof file.size === "number" &&
          file.size >= 0 &&
          !headers["Content-Range"]
        ) {
          const total = file.size;
          const end = total > 0 ? total - 1 : 0;
          headers["Content-Range"] = `bytes 0-${end}/${total}`;
        }

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
          headers,
        };
      },
      // 使用 XMLHttpRequest 避免 CORS 問題
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    // 在成功後執行 commit（建立分享記錄）
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
          slug: meta.slug,
          remark: basePayload.remark,
          password: basePayload.password,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          use_proxy: basePayload.use_proxy,
          original_filename: basePayload.original_filename ?? false,
          path: meta.path,
        });

        if (commitRes?.data) {
          const shareRecord = commitRes.data;
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
        try {
          uppy.emit("upload-error", file, e);
        } catch {}
      }
    };

    uppy.on("upload-success", onSuccess);
  }

  /**
   * 直傳分享上傳：透過 Uppy + XHRUpload 呼叫後端 /share/upload（ObjectStore 多儲存通用）
   * - 與 S3/WebDAV 一致，由後端處理寫入 OneDrive 並建立分享記錄
   * @param {object} uppy
   * @param {object} options { payload, onShareRecord, shareMode }
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
        id: "OneDriveShareUploadStream",
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
        id: "OneDriveShareUploadDirect",
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
   * 返回當前驅動在 FS 場景下推薦的上傳策略
   * - 由於 OneDrive 的 API 更適合後端中轉，我們這裡選擇 backend-stream
   */
  getDefaultFsStrategy() {
    return STORAGE_STRATEGIES.BACKEND_STREAM;
  }

  /**
   * OneDrive FS 上傳：
   * - 預簽名單檔案：透過 /fs/presign + 直傳（PRESIGNED_SINGLE）
   * - 預簽名多分片：透過 /fs/multipart/* + Uppy AwsS3 分片（PRESIGNED_MULTIPART，Graph uploadSession）
   * - 流式模式：透過 PUT /fs/upload 使用原始 body 直傳（BACKEND_STREAM）
   * - 表單模式：透過 POST /fs/upload multipart/form-data（BACKEND_FORM）
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 例項");
    }

    // 預簽名直傳：複用 StorageAdapter + AwsS3
    // - PRESIGNED_SINGLE: 單請求 PUT（getUploadParameters + uploadSingleFile）
    // - PRESIGNED_MULTIPART: Uppy 多分片（create/sign/uploadPartBytes/complete/abort/listParts）
    if (
      strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE ||
      strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART
    ) {
      const adapter = new StorageAdapter(path || "/", uppy);

      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;
      const awsS3Opts = {
        id: "OneDriveFsPresigned",
        // 對於 OneDrive 上傳會話，強制序列上傳，避免 Range 不一致問題
        limit: 1,
        shouldUseMultipart: () => isMultipart,
      };

      if (isMultipart) {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.createMultipartUpload = adapter.createMultipartUpload.bind(adapter);
        awsS3Opts.signPart = adapter.signPart.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadPartBytes.bind(adapter);
        awsS3Opts.completeMultipartUpload = adapter.completeMultipartUpload.bind(adapter);
        awsS3Opts.abortMultipartUpload = adapter.abortMultipartUpload.bind(adapter);
        awsS3Opts.listParts = adapter.listParts.bind(adapter);
      } else {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadSingleFile.bind(adapter);
      }

      uppy.use(AwsS3, awsS3Opts);
      return {
        adapter,
        mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE,
      };
    }

    const headers = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      // 表單模式：multipart/form-data
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "OneDriveBackendForm",
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
        id: "OneDriveBackendStream",
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

  // Read-only helpers for resume plugin -------------------------------------

  async listUploads({ path } = {}) {
    // 後端接受目錄或空字串，返回該作用域下的未完成上傳
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    // path 為檔案完整路徑，後端使用它定位資源；同時需要 uploadId 和 fileName
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }
}
