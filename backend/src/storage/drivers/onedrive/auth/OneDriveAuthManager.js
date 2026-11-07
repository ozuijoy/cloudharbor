/**
 * OneDriveAuthManager
 *
 * OneDrive OAuth 2.0 認證管理器
 * - 負責 access token 的快取與重新整理
 * - 支援 refresh_token 模式（v1 首版）
 * - 支援外部 token 續期端點（可選）
 *
 * Token 管理邊界：
 * - 驅動內部負責 access token 的快取與重新整理
 * - refresh_token / clientId / clientSecret 等敏感配置由儲存配置表提供
 * - 驅動只消費配置，不自行持久化使用者憑據
 */

import { DriverError } from "../../../../http/errors.js";

/**
 * 區域到 OAuth 端點的對映
 * - 僅供 OneDriveAuthManager 內部使用
 */
const OAUTH_ENDPOINTS = {
  global: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  cn: "https://login.chinacloudapi.cn/common/oauth2/v2.0/token",
  us: "https://login.microsoftonline.us/common/oauth2/v2.0/token",
  de: "https://login.microsoftonline.de/common/oauth2/v2.0/token",
};

export class OneDriveAuthManager {
  /**
   * @param {Object} config 認證配置
   * @param {string} config.region 區域（global/cn/us/de）
   * @param {string} config.clientId 應用客戶端 ID
   * @param {string} config.clientSecret 應用客戶端金鑰
   * @param {string} config.refreshToken 重新整理令牌
   * @param {string} [config.tokenRenewEndpoint] 自定義 token 續期端點（可選）
   * @param {string} [config.redirectUri] OAuth 回撥地址（可選）
   * @param {boolean} [config.useOnlineApi] 是否使用 Online API 協議呼叫續期端點（可選）
   */
  constructor(config) {
    this.region = config.region || "global";
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.tokenRenewEndpoint = config.tokenRenewEndpoint || null;
    this.redirectUri = config.redirectUri || null;
    this.useOnlineApi = Boolean(config.useOnlineApi);

    // 記憶體快取
    this.accessToken = null;
    this.tokenExpiresAt = null;

    // 驗證必填配置：
    // - refresh_token 始終必填（無論走微軟 OAuth 還是走自建續期服務，都需要 refresh_token）
    // - useOnlineApi=true：必須配置 tokenRenewEndpoint（外部續期服務）
    // - useOnlineApi=false：必須配置 clientId（走微軟 OAuth 端點；clientSecret 可選，取決於你的 Azure 應用型別）
    if (!this.refreshToken) {
      throw new DriverError("OneDrive 認證配置缺少 refreshToken", { status: 400 });
    }
    if (this.useOnlineApi) {
      if (!this.tokenRenewEndpoint) {
        throw new DriverError("OneDrive 認證配置缺少 tokenRenewEndpoint（已啟用 useOnlineApi）", { status: 400 });
      }
    } else {
      if (!this.clientId) {
        throw new DriverError("OneDrive 認證配置缺少 clientId（未啟用 useOnlineApi 時必填）", { status: 400 });
      }
    }
  }

  /**
   * 獲取有效的 access token
   * - 優先使用記憶體快取
   * - 失效時自動重新整理
   * @returns {Promise<string>} access token
   */
  async getAccessToken() {
    // 檢查快取是否有效（提前 5 分鐘重新整理）
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 分鐘緩衝

    if (this.accessToken && this.tokenExpiresAt && (this.tokenExpiresAt - bufferMs) > now) {
      return this.accessToken;
    }

    // 重新整理 token
    await this.refreshAccessToken();
    return this.accessToken;
  }

