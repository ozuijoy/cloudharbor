/**
 * 檔案系統統一抽象層
 * 同時服務於網頁端API和WebDAV協議
 * 內部根據儲存能力選擇最優實現
 */

import { ValidationError, AuthorizationError, DriverError } from "../../http/errors.js";
import { ApiStatus, FILE_TYPES, FILE_TYPE_NAMES, UserType } from "../../constants/index.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";
import {
  listDirectory as featureListDirectory,
  getFileInfo as featureGetFileInfo,
  downloadFile as featureDownloadFile,
  exists as featureExists,
} from "./features/read.js";
import {
  generateUploadUrl as featureGenerateUploadUrl,
  generateFileLink as featureGenerateFileLink,
  commitPresignedUpload as featureCommitPresignedUpload,
} from "./features/presign.js";
import { uploadFile as featureUploadFile, uploadDirect as featureUploadDirect, createDirectory as featureCreateDirectory, updateFile as featureUpdateFile } from "./features/write.js";
import { renameItem as featureRenameItem, copyItem as featureCopyItem, batchRemoveItems as featureBatchRemoveItems } from "./features/ops.js";
import {
  initializeFrontendMultipartUpload as featureInitMultipart,
  completeFrontendMultipartUpload as featureCompleteMultipart,
  abortFrontendMultipartUpload as featureAbortMultipart,
  listMultipartUploads as featureListMultipartUploads,
  listMultipartParts as featureListMultipartParts,
  signMultipartParts as featureSignMultipartParts,
  relayMultipartPart as featureRelayMultipartPart,
} from "./features/multipart.js";
import cacheBus, { CACHE_EVENTS } from "../../cache/cacheBus.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { getAccessibleMountsForUser } from "../../security/helpers/access.js";
import { GetFileType } from "../../utils/fileTypeDetector.js";
import { FsMetaService } from "../../services/fsMetaService.js";
import { jobTypeCatalog } from "./tasks/JobTypeCatalog.js";
import { calculateSubPath, normalizeMountPath } from "./utils/MountResolver.js";
import { normalizePath as normalizeFsPath } from "./utils/PathResolver.js";
import { FsSearchIndexStore } from "./search/FsSearchIndexStore.js";
/**
 * 模組說明：
 * - 角色：FS 檢視的門面層，連線路由/API 與底層儲存驅動。
 * - 職責：掛載解析、許可權校驗、快取失效、CRUD/分片/預簽名/跨儲存複製/搜尋的排程，具體操作委託 fs/features/*。
 * - 約定：所有驅動呼叫透過能力檢查（CAPABILITIES），不直接依賴具體驅動型別；輸入路徑均為掛載檢視路徑。
 */

export class FileSystem {
  /**
   * 建構函式
   * @param {MountManager} mountManager - 掛載管理器例項
   * @param {Object} env - 執行時環境（可選，用於 TaskOrchestrator 初始化）
   */
  constructor(mountManager, env = null) {
    this.mountManager = mountManager;
    this.repositoryFactory = mountManager?.repositoryFactory ?? null;
    this.env = env;
    this._taskOrchestrator = null; // 懶載入的 TaskOrchestrator 例項
  }

  /**
   * 列出目錄內容
   * @param {string} path - 目錄路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @param {boolean} options.refresh - 是否強制重新整理，跳過快取
   * @returns {Promise<Object>} 目錄內容
   */
  async listDirectory(path, userIdOrInfo, userType, options = {}) {
    const baseResult = await featureListDirectory(this, path, userIdOrInfo, userType, options);

    try {
      const db = this.mountManager?.db;
      if (!db) {
        return baseResult;
      }

      const metaService = new FsMetaService(db, this.repositoryFactory);
      const resolvedMeta = await metaService.resolveMetaForPath(path);

      // 僅向前端暴露與展示相關的 meta 欄位，避免洩露路徑密碼
      const safeMeta =
        resolvedMeta && (resolvedMeta.headerMarkdown || resolvedMeta.footerMarkdown || (resolvedMeta.hidePatterns?.length ?? 0) > 0)
          ? {
              headerMarkdown: resolvedMeta.headerMarkdown ?? null,
              footerMarkdown: resolvedMeta.footerMarkdown ?? null,
              hidePatterns: resolvedMeta.hidePatterns ?? [],
            }
          : null;

      return {
        ...baseResult,
        meta: safeMeta,
      };
    } catch (error) {
      console.warn("解析 FS Meta 失敗，將返回基礎目錄結果：", error);
      return baseResult;
    }
  }

  /**
   * 獲取檔案資訊
   * @param {string} path - 檔案路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Request} request - 請求物件（用於構建完整URL）
   * @returns {Promise<Object>} 檔案資訊
   */
  async getFileInfo(path, userIdOrInfo, userType, request = null) {
    return await featureGetFileInfo(this, path, userIdOrInfo, userType, request);
  }

  /**
   * 下載檔案
   * @param {string} path - 檔案路徑
   * @param {string} fileName - 檔名
   * @param {Request} request - 請求物件
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<import('../streaming/types.js').StorageStreamDescriptor>} 流描述物件
   */
  async downloadFile(path, fileName, request, userIdOrInfo, userType) {
    return await featureDownloadFile(this, path, fileName, request, userIdOrInfo, userType);
  }

