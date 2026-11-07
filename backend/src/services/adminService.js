import { ApiStatus } from "../constants/index.js";
import { generateRandomString, createErrorResponse } from "../utils/common.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";
import { ValidationError, AuthenticationError, NotFoundError, ConflictError } from "../http/errors.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";

const resolveRepositoryFactory = ensureRepositoryFactory;

/**
 * 驗證管理員令牌
 * @param {D1Database} db - D1資料庫例項
 * @param {string} token - JWT令牌
 * @returns {Promise<string|null>} 管理員ID或null
 */
export async function validateAdminToken(db, token, repositoryFactory) {
  console.log("驗證管理員令牌:", token.substring(0, 5) + "..." + token.substring(token.length - 5));

  try {
    // 使用 AdminRepository 驗證令牌
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const adminRepository = factory.getAdminRepository();

    const adminId = await adminRepository.validateToken(token);

    if (adminId) {
      console.log("令牌驗證成功，管理員ID:", adminId);
    } else {
      console.log("令牌驗證失敗");
    }

    return adminId;
  } catch (error) {
    console.error("驗證令牌時發生錯誤:", error);
    return null;
  }
}

/**
 * 管理員登入
 * @param {D1Database} db - D1資料庫例項
 * @param {string} username - 使用者名稱
 * @param {string} password - 密碼
 * @param {Object} repositoryFactory - Repository工廠
 * @param {Object} env - 環境變數物件（可選，用於讀取配置）
 * @returns {Promise<Object>} 登入結果，包含token和過期時間
 */
export async function login(db, username, password, repositoryFactory, env = {}) {
  // 引數驗證
  if (!username || !password) {
    throw new ValidationError("使用者名稱和密碼不能為空");
  }

  // 使用 AdminRepository 查詢管理員
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const adminRepository = factory.getAdminRepository();

  const admin = await adminRepository.findByUsername(username);

  if (!admin) {
    throw new AuthenticationError("使用者名稱或密碼錯誤");
  }

  // 驗證密碼
  const isValid = await verifyPassword(password, admin.password);
  if (!isValid) {
    throw new AuthenticationError("使用者名稱或密碼錯誤");
  }

  // ===== token管理：限制併發session數量 =====
  const MAX_TOKENS_PER_USER = 5; // 每個使用者最多5個token

  // 獲取該使用者的所有token（包括過期的）
  const existingTokens = await adminRepository.getAllTokensForAdmin(admin.id);

  // 如果超過限制，刪除最舊的token，保留最新的5個
  if (existingTokens.length >= MAX_TOKENS_PER_USER) {
    // 保留最新的4個token，為新token留出空間
    const tokensToKeep = existingTokens.slice(0, MAX_TOKENS_PER_USER - 1);
    const tokensToDelete = existingTokens.slice(MAX_TOKENS_PER_USER - 1);

    for (const tokenToDelete of tokensToDelete) {
      await adminRepository.deleteToken(tokenToDelete.token);
    }

    console.log(`已清理 ${tokensToDelete.length} 箇舊token（包括過期token），保留最新的 ${tokensToKeep.length} 個，當前使用者: ${admin.username}`);
  }
  // ===== token管理結束 =====

  // 更新最後登入時間
  await adminRepository.updateLastLogin(admin.id);

  // 生成並儲存令牌
  const token = generateRandomString(32);
  const expiresAt = new Date();
  
  // 從環境變數讀取過期天數，預設為7天
  const expiryDays = parseInt(env.ADMIN_TOKEN_EXPIRY_DAYS) || 7;
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  // 使用 AdminRepository 建立令牌
  await adminRepository.createToken(admin.id, token, expiresAt);

  // 返回認證資訊
  return {
    username: admin.username,
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * 管理員登出
 * @param {D1Database} db - D1資料庫例項
 * @param {string} token - 認證令牌
 * @returns {Promise<void>}
 */
export async function logout(db, token, repositoryFactory) {
  // 使用 AdminRepository 刪除令牌
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const adminRepository = factory.getAdminRepository();

  await adminRepository.deleteToken(token);
}

/**
 * 更改管理員密碼或使用者名稱
 * @param {D1Database} db - D1資料庫例項
 * @param {string} adminId - 管理員ID
 * @param {string} currentPassword - 當前密碼
 * @param {string} newPassword - 新密碼，可選
 * @param {string} newUsername - 新使用者名稱，可選
 * @returns {Promise<void>}
 */
export async function changePassword(db, adminId, currentPassword, newPassword, newUsername, repositoryFactory) {
  // 使用 AdminRepository
  const factory = resolveRepositoryFactory(db, repositoryFactory);
  const adminRepository = factory.getAdminRepository();

  // 驗證當前密碼
  const admin = await adminRepository.findById(adminId);
  if (!admin) {
    throw new NotFoundError("管理員不存在");
  }

  if (!(await verifyPassword(currentPassword, admin.password))) {
    throw new AuthenticationError("當前密碼錯誤");
  }

  // 檢查新密碼是否與當前密碼相同
  if (newPassword && (await verifyPassword(newPassword, admin.password))) {
    throw new ValidationError("新密碼不能與當前密碼相同");
  }

  // 如果提供了新使用者名稱，先檢查使用者名稱是否已存在
  if (newUsername && newUsername.trim() !== "") {
    const usernameExists = await adminRepository.existsByUsername(newUsername, adminId);

    if (usernameExists) {
      throw new ConflictError("使用者名稱已存在");
    }

    // 更新使用者名稱和密碼
    const updateData = { username: newUsername };
    if (newPassword) {
      updateData.password = await hashPassword(newPassword);
    }

    await adminRepository.updateAdmin(adminId, updateData);
  } else if (newPassword) {
    // 僅更新密碼
    const newPasswordHash = await hashPassword(newPassword);
    await adminRepository.updateAdmin(adminId, { password: newPasswordHash });
  } else {
    throw new ValidationError("未提供新密碼或新使用者名稱");
  }

  // 成功修改後，刪除該管理員的所有認證令牌，強制重新登入
  await adminRepository.deleteTokensByAdminId(adminId);
}

/**
 * 測試管理員令牌是否有效
 * @param {D1Database} db - D1資料庫例項
 * @param {string} token - JWT令牌
 * @returns {Promise<boolean>} 令牌是否有效
 */
export async function testAdminToken(db, token, repositoryFactory) {
  const adminId = await validateAdminToken(db, token, repositoryFactory);
  return adminId !== null;
}
