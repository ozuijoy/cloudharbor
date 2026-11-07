import XHRUpload from "@uppy/xhr-upload";
import { getUploadTimeoutMs } from "../../uppy/xhrUploadDefaults.js";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";

/**
 * LOCAL 儲存驅動（前端）
 *
 * 語義與 WebDAV 前端驅動基本一致：
 * - FS：透過 Uppy + XHRUpload 直傳到 /fs/upload（支援流式與表單兩種模式）
 * - Share：透過 Uppy + XHRUpload 直傳到 /share/upload，由後端根據 storage_config_id / path 寫入本地儲存並建立分享記錄
 *
 * 注意：
 * - 不支援預簽名上傳 / 分片上傳，前端僅暴露“流式 / 表單”兩種方式（與 WebDAV 保持一致）。
 */
export class LocalDriver {
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
        multipart: false,
      },
    });

    this.share = {
      // 直接分享上傳（多儲存通用，透過 /share/upload）
      applyShareUploader: this.applyShareUploader.bind(this),
      // LOCAL 不支援預簽名 URL 拉取上傳
      applyUrlUploader: () => {
        throw new Error("LOCAL 暫不支援外鏈拉取上傳");
      },
      // 為 direct share 模式提供顯式入口（與 S3/WebDAV 對齊）
      applyDirectShareUploader: this.applyShareUploader.bind(this),
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  /**
   * LOCAL 分享上傳：透過 Uppy + XHRUpload 呼叫後端 /api/share/upload
   * 與 WebDAV/S3 的分享上傳保持一致：統一走 Uppy 管線
   */
  applyShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) {
      throw new Error("applyShareUploader 需要提供 Uppy 例項");
    }

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) {
      throw new Error("缺少 storage_config_id，無法初始化 LOCAL 分享上傳");
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
      // 流式分享：PUT /share/upload + 原始 body，引數透過頭部傳遞
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "LocalShareUploadStream",
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
        id: "LocalShareUpload",
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

    // 監聽 upload-success，從響應中提取分享記錄並透傳給上層
    const handleSuccess = (file, response) => {
      try {
        const body = response && (response.body || response);
        const payloadBody = body && typeof body === "object" ? body : null;
        if (!payloadBody || payloadBody.success !== true) return;
        const shareRecord = payloadBody.data;
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
      } catch {
        // 響應解析失敗時靜默忽略，由上層根據 success/message 處理錯誤
      }
    };

    uppy.on("upload-success", handleSuccess);
  }

  /**
   * LOCAL FS 上傳：
   * - 流式模式：透過 PUT /fs/upload 使用原始 body 直傳
   * - 表單模式：透過 POST /fs/upload multipart/form-data
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 例項");
    }

    const headers = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    // 表單模式：multipart/form-data
    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "LocalBackendForm",
        endpoint: getFullApiUrl("/fs/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: ["path", "use_multipart", "upload_id"],
        headers,
      });
    } else {
      // 流式模式：PUT + 原始 body，路徑透過 query/header 傳遞
      uppy.use(XHRUpload, {
        timeout: getUploadTimeoutMs(), // 避免大檔案/慢速網路被 30 秒進度逾時中斷
        id: "LocalBackendStream",
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
      mode: strategy || null,
    };
  }
}

