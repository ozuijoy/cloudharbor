import { generateRandomString } from "../utils/common.js";
import { ApiStatus, DbTables } from "../constants/index.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { Permission, PermissionChecker } from "../constants/permissions.js";
import { ValidationError, ConflictError, NotFoundError } from "../http/errors.js";

const resolveRepositoryFactory = ensureRepositoryFactory;

/**
 * 檢查並刪除過期的API金鑰
 * @param {D1Database} db - D1資料庫例項
 * @param {Object} key - API金鑰物件
 * @returns {Promise<boolean>} 是否已過期並刪除
 */
export async function checkAndDeleteExpiredApiKey(db, key, repositoryFactory) {
  if (!key) return true;

  const now = new Date();

  // 檢查過期時間
  if (key.expires_at && new Date(key.expires_at) < now) {
    console.log(`API金鑰(${key.id})已過期，自動刪除`);

    // 使用 ApiKeyRepository 刪除過期金鑰
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const apiKeyRepository = factory.getApiKeyRepository();

    await apiKeyRepository.deleteApiKey(key.id);
    return true;
  }

  return false;
}

/**
 * 獲取所有API金鑰
 * @param {D1Database} db - D1資料庫例項
 * @returns {Promise<Array>} API金鑰列表
 */
export async function getAllApiKeys(db, repositoryFactory) {
  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();

  // 先清理過期的API金鑰
  await apiKeyRepository.deleteExpired();

  // 獲取所有金鑰列表
  const keys = await apiKeyRepository.findAll({ orderBy: "created_at DESC" });

  // 為每個金鑰新增掩碼欄位和許可權資訊
  return keys.map((key) => {
    const permissions = key.permissions || 0;

    return {
      ...key,
      key_masked: key.key.substring(0, 6) + "...",
      permissions, // 位標誌許可權
      // 許可權描述（用於前端顯示）
      permission_names: PermissionChecker.getPermissionDescriptions(permissions),
    };
  });
}

/**
 * 建立新的API金鑰
 * @param {D1Database} db - D1資料庫例項
 * @param {Object} keyData - API金鑰資料
 * @returns {Promise<Object>} 建立的API金鑰
  */
