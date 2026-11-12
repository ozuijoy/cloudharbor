/**
 * StorageAdapter for Uppy.js
 * 內部模組化，保持對外API不變
 */

import { useAuthStore } from "@/stores/authStore.js";
import * as fsApi from "@/api/services/fsService.js";
import { API_BASE_URL } from "@/api/config.js";
import { sha256HexFromBlob } from "@/utils/sha256.js";
import { createLogger } from "@/utils/logger.js";
import { createPartsLedger, clearAllClientLedgers } from "./storage-adapter/multipart/partsLedger.js";
import { SessionManager, AuthProvider, PathResolver, ErrorHandler } from "./storage-adapter/tools.js";
import { createMultipartUpload as createMultipartUploadImpl } from "./storage-adapter/multipartCreate.js";
import { signPart as signPartImpl, uploadPartBytes as uploadPartBytesImpl } from "./storage-adapter/multipartTransfer.js";

// @uppy/aws-s3 的 getChunkSize() 回撥拿到的是 file.data（Blob/File）
// 需要一個 Blob -> fileId 的對映，才能從 blob 反查到 meta.cloudharborMultipartChunkSize。
const BLOB_FILE_ID_MAP_KEY = Symbol.for("cloudharbor.uppy.blobFileIdMap");
const BLOB_FILE_ID_MAP_BOUND_KEY = Symbol.for("cloudharbor.uppy.blobFileIdMap.bound");
const log = createLogger("StorageAdapter");

/**
 * 分片上傳（multipart）前端的兩種模式（配合後端 driver 返回的 strategy）
 *
 * 1) per_part_url（前端直傳到上游）
 * - init：POST /api/fs/multipart/init → 返回 presignedUrls + partSize
 * - upload：瀏覽器對每個 presignedUrl 做 PUT，成功後從響應頭拿 ETag
 * - complete：POST /api/fs/multipart/complete（把 parts[{PartNumber,ETag}] 交給後端）
 * - 進度/賬本：
 *   - A（server_can_list，例如 S3）：服務端可從上游 ListParts 得到已上傳分片
 *   - B（client_keeps，例如 HuggingFace）：瀏覽器 localStorage 作為“續傳真相源”，complete 時一次性提交完整 parts
 *   - C（server_records，例如 Telegram）：分片經過後端，後端可以自己記錄（需要的話寫 DB）
 *
 * 2) single_session（前端切片 + 後端中轉到上游）
 * - init：POST /api/fs/multipart/init → 返回 session.uploadUrl（一般是 /api/fs/multipart/upload-chunk?upload_id=...）
 * - upload：瀏覽器把每片 PUT 到 CloudHarbor，後端轉發到上游（Drive/OneDrive/Telegram 等）
 * - 進度記錄：後端天然知道進度（可以按需記錄）
 *
 */

// ===== 內部工具類=====

// ===== 主類 =====

export class StorageAdapter {
  constructor(currentPath, uppyInstance = null, options = {}) {
    // 配置初始化
    this.config = {
      partSize: options.partSize || 5 * 1024 * 1024, // 5MB
      cacheExpiry: options.cacheExpiry || 24 * 60 * 60 * 1000, // 24小時
      storagePrefix: options.storagePrefix || "uppy_multipart_",
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      sessionTimeout: options.sessionTimeout || 60 * 60 * 1000, // 1小時
      requireSha256ForPresign: options.requireSha256ForPresign === true,
      // 分片預初始化：在真正開始上傳前，先請求一次 /fs/multipart/init 拿到“真實 partSize”，
      // 然後把 chunkSize 寫入 file.meta，讓 Uppy(AwsS3) 用正確的大小切片”。
      enableMultipartPreinit: options.enableMultipartPreinit === true,
      onError: options.onError,
      ...options,
    };

    // 基本屬性
    this.currentPath = currentPath;
    this.uppyInstance = uppyInstance;
    this.STORAGE_PREFIX = this.config.storagePrefix;

    // 初始化內部模組
    this.sessionManager = new SessionManager(this.config);
    this.authProvider = new AuthProvider(useAuthStore());
    this.pathResolver = new PathResolver(currentPath);
    this.errorHandler = new ErrorHandler(this.config);

    // 向後相容的屬性
    this.uploadSessions = this.sessionManager.sessions;
    this.customPausedFiles = this.sessionManager.pausedFiles;
    this.authStore = this.authProvider.authStore;

    // 可選：安裝“分片預初始化”前處理器
    this._multipartPreinitInstalled = false;
    this._multipartPreinitCacheKey = "cloudharborMultipartInit";
    this._multipartChunkSizeKey = "cloudharborMultipartChunkSize";
    this._multipartPreinit = this._multipartPreinit.bind(this);
    this._ensureBlobFileIdMap();
    if (this.config.enableMultipartPreinit && this.uppyInstance) {
      this.installMultipartPreinit();
    }
  }

