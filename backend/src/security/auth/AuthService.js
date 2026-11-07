/**
 * 統一認證服務
 * 具體的認證邏輯、身份識別、許可權檢查
 */

import { Permission, PermissionChecker } from "../../constants/permissions.js";
import { validateAdminToken } from "../../services/adminService.js";
import { checkAndDeleteExpiredApiKey } from "../../services/apiKeyService.js";
import { verifyPassword } from "../../utils/crypto.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";

/**
 * 認證結果類
 * 包含閘道器需要的核心屬性和方法
 */
export class AuthResult {
  constructor({ isAuthenticated = false, userId = null, permissions = 0, basicPath = "/", isAdmin = false, keyInfo = null } = {}) {
    this.isAuthenticated = isAuthenticated;
    this.userId = userId;
    this.permissions = permissions;
    this.basicPath = basicPath;
    this._isAdmin = isAdmin;
    this.keyInfo = keyInfo;
  }

  /**
   * 檢查是否有指定許可權
   * 閘道器需要的核心方法
   */
  hasPermission(permissionFlag) {
    // 管理員擁有所有許可權
    if (this._isAdmin) {
      return true;
    }
    return PermissionChecker.hasPermission(this.permissions, permissionFlag);
  }

  /**
   * 檢查是否為管理員
   * 閘道器需要的核心方法
   */
  isAdmin() {
    return this._isAdmin;
  }

  /**
   * 獲取使用者ID
   * 閘道器工具函式需要的方法
   */
  getUserId() {
    return this.userId;
  }

  /**
   * 獲取使用者型別
   * WebDAV認證需要的方法
   */
  getUserType() {
    if (this._isAdmin) {
      return "admin";
    }
    if (this.keyInfo) {
      return "apiKey";
    }
    return "unknown";
  }

  /**
   * 檢查是否有任一許可權
   * 閘道器許可權驗證需要的方法
   */
  hasAnyPermission(permissionFlags) {
    // 管理員擁有所有許可權
    if (this._isAdmin) {
      return true;
    }
    return PermissionChecker.hasAnyPermission(this.permissions, permissionFlags);
  }

  /**
   * 檢查是否有所有許可權
   * 閘道器許可權驗證需要的方法
   */
  hasAllPermissions(permissionFlags) {
    // 管理員擁有所有許可權
    if (this._isAdmin) {
      return true;
    }
    return PermissionChecker.hasAllPermissions(this.permissions, permissionFlags);
  }
}

/**
 * 認證服務類 - 基於位標誌許可權系統
 */
export class AuthService {
  constructor(db, repositoryFactory = null) {
    this.db = db;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
  }

  /**
   * 解析認證頭
   */
  parseAuthHeader(authHeader) {
    if (!authHeader) {
      return { type: null, token: null };
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2) {
      return { type: null, token: null };
    }

    const [type, token] = parts;
    return {
      type: type.toLowerCase(),
      token: token,
    };
  }

  /**
   * 驗證管理員認證
   */
  async validateAdminAuth(token) {
    const adminId = await validateAdminToken(this.db, token, this.repositoryFactory);
    if (!adminId) {
      return new AuthResult();
    }

    return new AuthResult({
      isAuthenticated: true,
      userId: adminId,
      permissions: 0,
      isAdmin: true,
    });
  }

  /**
   * 驗證API金鑰認證
   */
  async validateApiKeyAuth(apiKey) {
    const apiKeyRepository = this.repositoryFactory.getApiKeyRepository();
    const keyRecord = await apiKeyRepository.findByKey(apiKey);

    if (!keyRecord) {
      return new AuthResult();
    }

    if (await checkAndDeleteExpiredApiKey(this.db, keyRecord, this.repositoryFactory)) {
      return new AuthResult();
    }

    await apiKeyRepository.updateLastUsed(keyRecord.id);
    return this.buildApiKeyAuthResult(keyRecord);
  }

  /**
   * 驗證Basic認證（用於WebDAV）
   */
  async validateBasicAuth(token) {
    const credentials = this.decodeBasicCredentials(token);
    if (!credentials) {
      return new AuthResult();
    }

    const separatorIndex = credentials.indexOf(":");
    if (separatorIndex === -1) {
      return new AuthResult();
    }

    const username = credentials.slice(0, separatorIndex);
    const password = credentials.slice(separatorIndex + 1);
    if (!username || !password) {
      return new AuthResult();
    }

    const adminResult = await this.authenticateBasicAdmin(username, password);
    if (adminResult) {
      return adminResult;
    }

    const apiKeyResult = await this.authenticateBasicApiKey(username, password);
    if (apiKeyResult) {
      return apiKeyResult;
    }

    return new AuthResult();
  }