export async function createApiKey(db, keyData, repositoryFactory) {
  // 必需引數：名稱驗證
  if (!keyData.name || keyData.name.trim() === "") {
    throw new ValidationError("金鑰名稱不能為空");
  }

  // 如果使用者提供了自定義金鑰，驗證其格式
  if (keyData.custom_key) {
    // 驗證金鑰格式：只允許字母、數字、橫槓和下劃線
    const keyFormatRegex = /^[a-zA-Z0-9_-]+$/;
    if (!keyFormatRegex.test(keyData.custom_key)) {
      throw new ValidationError("金鑰只能包含字母、數字、橫槓和下劃線");
    }
  }

  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();

  // 對於 role='GUEST' 的 Key，保證全域性唯一
  const role = keyData.role || "GENERAL";
  if (role === "GUEST") {
    const existingGuests = await apiKeyRepository.findAll({});
    const hasGuest = Array.isArray(existingGuests) && existingGuests.some((k) => (k.role || "GENERAL") === "GUEST");
    if (hasGuest) {
      throw new ConflictError("已存在 GUEST 角色的 API 金鑰，系統僅允許一個遊客金鑰");
    }
  }

  // 檢查名稱是否已存在
  const nameExists = await apiKeyRepository.existsByName(keyData.name.trim());
  if (nameExists) {
    throw new ConflictError("金鑰名稱已存在");
  }

  // 生成唯一ID
  const id = crypto.randomUUID();

  // 生成API金鑰
  let key;
  let name = keyData.name.trim();

  if (role === "GUEST") {
    // 遊客金鑰固定使用 guest / guest
    name = "guest";
    key = "guest";
  } else {
    // 非 GUEST：如果有自定義金鑰則使用自定義金鑰
    key = keyData.custom_key ? keyData.custom_key : generateRandomString(12);
  }

  // 檢查金鑰是否已存在
  const keyExists = await apiKeyRepository.existsByKey(key);
  if (keyExists) {
    throw new ConflictError("金鑰已存在，請重新生成");
  }

  // 處理過期時間，預設為1天后
  const now = new Date();
  let expiresAt;

  if (keyData.expires_at === null || keyData.expires_at === "never") {
    // 永不過期 - 使用遠未來日期（9999-12-31）
    expiresAt = new Date("9999-12-31T23:59:59Z");
  } else if (keyData.expires_at) {
    expiresAt = new Date(keyData.expires_at);
  } else {
    expiresAt = new Date();
    expiresAt.setDate(now.getDate() + 1); // 預設一天後過期
  }

  // 確保日期是有效的
  if (isNaN(expiresAt.getTime())) {
    throw new ValidationError("無效的過期時間");
  }

  // 直接使用傳入的位標誌許可權
  const permissions = keyData.permissions || 0;

  // 驗證許可權值的有效性
  if (typeof permissions !== "number" || permissions < 0) {
    throw new ValidationError("許可權值必須是非負整數");
  }

  // 準備API金鑰資料
  const apiKeyData = {
    id,
    name,
    key,
    permissions, // 位標誌許可權
    role,
    basic_path: keyData.basic_path || "/",
    // 啟用位：預設禁用，需在管理介面顯式開啟
    is_enable: typeof keyData.is_enable === "number" ? keyData.is_enable : 0,
    expires_at: expiresAt.toISOString(),
  };

  // 使用 Repository 建立金鑰
  await apiKeyRepository.createApiKey(apiKeyData);

  // 準備響應資料
  return {
    id,
    name: apiKeyData.name,
    key,
    key_masked: key.substring(0, 6) + "...",
    permissions: apiKeyData.permissions, // 位標誌許可權
    role: apiKeyData.role,
    basic_path: apiKeyData.basic_path,
    is_enable: apiKeyData.is_enable,
    permission_names: PermissionChecker.getPermissionDescriptions(apiKeyData.permissions),
    created_at: apiKeyData.created_at,
    expires_at: apiKeyData.expires_at,
  };
}

/**
 * 更新API金鑰
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - API金鑰ID
 * @param {Object} updateData - 更新資料
 * @returns {Promise<void>}
 */
export async function updateApiKey(db, id, updateData, repositoryFactory) {
  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();

  // 檢查金鑰是否存在
  const keyExists = await apiKeyRepository.findById(id);
  if (!keyExists) {
    throw new NotFoundError("金鑰不存在");
  }

  // 驗證名稱
  if (updateData.name && !updateData.name.trim()) {
    throw new ValidationError("金鑰名稱不能為空");
  }

  // 鎖死 GUEST 金鑰的 name/role，不允許修改；過期時間欄位會在後續統一忽略
  if ((keyExists.role || "GENERAL") === "GUEST") {
    if (updateData.name !== undefined && updateData.name.trim() !== "guest") {
      throw new ConflictError("遊客金鑰名稱固定為 'guest'，不允許修改");
    }
    if (updateData.role !== undefined && updateData.role !== "GUEST") {
      throw new ConflictError("遊客金鑰角色固定為 'GUEST'，不允許修改");
    }
  }

  // 檢查名稱是否已存在（排除當前金鑰）
  if (updateData.name && updateData.name !== keyExists.name) {
    const nameExists = await apiKeyRepository.existsByName(updateData.name.trim(), id);
    if (nameExists) {
      throw new ConflictError("金鑰名稱已存在");
    }
  }

  // 處理過期時間
  let processedUpdateData = { ...updateData };

  if (updateData.expires_at === null || updateData.expires_at === "never") {
    // 永不過期 - 使用遠未來日期（9999-12-31）
    processedUpdateData.expires_at = new Date("9999-12-31T23:59:59Z").toISOString();
  } else if (updateData.expires_at) {
    const expiresAt = new Date(updateData.expires_at);
    // 確保日期是有效的
    if (isNaN(expiresAt.getTime())) {
      throw new ValidationError("無效的過期時間");
    }
    processedUpdateData.expires_at = expiresAt.toISOString();
  }

  // 驗證許可權值（如果提供）
  if (updateData.permissions !== undefined) {
    if (typeof updateData.permissions !== "number" || updateData.permissions < 0) {
      throw new ValidationError("許可權值必須是非負整數");
    }
    processedUpdateData.permissions = updateData.permissions;
  }

  // 清理名稱
  if (processedUpdateData.name !== undefined) {
    processedUpdateData.name = processedUpdateData.name.trim();
  }

  if ((keyExists.role || "GENERAL") === "GUEST" && processedUpdateData.expires_at !== undefined) {
    delete processedUpdateData.expires_at;
  }

  // 檢查是否有有效的更新欄位
  const validFields = ["name", "permissions", "role", "basic_path", "is_enable", "expires_at"];
  const hasValidUpdates = validFields.some((field) => processedUpdateData[field] !== undefined);

  if (!hasValidUpdates) {
    throw new ValidationError("沒有提供有效的更新欄位");
  }

  // 使用 Repository 更新金鑰
  await apiKeyRepository.updateApiKey(id, processedUpdateData);
}

