/**
 * RefreshStorageUsageSnapshotsTask
 * - 定時重新整理 metrics_cache 中的儲存用量快照（computed_usage）
 *
 * 為什麼要做：
 * - 上傳校驗是熱路徑，不能每次都掃盤、也不能每次都打上游 API
 * - 所以改成：定時重新整理快照；上傳時只讀快照（快照不存在/讀不到就放行）
 *
 * 說明（對標 rclone about 的理解方式）：
 * - 這份“用量快照”只有一份：已用（usedBytes）+（可選）總量（totalBytes）
 * - 如果 storage 開了 enable_disk_usage 且驅動支援，上游會一次返回 total/used（同一次統計時間點）
 * - 否則就按 local_fs / vfs_nodes / fs_index 等來源兜底
 */

import { DbTables } from "../../constants/index.js";
import { RepositoryFactory } from "../../repositories/index.js";
import { StorageUsageService } from "../../storage/usage/StorageUsageService.js";

function nowMs() {
  return Date.now();
}

function getEncryptionSecretFromEnv(env) {
  const secret =
    (env && env.ENCRYPTION_SECRET) ||
    (typeof process !== "undefined" ? process.env?.ENCRYPTION_SECRET : null);
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET 未配置，無法重新整理儲存用量快照");
  }
  return secret;
}

function clampPositiveInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

async function runWithConcurrency(items, concurrency, fn) {
  const limit = Math.max(1, Math.min(10, clampPositiveInt(concurrency) || 1));
  const queue = Array.isArray(items) ? items.slice() : [];
  const results = [];

  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const it = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      const r = await fn(it);
      results.push(r);
    }
  });

  await Promise.all(workers);
  return results;
}

export class RefreshStorageUsageSnapshotsTask {
  constructor() {
    /** @type {string} 作業型別ID（handlerId） */
    this.id = "refresh_storage_usage_snapshots";
    /** @type {string} 名稱 */
    this.name = "重新整理儲存用量快照";
    /** @type {string} 描述 */
    this.description = "定時重新整理所有儲存配置的用量快照，用於面板配額分析與上傳限制校驗。";
    /** @type {"maintenance" | "business"} */
    this.category = "maintenance";

    /** @type {Array<any>} */
    this.configSchema = [
      {
        name: "maxItems",
        label: "單次最多重新整理多少個儲存",
        type: "number",
        defaultValue: 50,
        required: true,
        min: 1,
        max: 500,
        description: "防止一次性重新整理過多導致任務跑太久。",
      },
      {
        name: "maxConcurrency",
        label: "併發重新整理數",
        type: "number",
        defaultValue: 1,
        required: true,
        min: 1,
        max: 10,
        description: "併發越高越快，但也越容易打到上游限流；預設 1 最穩。",
      },
    ];
  }

  /**
   * @param {{ db: any, env: any, now: string, config: any, scheduledJobId?: string }} ctx
   */
  async run(ctx) {
    const db = ctx?.db;
    const env = ctx?.env || {};
    const config = ctx?.config || {};

    const maxItems = clampPositiveInt(config.maxItems) || 50;
    const maxConcurrency = clampPositiveInt(config.maxConcurrency) || 1;

    const encryptionSecret = getEncryptionSecretFromEnv(env);
    const factory = new RepositoryFactory(db, { env });
    const usage = new StorageUsageService(db, encryptionSecret, factory, { env });

    // 只取 id，避免 inflate 全配置帶來額外消耗
    const idsRes = await db
      .prepare(`SELECT id FROM ${DbTables.STORAGE_CONFIGS} ORDER BY updated_at DESC`)
      .all();
    const ids = (idsRes?.results || []).map((r) => r?.id).filter(Boolean).slice(0, maxItems);

    const startedMs = nowMs();

    let okCount = 0;
    let failCount = 0;

    await runWithConcurrency(ids, maxConcurrency, async (id) => {
      try {
        await usage.computeAndPersistSnapshot(String(id));
        okCount += 1;
      } catch (e) {
        failCount += 1;
        console.warn("[RefreshStorageUsageSnapshotsTask] 重新整理失敗:", { id, error: e?.message || e });
      }
      return null;
    });

    const durationMs = nowMs() - startedMs;
    const summary = `重新整理完成：成功 ${okCount} 個，失敗 ${failCount} 個，用時 ${durationMs}ms`;
    return {
      summary,
      okCount,
      failCount,
      total: ids.length,
      durationMs,
    };
  }
}
