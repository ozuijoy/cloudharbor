import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定時同步任務（基於 copy 作業的單向同步）
 * - 透過 ScheduledJobs 框架排程
 * - 透過 FS Job 系統建立 taskType = "copy" 的作業
 * - 不在 handler 內直接執行長時間複製
 */
export class ScheduledSyncCopyTask {
  constructor() {
    /** @type {string} 任務唯一標識（用於 ScheduledTaskRegistry && scheduled_jobs.handler_id） */
    this.id = "scheduled_sync_copy";

    /** @type {string} 任務顯示名稱 */
    this.name = "儲存同步";

    /** @type {string} 任務描述 */
    this.description =
      "按配置定期建立跨驅動復製作業，實現單向同步（只複製新增/更新檔案，不刪除目標）";

    /** @type {\"maintenance\" | \"business\"} 任務類別 */
    this.category = "business";

    /**
     * 配置引數 Schema（供前端表單動態渲染）
     * @type {Array<{
     *   name: string,
     *   label: string,
     *   type: \"string\" | \"number\" | \"boolean\" | \"select\" | \"textarea\",
     *   defaultValue: any,
     *   required: boolean,
     *   min?: number,
     *   max?: number,
     *   options?: Array<{ value: any, label: string }>,
     *   description?: string
     * }>}
     */
    this.configSchema = [
      // 注意：sourcePath 和 targetPath 欄位已由前端專用 UI 處理
      // 前端 SyncTaskConfigForm 元件會自動生成這些欄位
      // 這裡保留空陣列，表示使用專用配置介面
    ];
  }

  /**
   * 解析配置，返回標準化的 { items, options, meta }
   * @private
   * @param {any} rawConfig
   */
  _normalizeConfig(rawConfig) {
    const config = rawConfig || {};

    // 顯式拒絕非 copyNew 模式（為未來擴充套件 mirror 等模式預留）
    if (config.mode && config.mode !== "copyNew") {
      throw new ValidationError(
        `當前僅支援 mode=\"copyNew\" 的單向同步，不支援模式: ${String(
          config.mode,
        )}`,
      );
    }

    const items = [];
    const MAX_PAIRS_PER_RUN = 100;

    // 高階模式：config.pairs 陣列
    if (Array.isArray(config.pairs) && config.pairs.length > 0) {
      for (const pair of config.pairs) {
        if (!pair || typeof pair.sourcePath !== "string" || typeof pair.targetPath !== "string") {
          continue;
        }
        if (!pair.sourcePath.trim() || !pair.targetPath.trim()) {
          continue;
        }
        items.push({
          sourcePath: pair.sourcePath.trim(),
          targetPath: pair.targetPath.trim(),
        });
        if (items.length >= MAX_PAIRS_PER_RUN) {
          break;
        }
      }
    } else if (config.sourcePath && config.targetPath) {
      // 簡單模式：單 pair
      if (
        typeof config.sourcePath === "string" &&
        typeof config.targetPath === "string" &&
        config.sourcePath.trim() &&
        config.targetPath.trim()
      ) {
        items.push({
          sourcePath: config.sourcePath.trim(),
          targetPath: config.targetPath.trim(),
        });
      }
    }

    if (items.length === 0) {
      throw new ValidationError(
        "同步任務配置錯誤：請至少提供一組有效的 sourcePath/targetPath 或 pairs 陣列。",
      );
    }

    const skipExisting =
      config.skipExisting === undefined ? true : Boolean(config.skipExisting);

    let maxConcurrency = Number(config.maxConcurrency) || 5;
    if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
      maxConcurrency = 5;
    }
    if (maxConcurrency > 32) {
      maxConcurrency = 32;
    }

    const options = {
      skipExisting,
      maxConcurrency,
    };

    return {
      items,
      options,
      meta: {
        mode: "copyNew",
        pairsCount: items.length,
        truncated:
          Array.isArray(config.pairs) && config.pairs.length > MAX_PAIRS_PER_RUN,
      },
    };
  }

  /**
   * 執行同步任務：只負責建立 copy Job，不直接複製檔案
   * @param {{ db: D1Database, env: any, now: string, config: any, scheduledJobId?: string }} ctx
   */
  async run(ctx) {
    const { db, env, now, config } = ctx;

    const { items, options, meta } = this._normalizeConfig(config);

    // 構造 FileSystem（與 JobWorkflow 中的邏輯保持一致）
    const repositoryFactory = ensureRepositoryFactory(db);
    const mountManager = new MountManager(
      db,
      env?.ENCRYPTION_SECRET,
      repositoryFactory,
      { env },
    );
    const fileSystem = new FileSystem(mountManager, env);

    // 內部系統身份：用於繞過基於 API Key 的掛載許可權限制
    // 注意：Scheduled Sync 視為後臺系統級操作，由管理員配置後啟用
    const systemUserId = "system-scheduled-sync";
    const systemUserType = UserType.ADMIN; // 使用管理員身份，繞過掛載 ACL 限制

    const jobPayload = {
      items,
      options,
    };

    const job = await fileSystem.createJob(
      "copy",
      jobPayload,
      systemUserId,
      systemUserType,
      { triggerType: "scheduled", triggerRef: ctx?.scheduledJobId || this.id },
    );

    const summaryParts = [
      // 面向管理員的人類可讀摘要，避免暴露內部作業 ID 細節
      `已建立跨驅動同步作業（複製任務）`,
      `路徑對數量=${items.length}`,
      options.skipExisting
        ? "同步模式=增量（僅複製新增/更新檔案）"
        : "同步模式=全量（目標存在時嘗試覆蓋）",
      `作業內併發=${options.maxConcurrency}`,
      `copy 作業 ID=${job.jobId}`,
    ];
    if (meta.truncated) {
      summaryParts.push(
        "超過最大 pairs 數，本次已截斷（部分路徑未納入本次同步）",
      );
    }

    return {
      summary: summaryParts.join("；"),
      jobId: job.jobId,
      jobIds: [job.jobId],
      mode: meta.mode,
      itemsCount: items.length,
      options,
      createdAt: new Date(now).toISOString(),
    };
  }
}
