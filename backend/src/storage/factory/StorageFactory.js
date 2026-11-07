/**
 * 儲存驅動工廠
 * - 透過 registerDriver(type, meta) 註冊驅動與tester
 * - createDriver 基於註冊資訊例項化
 * - validate/test 均可按驅動自定義實現
 */

import { S3StorageDriver } from "../drivers/s3/S3StorageDriver.js";
import { WebDavStorageDriver } from "../drivers/webdav/WebDavStorageDriver.js";
import { LocalStorageDriver } from "../drivers/local/LocalStorageDriver.js";
import { OneDriveStorageDriver } from "../drivers/onedrive/OneDriveStorageDriver.js";
import { GoogleDriveStorageDriver } from "../drivers/googledrive/GoogleDriveStorageDriver.js";
import { GithubReleasesStorageDriver } from "../drivers/github/GithubReleasesStorageDriver.js";
import { GithubApiStorageDriver } from "../drivers/github/GithubApiStorageDriver.js";
import { TelegramStorageDriver } from "../drivers/telegram/TelegramStorageDriver.js";
import { HuggingFaceDatasetsStorageDriver } from "../drivers/huggingface-datasets/HuggingFaceDatasetsStorageDriver.js";
import { MirrorStorageDriver } from "../drivers/mirror/MirrorStorageDriver.js";
import { DiscordStorageDriver } from "../drivers/discord/DiscordStorageDriver.js";
import { huggingFaceDatasetsTestConnection } from "../drivers/huggingface-datasets/tester/HuggingFaceDatasetsTester.js";
import { githubApiTestConnection } from "../drivers/github/tester/GithubApiTester.js";
import { githubReleasesTestConnection } from "../drivers/github/tester/GithubReleasesTester.js";
import { googleDriveTestConnection } from "../drivers/googledrive/tester/GoogleDriveTester.js";
import { telegramTestConnection } from "../drivers/telegram/tester/TelegramTester.js";
import { mirrorTestConnection } from "../drivers/mirror/tester/MirrorTester.js";
import { discordTestConnection } from "../drivers/discord/tester/DiscordTester.js";
import {
  CAPABILITIES,
  REQUIRED_METHODS_BY_CAPABILITY,
  BASE_REQUIRED_METHODS,
  getObjectCapabilities,
} from "../interfaces/capabilities/index.js";
import { ValidationError, NotFoundError, DriverContractError } from "../../http/errors.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment, toBool } from "../../utils/environmentUtils.js";
import { enforceDriverContract } from "./DriverContractEnforcer.js";

/**
 * 儲存驅動登錄檔
 * - key: storage_type (例如 'S3' / 'WEBDAV' / 'LOCAL')
 * - value: {
 *     ctor: Function,
 *     tester: Function|null,
 *     displayName: string,
 *     validate: Function|null,
 *     capabilities: string[],
 *     ui?: {
 *       icon?: string,
 *       i18nKey?: string,
 *     },
 *     configSchema?: {
 *       fields: Array<{
 *         name: string,
 *         type: 'string'|'boolean'|'number'|'enum'|'secret',
 *         required?: boolean,
 *         defaultValue?: any,
 *         labelKey?: string,
 *         descriptionKey?: string,
 *         enumValues?: Array<{ value: string, labelKey?: string }>,
 *         validation?: {
 *           rule?: 'url'|'abs_path',
 *         },
 *         ui?: {
 *           fullWidth?: boolean,
 *           placeholderKey?: string,
 *           descriptionKey?: string,
 *         },
 *       }>,
 *       layout?: {
 *         groups?: Array<{
 *           name: string,
 *           titleKey?: string,
 *           fields: Array<string | string[]>,  // string = full-width, string[] = side-by-side
 *         }>,
 *         summaryFields?: string[],
 *       },
 *     },
 *     providerOptions?: Array<{ value: string, labelKey?: string }>,
 *     configProjector?: Function,
 *   }
 */
const registry = new Map();

/**
 * 對驅動例項進行執行時契約校驗（型別 / 能力 / 方法實現）
 * - 依賴 registerDriver 時宣告的 capabilities 以及 REQUIRED_METHODS_BY_CAPABILITY 對映表
 * - 目標是儘早發現"驅動宣告的能力與實際實現不一致"的問題
 *
 * @param {any} driver - 已初始化的儲存驅動例項
 * @param {{ displayName?: string, capabilities?: string[] }} entryMeta - 註冊資訊
 * @param {string} storageType - 註冊時使用的儲存型別（例如 'S3' / 'WEBDAV'）
 */
function validateDriverContract(driver, entryMeta, storageType) {
  if (!driver || !entryMeta) {
    throw new DriverContractError("儲存驅動契約校驗失敗：驅動例項或註冊元資訊缺失", {
      details: { storageType },
    });
  }

  const registeredType = storageType;
  const registeredCapabilities = Array.isArray(entryMeta.capabilities) ? entryMeta.capabilities : [];

  const driverType = typeof driver.getType === "function" ? driver.getType() : driver.type;
  const rawCaps =
    typeof driver.getCapabilities === "function"
      ? driver.getCapabilities() || []
      : Array.isArray(driver.capabilities)
      ? driver.capabilities
      : [];

  const detectedCapabilities = getObjectCapabilities(driver);
  const driverCapabilities = Array.from(new Set(rawCaps.length ? rawCaps : detectedCapabilities));

  const extraCapabilities = driverCapabilities.filter((cap) => !registeredCapabilities.includes(cap));
  const missingRegisteredCapabilities = registeredCapabilities.filter((cap) => !driverCapabilities.includes(cap));

  /** @type {Array<{capability: string, method: string}>} */
  const missingMethods = [];
  const missingBaseMethods = [];

  // 校驗基礎契約（所有驅動必須實現）
  for (const methodName of BASE_REQUIRED_METHODS) {
    if (typeof driver[methodName] !== "function") {
      missingBaseMethods.push(methodName);
    }
  }

  // 僅針對"登錄檔與驅動都宣告"的能力進行方法級校驗
  const effectiveCapabilities = driverCapabilities.filter((cap) => registeredCapabilities.includes(cap));

  for (const cap of effectiveCapabilities) {
    const requiredMethods = REQUIRED_METHODS_BY_CAPABILITY[cap];
    if (!requiredMethods || requiredMethods.length === 0) continue;
    for (const methodName of requiredMethods) {
      if (typeof driver[methodName] !== "function") {
        missingMethods.push({ capability: cap, method: methodName });
      }
    }
  }

  const typeMismatch = driverType && registeredType && driverType !== registeredType;

  // extraCapabilities / missingRegisteredCapabilities 目前僅作為除錯資訊存在：
  // - 某些驅動（如基於 S3 的實現）會根據配置（custom_host 等）在例項上追加能力，這在型別層面是"額外能力"，
  //   但不會破壞既有行為，因而不視為致命錯誤。
  // - registeredCapabilities 描述的是該儲存型別在理想情況下支援的能力集合，具體例項可以是其子集。

  if (typeMismatch || missingBaseMethods.length > 0 || missingMethods.length > 0) {
    throw new DriverContractError("儲存驅動契約校驗失敗", {
      details: {
        storageType,
        registeredType,
        driverType,
        registeredCapabilities,
        driverCapabilities,
        detectedCapabilities,
        extraCapabilities,
        missingRegisteredCapabilities,
        missingBaseMethods,
        missingMethods,
      },
    });
  }
}

export class StorageFactory {
  static SUPPORTED_TYPES = {
    S3: "S3",
    WEBDAV: "WEBDAV",
    LOCAL: "LOCAL",
    ONEDRIVE: "ONEDRIVE",
    GOOGLE_DRIVE: "GOOGLE_DRIVE",
    GITHUB_RELEASES: "GITHUB_RELEASES",
    GITHUB_API: "GITHUB_API",
    TELEGRAM: "TELEGRAM",
    DISCORD: "DISCORD",
    HUGGINGFACE_DATASETS: "HUGGINGFACE_DATASETS",
    MIRROR: "MIRROR",
  };

