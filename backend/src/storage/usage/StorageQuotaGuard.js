/**
 * StorageQuotaGuard
 *
 * - 限制上限：只看 cfg.total_storage_bytes（管理端配置的自定義上限，來自 storage_configs.config_json）
 * - 已使用：只讀 metrics_cache 的用量快照（computed_usage）
 *  上傳校驗時：查資料庫快照，有就校驗，沒有就放行
 */

import { ValidationError } from "../../http/errors.js";

const METRICS_SCOPE_STORAGE_CONFIG = "storage_config";
const METRICS_KEY_COMPUTED_USAGE = "computed_usage";

function toBytesMb(n) {
  const v = Number(n) || 0;
  return (v / (1024 * 1024)).toFixed(2).replace(/\.00$/g, "");
}

function clampPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function clampNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

export class StorageQuotaGuard {
  /**
   * @param {any} db
   * @param {string} encryptionSecret
   * @param {any} repositoryFactory
   * @param {{ env?: any }} [options]
   */
  constructor(db, encryptionSecret, repositoryFactory, options = {}) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.env = options?.env || null;
  }

  /**
   * 斷言：本次寫入不會超出自定義上限
   * @param {Object} params
   * @param {string} params.storageConfigId
   * @param {number} params.incomingBytes
   * @param {number|null} [params.oldBytes]
   * @param {string} [params.context] 日誌/錯誤上下文
   */
  async assertCanConsume({ storageConfigId, incomingBytes, oldBytes = null, context = "" }) {
    const storageId = String(storageConfigId || "").trim();
    const incoming = clampPositiveInt(incomingBytes);
    if (!storageId || !incoming) return;

    const repo = this.repositoryFactory?.getStorageConfigRepository?.();
    if (!repo || typeof repo.findById !== "function") return;
    const cfg = await repo.findById(storageId).catch(() => null);
    if (!cfg) return;

    const limit = clampPositiveInt(cfg.total_storage_bytes);
    if (!limit) return; // 未配置上限（或為 0）= 不限額

    // 效能策略：上傳攔截只讀 metrics_cache（快照），不做同步計算/上游請求/掃盤
    const metricsRepo = this.repositoryFactory?.getMetricsCacheRepository?.();
    if (!metricsRepo || typeof metricsRepo.getEntry !== "function") {
      return;
    }

    const row = await metricsRepo
      .getEntry(METRICS_SCOPE_STORAGE_CONFIG, storageId, METRICS_KEY_COMPUTED_USAGE)
      .catch(() => null);

    const used = clampNonNegativeInt(row?.value_num);
    // 快照缺失/讀不到 usedBytes -> 放行不攔截
    if (used == null) return;

    const old = oldBytes != null ? Math.max(0, Math.floor(Number(oldBytes) || 0)) : null;
    const effectiveIncoming = old != null ? Math.max(0, incoming - old) : incoming;

    const after = used + effectiveIncoming;
    if (after <= limit) return;

    const remaining = Math.max(0, limit - used);
    const msg =
      `儲存空間不足：剩餘 ${toBytesMb(remaining)} MB，本次寫入需要 ${toBytesMb(effectiveIncoming)} MB` +
      (context ? `（${context}）` : "");
    throw new ValidationError(msg);
  }
}
