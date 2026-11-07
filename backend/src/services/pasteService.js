import { ApiStatus } from "../constants/index.js";
import { generateRandomString, createErrorResponse, validateSlugFormat } from "../utils/common.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";
import { AppError, ValidationError, ConflictError, NotFoundError, AuthenticationError } from "../http/errors.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";

const resolveRepositoryFactory = ensureRepositoryFactory;

/**
 * 生成唯一的文字分享短連結slug
 * @param {D1Database} db - D1資料庫例項
 * @param {string} customSlug - 自定義短連結
 * @returns {Promise<string>} 生成的唯一slug
 */
export async function generateUniqueSlug(db, customSlug = null, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  if (customSlug) {
    // 新增格式驗證：只允許字母、數字、連字元、下劃線、點號
    if (!validateSlugFormat(customSlug)) {
      throw new ValidationError("連結字尾格式無效，只允許使用字母、數字、連字元(-)、下劃線(_)和點號(.)");
    }

    // 檢查自定義slug是否已存在
    const slugExists = await pasteRepository.existsBySlug(customSlug);
    if (!slugExists) {
      return customSlug;
    }
    // 如果自定義slug已存在，丟擲特定錯誤
    throw new ConflictError("連結字尾已被佔用，請嘗試其他字尾");
  }

  // 生成隨機slug
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const slug = generateRandomString(6);

    // 檢查隨機slug是否已存在
    const slugExists = await pasteRepository.existsBySlug(slug);
    if (!slugExists) {
      return slug;
    }
  }

  throw new AppError("無法生成唯一連結，請稍後再試", { status: ApiStatus.INTERNAL_ERROR, code: "INTERNAL_ERROR", expose: false });
}

/**
 * 原子化增加文字分享檢視次數並檢查狀態
 * @param {D1Database} db - D1資料庫例項
 * @param {string} pasteId - 文字分享ID
 * @param {number} maxViews - 最大檢視次數
 * @returns {Promise<Object>} 包含isDeleted、paste、isLastView、isLastNormalAccess的結果物件
 */
export async function incrementAndCheckPasteViews(db, pasteId, maxViews, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 先獲取當前paste資訊，檢查這是否是最後一次正常訪問
  const currentPaste = await pasteRepository.findById(pasteId);
  if (!currentPaste) {
    return { isDeleted: true, paste: null, isLastView: false, isLastNormalAccess: false };
  }

  // 檢查這是否是最後一次正常訪問（訪問後剛好達到限制）
  const isLastNormalAccess = maxViews && maxViews > 0 && currentPaste.views + 1 === maxViews;

  // 原子增加檢視次數
  await pasteRepository.incrementViews(pasteId);

  // 重新獲取更新後的paste資訊
  const updatedPaste = await pasteRepository.findById(pasteId);

  if (!updatedPaste) {
    return { isDeleted: true, paste: null, isLastView: false, isLastNormalAccess: false };
  }

  // 檢查是否需要刪除
  let isDeleted = false;
  let isLastView = false;

  if (maxViews && maxViews > 0 && updatedPaste.views >= maxViews) {
    console.log(`文字分享(${pasteId})已達到最大檢視次數(${maxViews})，自動刪除`);
    await pasteRepository.deletePaste(pasteId);
    isDeleted = true;
    isLastView = true;
  }

  return {
    isDeleted,
    paste: updatedPaste,
    isLastView,
    isLastNormalAccess,
  };
}

/**
 * 檢查並刪除過期的文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {Object} paste - 文字分享物件
 * @returns {Promise<boolean>} 是否已過期並刪除
 */
export async function checkAndDeleteExpiredPaste(db, paste, repositoryFactory = null) {
  if (!paste) return false;

  const now = new Date();

  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 檢查過期時間
  if (paste.expires_at && new Date(paste.expires_at) < now) {
    console.log(`文字分享(${paste.id})已過期，自動刪除`);
    await pasteRepository.deletePaste(paste.id);
    return true;
  }

  // 檢查最大檢視次數
  if (paste.max_views && paste.views >= paste.max_views) {
    console.log(`文字分享(${paste.id})已達到最大檢視次數，自動刪除`);
    await pasteRepository.deletePaste(paste.id);
    return true;
  }

  return false;
}

