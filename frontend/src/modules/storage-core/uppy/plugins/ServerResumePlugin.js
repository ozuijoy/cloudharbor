/**
 * ServerResumePlugin - Uppy伺服器端斷點續傳外掛
 * 基於儲存伺服器狀態的智慧斷點續傳
 */

import { BasePlugin } from "@uppy/core";
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";
import { readClientLedgerParts } from "../storage-adapter/multipart/partsLedger.js";
import { PathResolver } from "../storage-adapter/tools.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ServerResumePlugin");

export default class ServerResumePlugin extends BasePlugin {
  static VERSION = "1.0.0";

  constructor(uppy, opts) {
    super(uppy, {
      // 預設配置
      autoCheck: true, // 自動檢測模式
      matchThreshold: 0.8, // 匹配閾值
      timeWindow: 24, // 時間視窗（小時）
      showConfirmDialog: true, // 顯示確認對話方塊
      customMatcher: null, // 自定義匹配演算法
      currentPath: "/", // 當前路徑

      // 使用者選擇相關配置
      maxSelectionOptions: 5, // 最多顯示幾個選項
      showMatchScore: true, // 是否顯示匹配分數

      // client_keeps（HuggingFace 等）需要用 localStorage 讀本地賬本
      storagePrefix: "uppy_multipart_",
      cacheExpiry: 24 * 60 * 60 * 1000, // 24小時
      ...opts,
    });

    this.type = "modifier";
    this.id = this.opts.id || "ServerResumePlugin";

    // 繫結方法
    this.prepareUpload = this.prepareUpload.bind(this);
    this.checkResumableUploads = this.checkResumableUploads.bind(this);
    this.findBestMatches = this.findBestMatches.bind(this);
    this.calculateMatchScore = this.calculateMatchScore.bind(this);

    // 國際化支援
    this.defaultLocale = {
      strings: {
        checkingResumableUploads: "檢查可恢復的上傳...",
        resumeUploadFound: "發現可恢復的上傳",
        resumeUploadConfirm: "是否繼續之前的上傳？",
        resumingUpload: "恢復上傳中...",
      },
    };

    this.i18nInit();
  }

  install() {
    // PreProcessor鉤子
    this.uppy.addPreProcessor(this.prepareUpload);

    log.debug("外掛已安裝");
  }

  uninstall() {
    this.uppy.removePreProcessor(this.prepareUpload);

    log.debug("外掛已解除安裝");
  }

  /**
   * 在上傳前檢查斷點續傳
   * @param {Array} fileIDs 檔案ID陣列
   * @returns {Promise} 處理完成的Promise
   */
  async prepareUpload(fileIDs) {
    if (!this.opts.autoCheck) {
      return Promise.resolve();
    }

    log.debug("開始檢查斷點續傳...");

    const promises = fileIDs.map(async (fileID) => {
      const file = this.uppy.getFile(fileID);

      // 檢查檔案是否會使用分片上傳
      if (!this.shouldUseMultipart(file)) {
        log.debug(`檔案 ${file.name} 不使用分片上傳，跳過斷點續傳檢查`);
        this.uppy.emit("preprocess-complete", file);
        return;
      }

      // 顯示檢查進度
      this.uppy.emit("preprocess-progress", file, {
        mode: "indeterminate",
        message: this.i18n("checkingResumableUploads"),
      });

      try {
        // 檢查可恢復的上傳
        const resumableUploads = await this.checkResumableUploads(file);

        if (resumableUploads.length > 0) {
          log.debug(`發現 ${resumableUploads.length} 個可恢復的上傳`);

          const selectedUpload = await new Promise((resolve) => {
            this.showMultipleUploadsDialog(file, resumableUploads, resolve);
          });

          if (selectedUpload) {
            // 標記檔案為可恢復狀態
            this.uppy.setFileMeta(fileID, {
              resumable: true,
              existingUpload: selectedUpload,
              serverResume: true,
            });

            log.debug(`檔案 ${file.name} 已標記為可恢復`);
          }
        }
      } catch (error) {
        log.error(`[ServerResumePlugin] 檢查可恢復上傳失敗:`, error);
        // 不阻斷正常上傳流程
      }

      // 完成預處理
      this.uppy.emit("preprocess-complete", file);
    });

    return Promise.all(promises);
  }

  /**
   * 判斷檔案是否會使用分片上傳
   * @param {Object} file Uppy檔案物件
   * @returns {boolean} 是否使用分片上傳
   */
  shouldUseMultipart(file) {
    // 允許透過外掛配置強制/自定義判定
    if (this.opts && Object.prototype.hasOwnProperty.call(this.opts, 'shouldUseMultipart')) {
      const opt = this.opts.shouldUseMultipart;
      if (typeof opt === 'function') {
        try { return !!opt(file); } catch (e) { /* ignore */ }
      } else {
        return !!opt;
      }
    }

    // 嘗試獲取AWS S3外掛的shouldUseMultipart配置（相容舊邏輯）
    const awsS3Plugin = this.uppy.getPlugin("AwsS3");
    if (awsS3Plugin && awsS3Plugin.opts.shouldUseMultipart) {
      if (typeof awsS3Plugin.opts.shouldUseMultipart === "function") {
        return awsS3Plugin.opts.shouldUseMultipart(file);
      } else {
        return awsS3Plugin.opts.shouldUseMultipart;
      }
    }

    // 預設不自動啟用分片，僅在外部明確指定時啟用
    return false;
  }

