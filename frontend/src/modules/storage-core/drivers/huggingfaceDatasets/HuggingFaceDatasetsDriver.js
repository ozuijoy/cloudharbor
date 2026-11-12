import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import Sha256PreprocessPlugin from "@/modules/storage-core/uppy/plugins/Sha256PreprocessPlugin.js";
import { sha256HexFromBlob } from "@/utils/sha256.js";
import { API_BASE_URL } from "@/api/config.js";
import { api } from "@/api";
import { LocalDriver } from "@/modules/storage-core/drivers/local/LocalDriver.js";
import { createCapabilities, STORAGE_STRATEGIES } from "@/modules/storage-core/drivers/types.js";

/**
 * HuggingFace Datasets 儲存驅動（前端）
 *
 */
export class HuggingFaceDatasetsDriver extends LocalDriver {
  constructor(config = {}) {
    super(config);

    // 預簽名上傳
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

    this.share.applyDirectShareUploader = this.applyDirectShareUploader.bind(this);

    // Read-only helpers for resume plugin（對齊 S3）：讓前端能列出進行中的上傳 / 已上傳分片
    this.fs.listUploads = this.listUploads.bind(this);
    this.fs.listParts = this.listParts.bind(this);
  }

  /**
   * FS 上傳外掛安裝
   * - presigned-single：走 /api/fs/presign，拿到 uploadUrl 後直傳
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) throw new Error("applyFsUploader 需要提供 Uppy 例項");

    if (strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE || strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;

      // HuggingFace LFS：預簽名（無論單檔案還是分片）都必須先算 sha256（oid）
      // “先算 sha256（有進度）→ 再 /multipart/init（拿分片URL/partSize）” 的順序穩定。
      const shaPlugin = uppy.getPlugin("Sha256PreprocessPlugin");
      const shaOpts = { enabled: true, maxWebCryptoSize: 10_000_000, metaKey: "cloudharborSha256" };
      if (shaPlugin) {
        try {
          shaPlugin.setOptions(shaOpts);
        } catch {}
      } else {
        uppy.use(Sha256PreprocessPlugin, shaOpts);
      }

      // HF LFS 必須要 sha256（oid）才能拿到 upload 指令（無論是 basic 還是 multipart）
      const adapter = new StorageAdapter(path || "/", uppy, {
        requireSha256ForPresign: true,
        enableMultipartPreinit: isMultipart,
      });

      const limitFromConfig = Number(this.config?.hf_multipart_concurrency);
      const multipartLimit = Number.isFinite(limitFromConfig) && limitFromConfig > 0 ? Math.floor(limitFromConfig) : 5;

      const awsS3Opts = {
        id: "AwsS3",
        limit: isMultipart ? multipartLimit : 3,
        shouldUseMultipart: () => isMultipart,
        // 讓 Uppy(AwsS3) 用後端返回的 partSize 切片
        // AwsS3.getChunkSize() 實際拿到的是 file.data（Blob/File），不是 Uppy 的 file 物件。
        getChunkSize: (data) => adapter.getChunkSizeForAwsS3(data),
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
      return { adapter, mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE };
    }

    // 其它策略（stream/form）走後端中轉
    return super.applyFsUploader(uppy, { strategy, path });
  }

  // Read-only helpers for resume plugin -------------------------------------
  async listUploads({ path } = {}) {
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }

  /**
   * Share 預簽名上傳（上傳即分享）
   * - /api/share/presign：拿到 uploadUrl（HF 實際返回的是 S3 presigned URL）
   * - 瀏覽器 PUT 到 uploadUrl（不經過你的 Worker）
   * - /api/share/commit：後端完成“登記/提交”，並建立 share 記錄
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 例項");

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) throw new Error("缺少 storage_config_id，無法初始化 HuggingFace 分享上傳");

    const basePayload = {
      ...(payload || {}),
      storage_config_id: storageConfigId,
    };

    const pluginId = "AwsS3ShareHuggingFaceDatasets";
    if (uppy.getPlugin(pluginId)) return;

    // HF LFS 必須要 sha256 才能換到 uploadUrl，所以這裡強制開啟“上傳前算 sha256”
    const shaPlugin = uppy.getPlugin("Sha256PreprocessPlugin");
    const shaOpts = { enabled: true, maxWebCryptoSize: 10_000_000, metaKey: "cloudharborSha256" };
    if (shaPlugin) {
      try {
        shaPlugin.setOptions(shaOpts);
      } catch {}
    } else {
      uppy.use(Sha256PreprocessPlugin, shaOpts);
    }

    // 複用 StorageAdapter 的 uploadPartBytes（內部用 XHR，含重試、skipUpload）
    const adapter = new StorageAdapter("/", uppy);

    // ===== 大檔分片（修正：分享上傳原本只能整檔單次 PUT）=====
    // 整檔一次 PUT 到 hf-hub-lfs-*.s3-accelerate.amazonaws.com，在連線會被重置的網路上必定失敗，
    // 而且 URL 只有 15 分鐘效期，重試時已過期（403）。超過門檻改向後端要 HF multipart 指令，逐片直傳。
    const SHARE_MULTIPART_THRESHOLD = 16 * 1024 * 1024;
    const isLargeFile = (file) => Number(file?.size || file?.data?.size || 0) > SHARE_MULTIPART_THRESHOLD;
    const resolveFileName = (file) => {
      const meta = file?.meta || {};
      return typeof meta?.name === "string" && meta.name ? meta.name : file.name;
    };
    const resolveSha256 = async (file) => {
      const meta = file?.meta || {};
      if (typeof meta?.cloudharborSha256 === "string" && meta.cloudharborSha256) return meta.cloudharborSha256;
      if (typeof meta?.sha256 === "string" && meta.sha256) return meta.sha256;
      const blob = file?.data instanceof Blob ? file.data : null;
      return blob ? await sha256HexFromBlob(blob) : null;
    };

    // 前處理器：在 AwsS3 切片前拿到 HF 的 partSize 與每片 URL（必須排在 sha256 計算之後）
    const sharePreinit = async (fileIDs = []) => {
      for (const fileID of fileIDs || []) {
        const file = uppy.getFile(fileID);
        if (!file || !isLargeFile(file)) continue;
        if (file.meta?.cloudharborShareMp) continue;
        const sha256 = await resolveSha256(file);
        if (!sha256) throw new Error("HuggingFace 分片上傳需要 sha256，但當前檔案無法計算 sha256");
        const meta = file.meta || {};
        const fileName = resolveFileName(file);
        try {
          uppy.emit("preprocess-progress", file, { mode: "indeterminate", message: "初始化分片上傳...", value: 0 });
        } catch {}
        let presign;
        try {
          presign = await api.file.getUploadPresignedUrl({
            storage_config_id: basePayload.storage_config_id,
            filename: fileName,
            mimetype: file.type || "application/octet-stream",
            path: meta.path ?? basePayload.path,
            size: file.size,
            sha256,
            multipart: true,
          });
        } finally {
          try {
            uppy.emit("preprocess-complete", file);
          } catch {}
        }
        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "獲取分片上傳 URL 失敗");
        }
        const data = presign.data || {};
        const skipUpload = data.skipUpload === true;
        const partSize = Number(data.partSize) > 0 ? Math.floor(Number(data.partSize)) : file.size;
        uppy.setFileMeta(file.id, {
          key: data.key,
          storage_config_id: data.storage_config_id || basePayload.storage_config_id,
          filename: typeof data.filename === "string" && data.filename ? data.filename : fileName,
          path: meta.path ?? basePayload.path,
          slug: meta.slug ?? basePayload.slug,
          password: basePayload.password || meta.password || null,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          sha256: typeof data.sha256 === "string" && data.sha256 ? data.sha256 : sha256,
          skipUpload,
          cloudharborMultipartChunkSize: skipUpload ? file.size : partSize,
          cloudharborShareMp: {
            mode: data.mode || "multipart",
            presignedUrls: Array.isArray(data.presignedUrls) ? data.presignedUrls : [],
            completionUrl: data.completionUrl || null,
          },
        });
      }
    };
    // 同一個 Uppy 可能多次建立分享會話：先移除舊的前處理器（舊閉包帶著上一次的 slug/密碼等設定）
    if (uppy.__cloudharborHfSharePreinit) {
      try {
        uppy.removePreProcessor(uppy.__cloudharborHfSharePreinit);
      } catch {}
    }
    uppy.__cloudharborHfSharePreinit = sharePreinit;
    uppy.addPreProcessor(sharePreinit);
    // 上傳失敗後清掉分片指令，重試時重新向 HF 要新的（舊 URL 可能已過期）
    if (!uppy.__cloudharborHfShareErrorHooked) {
      uppy.__cloudharborHfShareErrorHooked = true;
      uppy.on("upload-error", (file) => {
        try {
          if (file?.id && uppy.getFile(file.id)) {
            uppy.setFileMeta(file.id, { cloudharborShareMp: null, cloudharborShareParts: null });
          }
        } catch {}
      });
    }

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: (file) => isLargeFile(file),
      getChunkSize: (data) => adapter.getChunkSizeForAwsS3(data),
      limit: Number(this.config?.hf_multipart_concurrency) > 0 ? Math.floor(Number(this.config.hf_multipart_concurrency)) : 4,
      createMultipartUpload: async (file) => {
        const f = uppy.getFile(file.id) || file;
        if (!f?.meta?.cloudharborShareMp) await sharePreinit([file.id]);
        const latest = uppy.getFile(file.id) || f;
        return { uploadId: `hf-share-${file.id}`, key: latest?.meta?.key || "" };
      },
      signPart: async (file, { partNumber }) => {
        const latest = uppy.getFile(file.id) || file;
        const meta = latest?.meta || {};
        if (meta.skipUpload === true) {
          return {
            url: `${API_BASE_URL}/__uppy_skip_upload__`,
            headers: { "x-cloudharbor-skip-upload": "1" },
            skipUpload: true,
            partNumber,
            fileId: file.id,
          };
        }
        const urls = meta?.cloudharborShareMp?.presignedUrls || [];
        const hit = urls.find((u) => Number(u?.partNumber) === Number(partNumber));
        if (!hit?.url) {
          throw new Error(`找不到分片 ${partNumber} 的上傳 URL（HF 共回傳 ${urls.length} 片）`);
        }
        return {
          url: hit.url,
          headers: { "Content-Type": "application/octet-stream" },
          partNumber,
          fileId: file.id,
        };
      },
      uploadPartBytes: adapter.uploadPartBytes.bind(adapter),
      listParts: async () => [],
      abortMultipartUpload: async () => {},
      completeMultipartUpload: async (file, { parts }) => {
        const normalized = (Array.isArray(parts) ? parts : [])
          .map((p) => ({ partNumber: Number(p?.PartNumber ?? p?.partNumber), etag: p?.ETag ?? p?.etag ?? null }))
          .filter((p) => Number.isFinite(p.partNumber) && p.partNumber > 0);
        try {
          uppy.setFileMeta(file.id, { cloudharborShareParts: normalized });
        } catch {}
        return { location: "" };
      },
      getUploadParameters: async (file) => {
        const meta = file?.meta || {};
        // 檔名取值順序：
        // 1) Uppy Dashboard 裡使用者改過的 meta.name
        // 2) 否則用 file.name
        const fileName = typeof meta?.name === "string" && meta.name ? meta.name : file.name;
        const blob = file?.data instanceof Blob ? file.data : null;
        // sha256 取值順序（HF LFS 預簽名必須要）：
        // 1) 預處理外掛寫入的 meta.cloudharborSha256
        // 2) 兜底：本次直接計算一次
        let sha256 = null;
        if (typeof meta?.cloudharborSha256 === "string" && meta.cloudharborSha256) {
          sha256 = meta.cloudharborSha256;
        } else if (typeof meta?.sha256 === "string" && meta.sha256) {
          sha256 = meta.sha256;
        } else if (blob) {
          sha256 = await sha256HexFromBlob(blob);
        }
        if (!sha256) {
          throw new Error("HuggingFace 預簽名上傳需要 sha256，但當前檔案無法計算 sha256");
        }

        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: basePayload.storage_config_id,
          filename: fileName,
          mimetype: file.type || "application/octet-stream",
          path: meta.path ?? basePayload.path,
          size: file.size,
          sha256,
        });

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "獲取預簽名URL失敗");
        }

        const data = presign.data || {};
        const uploadUrl = data.uploadUrl || data.upload_url || "";
        const skipUpload = data.skipUpload === true || !uploadUrl;

        // 後端回傳的 sha256 是“本次上傳會話的最終值”，優先使用
        const canonicalSha256 =
          typeof data.sha256 === "string" && data.sha256 ? data.sha256 : sha256;

        // 持久化 commit 所需後設資料（給 /api/share/commit 用）
        try {
          uppy.setFileMeta(file.id, {
            key: data.key,
            storage_config_id: data.storage_config_id || basePayload.storage_config_id,
            filename: typeof data.filename === "string" && data.filename ? data.filename : fileName,
            path: meta.path ?? basePayload.path,
            slug: meta.slug ?? basePayload.slug,
            password: basePayload.password || meta.password || null,
            expires_in: basePayload.expires_in,
            max_views: basePayload.max_views,
            sha256: canonicalSha256,
            skipUpload,
          });
        } catch {}

        const headers = { ...(data.headers || {}) };
        if (skipUpload) {
          headers["x-cloudharbor-skip-upload"] = "1";
        }

        return {
          method: "PUT",
          url: skipUpload ? `${API_BASE_URL}/__uppy_skip_upload__` : uploadUrl,
          headers,
          skipUpload,
        };
      },
    });

    // 成功後執行 commit（建立分享記錄 + HF 倉庫登記）
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
          sha256: typeof meta?.sha256 === "string" && meta.sha256 ? meta.sha256 : null,
          slug: meta.slug,
          remark: basePayload.remark,
          password: basePayload.password,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          use_proxy: basePayload.use_proxy,
          original_filename: basePayload.original_filename ?? false,
          path: meta.path,
          // 分片上傳：後端先呼叫 HF completionUrl 合併分片，再登記到倉庫
          ...(meta?.cloudharborShareMp?.mode === "multipart" &&
          meta?.cloudharborShareMp?.completionUrl &&
          meta.skipUpload !== true
            ? {
                multipart: {
                  completionUrl: meta.cloudharborShareMp.completionUrl,
                  parts: Array.isArray(meta.cloudharborShareParts) ? meta.cloudharborShareParts : [],
                },
              }
            : {}),
        });

        if (commitRes?.data) {
          const shareRecord = commitRes.data;
          try {
            uppy.setFileMeta(file.id, { fileId: shareRecord.id, shareRecord, skipUpload: meta.skipUpload === true });
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
   * Share 直傳（stream/form）
   */
  applyDirectShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    return LocalDriver.prototype.applyShareUploader.call(this, uppy, { payload, onShareRecord, shareMode });
  }
}
