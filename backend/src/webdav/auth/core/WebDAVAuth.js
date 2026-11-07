/**
 * WebDAV認證核心
 */

import { MountManager } from "../../../storage/managers/MountManager.js";
import { UserType } from "../../../constants/index.js";
import { processWebDAVPath } from "../../utils/webdavUtils.js";
import { getAccessibleMountsForUser } from "../../../security/helpers/access.js";
import { isVirtualPath } from "../../../storage/fs/utils/VirtualDirectory.js";

/**
 * WebDAVAuth 只負責協議層相容（Basic Challenge + 路徑驗權），
 * 具體的讀/寫授權交由 webdavRoutes 中的策略完成。
 */

/**
 * 認證結果型別列舉
 */
export const AuthResultType = {
  SUCCESS: "success",
  CHALLENGE: "challenge",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  ERROR: "error",
};

/**
 * WebDAV認證核心類
 */
export class WebDAVAuth {
  constructor(db) {
    this.db = db;
  }

  /**
   * 驗證WebDAV路徑許可權
   * 檢查API金鑰使用者是否有許可權訪問指定路徑
   * @param {Object} keyInfo - API金鑰資訊
   * @param {string} path - 請求路徑
   * @param {string} method - HTTP方法
   * @param {Object} c - Hono上下文
   * @returns {Promise<boolean>} 是否有許可權
   */
  async validateWebDAVPathPermission(keyInfo, path, method, c) {
    try {
      // 1. 檢查基礎路徑許可權
      const basicPath = keyInfo.basicPath || "/";
      if (!this.checkBasicPathPermission(basicPath, path)) {
        console.log(`WebDAV基礎路徑許可權檢查失敗: basicPath=${basicPath}, requestPath=${path}`);
        return false;
      }

      const repositoryFactory = c.get("repos");
      const accessibleMounts = await getAccessibleMountsForUser(this.db, keyInfo, "apiKey", repositoryFactory);

      // 2. 虛擬路徑（根目錄 / 以及不直接落在具體掛載點上的中間目錄）：。
      if (isVirtualPath(path, accessibleMounts)) {
        console.log(`WebDAV虛擬路徑訪問允許: basicPath=${basicPath}, requestPath=${path}`);
        return true;
      }

      // 3. 實際儲存路徑：保持原有掛載點 + 儲存 ACL 校驗邏輯，
      const { getEncryptionSecret } = await import("../../../utils/environmentUtils.js");
      const mountManager = new MountManager(this.db, getEncryptionSecret(c), repositoryFactory, { env: c.env });

      try {
        await mountManager.getDriverByPath(path, keyInfo, "apiKey");
        return true;
      } catch (mountError) {
        console.log(`WebDAV掛載點檢查失敗: ${mountError.message}`);
        return false;
      }
    } catch (error) {
      console.error("WebDAV路徑許可權檢查失敗:", error);
      return false;
    }
  }

  /**
   * 檢查基礎路徑許可權
   * @param {string} basicPath - 使用者的基礎路徑
   * @param {string} requestPath - 請求的路徑
   * @returns {boolean} 是否有許可權
   */
  checkBasicPathPermission(basicPath, requestPath) {
    if (!basicPath || basicPath === "/") {
      return true; // 根路徑許可權
    }

    // 規範化路徑
    const normalizedBasicPath = basicPath.endsWith("/") ? basicPath : basicPath + "/";
    const normalizedRequestPath = requestPath.startsWith("/") ? requestPath : "/" + requestPath;

    // 檢查請求路徑是否在基礎路徑範圍內
    return normalizedRequestPath.startsWith(normalizedBasicPath) || normalizedRequestPath === basicPath;
  }

  /**
   * 生成認證挑戰 - 符合RFC 4918 WebDAV標準
   * 傳送Basic認證挑戰
   * @returns {Object} 認證挑戰結果
   */
  generateAuthChallenge() {
    return {
      type: AuthResultType.CHALLENGE,
      message: "需要認證",
      headers: {
        "WWW-Authenticate": 'Basic realm="WebDAV"',
      },
    };
  }

  /**
   * 建立中介軟體
   * @returns {Function} 中介軟體函式
   */
  createMiddleware() {
    return async (c, next) => {
      try {
        // 獲取並處理請求路徑
        const url = new URL(c.req.url);
        const rawPath = url.pathname;
        let requestPath = this.processPath(rawPath);
        c.set("webdavPath", requestPath);

        // OPTIONS 方法特殊處理 - 允許未認證訪問進行能力發現
        if (c.req.method === "OPTIONS") {
          // 直接跳過認證，不設定使用者型別（保持undefined狀態）
          return await next();
        }

        // 統一認證處理
        const authResult = await this.performUnifiedAuth(c, requestPath);

        if (authResult.type === AuthResultType.SUCCESS) {
          c.set("userType", authResult.userType);
          c.set("userId", authResult.userId);
          return await next();
        } else if (authResult.type === AuthResultType.CHALLENGE) {
          // 返回認證挑戰
          return new Response("Unauthorized", {
            status: 401,
            headers: authResult.headers,
          });
        } else {
          // 認證失敗
          return new Response(authResult.message, {
            status: authResult.type === AuthResultType.FORBIDDEN ? 403 : 401,
          });
        }
      } catch (error) {
        console.error("WebDAV中介軟體錯誤:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    };
  }

  /**
   * 統一路徑處理 - 使用統一的路徑處理函式
   * @param {string} rawPath - 原始路徑
   * @returns {string} 處理後的路徑
   */
  processPath(rawPath) {
    const processedPath = processWebDAVPath(rawPath, false);
    return processedPath || rawPath; // 如果處理失敗，返回原始路徑
  }

  /**
   * 統一認證處理
   * @param {Object} c - Hono上下文
   * @param {string} requestPath - 請求路徑
   * @returns {Promise<Object>} 認證結果
   */
  async performUnifiedAuth(c, requestPath) {
    try {
      const principal = c.get("principal");
      if (!principal || principal.type === "anonymous") {
        return this.generateAuthChallenge();
      }

      const userType = principal.isAdmin ? UserType.ADMIN : principal.type;
      if (userType !== UserType.ADMIN && userType !== UserType.API_KEY) {
        return {
          type: AuthResultType.FORBIDDEN,
          message: "不支援的身份型別",
        };
      }

      let apiKeyInfo = null;
      if (userType === UserType.API_KEY) {
        apiKeyInfo = principal.attributes?.keyInfo ?? null;
        if (!apiKeyInfo) {
          return {
            type: AuthResultType.ERROR,
            message: "API金鑰資訊缺失",
          };
        }

        const hasPathPermission = await this.validateWebDAVPathPermission(apiKeyInfo, requestPath, c.req.method, c);
        if (!hasPathPermission) {
          return {
            type: AuthResultType.FORBIDDEN,
            message: "路徑許可權不足",
          };
        }
      }

      return {
        type: AuthResultType.SUCCESS,
        userType,
        userId: userType === UserType.ADMIN ? principal.id : apiKeyInfo,
      };
    } catch (error) {
      console.error("WebDAV統一認證錯誤:", error);
      return {
        type: AuthResultType.ERROR,
        message: "認證失敗",
      };
    }
  }
}

/**
 * 建立WebDAV認證例項
 * @param {D1Database} db - 資料庫例項
 * @returns {WebDAVAuth} 認證例項
 */
export function createWebDAVAuth(db) {
  return new WebDAVAuth(db);
}