  /**
   * 維護一個 Blob/File -> Uppy fileId 的 WeakMap
   * - 解決 AwsS3.getChunkSize(blob) 無法直接拿到 file.meta 的問題
   * - 這個對映掛在 uppyInstance 上，避免多個 StorageAdapter 重複繫結事件
   */
  _ensureBlobFileIdMap() {
    const uppy = this.uppyInstance;
    if (!uppy) return null;

    if (!uppy[BLOB_FILE_ID_MAP_KEY]) {
      uppy[BLOB_FILE_ID_MAP_KEY] = new WeakMap();
    }
    const map = uppy[BLOB_FILE_ID_MAP_KEY];

    // 只繫結一次事件
    if (!uppy[BLOB_FILE_ID_MAP_BOUND_KEY]) {
      uppy[BLOB_FILE_ID_MAP_BOUND_KEY] = true;
      uppy.on?.("file-added", (file) => {
        try {
          if (file?.data && typeof file.data === "object") {
            map.set(file.data, file.id);
          }
        } catch {}
      });
      uppy.on?.("file-removed", (file) => {
        try {
          if (file?.data && typeof file.data === "object") {
            map.delete(file.data);
          }
        } catch {}
      });
    }

    // 兜底：如果 adapter 建立時 Uppy 已經有檔案了，補一遍對映
    try {
      const files = typeof uppy.getFiles === "function" ? uppy.getFiles() : [];
      for (const f of files) {
        if (f?.data && typeof f.data === "object" && f?.id) {
          map.set(f.data, f.id);
        }
      }
    } catch {}

    return map;
  }

  /**
   * @uppy/aws-s3 的 getChunkSize(data) 使用：
   * - data 是 Blob/File
   * - 需要反查到 Uppy file，然後讀 meta.cloudharborMultipartChunkSize
   * @param {any} data Blob/File
   * @returns {number} chunkSize（位元組）
   */
  getChunkSizeForAwsS3(data) {
    try {
      if (!data || typeof data !== "object") return this.config.partSize || 5 * 1024 * 1024;
      const uppy = this.uppyInstance;
      if (!uppy) return this.config.partSize || 5 * 1024 * 1024;

      const map = uppy[BLOB_FILE_ID_MAP_KEY];
      const fileId = map?.get?.(data);
      if (!fileId) return this.config.partSize || 5 * 1024 * 1024;

      const uppyFile = typeof uppy.getFile === "function" ? uppy.getFile(fileId) : null;
      const n = Number(uppyFile?.meta?.[this._multipartChunkSizeKey]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);

      // 斷點續傳：優先使用伺服器會話的 partSize（listUploads 返回 existingUpload）
      const resumePartSize = Number(uppyFile?.meta?.existingUpload?.partSize);
      if (Number.isFinite(resumePartSize) && resumePartSize > 0) {
        return Math.floor(resumePartSize);
      }

      return this.config.partSize || 5 * 1024 * 1024;
    } catch {
      return this.config.partSize || 5 * 1024 * 1024;
    }
  }