  // 註冊驅動
  static registerDriver(
    type,
    {
      ctor,
      tester = null,
      displayName = null,
      validate = null,
      capabilities = [],
      ui = null,
      configSchema = null,
      providerOptions = null,
      configProjector = null,
    } = {},
  ) {
    if (!type || !ctor) throw new ValidationError("registerDriver 需要提供 type 和 ctor");
    const normalizedCapabilities = Array.isArray(capabilities) ? capabilities : [];
    if (normalizedCapabilities.length === 0) {
      throw new ValidationError(`registerDriver(${String(type)}) 必須宣告至少一個 capabilities（例如 READER/WRITER/PROXY/...）`);
    }
    registry.set(type, {
      ctor,
      tester,
      displayName: displayName || type,
      validate,
      capabilities: normalizedCapabilities,
      ui: ui || null,
      configSchema: configSchema || null,
      providerOptions: Array.isArray(providerOptions) ? providerOptions : null,
      configProjector: typeof configProjector === "function" ? configProjector : null,
    });
  }

  // 獲取tester
  static getTester(type) {
    return registry.get(type)?.tester || null;
  }

  // 能力查詢（基於註冊資訊）
  static getRegisteredCapabilities(type) {
    return registry.get(type)?.capabilities || [];
  }
  static supportsCapability(type, capability) {
    const caps = StorageFactory.getRegisteredCapabilities(type);
    return caps.includes(capability);
  }
  static supportsAllCapabilities(type, required = []) {
    const caps = StorageFactory.getRegisteredCapabilities(type);
    return required.every((c) => caps.includes(c));
  }

  // 建立驅動
  static async createDriver(storageType, config, encryptionSecret) {
    if (!storageType) throw new ValidationError("儲存型別不能為空");
    if (!config) throw new ValidationError("儲存配置不能為空");

    const entry = registry.get(storageType);
    if (entry) {
      const instance = new entry.ctor(config, encryptionSecret);
      await instance.initialize?.();
      // 在例項化完成後執行一次契約校驗，確保驅動 type / capabilities / 方法實現與註冊資訊一致
      validateDriverContract(instance, entry, storageType);
      return enforceDriverContract(instance, { storageType });
    }

    throw new NotFoundError(`不支援的儲存型別: ${storageType}`);
  }

