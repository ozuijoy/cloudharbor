// 統一的儲存配置服務（單表 + JSON）
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { MountManager } from "../storage/managers/MountManager.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, ValidationError, NotFoundError, DriverError } from "../http/errors.js";
import { CAPABILITIES } from "../storage/interfaces/capabilities/index.js";
import { invalidateFsCache } from "../cache/invalidation.js";
import { FsSearchIndexStore } from "../storage/fs/search/FsSearchIndexStore.js";
import { normalizeStorageTestResult, summarizeTestReportForLog } from "../storage/tester/StorageTestReport.js";
import { toBool } from "../utils/environmentUtils.js";

const DEFAULT_TOTAL_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB（位元組）

/**
 * 統一解析“儲存容量限制（位元組）”
 */
function normalizeTotalStorageBytes(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 計算儲存配置在 WebDAV 渠道下支援的策略列表
 * 返回值用於前端根據能力渲染可選的 webdav_policy
 * @param {object} cfg
 * @returns {string[]} webdav_supported_policies
 */
function computeWebDavSupportedPolicies(cfg) {
  const policies = [];
  const type = cfg?.storage_type;
  const hasUrlProxy = !!cfg?.url_proxy;

  // 所有儲存型別統一支援本地代理（native_proxy）
  policies.push("native_proxy");

  // 只要配置了 url_proxy，就支援 URL 代理（use_proxy_url），與 storage_type 無關
  if (hasUrlProxy) {
    policies.push("use_proxy_url");
  }

  // 僅具備 DirectLink 能力的型別暴露 302_redirect（例如 S3、ONEDRIVE 等）
  if (type && StorageFactory.supportsCapability(type, CAPABILITIES.DIRECT_LINK)) {
    policies.push("302_redirect");
  }

  // 去重
  return Array.from(new Set(policies));
}

/**
 * 判斷一個輸入值是否像“掩碼佔位符”（例如 *****1234）
 * - 這是為了防止編輯表單時把 masked 值寫回資料庫，覆蓋真實金鑰
 * - 前端應該已做過濾，但後端必須兜底
 * @param {any} value
 * @returns {boolean}
 */
function isMaskedSecretPlaceholder(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  // maskSecret 預設會生成很多個 * + 尾部少量可見字元
  // 這裡用一個“非常保守但夠用”的判定：至少 3 個 * 開頭
  return /^\*{3,}.+$/.test(s);
}

function getTypeConfigSchema(storageType) {
  if (!storageType) return null;
  const meta = StorageFactory.getTypeMetadata(storageType);
  return meta?.configSchema || null;
}

function getSecretFieldDefsFromSchema(schema) {
  const fields = schema?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name);
}

function getBoolFieldDefsFromSchema(schema) {
  const fields = schema?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (f) =>
      f &&
      typeof f === "object" &&
      (f.type === "bool" || f.type === "boolean") &&
      typeof f.name === "string" &&
      f.name,
  );
}

/**
 * 把 config_json 裡的“布林欄位”統一寫成 0/1（徹底消滅 Boolean("0") 這類坑）
 * - 欄位來源：StorageFactory.getTypeMetadata(storageType).configSchema
 * - 僅處理“schema 裡宣告的 bool/boolean 欄位”
 * @param {string} storageType
 * @param {any} configJson
 */
function coerceConfigJsonBooleansBySchema(storageType, configJson) {
  if (!storageType || !configJson || typeof configJson !== "object") return configJson;
  const schema = getTypeConfigSchema(storageType);
  const boolFields = getBoolFieldDefsFromSchema(schema);
  if (!boolFields.length) return configJson;

  for (const f of boolFields) {
    const key = f.name;
    if (!Object.prototype.hasOwnProperty.call(configJson, key)) continue;
    const raw = configJson[key];
    if (raw === undefined || raw === null) continue;
    configJson[key] = toBool(raw, false) ? 1 : 0;
  }

  return configJson;
}

/**
 * 根據 schema.defaultValue 給 config_json 補預設值
 * @param {string} storageType
 * @param {any} configJson
 */
function applyConfigJsonDefaultValuesBySchema(storageType, configJson) {
  if (!storageType || !configJson || typeof configJson !== "object") return configJson;
  const schema = getTypeConfigSchema(storageType);
  const fields = schema?.fields;
  if (!Array.isArray(fields) || !fields.length) return configJson;

  for (const f of fields) {
    const key = f?.name;
    if (!key || typeof key !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(configJson, key)) continue;
    if (f.defaultValue === undefined) continue;
    configJson[key] = f.defaultValue;
  }

  coerceConfigJsonBooleansBySchema(storageType, configJson);
  return configJson;
}