  /**
   * 建立“分片賬本”（PartsLedger）
   * 統一管理已上傳分片
   */
  _createPartsLedger(policy, storageKey) {
    return createPartsLedger({
      policy: policy || null,
      storageKey,
      storagePrefix: this.config.storagePrefix,
      cacheExpiry: this.config.cacheExpiry,
    });
  }

  /**
   * 安裝分片預初始化前處理器
   * - 只在“前端直傳分片（per_part_url）”模式下需要：S3/HuggingFace
   * - 目的：提前拿到後端返回的 partSize，並寫到 file.meta 上（再由 getChunkSizeForAwsS3(blob) 反查讀取）
   */
  installMultipartPreinit() {
    if (!this.uppyInstance || this._multipartPreinitInstalled) return;
    try {
      this.uppyInstance.addPreProcessor(this._multipartPreinit);
      this._multipartPreinitInstalled = true;
    } catch (e) {
      log.warn("[StorageAdapter] 安裝 multipart 預初始化前處理器失敗（可忽略）:", e?.message || e);
    }
  }

  /**
   * 分片預初始化（Uppy preProcessor）
   * - 在 AwsS3 構造 MultipartUploader 前執行
   * - 寫入 file.meta.cloudharborMultipartInit + file.meta.cloudharborMultipartChunkSize
   */
  async _multipartPreinit(fileIDs = []) {
    if (!this.config.enableMultipartPreinit || !this.uppyInstance) return;

    const promises = (fileIDs || []).map(async (fileID) => {
      const file = this.uppyInstance.getFile(fileID);
      if (!file) return;

      // 只處理本地檔案（remote 不走這裡）
      const blob = file?.data instanceof Blob ? file.data : null;
      if (!blob) return;

      const meta = file?.meta || {};

      // 斷點續傳：如果 ServerResumePlugin 已經標記了 existingUpload，
      // 把原會話的 partSize 寫入 blob，讓 Uppy 按同樣大小切片即可。
      if (meta?.resumable && meta?.existingUpload && meta?.serverResume) {
        const existing = meta.existingUpload;
        const existingPartSize = Number(existing?.partSize ?? existing?.part_size ?? 0);
        if (Number.isFinite(existingPartSize) && existingPartSize > 0) {
          try {
            this.uppyInstance.setFileMeta(fileID, { [this._multipartChunkSizeKey]: Math.floor(existingPartSize) });
          } catch {}
        }
        return;
      }

      const cached = meta?.[this._multipartPreinitCacheKey];
      if (cached && typeof cached === "object" && cached.uploadId) {
        const cachedSize = Number(cached.partSize || cached.part_size || meta?.[this._multipartChunkSizeKey] || 0);
        if (Number.isFinite(cachedSize) && cachedSize > 0) {
          try {
            this.uppyInstance.setFileMeta(fileID, { [this._multipartChunkSizeKey]: Math.floor(cachedSize) });
          } catch {}
        }
        return;
      }

      // 需要 sha256 的場景
      let sha256 = null;
      if (this.config.requireSha256ForPresign) {
        if (typeof meta?.cloudharborSha256 === "string" && meta.cloudharborSha256) {
          sha256 = meta.cloudharborSha256;
        } else if (typeof meta?.sha256 === "string" && meta.sha256) {
          sha256 = meta.sha256;
        } else {
          throw new Error("分片上傳預初始化失敗：缺少 sha256（請先等待 SHA-256 計算完成）");
        }
        if (!sha256) {
          throw new Error("分片上傳預初始化失敗：缺少 sha256（HuggingFace 需要先算 sha256 才能拿到分片URL）");
        }
      }

      const initMessage = "初始化上傳會話（獲取分片引數）...";
      try {
        this.uppyInstance.emit("preprocess-progress", file, {
          mode: "indeterminate",
          message: initMessage,
          value: 0,
        });
      } catch {}

      let response;
      try {
        response = await fsApi.initMultipartUpload(
          this.currentPath,
          file.name,
          file.size,
          file.type,
          this.config.partSize || 5 * 1024 * 1024,
          sha256 ? { sha256 } : {},
        );
      } finally {
        try {
          this.uppyInstance.emit("preprocess-complete", file);
        } catch {}
      }

      if (!response?.success) {
        throw new Error(response?.message || "分片上傳預初始化失敗：initMultipartUpload 返回失敗");
      }

      const init = response.data || {};
      const chunkSize = Number(init.partSize || init.part_size || 0);
      if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
        throw new Error("分片上傳預初始化失敗：後端沒有返回有效的 partSize");
      }

      this.uppyInstance.setFileMeta(fileID, {
        [this._multipartPreinitCacheKey]: init,
        [this._multipartChunkSizeKey]: chunkSize,
      });
    });

