/**
 * 檔案服務類
 * 檔案業務邏輯，透過Repository訪問資料
 */

import { FileRepository } from "../repositories/index.js";
import { GetFileType, getFileTypeName } from "../utils/fileTypeDetector.js";
import { generateUniqueFileSlug, validateSlugFormat } from "../utils/common.js";
import { hashPassword } from "../utils/crypto.js";
import { ApiStatus, DbTables, UserType } from "../constants/index.js";
import { ValidationError, NotFoundError, AuthorizationError, ConflictError } from "../http/errors.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { ObjectStore } from "../storage/object/ObjectStore.js";
import { LinkService } from "../storage/link/LinkService.js";
import { resolvePreviewSelection } from "./documentPreviewService.js";

export class FileService {
  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項
   * @param {string} encryptionSecret - 加密金鑰
   * @param {Object} repositoryFactory - 倉儲工廠（可選）
   */
  constructor(db, encryptionSecret, repositoryFactory = null) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
    this.fileRepository = new FileRepository(db);
  }

  /**
   * 驗證檔案訪問許可權 - 純業務邏輯
   * @param {Object} file - 檔案物件
   * @returns {Object} 包含accessible和reason的物件
   */
  validateFileAccess(file) {
    if (!file) {
      return { accessible: false, reason: "not_found" };
    }

    // 檢查檔案是否已過期
    if (file.expires_at) {
      const expiryDate = new Date(file.expires_at);
      const now = new Date();
      if (now > expiryDate) {
        return { accessible: false, reason: "expired" };
      }
    }

    // 檢查檔案訪問次數是否超過限制
    if (file.max_views !== null && file.max_views > 0) {
      if (file.views > file.max_views) {
        return { accessible: false, reason: "expired" };
      }
    }

    return { accessible: true };
  }

  /**
   * 根據slug獲取檔案完整資訊
   * @param {string} slug - 檔案slug
   * @returns {Promise<Object>} 檔案物件
   * @throws {ValidationError|NotFoundError}
   */
  async getFileBySlug(slug) {
    if (!slug) {
      throw new ValidationError("缺少檔案slug引數");
    }

    const file = await this.fileRepository.findBySlugWithStorageConfig(slug);

    if (!file) {
      throw new NotFoundError("檔案不存在");
    }

    return file;
  }

  /**
   * 檢查檔案是否可訪問
   * @param {Object} file - 檔案物件
   * @returns {Object} 包含accessible和reason的物件
   */
  isFileAccessible(file) {
    return this.validateFileAccess(file);
  }

  /**
   * 增加檔案檢視次數並檢查是否超過限制
   * @param {string} slug - 檔案slug
   * @returns {Promise<Object>} 包含isExpired和file的物件
   */
  async incrementAndCheckFileViews(slug) {
    // 獲取檔案資訊
    const file = await this.getFileBySlug(slug);

    // 增加views計數
    await this.fileRepository.incrementViews(file.id);

    // 重新獲取檔案資訊，包括更新後的views計數
    const updatedFile = await this.fileRepository.findBySlugWithStorageConfig(slug);

    // 檢查是否達到最大檢視次數限制
    const accessResult = this.validateFileAccess(updatedFile);

    return {
      isExpired: !accessResult.accessible,
      file: updatedFile,
    };
  }


  /**
   * 分享層統一 guard：
   * - 根據 slug 獲取檔案記錄
   * - 校驗過期/最大訪問次數
   * - 在需要時遞增 views 並處理過期刪除
   * - 可選擇是否在本次呼叫中遞增 views
   * @param {string} slug
   * @param {Object} [options]
   * @param {boolean} [options.incrementViews] 是否在本次呼叫中遞增瀏覽次數
   * @returns {Promise<{ file: any, isExpired: boolean }>}
   */
  async guardShareFile(slug, options = {}) {
    const { incrementViews = false } = options;

    // 統一獲取檔案記錄
    const file = await this.getFileBySlug(slug);

    if (!incrementViews) {
      const accessResult = this.validateFileAccess(file);
      return {
        file,
        isExpired: !accessResult.accessible,
      };
    }

    // 需要遞增檢視時複用 incrementAndCheckFileViews 的邏輯
    return await this.incrementAndCheckFileViews(slug);
  }

  /**
   * 獲取檔案的公開資訊（分享檢視 JSON）
   * - 統一返回語義明確的 previewUrl / downloadUrl
   * - previewUrl：inline 語義入口（直鏈 / url_proxy / 本地 /api/s）
   * - downloadUrl：attachment 語義入口（直鏈下載 / url_proxy 下載 / 本地 /api/s?down=true）
   * @param {Object} file - 檔案物件
   * @param {boolean} requiresPassword - 是否需要密碼
   * @param {import("../storage/link/LinkTypes.js").StorageLink|null} link - 由 LinkService 生成的 StorageLink
   * @param {{ baseOrigin?: string }=} options - 額外選項（如當前請求的後端 Origin）
   * @returns {Promise<Object>} 公開檔案資訊
   */
  async getPublicFileInfo(file, requiresPassword, link = null, options = {}) {
    // 獲取檔案型別（用於前端預覽型別判斷）
    const fileType = await GetFileType(file.filename, this.db);
    const fileTypeName = await getFileTypeName(file.filename, this.db);

    const useProxyFlag = file.use_proxy ?? 0;
    const storageUrlProxy = file.url_proxy || null;

    const baseOrigin = options.baseOrigin || null;

    // LinkService 已經根據 use_proxy / url_proxy / 直鏈能力生成了預覽入口（link）
    const previewLink = link;
    let previewUrl = previewLink && previewLink.url ? previewLink.url : null;

    // 下載入口
    const linkService = new LinkService(this.db, this.encryptionSecret, this.repositoryFactory);
    const downloadLink = await linkService.getShareExternalLink(file, null, { forceDownload: true });
    let downloadUrl = downloadLink && downloadLink.url ? downloadLink.url : null;

    let linkType = "proxy";
    if (useProxyFlag) {
      linkType = "proxy";
    } else if (storageUrlProxy && previewUrl) {
      linkType = "url_proxy";
    } else if (previewLink && previewLink.kind === "direct" && previewUrl) {
      linkType = "direct";
    } else if (previewUrl) {
      linkType = "proxy";
    } else {
      linkType = "direct";
    }

    // 若提供了 baseOrigin，則僅對本地相對路徑補全為絕對 URL
    if (previewUrl && baseOrigin && previewUrl.startsWith("/")) {
      previewUrl = `${baseOrigin}${previewUrl}`;
    }
    if (downloadUrl && baseOrigin && downloadUrl.startsWith("/")) {
      downloadUrl = `${baseOrigin}${downloadUrl}`;
    }

    // 受密碼保護且未校驗透過：不在 JSON 中暴露任何可直接訪問的 URL
    if (requiresPassword) {
      previewUrl = null;
      downloadUrl = null;
    }

    // 基於檔案資訊和 Link JSON 生成預覽選擇結果（preview_providers 驅動）
    const previewSelection = await resolvePreviewSelection(
      {
        type: fileType,
        typeName: fileTypeName,
        mimetype: file.mimetype,
        filename: file.filename,
        size: file.size,
      },
      {
        previewUrl,
        downloadUrl,
        linkType,
        use_proxy: useProxyFlag,
      },
    );

    return {
      id: file.id,
      slug: file.slug,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      remark: file.remark,
      created_at: file.created_at,
      requires_password: requiresPassword,
      views: file.views,
      max_views: file.max_views,
      expires_at: file.expires_at,
      previewUrl,
      downloadUrl,
      linkType,
      use_proxy: useProxyFlag,
      created_by: file.created_by || null,
      type: fileType, // 整數型別常量 (0-6)
      typeName: fileTypeName, // 型別名稱（用於除錯）
      previewSelection,
    };
  }

  /**
   * 根據儲存路徑刪除檔案記錄
   * @param {string} storageConfigId - 儲存配置ID
   * @param {string} storagePath - 儲存路徑
   * @param {string} storageType - 儲存型別
   * @returns {Promise<Object>} 刪除結果，包含deletedCount欄位
   */
  async deleteFileRecordByStoragePath(storageConfigId, storagePath, storageType) {
    return await this.fileRepository.deleteByStorageConfigPath(storageConfigId, storagePath, storageType);
  }

  /**
   * 建立檔案記錄
   * @param {Object} fileData - 檔案資料
   * @returns {Promise<Object>} 建立結果
   */
  async createFileRecord(fileData) {
    return await this.fileRepository.createFile(fileData);
  }

  /**
   * 更新檔案記錄
   * @param {string} fileId - 檔案ID
   * @param {Object} updateData - 更新資料
   * @returns {Promise<Object>} 更新結果
   */
  async updateFileRecord(fileId, updateData) {
    return await this.fileRepository.updateFile(fileId, updateData);
  }

  /**
   * 更新檔案後設資料（業務邏輯層）
   * @param {string} fileId - 檔案ID
   * @param {Object} updateData - 更新資料
   * @param {Object} userInfo - 使用者資訊
   * @param {string} userInfo.userType - 使用者型別 ("admin" | "apikey")
   * @param {string} userInfo.userId - 使用者ID
   * @returns {Promise<Object>} 更新結果
   */
  async updateFile(fileId, updateData, userInfo) {
    const { userType, userId } = userInfo;

    // 檢查檔案是否存在並驗證許可權
    let existingFile;
    if (userType === UserType.ADMIN) {
      // 管理員：可以更新任何檔案
      existingFile = await this.fileRepository.findById(fileId);
      if (!existingFile) {
        throw new NotFoundError("檔案不存在");
      }
    } else {
      // API金鑰使用者：只能更新自己的檔案
      existingFile = await this.fileRepository.findOne(DbTables.FILES, {
        id: fileId,
        created_by: `apikey:${userId}`,
      });
      if (!existingFile) {
        throw new NotFoundError("檔案不存在或無權更新");
      }
    }

    // 構建更新資料物件
    const finalUpdateData = {};

    // 處理可更新的欄位
    if (updateData.remark !== undefined) {
      finalUpdateData.remark = updateData.remark;
    }

    // 處理 slug 更新（包含格式校驗和衝突檢查）
    if (updateData.slug !== undefined) {
      if (!updateData.slug) {
        finalUpdateData.slug = await generateUniqueFileSlug(this.db, null, false, null);
      } else {
        await this._validateAndProcessSlug(updateData.slug, fileId, userType);
        finalUpdateData.slug = updateData.slug;
      }
    }

    // 處理過期時間
    if (updateData.expires_at !== undefined) {
      finalUpdateData.expires_at = updateData.expires_at;
    }

    // 處理Worker代理訪問設定
    if (updateData.use_proxy !== undefined) {
      finalUpdateData.use_proxy = updateData.use_proxy ? 1 : 0;
    }

    // 處理最大檢視次數
    if (updateData.max_views !== undefined) {
      finalUpdateData.max_views = updateData.max_views;
      finalUpdateData.views = 0; // 當修改max_views時，重置views計數為0
    }

    // 處理密碼變更
    if (updateData.password !== undefined) {
      await this._processPasswordUpdate(fileId, updateData.password, finalUpdateData);
    }

    // 如果沒有要更新的欄位（API金鑰使用者需要檢查）
    if (userType === UserType.API_KEY && Object.keys(finalUpdateData).length === 0) {
      throw new ValidationError("沒有提供有效的更新欄位");
    }

    // 新增更新時間
    finalUpdateData.updated_at = new Date().toISOString();

    // 使用 Repository 更新檔案
    await this.fileRepository.updateFile(fileId, finalUpdateData);

    return {
      success: true,
      message: "檔案後設資料更新成功",
      slug: finalUpdateData.slug ?? existingFile.slug,
    };
  }

  /**
   * 驗證並處理 slug 更新
   * @private
   * @param {string} slug - 新的 slug
   * @param {string} fileId - 檔案ID
   * @param {string} userType - 使用者型別
   */
  async _validateAndProcessSlug(slug, fileId, userType) {
    // 格式校驗：只允許字母、數字、連字元、下劃線、點號
    if (slug && !validateSlugFormat(slug)) {
      throw new ValidationError("連結字尾格式無效，只能使用字母、數字、下劃線、橫槓和點號");
    }

    // 檢查slug是否可用 (不與其他檔案衝突)
    let slugExistsCheck;
    if (userType === UserType.ADMIN) {
      slugExistsCheck = await this.fileRepository.findBySlug(slug);
      if (slugExistsCheck && slugExistsCheck.id !== fileId) {
        throw new ConflictError("此連結字尾已被其他檔案使用");
      }
    } else {
      slugExistsCheck = await this.fileRepository.findBySlugExcludingId(slug, fileId);
      if (slugExistsCheck) {
        throw new ConflictError("此連結字尾已被其他檔案使用");
      }
    }
  }

  /**
   * 處理密碼更新
   * @private
   * @param {string} fileId - 檔案ID
   * @param {string} password - 新密碼（可能為空字串表示清除）
   * @param {Object} updateData - 更新資料物件（引用傳遞）
   */
  async _processPasswordUpdate(fileId, password, updateData) {
    if (password) {
      // 設定新密碼
      const passwordHash = await hashPassword(password);
      updateData.password = passwordHash;

      // 使用 FileRepository 更新或插入明文密碼
      await this.fileRepository.upsertFilePasswordRecord(fileId, password);
    } else {
      // 明確提供了空密碼，表示要清除密碼
      updateData.password = null;

      // 使用 FileRepository 刪除明文密碼記錄
      await this.fileRepository.deleteFilePasswordRecord(fileId);
    }
  }

  /**
   * 獲取檔案列表（管理員）
   * @param {Object} options - 查詢選項
   * @param {number} options.limit - 每頁條數
   * @param {number} options.offset - 偏移量
   * @param {string} options.createdBy - 建立者篩選
   * @param {string} options.search - 搜尋關鍵詞
   * @returns {Promise<Object>} 檔案列表和分頁資訊
   */
  async getAdminFileList(options = {}) {
    const { limit = 30, offset = 0, createdBy, search } = options;

    // 如果有搜尋關鍵詞，使用搜尋方法
    if (search && search.trim()) {
      const searchResult = await this.fileRepository.searchWithStorageConfig(search.trim(), {
        createdBy,
        limit,
        offset,
      });

      // 為搜尋結果新增 type、typeName 和 key_name 欄位
      if (searchResult.files) {
        searchResult.files = await this.processApiKeyNames(searchResult.files);
      }

      return searchResult;
    }

    // 構建查詢條件
    const conditions = {};
    if (createdBy) conditions.created_by = createdBy;

    // 獲取檔案列表
    const files = await this.fileRepository.findManyWithStorageConfig(conditions, {
      orderBy: "created_at DESC",
      limit,
      offset,
    });

    // 獲取總數
    const total = await this.fileRepository.count(conditions);

    // 處理API金鑰名稱
    const processedFiles = await this.processApiKeyNames(files);

    return {
      files: processedFiles,
      pagination: {
        total,
        limit,
        offset,
      },
    };
  }

  /**
   * 獲取檔案詳情（管理員）
   * @param {string} fileId - 檔案ID
   * @param {string} encryptionSecret - 加密金鑰
   * @param {Object} request - 請求物件
   * @returns {Promise<Object>} 檔案詳情
   */
  async getAdminFileDetail(fileId, encryptionSecret, request = null, options = {}) {
    const { includeLinks = false } = options || {};

    const file = await this.fileRepository.findByIdWithStorageConfig(fileId);
    if (!file) {
      throw new NotFoundError("檔案不存在");
    }

    const fileType = await GetFileType(file.filename, this.db);
    const fileTypeName = await getFileTypeName(file.filename, this.db);

    const result = {
      ...file,
      has_password: !!file.password,
      type: fileType,
      typeName: fileTypeName,
    };

    if (file.password) {
      const passwordInfo = await this.fileRepository.getFilePassword(file.id);
      if (passwordInfo && passwordInfo.plain_password) {
        result.plain_password = passwordInfo.plain_password;
      }
    }

    if (result.created_by && result.created_by.startsWith("apikey:")) {
      const keyId = result.created_by.substring(7);
      const keyInfo = await this.getApiKeyInfo(keyId);
      if (keyInfo) {
        result.key_name = keyInfo.name;
      }
    }

    if (!includeLinks) {
      return result;
    }

    const linkService = new LinkService(this.db, encryptionSecret, this.repositoryFactory);
    const previewLink = await linkService.getShareExternalLink(file, null, {
      forceDownload: false,
      request,
    });
    const downloadLink = await linkService.getShareExternalLink(file, null, {
      forceDownload: true,
      request,
    });

    let previewUrl = previewLink && previewLink.url ? previewLink.url : null;
    let downloadUrl = downloadLink && downloadLink.url ? downloadLink.url : null;

    // 管理端 include=links 場景：若儲存無直鏈/無 url_proxy 導致外部入口為空，
    // 為保證檔案管理可預覽/可下載，回退為本地 share 代理鏈路。
    let usedFallback = false;
    if (file.slug) {
      if (!previewUrl) {
        previewUrl = `/api/s/${file.slug}`;
        usedFallback = true;
      }
      if (!downloadUrl) {
        downloadUrl = `/api/s/${file.slug}?down=true`;
        usedFallback = true;
      }
    }

    const useProxyFlag = file.use_proxy ?? 0;
    const storageUrlProxy = file.url_proxy || null;

    let linkType = "proxy";
    if (useProxyFlag) {
      linkType = "proxy";
    } else if (storageUrlProxy && previewUrl) {
      linkType = "url_proxy";
    } else if (previewLink && previewLink.kind === "direct" && previewUrl) {
      linkType = "direct";
    } else if (previewUrl) {
      linkType = "proxy";
    } else {
      linkType = "direct";
    }

    if (usedFallback) {
      linkType = "proxy";
    }

    if (usedFallback) {
      linkType = "proxy";
    }

    if (request) {
      try {
        const base = new URL(request.url);
        const origin = `${base.protocol}//${base.host}`;
        if (previewUrl && previewUrl.startsWith("/")) {
          previewUrl = new URL(previewUrl, origin).toString();
        }
        if (downloadUrl && downloadUrl.startsWith("/")) {
          downloadUrl = new URL(downloadUrl, origin).toString();
        }
      } catch (e) {
        console.warn("構建檔案詳情絕對 URL 失敗，將返回原始連結：", e?.message || e);
      }
    }

    const previewSelection = await resolvePreviewSelection(
      {
        type: fileType,
        typeName: fileTypeName,
        mimetype: file.mimetype,
        filename: file.filename,
        size: file.size,
      },
      {
        previewUrl,
        downloadUrl,
        linkType,
        use_proxy: useProxyFlag,
      },
    );

    result.previewUrl = previewUrl;
    result.downloadUrl = downloadUrl;
    result.linkType = linkType;
    result.previewSelection = previewSelection;

    return result;
  }

  /**
   * 處理檔案列表中的API金鑰名稱和檔案型別
   * @param {Array} files - 檔案列表
   * @returns {Promise<Array>} 處理後的檔案列表
   */
  async processApiKeyNames(files) {
    // 收集所有API金鑰ID
    const apiKeyIds = files.filter((file) => file.created_by && file.created_by.startsWith("apikey:")).map((file) => file.created_by.substring(7));

    // 獲取API金鑰名稱對映
    const keyNamesMap = new Map();
    if (apiKeyIds.length > 0) {
      const uniqueKeyIds = [...new Set(apiKeyIds)];

      for (const keyId of uniqueKeyIds) {
        const keyInfo = await this.getApiKeyInfo(keyId);
        if (keyInfo) {
          keyNamesMap.set(keyId, keyInfo.name);
        }
      }
    }

    // 為每個檔案新增欄位（包括檔案型別檢測）
    const processedFiles = await Promise.all(
      files.map(async (file) => {
        // 新增檔案型別資訊
        const fileType = await GetFileType(file.filename, this.db);
        const fileTypeName = await getFileTypeName(file.filename, this.db);

        const result = {
          ...file,
          has_password: file.password ? true : false,
          type: fileType, // 整數型別常量 (0-6)
          typeName: fileTypeName, // 型別名稱（用於除錯）
        };

        // 新增API金鑰名稱
        if (file.created_by && file.created_by.startsWith("apikey:")) {
          const keyId = file.created_by.substring(7);
          const keyName = keyNamesMap.get(keyId);
          if (keyName) {
            result.key_name = keyName;
          }
        }

        return result;
      })
    );

    return processedFiles;
  }

  /**
   * 獲取API金鑰資訊
   * @param {string} keyId - API金鑰ID
   * @returns {Promise<Object|null>} API金鑰資訊
   */
  async getApiKeyInfo(keyId) {
    // 這裡需要透過Repository獲取API金鑰資訊
    // 暫時使用直接查詢，後續可以建立ApiKeyRepository
    const result = await this.fileRepository.queryFirst("SELECT id, name FROM api_keys WHERE id = ?", [keyId]);
    return result;
  }

  /**
   * 獲取使用者檔案列表（API金鑰使用者）
   * @param {string} apiKeyId - API金鑰ID
   * @param {Object} options - 查詢選項
   * @param {number} options.limit - 每頁條數
   * @param {number} options.offset - 偏移量
   * @param {string} options.search - 搜尋關鍵詞
   * @returns {Promise<Object>} 檔案列表和分頁資訊
   */
  async getUserFileList(apiKeyId, options = {}) {
    const { limit = 30, offset = 0, search } = options;

    // 如果有搜尋關鍵詞，使用搜尋方法
    if (search && search.trim()) {
      const searchResult = await this.fileRepository.searchWithStorageConfig(search.trim(), {
        createdBy: `apikey:${apiKeyId}`,
        limit,
        offset,
      });

      // 為搜尋結果新增 type、typeName 和 key_name 欄位
      if (searchResult.files) {
        searchResult.files = await this.processApiKeyNames(searchResult.files);
      }

      return searchResult;
    }

    // 構建查詢條件
    const conditions = {
      created_by: `apikey:${apiKeyId}`,
    };

    // 獲取檔案列表
    const files = await this.fileRepository.findManyWithStorageConfig(conditions, {
      orderBy: "created_at DESC",
      limit,
      offset,
    });

    // 獲取總數
    const total = await this.fileRepository.count(conditions);

    // 處理檔案列表，新增has_password欄位和API金鑰名稱
    const processedFiles = await this.processApiKeyNames(files);

    return {
      files: processedFiles,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * 獲取使用者檔案詳情（API金鑰使用者）
   * @param {string} fileId - 檔案ID
   * @param {string} apiKeyId - API金鑰ID
   * @param {string} encryptionSecret - 加密金鑰
   * @param {Object} request - 請求物件
   * @returns {Promise<Object>} 檔案詳情
   */
  async getUserFileDetail(fileId, apiKeyId, encryptionSecret, request = null, options = {}) {
    const { includeLinks = false } = options || {};

    const file = await this.fileRepository.findByIdWithStorageConfig(fileId);
    if (!file) {
      throw new NotFoundError("檔案不存在");
    }

    if (file.created_by !== `apikey:${apiKeyId}`) {
      throw new AuthorizationError("沒有許可權檢視此檔案");
    }

    const fileType = await GetFileType(file.filename, this.db);
    const fileTypeName = await getFileTypeName(file.filename, this.db);

    const result = {
      ...file,
      has_password: !!file.password,
      type: fileType,
      typeName: fileTypeName,
    };

    if (file.password) {
      const passwordInfo = await this.fileRepository.getFilePassword(file.id);
      if (passwordInfo && passwordInfo.plain_password) {
        result.plain_password = passwordInfo.plain_password;
      }
    }

    if (!includeLinks) {
      return result;
    }

    const linkService = new LinkService(this.db, encryptionSecret, this.repositoryFactory);
    const previewLink = await linkService.getShareExternalLink(file, null, {
      forceDownload: false,
      request,
    });
    const downloadLink = await linkService.getShareExternalLink(file, null, {
      forceDownload: true,
      request,
    });

    let previewUrl = previewLink && previewLink.url ? previewLink.url : null;
    let downloadUrl = downloadLink && downloadLink.url ? downloadLink.url : null;

    // include=links 場景：若儲存無直鏈/無 url_proxy 能力導致入口為空，回退本地 share 代理鏈路
    // 該回退僅用於受控的檔案管理檢視，確保 API Key 使用者也能預覽/下載自己的檔案
    let usedFallback = false;
    if (file.slug) {
      if (!previewUrl) {
        previewUrl = `/api/s/${file.slug}`;
        usedFallback = true;
      }
      if (!downloadUrl) {
        downloadUrl = `/api/s/${file.slug}?down=true`;
        usedFallback = true;
      }
    }

    const useProxyFlag = file.use_proxy ?? 0;
    const storageUrlProxy = file.url_proxy || null;

    let linkType = "proxy";
    if (useProxyFlag) {
      linkType = "proxy";
    } else if (storageUrlProxy && previewUrl) {
      linkType = "url_proxy";
    } else if (previewLink && previewLink.kind === "direct" && previewUrl) {
      linkType = "direct";
    } else if (previewUrl) {
      linkType = "proxy";
    } else {
      linkType = "direct";
    }

    if (usedFallback) {
      linkType = "proxy";
    }

    if (request) {
      try {
        const base = new URL(request.url);
        const origin = `${base.protocol}//${base.host}`;
        if (previewUrl && previewUrl.startsWith("/")) {
          previewUrl = new URL(previewUrl, origin).toString();
        }
        if (downloadUrl && downloadUrl.startsWith("/")) {
          downloadUrl = new URL(downloadUrl, origin).toString();
        }
      } catch (e) {
        console.warn("構建檔案詳情絕對 URL 失敗，將返回原始連結：", e?.message || e);
      }
    }

    const previewSelection = await resolvePreviewSelection(
      {
        type: fileType,
        typeName: fileTypeName,
        mimetype: file.mimetype,
        filename: file.filename,
        size: file.size,
      },
      {
        previewUrl,
        downloadUrl,
        linkType,
        use_proxy: useProxyFlag,
      },
    );

    result.previewUrl = previewUrl;
    result.downloadUrl = downloadUrl;
    result.linkType = linkType;
    result.previewSelection = previewSelection;

    return result;
  }
}

// 靜態便捷方法（供路由直接呼叫）
export async function getFileBySlug(db, slug, encryptionSecret) {
  const fileService = new FileService(db, encryptionSecret);
  return await fileService.getFileBySlug(slug);
}

export async function isFileAccessible(db, file, encryptionSecret) {
  const fileService = new FileService(db, encryptionSecret);
  return fileService.isFileAccessible(file);
}

export async function incrementAndCheckFileViews(db, file, encryptionSecret) {
  const fileService = new FileService(db, encryptionSecret);
  return await fileService.incrementAndCheckFileViews(file.slug);
}

export async function guardShareFile(db, slug, encryptionSecret, options = {}) {
  const fileService = new FileService(db, encryptionSecret);
  return await fileService.guardShareFile(slug, options);
}

export async function getPublicFileInfo(
  db,
  file,
  requiresPassword,
  link = null,
  encryptionSecret = null,
  options = {},
) {
  const fileService = new FileService(db, encryptionSecret);
  return await fileService.getPublicFileInfo(file, requiresPassword, link, options);
}

export async function deleteFileRecordByStoragePath(db, storageConfigId, storagePath, storageType) {
  const fileService = new FileService(db);
  return await fileService.deleteFileRecordByStoragePath(storageConfigId, storagePath, storageType);
}

// 管理員檔案管理匯出函式
export async function getAdminFileList(db, options = {}) {
  const fileService = new FileService(db);
  return await fileService.getAdminFileList(options);
}

export async function getAdminFileDetail(db, fileId, encryptionSecret, request = null, options = {}) {
  const fileService = new FileService(db);
  return await fileService.getAdminFileDetail(fileId, encryptionSecret, request, options);
}

// 使用者檔案管理匯出函式
export async function getUserFileList(db, apiKeyId, options = {}) {
  const fileService = new FileService(db);
  return await fileService.getUserFileList(apiKeyId, options);
}

export async function getUserFileDetail(db, fileId, apiKeyId, encryptionSecret, request = null, options = {}) {
  const fileService = new FileService(db);
  return await fileService.getUserFileDetail(fileId, apiKeyId, encryptionSecret, request, options);
}

// 檔案更新匯出函式
export async function updateFile(db, fileId, updateData, userInfo) {
  const fileService = new FileService(db);
  return await fileService.updateFile(fileId, updateData, userInfo);
}
