/**
 * 儲存掛載配置服務
 */
import { ApiStatus } from "../constants/index.js";
import { ValidationError, ConflictError, NotFoundError, AuthorizationError } from "../http/errors.js";
import { generateUUID } from "../utils/common.js";
import { MountRepository, StorageConfigRepository } from "../repositories/index.js";
import { invalidateFsCache } from "../cache/invalidation.js";
import { FsSearchIndexStore } from "../storage/fs/search/FsSearchIndexStore.js";

const emitMountCacheInvalidation = ({ mountId, storageConfigId = null, reason, db = null }) => {
  if (!mountId && !storageConfigId) {
    return;
  }
  invalidateFsCache({ mountId, storageConfigId, reason, bumpMountsVersion: true, db });
};

/**
 * 掛載點服務類
 * 純粹的掛載點業務邏輯，透過Repository訪問資料
 */
class MountService {
  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項
   */
  constructor(db) {
    this.db = db;
    this.mountRepository = new MountRepository(db);
    this.storageConfigRepository = new StorageConfigRepository(db);
  }

  /**
   * 獲取管理員的掛載點列表
   * @param {string} adminId - 管理員ID
   * @param {boolean} includeInactive - 是否包含禁用的掛載點
   * @returns {Promise<Array>} 掛載點列表
   */
  async getMountsByAdmin(adminId, includeInactive = false) {
    return await this.mountRepository.findByAdmin(adminId, includeInactive);
  }

  /**
   * 獲取所有掛載點列表（管理員專用）
   * @param {boolean} includeInactive - 是否包含禁用的掛載點
   * @returns {Promise<Array>} 所有掛載點列表
   */
  async getAllMounts(includeInactive = true) {
    return await this.mountRepository.findAll(includeInactive);
  }

  /**
   * 驗證掛載點資料
   * @param {Object} mountData - 掛載點資料
   * @param {string} creatorId - 建立者ID
   * @throws {ValidationError} 引數錯誤
   */
  async validateMountData(mountData, creatorId) {
    // 驗證必填欄位
    const requiredFields = ["name", "storage_type", "mount_path"];
    for (const field of requiredFields) {
      if (!mountData[field]) {
        throw new ValidationError(`缺少必填欄位: ${field}`);
      }
    }

    // 驗證掛載路徑格式
    this.validateMountPath(mountData.mount_path);

    // 檢查掛載路徑是否已存在
    const existingMount = await this.mountRepository.findByMountPath(mountData.mount_path);
    if (existingMount) {
      throw new ConflictError("掛載路徑已被使用");
    }

    // 如繫結了儲存配置，驗證配置是否存在（通用儲存）
    if (mountData.storage_config_id) {
      const cfg = await this.storageConfigRepository.findById(mountData.storage_config_id);
      if (!cfg) {
        throw new ValidationError("指定的儲存配置不存在");
      }
      console.log(`建立掛載點: ${mountData.name}, 型別: ${mountData.storage_type}, 使用儲存配置ID: ${mountData.storage_config_id}`);
    } else {
      console.log(`建立掛載點: ${mountData.name}, 型別: ${mountData.storage_type}（未繫結儲存配置）`);
    }
  }

