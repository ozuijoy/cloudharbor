/**
 * StorageUsageService
 *
 * 目標（對標 rclone about 的思路）：
 * - 我們只產出一份“用量（Usage）快照”：usedBytes +（可選）totalBytes，並且只有一個更新時間
 * - “自定義限額（total_storage_bytes）”是獨立概念：用於上傳攔截（StorageQuotaGuard）
 * - 上游如果支援並且 storage 配置勾選了 enable_disk_usage，就在同一次統計裡把 total/used 一起拿到
 *
 * 計算順序（已用 usedBytes）：
 * - LOCAL：local_fs(掃掛載目錄實際佔用) -> vfs_nodes -> fs_index
 * - 其它：provider.used -> vfs_nodes -> fs_index
 *
 * 重要約束：
 * - 上傳攔截是熱路徑：不能在熱路徑裡掃盤，也不能在熱路徑裡打上游 API
 * - 所以“打上游/掃盤”只允許發生在“重新整理快照（computeAndPersistSnapshot）”裡
 */

import fs from "fs";
import path from "path";

import { ValidationError } from "../../http/errors.js";
import { StorageFactory } from "../factory/StorageFactory.js";
import { FsSearchIndexStore } from "../fs/search/FsSearchIndexStore.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment } from "../../utils/environmentUtils.js";
import { DbTables } from "../../constants/index.js";

const PROVIDER_QUOTA_CACHE_TTL_MS = 60 * 1000;
const LOCAL_DU_CACHE_TTL_MS = 60 * 1000;
const COMPUTED_USAGE_CACHE_TTL_MS = 10 * 1000;

// 防止 provider 配額介面卡死：預設最多等 6 秒（超時視為“不支援/不可用”，繼續走後續層兜底）
const PROVIDER_QUOTA_MAX_MS = 6 * 1000;

// 防止 LOCAL 掃目錄卡死：預設 10 秒、最多 50 萬個條目
const LOCAL_DU_MAX_MS = 10 * 1000;
const LOCAL_DU_MAX_ENTRIES = 500_000;

// 程序內快取（跨 StorageUsageService 例項共享）
// - Workers 多例項/冷啟動時會丟失，但能顯著降低“同一例項內反覆讀上游 quota”的頻率
const providerQuotaCache = new Map(); // key -> { value, expiresAtMs }
const localDuCache = new Map(); // key -> { value, expiresAtMs }
const localDuInFlight = new Map(); // key -> Promise

// 已使用快取（短 TTL）：避免 multipart/upload-chunk 這類高頻入口重複跑 SQL/du
const computedUsageCache = new Map(); // key -> { value, expiresAtMs }

function nowMs() {
  return Date.now();
}

function clampNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

function safeString(value) {
  return value == null ? "" : String(value);
}

function clampPercentInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return 0;
  if (i > 100) return 100;
  return i;
}

function buildProviderQuotaSummary(quota) {
  if (!quota || typeof quota !== "object") return null;

  // 統一對外欄位命名（參考 rclone about：Total/Used/Free...）
  const totalBytes = clampNonNegativeInt(quota.totalBytes);
  const usedBytes = clampNonNegativeInt(quota.usedBytes);
  const remainingBytes = clampNonNegativeInt(quota.remainingBytes);
  const deletedBytes = clampNonNegativeInt(quota.deletedBytes);
  const trashBytes = clampNonNegativeInt(quota.trashBytes);
  const driveBytes = clampNonNegativeInt(quota.driveBytes);

  // 各驅動內部可能用 usagePercent/percentUsed，統一成 percentUsed
  const percentUsed = clampPercentInt(quota.percentUsed ?? quota.usagePercent);
  const state = typeof quota.state === "string" && quota.state.trim() ? quota.state.trim() : null;

  const summary = {
    totalBytes,
    usedBytes,
    remainingBytes,
    deletedBytes,
    trashBytes,
    driveBytes,
    percentUsed,
    state,
  };

  // 清掉全空物件，避免前端/儲存被無意義欄位汙染
  const hasAny = Object.values(summary).some((v) => v != null);
  return hasAny ? summary : null;
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  const ms = Number(timeoutMs) || 0;
  if (!ms || ms <= 0) {
    return await promise;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage || "操作超時"));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildQuotaSupportedFalse(base, message) {
  return {
    ...base,
    supported: false,
    message: typeof message === "string" && message.trim() ? message.trim() : "配額資訊不可用",
    error: base?.error ?? null,
  };
}

