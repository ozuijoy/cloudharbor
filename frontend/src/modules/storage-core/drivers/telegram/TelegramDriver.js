import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import XHRUpload from "@uppy/xhr-upload";
import { getUploadTimeoutMs } from "../../uppy/xhrUploadDefaults.js";
import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";
import { api } from "@/api";

const MB = 1024 * 1024;
const DEFAULT_TG_PART_SIZE_BYTES = 15 * MB;
const DEFAULT_TG_UPLOAD_CONCURRENCY = 2;

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function clampInt(value, { min, max, fallback }) {
  const n = toPositiveInt(value, fallback);
  return Math.min(max, Math.max(min, n));
}

/**
 * TelegramDriver
 *
 * - Telegram 僅當“內容後端”，目錄樹真相在 vfs_nodes
 * - Share 上傳：只走後端 /share/upload（流式 / 表單），由後端負責 20MB 上限校驗
 * - FS 掛載上傳：支援 /fs/upload（≤20MB）與 /fs/multipart/*（斷點續傳/大檔案）
 *
 */
export class TelegramDriver {
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
        throw new Error("Telegram 暫不支援外鏈拉取上傳");
      },
      applyDirectShareUploader: this.applyShareUploader.bind(this),
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
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

  // Share 上傳：與 Local/WebDAV/GoogleDrive 對齊，統一走 /share/upload
  applyShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) {
      throw new Error("applyShareUploader 需要提供 Uppy 例項");
    }

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) {
      throw new Error("缺少 storage_config_id，無法初始化 Telegram 分享上傳");
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
        id: "TelegramShareUploadStream",
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
        id: "TelegramShareUploadForm",
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

  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 例項");
    }

    if (strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
      // 最小 5MB”限制，
      const partSizeMb = clampInt(this.config?.part_size_mb, {
        min: 5,
        max: 100,
        fallback: DEFAULT_TG_PART_SIZE_BYTES / MB,
      });
      const partSize = partSizeMb * MB;
      const uploadConcurrency = clampInt(this.config?.upload_concurrency, {
        min: 1,
        max: 8,
        fallback: DEFAULT_TG_UPLOAD_CONCURRENCY,
      });

      const adapter = new StorageAdapter(path || "/", uppy, { partSize });

      const awsS3Options = {
        id: "TelegramFsMultipart",
        limit: uploadConcurrency,
        shouldUseMultipart: () => true,
        getChunkSize: (data) => adapter.getChunkSizeForAwsS3(data),
        createMultipartUpload: adapter.createMultipartUpload.bind(adapter),
        signPart: adapter.signPart.bind(adapter),
        uploadPartBytes: adapter.uploadPartBytes.bind(adapter),
        completeMultipartUpload: adapter.completeMultipartUpload.bind(adapter),
        abortMultipartUpload: adapter.abortMultipartUpload.bind(adapter),
        listParts: adapter.listParts.bind(adapter),
      };

      const existing = uppy.getPlugin?.("TelegramFsMultipart");
      if (existing && typeof existing.setOptions === "function") {
        existing.setOptions(awsS3Options);
      } else {
        try {
          if (existing) uppy.removePlugin(existing);
        } catch {}
        uppy.use(AwsS3, awsS3Options);
      }

      return { adapter, mode: STORAGE_STRATEGIES.PRESIGNED_MULTIPART };
    }

    // Telegram 不支援 presigned-single；如果誤選，回退到後端流式
    if (strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE) {
      strategy = STORAGE_STRATEGIES.BACKEND_STREAM;
    }

    // 後端中轉上傳：/fs/upload（≤20MB，超出由後端拒絕）
    const headersBase = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "TelegramBackendForm",
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
        id: "TelegramBackendStream",
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

    return { adapter: null, mode: strategy || null };
  }
}