  /**
   * 驗證掛載路徑格式
   * @param {string} mountPath - 掛載路徑
   * @throws {ValidationError} 路徑格式錯誤
   */
  validateMountPath(mountPath) {
    if (!mountPath.startsWith("/")) {
      throw new ValidationError("掛載路徑必須以 / 開頭");
    }

    if (mountPath.includes("//")) {
      throw new ValidationError("掛載路徑不能包含連續的 /");
    }

    if (mountPath.length > 1 && mountPath.endsWith("/")) {
      throw new ValidationError("掛載路徑不能以 / 結尾（根路徑除外）");
    }

    // 檢查是否包含非法字元
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(mountPath)) {
      throw new ValidationError("掛載路徑包含非法字元");
    }
  }

  /**
   * 建立掛載點
   * @param {Object} mountData - 掛載點資料
   * @param {string} creatorId - 建立者ID
   * @returns {Promise<Object>} 建立的掛載點完整資訊
   * @throws {ValidationError|ConflictError} 引數錯誤或衝突
   */
  async createMount(mountData, creatorId) {
    // 驗證掛載點資料
    await this.validateMountData(mountData, creatorId);

    // 生成唯一ID
    const id = generateUUID();

    // 設定預設值
    const isActive = mountData.is_active !== undefined ? mountData.is_active : true;
    const sortOrder = mountData.sort_order || 0;
    const cacheTtl = mountData.cache_ttl || 300;
    const webProxy = mountData.web_proxy || false;
    const webdavPolicy = mountData.webdav_policy || "302_redirect";
    const enableSign = mountData.enable_sign || false;
    const signExpires = mountData.sign_expires !== undefined ? mountData.sign_expires : null;
    const enableFolderSummaryCompute = mountData.enable_folder_summary_compute || false;

    // 準備資料
    const createData = {
      id,
      name: mountData.name,
      storage_type: mountData.storage_type,
      storage_config_id: mountData.storage_config_id || null,
      mount_path: mountData.mount_path,
      remark: mountData.remark || null,
      is_active: isActive,
      created_by: creatorId,
      sort_order: sortOrder,
      cache_ttl: cacheTtl,
      web_proxy: webProxy,
      webdav_policy: webdavPolicy,
      enable_sign: enableSign,
      sign_expires: signExpires,
      enable_folder_summary_compute: enableFolderSummaryCompute,
    };

    // 建立掛載點
    await this.mountRepository.createMount(createData);

    emitMountCacheInvalidation({ mountId: id, storageConfigId: createData.storage_config_id || null, reason: "mount-create", db: this.db });

    // 返回建立的掛載點資訊
    return await this.mountRepository.findById(id);
  }

  /**
   * 更新掛載點
   * @param {string} mountId - 掛載點ID
   * @param {Object} updateData - 更新資料
   * @param {string} updaterId - 更新者ID
   * @param {boolean} isAdmin - 是否為管理員操作
   * @returns {Promise<Object>} 更新後的掛載點資訊
   * @throws {NotFoundError|ValidationError|ConflictError} 不存在、引數錯誤或衝突
   */
  async updateMount(mountId, updateData, updaterId, isAdmin = false) {
    // 檢查掛載點是否存在
    const existingMount = await this.mountRepository.findById(mountId);
    if (!existingMount) {
      throw new NotFoundError("掛載點不存在");
    }

    // 許可權檢查：非管理員只能修改自己建立的掛載點
    if (!isAdmin && existingMount.created_by !== updaterId) {
      throw new AuthorizationError("沒有許可權修改此掛載點");
    }

    // 如果更新掛載路徑，需要驗證
    if (updateData.mount_path && updateData.mount_path !== existingMount.mount_path) {
      this.validateMountPath(updateData.mount_path);

      // 檢查新路徑是否已被其他掛載點使用
      const pathExists = await this.mountRepository.existsByMountPath(updateData.mount_path, mountId);
      if (pathExists) {
        throw new ConflictError("掛載路徑已被使用");
      }
    }

    // 如果更新儲存配置，需要驗證
    if (updateData.storage_config_id && updateData.storage_config_id !== existingMount.storage_config_id) {
      const cfg = await this.storageConfigRepository.findById(updateData.storage_config_id);
      if (!cfg) {
        throw new ValidationError("指定的儲存配置不存在");
      }
    }

    // 更新掛載點
    await this.mountRepository.updateMount(mountId, updateData);

    const updatedMount = await this.mountRepository.findById(mountId);

    // 如果“掛載實際指向的內容”發生變化，舊索引就一定不可信了：
    // - 改 mount_path：索引裡存的是舊路徑字首，會導致搜尋結果路徑錯亂
    // - 改 storage_config_id / storage_type：等於換了一個“資料來源”，必須清掉舊索引
    const shouldResetIndex =
      (updateData.mount_path && updateData.mount_path !== existingMount.mount_path) ||
      (updateData.storage_config_id && updateData.storage_config_id !== existingMount.storage_config_id) ||
      (updateData.storage_type && updateData.storage_type !== existingMount.storage_type);
    if (shouldResetIndex) {
      const store = new FsSearchIndexStore(this.db);
      await store.clearDerivedByMount(mountId, { keepState: true });
    }

    emitMountCacheInvalidation({ mountId, storageConfigId: updatedMount?.storage_config_id || null, reason: "mount-update", db: this.db });

    // 返回更新後的掛載點資訊
    return updatedMount;
  }

  /**
   * 刪除掛載點
   * @param {string} mountId - 掛載點ID
   * @param {string} deleterId - 刪除者ID
   * @param {boolean} isAdmin - 是否為管理員操作
   * @returns {Promise<Object>} 刪除結果
   * @throws {NotFoundError} 掛載點不存在
   */
  async deleteMount(mountId, deleterId, isAdmin = false) {
    // 檢查掛載點是否存在
    const existingMount = await this.mountRepository.findById(mountId);
    if (!existingMount) {
      throw new NotFoundError("掛載點不存在");
    }

    // 許可權檢查：非管理員只能刪除自己建立的掛載點
    if (!isAdmin && existingMount.created_by !== deleterId) {
      throw new AuthorizationError("沒有許可權刪除此掛載點");
    }

    // 先清理索引派生資料，再刪掛載點（避免刪成功但索引殘留）
    // - entries/dirty/state 都屬於派生資料，不影響真實檔案資料
    const store = new FsSearchIndexStore(this.db);
    await store.clearDerivedByMount(mountId, { keepState: false });

    // 刪除掛載點（真實業務資料）
    const result = await this.mountRepository.deleteMount(mountId);

    emitMountCacheInvalidation({ mountId, storageConfigId: existingMount.storage_config_id || null, reason: "mount-delete", db: this.db });

    return {
      success: true,
      message: "掛載點刪除成功",
      deletedCount: result.meta?.changes || 0,
    };
  }

  /**
   * 更新掛載點最後使用時間
   * @param {string} mountId - 掛載點ID
   * @returns {Promise<Object>} 更新結果
   */
  async updateMountLastUsed(mountId) {
    return await this.mountRepository.updateLastUsed(mountId);
  }
}