export class StorageUsageService {
  /**
   * @param {any} db D1Database / SQLiteAdapter
   * @param {string} encryptionSecret
   * @param {any} repositoryFactory
   * @param {{ env?: any }} [options]
   */
  constructor(db, encryptionSecret, repositoryFactory, options = {}) {
    if (!db) {
      throw new ValidationError("StorageUsageService: 缺少 db");
    }
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.env = options?.env || null;
  }

  /**
   * 重新整理並寫入“用量快照（Usage）”
   * - 對標 rclone about：如果上游支援，則 details.quota 同時帶 total/used
   * - 注意：這是“寫入快取”的方法，不要在上傳熱路徑直接呼叫
   *
   * @param {string} storageConfigId
   * @param {{
   *   allowProviderInUsage?: boolean
   * }} [options]
   */
  async computeAndPersistSnapshot(storageConfigId, options = {}) {
    const id = safeString(storageConfigId).trim();
    if (!id) {
      return { ok: false, message: "缺少 storageConfigId" };
    }

    // 說明（按你最新確認的“簡單理念”）：
    // - 上傳校驗只看“資料庫裡有沒有快照值”，不再引入“過期”概念
    // - 是否及時更新由定時任務頻率/手動重新整理決定
    const allowProviderInUsage = options?.allowProviderInUsage !== false;

    const metricsRepo = this.repositoryFactory?.getMetricsCacheRepository?.();
    if (!metricsRepo) {
      return { ok: false, message: "MetricsCacheRepository 不可用" };
    }

    const now = nowMs();

    const computed = await this.computeUsage(id, { allowProvider: allowProviderInUsage }).catch(() => null);
    if (computed && clampNonNegativeInt(computed.usedBytes) != null && safeString(computed.source).trim()) {
      const detailsJsonText =
        computed.details && typeof computed.details === "object" ? JSON.stringify(computed.details) : null;

      await metricsRepo.upsertEntry({
        scopeType: "storage_config",
        scopeId: id,
        metricKey: "computed_usage",
        valueNum: clampNonNegativeInt(computed.usedBytes),
        valueText: safeString(computed.source).trim(),
        valueJsonText: detailsJsonText,
        snapshotAtMs: now,
        updatedAtMs: now,
        errorMessage: null,
      });

      return { ok: true, message: "快照重新整理成功", computed };
    }

    // 算不出來：不清空舊快照（避免“之前還有資料，突然變沒了”）
    const existing = await metricsRepo.getEntry("storage_config", id, "computed_usage").catch(() => null);

    await metricsRepo.upsertEntry({
      scopeType: "storage_config",
      scopeId: id,
      metricKey: "computed_usage",
      valueNum: existing?.value_num ?? null,
      valueText: existing?.value_text ?? null,
      valueJsonText: existing?.value_json_text ?? null,
      snapshotAtMs: existing?.snapshot_at_ms ?? null,
      updatedAtMs: now,
      errorMessage: "無法計算用量（所有來源均不可用）",
    });

    return { ok: true, message: "快照已重新整理，但未能計算用量", computed: null };
  }

  /**
   * 讀取 storage_config（含 secrets，便於 driver 初始化）
   * @param {string} storageConfigId
   */
  async _getStorageConfigWithSecrets(storageConfigId) {
    const repo = this.repositoryFactory?.getStorageConfigRepository?.();
    if (!repo || typeof repo.findByIdWithSecrets !== "function") {
      throw new ValidationError("StorageUsageService: StorageConfigRepository 不可用");
    }
    const cfg = await repo.findByIdWithSecrets(storageConfigId).catch(() => null);
    if (!cfg) {
      throw new ValidationError("儲存配置不存在");
    }
    return cfg;
  }