  /**
   * 上傳檔案（統一入口）
   * @param {string} path - 目標路徑
   * @param {ReadableStream|ArrayBuffer|Uint8Array|Buffer|File|Blob|string} fileOrStream - 資料來源
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @param {string} options.filename - 檔名
   * @param {string} options.contentType - 內容型別
   * @param {number} options.contentLength - 內容長度
   * @returns {Promise<Object>} 上傳結果
   */
  async uploadFile(path, fileOrStream, userIdOrInfo, userType, options = {}) {
    return await featureUploadFile(this, path, fileOrStream, userIdOrInfo, userType, options);
  }

  /**
   * 直傳二進位制資料到儲存（與文件的 upload-direct 對齊）
   * @param {string} path - 目標目錄或完整檔案路徑
   * @param {ReadableStream|ArrayBuffer|Uint8Array} body - 原始請求體或記憶體資料
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項
   * @param {string} options.filename - 檔名（當 path 為目錄時必需）
   * @param {string} options.contentType - 內容型別
   * @param {number} options.contentLength - 內容長度
   * @returns {Promise<Object>} 上傳結果
   */
  async uploadDirect(path, body, userIdOrInfo, userType, options = {}) {
    return await featureUploadDirect(this, path, body, userIdOrInfo, userType, options);
  }

  /**
   * 預簽名上傳完成後的處理（快取失效/目錄時間更新）
   * @param {string} path - 目標目錄或完整檔案路徑
   * @param {string} filename - 檔名（當 path 為目錄時必需）
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項 { fileSize, etag, contentType }
   * @returns {Promise<Object>} 處理結果
   */
  async commitPresignedUpload(path, filename, userIdOrInfo, userType, options = {}) {
    return await featureCommitPresignedUpload(this, path, filename, userIdOrInfo, userType, options);
  }

  /**
   * 建立目錄
   * @param {string} path - 目錄路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 建立結果
   */
  async createDirectory(path, userIdOrInfo, userType) {
    return await featureCreateDirectory(this, path, userIdOrInfo, userType);
  }

  /**
   * 重新命名檔案或目錄
   * @param {string} oldPath - 原路徑
   * @param {string} newPath - 新路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 重新命名結果
   */
  async renameItem(oldPath, newPath, userIdOrInfo, userType) {
    return await featureRenameItem(this, oldPath, newPath, userIdOrInfo, userType);
  }

  /**
   * 複製檔案或目錄
   * @param {string} sourcePath - 源路徑
   * @param {string} targetPath - 目標路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 複製結果
   */
  async copyItem(sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
    return await featureCopyItem(this, sourcePath, targetPath, userIdOrInfo, userType, options);
  }

  /**
   * 批次刪除檔案和目錄
   * @param {Array<string>} paths - 路徑陣列
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 批次刪除結果
   */
  async batchRemoveItems(paths, userIdOrInfo, userType) {
    return await featureBatchRemoveItems(this, paths, userIdOrInfo, userType);
  }