  decodeBasicCredentials(token) {
    if (!token || typeof token !== "string") {
      return null;
    }

    const normalized = token.trim();
    if (!normalized) {
      return null;
    }

    const decoded = Buffer.from(normalized, "base64").toString("utf-8");
    return decoded || null;
  }

  async authenticateBasicAdmin(username, password) {
    const adminRepository = this.repositoryFactory.getAdminRepository();
    const adminRecord = await adminRepository.findByUsername(username);

    if (adminRecord && (await verifyPassword(password, adminRecord.password))) {
      return new AuthResult({
        isAuthenticated: true,
        userId: adminRecord.id,
        permissions: 0,
        isAdmin: true,
      });
    }

    return null;
  }

  async authenticateBasicApiKey(username, password) {
    if (username !== password) {
      return null;
    }

    const apiKeyRepository = this.repositoryFactory.getApiKeyRepository();
    const keyRecord = await apiKeyRepository.findByKey(username);
    if (!keyRecord) {
      return null;
    }

    const hasWebDAVPermission = PermissionChecker.hasPermission(keyRecord.permissions || 0, Permission.WEBDAV_READ);
    if (!hasWebDAVPermission) {
      return null;
    }

    if (await checkAndDeleteExpiredApiKey(this.db, keyRecord, this.repositoryFactory)) {
      return null;
    }

    await apiKeyRepository.updateLastUsed(keyRecord.id);
    return this.buildApiKeyAuthResult(keyRecord);
  }

  buildApiKeyAuthResult(keyRecord) {
    const isEnabled = typeof keyRecord.is_enable === "number" ? keyRecord.is_enable === 1 : Boolean(keyRecord.is_enable);
    if (!isEnabled) {
      return new AuthResult();
    }

    return new AuthResult({
      isAuthenticated: true,
      userId: keyRecord.id,
      permissions: keyRecord.permissions || 0,
      basicPath: keyRecord.basic_path || "/",
      keyInfo: {
        id: keyRecord.id,
        name: keyRecord.name,
        key: keyRecord.key,
        basicPath: keyRecord.basic_path || "/",
        permissions: keyRecord.permissions || 0,
        role: keyRecord.role || "GENERAL",
        isGuest: (keyRecord.role || "GENERAL") === "GUEST",
        isEnabled,
      },
    });
  }


  /**
   * 統一認證方法
   * 閘道器需要的核心方法
   */
  async authenticate(authHeader) {
    const { type, token } = this.parseAuthHeader(authHeader);

    if (!type || !token) {
      return new AuthResult();
    }

    let result;
    switch (type) {
      case "bearer":
        result = await this.validateAdminAuth(token);
        break;
      case "apikey":
        result = await this.validateApiKeyAuth(token);
        break;
      case "basic":
        result = await this.validateBasicAuth(token);
        break;
      default:
        result = new AuthResult();
    }

    return result;
  }

  /**
   * 檢查路徑許可權
   * 閘道器需要的核心方法
   */
  checkPathPermission(authResult, requestPath) {
    if (!authResult.isAuthenticated) {
      return false;
    }

    // 管理員有所有路徑許可權
    if (authResult.isAdmin()) {
      return true;
    }

    // API金鑰檢查基礎路徑許可權
    const basicPath = authResult.basicPath || "/";
    return this.checkBasicPathPermission(basicPath, requestPath);
  }

  /**
   * 檢查基礎路徑許可權
   */
  checkBasicPathPermission(basicPath, requestPath) {
    if (!basicPath || !requestPath) {
      return false;
    }

    // 標準化路徑
    const normalizeBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
    const normalizeRequestPath = requestPath.replace(/\/+$/, "") || "/";

    // 如果基本路徑是根路徑，允許所有訪問
    if (normalizeBasicPath === "/") {
      return true;
    }

    // 檢查請求路徑是否在基本路徑範圍內
    return normalizeRequestPath === normalizeBasicPath || normalizeRequestPath.startsWith(normalizeBasicPath + "/");
  }
}

/**
 * 建立認證服務例項
 */
export function createAuthService(db, repositoryFactory = null) {
  return new AuthService(db, repositoryFactory);
}