  /**
   * ProviderQuota：從 driver.getStats().quota 抽取（best-effort）
   * @param {string} storageConfigId
   * @param {{ ignoreEnableDiskUsage?: boolean }} [options]
   * @returns {Promise<{supported:boolean, quota?:any, message?:string, snapshotAt?:string}>}
   */
  async getProviderQuota(storageConfigId, options = {}) {
    const id = safeString(storageConfigId).trim();
    if (!id) {
      return buildQuotaSupportedFalse({}, "缺少 storage_config_id");
    }

    const cacheKey = id;
    const cached = providerQuotaCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    // 只用快取：上傳攔截等場景不允許因為“拉上游 quota”而阻塞
    if (options?.cacheOnly === true) {
      return buildQuotaSupportedFalse({ type: null }, "上游配額未快取（cacheOnly）");
    }

    const cfg = await this._getStorageConfigWithSecrets(id);

    // 約定：上游 quota 必須顯式開啟 enable_disk_usage 才會去請求上游
    const enableDiskUsage = cfg?.enable_disk_usage === 1;
    if (options?.ignoreEnableDiskUsage !== true && !enableDiskUsage) {
      const value = buildQuotaSupportedFalse(
        {
          type: cfg.storage_type,
          initialized: true,
          capabilities: [],
          timestamp: new Date().toISOString(),
        },
        "磁碟佔用統計未啟用（enable_disk_usage = false）",
      );
      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    }

    try {
      const driver = await StorageFactory.createDriver(cfg.storage_type, cfg, this.encryptionSecret);
      if (!driver || typeof driver.getStats !== "function") {
        const value = buildQuotaSupportedFalse({ type: cfg.storage_type }, "驅動未實現 getStats，無法讀取配額");
        providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
        return value;
      }

      const stats = await withTimeout(
        driver.getStats(),
        PROVIDER_QUOTA_MAX_MS,
        `讀取上游配額超時（>${Math.round(PROVIDER_QUOTA_MAX_MS / 1000)}s）`,
      );
      const quota = stats?.quota || null;
      const supported = stats?.supported === true;

      const value = supported
        ? {
            supported: true,
            quota,
            snapshotAt: new Date().toISOString(),
          }
        : buildQuotaSupportedFalse(
            { type: cfg.storage_type },
            typeof stats?.message === "string" ? stats.message : "上游未提供配額資訊",
          );

      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    } catch (error) {
      const value = buildQuotaSupportedFalse(
        { type: cfg.storage_type, error: error?.message ? String(error.message) : String(error) },
        error?.message ? `讀取上游配額失敗：${error.message}` : "讀取上游配額失敗",
      );
      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    }
  }

  /**
   * vfs_nodes used（storage_config scope）
   * @param {string} storageConfigId
   * @returns {Promise<number|null>}
   */
  async getVfsNodesUsedBytes(storageConfigId) {
    const id = safeString(storageConfigId).trim();
    if (!id) return null;

    // 只統計“檔案節點”的 size；目錄 size 為 null
    // 注意：如果一個 storage_config 完全沒有任何 vfs 檔案節點，
    // 說明 vfs_nodes 並不是它的事實來源，此時應該返回 null，讓後續層（local/fs_index）繼續兜底。
    const row = await this.db
      .prepare(
        `
        SELECT
          COUNT(1) AS file_count,
          COALESCE(SUM(COALESCE(size, 0)), 0) AS total_size
        FROM ${DbTables.VFS_NODES}
        WHERE scope_type = 'storage_config'
          AND scope_id = ?
          AND node_type = 'file'
          AND status = 'active'
      `,
      )
      .bind(id)
      .first()
      .catch(() => null);

    const fileCount = clampNonNegativeInt(row?.file_count);
    if (!fileCount) {
      return null;
    }
    const n = clampNonNegativeInt(row?.total_size);
    return n != null ? n : null;
  }