/**
 * 檢查文字分享是否可訪問
 * @param {Object} paste - 文字分享物件
 * @returns {boolean} 是否可訪問
 */
export function isPasteAccessible(paste) {
  if (!paste) return false;

  const now = new Date();

  // 檢查過期時間
  if (paste.expires_at && new Date(paste.expires_at) < now) {
    return false;
  }

  // 檢查最大檢視次數
  if (paste.max_views && paste.max_views > 0 && paste.views >= paste.max_views) {
    return false;
  }

  return true;
}

/**
 * 建立新的文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {Object} pasteData - 文字分享資料
 * @param {string} created_by - 建立者標識
 * @returns {Promise<Object>} 建立的文字分享
 */
export async function createPaste(db, pasteData, created_by, repositoryFactory = null) {
  // 必須提供內容
  if (!pasteData.content) {
    throw new ValidationError("內容不能為空");
  }

  // 驗證可開啟次數不能為負數
  if (pasteData.max_views !== null && pasteData.max_views !== undefined && parseInt(pasteData.max_views) < 0) {
    throw new ValidationError("可開啟次數不能為負數");
  }

  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 生成唯一slug
  const slug = await generateUniqueSlug(db, pasteData.slug, factory);
  const pasteId = crypto.randomUUID();

  // 處理密碼 (如果提供)
  let passwordHash = null;
  if (pasteData.password) {
    passwordHash = await hashPassword(pasteData.password);
  }

  // 建立時間
  const now = new Date();
  const createdAt = now.toISOString();

  // 如果沒有提供標題，使用slug作為標題
  const title = pasteData.title || slug;

  // 準備文字分享資料
  const pasteDataForRepo = {
    id: pasteId,
    slug,
    content: pasteData.content,
    title: title,
    remark: pasteData.remark || null,
    password: passwordHash,
    expires_at: pasteData.expires_at || null,
    max_views: pasteData.max_views || null,
    is_public: typeof pasteData.is_public === "boolean" ? (pasteData.is_public ? 1 : 0) : 1,
    created_by: created_by,
    created_at: createdAt,
    updated_at: createdAt,
  };

  // 使用 Repository 建立文字分享（包含密碼處理）
  await pasteRepository.createPasteWithPassword(pasteDataForRepo, pasteData.password);

  // 返回建立結果
  return {
    id: pasteId,
    slug,
    title: title,
    remark: pasteData.remark,
    expires_at: pasteData.expires_at,
    max_views: pasteData.max_views,
    is_public: typeof pasteData.is_public === "boolean" ? pasteData.is_public : true,
    hasPassword: !!passwordHash,
    created_at: createdAt,
  };
}

/**
 * 獲取文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {string} slug - 唯一標識
 * @returns {Promise<Object>} 文字分享
 */