  static getSupportedTypes() {
    const all = Array.from(registry.keys());
    // 在 Cloudflare Worker 或非 Node 環境下隱藏 LOCAL 型別
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      return all.filter((type) => type !== StorageFactory.SUPPORTED_TYPES.LOCAL);
    }
    return all;
  }

  static isTypeSupported(storageType) {
    return registry.has(storageType);
  }

  static getTypeDisplayName(storageType) {
    return registry.get(storageType)?.displayName || storageType;
  }

  /**
   * 獲取完整型別後設資料（用於前端動態表單等）
   * @param {string} storageType
   */
  static getTypeMetadata(storageType) {
    const entry = registry.get(storageType);
    if (!entry) return null;
    return {
      type: storageType,
      displayName: entry.displayName || storageType,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
      ui: entry.ui || null,
      configSchema: entry.configSchema || null,
      providerOptions: entry.providerOptions || null,
    };
  }

  /**
   * 獲取所有型別的後設資料列表
   * @returns {Array<object>}
   */
  static getAllTypeMetadata() {
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    const result = [];
    for (const [type, entry] of registry.entries()) {
      // 在 Cloudflare Worker 或非 Node 環境下不暴露 LOCAL 型別的後設資料
      if ((inWorker || !inNode) && type === StorageFactory.SUPPORTED_TYPES.LOCAL) {
        continue;
      }
      result.push({
        type,
        displayName: entry.displayName || type,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
        ui: entry.ui || null,
        configSchema: entry.configSchema || null,
        providerOptions: entry.providerOptions || null,
      });
    }
    return result;
  }

  static validateConfig(storageType, config) {
    const entry = registry.get(storageType);
    if (!entry) {
      return { valid: false, errors: [`不支援的儲存型別: ${storageType}`] };
    }
    if (typeof entry.validate === "function") {
      return entry.validate(config);
    }
    return { valid: true, errors: [] };
  }

  /**
   * 把 config_json 裡“schema 宣告為 bool/boolean”的欄位統一歸一化為 0/1
   *
   * @param {string} storageType
   * @param {object} cfg
   * @returns {object} 同一個物件（原地修改）
   */
  static coerceConfigJsonBooleans(storageType, cfg) {
    if (!cfg || typeof cfg !== "object") return cfg;
    const meta = StorageFactory.getTypeMetadata(storageType);
    const fields = meta?.configSchema?.fields;
    if (!Array.isArray(fields) || fields.length === 0) return cfg;

    for (const f of fields) {
      if (!f || typeof f !== "object") continue;
      const name = typeof f.name === "string" ? f.name : "";
      const type = typeof f.type === "string" ? f.type : "";
      if (!name) continue;
      if (type !== "bool" && type !== "boolean") continue;
      if (!Object.prototype.hasOwnProperty.call(cfg, name)) continue;

      const raw = cfg[name];
      if (raw === undefined || raw === null) continue;
      cfg[name] = toBool(raw, false) ? 1 : 0;
    }

    return cfg;
  }

  /**
   * 按 configSchema.defaultValue 補齊 config_json 缺失欄位
   * - 只補“欄位不存在”的情況（不覆蓋已有值）
   */
  static applyConfigJsonDefaultValues(storageType, cfg) {
    if (!cfg || typeof cfg !== "object") return cfg;
    const meta = StorageFactory.getTypeMetadata(storageType);
    const fields = meta?.configSchema?.fields;
    if (!Array.isArray(fields) || fields.length === 0) return cfg;

    for (const f of fields) {
      if (!f || typeof f !== "object") continue;
      const name = typeof f.name === "string" ? f.name : "";
      if (!name) continue;
      if (Object.prototype.hasOwnProperty.call(cfg, name)) continue;
      if (f.defaultValue === undefined) continue;
      cfg[name] = f.defaultValue;
    }

    return cfg;
  }

  /**
   * 使用登錄檔中的 configProjector 將 config_json 投影為驅動配置
   * @param {string} storageType - 儲存型別
   * @param {object} cfg - config_json 解析後的物件
   * @param {{ withSecrets?: boolean, row?: object }} options
   * @returns {object} 投影后的配置物件
   */
  static projectConfig(storageType, cfg, { withSecrets = false, row = null } = {}) {
    const entry = registry.get(storageType);
    const safeCfg = cfg && typeof cfg === "object" ? cfg : {};

    if (!entry) {
      console.warn(`StorageFactory.projectConfig: 未找到儲存型別註冊資訊: ${storageType}`);
      return { ...safeCfg };
    }

    StorageFactory.applyConfigJsonDefaultValues(storageType, safeCfg);
    StorageFactory.coerceConfigJsonBooleans(storageType, safeCfg);

    if (typeof entry.configProjector === "function") {
      const projected = entry.configProjector(safeCfg, { withSecrets, row });
      const out = projected && typeof projected === "object" ? { ...projected } : {};

      // 通用欄位：儲存容量限制（位元組）
      if (!Object.prototype.hasOwnProperty.call(out, "total_storage_bytes") &&
          Object.prototype.hasOwnProperty.call(safeCfg, "total_storage_bytes")) {
        out.total_storage_bytes = safeCfg.total_storage_bytes;
      }

      // 通用欄位：啟用配額讀取（只對支援的驅動有意義；這裡保證“回顯/讀取一致”）
      if (!Object.prototype.hasOwnProperty.call(out, "enable_disk_usage") &&
          Object.prototype.hasOwnProperty.call(safeCfg, "enable_disk_usage")) {
        out.enable_disk_usage = toBool(safeCfg.enable_disk_usage, false) ? 1 : 0;
      } else if (Object.prototype.hasOwnProperty.call(out, "enable_disk_usage")) {
        out.enable_disk_usage = toBool(out.enable_disk_usage, false) ? 1 : 0;
      }

      return out;
    }

    // 預設：直接返回 cfg 的淺複製，方便逐步遷移
    return { ...safeCfg };
  }

  static _validateS3Config(config) {
    const errors = [];
    const required = ["id", "name", "provider_type", "endpoint_url", "bucket_name", "access_key_id", "secret_access_key"];
    for (const f of required) if (!config[f]) errors.push(`S3配置缺少必填欄位: ${f}`);
    if (config.endpoint_url) {
      try {
        new URL(config.endpoint_url);
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }
    if (config.bucket_name && !/^[a-z0-9.-]+$/.test(config.bucket_name)) {
      errors.push("bucket_name 格式無效，只能包含小寫字母、數字、點和連字元");
    }
    return { valid: errors.length === 0, errors };
  }

  static _validateWebDavConfig(config) {
    const errors = [];
    if (!config.endpoint_url) errors.push("WebDAV配置缺少必填欄位: endpoint_url");
    if (!config.username) errors.push("WebDAV配置缺少必填欄位: username");
    if (!config.password) errors.push("WebDAV配置缺少必填欄位: password");

    if (config.endpoint_url) {
      try {
        const parsed = new URL(config.endpoint_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }

    if (config.default_folder) {
      const folder = config.default_folder.toString();
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static _validateLocalConfig(config) {
    const errors = [];

    const root = config?.root_path;
    if (!root) {
      errors.push("LOCAL 配置缺少必填欄位: root_path");
    } else if (typeof root !== "string") {
      errors.push("LOCAL 配置欄位 root_path 必須是字串");
    } else {
      const trimmed = root.trim();
      const isPosixAbs = trimmed.startsWith("/");
      const isWinAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
      if (!isPosixAbs && !isWinAbs) {
        errors.push("LOCAL 配置欄位 root_path 必須是絕對路徑");
      }
    }

    // 環境約束：僅在 Node/Docker 且非 Cloudflare Worker 環境下允許配置 LOCAL
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      errors.push("LOCAL 儲存僅支援 Node/Docker 環境，當前執行環境不支援 LOCAL");
    }

    return { valid: errors.length === 0, errors };
  }

  static _validateOneDriveConfig(config) {
    const errors = [];

    // redirect_uri 必填（用於標識外部授權回撥地址）
    if (!config.redirect_uri) {
      errors.push("OneDrive 配置缺少必填欄位: redirect_uri");
    }

    // refresh_token 必填
    if (!config.refresh_token) {
      errors.push("OneDrive 配置缺少必填欄位: refresh_token");
    }

    const useOnlineApi = toBool(config.use_online_api, false);

    // 未啟用 Online API（use_online_api=false）時：走微軟 OAuth 端點重新整理 token，必須提供 client_id
    if (!useOnlineApi && !config.client_id) {
      errors.push("OneDrive 配置缺少 client_id（未啟用 use_online_api 時必填）");
    }

    // region 值域驗證
    const validRegions = ["global", "cn", "us", "de"];
    if (config.region && !validRegions.includes(config.region)) {
      errors.push(`OneDrive 配置 region 值無效，必須是: ${validRegions.join(", ")}`);
    }

    // token_renew_endpoint URL 格式驗證
    if (config.token_renew_endpoint) {
      try {
        const parsed = new URL(config.token_renew_endpoint);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("token_renew_endpoint 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("token_renew_endpoint 格式無效");
      }
    }

    // redirect_uri URL 格式驗證
    if (config.redirect_uri) {
      try {
        const parsed = new URL(config.redirect_uri);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("redirect_uri 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("redirect_uri 格式無效");
      }
    }

    // Online API 模式：必須配置 token_renew_endpoint
    if (useOnlineApi && !config.token_renew_endpoint) {
      errors.push("啟用 use_online_api 時必須配置 token_renew_endpoint");
    }

    // default_folder 路徑驗證（僅作為儲存內預設上傳字首）
    if (config.default_folder) {
      const folder = config.default_folder.toString();
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static _validateGoogleDriveConfig(config) {
    const errors = [];

    const useOnlineApi = toBool(config.use_online_api, false);
    const refreshToken = config.refresh_token;
    const endpointUrl = config.endpoint_url;

    // 公共必填：refresh_token
    if (!refreshToken) {
      errors.push("Google Drive 配置缺少必填欄位: refresh_token");
    }

    // 線上 API 模式
    if (useOnlineApi) {
      if (!endpointUrl) {
        errors.push("啟用 use_online_api 時必須配置 endpoint_url");
      } else {
        try {
          const parsed = new URL(endpointUrl);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
          }
        } catch {
          errors.push("endpoint_url 格式無效");
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * GitHub Releases 配置校驗：
   * - repo_structure 必填，按行配置：
   *   1）owner/repo
   *   2）別名:owner/repo
   *   3）完整倉庫 URL：https://github.com/owner/repo（可帶 /releases 等字尾）
   * - 可選欄位：show_readme/show_all_version/show_source_code/token/gh_proxy/per_page；
   * - gh_proxy 若存在，需為合法 URL。
   * @param {object} config
   * @returns {{valid:boolean,errors:string[]}}
   */
  static _validateGithubReleasesConfig(config) {
    const errors = [];

    const raw = config?.repo_structure;
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      errors.push("GitHub Releases 配置缺少必填欄位: repo_structure");
    } else {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
      if (lines.length === 0) {
        errors.push("GitHub Releases 配置 repo_structure 不能為空");
      } else {
        for (const line of lines) {
          let repoPart = line;

          // 支援三種顯式格式：
          // 1）owner/repo
          // 2）別名:owner/repo
          // 3）https://github.com/owner/repo（可帶 /releases 等字尾）
          // URL 形式（https://github.com/...）不參與別名分割，避免將 "https:" 誤判為別名
          if (!/^https?:\/\/github\.com\//i.test(line)) {
            const idx = line.indexOf(":");
            if (idx >= 0) {
              repoPart = line.slice(idx + 1).trim();
              if (!repoPart) {
                errors.push(
                  `GitHub Releases 配置行格式無效，應為 owner/repo、別名:owner/repo 或 https://github.com/owner/repo: ${line}`,
                );
                continue;
              }
            }
          }

          let normalized = repoPart;
          if (/^https?:\/\/github\.com\//i.test(repoPart)) {
            // 完整 GitHub 倉庫或 Releases URL
            normalized = repoPart.replace(/^https?:\/\/github\.com\//i, "");
          }

          // 為了規範輸入，不允許以 / 開頭的 owner/repo（例如 /owner/repo）
          if (normalized.startsWith("/")) {
            errors.push(
              `GitHub Releases 配置行格式無效，不支援以 / 開頭的 owner/repo，請使用 owner/repo 或 別名:owner/repo 或完整倉庫 URL: ${line}`,
            );
            continue;
          }

          const segments = normalized.split("/").filter((seg) => seg.length > 0);
          if (segments.length < 2) {
            errors.push(`GitHub Releases 配置行缺少 owner/repo 資訊: ${line}`);
          }
        }
      }
    }

    if (config?.gh_proxy) {
      try {
        const parsed = new URL(config.gh_proxy);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub Releases 配置欄位 gh_proxy 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("GitHub Releases 配置欄位 gh_proxy 格式無效");
      }
    }

    if (config?.per_page !== undefined) {
      const value = Number(config.per_page);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push("GitHub Releases 配置欄位 per_page 必須是大於 0 的數字");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * GitHub API（倉庫內容）配置校驗：
   * - owner/repo/token 必填（寫入必須）
   * - ref 可選：預設使用倉庫 default_branch；支援 branch/tag/commit sha（僅分支可寫）
   * - default_folder 可選：僅作為“檔案上傳頁/分享上傳”的預設目錄字首（不影響掛載瀏覽/FS 操作）
   * - endpoint_url 可選：GitHub Enterprise/自定義 API Base（預設 https://api.github.com）
   * - gh_proxy 可選：用於加速 raw 直鏈
   * - committer/author 可選：自定義提交者與作者資訊（需 name/email 成對出現）
   * @param {object} config
   * @returns {{valid:boolean,errors:string[]}}
   */
  static _validateGithubApiConfig(config) {
    const errors = [];

    if (!config?.owner) errors.push("GitHub API 配置缺少必填欄位: owner");
    if (!config?.repo) errors.push("GitHub API 配置缺少必填欄位: repo");
    if (!config?.token) errors.push("GitHub API 配置缺少必填欄位: token");

    if (config?.ref) {
      const ref = String(config.ref).trim();
      if (ref.startsWith("refs/") && !ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
        errors.push("GitHub API 配置欄位 ref 僅支援 refs/heads/* 或 refs/tags/*（或直接填寫分支/標籤/commit sha）");
      }
    }

    if (config?.endpoint_url) {
      try {
        const parsed = new URL(config.endpoint_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub API 配置欄位 endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("GitHub API 配置欄位 endpoint_url 格式無效");
      }
    }

    if (config?.gh_proxy) {
      try {
        const parsed = new URL(config.gh_proxy);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub API 配置欄位 gh_proxy 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("GitHub API 配置欄位 gh_proxy 格式無效");
      }
    }

    if (config?.default_folder) {
      const folder = config.default_folder.toString();
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }

    const committerName = config?.committer_name ? String(config.committer_name).trim() : "";
    const committerEmail = config?.committer_email ? String(config.committer_email).trim() : "";
    if ((committerName && !committerEmail) || (!committerName && committerEmail)) {
      errors.push("GitHub API 配置欄位 committer_name 與 committer_email 必須同時填寫或同時留空");
    }

    const authorName = config?.author_name ? String(config.author_name).trim() : "";
    const authorEmail = config?.author_email ? String(config.author_email).trim() : "";
    if ((authorName && !authorEmail) || (!authorName && authorEmail)) {
      errors.push("GitHub API 配置欄位 author_name 與 author_email 必須同時填寫或同時留空");
    }

    return { valid: errors.length === 0, errors };
  }
}

// 預設註冊 S3 驅動與 tester
import { s3TestConnection } from "../drivers/s3/tester/S3Tester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.S3, {
  ctor: S3StorageDriver,
  tester: s3TestConnection,
  displayName: "S3 相容儲存",
  validate: (cfg) => StorageFactory._validateS3Config(cfg),
  capabilities: [
    CAPABILITIES.READER,
    CAPABILITIES.WRITER,
    CAPABILITIES.DIRECT_LINK,
    CAPABILITIES.MULTIPART,
    CAPABILITIES.ATOMIC,
    CAPABILITIES.PROXY,
    CAPABILITIES.PAGED_LIST,
  ],
  ui: {
    icon: "storage-s3",
    i18nKey: "admin.storage.type.s3",
    badgeTheme: "s3",
  },
   configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用欄位
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      // S3 專用欄位
      provider_type: cfg?.provider_type,
      endpoint_url: cfg?.endpoint_url,
      bucket_name: cfg?.bucket_name,
      region: cfg?.region,
      path_style: cfg?.path_style,
      // S3 分片上傳（前端直傳）
      // - multipart_part_size_mb：分片大小（MB），預設 5
      // - multipart_concurrency：併發數（同時上傳多少片），預設 3
      multipart_part_size_mb: cfg?.multipart_part_size_mb,
      multipart_concurrency: cfg?.multipart_concurrency,
    };

    if (withSecrets) {
      projected.access_key_id = cfg?.access_key_id;
      projected.secret_access_key = cfg?.secret_access_key;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "provider_type",
        type: "enum",
        required: true,
        labelKey: "admin.storage.fields.provider_type",
        enumValues: [
          { value: "Cloudflare R2", labelKey: "admin.storage.s3.provider.cloudflare_r2" },
          { value: "Backblaze B2", labelKey: "admin.storage.s3.provider.backblaze_b2" },
          { value: "AWS S3", labelKey: "admin.storage.s3.provider.aws_s3" },
          { value: "Aliyun OSS", labelKey: "admin.storage.s3.provider.aliyun_oss" },
          { value: "Other", labelKey: "admin.storage.s3.provider.other" },
        ],
      },
      {
        name: "bucket_name",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.bucket_name",
        ui: { placeholderKey: "admin.storage.placeholder.bucket_name" },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.endpoint_url",
          descriptionKey: "admin.storage.description.endpoint_url",
        },
      },
      {
        name: "region",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.region",
        ui: { placeholderKey: "admin.storage.placeholder.region" },
      },
      {
        name: "path_style",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.path_style",
        ui: {
          descriptionKey: "admin.storage.description.path_style",
          displayOptions: {
            trueKey: "admin.storage.display.path_style.path",
            falseKey: "admin.storage.display.path_style.virtual_host",
          },
        },
      },
      {
        name: "access_key_id",
        type: "secret",
        required: false,
        requiredOnCreate: true,
        labelKey: "admin.storage.fields.access_key_id",
        ui: { placeholderKey: "admin.storage.placeholder.access_key_id" },
      },
      {
        name: "secret_access_key",
        type: "secret",
        required: false,
        requiredOnCreate: true,
        labelKey: "admin.storage.fields.secret_access_key",
        ui: { placeholderKey: "admin.storage.placeholder.secret_access_key" },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "signature_expires_in",
        type: "number",
        required: false,
        labelKey: "admin.storage.fields.signature_expires_in",
        defaultValue: 3600,
        ui: { descriptionKey: "admin.storage.description.signature_expires_in" },
      },
      {
        name: "multipart_part_size_mb",
        type: "number",
        required: false,
        defaultValue: 5,
        labelKey: "admin.storage.fields.s3.multipart_part_size_mb",
        ui: {
          descriptionKey: "admin.storage.description.s3.multipart_part_size_mb",
          min: 5,
          max: 5120,
        },
        validation: { min: 1 },
      },
      {
        name: "multipart_concurrency",
        type: "number",
        required: false,
        defaultValue: 3,
        labelKey: "admin.storage.fields.s3.multipart_concurrency",
        ui: {
          descriptionKey: "admin.storage.description.s3.multipart_concurrency",
          min: 1,
          max: 10,
        },
        validation: { min: 1 },
      },
      {
        name: "custom_host",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.custom_host",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.custom_host",
          descriptionKey: "admin.storage.description.custom_host",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["provider_type", "bucket_name"]],
        },
        {
          name: "connection",
          titleKey: "admin.storage.groups.connection",
          fields: ["endpoint_url", ["region", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["access_key_id", "secret_access_key"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["custom_host", "url_proxy", ["signature_expires_in", "path_style"], ["multipart_part_size_mb", "multipart_concurrency"]],
        },
      ],
      summaryFields: ["bucket_name", "region", "default_folder", "path_style"],
    },
  },
  providerOptions: [
    { value: "Cloudflare R2", labelKey: "admin.storage.s3.provider.cloudflare_r2" },
    { value: "Backblaze B2", labelKey: "admin.storage.s3.provider.backblaze_b2" },
    { value: "AWS S3", labelKey: "admin.storage.s3.provider.aws_s3" },
    { value: "Aliyun OSS", labelKey: "admin.storage.s3.provider.aliyun_oss" },
    { value: "Other", labelKey: "admin.storage.s3.provider.other" },
  ],
});

// 註冊 WebDAV 驅動
import { webDavTestConnection } from "../drivers/webdav/WebDavTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.WEBDAV, {
  ctor: WebDavStorageDriver,
  tester: webDavTestConnection,
  displayName: "WebDAV 儲存",
  validate: (cfg) => StorageFactory._validateWebDavConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-webdav",
    i18nKey: "admin.storage.type.webdav",
    badgeTheme: "webdav",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用欄位
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      enable_disk_usage: cfg?.enable_disk_usage ? 1 : 0,
      // WebDAV 專用欄位
      endpoint_url: cfg?.endpoint_url,
      username: cfg?.username,
      tls_insecure_skip_verify: cfg?.tls_insecure_skip_verify ? 1 : 0,
    };

    if (withSecrets) {
      projected.password = cfg?.password;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "endpoint_url",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.webdav_endpoint",
          descriptionKey: "admin.storage.description.webdav_endpoint",
        },
      },
      {
        name: "username",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.username",
        ui: { placeholderKey: "admin.storage.placeholder.username" },
      },
      {
        name: "password",
        type: "secret",
        required: false,
        requiredOnCreate: true,
        labelKey: "admin.storage.fields.password",
        ui: { placeholderKey: "admin.storage.placeholder.password" },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "enable_disk_usage",
        type: "boolean",
        required: false,
        defaultValue: true,
        labelKey: "admin.storage.fields.webdav.enable_disk_usage",
        ui: {
          descriptionKey: "admin.storage.description.webdav.enable_disk_usage",
        },
      },
      {
        name: "tls_insecure_skip_verify",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.tls_insecure_skip_verify",
        ui: { descriptionKey: "admin.storage.description.tls_insecure_skip_verify" },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "connection",
          titleKey: "admin.storage.groups.connection",
          fields: ["endpoint_url", ["username", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: ["password"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["url_proxy", ["enable_disk_usage", "tls_insecure_skip_verify"]],
        },
      ],
      summaryFields: ["endpoint_url", "username", "default_folder", "enable_disk_usage"],
    },
  },
});

// 註冊 LOCAL 驅動
import { localTestConnection } from "../drivers/local/tester/LocalTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.LOCAL, {
  ctor: LocalStorageDriver,
  tester: localTestConnection,
  displayName: "本地檔案系統",
  validate: (cfg) => StorageFactory._validateLocalConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-local",
    i18nKey: "admin.storage.type.local",
    badgeTheme: "local",
  },
  configProjector(cfg) {
    return {
      // 通用欄位
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      enable_disk_usage: cfg?.enable_disk_usage ? 1 : 0,
      // LOCAL 專用欄位
      root_path: cfg?.root_path,
      auto_create_root: cfg?.auto_create_root ? 1 : 0,
      readonly: cfg?.readonly ? 1 : 0,
      trash_path: cfg?.trash_path,
      dir_permission: cfg?.dir_permission,
    };
  },
  configSchema: {
    fields: [
      {
        name: "root_path",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.local.root_path",
        validation: { rule: "abs_path" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.root_path",
          descriptionKey: "admin.storage.description.root_path",
        },
      },
      {
        name: "auto_create_root",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.local.auto_create_root",
        ui: {
          descriptionKey: "admin.storage.description.auto_create_root",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "readonly",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.local.readonly",
        ui: { descriptionKey: "admin.storage.description.readonly" },
      },
      {
        name: "enable_disk_usage",
        type: "boolean",
        required: false,
        defaultValue: true,
        labelKey: "admin.storage.fields.local.enable_disk_usage",
        ui: { descriptionKey: "admin.storage.description.local.enable_disk_usage" },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "trash_path",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.local.trash_path",
        ui: {
          placeholderKey: "admin.storage.placeholder.trash_path",
          descriptionKey: "admin.storage.description.trash_path",
        },
      },
      {
        name: "dir_permission",
        type: "string",
        required: false,
        defaultValue: "0777",
        labelKey: "admin.storage.fields.local.dir_permission",
        validation: { rule: "octal_permission" },
        ui: {
          placeholderKey: "admin.storage.placeholder.dir_permission",
          descriptionKey: "admin.storage.description.dir_permission",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          // 第一行：root_path 與 auto_create_root 並排顯示；第二行：default_folder 與 trash_path 並排
          fields: [["root_path", "auto_create_root"], ["default_folder", "trash_path"]],
        },
        {
          name: "permissions",
          titleKey: "admin.storage.groups.permissions",
          // 左：目錄/檔案許可權；右：只讀模式勾選
          fields: [["dir_permission", "readonly"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["url_proxy", "enable_disk_usage"],
        },
      ],
      // 卡片摘要顯示：根目錄、預設目錄以及關鍵行為開關
      summaryFields: ["root_path", "default_folder", "readonly", "trash_path", "enable_disk_usage"],
    },
  },
});

// 註冊 OneDrive 驅動
import { oneDriveTestConnection } from "../drivers/onedrive/tester/OneDriveTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.ONEDRIVE, {
  ctor: OneDriveStorageDriver,
  tester: oneDriveTestConnection,
  displayName: "OneDrive 儲存",
  validate: (cfg) => StorageFactory._validateOneDriveConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PAGED_LIST],
  ui: {
    icon: "storage-onedrive",
    i18nKey: "admin.storage.type.onedrive",
    badgeTheme: "onedrive",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用欄位
      default_folder: cfg?.default_folder ?? cfg?.root_folder ?? "",
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      enable_disk_usage: cfg?.enable_disk_usage ? 1 : 0,
      // OneDrive 專用欄位
      region: cfg?.region,
      client_id: cfg?.client_id,
      token_renew_endpoint: cfg?.token_renew_endpoint,
      redirect_uri: cfg?.redirect_uri,
      use_online_api: cfg?.use_online_api ? 1 : 0,
      has_refresh_token: !!(cfg?.refresh_token && String(cfg.refresh_token).trim().length > 0),
    };

    if (withSecrets) {
      projected.client_secret = cfg?.client_secret;
      projected.refresh_token = cfg?.refresh_token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "region",
        type: "enum",
        required: false,
        defaultValue: "global",
        labelKey: "admin.storage.fields.onedrive.region",
        enumValues: [
          { value: "global", labelKey: "admin.storage.onedrive.region.global" },
          { value: "cn", labelKey: "admin.storage.onedrive.region.cn" },
          { value: "us", labelKey: "admin.storage.onedrive.region.us" },
          { value: "de", labelKey: "admin.storage.onedrive.region.de" },
        ],
        ui: {
          descriptionKey: "admin.storage.description.onedrive.region",
        },
      },
      {
        name: "client_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.onedrive.client_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.onedrive.client_id",
          descriptionKey: "admin.storage.description.onedrive.client_id",
        },
      },
      {
        name: "client_secret",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.onedrive.client_secret",
        ui: {
          placeholderKey: "admin.storage.placeholder.onedrive.client_secret",
          descriptionKey: "admin.storage.description.onedrive.client_secret",
        },
      },
      {
        name: "refresh_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.onedrive.refresh_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.onedrive.refresh_token",
          descriptionKey: "admin.storage.description.onedrive.refresh_token",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
          descriptionKey: "admin.storage.description.onedrive.root_folder",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "token_renew_endpoint",
        type: "string",
        required: false,
        requiredWhen: { field: "use_online_api", equals: true },
        labelKey: "admin.storage.fields.onedrive.token_renew_endpoint",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          disabledWhen: { field: "use_online_api", equals: false },
          placeholderKey: "admin.storage.placeholder.onedrive.token_renew_endpoint",
          descriptionKey: "admin.storage.description.onedrive.token_renew_endpoint",
        },
      },
      {
        name: "redirect_uri",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.onedrive.redirect_uri",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.onedrive.redirect_uri",
          descriptionKey: "admin.storage.description.onedrive.redirect_uri",
        },
      },
      {
        name: "use_online_api",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.onedrive.use_online_api",
        ui: {
          descriptionKey: "admin.storage.description.onedrive.use_online_api",
          displayOptions: {
            trueKey: "admin.storage.display.onedrive.use_online_api.enabled",
            falseKey: "admin.storage.display.onedrive.use_online_api.disabled",
          },
        },
      },
      {
        name: "enable_disk_usage",
        type: "boolean",
        required: false,
        defaultValue: true,
        labelKey: "admin.storage.fields.onedrive.enable_disk_usage",
        ui: {
          descriptionKey: "admin.storage.description.onedrive.enable_disk_usage",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["region", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["client_id", "client_secret"], "refresh_token"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["redirect_uri", ["token_renew_endpoint", "use_online_api"], "enable_disk_usage", "url_proxy"],
        },
      ],
      summaryFields: ["region", "default_folder", "use_online_api", "enable_disk_usage"],
    },
  },
  providerOptions: [
    { value: "global", labelKey: "admin.storage.onedrive.region.global" },
    { value: "cn", labelKey: "admin.storage.onedrive.region.cn" },
  ],
});