/**
 * 刪除API金鑰
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - API金鑰ID
 * @returns {Promise<void>}
 */
export async function deleteApiKey(db, id, repositoryFactory) {
  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();
  const principalStorageAclRepository = factory.getPrincipalStorageAclRepository
    ? factory.getPrincipalStorageAclRepository()
    : null;

  // 檢查金鑰是否存在
  const keyExists = await apiKeyRepository.findById(id);
  if (!keyExists) {
    throw new NotFoundError("金鑰不存在");
  }
  if ((keyExists.role || "GENERAL") === "GUEST") {
    throw new ConflictError("遊客金鑰不允許刪除，請透過禁用或修改許可權控制訪問");
  }

  // 刪除該金鑰關聯的儲存 ACL（subject_type = 'API_KEY'）
  if (principalStorageAclRepository) {
    try {
      await principalStorageAclRepository.replaceBindings("API_KEY", id, []);
    } catch (error) {
      console.warn("刪除 API Key 關聯的儲存 ACL 失敗，將繼續刪除金鑰本身：", error);
    }
  }

  // 刪除金鑰
  await apiKeyRepository.deleteApiKey(id);
}

/**
 * 獲取API金鑰資訊
 * @param {D1Database} db - D1資料庫例項
 * @param {string} key - API金鑰
 * @returns {Promise<Object|null>} API金鑰資訊
 */
export async function getApiKeyByKey(db, key, repositoryFactory) {
  if (!key) return null;

  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();

  return await apiKeyRepository.findByKey(key);
}

/**
 * 根據 API 金鑰的 basicPath + 儲存 ACL 篩選可訪問的掛載點
 * @param {D1Database} db - D1資料庫例項
 * @param {string} basicPath - API 金鑰的基礎路徑
 * @param {string|null} subjectType - 主體型別，例如 'API_KEY'，用於儲存 ACL（可選）
 * @param {string|null} subjectId - 主體 ID，例如 api_keys.id，用於儲存 ACL（可選）
 * @param {import("../repositories").RepositoryFactory} [repositoryFactory] - Repository 工廠（可選）
 * @returns {Promise<Array>} 可訪問的掛載點列表
 */
