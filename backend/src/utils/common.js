/**
 * 通用工具函式
 */
import { UserType, ApiStatus } from "../constants/index.js";
import { RepositoryError, ValidationError, AuthorizationError, ConflictError } from "../http/errors.js";

/**
 * 生成隨機字串
 * @param {number} length - 字串長度
 * @returns {string} 隨機字串
 */
export function generateRandomString(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  randomValues.forEach((val) => (result += chars[val % chars.length]));
  return result;
}

/**
 * 統一錯誤響應工具函式
 * @param {number} statusCode - HTTP狀態碼
 * @param {string} message - 錯誤訊息
 * @returns {object} 標準錯誤響應物件
 */
export function createErrorResponse(_statusCode, message, code) {
  const base = {
    success: false,
    code,
    message,
  };
  const extra = arguments.length >= 4 ? arguments[3] : null;
  if (!extra || typeof extra !== "object") return base;
  return { ...base, ...extra };
}

export function createSuccessResponse(data, message = "OK", code = "OK") {
  return {
    success: true,
    code,
    message,
    data,
  };
}

export const jsonOk = (c, data, message = "OK") => c.json(createSuccessResponse(data, message, "OK"), ApiStatus.SUCCESS);
export const jsonCreated = (c, data, message = "Created") => c.json(createSuccessResponse(data, message, "CREATED"), ApiStatus.CREATED);

/**
 * 格式化檔案大小
 * @param {number} bytes 檔案大小（位元組）
 * @returns {string} 格式化後的檔案大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";

  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + sizes[i];
}

/**
 * 處理每週資料，確保有7天的資料
 * @param {Array} data - 包含日期和數量的資料
 * @returns {Array} 處理後的資料
 */
export function processWeeklyData(data) {
  const result = new Array(7).fill(0);

  if (!data || data.length === 0) return result;

  // 獲取過去7天的日期
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split("T")[0]); // 格式：YYYY-MM-DD
  }

  // 將資料對映到對應日期
  data.forEach((item) => {
    const itemDate = item.date.split("T")[0]; // 處理可能的時間部分
    const index = dates.indexOf(itemDate);
    if (index !== -1) {
      result[index] = item.count;
    }
  });

  return result;
}

/**
 * 生成通用UUID
 * @returns {string} 生成的UUID，符合RFC4122 v4標準
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 生成唯一檔案ID
 * @returns {string} 生成的檔案ID
 */
export function generateFileId() {
  return crypto.randomUUID();
}

/**
 * 生成統一的儲存配置ID
 */
export function generateStorageConfigId() {
  return crypto.randomUUID();
}
/**
 * 生成短ID作為檔案路徑字首
 * @returns {string} 生成的短ID
 */
export function generateShortId() {
  // 生成6位隨機ID
  const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";

  // 使用 crypto.getRandomValues 獲取加密安全的隨機值
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < 6; i++) {
    result += charset[randomValues[i] % charset.length];
  }

  return result;
}

/**
 * 根據系統設定決定是否使用隨機字尾
 * @param {D1Database} db - 資料庫例項
 * @returns {Promise<boolean>} 是否使用隨機字尾
 */
export async function shouldUseRandomSuffix(db) {
  try {
    // 動態匯入避免迴圈依賴
    const { getSettingMetadata } = await import("../services/systemService.js");

    // 獲取檔案命名策略設定，預設為覆蓋模式
    const setting = await getSettingMetadata(db, "file_naming_strategy");
    const strategy = setting ? setting.value : "overwrite";

    // 返回是否使用隨機字尾
    return strategy === "random_suffix";
  } catch (error) {
    console.warn("獲取檔案命名策略失敗，使用預設覆蓋模式:", error);
    // 出錯時預設使用覆蓋模式（不使用隨機字尾）
    return false;
  }
}

/**
 * 從檔名中獲取檔名和副檔名
 * @param {string} filename - 檔名
 * @returns {Object} 包含檔名和副檔名的物件
 */
export function getFileNameAndExt(filename) {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex > -1) {
    return {
      name: filename.substring(0, lastDotIndex),
      ext: filename.substring(lastDotIndex),
    };
  }
  return {
    name: filename,
    ext: "",
  };
}

/**
 * 生成安全的檔名（移除非法字元）
 * @param {string} fileName - 原始檔名
 * @returns {string} 安全的檔名
 */