// 註冊 Google Drive 驅動
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GOOGLE_DRIVE, {
  ctor: GoogleDriveStorageDriver,
  tester: googleDriveTestConnection,
  displayName: "Google Drive 儲存",
  validate: (cfg) => StorageFactory._validateGoogleDriveConfig(cfg),
  capabilities: [
    CAPABILITIES.READER,
    CAPABILITIES.WRITER,
    CAPABILITIES.ATOMIC,
    CAPABILITIES.PROXY,
    CAPABILITIES.MULTIPART,
    CAPABILITIES.PAGED_LIST,
  ],
  ui: {
    icon: "storage-googledrive",
    i18nKey: "admin.storage.type.googledrive",
    badgeTheme: "googledrive",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      default_folder: cfg?.default_folder ?? "",
      root_id: cfg?.root_id ?? "root",
      enable_disk_usage: cfg?.enable_disk_usage ? 1 : 0,
      use_online_api: cfg?.use_online_api ? 1 : 0,
      endpoint_url: cfg?.endpoint_url,
      client_id: cfg?.client_id,
      enable_shared_view: cfg?.enable_shared_view === undefined ? 1 : cfg?.enable_shared_view ? 1 : 0,
      has_refresh_token: !!(cfg?.refresh_token && String(cfg.refresh_token).trim().length > 0),
    };

    if (withSecrets) {
      projected.client_secret = cfg?.client_secret;
      projected.refresh_token = cfg?.refresh_token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "use_online_api",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.googledrive.use_online_api",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.use_online_api",
          displayOptions: {
            trueKey: "admin.storage.display.googledrive.use_online_api.enabled",
            falseKey: "admin.storage.display.googledrive.use_online_api.disabled",
          },
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: false,
        requiredWhen: { field: "use_online_api", equals: true },
        labelKey: "admin.storage.fields.googledrive.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.googledrive.endpoint_url",
          descriptionKey: "admin.storage.description.googledrive.endpoint_url",
          disabledWhen: {
            field: "use_online_api",
            equals: false,
          },
        },
      },
      {
        name: "client_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.googledrive.client_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.client_id",
          descriptionKey: "admin.storage.description.googledrive.client_id",
        },
      },
      {
        name: "client_secret",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.googledrive.client_secret",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.client_secret",
          descriptionKey: "admin.storage.description.googledrive.client_secret",
        },
      },
      {
        name: "refresh_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.googledrive.refresh_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.googledrive.refresh_token",
          descriptionKey: "admin.storage.description.googledrive.refresh_token",
        },
      },
      {
        name: "root_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.googledrive.root_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.root_id",
          descriptionKey: "admin.storage.description.googledrive.root_id",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "enable_disk_usage",
        type: "boolean",
        required: false,
        defaultValue: true,
        labelKey: "admin.storage.fields.googledrive.enable_disk_usage",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.enable_disk_usage",
        },
      },
      {
        name: "enable_shared_view",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.googledrive.enable_shared_view",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.enable_shared_view",
          displayOptions: {
            trueKey: "admin.storage.display.googledrive.enable_shared_view.enabled",
            falseKey: "admin.storage.display.googledrive.enable_shared_view.disabled",
          },
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["root_id", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["client_id", "client_secret"], "refresh_token"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: [["endpoint_url", "use_online_api"], ["enable_disk_usage", "enable_shared_view"], "url_proxy"],
        },
      ],
      summaryFields: ["root_id", "default_folder", "use_online_api", "enable_disk_usage", "enable_shared_view"],
    },
  },
});