/**
 * 獲取管理員的掛載點列表
 * @param {D1Database} db - D1資料庫例項
 * @param {string} adminId - 管理員ID
 * @param {boolean} includeInactive - 是否包含禁用的掛載點，預設為false
 * @returns {Promise<Array>} 掛載點列表
 * @throws {Error} 資料庫操作錯誤
 */
export async function getMountsByAdmin(db, adminId, includeInactive = false) {
  const mountService = new MountService(db);
  return await mountService.getMountsByAdmin(adminId, includeInactive);
}

/**
 * 獲取所有掛載點列表（管理員專用）
 * @param {D1Database} db - D1資料庫例項
 * @param {boolean} includeInactive - 是否包含禁用的掛載點，預設為true（管理員介面需要看到所有掛載點）
 * @returns {Promise<Array>} 所有掛載點列表
 * @throws {Error} 資料庫操作錯誤
 */
export async function getAllMounts(db, includeInactive = true) {
  const mountService = new MountService(db);
  return await mountService.getAllMounts(includeInactive);
}

/**
 * 建立掛載點
 * @param {D1Database} db - D1資料庫例項
 * @param {Object} mountData - 掛載點資料
 * @param {string} mountData.name - 掛載點名稱
 * @param {string} mountData.storage_type - 儲存型別（如'S3'）
 * @param {string} mountData.mount_path - 掛載路徑
 * @param {string} [mountData.storage_config_id] - 儲存配置ID（對S3型別必需）
 * @param {string} [mountData.remark] - 備註
 * @param {boolean} [mountData.is_active=true] - 是否啟用
 * @param {number} [mountData.sort_order=0] - 排序順序
 * @param {number} [mountData.cache_ttl=300] - 快取時間（秒）
 * @param {boolean} [mountData.web_proxy=false] - 是否啟用網頁代理
 * @param {string} [mountData.webdav_policy='302_redirect'] - WebDAV策略
 * @param {boolean} [mountData.enable_sign=false] - 是否啟用代理簽名
 * @param {number|null} [mountData.sign_expires=null] - 簽名過期時間（秒），null表示使用全域性設定
 * @param {string} creatorId - 建立者ID
 * @returns {Promise<Object>} 建立的掛載點完整資訊
 * @throws {ValidationError} 引數錯誤，包括缺少必填欄位、路徑格式錯誤等
 * @throws {ConflictError} 掛載路徑已存在衝突
 * @throws {Error} 資料庫操作錯誤
 */
