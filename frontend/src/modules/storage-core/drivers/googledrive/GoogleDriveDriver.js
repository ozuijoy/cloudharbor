import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import XHRUpload from "@uppy/xhr-upload";
import { getUploadTimeoutMs } from "../../uppy/xhrUploadDefaults.js";
import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";
import { api } from "@/api";

/**
 * GoogleDriveDriver（前端）
 *
 * 設計目標：
 * - 與 OneDrive/Local/WebDAV 一樣，前端統一透過後端 FS/Share API 進行上傳，不直接暴露 Google Drive 會話 URL 或 Token
 * - 能力矩陣：
 *   - share: backendStream/backendForm 均可用，不支援 presigned/url
 *   - fs: backendStream/backendForm 可用，presignedSingle/multipart 暫不開放（後端先實現中轉上傳）
 */
export class GoogleDriveDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: true,
        backendForm: true,
        presigned: false,
        url: false,
      },
      fs: {
        backendStream: true,
        backendForm: true,
        presignedSingle: false,
        multipart: true,
      },
    });

    this.share = {
      applyShareUploader: this.applyShareUploader.bind(this),
      applyUrlUploader: () => {
        throw new Error("GoogleDrive 暫不支援外鏈拉取上傳");
      },
      applyDirectShareUploader: this.applyShareUploader.bind(this),
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
      // 供 ServerResumePlugin 使用的輔助方法
      async listUploads({ path } = {}) {
        return api.fs.listMultipartUploads(path || "");
      },
      async listParts({ path, uploadId, fileName }) {
        return api.fs.listMultipartParts(path, uploadId, fileName);
      },
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  // Share 上傳：與 Local/WebDAV 對齊，統一走 /share/upload
  applyShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) {
      throw new Error("applyShareUploader 需要提供 Uppy 例項");
    }

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) {
      throw new Error("缺少 storage_config_id，無法初始化 GoogleDrive 分享上傳");
    }

    const baseMeta = {
      storage_config_id: storageConfigId,
      path: payload?.path || "",
      slug: payload?.slug || "",
      remark: payload?.remark || "",
      password: payload?.password || "",
      expires_in: payload?.expires_in || "0",
      max_views: payload?.max_views ?? 0,
      use_proxy: payload?.use_proxy,
      original_filename: payload?.original_filename,
    };

    const authHeaders = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta(baseMeta);
    } catch {}

    const mode = (shareMode || "stream").toLowerCase();

    if (mode === "stream") {
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "GoogleDriveShareUploadStream",
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
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "GoogleDriveShareUpload",
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
        const payloadBody = body && body.data ? body.data : body;
        const shareRecord = payloadBody?.share || payloadBody;
        if (!shareRecord) return;
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

  getDefaultFsStrategy() {
    return STORAGE_STRATEGIES.BACKEND_STREAM;
  }

  // FS 上傳：統一透過 /fs/upload 後端中轉（流式/表單）
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 例項");
    }

    // 預簽名直傳（多分片模式）：複用 StorageAdapter + AwsS3，與 S3/OneDrive 對齊
    if (
      strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE ||
      strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART
    ) {
      const adapter = new StorageAdapter(path || "/", uppy);

      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;
      const awsS3Opts = {
        id: "GoogleDriveFsPresigned",
        // Google Drive single_session 模式要求嚴格順序，這裡限制為序列上傳
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
        mode: isMultipart
          ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART
          : STORAGE_STRATEGIES.PRESIGNED_SINGLE,
      };
    }

    // 後端中轉上傳：沿用原有 /fs/upload 流式/表單邏輯
    const headersBase = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "GoogleDriveBackendForm",
        endpoint: getFullApiUrl("/fs/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: ["path", "use_multipart", "upload_id"],
        headers: headersBase,
      });
    } else {
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "GoogleDriveBackendStream",
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
            ...headersBase,
            "x-fs-filename": encodedName,
            "x-fs-options": btoa(JSON.stringify(uploadOptions)),
          };
        },
      });
    }

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
}