// 註冊 GitHub Releases 驅動（只讀）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GITHUB_RELEASES, {
  ctor: GithubReleasesStorageDriver,
  tester: githubReleasesTestConnection,
  displayName: "GitHub Releases 儲存",
  validate: (cfg) => StorageFactory._validateGithubReleasesConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-github-releases",
    i18nKey: "admin.storage.type.github_releases",
    badgeTheme: "github",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // GitHub Releases 專用欄位
      repo_structure: cfg?.repo_structure,
      show_readme: cfg?.show_readme ?? false,
      show_all_version: cfg?.show_all_version ?? false,
      show_source_code: cfg?.show_source_code ?? false,
      show_release_notes: cfg?.show_release_notes ?? false,
      gh_proxy: cfg?.gh_proxy,
      per_page: cfg?.per_page,
      total_storage_bytes: cfg?.total_storage_bytes,
    };

    if (withSecrets) {
      projected.token = cfg?.token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "repo_structure",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_releases.repo_structure",
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.github_releases.repo_structure",
          placeholderKey: "admin.storage.placeholder.github_releases.repo_structure",
        },
      },
      {
        name: "show_all_version",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_all_version",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_all_version",
        },
      },
      {
        name: "show_source_code",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_source_code",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_source_code",
        },
      },
      {
        name: "show_readme",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_readme",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_readme",
        },
      },
      {
        name: "show_release_notes",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_release_notes",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_release_notes",
        },
      },
      {
        name: "per_page",
        type: "number",
        required: false,
        labelKey: "admin.storage.fields.github_releases.per_page",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.per_page",
        },
      },
      {
        name: "gh_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_releases.gh_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_releases.gh_proxy",
          descriptionKey: "admin.storage.description.github_releases.gh_proxy",
        },
      },
      {
        name: "token",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.github_releases.token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_releases.token",
          descriptionKey: "admin.storage.description.github_releases.token",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["repo_structure"],
        },
        {
          name: "behaviour",
          titleKey: "admin.storage.groups.behaviour",
          fields: [["show_all_version", "show_source_code"], ["show_readme", "show_release_notes"], "per_page"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["gh_proxy", "token"],
        },
      ],
      summaryFields: ["repo_structure", "show_all_version", "show_source_code", "show_release_notes"],
    },
  },
});