function shouldSkipSecretWrite(value, { allowEmpty = true } = {}) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const s = value.trim();
    if (allowEmpty && s.length === 0) return true;
    if (isMaskedSecretPlaceholder(s)) return true;
  }
  return false;
}

async function encryptSecretsInConfigJson(storageType, configJson, encryptionSecret, { requireRequiredSecrets = false } = {}) {
  const schema = getTypeConfigSchema(storageType);
  const secretFields = getSecretFieldDefsFromSchema(schema);
  if (!secretFields.length) return configJson;

  for (const f of secretFields) {
    const key = f.name;
    const raw = configJson?.[key];

    // required 校驗（僅用於 create）
    if (requireRequiredSecrets) {
      const missing =
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim().length === 0) ||
        isMaskedSecretPlaceholder(raw);
      if (f.required === true && missing) {
        throw new ValidationError(`缺少必填欄位: ${key}`);
      }
    }

    // 跳過空值（update 時應“保留原值”）
    if (shouldSkipSecretWrite(raw, { allowEmpty: true })) {
      continue;
    }

    // 明確拒絕 masked 佔位符寫入（無論 create/update）
    if (isMaskedSecretPlaceholder(raw)) {
      throw new ValidationError(`欄位 ${key} 不能是掩碼佔位符，請重新填寫`);
    }

    configJson[key] = await encryptValue(String(raw), encryptionSecret);
  }

  return configJson;
}
import { encryptValue, buildSecretView } from "../utils/crypto.js";
import { generateStorageConfigId } from "../utils/common.js";

// 列表/查詢
export async function getStorageConfigsByAdmin(db, adminId, options = {}, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  if (options.page !== undefined || options.limit !== undefined) {
    const result = await repo.findByAdminWithPagination(adminId, options);
    const configs = Array.isArray(result.configs) ? result.configs : [];
    const enhanced = configs.map((cfg) => ({
      ...cfg,
      webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
    }));
    return { ...result, configs: enhanced, total: result.total ?? enhanced.length };
  }
  const configs = await repo.findByAdmin(adminId);
  const enhanced = Array.isArray(configs)
    ? configs.map((cfg) => ({
        ...cfg,
        webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
      }))
    : [];
  return { configs: enhanced, total: enhanced.length };
}

export async function getPublicStorageConfigs(db, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const configs = await repo.findPublic();
  return Array.isArray(configs)
    ? configs.map((cfg) => ({
        ...cfg,
        webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
      }))
    : configs;
}

export async function getStorageConfigByIdForAdmin(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findByIdAndAdmin(id, adminId);
  if (!cfg) throw new NotFoundError("儲存配置不存在");
  return cfg;
}

export async function getPublicStorageConfigById(db, id, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findPublicById(id);
  if (!cfg) throw new NotFoundError("儲存配置不存在");
  return cfg;
}

/**
 * 顯示金鑰明文（受控）：僅管理員、僅單次請求按需解密
 * 返回時可選擇 masked/plain
 */
export async function getStorageConfigByIdForAdminReveal(db, id, adminId, encryptionSecret, mode = "plain", repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!cfg) throw new NotFoundError("儲存配置不存在");
  // 僅構建展示，不改變存量
  const view = await buildSecretView(cfg, encryptionSecret, { mode });
  return view;
}