export function getSafeFileName(fileName) {
  // 只過濾真正有害的字元：
  // - 控制字元 (\x00-\x1F, \x7F)
  // - 路徑分隔符 (/ \)
  // - Windows保留字元 (< > : " | ? *)
  // 保留所有其他Unicode字元，包括中文標點符號
  return fileName.replace(/[<>:"|?*\\/\x00-\x1F\x7F]/g, "_");
}

/**
 * 驗證 slug 格式
 * @param {string} slug - 要驗證的 slug
 * @returns {boolean} 是否有效
 */
export function validateSlugFormat(slug) {
  if (!slug) return false;
  const slugRegex = /^[a-zA-Z0-9._-]+$/;
  return slugRegex.test(slug);
}

/**
 * 生成唯一的檔案slug
 * @param {D1Database} db - D1資料庫例項
 * @param {string} customSlug - 自定義slug
 * @param {boolean} override - 是否覆蓋已存在的slug
 * @param {Object} overrideContext - 覆蓋操作的上下文資訊（當override=true時需要）
 * @returns {Promise<string>} 生成的唯一slug
 */
export async function generateUniqueFileSlug(db, customSlug = null, override = false, overrideContext = null) {
  // 動態匯入DbTables以避免迴圈依賴
  const { DbTables } = await import("../constants/index.js");

  // 如果提供了自定義slug，驗證其格式並檢查是否已存在
  if (customSlug) {
    // 驗證slug格式：只允許字母、數字、橫槓、下劃線和點號
    if (!validateSlugFormat(customSlug)) {
      throw new ValidationError("連結字尾格式無效，只能使用字母、數字、下劃線、橫槓和點號");
    }

    // 檢查slug是否已存在
    const existingFile = await db.prepare(`SELECT * FROM ${DbTables.FILES} WHERE slug = ?`).bind(customSlug).first();

    // 如果存在並且不覆蓋，丟擲錯誤
    if (existingFile && !override) {
      throw new ConflictError("連結字尾已被佔用，請使用其他連結字尾");
    } else if (existingFile && override) {
      // 處理檔案覆蓋邏輯
      await handleFileOverride(existingFile, overrideContext);
      console.log(`允許覆蓋已存在的連結字尾: ${customSlug}`);
    }

    return customSlug;
  }

  // 生成隨機slug (6個字元)
  let attempts = 0;
  const maxAttempts = 10;
  while (attempts < maxAttempts) {
    const randomSlug = generateShortId();

    // 檢查是否已存在
    const existingFile = await db.prepare(`SELECT id FROM ${DbTables.FILES} WHERE slug = ?`).bind(randomSlug).first();
    if (!existingFile) {
      return randomSlug;
    }

    attempts++;
  }

  throw new RepositoryError("無法生成唯一連結字尾，請稍後再試");
}

async function handleFileOverride(existingFile, overrideContext) {
  if (!overrideContext) {
    throw new ValidationError("覆蓋操作需要 overrideContext 資訊");
  }

  const { userIdOrInfo, userType, encryptionSecret, repositoryFactory, db } = overrideContext;
  if (!repositoryFactory || !db) {
    throw new ValidationError("覆蓋操作缺少 repositoryFactory 或 db 上下文");
  }

  const apiKeyIdentifier = typeof userIdOrInfo === "object" ? userIdOrInfo?.id : userIdOrInfo;
  const currentCreator = userType === UserType.ADMIN ? userIdOrInfo : `apikey:${apiKeyIdentifier}`;

  if (!currentCreator || existingFile.created_by !== currentCreator) {
    throw new AuthorizationError("無權覆蓋該連結字尾");
  }

  const fileRepository = repositoryFactory.getFileRepository();

  if (existingFile.storage_path && existingFile.storage_config_id) {
    try {
      const storageConfigRepository = repositoryFactory.getStorageConfigRepository?.();
      const storageConfig = storageConfigRepository
        ? (storageConfigRepository.findByIdWithSecrets
            ? await storageConfigRepository.findByIdWithSecrets(existingFile.storage_config_id)
            : await storageConfigRepository.findById(existingFile.storage_config_id))
        : null;
      if (storageConfig) {
        const { ObjectStore } = await import("../storage/object/ObjectStore.js");
        const objectStore = new ObjectStore(db, encryptionSecret, repositoryFactory);
        await objectStore.deleteByStoragePath(existingFile.storage_config_id, existingFile.storage_path, { db });
      }
    } catch (error) {
      console.warn("刪除舊儲存物件失敗", error);
    }
  }

  try {
    await fileRepository.deleteFilePasswordRecord(existingFile.id);
  } catch (error) {
    console.warn("刪除舊密碼記錄失敗", error);
  }

  await fileRepository.deleteFile(existingFile.id);

  if (existingFile.storage_config_id) {
    const { invalidateFsCache } = await import("../cache/invalidation.js");
    await invalidateFsCache({ storageConfigId: existingFile.storage_config_id, reason: "file-override", db });
  }
}

/**
 * 解析查詢引數為整數
 * @param {import('hono').Context} c
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
export function getQueryInt(c, key, defaultValue = 0) {
  const val = c.req.query(key);
  if (val === undefined || val === null || val === "") return defaultValue;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * 解析查詢引數為布林值（支援 true/1/false/0）
 * @param {import('hono').Context} c
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
export function getQueryBool(c, key, defaultValue = false) {
  const val = c.req.query(key);
  if (val === undefined || val === null || val === "") return defaultValue;
  const lowered = String(val).toLowerCase();
  if (lowered === "true" || lowered === "1") return true;
  if (lowered === "false" || lowered === "0") return false;
  return defaultValue;
}

/**
 * 標準化分頁解析：優先使用 offset，缺失時按 page 計算
 * @param {import('hono').Context} c
 * @param {{limit?:number,page?:number,offset?:number}} defaults
 * @returns {{limit:number,page:number,offset:number}}
 */
export function getPagination(c, defaults = {}) {
  const limitDefault = defaults.limit ?? 30;
  const pageDefault = defaults.page ?? 1;
  const offsetDefault = defaults.offset ?? 0;

  const limit = getQueryInt(c, "limit", limitDefault);
  const page = getQueryInt(c, "page", pageDefault);
  const hasOffset = c.req.query("offset") !== undefined;
  const offset = hasOffset ? getQueryInt(c, "offset", offsetDefault) : Math.max(0, (page - 1) * limit);
  return { limit, page, offset };
}

/**
 * 處理檔案覆蓋邏輯的輔助函式
 * @private
 */