    await Promise.all(promises);
  }

  /**
   * 設定Uppy例項引用
   * @param {Object} uppyInstance Uppy例項
   */
  setUppyInstance(uppyInstance) {
    this.uppyInstance = uppyInstance;
    this._ensureBlobFileIdMap();
  }

  /**
   * 設定檔案暫停狀態
   * @param {string} fileId 檔案ID
   * @param {boolean} paused 是否暫停
   */
  setFilePaused(fileId, paused) {
    this.sessionManager.setFilePaused(fileId, paused);
  }

  /**
   * 獲取效能統計資訊
   * @returns {Object} 效能統計
   */
  getPerformanceStats() {
    return {
      ...this.sessionManager.getStats(),
    };
  }

  /**
   * 獲取某個檔案的上傳會話資訊（用於 UI 提示 / commit 階段 / 除錯）。
   * 注意：這裡返回的是“本次上傳流程”的會話，不代表儲存側的真實狀態。
   * @param {string} fileId
   * @returns {any|null}
   */
  getUploadSession(fileId) {
    return this.uploadSessions.get(fileId) || null;
  }

  /**
   * 判斷某個檔案是否觸發了“跳過上傳”（例如：物件儲存側已存在內容，秒傳/去重）。
   * @param {string} fileId
   * @returns {boolean}
   */
  isUploadSkipped(fileId) {
    const session = this.getUploadSession(fileId);
    return session?.skipUpload === true;
  }

  /**
   * 更新當前路徑
   * @param {string} newPath 新路徑
   */
  updatePath(newPath) {
    this.currentPath = newPath;
    this.pathResolver.updatePath(newPath);
  }

  /**
   * 銷燬介面卡，清理資源
   */
  destroy() {
    // 移除本 adapter 安裝的預初始化前處理器，避免切換上傳方式後舊的前處理器仍殘留在 Uppy 上
    if (this._multipartPreinitInstalled && this.uppyInstance) {
      try {
        this.uppyInstance.removePreProcessor(this._multipartPreinit);
      } catch {}
      this._multipartPreinitInstalled = false;
    }
    this.sessionManager.destroy();
  }

  /**
   * 批次處理預簽名上傳的commit階段
   * @param {Array} successfulFiles 成功上傳的檔案列表
   * @returns {Promise<{failures: Array}>} commit結果
   */
  async batchCommitPresignedUploads(successfulFiles) {
    if (!successfulFiles || successfulFiles.length === 0) {
      return { failures: [] };
    }

    log.debug(`開始批次commit ${successfulFiles.length} 個檔案`);
    const failures = [];

    // 併發處理commit，提高效能
    const commitPromises = successfulFiles.map(async (file) => {
      try {
        await this.commitPresignedUpload(file, file.response);
        return { file, success: true };
      } catch (error) {
        log.error(`[StorageAdapter] ❌ commit失敗: ${file.name}`, error);
        failures.push({
          fileName: file.name,
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
        return { file, success: false, error };
      }
    });

    // 等待所有commit操作完成
    const results = await Promise.allSettled(commitPromises);

    // 統計結果
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failureCount = failures.length;

    log.debug(`批次commit完成: ${successCount}成功, ${failureCount}失敗`);

    if (failures.length > 0) {
      log.warn(`[StorageAdapter] commit失敗詳情:`, failures);
    }

    return {
      failures,
      successCount,
      failureCount,
      totalCount: successfulFiles.length,
    };
  }

  /**
   * 從 Uppy 的 response 裡儘量提取 ETag
   * - ETag 在後端 commit 階段是可選的：拿不到也不要阻斷上傳完成
   * @param {any} uploadResponse
   * @returns {string|null}
   */
  _extractEtagFromUploadResponse(uploadResponse) {
    try {
      // 允許直接傳字串
      if (typeof uploadResponse === "string") {
        const s = uploadResponse.trim();
        return s ? s : null;
      }

      const candidates = [
        uploadResponse?.etag,
        uploadResponse?.ETag,
        uploadResponse?.headers?.etag,
        uploadResponse?.headers?.ETag,
        uploadResponse?.body?.etag,
        uploadResponse?.body?.ETag,
        uploadResponse?.body?.headers?.etag,
        uploadResponse?.body?.headers?.ETag,
      ];

      for (const value of candidates) {
        if (typeof value === "string") {
          const s = value.trim();
          if (s) return s;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 預簽名單檔案上傳（presigned-single）的 commit 階段
   * - 前端 PUT 直傳完成後，還需要呼叫後端 /api/fs/presign/commit 做“登記/落庫/重新整理目錄快取”
   * - HuggingFace LFS 場景：commit 需要 sha256（oid），ETag 不強依賴
   * @param {Object} file Uppy file
   * @param {any} uploadResponse Uppy file.response
   */
  async commitPresignedUpload(file, uploadResponse) {
    const fileId = file?.id;
    if (!fileId) {
      throw new Error("提交預簽名上傳失敗：缺少 file.id");
    }

    const session = this.uploadSessions.get(fileId);
    if (!session) {
      throw new Error("提交預簽名上傳失敗：找不到上傳會話資訊（可能已被清理）");
    }

    const targetPath = session?.targetPath;
    const mountId = session?.mountId;
    if (!targetPath || !mountId) {
      throw new Error("提交預簽名上傳失敗：缺少 targetPath 或 mountId");
    }

    const contentType = session?.contentType || file?.type || "application/octet-stream";
    const fileSize = Number(file?.size ?? 0);

    // ETag：優先使用 uploadPartBytes 裡快取到 session 的值；再嘗試從 uploadResponse 裡解析；最後允許為空
    let etag = null;
    if (session?.skipUpload === true) {
      etag = null;
    } else if (typeof session?.etag === "string" && session.etag.trim()) {
      etag = session.etag.trim();
    } else {
      etag = this._extractEtagFromUploadResponse(uploadResponse);
    }

    const uploadInfo = {
      targetPath,
      mountId,
      storageConfigId: session?.storageConfigId ?? null,
      fileId: session?.fileId ?? null,
      storagePath: session?.storagePath ?? null,
      sha256: session?.sha256 ?? null,
    };

    const response = await fsApi.commitPresignedUpload(uploadInfo, etag, contentType, fileSize);
    if (!response?.success) {
      throw new Error(response?.message || "提交預簽名上傳失敗");
    }

    // commit 成功後清理會話
    this.uploadSessions.delete(fileId);

    return response?.data || response;
  }

  /**
   * 檢查檔案是否被暫停
   * @param {string} fileId 檔案ID
   * @returns {boolean} 是否暫停
   */
  isFilePaused(fileId) {
    return this.customPausedFiles.has(fileId);
  }

  /**
   * 從上傳URL獲取對應的檔案ID
   * @param {string} url 上傳URL
   * @returns {string|null} 檔案ID
   */
  getFileIdFromUrl(url) {
    // 從uploadSessions中查詢匹配的檔案ID
    for (const [fileId, session] of this.uploadSessions.entries()) {
      if (session.presignedUrls && session.presignedUrls.some((urlInfo) => url.includes(urlInfo.partNumber))) {
        return fileId;
      }
    }
    return null;
  }

  /**
   * 獲取認證頭部 - 用於XHR Upload外掛
   * @returns {Object} 認證頭部物件
   */
  getAuthHeaders() {
    return this.authProvider.getAuthHeaders();
  }

  /**
   * 單檔案上傳引數獲取 預簽名URL上傳
   * @param {Object} file Uppy檔案物件
   * @param {Object} options 選項
   * @returns {Promise<Object>} {method, url, fields, headers}
   */
  async getUploadParameters(file, options = {}) {
    try {
      log.debug(`獲取預簽名URL上傳引數: ${file.name}`);

      const requireSha256ForPresign = this.config.requireSha256ForPresign === true;
      const blob = file?.data instanceof Blob ? file.data : null;
      const metaSha256 =
        (typeof file?.meta?.cloudharborSha256 === "string" && file.meta.cloudharborSha256) ||
        (typeof file?.meta?.sha256 === "string" && file.meta.sha256) ||
        null;
      // sha256 取值順序：
      // 1) Uppy preprocess 寫入的 file.meta.cloudharborSha256（最推薦）
      // 2) 兜底：本次直接用 blob 現算一次
      let sha256 = null;
      if (requireSha256ForPresign) {
        if (typeof metaSha256 === "string" && metaSha256) {
          sha256 = metaSha256;
        } else if (blob) {
          sha256 = await sha256HexFromBlob(blob);
        }
        if (!sha256) {
          throw new Error("預簽名上傳需要 sha256，但當前檔案無法計算 sha256（請重試或換一種上傳方式）");
        }
      }

      const response = await fsApi.getPresignedUploadUrl(
        this.currentPath,
        file.name,
        file.type,
        file.size,
        sha256,
      );

      if (!response.success) {
        throw new Error(response.message || "獲取預簽名URL失敗");
      }

      const data = response.data || {};

      // 對“需要 sha256 的預簽名上傳”，後端必須回傳 sha256（便於 commit 階段對齊）
      if (requireSha256ForPresign && (!data.sha256 || typeof data.sha256 !== "string")) {
        throw new Error("預簽名上傳失敗：後端沒有返回 sha256（無法進入 commit 階段）");
      }

      // 統一一次 sha256 的“最終值”（用於 commit / UI 展示）
      let canonicalSha256 = null;
      if (typeof data.sha256 === "string" && data.sha256) {
        canonicalSha256 = data.sha256;
      } else if (typeof sha256 === "string" && sha256) {
        canonicalSha256 = sha256;
      } else if (typeof metaSha256 === "string" && metaSha256) {
        canonicalSha256 = metaSha256;
      }

      // 快取上傳資訊，供commit使用
      this.uploadSessions.set(file.id, {
        targetPath: data.targetPath,
        mountId: data.mountId,
        fileId: data.fileId,
        storagePath: data.storagePath,
        publicUrl: data.publicUrl,
        storageConfigId: data.storageConfigId,
        contentType: data.contentType,
        storageType: data.storageType || data.storage_type || null,
        sha256: canonicalSha256,
        skipUpload: data.skipUpload === true,
      });

      // 用於 UI 在上傳完成後統計“跳過上傳（秒傳/去重）”數量
      try {
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, { cloudharborSkipUpload: data.skipUpload === true });
        }
      } catch {}

      const baseHeaders = data.headers || {};
      const headers = {
        "Content-Type": baseHeaders["Content-Type"] || file.type || "application/octet-stream",
        ...baseHeaders,
      };

      const skipUpload = data.skipUpload === true;

      // HuggingFace LFS “去重”場景：上游可能不給 uploadUrl（表示物件已存在，無需再次上傳）
      if (skipUpload) {
        headers["x-cloudharbor-skip-upload"] = "1";
      }

      return {
        method: "PUT",
        url: skipUpload ? `${API_BASE_URL}/__uppy_skip_upload__` : data.presignedUrl,
        fields: {},
        headers,
        skipUpload,
        fileId: file.id,
      };
    } catch (error) {
      log.error("[StorageAdapter] 獲取預簽名URL上傳引數失敗:", error);
      throw error;
    }
  }

  /**
   * 建立分片上傳
   * @param {Object} file Uppy檔案物件
   * @returns {Promise<Object>} {uploadId, key}
   */
  async createMultipartUpload(file) {
    return createMultipartUploadImpl.call(this, file);
  }

  /**
   * 簽名分片
   * @param {Object} file Uppy檔案物件
   * @param {Object} partData 分片資料 {uploadId, key, partNumber, body}
   * @returns {Promise<Object>} {url, headers}
   */
  async signPart(file, partData) {
    return signPartImpl.call(this, file, partData);
  }

  /**
   * 完成分片上傳
   * @param {Object} file Uppy檔案物件
   * @param {Object} data {uploadId, key, parts}
   * @returns {Promise<Object>} {location}
   */
  async completeMultipartUpload(file, data) {
    try {
      log.debug(`完成分片上傳: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (!session) {
        throw new Error("找不到上傳會話資訊");
      }

      const incomingParts = Array.isArray(data?.parts) ? data.parts : [];
      let partsToSend = incomingParts;

      // HuggingFace LFS 去重：skipUpload=true 表示物件已存在，不需要真實上傳，也不需要 ETag。
      // 後端會基於 session.provider_meta.skipUpload 跳過 multipart completion，只做 lfsFile commit 並標記會話 completed。
      if (session?.skipUpload === true) {
        partsToSend = [];
      }

      // per_part_url：complete 必須提交完整 parts（PartNumber + ETag）。
      // - client_keeps：重新整理頁面後 Uppy 只知道“本次頁面上傳的 parts”，必須和本地賬本合併
      // - server_can_list：斷點續傳時 Uppy 也可能只帶“本次頁面上傳的 parts”，需要合併“恢復時已存在的分片”
      try {
        if (session?.skipUpload !== true && session?.key) {
          const storageKey = String(session.key || "").replace(/^\/+/, "");
          const partsLedger =
            session?.partsLedger || this._createPartsLedger(session?.policy || null, storageKey);
          if (!session.partsLedger) session.partsLedger = partsLedger;
          try {
            await partsLedger.load?.();
          } catch {}

          const mergedAll = partsLedger.mergeIncomingParts(incomingParts);
          const completeParts = (Array.isArray(mergedAll) ? mergedAll : [])
            .filter((p) => typeof p?.ETag === "string" && p.ETag.length > 0)
            .map((p) => ({ PartNumber: Number(p.PartNumber), ETag: p.ETag }))
            .filter((p) => Number.isFinite(p.PartNumber) && p.PartNumber > 0);

          if (completeParts.length > 0) {
            partsToSend = completeParts;
          } else if (Array.isArray(mergedAll) && mergedAll.length > 0) {
            throw new Error("完成分片上傳失敗：本地賬本里缺少 ETag（請重試或重新開始上傳）");
          }
        }
      } catch (e) {
        throw e;
      }

      const response = await fsApi.completeMultipartUpload(
        session.path,
        data.uploadId,
        partsToSend,
        session.fileName,
        file.size,
      );

      if (!response.success) {
        throw new Error(response.message || "完成分片上傳失敗");
      }

      // 清理上傳會話和分片快取
      this.uploadSessions.delete(file.id);
      try {
        session?.partsLedger?.clearPersistent?.();
      } catch {}

      return {
        location: response.data.url || `${session.path}/${session.fileName}`,
      };
    } catch (error) {
      log.error("[StorageAdapter] 完成分片上傳失敗:", error);
      throw error;
    }
  }

  /**
   * 中止分片上傳
   * @param {Object} file Uppy檔案物件
   * @param {Object} data {uploadId, key}
   */
  async abortMultipartUpload(file, data) {
    try {
      log.debug(`中止分片上傳: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (session) {
        await fsApi.abortMultipartUpload(session.path, data.uploadId, session.fileName);
        // 清理上傳會話和分片快取
        this.uploadSessions.delete(file.id);
        try {
          session?.partsLedger?.clearPersistent?.();
        } catch {}
      }
    } catch (error) {
      log.error("[StorageAdapter] 中止分片上傳失敗:", error);
      // 中止操作失敗不應該丟擲錯誤，只記錄日誌
    }
  }

  /**
   * 列出已上傳的分片
   * 使用前端快取，避免重複呼叫後端API
   * @param {Object} file Uppy檔案物件
   * @param {Object} options {uploadId, key}
   * @returns {Promise<Array>} 分片列表
   */
  async listParts(file, { uploadId, key }) {
    try {
      log.debug(`listParts被呼叫: ${file.name}, uploadId: ${uploadId}, key: ${key}`);

      // key 是 storageKey（無前導 /），API 的 path 是 fsPath（以 / 開頭）
      const storageKey = String(key || "").replace(/^\/+/, "");
      const fsPath = this.buildFullPathFromKey(storageKey);

      const session = this.uploadSessions.get(file.id) || null;
      const basePolicy = session?.policy || null;

      // client_keeps 會持久化；其它只用記憶體（避免 S3 寫 localStorage）
      let partsLedger = session?.partsLedger || this._createPartsLedger(basePolicy, storageKey);
      if (session && !session.partsLedger) session.partsLedger = partsLedger;
      try {
        await partsLedger.load?.();
      } catch {}

      // client_keeps：服務端 list-parts 永遠是空，直接信本地賬本
      if (partsLedger.ledgerPolicy === "client_keeps") {
        const cached = partsLedger.toAwsPartsArray();
        log.debug(`client_keeps：使用本地賬本（${cached.length}片）`);
        return cached;
      }

      log.debug(`回源查詢伺服器 listMultipartParts`);
      const response = await fsApi.listMultipartParts(fsPath, uploadId, file.name);
      if (!response?.success) {
        throw new Error(response?.message || "listMultipartParts 失敗");
      }

      // 服務端回傳 policy 時：如果是 client_keeps，就切換到本地賬本
      const policyFromServer = response?.data?.policy || null;
      const ledgerPolicyFromServerRaw =
        policyFromServer?.partsLedgerPolicy ?? policyFromServer?.parts_ledger_policy ?? null;
      const ledgerPolicyFromServer = String(ledgerPolicyFromServerRaw || "");

      if (ledgerPolicyFromServer === "client_keeps") {
        partsLedger = this._createPartsLedger(policyFromServer, storageKey);
        try {
          await partsLedger.load?.();
        } catch {}
        if (session) session.partsLedger = partsLedger;
        const cached = partsLedger.toAwsPartsArray();
        log.debug(`client_keeps：服務端標記後切換到本地賬本（${cached.length}片）`);
        return cached;
      }

      const serverParts = Array.isArray(response?.data?.parts) ? response.data.parts : [];
      partsLedger.replaceAll(serverParts);
      const normalized = partsLedger.toAwsPartsArray();
      log.debug(`伺服器返回${normalized.length}個分片（已寫入記憶體賬本）`);
      return normalized;
    } catch (error) {
      log.error("[StorageAdapter] listParts失敗:", error);
      return [];
    }
  }

  /**
   * 上傳分片位元組
   * 控制實際的分片上傳過程，在這裡處理已上傳分片的跳過邏輯
   * @param {Object} options {signature, body, onComplete, size, onProgress, signal}
   * @returns {Promise<Object>} {ETag}
   */
  async uploadPartBytes({ signature, body, onComplete, size, onProgress, signal }) {
    return uploadPartBytesImpl.call(this, { signature, body, onComplete, size, onProgress, signal });
  }

  /**
   * 單檔案直傳（presigned-single）適配
   */
  async uploadSingleFile({ signature, body, onComplete, size, onProgress, signal }) {
    return await this.uploadPartBytes({ signature, body, onComplete, size, onProgress, signal });
  }

  cleanup() {
    this.uploadSessions.clear();
    const removed = clearAllClientLedgers({ storagePrefix: this.config.storagePrefix });
    log.debug(`清理所有上傳會話與客戶端賬本：removed=${removed}`);
  }

  /**
   * 從storage key構建完整的掛載點路徑
   * @param {string} storageKey 儲存的相對路徑
   * @returns {string} 完整的掛載點路徑
   */
  buildFullPathFromKey(storageKey) {
    return this.pathResolver.buildFullPathFromKey(storageKey);
  }
}
