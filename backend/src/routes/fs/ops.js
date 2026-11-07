import { ValidationError, NotFoundError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { useRepositories } from "../../utils/repositories.js";
import { usePolicy } from "../../security/policies/policies.js";
import { jobTypeCatalog } from "../../storage/fs/tasks/JobTypeCatalog.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const renamePathResolver = (c) => {
  const body = c.get("jsonBody");
  return [body?.oldPath, body?.newPath].filter(Boolean);
};

const listPathsResolver = (field) => (c) => {
  const body = c.get("jsonBody");
  const value = body?.[field];
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const copyItemsResolver = (c) => {
  const body = c.get("jsonBody");
  const items = body?.payload?.items ?? body?.items ?? null;
  if (!items) {
    return [];
  }
  const targets = [];
  for (const item of items) {
    if (item?.sourcePath) {
      targets.push(item.sourcePath);
    }
    if (item?.targetPath) {
      targets.push(item.targetPath);
    }
  }
  return targets;
};

const dynamicJobPolicy = async (c, next) => {
  const body = c.get("jsonBody") || {};
  const taskTypeRaw = body.taskType ?? body.task_type ?? "copy";
  const taskType = String(taskTypeRaw || "").trim();

  const def = jobTypeCatalog.tryGet(taskType);
  if (!def) {
    throw new ValidationError(`不支援的任務型別: ${taskType || "(empty)"}`);
  }

  const policy = def.createPolicy?.policy;
  const pathCheck = def.createPolicy?.pathCheck === true;
  if (!policy) {
    throw new ValidationError(`任務型別未配置 createPolicy: ${taskType}`);
  }

  // 目前只有 copy 需要路徑鑑權
  if (policy === "fs.copy") {
    return usePolicy("fs.copy", { pathResolver: copyItemsResolver })(c, next);
  }

  if (pathCheck) {
    throw new ValidationError(`任務型別 createPolicy.pathCheck 暫不支援非 copy: ${taskType}`);
  }

  return usePolicy(policy, { pathCheck: false })(c, next);
};

export const registerOpsRoutes = (router, helpers) => {
  const { getServiceParams } = helpers;

  // ========== Job Types API (for UI discovery) ==========
  // 返回“當前使用者可見”的任務型別清單
  router.get("/api/fs/job-types", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);

    const permissions = typeof userIdOrInfo === "object" ? userIdOrInfo?.permissions : undefined;
    const defs = jobTypeCatalog.listVisibleTypes({ userType, permissions });

    const types = defs.map((d) => ({
      taskType: d.taskType,
      i18nKey: d.i18nKey || null,
      displayName: d.displayName || null,
      category: d.category || null,
      capabilities: d.capabilities || null,
    }));

    return jsonOk(c, { types });
  });

  router.post("/api/fs/rename", parseJsonBody, usePolicy("fs.rename", { pathResolver: renamePathResolver }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const oldPath = body.oldPath;
    const newPath = body.newPath;

    if (!oldPath || !newPath) {
      throw new ValidationError("請提供原路徑和新路徑");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.renameItem(oldPath, newPath, userIdOrInfo, userType);

    return jsonOk(c, undefined, "重新命名成功");
  });

  router.delete("/api/fs/batch-remove", parseJsonBody, usePolicy("fs.delete", { pathResolver: listPathsResolver("paths") }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const paths = body.paths;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      throw new ValidationError("請提供有效的路徑陣列");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.batchRemoveItems(paths, userIdOrInfo, userType);

    return jsonOk(c, result, "批次刪除成功");
  });

  router.post("/api/fs/batch-copy", parseJsonBody, usePolicy("fs.copy", { pathResolver: copyItemsResolver }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const items = body.items;
    const skipExisting = body.skipExisting !== false;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError("請提供有效的複製項陣列");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });

    // ========== 統一任務模式 ==========
    // 所有複製操作統一建立任務，無條件分支
    // 複製策略由 CopyTaskHandler 內部決策
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobDescriptor = await fileSystem.createJob(
      'copy',
      { items, options: { skipExisting } },
      userIdOrInfo,
      userType
    );

    return jsonOk(
      c,
      {
        jobId: jobDescriptor.jobId,
        taskType: jobDescriptor.taskType,
        status: jobDescriptor.status,
        stats: jobDescriptor.stats,
        createdAt: jobDescriptor.createdAt,
      },
      "復製作業已建立"
    );
  });

  // ========== 通用作業 API (Generic Job System) ==========

  router.post("/api/fs/jobs", parseJsonBody, dynamicJobPolicy, async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");

    const taskTypeRaw = body?.taskType ?? body?.task_type ?? "copy";
    const taskType = String(taskTypeRaw || "").trim();

    // 通用 payload：優先使用 body.payload
    let payload = body?.payload ?? null;

    // 相容 copy 舊入參：{ items, skipExisting, maxConcurrency, retryPolicy }
    if (taskType === "copy" && !payload) {
      const items = body?.items;
      const options = {
        skipExisting: body?.skipExisting !== false,
        maxConcurrency: body?.maxConcurrency || 10,
        retryPolicy: body?.retryPolicy,
      };
      payload = { items, options };
    }

    // 支援 fs_index_rebuild：允許將 mountIds/options 平鋪在 body 上
    if (taskType === "fs_index_rebuild" && !payload) {
      payload = {
        mountIds: body?.mountIds ?? body?.mount_ids ?? undefined,
        options: body?.options ?? {
          batchSize: body?.batchSize ?? undefined,
          maxDepth: body?.maxDepth ?? undefined,
          maxMountsPerRun: body?.maxMountsPerRun ?? undefined,
          refresh: body?.refresh ?? undefined,
        },
      };
    }

    // 支援 fs_index_apply_dirty：允許將 mountIds/options 平鋪在 body 上
    if (taskType === "fs_index_apply_dirty" && !payload) {
      payload = {
        mountIds: body?.mountIds ?? body?.mount_ids ?? undefined,
        options: body?.options ?? {
          batchSize: body?.batchSize ?? undefined,
          maxItems: body?.maxItems ?? undefined,
          rebuildDirectorySubtree: body?.rebuildDirectorySubtree ?? undefined,
          maxDepth: body?.maxDepth ?? undefined,
          refresh: body?.refresh ?? undefined,
        },
      };
    }

    if (!payload || typeof payload !== "object") {
      throw new ValidationError("請提供有效的 payload 物件");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobDescriptor = await fileSystem.createJob(taskType, payload, userIdOrInfo, userType);

    return jsonOk(c, jobDescriptor, "作業已建立");
  });

  // 注意：許可權檢查已移至 FileSystem 業務層，此處僅需基礎掛載許可權
  router.get("/api/fs/jobs/:jobId", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("請提供作業ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobStatus = await fileSystem.getJobStatus(jobId, userIdOrInfo, userType);

    return jsonOk(c, jobStatus);
  });

  // 注意：許可權檢查已移至 FileSystem 業務層，此處僅需基礎掛載許可權
  router.post("/api/fs/jobs/:jobId/cancel", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("請提供作業ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    await fileSystem.cancelJob(jobId, userIdOrInfo, userType);

    return jsonOk(c, undefined, "作業已取消");
  });

  router.get("/api/fs/jobs", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    // 解析查詢引數 (新增 taskType 支援)
    const taskType = c.req.query("taskType");
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const filter = {
      taskType,
      status,
      // 不在此處設定 userId，交由 FileSystem 層根據 userType 判斷
      limit: Math.min(limit, 100), // 最大 100 條
      offset: Math.max(offset, 0),
    };

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    const { jobs, total } = await fileSystem.listJobs(filter, userIdOrInfo, userType);

    return jsonOk(c, { jobs, total, limit: filter.limit, offset: filter.offset });
  });

  // 注意：許可權檢查已移至 FileSystem 業務層，此處僅需基礎掛載許可權
  router.delete("/api/fs/jobs/:jobId", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("請提供作業ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    await fileSystem.deleteJob(jobId, userIdOrInfo, userType);

    return jsonOk(c, undefined, "作業已刪除");
  });
};
