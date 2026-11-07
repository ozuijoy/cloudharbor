import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定時重建 FS 搜尋索引（只負責建立 job，不做重活）
 * - 作為“業務可選項”，系統不預設建立 scheduled_jobs 記錄
 * - 管理員可在後臺顯式建立並啟用此 scheduled job
 */
export class ScheduledFsIndexRebuildTask {
  constructor() {
    /** @type {string} 用於 ScheduledTaskRegistry && scheduled_jobs.handler_id */
    this.id = "scheduled_fs_index_rebuild";

    /** @type {string} */
    this.name = "FS 搜尋索引重建";

    /** @type {string} */
    this.description =
      "按配置定期建立 fs_index_rebuild 作業，用於重建 FS 搜尋索引（Index-only 搜尋的寫入側）";

    /** @type {"maintenance" | "business"} */
    this.category = "business";

    /** @type {Array<object>} */
    this.configSchema = [
      {
        name: "mountIds",
        label: "掛載點ID列表（可選）",
        type: "textarea",
        defaultValue: "",
        required: false,
        description:
          "留空表示重建全部活躍掛載點；填寫時可用逗號/空格/換行分隔多個 mountId。",
      },
      {
        name: "batchSize",
        label: "批次寫入大小（可選）",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 20,
        max: 1000,
        description: "單次 upsert 的批次大小；越大寫入次數越少，但單批更重。",
      },
      {
        name: "maxDepth",
        label: "最大遍歷深度（可選）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 0,
        max: 1000,
        description:
          "從掛載根目錄算起：0 表示只掃根目錄本層；留空表示不限深度。",
      },
      {
        name: "maxMountsPerRun",
        label: "單次最多處理掛載點數（可選）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 1,
        max: 10000,
        description:
          "用於控制單次作業規模，避免過多掛載點導致一次重建不可控；留空表示不限制。",
      },
    ];
  }

  /**
   * @private
   * @param {any} rawConfig
   */
  _normalizeConfig(rawConfig) {
    const config = rawConfig || {};

    const mountIdsText = typeof config.mountIds === "string" ? config.mountIds : "";
    const mountIds = mountIdsText
      .split(/[\s,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);

    const batchSizeRaw = config.batchSize;
    let batchSize = Number(batchSizeRaw);
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      batchSize = 200;
    }
    batchSize = Math.max(20, Math.min(1000, Math.trunc(batchSize)));

    const maxDepthRaw = config.maxDepth;
    let maxDepth = null;
    if (maxDepthRaw !== "" && maxDepthRaw !== null && maxDepthRaw !== undefined) {
      const parsed = Number(maxDepthRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ValidationError("maxDepth 必須是 >=0 的整數或留空");
      }
      maxDepth = Math.trunc(parsed);
    }

    const maxMountsRaw = config.maxMountsPerRun;
    let maxMountsPerRun = null;
    if (maxMountsRaw !== "" && maxMountsRaw !== null && maxMountsRaw !== undefined) {
      const parsed = Number(maxMountsRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError("maxMountsPerRun 必須是正整數或留空");
      }
      maxMountsPerRun = Math.trunc(parsed);
    }

    return {
      mountIds: mountIds.length > 0 ? mountIds : null,
      options: {
        batchSize,
        maxDepth,
        maxMountsPerRun,
        refresh: true,
      },
    };
  }

  /**
   * @param {{ db: D1Database, env: any, now: string, config: any, scheduledJobId?: string }} ctx
   */
  async run(ctx) {
    const { db, env, now, config } = ctx;

    const normalized = this._normalizeConfig(config);

    const repositoryFactory = ensureRepositoryFactory(db);
    const mountManager = new MountManager(db, env?.ENCRYPTION_SECRET, repositoryFactory, { env });
    const fileSystem = new FileSystem(mountManager, env);

    // 後臺任務：使用管理員身份（管理員配置並啟用）
    const systemUserId = "system-scheduled-fs-index";
    const systemUserType = UserType.ADMIN;

    const payload = {
      ...(normalized.mountIds ? { mountIds: normalized.mountIds } : {}),
      options: normalized.options,
    };

    const job = await fileSystem.createJob(
      "fs_index_rebuild",
      payload,
      systemUserId,
      systemUserType,
      { triggerType: "scheduled", triggerRef: ctx?.scheduledJobId || this.id },
    );

    const summaryParts = [
      "已建立 FS 索引重建作業",
      normalized.mountIds ? `mounts=${normalized.mountIds.length}` : "mounts=all",
      `batchSize=${normalized.options.batchSize}`,
      `maxDepth=${normalized.options.maxDepth ?? "∞"}`,
      `jobId=${job.jobId}`,
    ];

    return {
      summary: summaryParts.join("；"),
      jobId: job.jobId,
      jobIds: [job.jobId],
      createdAt: new Date(now).toISOString(),
    };
  }
}
