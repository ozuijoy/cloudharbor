import crypto from "crypto";
import { ensureRepositoryFactory } from "../utils/repositories.js";

/**
 * 代理簽名服務
 * 支援兩層簽名策略：
 * - 全域性簽名所有：proxy_sign_all = true 時，所有代理流量都啟用簽名（與掛載配置無關）
 * - 掛載級簽名：enable_sign = true 且掛載開啟 web_proxy 時，對該掛載下的代理流量啟用簽名
 */
export class ProxySignatureService {
  constructor(db, encryptionSecret, repositoryFactory = null) {
    this.db = db;
    this.secret = encryptionSecret;
    this.configCache = new Map(); // 配置快取

    const factory = ensureRepositoryFactory(db, repositoryFactory);
    this.systemRepository = factory.getSystemRepository();
  }

  /**
   * 是否啟用了“全域性簽名所有”
   * - 這是“強制模式”：一旦開啟，就認為所有代理簽名策略都應以全域性配置為準
   * @returns {Promise<boolean>}
   */
  async isGlobalSignAllEnabled() {
    const signAll = await this._getSystemSetting("proxy_sign_all");
    return signAll === "true";
  }

  /**
   * 判斷掛載點是否需要簽名
   * @param {Object} mount - 掛載點配置
   * @returns {Promise<Object>} 簽名需求結果
   */
  async needsSignature(mount) {
    // 1. 檢查全域性"簽名所有"設定
    if (await this.isGlobalSignAllEnabled()) {
      return {
        required: true,
        reason: "sign_all_enabled",
        level: "global",
        description: "全域性簽名所有已啟用",
      };
    }

    // 2. 掛載資訊缺失時，不啟用掛載級簽名（僅全域性策略生效）
    if (!mount || typeof mount !== "object") {
      return {
        required: false,
        reason: "mount_not_provided",
        level: "none",
        description: "未提供掛載配置，僅全域性簽名策略有效",
      };
    }

    // 3. 僅在掛載開啟 web_proxy 時才允許掛載級簽名生效
    const webProxyEnabled = mount.web_proxy === 1 || mount.web_proxy === true;
    if (!webProxyEnabled) {
      return {
        required: false,
        reason: "web_proxy_disabled",
        level: "none",
        description: "掛載未開啟 web_proxy，忽略掛載級簽名配置",
      };
    }

    // 4. 檢查掛載級別的簽名設定
    if (mount.enable_sign === 1 || mount.enable_sign === true) {
      return {
        required: true,
        reason: "storage_sign_enabled",
        level: "storage",
        description: "儲存啟用簽名",
      };
    }

    // 5. 不需要簽名
    return {
      required: false,
      reason: "no_sign_required",
      level: "none",
      description: "無簽名要求",
    };
  }

  /**
   * 獲取簽名過期時間
   * @param {Object} mount - 掛載點配置
   * @param {{ signAllEnabled?: boolean }} [options] - 可選：外部可傳入 signAllEnabled 避免重複讀配置
   * @returns {Promise<number>} 過期時間（秒），0表示永不過期
   */
  async getSignatureExpiration(mount, options = {}) {
    const signAllEnabled = typeof options.signAllEnabled === "boolean" ? options.signAllEnabled : await this.isGlobalSignAllEnabled();

    // 強制模式：全域性 sign_all 開啟時，過期時間也應統一由全域性 proxy_sign_expires 決定（不允許掛載覆蓋）
    if (signAllEnabled) {
      const globalExpires = await this._getSystemSetting("proxy_sign_expires");
      return parseInt(globalExpires) || 0;
    }

    // 非強制模式：掛載點可覆蓋過期時間（NULL 表示使用全域性設定）
    if (mount && mount.sign_expires !== null && mount.sign_expires !== undefined) {
      return mount.sign_expires;
    }

    const globalExpires = await this._getSystemSetting("proxy_sign_expires");
    return parseInt(globalExpires) || 0;
  }