  /**
   * 生成預簽名上傳URL（嚴格模式，僅支援具備 PRESIGNED 能力的驅動）
   * @param {string} path - 檔案路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 預簽名上傳URL資訊
   */
  async generateUploadUrl(path, userIdOrInfo, userType, options = {}) {
    return await featureGenerateUploadUrl(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 生成通用檔案連結（根據驅動能力與掛載配置在預簽名與代理之間做決策）
   * @param {string} path - 檔案路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 檔案連結資訊 { url, type, expiresIn?, proxyPolicy? }
   */
  async generateFileLink(path, userIdOrInfo, userType, options = {}) {
    return await featureGenerateFileLink(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 初始化前端分片上傳（生成預簽名URL列表）
   *
   * 多數驅動只需要 {fileName,fileSize,partSize,partCount}
   * 但像 HuggingFace LFS 這種協議，需要額外透傳 sha256(oid) 才能換到分片預簽名 URL
   * 例如 HuggingFace LFS 需要 sha256(oid) 才能拿到分片預簽名 URL
   *
   * @param {string} path
   * @param {string} fileName
   * @param {number} fileSize
   * @param {string|Object} userIdOrInfo
   * @param {string} userType
   * @param {number} partSize
   * @param {number} partCount
   * @param {Object} extraOptions 額外引數（可選）：{ sha256?, oid?, contentType? }
   */
  async initializeFrontendMultipartUpload(path, fileName, fileSize, userIdOrInfo, userType, partSize = 5 * 1024 * 1024, partCount, extraOptions = {}) {
    return await featureInitMultipart(this, path, fileName, fileSize, userIdOrInfo, userType, partSize, partCount, extraOptions || {});
  }

  /**
   * 完成前端分片上傳
   * @param {string} path - 完整路徑
   * @param {string} uploadId - 上傳ID
   * @param {Array} parts - 分片資訊
   * @param {string} fileName - 檔名
   * @param {number} fileSize - 檔案大小
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 完成結果
   */
  async completeFrontendMultipartUpload(path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType) {
    return await featureCompleteMultipart(this, path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType);
  }

  /**
   * 中止前端分片上傳
   * @param {string} path - 完整路徑
   * @param {string} uploadId - 上傳ID
   * @param {string} fileName - 檔名
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 中止結果
   */
  async abortFrontendMultipartUpload(path, uploadId, fileName, userIdOrInfo, userType) {
    return await featureAbortMultipart(this, path, uploadId, fileName, userIdOrInfo, userType);
  }

  /**
   * 列出進行中的分片上傳
   * @param {string} path - 目標路徑（可選，用於過濾特定檔案的上傳）
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 進行中的上傳列表
   */
  async listMultipartUploads(path = "", userIdOrInfo, userType, options = {}) {
    return await featureListMultipartUploads(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 列出已上傳的分片
   * @param {string} path - 目標路徑
   * @param {string} uploadId - 上傳ID
   * @param {string} fileName - 檔名
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 已上傳的分片列表
   */
  async listMultipartParts(path, uploadId, fileName, userIdOrInfo, userType, options = {}) {
    return await featureListMultipartParts(this, path, uploadId, fileName, userIdOrInfo, userType, options);
  }

  /**
   * 為現有上傳重新整理預簽名URL
   * @param {string} path - 目標路徑
   * @param {string} uploadId - 現有的上傳ID
   * @param {Array} partNumbers - 需要重新整理URL的分片編號陣列
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 重新整理的預簽名URL列表
   */
  async signMultipartParts(path, uploadId, partNumbers, userIdOrInfo, userType, options = {}) {
    return await featureSignMultipartParts(this, path, uploadId, partNumbers, userIdOrInfo, userType, options);
  }

  /**
   * 分片中轉：由後端把單一分片轉發到上游儲存（HuggingFace 等）
   * @param {string} path - 目標路徑
   * @param {string} uploadId - 上傳會話ID
   * @param {number} partNumber - 分片編號
   * @param {ArrayBuffer|Buffer} body - 分片位元組
   */
  async relayMultipartPart(path, uploadId, partNumber, body, userIdOrInfo, userType, options = {}) {
    return await featureRelayMultipartPart(this, path, uploadId, partNumber, body, userIdOrInfo, userType, options);
  }

  /**
   * 檢查檔案或目錄是否存在
   * @param {string} path - 檔案或目錄路徑
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(path, userIdOrInfo, userType) {
    return await featureExists(this, path, userIdOrInfo, userType);
  }

  /**
   * 更新檔案內容
   * @param {string} path - 檔案路徑
   * @param {string} content - 新內容
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 更新結果
   */
  async updateFile(path, content, userIdOrInfo, userType) {
    return await featureUpdateFile(this, path, content, userIdOrInfo, userType);
  }

  /**
   * 搜尋檔案
   * @param {string} query - 搜尋查詢
   * @param {Object} searchParams - 搜尋引數
   * @param {string} searchParams.scope - 搜尋範圍 ('global', 'mount', 'directory')
   * @param {string} searchParams.mountId - 掛載點ID（當scope為'mount'時）
   * @param {string} searchParams.path - 搜尋路徑（當scope為'directory'時）
   * @param {number} searchParams.limit - 結果限制數量，預設50
   * @param {string|null} searchParams.cursor - 分頁遊標（不透明字串）
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {Array<Object>} accessibleMounts - 可訪問掛載點列表（可選，未提供則內部查詢）
   * @returns {Promise<Object>} 搜尋結果
   */
  async searchFiles(query, searchParams, userIdOrInfo, userType, accessibleMounts = null, options = {}) {
    const { scope = "global", mountId, path, limit = 50, cursor = null } = searchParams;

    // 引數驗證（trigram contains：統一最小長度=3）
    if (!query || query.trim().length < 3) {
      throw new ValidationError("搜尋查詢至少需要3個字元");
    }

    if (!["global", "mount", "directory"].includes(scope)) {
      throw new ValidationError("無效的搜尋範圍");
    }

    // mount/directory：必須顯式指定 mountId（避免“名為 mount 的 global 搜尋”這種語義歧義）
    if ((scope === "mount" || scope === "directory") && (!mountId || typeof mountId !== "string")) {
      throw new ValidationError("mountId 不能為空");
    }

    if (limit < 1 || limit > 200) {
      throw new ValidationError("limit引數必須在1-200之間");
    }

    const { pathToken = null, pathTokens = [], verifyPathPasswordToken = null, encryptionSecret = null } = options;
    const canVerifyPathPassword = userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function";
    const db = this.mountManager?.db;

    const tokenCandidates = [];
    const tokenSet = new Set();
    if (typeof pathToken === "string" && pathToken) {
      tokenCandidates.push(pathToken);
      tokenSet.add(pathToken);
    }
    if (Array.isArray(pathTokens)) {
      for (const token of pathTokens) {
        if (typeof token === "string" && token && !tokenSet.has(token)) {
          tokenCandidates.push(token);
          tokenSet.add(token);
        }
      }
    }

    const normalizeSearchPath = (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      if (!raw) return "/";
      const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
      const collapsed = withLeading.replace(/\/{2,}/g, "/");
      return collapsed.replace(/\/+$/g, "") || "/";
    };

    const resolveBasicPath = () => {
      if (typeof userIdOrInfo === "string") {
        return "/";
      }
      return userIdOrInfo?.basicPath ?? "/";
    };

    const basicPath = userType === UserType.API_KEY ? resolveBasicPath() : "/";
    const normalizedBasicPath = normalizeSearchPath(basicPath);

    const requestedPathPrefix =
      scope === "directory" && typeof path === "string" && path
        ? normalizeSearchPath(path)
        : null;

    let effectivePathPrefix = requestedPathPrefix;

    if (userType === UserType.API_KEY && normalizedBasicPath !== "/") {
      if (!effectivePathPrefix) {
        effectivePathPrefix = normalizedBasicPath;
      } else if (
        effectivePathPrefix === normalizedBasicPath ||
        effectivePathPrefix.startsWith(`${normalizedBasicPath}/`)
      ) {
        // 目錄範圍在 basicPath 內，保持使用者選擇
      } else if (normalizedBasicPath.startsWith(`${effectivePathPrefix}/`)) {
        // 使用者選擇了 basicPath 的父級目錄，收斂到 basicPath
        effectivePathPrefix = normalizedBasicPath;
      } else {
        throw new AuthorizationError("搜尋路徑越權");
      }
    }

    if (canVerifyPathPassword && (!db || !encryptionSecret)) {
      throw new DriverError("路徑密碼校驗不可用");
    }

    // 獲取可訪問的掛載點 - 為安全起見，這裡也做兜底
    let resolvedMounts = accessibleMounts;
    if (!resolvedMounts) {
      try {
        if (userType === UserType.ADMIN) {
          const factory = this.repositoryFactory ?? ensureRepositoryFactory(this.mountManager.db);
          const mountRepository = factory.getMountRepository();
          resolvedMounts = await mountRepository.findAll(false); // 管理員：全部活躍掛載
        } else if (userType === UserType.API_KEY) {
          // API金鑰使用者：嚴格限制在其可訪問掛載集合內
          const factory = this.repositoryFactory ?? ensureRepositoryFactory(this.mountManager.db);
          resolvedMounts = await getAccessibleMountsForUser(this.mountManager.db, userIdOrInfo, userType, factory);
        } else {
          resolvedMounts = [];
        }
      } catch (error) {
        throw new DriverError("獲取可訪問掛載失敗");
      }
    }

    if (!resolvedMounts || resolvedMounts.length === 0) {
      return {
        results: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
        searchParams: searchParams,
      };
    }

    // 根據搜尋範圍過濾掛載點
    let targetMounts = resolvedMounts;
    if ((scope === "mount" || scope === "directory") && mountId) {
      targetMounts = resolvedMounts.filter((mount) => mount.id === mountId);
      if (targetMounts.length === 0) {
        throw new AuthorizationError("沒有許可權訪問指定的掛載點");
      }
    }

    const allowedMountIds = targetMounts.map((m) => m?.id).filter(Boolean);
    const store = new FsSearchIndexStore(this.mountManager?.db);

    const indexStates = await store.getIndexStates(allowedMountIds);
    const mountIndexStatusMap = new Map(
      allowedMountIds.map((id) => {
        const row = indexStates.get(id);
        return [id, String(row?.status || "not_ready")];
      }),
    );

    const notReadyMountIds = allowedMountIds.filter((id) => mountIndexStatusMap.get(id) !== "ready");
    const readyMountIds = allowedMountIds.filter((id) => mountIndexStatusMap.get(id) === "ready");

    // Index-only：不做實時掃描兜底、不做隱式觸發重建
    //
    // 約定：
    // - global：只搜尋“索引 ready 的掛載點”，其他掛載點視為“跳過”（支援“我不想索引某些儲存”）。
    // - mount/directory：目標掛載點未 ready 時直接返回 indexReady=false（避免返回不完整但又像完整結果）。
    const skippedMounts = notReadyMountIds.map((id) => ({
      mountId: id,
      status: mountIndexStatusMap.get(id) || "not_ready",
      reason: "index_not_ready",
    }));

    if (scope !== "global") {
      if (readyMountIds.length !== allowedMountIds.length) {
        return {
          results: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
          mountsSearched: 0,
          searchParams: { ...searchParams, cursor: cursor || null },
          indexReady: false,
          indexNotReadyMountIds: notReadyMountIds,
          skippedMounts,
          hint: "索引未就緒：請在管理後臺觸發索引重建（或配置定時重建）後再搜尋。",
        };
      }
    } else {
      // global：只對 ready 的掛載點執行索引檢索；未 ready 的掛載點不阻塞全域性搜尋
      if (readyMountIds.length === 0) {
        return {
          results: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
          mountsSearched: 0,
          searchParams: { ...searchParams, cursor: cursor || null },
          indexReady: false,
          indexNotReadyMountIds: notReadyMountIds,
          skippedMounts,
          hint: "索引未就緒：當前沒有任何可搜尋的掛載點索引（ready）。請先觸發索引重建後再搜尋。",
        };
      }
    }

    const mountInfoMap = new Map(targetMounts.map((m) => [m.id, m]));

    const filterByPassword = async (items) => {
      if (!canVerifyPathPassword) {
        return { visible: items, filteredCount: 0 };
      }
      const visible = [];
      let filteredCount = 0;
      const candidates = tokenCandidates.length > 0 ? tokenCandidates : [null];
      for (const item of items) {
        let allowed = false;
        for (const token of candidates) {
          const verification = await verifyPathPasswordToken(db, item.path, token, encryptionSecret);
          if (!verification.requiresPassword || verification.verified) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          filteredCount += 1;
          continue;
        }
        visible.push(item);
      }
      return { visible, filteredCount };
    };

    let collected = [];
    let filteredByPassword = 0;
    let remaining = limit;
    let pageCursor = cursor || null;
    let hasMore = false;
    let nextCursor = null;
    let unfilteredTotal = null;

    while (remaining > 0) {
      const indexResult = await store.search({
        query,
        allowedMountIds: scope === "global" ? readyMountIds : allowedMountIds,
        scope,
        mountId,
        pathPrefix: effectivePathPrefix,
        limit: remaining,
        cursor: pageCursor,
      });

      if (typeof indexResult.total === "number" && unfilteredTotal === null) {
        unfilteredTotal = indexResult.total;
      }

      const { visible, filteredCount } = await filterByPassword(indexResult.results);
      collected.push(...visible);
      filteredByPassword += filteredCount;
      remaining = limit - collected.length;

      if (!indexResult.hasMore || !indexResult.nextCursor) {
        break;
      }

      if (remaining <= 0) {
        hasMore = true;
        nextCursor = indexResult.nextCursor;
        break;
      }

      pageCursor = indexResult.nextCursor;
    }

    // 補齊掛載顯示欄位（避免 join，直接用記憶體對映）
    const enriched = collected.map((item) => {
      const mountRow = mountInfoMap.get(item.mount_id);
      return {
        ...item,
        mount_name: mountRow?.name ?? null,
        storage_type: mountRow?.storage_type ?? null,
      };
    });

    // 補齊型別欄位（用於前端圖示顯示）
    // - 目錄：固定為 FOLDER
    // - 檔案：按檔名副檔名推斷（與目錄列表 buildFileInfo 的行為一致）
    const typedResults = await Promise.all(
      enriched.map(async (item) => {
        const isDirectory = Boolean(item?.isDirectory);
        const name = String(item?.name || "");

        const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(name, this.mountManager?.db);
        const typeName = FILE_TYPE_NAMES[type] || FILE_TYPE_NAMES[FILE_TYPES.UNKNOWN] || "unknown";

        return {
          ...item,
          type,
          typeName,
        };
      }),
    );

    const pathRestricted = userType === UserType.API_KEY && normalizedBasicPath !== "/";

    return {
      results: typedResults,
      total: typeof unfilteredTotal === "number" ? unfilteredTotal : typedResults.length,
      hasMore,
      nextCursor,
      mountsSearched: scope === "global" ? readyMountIds.length : targetMounts.length,
      searchParams: { ...searchParams, path: effectivePathPrefix || searchParams.path || "", cursor: cursor || null },
      indexReady: true,
      indexPartial: scope === "global" && skippedMounts.length > 0,
      searchableMountIds: scope === "global" ? readyMountIds : allowedMountIds,
      skippedMounts: scope === "global" ? skippedMounts : [],
      indexNotReadyMountIds: scope === "global" ? notReadyMountIds : [],
      pathRestricted,
      pathRestrictedPrefix: pathRestricted ? effectivePathPrefix : null,
      passwordFilteredCount: filteredByPassword,
    };
  }

  emitCacheInvalidation(payload = {}) {
    try {
      const { mount = null, mountId = null, storageConfigId = null, paths = [], reason = "fs_operation" } = payload;
      const resolvedMountId = mount?.id ?? mountId ?? null;
      const resolvedStorageConfigId = mount?.storage_config_id ?? storageConfigId ?? null;
      const rawPaths = Array.isArray(paths) ? paths.filter((path) => typeof path === "string" && path.length > 0) : [];

      // - 若能解析 mount.mount_path，則將 fullPath -> subPath；讓 DirectoryCacheManager.invalidatePathAndAncestors 正確命中。
      // - 若無法解析（缺少 mount 或路徑不在 mount 內），降級為掛載點級失效（paths=[]），保證一致性優先。
      let normalizedSubPaths = rawPaths;
      let normalizedDirSubPaths = [];
      if (rawPaths.length > 0) {
        const mountPathRaw = mount?.mount_path || null;
        if (!mountPathRaw) {
          normalizedSubPaths = [];
        } else {
          const mountPath = normalizeMountPath(mountPathRaw);
          const mapped = [];
          let mappingFailed = false;

          for (const p of rawPaths) {
            // NOTE: 是否目錄（以 / 結尾）只用於“失效粒度收斂”，不能在 normalizeFsPath 後判斷。
            const isDirectoryHint = p.endsWith("/");
            const fullPath = normalizeFsPath(p);
            if (fullPath === mountPath || fullPath === `${mountPath}/` || fullPath.startsWith(`${mountPath}/`)) {
              mapped.push({ subPath: calculateSubPath(fullPath, mountPath), isDirectoryHint });
            } else {
              mappingFailed = true;
              break;
            }
          }

          if (mappingFailed) {
            normalizedSubPaths = [];
            normalizedDirSubPaths = [];
          } else {
            // - 目錄路徑（以 / 結尾的 hint）：失效該目錄自身（祖先級聯會覆蓋父目錄）。
            // - 檔案路徑：失效其父目錄。
            const toParentDir = (subPath) => {
              const raw = typeof subPath === "string" && subPath ? subPath : "/";
              const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
              const collapsed = withLeading.replace(/\/{2,}/g, "/");
              if (collapsed === "/") return "/";
              const normalized = collapsed.replace(/\/+$/, "");
              const lastSlash = normalized.lastIndexOf("/");
              if (lastSlash <= 0) return "/";
              return normalized.slice(0, lastSlash) || "/";
            };

            const dirSet = new Set();
            const dirHintSet = new Set();
            for (const item of mapped) {
              const sp = item?.subPath;
              if (!sp) continue;
              if (item.isDirectoryHint) {
                dirSet.add(sp);
                dirHintSet.add(sp);
              } else {
                dirSet.add(toParentDir(sp));
              }
            }

            // KISS：超過閾值直接降級為 mount 級失效。
            const MAX_INVALIDATION_DIRS = 200;
            const degrade = dirSet.size > MAX_INVALIDATION_DIRS;
            normalizedSubPaths = degrade ? [] : Array.from(dirSet);
            normalizedDirSubPaths = degrade ? [] : Array.from(dirHintSet);
          }
        }
      }

      cacheBus.emit(CACHE_EVENTS.INVALIDATE, {
        target: "fs",
        mountId: resolvedMountId,
        storageConfigId: resolvedStorageConfigId,
        paths: normalizedSubPaths,
        dirPaths: normalizedDirSubPaths,
        reason,
        db: this.mountManager.db,
      });

      // ==================== FS 搜尋索引 dirty 入隊（增量更新入口） ====================
      // 約束：
      // - 僅記錄派生資料變更，不影響主業務資料
      // - 不在此處做重活（不掃描、不 rebuild），只入隊，由後臺任務消費
      // - 依賴 resolvedMountId + rawPaths（full fs path）；若缺失則跳過
        if (resolvedMountId && rawPaths.length > 0) {
          const db = this.mountManager?.db;
          if (db) {
            const store = new FsSearchIndexStore(db);
            const ops = [];
            const MAX_DIRTY_OPS_PER_EVENT = 200;

          const ensureDirPath = (p) => {
            const s = typeof p === "string" ? p : "";
            if (!s) return "/";
            const normalized = normalizeFsPath(s);
            if (normalized === "/") return "/";
            return `${normalized.replace(/\/+$/g, "")}/`;
          };

          const parentDirPath = (p) => {
            const normalized = normalizeFsPath(p);
            if (!normalized || normalized === "/") return "/";
            const trimmed = normalized.replace(/\/+$/g, "");
            const idx = trimmed.lastIndexOf("/");
            if (idx <= 0) return "/";
            const parent = trimmed.slice(0, idx) || "/";
            return ensureDirPath(parent);
          };

          const toDirtyDirectory = (raw) => {
            const isDirHint = typeof raw === "string" && raw.endsWith("/");
            const normalized = normalizeFsPath(raw);
            if (!normalized) return "/";
            return isDirHint ? ensureDirPath(normalized) : parentDirPath(normalized);
          };

          const commonDirPrefix = (dirs) => {
            const list = Array.isArray(dirs) ? dirs.filter(Boolean) : [];
            if (list.length === 0) return "/";

            const toSegs = (dir) =>
              String(dir || "/")
                .replace(/^\/+|\/+$/g, "")
                .split("/")
                .filter(Boolean);

            let prefix = toSegs(list[0]);
            for (let i = 1; i < list.length; i++) {
              const segs = toSegs(list[i]);
              const next = [];
              const len = Math.min(prefix.length, segs.length);
              for (let j = 0; j < len; j++) {
                if (prefix[j] !== segs[j]) break;
                next.push(prefix[j]);
              }
              prefix = next;
              if (prefix.length === 0) break;
            }

            if (prefix.length === 0) return "/";
            return `/${prefix.join("/")}/`;
          };

          // reason 約定：
          // - rename: paths=[oldPath,newPath]
          // - batch-remove: paths=[...]
          // - 其他：視為 upsert（新增/更新/複製/mkdir/upload 等）
          if (reason === "rename" && rawPaths.length >= 2) {
            const oldPath = rawPaths[0];
            const newPath = rawPaths[1];
            ops.push({ mountId: resolvedMountId, fsPath: oldPath, op: "delete" });
            ops.push({ mountId: resolvedMountId, fsPath: newPath, op: "upsert" });
          } else if (rawPaths.length > MAX_DIRTY_OPS_PER_EVENT) {
            // KISS：大批次變更不逐條入隊，避免 D1/SQLite 寫入放大
            // - 統一合併成“目錄 upsert”讓後臺任務掃描子樹並做 runId 清理，以實現正確的 contains 搜尋結果
            // - 對 delete/upsert 的混合場景：用 upsert 目錄子樹重建是更穩妥的“收斂語義”
            const dirs = rawPaths.map(toDirtyDirectory);
            const dirPrefix = commonDirPrefix(dirs);
            ops.push({ mountId: resolvedMountId, fsPath: dirPrefix, op: "upsert" });
          } else if (reason === "batch-remove") {
            for (const p of rawPaths) {
              ops.push({ mountId: resolvedMountId, fsPath: p, op: "delete" });
            }
          } else {
            for (const p of rawPaths) {
              ops.push({ mountId: resolvedMountId, fsPath: p, op: "upsert" });
            }
          }

          // 入隊（去重合並）
          for (const item of ops) {
            // emitCacheInvalidation 為同步函式：這裡用“盡力而為”非同步寫入，避免影響主流程
            void store
              .upsertDirty({
                mountId: String(item.mountId),
                fsPath: String(item.fsPath),
                op: item.op,
              })
              .catch((err) => {
                console.warn("[FsIndexDirty] upsertDirty failed", err?.message || err);
              });
          }
        }
      }
    } catch (error) {
      console.warn("cache.invalidate emit failed", error);
    }
  }

  /**
   * 獲取儲存統計資訊
   * @param {string} path - 路徑（可選，用於特定掛載點的統計）
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 統計資訊
   */
  async getStats(path, userIdOrInfo, userType) {
    if (path) {
      const { driver } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);
      // 安全檢查：getStats 是可選方法，不是所有驅動都實現
      if (typeof driver.getStats === "function") {
        return await driver.getStats();
      }
      // 驅動未實現 getStats，返回基本資訊
      return {
        type: driver.getType?.() || "unknown",
        supported: false,
        message: "此儲存驅動不支援統計資訊",
      };
    } else {
      // 返回整個檔案系統的統計資訊
      return {
        type: "FileSystem",
        mountManager: this.mountManager.constructor.name,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 獲取 TaskOrchestrator 例項（懶載入）
   * @private
   * @returns {Promise<TaskOrchestratorAdapter>} TaskOrchestrator 例項
   */
  async getTaskOrchestrator() {
    if (!this._taskOrchestrator) {
      // 動態匯入 TaskOrchestrator 工廠函式
      const { createTaskOrchestrator } = await import('./tasks/index.js');

      // 構建 RuntimeEnv 物件
      const runtimeEnv = {
        // Cloudflare Workers bindings (如果存在)
        JOB_WORKFLOW: this.env?.JOB_WORKFLOW,
        DB: this.env?.DB,

        // Docker/Node.js configuration (由 unified-entry.js 自動設定，複用主資料庫)
        TASK_DATABASE_PATH: this.env?.TASK_DATABASE_PATH,
        TASK_WORKER_POOL_SIZE: this.env?.TASK_WORKER_POOL_SIZE,
      };

      this._taskOrchestrator = createTaskOrchestrator(this, runtimeEnv);
    }

    return this._taskOrchestrator;
  }

  /**
   * 建立通用作業 (支援多工型別)
   * @param {string} taskType - 任務型別 (copy, scheduled-sync, cleanup, etc.)
   * @param {any} payload - 任務載荷 (由 TaskHandler 驗證)
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @param {{triggerType?: string, triggerRef?: (string|null)}|undefined} meta - 觸發來源資訊（可選）
   * @returns {Promise<Object>} 作業描述符 { jobId, taskType, status, stats, createdAt }
   */
  async createJob(taskType, payload, userIdOrInfo, userType, meta) {
    if (!taskType || typeof taskType !== 'string') {
      throw new ValidationError('請提供有效的任務型別');
    }

    if (!payload) {
      throw new ValidationError('請提供任務載荷');
    }

    const orchestrator = await this.getTaskOrchestrator();

    const triggerType = meta?.triggerType ?? 'manual';
    const triggerRef = meta?.triggerRef ?? null;

    // 建立作業 (驗證邏輯由 TaskHandler 負責)
    const jobDescriptor = await orchestrator.createJob({
      taskType,
      payload,
      userId: typeof userIdOrInfo === 'string' ? userIdOrInfo : userIdOrInfo?.id || userIdOrInfo?.name,
      userType,
      triggerType,
      triggerRef,
    });

    return jobDescriptor;
  }

  /**
   * 計算任務的允許操作
   * @private
   * @param {Object} job - 任務物件
   * @param {number|undefined} userPermissions - 使用者許可權位標誌
   * @param {string} userType - 使用者型別
   * @returns {Object} 允許的操作 { canView, canCancel, canDelete, canRetry }
   */
  _computeAllowedActions(job, userPermissions, userType) {
    const canRetryForType = jobTypeCatalog.isRetryable(job?.taskType);
    const isVisibleType = jobTypeCatalog.isVisibleToPrincipal(job?.taskType, {
      userType,
      permissions: userPermissions,
    });

    // 管理員擁有所有操作許可權
    if (userType === UserType.ADMIN) {
      return {
        canView: true,
        canCancel: ['pending', 'running'].includes(job.status),
        canDelete: !['pending', 'running'].includes(job.status),
        canRetry: canRetryForType && ['failed', 'partial'].includes(job.status),
      };
    }

    return {
      canView: isVisibleType,
      canCancel: isVisibleType && ['pending', 'running'].includes(job.status),
      canDelete: isVisibleType && !['pending', 'running'].includes(job.status),
      canRetry: isVisibleType && canRetryForType && ['failed', 'partial'].includes(job.status),
    };
  }

  /**
   * 獲取作業狀態
   * @param {string} jobId - 作業ID
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<Object>} 作業狀態 { jobId, taskType, status, stats, allowedActions, ... }
   */
  async getJobStatus(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('請提供作業ID');
    }

    const orchestrator = await this.getTaskOrchestrator();
    const jobStatus = await orchestrator.getJobStatus(jobId);

    // 許可權驗證：只有任務建立者或管理員可以檢視
    if (userType !== UserType.ADMIN) {
      const currentUserId = typeof userIdOrInfo === 'string'
        ? userIdOrInfo
        : userIdOrInfo?.id || userIdOrInfo?.name;

      if (jobStatus.userId !== currentUserId) {
        throw new AuthorizationError('無權訪問此任務');
      }
    }

    // 計算允許的操作
    const userPermissions = typeof userIdOrInfo === 'object' ? userIdOrInfo?.permissions : undefined;
    if (userType !== UserType.ADMIN) {
      const visible = jobTypeCatalog.isVisibleToPrincipal(jobStatus.taskType, {
        userType,
        permissions: userPermissions,
      });
      if (!visible) {
        throw new AuthorizationError('無權訪問此型別任務');
      }
    }
    const allowedActions = this._computeAllowedActions(jobStatus, userPermissions, userType);

    return {
      ...jobStatus,
      allowedActions,
    };
  }

  /**
   * 取消作業
   * @param {string} jobId - 作業ID
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<void>}
   */
  async cancelJob(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('請提供作業ID');
    }

    // 先獲取任務狀態並驗證許可權（複用 getJobStatus 的許可權檢查）
    const jobStatus = await this.getJobStatus(jobId, userIdOrInfo, userType);

    // 檢查任務狀態是否可取消
    if (jobStatus.status !== 'pending' && jobStatus.status !== 'running') {
      throw new ValidationError('只能取消待執行或執行中的任務');
    }

    // 檢查操作許可權（基於 allowedActions）
    // - 先做“狀態”校驗，避免把“已結束任務不可取消”誤報為 403（許可權問題）。
    if (!jobStatus.allowedActions?.canCancel) {
      throw new AuthorizationError('無權取消此任務');
    }

    const orchestrator = await this.getTaskOrchestrator();
    await orchestrator.cancelJob(jobId);
  }

  /**
   * 列出作業 (支援任務型別過濾)
   * @param {Object} filter - 過濾條件
   * @param {string} filter.taskType - 任務型別（copy, scheduled-sync, cleanup, etc.）
   * @param {string[]} filter.taskTypes - 任務型別陣列（僅內部使用）
   * @param {string} filter.status - 作業狀態（pending/running/completed/partial/failed/cancelled）
   * @param {string} filter.userId - 使用者ID（內部使用，由許可權檢查邏輯控制）
   * @param {number} filter.limit - 返回數量限制
   * @param {number} filter.offset - 偏移量
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<{ jobs: Array<Object>, total: number }>} 作業描述符陣列（含 allowedActions）
   */
  async listJobs(filter = {}, userIdOrInfo, userType) {
    // 非管理員使用者：強制過濾為只能看到自己的任務
    const finalFilter = { ...filter };

    const userPermissions = typeof userIdOrInfo === 'object' ? userIdOrInfo?.permissions : undefined;

    if (userType !== UserType.ADMIN) {
      const currentUserId = typeof userIdOrInfo === 'string'
        ? userIdOrInfo
        : userIdOrInfo?.id || userIdOrInfo?.name;

      // 強制設定 userId 過濾條件，防止非管理員檢視他人任務
      finalFilter.userId = currentUserId;

      const visibleTypes = jobTypeCatalog
        .listVisibleTypes({ userType, permissions: userPermissions })
        .map((item) => item.taskType)
        .filter(Boolean);

      if (finalFilter.taskType) {
        if (!visibleTypes.includes(finalFilter.taskType)) {
          return { jobs: [], total: 0 };
        }
      } else if (visibleTypes.length > 0) {
        finalFilter.taskTypes = visibleTypes;
      } else {
        return { jobs: [], total: 0 };
      }
    }

    const orchestrator = await this.getTaskOrchestrator();
    const { jobs: rawJobs, total } = await orchestrator.listJobs(finalFilter);
    let jobs = rawJobs;
    let finalTotal = total;

    // 非管理員使用者：按 JobTypeCatalog 的 visibility 過濾（未知型別預設不可見）
    if (userType !== UserType.ADMIN) {
      const visibleJobs = jobs.filter((job) =>
        jobTypeCatalog.isVisibleToPrincipal(job.taskType, { userType, permissions: userPermissions })
      );
      if (visibleJobs.length !== jobs.length) {
        jobs = visibleJobs;
        finalTotal = visibleJobs.length;
      }
    }

    // 為每個任務計算 allowedActions
    const enrichedJobs = jobs.map(job => ({
      ...job,
      allowedActions: this._computeAllowedActions(job, userPermissions, userType),
    }));

    return { jobs: enrichedJobs, total: finalTotal };
  }

  /**
   * 刪除作業
   * @param {string} jobId - 作業ID
   * @param {string|Object} userIdOrInfo - 使用者ID或API金鑰資訊
   * @param {string} userType - 使用者型別
   * @returns {Promise<void>}
   */
  async deleteJob(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('請提供作業ID');
    }

    // 先獲取任務狀態並驗證許可權
    const jobStatus = await this.getJobStatus(jobId, userIdOrInfo, userType);

    // 檢查任務狀態是否可刪除
    if (jobStatus.status === 'pending' || jobStatus.status === 'running') {
      throw new ValidationError('不能刪除待執行或執行中的任務，請先取消任務');
    }

    // 檢查操作許可權
    if (!jobStatus.allowedActions?.canDelete) {
      throw new AuthorizationError('無權刪除此任務');
    }

    const orchestrator = await this.getTaskOrchestrator();
    await orchestrator.deleteJob(jobId);
  }

  /**
   * 清理資源
   * @returns {Promise<void>}
   */
  async cleanup() {
    // 清理任務編排器資源
    if (this._taskOrchestrator && typeof this._taskOrchestrator.shutdown === 'function') {
      await this._taskOrchestrator.shutdown();
    }

    // 清理掛載管理器的資源
    if (this.mountManager && typeof this.mountManager.cleanup === "function") {
      await this.mountManager.cleanup();
    }
  }
}