// CRUD（使用 config_json 儲存驅動私有配置）
export async function createStorageConfig(db, configData, adminId, encryptionSecret, repositoryFactory = null) {
  if (!configData?.name) {
    throw new ValidationError("缺少必填欄位: name");
  }
  if (!configData?.storage_type) {
    throw new ValidationError("缺少必填欄位: storage_type");
  }
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();

  const id = generateStorageConfigId();
  const hasTotalStorageBytes = Object.prototype.hasOwnProperty.call(configData, "total_storage_bytes");
  const totalStorageBytesNormalized = hasTotalStorageBytes
    ? normalizeTotalStorageBytes(configData.total_storage_bytes)
    : DEFAULT_TOTAL_STORAGE_BYTES;
  let configJson = {};
  if (configData.storage_type === "S3") {
    const requiredS3 = ["provider_type", "endpoint_url", "bucket_name", "access_key_id", "secret_access_key"];
    for (const f of requiredS3) {
      if (!configData[f]) throw new ValidationError(`缺少必填欄位: ${f}`);
    }
    if (isMaskedSecretPlaceholder(configData.access_key_id) || isMaskedSecretPlaceholder(configData.secret_access_key)) {
      throw new ValidationError("S3 金鑰欄位疑似為掩碼佔位符（*****1234），請重新填寫真實值");
    }
    const encryptedAccessKey = await encryptValue(configData.access_key_id, encryptionSecret);
    const encryptedSecretKey = await encryptValue(configData.secret_access_key, encryptionSecret);
    configJson = {
      provider_type: configData.provider_type,
      endpoint_url: configData.endpoint_url,
      bucket_name: configData.bucket_name,
      region: configData.region || "",
      path_style: toBool(configData.path_style, false) ? 1 : 0,
      default_folder: configData.default_folder || "",
      total_storage_bytes: totalStorageBytesNormalized,
      custom_host: configData.custom_host || null,
      signature_expires_in: parseInt(configData.signature_expires_in, 10) || 3600,
      access_key_id: encryptedAccessKey,
      secret_access_key: encryptedSecretKey,
    };
  } else if (configData.storage_type === "WEBDAV") {
    const requiredWebDav = ["endpoint_url", "username", "password"];
    for (const f of requiredWebDav) {
      if (!configData[f]) throw new ValidationError(`缺少必填欄位: ${f}`);
    }
    if (isMaskedSecretPlaceholder(configData.password)) {
      throw new ValidationError("WebDAV 密碼欄位疑似為掩碼佔位符（*****1234），請重新填寫真實值");
    }

    let endpoint_url = String(configData.endpoint_url).trim();
    try {
      const parsed = new URL(endpoint_url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ValidationError("endpoint_url 格式無效，必須以 http:// 或 https:// 開頭");
      }
    } catch {
      throw new ValidationError("endpoint_url 不是合法的 URL");
    }

    const encryptedPassword = await encryptValue(configData.password, encryptionSecret);

    let defaultFolder = (configData.default_folder || "").toString().trim();
    defaultFolder = defaultFolder.replace(/^\/+/, "");

    configJson = {
      endpoint_url,
      username: configData.username,
      password: encryptedPassword,
      default_folder: defaultFolder,
      tls_insecure_skip_verify: toBool(configData.tls_insecure_skip_verify, false) ? 1 : 0,
      total_storage_bytes: totalStorageBytesNormalized,
    };
    // enable_disk_usage：如果前端沒傳，交給 schema.defaultValue 決定（避免在 service 裡寫死）
    if (Object.prototype.hasOwnProperty.call(configData, "enable_disk_usage")) {
      configJson.enable_disk_usage = configData.enable_disk_usage;
    }
    applyConfigJsonDefaultValuesBySchema(configData.storage_type, configJson);
  } else {
    const { name, storage_type, is_public, is_default, remark, url_proxy, ...rest } = configData;
    configJson = rest || {};
    // 統一：按 schema.defaultValue 填預設值，再統一把 boolean 寫成 0/1
    // 這樣就不需要在這裡對 ONEDRIVE/GOOGLE_DRIVE/WEBDAV/LOCAL 等做“寫死判斷”
    applyConfigJsonDefaultValuesBySchema(configData.storage_type, configJson);
    // 其它型別也統一預設 10GB（除非顯式傳了 total_storage_bytes）
    if (!Object.prototype.hasOwnProperty.call(configJson, "total_storage_bytes")) {
      configJson.total_storage_bytes = DEFAULT_TOTAL_STORAGE_BYTES;
    } else {
      configJson.total_storage_bytes = normalizeTotalStorageBytes(configJson.total_storage_bytes);
    }
    await encryptSecretsInConfigJson(configData.storage_type, configJson, encryptionSecret, { requireRequiredSecrets: true });
  }
  const createData = {
    id,
    name: configData.name,
    storage_type: configData.storage_type,
    admin_id: adminId,
    is_public: toBool(configData.is_public, false) ? 1 : 0,
    is_default: toBool(configData.is_default, false) ? 1 : 0,
    remark: configData.remark ?? null,
    url_proxy: configData.url_proxy || null,
    status: "ENABLED",
    config_json: JSON.stringify(configJson),
  };

  await repo.createConfig(createData);
  // 如果設定為預設，複用倉儲層的原子更新
  if (createData.is_default === 1) {
    await repo.setAsDefault(id, adminId);
  }
  return await repo.findByIdAndAdmin(id, adminId);
}