  /**
   * 檢查可恢復的上傳
   */
  async checkResumableUploads(file) {
    try {
      // 獲取當前路徑
      const currentPath = this.getCurrentPath();

      // 優先透過驅動查詢，解耦 API 直接依賴
      let response;
      if (typeof this.opts.resolveStorageConfigId === 'function') {
        try {
          const configId = await this.opts.resolveStorageConfigId();
          if (configId) {
            const driver = resolveDriverByConfigId(configId);
            response = await driver.fs.listUploads({ path: currentPath });
          }
        } catch (e) {
          // 無法透過驅動解析則放棄檢查
        }
      }
      if (!response) return [];

      if (!response.success || !response.data.uploads) {
        return [];
      }

      // “是否真的有進度”應該在 showSelectDialog 裡判斷：
      // - server_can_list：看 listParts
      // - client_keeps：看本地賬本
      const rawUploads = Array.isArray(response.data.uploads) ? response.data.uploads : [];

      // 使用智慧匹配演算法找到最佳匹配
      return this.findBestMatches(rawUploads, file);
    } catch (error) {
      log.error("[ServerResumePlugin] 檢查可恢復上傳失敗:", error);
      return [];
    }
  }

  /**
   * 智慧匹配演算法 - 多維度評分
   */
  findBestMatches(uploads, file) {
    if (this.opts.customMatcher) {
      return this.opts.customMatcher(uploads, file);
    }

    return uploads
      .map((upload) => ({
        upload,
        score: this.calculateMatchScore(upload, file),
      }))
      .filter((item) => item.score >= this.opts.matchThreshold)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.upload);
  }

  /**
   * 計算匹配分數
   */
  calculateMatchScore(upload, file) {
    let score = 0;

    // 檔案大小匹配
    const uploadSizeRaw = upload?.fileSize ?? upload?.file_size ?? null;
    const uploadSize = uploadSizeRaw == null ? null : Number(uploadSizeRaw);
    const currentSize = typeof file?.size === "number" ? file.size : null;
    if (uploadSize != null && Number.isFinite(uploadSize) && currentSize != null && Number.isFinite(currentSize)) {
      if (uploadSize === currentSize) {
        score += 0.3;
      } else {
        return 0;
      }
    }

    // 檔名匹配 (40%)
    if (upload.key.endsWith(file.name)) {
      score += 0.4;

      // 完全路徑匹配額外加分 (10%)
      const expectedPath = this.buildExpectedPath(file);
      if (upload.key === expectedPath) {
        score += 0.1;
      }
    }

    // 時間匹配 (30%) - 在時間視窗內
    const hoursDiff = this.getHoursDiff(upload.initiated);
    if (hoursDiff <= this.opts.timeWindow) {
      score += 0.3 * (1 - hoursDiff / this.opts.timeWindow);
    }

    // 檔名相似度 (20%)
    const similarity = this.calculateStringSimilarity(upload.key.split("/").pop(), file.name);
    score += 0.2 * similarity;

    return Math.min(score, 1.0); // 確保分數不超過1
  }

  /**
   * 顯示多個上傳選擇對話方塊
   */
  showMultipleUploadsDialog(file, uploads, resolve) {
    // 限制顯示的選項數量
    const limitedUploads = uploads.slice(0, this.opts.maxSelectionOptions);

    // 總是顯示選擇對話方塊，讓使用者選擇
    this.showSelectDialog({
      file: file,
      uploads: limitedUploads,
      onSelect: (selectedUpload) => resolve(selectedUpload),
      onCancel: () => resolve(null),
    });
  }

  /**
   * 
   * 透過事件系統與 Vue 元件通訊
   */
  async showSelectDialog(options) {
    // 為每個上傳獲取分片資訊、計算匹配分數和新增檔案大小資訊
    const uploadsWithDetails = (await Promise.all(
      options.uploads.map(async (upload) => {
        try {
          // 獲取該上傳的分片資訊
          const currentPath = this.getCurrentPath();
          const fullPath = `/${this.buildExpectedPath(options.file)}`.replace(/\/+/g, "/");

          let partsResponse;
          if (typeof this.opts.resolveStorageConfigId === 'function') {
            try {
              const configId = await this.opts.resolveStorageConfigId();
              if (configId) {
                const driver = resolveDriverByConfigId(configId);
                partsResponse = await driver.fs.listParts({ path: fullPath, uploadId: upload.uploadId, fileName: options.file.name });
              }
            } catch (e) {
              // ignore
            }
          }
          if (!partsResponse) return null;

          let uploadedParts = [];
          let partErrors = [];
          if (partsResponse.success && partsResponse.data.parts) {
            uploadedParts = partsResponse.data.parts;
            log.debug(`上傳 ${upload.uploadId.substring(0, 8)}... 有 ${uploadedParts.length} 個分片`);
          }
          if (partsResponse.success && Array.isArray(partsResponse.data?.errors)) {
            partErrors = partsResponse.data.errors;
          }

          // 服務端 list-parts 會返回空 parts，但 policy 會標記 client_keeps
          // 這時需要改用本地賬本判斷是否“真的有進度”，否則會被下面的過濾邏輯誤判為 0%。
          try {
            const policy = partsResponse?.data?.policy || null;
            const ledgerPolicyRaw =
              policy?.partsLedgerPolicy ?? policy?.parts_ledger_policy ?? null;
            const ledgerPolicy = String(ledgerPolicyRaw || "");
            if (ledgerPolicy === "client_keeps") {
              const localParts = await this.getLocalUploadedParts(upload.key);
              if (Array.isArray(localParts) && localParts.length > 0) {
                uploadedParts = localParts;
                log.debug(`client_keeps：從本地賬本讀取到 ${localParts.length} 個分片`);
              }
            }
          } catch {}

          // 沒有任何進度（0 分片且無錯誤）時，不應打擾使用者彈窗
          if (Array.isArray(uploadedParts) && uploadedParts.length === 0 && Array.isArray(partErrors) && partErrors.length === 0) {
            return null;
          }

          const bytesUploaded = Array.isArray(uploadedParts)
            ? uploadedParts.reduce((sum, p) => {
                const s = Number(p?.size ?? p?.Size ?? 0);
                if (!Number.isFinite(s) || s <= 0) return sum;
                return sum + s;
              }, 0)
            : 0;

          return {
            ...upload,
            matchScore: this.calculateMatchScore(upload, options.file),
            fileSize: options.file.size,
            uploadedParts: uploadedParts, // 新增分片資訊
            partErrors: partErrors, // 新增失敗分片資訊
            bytesUploaded,
          };
        } catch (error) {
          log.error(`[ServerResumePlugin] 獲取上傳 ${upload.uploadId} 的分片資訊失敗:`, error);
          return {
            ...upload,
            matchScore: this.calculateMatchScore(upload, options.file),
            fileSize: options.file.size,
            uploadedParts: [], // 失敗時使用空陣列
            partErrors: [],
          };
        }
      })
    )).filter(Boolean);

    // 過濾後沒有可續傳項：直接當作“沒有可恢復上傳”
    if (!uploadsWithDetails || uploadsWithDetails.length === 0) {
      try { options.onCancel?.(); } catch {}
      return;
    }

    this.uppy.emit("server-resume-select-dialog", {
      file: options.file,
      uploads: uploadsWithDetails,
      showMatchScore: this.opts.showMatchScore,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    });
  }

  /**
   * 獲取當前路徑
   */
  getCurrentPath() {
    // 優先使用配置中的路徑
    if (this.opts.currentPath && this.opts.currentPath !== "/") {
      return this.opts.currentPath;
    }

    // 從全域性狀態獲取當前路徑
    if (window.currentPath) {
      return window.currentPath;
    }

    // 預設根路徑
    return "/";
  }

  /**
   * 從 localStorage 讀取“客戶端賬本”的已上傳分片（client_keeps）
   * - StorageAdapter 會用 storagePrefix + storageKey 儲存 {parts,timestamp}
   * - 這裡只做“是否有進度”的判斷：返回的陣列長度>0 即視為可恢復
   */
  async getLocalUploadedParts(storageKey) {
    const parts = await readClientLedgerParts({
      storageKey,
      storagePrefix: this.opts.storagePrefix || "uppy_multipart_",
      cacheExpiry: this.opts.cacheExpiry || 24 * 60 * 60 * 1000,
    });

    // 統一為 {partNumber, etag, size} 形狀，便於後續 UI/日誌
    return (Array.isArray(parts) ? parts : [])
      .map((p) => ({
        partNumber: Number(p?.PartNumber ?? p?.partNumber),
        etag: p?.ETag ?? p?.etag ?? null,
        size: Number(p?.Size ?? p?.size ?? 0),
      }))
      .filter((p) => Number.isFinite(p.partNumber) && p.partNumber > 0);
  }

  /**
   * 構建期望的檔案路徑
   */
  buildExpectedPath(file) {
    const currentPath = this.getCurrentPath();
    const resolver = new PathResolver(currentPath);
    const full = resolver.buildFullPathFromKey(file?.name || "");
    return String(full || "").replace(/^\/+/, "");
  }

  /**
   * 計算時間差（小時）
   */
  getHoursDiff(initiated) {
    const uploadTime = new Date(initiated);
    const now = new Date();
    return (now - uploadTime) / (1000 * 60 * 60);
  }

  /**
   * 計算字串相似度
   */
  calculateStringSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * 計算編輯距離
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}