  /**
   * 重新整理 access token
   * - 使用 refresh_token 或自定義端點
   */
  async refreshAccessToken() {
    try {
      let tokenResponse;

      // 分支策略：
      // - 當顯式啟用 useOnlineApi 且配置了 tokenRenewEndpoint 時，走外部 Online API 續期端點
      // - 其他情況一律走微軟官方 OAuth 端點（即便仍然配置了 tokenRenewEndpoint，也不使用）
      if (this.useOnlineApi && this.tokenRenewEndpoint) {
        // 使用外部 token 續期端點（Online API 協議）
        tokenResponse = await this._fetchFromCustomEndpoint();
      } else {
        // 使用微軟 OAuth 端點
        tokenResponse = await this._fetchFromMicrosoftEndpoint();
      }

      // 更新快取
      this.accessToken = tokenResponse.access_token;
      const expiresIn = tokenResponse.expires_in || 3600; // 預設 1 小時
      this.tokenExpiresAt = Date.now() + expiresIn * 1000;

      // 如果返回了新的 refresh_token，更新記憶體中的值
      // 注意：持久化到資料庫的責任在上層服務，驅動不直接寫資料庫
      if (tokenResponse.refresh_token) {
        this.refreshToken = tokenResponse.refresh_token;
      }
    } catch (error) {
      // 清除快取
      this.accessToken = null;
      this.tokenExpiresAt = null;

      throw new DriverError(`OneDrive token 重新整理失敗: ${error.message}`, {
        status: 500,
        cause: error,
        details: { region: this.region },
      });
    }
  }

  /**
   * 從微軟 OAuth 端點獲取 token
   * @private
   */
  async _fetchFromMicrosoftEndpoint() {
    const tokenUrl = OAUTH_ENDPOINTS[this.region] || OAUTH_ENDPOINTS.global;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret || "",
      refresh_token: this.refreshToken,
    });

    if (this.redirectUri) {
      body.set("redirect_uri", this.redirectUri);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error_description || errorData.error || response.statusText;
      throw new Error(`Microsoft OAuth 錯誤: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * 從自定義端點獲取 token
   * @private
   */
  async _fetchFromCustomEndpoint() {
    if (!this.tokenRenewEndpoint) {
      throw new Error("未配置自定義 token 續期端點");
    }

    // Online API 模式：使用 GET + refresh_ui 協議
    if (this.useOnlineApi) {
      if (!this.refreshToken) {
        throw new Error("缺少 refresh_token，無法呼叫 Online API 續期服務");
      }

      let renewUrl;
      try {
        renewUrl = new URL(this.tokenRenewEndpoint);
      } catch {
        throw new Error("token_renew_endpoint 不是合法的 URL");
      }

      renewUrl.searchParams.set("refresh_ui", this.refreshToken);
      renewUrl.searchParams.set("server_use", "true");
      renewUrl.searchParams.set("driver_txt", "onedrive_pr");

      const response = await fetch(renewUrl.toString(), {
        method: "GET",
        headers: {
          // 保留簡單 UA，方便後端識別來源（不會暴露敏感資訊）
          "User-Agent": "CloudHarbor-OneDriveDriver",
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          data.text || data.error || data.message || response.statusText || "Online API 請求失敗";
        throw new Error(`Online API 重新整理失敗: ${errorMessage}`);
      }

      const accessToken = data.access_token || data.AccessToken;
      const refreshToken = data.refresh_token || data.RefreshToken;
      const expiresIn = data.expires_in || data.ExpiryTime || data.expiryTime;

      if (!accessToken) {
        const errorMessage = data.text || data.error || "Online API 返回的資料缺少 access_token";
        throw new Error(`Online API 資料無效: ${errorMessage}`);
      }

      const normalized = {
        access_token: accessToken,
      };
      if (typeof expiresIn === "number") {
        normalized.expires_in = expiresIn;
      }
      if (refreshToken) {
        normalized.refresh_token = refreshToken;
      }

      return normalized;
    }

    // 通用 JSON 模式：相容自建 token 續期服務
    const payload = {};
    if (this.clientId) {
      payload.client_id = this.clientId;
    }
    if (this.refreshToken) {
      payload.refresh_token = this.refreshToken;
    }

    const response = await fetch(this.tokenRenewEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || data.message || response.statusText || "自定義 token 端點請求失敗";
      throw new Error(`自定義 token 端點錯誤: ${errorMessage}`);
    }

    if (!data.access_token) {
      throw new Error("自定義 token 端點返回的資料缺少 access_token");
    }

    return data;
  }

  /**
   * 獲取當前 token 狀態（用於除錯）
   */
  getTokenStatus() {
    return {
      hasAccessToken: !!this.accessToken,
      expiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      isExpired: this.tokenExpiresAt ? Date.now() > this.tokenExpiresAt : true,
      region: this.region,
      useCustomEndpoint: !!this.tokenRenewEndpoint,
    };
  }
}