export async function getPasteBySlug(db, slug, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 查詢文字分享
  const paste = await pasteRepository.findBySlug(slug);

  // 如果不存在則返回404
  if (!paste) {
    throw new NotFoundError("文字分享不存在或已過期");
  }

  // 新增 has_password 欄位
  const pasteWithPasswordFlag = {
    ...paste,
    has_password: !!paste.password,
  };

  // 檢查是否過期並刪除
  if (await checkAndDeleteExpiredPaste(db, pasteWithPasswordFlag)) {
    throw new AppError("文字分享已過期或超過最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
  }

  return pasteWithPasswordFlag;
}

/**
 * 驗證文字密碼
 * @param {D1Database} db - D1資料庫例項
 * @param {string} slug - 唯一標識
 * @param {string} password - 密碼
 * @param {boolean} incrementViews - 是否增加檢視次數，預設為true
 * @returns {Promise<Object>} 文字分享
 */
export async function verifyPastePassword(db, slug, password, incrementViews = true, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 查詢文字分享
  const paste = await pasteRepository.findBySlug(slug);

  // 如果不存在則返回404
  if (!paste) {
    throw new NotFoundError("文字分享不存在");
  }

  // 新增 has_password 欄位用於過期檢查
  const pasteWithPasswordFlag = {
    ...paste,
    has_password: !!paste.password,
  };

  // 檢查是否過期並刪除
  if (await checkAndDeleteExpiredPaste(db, pasteWithPasswordFlag)) {
    throw new AppError("文字分享已過期或超過最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
  }

  // 如果沒有密碼
  if (!paste.password) {
    throw new ValidationError("此文字分享無需密碼");
  }

  // 驗證密碼
  const isValid = await verifyPassword(password, paste.password);
  if (!isValid) {
    throw new AuthenticationError("密碼錯誤");
  }

  // 查詢明文密碼
  const plainPassword = await pasteRepository.findPasswordByPasteId(paste.id);

  // 增加檢視次數（如果需要）
  if (incrementViews) {
    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);
    // 如果文字被刪除，丟擲錯誤
    if (result.isDeleted) {
      throw new AppError("文字分享已達到最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }
  }

  // 返回包含明文密碼的完整paste物件
  return {
    ...paste,
    plain_password: plainPassword,
  };
}

/**
 * 獲取所有文字分享列表（管理員用）
 * @param {D1Database} db - D1資料庫例項
 * @param {number} page - 頁碼（相容性引數）
 * @param {number} limit - 每頁條數
 * @param {string} created_by - 建立者篩選
 * @param {string} search - 搜尋關鍵詞
 * @param {number} offset - 偏移量（優先使用）
 * @returns {Promise<Object>} 分頁結果
 */
export async function getAllPastes(db, page = 1, limit = 10, created_by = null, search = null, offset = null, repositoryFactory = null) {
  // 使用 Repository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();
  const apiKeyRepository = factory.getApiKeyRepository();

  // 使用 PasteRepository 獲取管理員列表資料，支援offset模式
  const pasteData = await pasteRepository.findAllForAdmin({
    page,
    limit,
    offset,
    created_by,
    search,
  });

  // 處理查詢結果，為API金鑰建立者新增金鑰名稱
  let results = pasteData.results;
  // 收集所有需要查詢名稱的金鑰ID
  const apiKeyIds = results.filter((paste) => paste.created_by && paste.created_by.startsWith("apikey:")).map((paste) => paste.created_by.substring(7));

  // 如果有需要查詢名稱的金鑰
  if (apiKeyIds.length > 0) {
    // 使用Set去重
    const uniqueKeyIds = [...new Set(apiKeyIds)];
    const keyNamesMap = new Map();

    // 為每個唯一的金鑰ID查詢名稱
    for (const keyId of uniqueKeyIds) {
      const keyInfo = await apiKeyRepository.findById(keyId);
      if (keyInfo) {
        keyNamesMap.set(keyId, keyInfo.name);
      }
    }

    // 為每個結果新增key_name欄位
    results = results.map((paste) => {
      if (paste.created_by && paste.created_by.startsWith("apikey:")) {
        const keyId = paste.created_by.substring(7);
        const keyName = keyNamesMap.get(keyId);
        if (keyName) {
          return { ...paste, key_name: keyName };
        }
      }
      return paste;
    });
  }

  return {
    results,
    pagination: pasteData.pagination,
  };
}

/**
 * 獲取使用者文字列表
 * @param {D1Database} db - D1資料庫例項
 * @param {string} apiKeyId - API金鑰ID
 * @param {number} limit - 每頁條數
 * @param {number} offset - 偏移量
 * @param {string} search - 搜尋關鍵詞
 * @returns {Promise<Object>} 分頁結果
 */
export async function getUserPastes(db, apiKeyId, limit = 30, offset = 0, search = null, repositoryFactory = null) {
  // 使用 Repository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();
  const apiKeyRepository = factory.getApiKeyRepository();

  // 使用 PasteRepository 獲取使用者文字列表
  const created_by = `apikey:${apiKeyId}`;
  const pasteData = await pasteRepository.findByCreatorWithPagination(created_by, {
    limit,
    offset,
    search,
  });

  // 如果有created_by欄位並且以apikey:開頭，查詢金鑰名稱
  let results = pasteData.results;

  // 收集所有需要查詢名稱的金鑰ID
  const apiKeyIds = results.filter((paste) => paste.created_by && paste.created_by.startsWith("apikey:")).map((paste) => paste.created_by.substring(7));

  // 如果有需要查詢名稱的金鑰
  if (apiKeyIds.length > 0) {
    // 使用Set去重
    const uniqueKeyIds = [...new Set(apiKeyIds)];
    const keyNamesMap = new Map();

    // 為每個唯一的金鑰ID查詢名稱
    for (const keyId of uniqueKeyIds) {
      const keyInfo = await apiKeyRepository.findById(keyId);
      if (keyInfo) {
        keyNamesMap.set(keyId, keyInfo.name);
      }
    }

    // 為每個結果新增key_name欄位
    results = results.map((paste) => {
      if (paste.created_by && paste.created_by.startsWith("apikey:")) {
        const keyId = paste.created_by.substring(7);
        const keyName = keyNamesMap.get(keyId);
        if (keyName) {
          return { ...paste, key_name: keyName };
        }
      }
      return paste;
    });
  }

  return {
    results,
    pagination: pasteData.pagination,
  };
}

/**
 * 獲取單個文字詳情（管理員用）
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - 文字ID
 * @returns {Promise<Object>} 文字詳情
 */
export async function getPasteById(db, id, repositoryFactory = null) {
  // 使用 Repository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();
  const apiKeyRepository = factory.getApiKeyRepository();

  // 查詢文字分享記錄（包含密碼資訊）
  const paste = await pasteRepository.findByIdWithPassword(id, true);

  if (!paste) {
    throw new NotFoundError("文字分享不存在");
  }

  // 新增 has_password 欄位
  const result = {
    ...paste,
    has_password: !!paste.password,
  };

  // 如果文字由API金鑰建立，獲取金鑰名稱
  if (paste.created_by && paste.created_by.startsWith("apikey:")) {
    const keyId = paste.created_by.substring(7);
    const keyInfo = await apiKeyRepository.findById(keyId);

    if (keyInfo) {
      result.key_name = keyInfo.name;
    }
  }

  return result;
}

/**
 * 刪除文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {string} id - 文字ID
 * @returns {Promise<void>}
 */
export async function deletePaste(db, id, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 檢查分享是否存在
  const paste = await pasteRepository.findById(id);

  if (!paste) {
    throw new NotFoundError("文字分享不存在");
  }

  // 刪除分享
  await pasteRepository.deletePaste(id);
}

/**
 * 批次刪除文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {Array<string>} ids - 文字ID陣列
 * @param {boolean} clearExpired - 是否清理過期內容
 * @returns {Promise<number>} 刪除的數量
 */
export async function batchDeletePastes(db, ids, clearExpired = false, repositoryFactory = null) {
  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 如果指定了清理過期內容
  if (clearExpired) {
    const result = await pasteRepository.deleteExpired();
    return result.deletedCount;
  }

  // 否則按照指定的ID刪除
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError("請提供有效的ID陣列");
  }

  // 執行批次刪除
  const result = await pasteRepository.batchDelete(ids);
  return result.deletedCount;
}

/**
 * 批次刪除使用者的文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {Array<string>} ids - 文字ID陣列
 * @param {string} apiKeyId - API金鑰ID
 * @returns {Promise<number>} 刪除的數量
 */
export async function batchDeleteUserPastes(db, ids, apiKeyId, repositoryFactory = null) {
  // 驗證請求資料
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError("請提供有效的ID陣列");
  }

  // 使用 PasteRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 構建建立者標識
  const created_by = `apikey:${apiKeyId}`;

  // 執行批次刪除（只刪除屬於該API金鑰使用者的文字）
  const result = await pasteRepository.batchDeleteByCreator(ids, created_by);

  return result.deletedCount;
}

/**
 * 更新文字分享
 * @param {D1Database} db - D1資料庫例項
 * @param {string} slug - 唯一標識
 * @param {Object} updateData - 更新資料
 * @param {string} created_by - 建立者標識（可選，用於許可權檢查）
 * @returns {Promise<Object>} 更新後的資訊
 */
export async function updatePaste(db, slug, updateData, created_by = null, repositoryFactory = null) {
  // 使用 Repository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const pasteRepository = factory.getPasteRepository();

  // 檢查分享是否存在
  const paste = await pasteRepository.findBySlugForUpdate(slug, created_by);

  if (!paste) {
    throw new NotFoundError("文字分享不存在或無權修改");
  }

  // 檢查是否過期
  if (await checkAndDeleteExpiredPaste(db, paste, factory)) {
    throw new AppError("文字分享已過期或超過最大檢視次數，無法修改", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
  }

  // 驗證內容
  if (!updateData.content) {
    throw new ValidationError("內容不能為空");
  }

  // 驗證可開啟次數
  if (updateData.max_views !== null && updateData.max_views !== undefined && parseInt(updateData.max_views) < 0) {
    throw new ValidationError("可開啟次數不能為負數");
  }

  // 處理密碼更新
  let passwordHash = null;
  let clearPassword = false;
  let newPlainPassword = null;

  if (updateData.password) {
    // 如果提供了新密碼，則更新
    passwordHash = await hashPassword(updateData.password);
    newPlainPassword = updateData.password;
  } else if (updateData.clearPassword) {
    // 如果指定了清除密碼
    clearPassword = true;
  }

  // 處理slug更新
  let newSlug = paste.slug; // 預設保持原slug不變

  // 如果提供了新的slug，則生成唯一slug
  if (updateData.newSlug !== undefined) {
    try {
      // 如果newSlug為空或null，則自動生成隨機slug
      newSlug = await generateUniqueSlug(db, updateData.newSlug || null, factory);
    } catch (error) {
      // 如果slug已被佔用，返回409衝突錯誤
      if (error.message.includes("連結字尾已被佔用")) {
        throw new ConflictError(error.message);
      }
      throw error;
    }
  }

  // 簡化重置策略：呼叫更新介面就重置views為0
  let resetViews = true;
  let newViewsValue = 0;
  console.log(`文字分享(${paste.id})已更新，重置訪問次數為0`);

  // 如果標題為空，使用新slug作為標題
  const finalTitle = updateData.title || newSlug;

  // 準備更新資料
  const updateDataForRepo = {
    title: finalTitle,
    content: updateData.content,
    remark: updateData.remark,
    expires_at: updateData.expires_at,
    max_views: updateData.max_views,
    is_public: updateData.is_public,
  };

  // 準備更新選項
  const updateOptions = {
    newSlug: newSlug !== paste.slug ? newSlug : null,
    passwordHash,
    clearPassword,
    resetViews,
    newViewsValue, // 傳遞新的views值
  };

  // 使用 Repository 執行復雜更新
  await pasteRepository.updatePasteComplex(paste.id, updateDataForRepo, updateOptions);

  // 處理密碼記錄的更新
  if (newPlainPassword) {
    await pasteRepository.upsertPasswordRecord(paste.id, newPlainPassword);
  } else if (clearPassword) {
    await pasteRepository.deletePasswordRecord(paste.id);
  }

  // 返回更新結果
  return {
    id: paste.id,
    slug: newSlug, // 返回更新後的slug（可能已更改）
  };
}