export async function createMount(db, mountData, creatorId) {
  const mountService = new MountService(db);
  return await mountService.createMount(mountData, creatorId);
}

/**
 * 更新掛載點
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - 掛載點ID
 * @param {Object} updateData - 更新資料
 * @param {string} [updateData.name] - 掛載點名稱
 * @param {string} [updateData.storage_type] - 儲存型別
 * @param {string} [updateData.mount_path] - 掛載路徑
 * @param {string|null} [updateData.storage_config_id] - 儲存配置ID
 * @param {string} [updateData.remark] - 備註
 * @param {boolean} [updateData.is_active] - 是否啟用
 * @param {number} [updateData.sort_order] - 排序順序
 * @param {number} [updateData.cache_ttl] - 快取時間（秒）
 * @param {boolean} [updateData.web_proxy] - 是否啟用網頁代理
 * @param {string} [updateData.webdav_policy] - WebDAV策略
 * @param {boolean} [updateData.enable_sign] - 是否啟用代理簽名
 * @param {number|null} [updateData.sign_expires] - 簽名過期時間（秒），null表示使用全域性設定
 * @param {string} creatorId - 建立者ID或管理員ID
 * @param {boolean} isAdmin - 是否為管理員操作，為true時不檢查建立者
 * @returns {Promise<void>}
 * @throws {ValidationError} 引數錯誤，包括路徑格式錯誤、S3配置不存在等
 * @throws {NotFoundError|AuthorizationError} 掛載點不存在或無許可權修改
 * @throws {ConflictError} 掛載路徑已存在衝突
 * @throws {Error} 資料庫操作錯誤
 */
export async function updateMount(db, id, updateData, creatorId, isAdmin = false) {
  const mountService = new MountService(db);
  return await mountService.updateMount(id, updateData, creatorId, isAdmin);
}

/**
 * 刪除掛載點
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - 掛載點ID
 * @param {string} creatorId - 建立者ID或管理員ID
 * @param {boolean} isAdmin - 是否為管理員操作，為true時不檢查建立者
 * @returns {Promise<void>}
 * @throws {NotFoundError|AuthorizationError} 掛載點不存在或無許可權刪除
 * @throws {Error} 資料庫操作錯誤
 */
export async function deleteMount(db, id, creatorId, isAdmin = false) {
  const mountService = new MountService(db);
  return await mountService.deleteMount(id, creatorId, isAdmin);
}

/**
 * 更新掛載點最後使用時間
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - 掛載點ID
 * @returns {Promise<void>}
 * @throws {Error} 資料庫操作錯誤
 */
export async function updateMountLastUsed(db, id) {
  const mountService = new MountService(db);
  return await mountService.updateMountLastUsed(id);
}