export async function updateStorageConfig(db, id, updateData, adminId, encryptionSecret, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const exists = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!exists) throw new NotFoundError("儲存配置不存在");

  // 是否有“驅動私有配置”欄位變化（比如 endpoint/bucket/token 等）
  // - 僅改 name/remark/is_public/is_default/status 這種“展示/開關”欄位，不需要清索引
  // - 一旦改了驅動配置，舊索引可能對應的是“舊資料來源/舊路徑”，必須標記 not_ready 讓你重建
  let driverConfigChanged = false;
  const topPatch = {};
  if (updateData.name) topPatch.name = updateData.name;
  if (updateData.is_public !== undefined) topPatch.is_public = toBool(updateData.is_public, false) ? 1 : 0;
  if (updateData.is_default !== undefined) topPatch.is_default = toBool(updateData.is_default, false) ? 1 : 0;
  if (updateData.status) topPatch.status = updateData.status;
  if (updateData.remark !== undefined) topPatch.remark = updateData.remark;
  if (updateData.url_proxy !== undefined) topPatch.url_proxy = updateData.url_proxy || null;

  let cfg = {};
  if (exists?.__config_json__ && typeof exists.__config_json__ === "object") {
    cfg = { ...exists.__config_json__ };
  }

  // 本型別 schema 中宣告的 secret 欄位集合
  const schema = getTypeConfigSchema(exists.storage_type);
  const secretFieldSet = new Set(getSecretFieldDefsFromSchema(schema).map((f) => f.name));
  const boolFieldSet = new Set(getBoolFieldDefsFromSchema(schema).map((f) => f.name));

  // 合併驅動 JSON 欄位
  for (const [k, v] of Object.entries(updateData)) {
    if (["name", "storage_type", "is_public", "is_default", "status", "remark", "url_proxy"].includes(k)) continue;

    // secret：空值/掩碼佔位符 -> 不提交（保留原值）；真實值 -> 加密寫入
    if (secretFieldSet.has(k)) {
      if (shouldSkipSecretWrite(v, { allowEmpty: true })) {
        continue;
      }
      // shouldSkipSecretWrite 已涵蓋 masked，這裡再次兜底
      if (isMaskedSecretPlaceholder(v)) {
        continue;
      }
      cfg[k] = await encryptValue(String(v), encryptionSecret);
      driverConfigChanged = true;
      continue;
    }

    driverConfigChanged = true;
    if (k === "total_storage_bytes") {
      const val = parseInt(v, 10);
      cfg.total_storage_bytes = Number.isFinite(val) && val > 0 ? val : null;
    } else if (k === "signature_expires_in") {
      const se = parseInt(v, 10);
      cfg.signature_expires_in = Number.isFinite(se) ? se : 3600;
    } else if (k === "endpoint_url") {
      let endpoint_url = String(v).trim();
      try {
        const parsed = new URL(endpoint_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new ValidationError("endpoint_url 格式無效，必須以 http:// 或 https:// 開頭");
        }
      } catch {
        throw new ValidationError("endpoint_url 不是合法的 URL");
      }
      cfg.endpoint_url = endpoint_url;
    } else if (k === "default_folder") {
      let folder = (v || "").toString().trim();
      folder = folder.replace(/^\/+/, "");
      cfg.default_folder = folder;
    } else {
      if (boolFieldSet.has(k)) {
        if (v === undefined || v === null) {
          continue;
        }
        cfg[k] = toBool(v, false) ? 1 : 0;
        continue;
      }
      cfg[k] = v;
    }
  }
  topPatch.config_json = JSON.stringify(cfg);

  await repo.updateConfig(id, topPatch);
  if (topPatch.is_default === 1) {
    await repo.setAsDefault(id, adminId);
  }

  try {
    const mountManager = new MountManager(db, encryptionSecret, factory);
    await mountManager.clearConfigCache(exists.storage_type, id);
  } catch {}

  // 如果驅動配置變化：把依賴此儲存配置的掛載點索引清掉 + 標記 not_ready
  if (driverConfigChanged) {
    try {
      const mountRepo = factory.getMountRepository();
      const mounts = await mountRepo.findByStorageConfig(id, exists.storage_type);
      const store = new FsSearchIndexStore(db);
      for (const m of mounts || []) {
        const mountId = String(m?.id || "").trim();
        if (!mountId) continue;
        await store.clearDerivedByMount(mountId, { keepState: true });
      }
      invalidateFsCache({ storageConfigId: id, reason: "storage-config-update", bumpMountsVersion: true, db });
    } catch (e) {
      console.warn("updateStorageConfig: 清理相關掛載點索引失敗（將繼續返回更新成功）：", e);
    }
  }
}