// 註冊 GitHub API 驅動（可讀寫）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GITHUB_API, {
  ctor: GithubApiStorageDriver,
  tester: githubApiTestConnection,
  displayName: "GitHub API 儲存",
  validate: (cfg) => StorageFactory._validateGithubApiConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK],
  ui: {
    icon: "storage-github-api",
    i18nKey: "admin.storage.type.github_api",
    badgeTheme: "github",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      owner: cfg?.owner,
      repo: cfg?.repo,
      ref: cfg?.ref,
      default_folder: cfg?.default_folder,
      endpoint_url: cfg?.endpoint_url,
      gh_proxy: cfg?.gh_proxy,
      committer_name: cfg?.committer_name,
      committer_email: cfg?.committer_email,
      author_name: cfg?.author_name,
      author_email: cfg?.author_email,
      total_storage_bytes: cfg?.total_storage_bytes,
    };

    if (withSecrets) {
      projected.token = cfg?.token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "owner",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_api.owner",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.owner" },
      },
      {
        name: "repo",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_api.repo",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.repo" },
      },
      {
        name: "ref",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.ref",
        ui: {
          placeholderKey: "admin.storage.placeholder.github_api.ref",
          descriptionKey: "admin.storage.description.github_api.ref",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: false,
        defaultValue: "https://api.github.com",
        labelKey: "admin.storage.fields.github_api.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.endpoint_url",
          descriptionKey: "admin.storage.description.github_api.endpoint_url",
        },
      },
      {
        name: "gh_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.gh_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.gh_proxy",
          descriptionKey: "admin.storage.description.github_api.gh_proxy",
        },
      },
      {
        name: "committer_name",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.committer_name",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.committer_name" },
      },
      {
        name: "committer_email",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.committer_email",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.committer_email" },
      },
      {
        name: "author_name",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.author_name",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.author_name" },
      },
      {
        name: "author_email",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.author_email",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.author_email" },
      },
      {
        name: "token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.github_api.token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.token",
          descriptionKey: "admin.storage.description.github_api.token",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["owner", "repo"], ["ref", "default_folder"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["token", "endpoint_url", "gh_proxy", ["committer_name", "committer_email"], ["author_name", "author_email"]],
        },
      ],
      summaryFields: ["owner", "repo", "ref", "default_folder"],
    },
  },
});