  /**
   * fs_search_index_entries used（按 storage_config 聚合其所有 mounts）
   * - 這是派生資料，可能滯後
   *
   * @param {string} storageConfigId
   * @param {string} storageType
   * @returns {Promise<{usedBytes:number|null, staleMountIds:string[]}>}
   */
  async getFsIndexUsedBytes(storageConfigId, storageType) {
    const id = safeString(storageConfigId).trim();
    const type = safeString(storageType).trim();
    if (!id || !type) return { usedBytes: null, staleMountIds: [] };

    const mountRepo = this.repositoryFactory?.getMountRepository?.();
    if (!mountRepo || typeof mountRepo.findByStorageConfig !== "function") {
      return { usedBytes: null, staleMountIds: [] };
    }

    const mounts = await mountRepo.findByStorageConfig(id, type).catch(() => []);
    const mountIds = Array.isArray(mounts)
      ? mounts
          .map((m) => (m?.id ? String(m.id) : ""))
          .filter((m) => m && m.trim())
      : [];

    if (mountIds.length === 0) {
      return { usedBytes: null, staleMountIds: [] };
    }

    const store = new FsSearchIndexStore(this.db);
    const states = await store.getIndexStates(mountIds);
    const dirties = await store.getDirtyCounts(mountIds);

    // 只統計 ready 的掛載點（否則索引根本不存在/未完成）
    const readyMountIds = mountIds.filter((mid) => {
      const st = states.get(mid);
      return String(st?.status || "") === "ready";
    });
    if (readyMountIds.length === 0) {
      return { usedBytes: null, staleMountIds: [] };
    }

    // 標記可能滯後：dirty>0 的掛載點
    const staleMountIds = readyMountIds.filter((mid) => {
      const d = dirties.get(mid);
      return Number(d || 0) > 0;
    });

    const placeholders = readyMountIds.map(() => "?").join(", ");
    const sql = `
      SELECT mount_id, COALESCE(SUM(CASE WHEN is_dir = 0 THEN size ELSE 0 END), 0) AS total_size
      FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES}
      WHERE mount_id IN (${placeholders})
      GROUP BY mount_id
    `;
    const resp = await this.db.prepare(sql).bind(...readyMountIds).all().catch(() => null);
    const rows = Array.isArray(resp?.results) ? resp.results : [];
    const sum = rows.reduce((acc, r) => acc + (clampNonNegativeInt(r?.total_size) || 0), 0);
    return { usedBytes: clampNonNegativeInt(sum) ?? null, staleMountIds };
  }

  /**
   * local_fs used：掃 root_path 實際佔用（du）
   * @param {any} storageConfig
   * @returns {Promise<number|null>}
   */
  async getLocalFsUsedBytes(storageConfig) {
    if (!storageConfig || String(storageConfig.storage_type) !== "LOCAL") return null;

    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      return null;
    }

    const rootPathRaw = storageConfig?.root_path;
    if (!rootPathRaw || typeof rootPathRaw !== "string") return null;
    if (!path.isAbsolute(rootPathRaw)) return null;

    const rootPath = path.resolve(rootPathRaw);
    const cacheKey = rootPath;
    const cached = localDuCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    const inFlight = localDuInFlight.get(cacheKey);
    if (inFlight) {
      return await inFlight.catch(() => null);
    }

    const promise = this._scanDirectoryDu(rootPath)
      .then((bytes) => {
        const value = bytes != null ? bytes : null;
        localDuCache.set(cacheKey, { value, expiresAtMs: nowMs() + LOCAL_DU_CACHE_TTL_MS });
        return value;
      })
      .finally(() => {
        localDuInFlight.delete(cacheKey);
      });