export async function getAccessibleMountsByBasicPath(db, basicPath, subjectType, subjectId, repositoryFactory) {
  // 使用 Repository 獲取資料
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const mountRepository = factory.getMountRepository();
  const storageConfigRepository = factory.getStorageConfigRepository();
  const principalStorageAclRepository = factory.getPrincipalStorageAclRepository
    ? factory.getPrincipalStorageAclRepository()
    : null;

  // 獲取所有活躍的掛載點
  const allMounts = await mountRepository.findMany(DbTables.STORAGE_MOUNTS, { is_active: 1 }, { orderBy: "sort_order ASC, name ASC" });

  if (!allMounts || allMounts.length === 0) return [];

  // 為每個掛載點獲取儲存配置的公開性資訊（當前主要針對物件儲存）
  const mountsWithStorageInfo = await Promise.all(
    allMounts.map(async (mount) => {
      if (mount.storage_config_id) {
        const storageConfig = await storageConfigRepository.findById(mount.storage_config_id);
        return {
          ...mount,
          is_public: storageConfig?.is_public || 0,
        };
      }
      return {
        ...mount,
        is_public: 1, // 無儲存配置引用時預設視為公開
      };
    })
  );

  // 若提供主體資訊，則載入該主體的 storage_config 白名單（儲存 ACL）
  let allowedConfigIdsSet = null;
  if (principalStorageAclRepository && subjectType && subjectId) {
    try {
      const allowedConfigIds = await principalStorageAclRepository.findConfigIdsBySubject(subjectType, subjectId);
      if (Array.isArray(allowedConfigIds) && allowedConfigIds.length > 0) {
        allowedConfigIdsSet = new Set(allowedConfigIds);
      }
    } catch (error) {
      console.warn("載入儲存 ACL 失敗，將回退到僅基於 is_public + basicPath 的過濾邏輯：", error);
    }
  }

  // 根據 basicPath + 儲存公開性 + 儲存 ACL 篩選可訪問的掛載點
  const inaccessibleMounts = []; // 收集無法訪問的掛載點資訊
  const accessibleMounts = mountsWithStorageInfo.filter((mount) => {
    // 首先檢查儲存配置是否“公開可用”
    // 對於物件儲存類掛載點，必須使用 is_public = 1 的配置
    if (mount.storage_config_id && mount.is_public !== 1) {
      inaccessibleMounts.push(mount.name);
      return false;
    }

    // 然後檢查是否命中主體的儲存 ACL 白名單（如果有）
    if (allowedConfigIdsSet && mount.storage_config_id && !allowedConfigIdsSet.has(mount.storage_config_id)) {
      return false;
    }

    // 最後檢查路徑許可權（basicPath 與掛載路徑的父子關係）
    const normalizedBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
    const normalizedMountPath = mount.mount_path.replace(/\/+$/, "") || "/";

    // 情況1：基本路徑是根路徑，允許訪問所有公開配置的掛載點
    if (normalizedBasicPath === "/") {
      return true;
    }

    // 情況2：基本路徑允許訪問掛載點路徑（基本路徑是掛載點的父級或相同）
    if (normalizedMountPath === normalizedBasicPath || normalizedMountPath.startsWith(normalizedBasicPath + "/")) {
      return true;
    }

    // 情況3：掛載點路徑是基本路徑的父級（基本路徑是掛載點的子目錄）
    if (normalizedBasicPath.startsWith(normalizedMountPath + "/")) {
      return true;
    }

    return false;
  });

  // 如果有無法訪問的掛載點，統一輸出一條日誌
  if (inaccessibleMounts.length > 0) {
    console.log(
      `API金鑰使用者無法訪問 ${inaccessibleMounts.length} 個非公開儲存配置的掛載點: ${inaccessibleMounts.join(", ")}`
    );
  }

  return accessibleMounts;
}

/**
 * 更新API金鑰最後使用時間
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - API金鑰ID
 * @returns {Promise<void>}
 */
export async function updateApiKeyLastUsed(db, id, repositoryFactory) {
  // 使用 ApiKeyRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const apiKeyRepository = factory.getApiKeyRepository();

  await apiKeyRepository.updateLastUsed(id);
}
