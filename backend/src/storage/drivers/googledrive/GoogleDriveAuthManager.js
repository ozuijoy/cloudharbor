/**
 * GoogleDriveAuthManager
 *
 * Google Drive 認證管理器，負責根據儲存配置獲取與重新整理 access_token：
 * - 線上 API 模式（use_online_api = true）：調外部 endpoint_url 換取 access_token/refresh_token
 * - Service Account 模式（refresh_token 為遠端 URL）：解析遠端 service account JSON，使用 JWT 換取 access_token
 * - 標準 refresh_token 模式：使用 client_id/client_secret/refresh_token 呼叫 OAuth2 token 介面
 *
 */

import crypto from "crypto";
import { DriverError } from "../../../http/errors.js";

const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * 簡單 HTTP 請求工具
 * - 為保持 KISS，當前直接使用全域性 fetch（Cloudflare/Node 均可），如需更復雜能力可後續抽象
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<{ status: number, json: any, raw: Response }>}
 */
async function httpRequestJson(url, options = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, json: data, raw: res };
}

/**
 * 生成 Service Account JWT（RS256）
 * 僅在 Node.js 環境下可用
 * @param {{ client_email: string, private_key: string, token_uri: string, scope?: string }} sa
 * @param {string[]} scopes
 */
function createServiceAccountJwt(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export class GoogleDriveAuthManager {
  /**
   * @param {{
   *   useOnlineApi: boolean,
   *   apiAddress?: string,
   *   clientId?: string,
   *   clientSecret?: string,
   *   refreshToken?: string,
   *   rootId?: string,
   *   disableDiskUsage?: boolean,
   *   scopes?: string[],
   *   logger?: Console,
   *   persistRefreshToken?: (newToken: string) => Promise<void> | void
   * }} options
   */
  constructor(options) {
    this.useOnlineApi = Boolean(options.useOnlineApi);
    this.apiAddress = options.apiAddress || null;
    this.clientId = options.clientId || null;
    this.clientSecret = options.clientSecret || null;
    this.refreshToken = options.refreshToken || "";
    this.rootId = options.rootId || "root";
    this.disableDiskUsage = Boolean(options.disableDiskUsage);
    this.scopes = Array.isArray(options.scopes) && options.scopes.length > 0
      ? options.scopes
      : ["https://www.googleapis.com/auth/drive"];
    this.logger = options.logger || console;
    this.persistRefreshToken = typeof options.persistRefreshToken === "function" ? options.persistRefreshToken : null;

    /** @type {string | null} */
    this.currentAccessToken = null;
    /** @type {number | null} 過期時間戳（秒） */
    this.accessTokenExpiresAt = null;

    /** @type {Array<{ client_email: string, private_key: string, token_uri: string }>} */
    this.serviceAccounts = [];
    this.serviceAccountIndex = 0;
    this.initialized = false;
  }

  /**
   * 初始化認證管理器（懶載入 Service Account JSON 等）
   */
  async initialize() {
    if (this.initialized) return;

    if (this.useOnlineApi) {
      if (!this.apiAddress || !this.refreshToken) {
        throw new DriverError("GoogleDriveAuthManager 配置錯誤：線上 API 模式需要 endpoint_url 與 refresh_token", {
          code: "DRIVER_ERROR.GDRIVE_AUTH_CONFIG",
        });
      }
      this.initialized = true;
      return;
    }

    // Service Account 遠端 URL 模式
    if (isHttpUrl(this.refreshToken)) {
      // 遠端 JSON URL：此處僅記錄 URL，實際獲取放在請求時
      this.initialized = true;
      return;
    }

    // 標準 refresh_token 模式：需要 clientId/clientSecret/refreshToken
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new DriverError("GoogleDriveAuthManager 配置錯誤：標準 refresh_token 模式需要 client_id/client_secret/refresh_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_CONFIG",
      });
    }

    this.initialized = true;
  }

  /**
   * 獲取當前可用 access_token（必要時重新整理）
   */
  async getAccessToken() {
    await this.initialize();

    const now = Math.floor(Date.now() / 1000);
    if (this.currentAccessToken && this.accessTokenExpiresAt && this.accessTokenExpiresAt - now > 60) {
      return this.currentAccessToken;
    }

    // 根據模式重新整理 token
    if (this.useOnlineApi) {
      await this._refreshViaOnlineApi();
    } else if (isHttpUrl(this.refreshToken)) {
      await this._refreshViaServiceAccount();
    } else {
      await this._refreshViaRefreshToken();
    }

    if (!this.currentAccessToken) {
      throw new DriverError("GoogleDriveAuthManager 未能獲取有效的 access_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_NO_TOKEN",
      });
    }
    return this.currentAccessToken;
  }

  /**
   * 對外統一包裝：在回撥中注入 Authorization header，捕獲 401 並自動重新整理一次
   * @param {(token: string) => Promise<any>} fn
   */
  async withAccessToken(fn) {
    const token = await this.getAccessToken();
    try {
      return await fn(token);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status === 401) {
        // 嘗試重新整理一次後重試
        this.currentAccessToken = null;
        this.accessTokenExpiresAt = null;
        await this.getAccessToken();
        const retryToken = this.currentAccessToken;
        return await fn(retryToken);
      }
      throw error;
    }
  }

  async _refreshViaOnlineApi() {
    const url = new URL(this.apiAddress);
    url.searchParams.set("refresh_ui", this.refreshToken || "");
    url.searchParams.set("server_use", "true");
    url.searchParams.set("driver_txt", "googleui_go");

    const { status, json } = await httpRequestJson(url.toString(), {
      method: "GET",
    });

    if (status !== 200 || !json) {
      throw new DriverError("GoogleDriveAuthManager 線上 API 模式重新整理 token 失敗", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_ONLINE_API",
      });
    }

    const accessToken = json.access_token;
    const newRefreshToken = json.refresh_token || null;
    const expiresIn = json.expires_in || 3600;

    if (!accessToken) {
      throw new DriverError("線上 API 返回缺少 access_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_ONLINE_API_RESPONSE",
      });
    }

    this.currentAccessToken = accessToken;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    if (newRefreshToken && this.persistRefreshToken) {
      try {
        await this.persistRefreshToken(newRefreshToken);
      } catch (err) {
        this.logger.warn?.("[GoogleDriveAuthManager] 持久化 refresh_token 失敗，將繼續使用舊值");
      }
    }
  }

  async _refreshViaServiceAccount() {
    // 遠端 URL 情況：按需拉取 JSON（僅在 Node 或 Worker 中進行 HTTP 呼叫）
    if (isHttpUrl(this.refreshToken) && this.serviceAccounts.length === 0) {
      const { status, json } = await httpRequestJson(this.refreshToken, { method: "GET" });
      if (status !== 200 || !json) {
        throw new DriverError("無法從遠端 Service Account URL 獲取 JSON", {
          status,
          code: "DRIVER_ERROR.GDRIVE_AUTH_SA_REMOTE",
        });
      }
      const parsed = Array.isArray(json) ? json : [json];
      this.serviceAccounts = parsed
        .map((sa) => ({
          client_email: sa.client_email,
          private_key: sa.private_key,
          token_uri: sa.token_uri || OAUTH_TOKEN_ENDPOINT,
        }))
        .filter((sa) => sa.client_email && sa.private_key);
      if (this.serviceAccounts.length === 0) {
        throw new DriverError("遠端 Service Account JSON 不包含有效憑證", {
          code: "DRIVER_ERROR.GDRIVE_AUTH_SA_REMOTE_EMPTY",
        });
      }
    }

    if (this.serviceAccounts.length === 0) {
      throw new DriverError("Service Account 模式下未載入任何憑證", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_SA_EMPTY",
      });
    }

    // 簡單輪詢下一條 Service Account 記錄
    const sa = this.serviceAccounts[this.serviceAccountIndex % this.serviceAccounts.length];
    this.serviceAccountIndex = (this.serviceAccountIndex + 1) % this.serviceAccounts.length;

    const assertion = createServiceAccountJwt(sa, this.scopes);
    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", assertion);

    const { status, json } = await httpRequestJson(sa.token_uri || OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (status !== 200 || !json || !json.access_token) {
      throw new DriverError("Service Account 模式重新整理 access_token 失敗", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_SA_TOKEN",
      });
    }

    this.currentAccessToken = json.access_token;
    const expiresIn = json.expires_in || 3600;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  }

  async _refreshViaRefreshToken() {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("refresh_token", this.refreshToken);

    const { status, json } = await httpRequestJson(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (status !== 200 || !json || !json.access_token) {
      // 記錄詳細錯誤資訊，便於排查配置問題（invalid_grant/invalid_client 等）
      try {
        this.logger.error?.("[GoogleDriveAuthManager] refresh_token 流程失敗", {
          status,
          error: json?.error,
          error_description: json?.error_description,
        });
      } catch {}

      throw new DriverError("標準 refresh_token 模式重新整理 access_token 失敗", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_TOKEN",
        details: {
          status,
          error: json?.error,
          error_description: json?.error_description,
        },
      });
    }

    this.currentAccessToken = json.access_token;
    const expiresIn = json.expires_in || 3600;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    if (json.refresh_token && this.persistRefreshToken) {
      try {
        await this.persistRefreshToken(json.refresh_token);
      } catch (err) {
        this.logger.warn?.("[GoogleDriveAuthManager] 持久化 refresh_token 失敗，將繼續使用舊值");
      }
    }
  }
}