// 註冊 Telegram 驅動（Bot API 優先：VFS 目錄樹 + 代理訪問）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.TELEGRAM, {
  ctor: TelegramStorageDriver,
  tester: telegramTestConnection,
  displayName: "Telegram Bot API",
  validate: (cfg) => {
    const errors = [];
    if (!cfg?.bot_token) errors.push("TELEGRAM 配置缺少必填欄位: bot_token");
    if (!cfg?.target_chat_id) errors.push("TELEGRAM 配置缺少必填欄位: target_chat_id");
    if (cfg?.target_chat_id && !/^-?\\d+$/.test(String(cfg.target_chat_id).trim())) {
      errors.push("TELEGRAM 配置欄位 target_chat_id 必須是純數字字串（例如 -100...）");
    }
    const botApiMode = String(cfg?.bot_api_mode || "official").trim().toLowerCase();
    if (botApiMode && !["official", "self_hosted"].includes(botApiMode)) {
      errors.push("bot_api_mode 只能是 official 或 self_hosted");
    }
    if (botApiMode === "self_hosted" && !cfg?.endpoint_url) {
      errors.push("啟用 self_hosted 時必須配置 endpoint_url（你的自建 Bot API 地址）");
    }
    // 官方託管 Bot API 常見下載側限制在 20MB
    // - self_hosted（自建 Bot API server）可放寬限制（官方可到 2GB）
    const partSizeMb = Number(cfg?.part_size_mb ?? 15);
    if (botApiMode !== "self_hosted" && Number.isFinite(partSizeMb) && partSizeMb > 20) {
      errors.push("part_size_mb 在 official 模式下建議 ≤ 20（避免下載受限導致無法讀取分片）");
    }
    if (cfg?.endpoint_url) {
      try {
        const parsed = new URL(String(cfg.endpoint_url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }
    return { valid: errors.length === 0, errors };
  },
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.PROXY, CAPABILITIES.MULTIPART, CAPABILITIES.ATOMIC],
  ui: {
    icon: "storage-telegram",
    i18nKey: "admin.storage.type.telegram",
    badgeTheme: "telegram",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      target_chat_id: cfg?.target_chat_id,
      endpoint_url: cfg?.endpoint_url,
      bot_api_mode: cfg?.bot_api_mode,
      part_size_mb: cfg?.part_size_mb,
      upload_concurrency: cfg?.upload_concurrency,
      verify_after_upload: cfg?.verify_after_upload,
      default_folder: cfg?.default_folder,
    };
    if (withSecrets) {
      projected.bot_token = cfg?.bot_token;
    }
    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "bot_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.telegram.bot_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.telegram.bot_token",
          descriptionKey: "admin.storage.description.telegram.bot_token",
        },
      },
      {
        name: "target_chat_id",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.telegram.target_chat_id",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.telegram.target_chat_id",
          descriptionKey: "admin.storage.description.telegram.target_chat_id",
        },
      },
      {
        name: "bot_api_mode",
        type: "enum",
        required: false,
        defaultValue: "official",
        labelKey: "admin.storage.fields.telegram.bot_api_mode",
        enumValues: [
          { value: "official", labelKey: "admin.storage.enum.telegram.bot_api_mode.official" },
          { value: "self_hosted", labelKey: "admin.storage.enum.telegram.bot_api_mode.self_hosted" },
        ],
        ui: {
          fullWidth: true,
          renderAs: "toggle",
          toggleLabelKey: "admin.storage.toggle.telegram.bot_api_mode",
          descriptionKey: "admin.storage.description.telegram.bot_api_mode",
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: false,
        requiredWhen: { field: "bot_api_mode", equals: "self_hosted" },
        labelKey: "admin.storage.fields.telegram.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          dependsOn: { field: "bot_api_mode", value: "self_hosted" },
          placeholderKey: "admin.storage.placeholder.telegram.endpoint_url",
          descriptionKey: "admin.storage.description.telegram.endpoint_url",
        },
      },
      {
        name: "part_size_mb",
        type: "number",
        required: false,
        defaultValue: 15,
        labelKey: "admin.storage.fields.telegram.part_size_mb",
        ui: {
          placeholderKey: "admin.storage.placeholder.telegram.part_size_mb",
          descriptionKey: "admin.storage.description.telegram.part_size_mb",
        },
      },
      {
        name: "upload_concurrency",
        type: "number",
        required: false,
        defaultValue: 2,
        labelKey: "admin.storage.fields.telegram.upload_concurrency",
        ui: {
          placeholderKey: "admin.storage.placeholder.telegram.upload_concurrency",
          descriptionKey: "admin.storage.description.telegram.upload_concurrency",
        },
      },
      {
        name: "verify_after_upload",
        type: "boolean",
        required: false,
        defaultValue: false,
        labelKey: "admin.storage.fields.telegram.verify_after_upload",
        ui: {
          descriptionKey: "admin.storage.description.telegram.verify_after_upload",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["bot_token", "target_chat_id", "default_folder"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["bot_api_mode", "endpoint_url", ["part_size_mb", "upload_concurrency"], "verify_after_upload", "url_proxy"],
        },
      ],
      summaryFields: ["target_chat_id", "default_folder", "part_size_mb", "upload_concurrency"],
    },
  },
});

// 註冊 Discord 驅動（Bot API：先完成“儲存配置 + 測試連線”接入，能力在後續任務逐步補齊）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.DISCORD, {
  ctor: DiscordStorageDriver,
  tester: discordTestConnection,
  displayName: "Discord Bot API",
  validate: (cfg) => {
    const errors = [];
    if (!cfg?.bot_token) errors.push("DISCORD 配置缺少必填欄位: bot_token");
    if (!cfg?.channel_id) errors.push("DISCORD 配置缺少必填欄位: channel_id");
    if (cfg?.channel_id && !/^\d+$/.test(String(cfg.channel_id).trim())) {
      errors.push("DISCORD 配置欄位 channel_id 必須是純數字字串（Snowflake）");
    }
    if (cfg?.endpoint_url) {
      try {
        const parsed = new URL(String(cfg.endpoint_url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }
    const partSizeMb = cfg?.part_size_mb != null && cfg?.part_size_mb !== "" ? Number(cfg.part_size_mb) : null;
    if (partSizeMb != null && (!Number.isFinite(partSizeMb) || partSizeMb <= 0)) {
      errors.push("part_size_mb 必須是大於 0 的數字");
    }
    const concurrency = cfg?.upload_concurrency != null && cfg?.upload_concurrency !== "" ? Number(cfg.upload_concurrency) : null;
    if (concurrency != null && (!Number.isFinite(concurrency) || concurrency <= 0)) {
      errors.push("upload_concurrency 必須是大於 0 的數字");
    }
    if (cfg?.default_folder) {
      const folder = String(cfg.default_folder);
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }
    if (cfg?.url_proxy) {
      try {
        const parsed = new URL(String(cfg.url_proxy));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("url_proxy 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("url_proxy 格式無效");
      }
    }
    return { valid: errors.length === 0, errors };
  },
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.MULTIPART],
  ui: {
    icon: "storage-discord",
    i18nKey: "admin.storage.type.discord",
    badgeTheme: "discord",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      channel_id: cfg?.channel_id,
      endpoint_url: cfg?.endpoint_url,
      part_size_mb: cfg?.part_size_mb,
      upload_concurrency: cfg?.upload_concurrency,
      default_folder: cfg?.default_folder,
      url_proxy: cfg?.url_proxy,
    };
    if (withSecrets) {
      projected.bot_token = cfg?.bot_token;
    }
    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "bot_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.discord.bot_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.discord.bot_token",
          descriptionKey: "admin.storage.description.discord.bot_token",
        },
      },
      {
        name: "channel_id",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.discord.channel_id",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.discord.channel_id",
          descriptionKey: "admin.storage.description.discord.channel_id",
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: false,
        defaultValue: "https://discord.com/api/v10",
        labelKey: "admin.storage.fields.discord.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.discord.endpoint_url",
          descriptionKey: "admin.storage.description.discord.endpoint_url",
        },
      },
      {
        name: "part_size_mb",
        type: "number",
        required: false,
        defaultValue: 10,
        labelKey: "admin.storage.fields.discord.part_size_mb",
        ui: {
          placeholderKey: "admin.storage.placeholder.discord.part_size_mb",
          descriptionKey: "admin.storage.description.discord.part_size_mb",
        },
      },
      {
        name: "upload_concurrency",
        type: "number",
        required: false,
        defaultValue: 1,
        labelKey: "admin.storage.fields.discord.upload_concurrency",
        ui: {
          placeholderKey: "admin.storage.placeholder.discord.upload_concurrency",
          descriptionKey: "admin.storage.description.discord.upload_concurrency",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["bot_token", "channel_id", "default_folder"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["endpoint_url", ["part_size_mb", "upload_concurrency"], "url_proxy"],
        },
      ],
      summaryFields: ["channel_id", "default_folder", "part_size_mb", "upload_concurrency"],
    },
  },
});