  /**
   * 生成簽名
   * @param {string} path - 檔案路徑
   * @param {Object} mount - 掛載點配置
   * @param {Object} options - 額外選項
   * @returns {Promise<Object>} 簽名資訊
   */
  async generateStorageSignature(path, mount, options = {}) {
    // 強制模式：全域性 sign_all 開啟時，過期時間統一以全域性為準
    const signAllEnabled = await this.isGlobalSignAllEnabled();
    const configuredExpiresIn = await this.getSignatureExpiration(mount, { signAllEnabled });

    let expiresIn = configuredExpiresIn;
    if (options.expiresIn !== undefined && options.expiresIn !== null) {
      const requested = Number(options.expiresIn);
      if (!Number.isNaN(requested) && requested >= 0) {
        if (!signAllEnabled) {
          expiresIn = requested;
        } else if (configuredExpiresIn === 0) {
          // 全域性永不過期時：允許按需生成短期簽名
          expiresIn = requested;
        } else {
          // 全域性有上限時：不允許超過全域性上限
          expiresIn = Math.min(requested, configuredExpiresIn);
        }
      }
    }

    // 0表示永不過期
    const expireTimestamp = expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : 0;

    // 生成簽名資料：路徑 + 過期時間戳
    const signData = `${path}:${expireTimestamp}`;

    // 使用HMAC-SHA256生成簽名
    const hmac = crypto.createHmac("sha256", this.secret);
    hmac.update(signData);
    const hash = hmac.digest("base64");

    return {
      signature: `${hash}:${expireTimestamp}`,
      requestTimestamp: Date.now(),
      expiresAt: expireTimestamp,
      expiresIn: expiresIn,
      isTemporary: expireTimestamp > 0,
    };
  }

  /**
   * 驗證簽名
   * @param {string} path - 檔案路徑
   * @param {string} signature - 簽名值
   * @returns {Object} 驗證結果
   */
  verifyStorageSignature(path, signature, options = {}) {
    try {
      const [hash, timestampStr] = signature.split(":");
      const expireTimestamp = parseInt(timestampStr);

      // 檢查簽名是否過期（0表示永不過期）
      if (expireTimestamp > 0 && Math.floor(Date.now() / 1000) > expireTimestamp) {
        return {
          valid: false,
          reason: "signature_expired",
          expiredAt: expireTimestamp,
        };
      }

      // 重新生成簽名進行比較
      const signData = `${path}:${expireTimestamp}`;
      const hmac = crypto.createHmac("sha256", this.secret);
      hmac.update(signData);
      const expectedHash = hmac.digest("base64");

      const isValid = hash === expectedHash;
      return {
        valid: isValid,
        reason: isValid ? "valid" : "invalid_signature",
        expireTimestamp,
      };
    } catch (error) {
      return {
        valid: false,
        reason: "malformed_signature",
        error: error.message,
      };
    }
  }

  /**
   * 獲取系統設定（帶快取）
   * @param {string} key - 設定鍵
   * @returns {Promise<string>} 設定值
   */
  async _getSystemSetting(key) {
    const cacheKey = `setting_${key}`;

    // 檢查快取
    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey);
    }

    try {
      const setting = await this.systemRepository.getSettingMetadata(key);
      const value = setting ? setting.value : "";

      // 快取5分鐘
      this.configCache.set(cacheKey, value);
      setTimeout(() => this.configCache.delete(cacheKey), 5 * 60 * 1000);

      return value;
    } catch (error) {
      console.error(`獲取系統設定 ${key} 失敗:`, error);
      return "";
    }
  }

  /**
   * 清除配置快取
   */
  clearCache() {
    this.configCache.clear();
  }

  /**
   * 獲取全域性簽名配置（用於管理介面）
   * @returns {Promise<Object>} 全域性配置
   */
  async getGlobalSignConfig() {
    return await this.systemRepository.getProxySignConfig();
  }

  /**
   * 更新全域性簽名配置
   * @param {Object} config - 配置物件
   * @returns {Promise<void>}
   */
  async updateGlobalSignConfig(config) {
    await this.systemRepository.updateProxySignConfig(config);

    // 清除快取
    this.clearCache();
  }
}