export async function deleteStorageConfig(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const aclRepo = factory.getPrincipalStorageAclRepository ? factory.getPrincipalStorageAclRepository() : null;

  const exists = await repo.findByIdAndAdmin(id, adminId);
  if (!exists) throw new NotFoundError("儲存配置不存在");

  // 先清理與該儲存配置相關的 ACL 繫結
  if (aclRepo) {
    try {
      await aclRepo.deleteByStorageConfigId(id);
    } catch (error) {
      console.warn("刪除儲存配置關聯的儲存 ACL 失敗，將繼續刪除儲存配置本身：", error);
    }
  }

  // 刪除儲存配置前：先把依賴它的掛載點與索引派生資料清掉
  // 否則會留下“掛載點指向不存在的儲存配置”+ “索引殘留”的髒資料
  try {
    const mountRepo = factory.getMountRepository();
    const mounts = await mountRepo.findByStorageConfig(id, exists.storage_type);
    const store = new FsSearchIndexStore(db);
    for (const m of mounts || []) {
      const mountId = String(m?.id || "").trim();
      if (!mountId) continue;
      await store.clearDerivedByMount(mountId, { keepState: false });
      await mountRepo.deleteMount(mountId);
      invalidateFsCache({ mountId, storageConfigId: id, reason: "mount-delete-by-storage-config", bumpMountsVersion: true, db });
    }
  } catch (error) {
    console.warn("deleteStorageConfig: 清理掛載點/索引失敗，將繼續刪除儲存配置本身：", error);
  }

  await repo.deleteConfig(id);
  invalidateFsCache({ storageConfigId: id, reason: "storage-config-delete", bumpMountsVersion: true, db });
}

export async function setDefaultStorageConfig(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const exists = await repo.findByIdAndAdmin(id, adminId);
  if (!exists) throw new NotFoundError("儲存配置不存在");
  await repo.setAsDefault(id, adminId);
}

// 驅動側連線測試（優先）
export async function testStorageConnection(db, id, adminId, encryptionSecret, requestOrigin = null, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  // 帶金鑰讀取（測試需要）
  const cfg = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!cfg) {
    throw new NotFoundError("儲存配置不存在");
  }
  const type = cfg.storage_type;
  if (!type) {
    throw new ValidationError("儲存配置缺少 storage_type");
  }
  const tester = StorageFactory.getTester(type);
  if (typeof tester === "function") {
    const traceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    try {
      console.log("[StorageTest:start]", { traceId, storageConfigId: id, storageType: type });
    } catch {}
    try {
      const res = await tester(cfg, encryptionSecret, requestOrigin);
      const durationMs = Date.now() - startedAt;

      const testData = normalizeStorageTestResult({ storageType: type, testerResult: res, durationMs });
      // 強制契約提示：如果 tester 沒有輸出 result.checks，會在 report.checks 裡注入 contract 失敗項。
      try {
        const report = testData?.report;
        const checks = Array.isArray(report?.checks) ? report.checks : [];
        const contractFailure = checks.find((c) => c && c.key === "contract" && c.success === false);
        if (contractFailure) {
          console.error("[StorageTest:contract]", {
            traceId,
            storageConfigId: id,
            storageType: type,
            durationMs,
            error: contractFailure.error || "tester 輸出契約不滿足",
          });
        }
      } catch {}
      // 標記最後使用時間
      try {
        await repo.updateLastUsed(id);
      } catch {}

      try {
        console.log("[StorageTest:end]", { traceId, storageConfigId: id, ...summarizeTestReportForLog(testData) });
      } catch {}

      return testData;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      try {
        console.log("[StorageTest:error]", {
          traceId,
          storageConfigId: id,
          storageType: type,
          durationMs,
          message: error?.message || String(error),
        });
      } catch {}
      if (error instanceof AppError) {
        throw error;
      }
      const message = error?.message || "儲存連通性測試失敗";
      throw new DriverError(message, { details: { cause: error?.message } });
    }
  }
  throw new NotFoundError(`未找到儲存型別的測試實現: ${type}`);
}