// 註冊 HuggingFace Datasets 驅動（Hub Datasets）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.HUGGINGFACE_DATASETS, {
  ctor: HuggingFaceDatasetsStorageDriver,
  tester: huggingFaceDatasetsTestConnection,
  displayName: "HuggingFace Datasets",
  validate: (cfg) => {
    const errors = [];
    const repo = cfg?.repo ? String(cfg.repo).trim() : "";
    if (!repo) {
      errors.push("HUGGINGFACE_DATASETS 配置缺少必填欄位: repo（例如 Open-Orca/OpenOrca）");
    } else if (!/^[^/\s]+\/[^/\s]+$/.test(repo.replace(/^datasets\//i, "").replace(/^https?:\/\/huggingface\.co\/datasets\//i, ""))) {
      errors.push("repo 格式無效，應為 owner/name（例如 Open-Orca/OpenOrca）");
    }

    if (cfg?.endpoint_url) {
      try {
        const parsed = new URL(String(cfg.endpoint_url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }

    const revision = cfg?.revision ? String(cfg.revision).trim() : "";
    if (revision && revision.includes(" ")) {
      errors.push("revision 不能包含空格（建議填 main / tag / 40位commit sha）");
    }

    if (cfg?.hf_tree_limit != null && cfg?.hf_tree_limit !== "") {
      const n = Number(cfg.hf_tree_limit);
      if (!Number.isFinite(n) || n <= 0) {
        errors.push("hf_tree_limit 必須是大於 0 的數字");
      }
    }

    if (cfg?.hf_multipart_concurrency != null && cfg?.hf_multipart_concurrency !== "") {
      const n = Number(cfg.hf_multipart_concurrency);
      if (!Number.isFinite(n) || n <= 0) {
        errors.push("hf_multipart_concurrency 必須是大於 0 的數字");
      }
    }

    if (cfg?.default_folder) {
      const folder = String(cfg.default_folder);
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }

    return { valid: errors.length === 0, errors };
  },
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.MULTIPART, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY, CAPABILITIES.PAGED_LIST],
  ui: {
    icon: "storage-huggingface",
    i18nKey: "admin.storage.type.huggingface_datasets",
    badgeTheme: "huggingface",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      repo: cfg?.repo,
      revision: cfg?.revision,
      endpoint_url: cfg?.endpoint_url,
      default_folder: cfg?.default_folder,
      hf_use_paths_info: cfg?.hf_use_paths_info,
      hf_tree_limit: cfg?.hf_tree_limit,
      hf_use_xet: cfg?.hf_use_xet,
      hf_multipart_concurrency: cfg?.hf_multipart_concurrency,
      hf_delete_lfs_on_remove: cfg?.hf_delete_lfs_on_remove,
    };
    if (withSecrets) {
      projected.hf_token = cfg?.hf_token;
    }
    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "repo",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.huggingface_datasets.repo",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.repo",
          descriptionKey: "admin.storage.description.huggingface_datasets.repo",
        },
      },
      {
        name: "revision",
        type: "string",
        required: false,
        defaultValue: "main",
        labelKey: "admin.storage.fields.huggingface_datasets.revision",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.revision",
          descriptionKey: "admin.storage.description.huggingface_datasets.revision",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "hf_token",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.hf_token",
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_token",
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: false,
        defaultValue: "https://huggingface.co",
        labelKey: "admin.storage.fields.huggingface_datasets.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.endpoint_url",
          descriptionKey: "admin.storage.description.huggingface_datasets.endpoint_url",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "hf_use_paths_info",
        type: "boolean",
        required: false,
        defaultValue: true,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_use_paths_info",
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_use_paths_info",
        },
      },
      {
        name: "hf_tree_limit",
        type: "number",
        required: false,
        defaultValue: 100,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_tree_limit",
        ui: {
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.hf_tree_limit",
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_tree_limit",
        },
      },
      {
        name: "hf_multipart_concurrency",
        type: "number",
        required: false,
        defaultValue: 3,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_multipart_concurrency",
        ui: {
          placeholderKey: "admin.storage.placeholder.huggingface_datasets.hf_multipart_concurrency",
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_multipart_concurrency",
        },
      },
      {
        name: "hf_use_xet",
        type: "boolean",
        required: false,
        defaultValue: false,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_use_xet",
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_use_xet",
        },
      },
      {
        name: "hf_delete_lfs_on_remove",
        type: "boolean",
        required: false,
        defaultValue: false,
        labelKey: "admin.storage.fields.huggingface_datasets.hf_delete_lfs_on_remove",
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.huggingface_datasets.hf_delete_lfs_on_remove",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["repo", ["revision", "default_folder"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: [
            "hf_token",
            "endpoint_url",
            ["hf_use_paths_info", "hf_use_xet"],
            ["hf_tree_limit", "hf_multipart_concurrency"],
            "hf_delete_lfs_on_remove",
            "url_proxy",
          ],
        },
      ],
      summaryFields: ["repo", "revision", "default_folder"],
    },
  },
});

// 註冊 MIRROR 驅動（HTTP 映象站目錄解析，只讀）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.MIRROR, {
  ctor: MirrorStorageDriver,
  tester: mirrorTestConnection,
  displayName: "Source Mirror",
  validate: (cfg) => {
    const errors = [];
    const endpoint = cfg?.endpoint_url ? String(cfg.endpoint_url).trim() : "";
    const preset = cfg?.preset ? String(cfg.preset).trim().toLowerCase() : "";

    if (!endpoint) {
      errors.push("MIRROR 配置缺少必填欄位: endpoint_url");
    } else {
      try {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 格式無效");
      }
    }

    if (!preset) {
      errors.push("MIRROR 配置缺少必填欄位: preset");
    } else if (!["tuna", "ustc", "aliyun"].includes(preset)) {
      errors.push("preset 不合法：僅支援 tuna/ustc/aliyun");
    }

    return { valid: errors.length === 0, errors };
  },
  capabilities: [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-mirror",
    i18nKey: "admin.storage.type.mirror",
    badgeTheme: "mirror",
  },
  configSchema: {
    fields: [
      {
        name: "preset",
        type: "enum",
        required: true,
        defaultValue: "tuna",
        labelKey: "admin.storage.fields.mirror.preset",
        enumValues: [
          { value: "tuna", labelKey: "admin.storage.enum.mirror.preset.tuna" },
          { value: "ustc", labelKey: "admin.storage.enum.mirror.preset.ustc" },
          { value: "aliyun", labelKey: "admin.storage.enum.mirror.preset.aliyun" },
        ],
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.mirror.preset",
        },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.mirror.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.mirror.endpoint_url",
          descriptionKey: "admin.storage.description.mirror.endpoint_url",
        },
      },
      {
        name: "max_entries",
        type: "number",
        required: false,
        defaultValue: 1000,
        labelKey: "admin.storage.fields.mirror.max_entries",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.mirror.max_entries",
          descriptionKey: "admin.storage.description.mirror.max_entries",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["preset", "endpoint_url"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["max_entries", "url_proxy"],
        },
      ],
      summaryFields: ["preset", "endpoint_url"],
    },
  },
});
