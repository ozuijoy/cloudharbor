import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定時應用 FS 搜尋索引 dirty（只負責建立 job，不做重活）
 * - 作為“業務可選項”，系統不預設建立 scheduled_jobs 記錄
 */
export class ScheduledFsIndexApplyDirtyTask {
  constructor() {
    this.id = "scheduled_fs_index_apply_dirty";
    this.name = "FS 搜尋索引增量應用（dirty）";
    this.description = "按配置定期建立 fs_index_apply_dirty 作業，消費 dirty 佇列以更新索引";
    this.category = "business";
    this.configSchema = [
      {
        name: "mountIds",
        label: "掛載點ID列表（可選）",
        type: "textarea",
        defaultValue: "",
        required: false,
        description: "留空表示消費全部 mount 的 dirty；填寫可用逗號/空格/換行分隔。",
      },
      {
        name: "batchSize",
        label: "單次拉取 dirty 數量（可選）",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 10,
        max: 2000,
        description: "單次從 dirty 表拉取的最大條數。",
      },
      {
        name: "maxItems",
        label: "單次作業最大處理條數（可選）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 1,
        max: 100000,
        description: "用於限制單次作業規模；留空表示不限制。",
      },
      {
        name: "rebuildDirectorySubtree",
        label: "目錄變更遞迴重建子樹",
        type: "boolean",
        defaultValue: true,
        required: false,
        description: "目錄 upsert 時是否遞迴掃描該目錄子樹（用於處理目錄 rename/move 等結構性變更）。",
      },
      {
        name: "maxDepth",
        label: "目錄子樹最大深度（可選）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 0,
        max: 1000,
        description: "相對 dirty 目錄的最大掃描深度；留空表示不限制。",
      },
    ];
  }

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
    batchSize = Math.max(10, Math.min(2000, Math.trunc(batchSize)));

    const maxItemsRaw = config.maxItems;
    let maxItems = null;
    if (maxItemsRaw !== "" && maxItemsRaw !== null && maxItemsRaw !== undefined) {
      const parsed = Number(maxItemsRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError("maxItems 必須是正整數或留空");
      }
      maxItems = Math.trunc(parsed);
    }

    const rebuildDirectorySubtree = config.rebuildDirectorySubtree !== false;

    const maxDepthRaw = config.maxDepth;
    let maxDepth = null;
    if (maxDepthRaw !== "" && maxDepthRaw !== null && maxDepthRaw !== undefined) {
      const parsed = Number(maxDepthRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ValidationError("maxDepth 必須是 >=0 的整數或留空");
      }
      maxDepth = Math.trunc(parsed);
    }

    return {
      mountIds: mountIds.length > 0 ? mountIds : null,
      options: {
        batchSize,
        maxItems,
        rebuildDirectorySubtree,
        maxDepth,
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

    const systemUserId = "system-scheduled-fs-index";
    const systemUserType = UserType.ADMIN;

    const payload = {
      ...(normalized.mountIds ? { mountIds: normalized.mountIds } : {}),
      options: normalized.options,
    };

    const job = await fileSystem.createJob(
      "fs_index_apply_dirty",
      payload,
      systemUserId,
      systemUserType,
      { triggerType: "scheduled", triggerRef: ctx?.scheduledJobId || this.id },
    );

    const summaryParts = [
      "已建立 FS 索引 dirty 應用作業",
      normalized.mountIds ? `mounts=${normalized.mountIds.length}` : "mounts=all",
      `batchSize=${normalized.options.batchSize}`,
      `maxItems=${normalized.options.maxItems ?? "∞"}`,
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