    localDuInFlight.set(cacheKey, promise);
    return await promise.catch(() => null);
  }

  async _scanDirectoryDu(rootPath) {
    const startedAt = nowMs();
    let total = 0;
    let entries = 0;
    /** @type {string[]} */
    const stack = [rootPath];

    while (stack.length) {
      if (nowMs() - startedAt > LOCAL_DU_MAX_MS) {
        return null;
      }
      if (entries > LOCAL_DU_MAX_ENTRIES) {
        return null;
      }

      const current = stack.pop();
      if (!current) continue;

      let dirents;
      try {
        dirents = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        // 目錄不可讀：直接跳過（best-effort）
        continue;
      }

      for (const d of dirents) {
        entries += 1;
        if (entries > LOCAL_DU_MAX_ENTRIES) {
          return null;
        }
        if (nowMs() - startedAt > LOCAL_DU_MAX_MS) {
          return null;
        }

        const full = path.join(current, d.name);
        if (d.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (d.isFile()) {
          try {
            const st = await fs.promises.stat(full);
            const sz = clampNonNegativeInt(st?.size);
            if (sz != null) total += sz;
          } catch {
            // 檔案不可 stat：跳過
          }
        }
      }
    }

    return clampNonNegativeInt(total);
  }

  /**
   * 計算 ComputedUsage（用於展示/攔截）
   * 順序（你最新的分層選擇）：
   * - LOCAL：local_fs(掃掛載目錄實際佔用) -> vfs_nodes -> fs_index
   * - 其它：provider.used -> vfs_nodes -> fs_index
   *
   * @param {string} storageConfigId
   * @param {{ allowProvider?: boolean }} [options]
   * @returns {Promise<{usedBytes:number, source:"provider"|"vfs_nodes"|"local_fs"|"fs_index", details?:any}|null>}
   */
  async computeUsage(storageConfigId, options = {}) {
    const cacheKey = `${safeString(storageConfigId).trim()}|${String(options?.allowProvider ?? true)}`;
    const cached = computedUsageCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    const cfg = await this._getStorageConfigWithSecrets(storageConfigId);
    const storageType = String(cfg?.storage_type || "").toUpperCase();
    const isLocal = storageType === "LOCAL";
    const enableDiskUsage = cfg?.enable_disk_usage === 1;

    // 1) LOCAL：local_fs（掃目錄實際佔用）
    // 約定：只有啟用了 enable_disk_usage 才會掃盤（否則走 vfs_nodes / fs_index，避免無謂 IO）
    if (isLocal && enableDiskUsage) {
      const localUsed = await this.getLocalFsUsedBytes(cfg).catch(() => null);
      if (localUsed != null) {
        const value = { usedBytes: localUsed, source: "local_fs" };
        computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
        return value;
      }
    }

    // 2) 其它儲存：provider.used（上游提供）
    if (!isLocal) {
      const allowProviderMode = options?.allowProvider ?? true; // true | false | "cached"
      if (allowProviderMode !== false) {
        const provider = await this.getProviderQuota(storageConfigId, { cacheOnly: allowProviderMode === "cached" }).catch(() => null);
        const providerQuota = buildProviderQuotaSummary(provider?.quota);
        const providerUsed = clampNonNegativeInt(providerQuota?.usedBytes);
        if (provider && provider.supported === true && providerUsed != null) {
          const value = {
            usedBytes: providerUsed,
            source: "provider",
            details: providerQuota ? { quota: providerQuota } : undefined,
          };
          computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
          return value;
        }
      }
    }

    // 3) vfs_nodes（事實索引）
    const vfsUsed = await this.getVfsNodesUsedBytes(storageConfigId).catch(() => null);
    if (vfsUsed != null) {
      const value = { usedBytes: vfsUsed, source: "vfs_nodes" };
      computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
      return value;
    }

    // 4) fs_index（派生索引）
    const indexRes = await this.getFsIndexUsedBytes(storageConfigId, cfg.storage_type).catch(() => ({ usedBytes: null, staleMountIds: [] }));
    const idxUsed = clampNonNegativeInt(indexRes?.usedBytes);
    if (idxUsed != null) {
      const value = { usedBytes: idxUsed, source: "fs_index", details: { staleMountIds: indexRes?.staleMountIds || [] } };
      computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
      return value;
    }

    computedUsageCache.set(cacheKey, { value: null, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
    return null;
  }
}
