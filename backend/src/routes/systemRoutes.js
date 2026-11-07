import { Hono } from "hono";
import { ValidationError, NotFoundError } from "../http/errors.js";
import {
  getMaxUploadSize,
  getDashboardStats,
  getSettingsByGroup,
  getAllSettingsByGroups,
  getGroupsInfo,
  updateGroupSettings,
  getSettingMetadata,
} from "../services/systemService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { getQueryBool, jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getUploadProgress } from "../storage/utils/UploadProgressTracker.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { getStorageUsageReport } from "../services/storageUsageReportService.js";
import { StorageUsageService } from "../storage/usage/StorageUsageService.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";

const systemRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

// 獲取最大上傳檔案大小限制（公共API）
systemRoutes.get("/api/system/max-upload-size", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");

  const size = await getMaxUploadSize(db, repositoryFactory);

  return jsonOk(c, { max_upload_size: size }, "獲取最大上傳大小成功");
});

// 通用上傳進度查詢（公共API）
systemRoutes.get("/api/upload/progress", async (c) => {
  const id = c.req.query("upload_id") || c.req.query("id");
  if (!id) {
    throw new ValidationError("缺少 upload_id 引數");
  }

  const progress = getUploadProgress(id);

  // 簡單記錄每次進度查詢的結果，便於線上排查上傳進度問題
  try {
    console.log("[UploadProgress] /api/upload/progress", {
      id,
      found: !!progress,
      loaded: progress?.loaded ?? 0,
      total: progress?.total ?? null,
      completed: progress?.completed ?? false,
      path: progress?.path ?? null,
      storageType: progress?.storageType ?? null,
      updatedAt: progress?.updatedAt ?? null,
    });
  } catch {}

  if (!progress) {
    // 未找到記錄時也返回成功，由前端自行決定如何處理
    return jsonOk(
      c,
      {
        id,
        loaded: 0,
        total: null,
        completed: false,
      },
      "未找到上傳進度記錄"
    );
  }

  return jsonOk(
    c,
    {
      id: progress.id,
      loaded: progress.loaded,
      total: progress.total,
      completed: progress.completed,
      path: progress.path ?? null,
      storageType: progress.storageType ?? null,
      updatedAt: progress.updatedAt,
    },
    "獲取上傳進度成功"
  );
});

// 儀表盤統計資料API
systemRoutes.get("/api/admin/dashboard/stats", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const repositoryFactory = c.get("repos");
  const stats = await getDashboardStats(db, adminId, repositoryFactory);

  return jsonOk(c, stats, "獲取儀表盤統計資料成功");
});

// 儲存用量報告
systemRoutes.get("/api/admin/storage-usage/report", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const repositoryFactory = c.get("repos");
  const encryptionSecret = getEncryptionSecret(c);
  const report = await getStorageUsageReport(db, adminId, encryptionSecret, repositoryFactory, c.env);

  return jsonOk(c, report, "獲取儲存用量報告成功");
});

// 主動重新整理：儲存用量快照（寫入 metrics_cache）
systemRoutes.post("/api/admin/storage-usage/refresh", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const encryptionSecret = getEncryptionSecret(c);

  const maxItems = Number(c.req.query("maxItems")) > 0 ? Math.min(Number(c.req.query("maxItems")), 500) : 50;

  const repositoryFactory = ensureRepositoryFactory(db, c.get("repos"), c.env);
  const storageRepo = repositoryFactory.getStorageConfigRepository();
  const configs = await storageRepo.findByAdmin(adminId);
  const ids = (configs || [])
    .map((cfg) => cfg?.id)
    .filter(Boolean)
    .slice(0, maxItems);

  const usage = new StorageUsageService(db, encryptionSecret, repositoryFactory, { env: c.env });

  let okCount = 0;
  let failCount = 0;
  const failures = [];

  // 序列
  for (const id of ids) {
    try {
      await usage.computeAndPersistSnapshot(String(id));
      okCount += 1;
    } catch (e) {
      failCount += 1;
      failures.push({ id: String(id), error: e?.message ? String(e.message) : String(e) });
    }
  }

  return jsonOk(
    c,
    {
      version: "storage_usage_refresh_v2",
      maxItems,
      total: ids.length,
      okCount,
      failCount,
      failures: failures.slice(0, 20),
      refreshedAt: new Date().toISOString(),
    },
    "重新整理儲存用量快照完成",
  );
});

// 獲取系統版本資訊（公共API）
systemRoutes.get("/api/version", async (c) => {
  // 判斷執行環境和資料儲存
  const runtimeEnv = process.env.RUNTIME_ENV || "unknown";
  const isDocker = runtimeEnv === "docker";

  // 統一的預設版本配置
  const DEFAULT_VERSION = "1.9.1";
  const DEFAULT_NAME = "cloudharbor-api";

  let version = DEFAULT_VERSION;
  let name = DEFAULT_NAME;

  // 根據環境獲取版本資訊
  if (isDocker) {
    const packageJson = await (async () => {
      const fs = await import("fs");
      const path = await import("path");
      const packagePath = path.resolve("./package.json");
      const packageContent = await fs.promises.readFile(packagePath, "utf8");
      return JSON.parse(packageContent);
    })().catch((error) => {
      console.warn("Docker環境讀取package.json失敗，使用預設值:", error.message);
      return null;
    });

    if (packageJson) {
      version = packageJson.version || DEFAULT_VERSION;
      name = packageJson.name || DEFAULT_NAME;
    }
  } else {
    // Workers環境：使用環境變數或預設值
    version = process.env.APP_VERSION || DEFAULT_VERSION;
    name = process.env.APP_NAME || DEFAULT_NAME;
  }

  const versionInfo = {
    version,
    name,
    environment: isDocker ? "Docker" : "Cloudflare Workers",
    storage: isDocker ? "SQLite" : "Cloudflare D1",
    nodeVersion: process.version || "unknown",
    uptime: Math.round(process.uptime()),
  };

  return jsonOk(c, versionInfo, "獲取版本資訊成功");
});

// ==================== 新增：分組設定管理API介面 ====================

// 按分組獲取設定項（公開訪問，無需認證）
systemRoutes.get("/api/admin/settings", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupId = c.req.query("group");
  const includeMetadata = getQueryBool(c, "metadata", true);

  if (groupId) {
    const groupIdNum = parseInt(groupId, 10);
    if (Number.isNaN(groupIdNum)) {
      throw new ValidationError("分組ID必須是數字");
    }

    const settings = await getSettingsByGroup(db, groupIdNum, includeMetadata, repositoryFactory);
    return jsonOk(c, settings, "獲取分組設定成功");
  }

  const includeSystemGroup = getQueryBool(c, "includeSystem", false);
  const groupedSettings = await getAllSettingsByGroups(db, includeSystemGroup, repositoryFactory);

  return jsonOk(c, groupedSettings, "獲取所有分組設定成功");
});

// 獲取分組列表和統計資訊
systemRoutes.get("/api/admin/settings/groups", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupsInfo = await getGroupsInfo(db, repositoryFactory);

  return jsonOk(c, { groups: groupsInfo }, "獲取分組資訊成功");
});

// 獲取設定項後設資料
systemRoutes.get("/api/admin/settings/metadata", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const key = c.req.query("key");
  if (!key) {
    throw new ValidationError("缺少設定鍵名引數");
  }

  const metadata = await getSettingMetadata(db, key, repositoryFactory);
  if (!metadata) {
    throw new NotFoundError("設定項不存在");
  }

  return jsonOk(c, metadata, "獲取設定後設資料成功");
});

// 按分組批次更新設定
systemRoutes.put("/api/admin/settings/group/:groupId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupId = parseInt(c.req.param("groupId"), 10);
  if (Number.isNaN(groupId)) {
    throw new ValidationError("分組ID必須是數字");
  }

  const body = await c.req.json();
  if (!body || typeof body !== "object") {
    throw new ValidationError("請求引數無效");
  }

  const validateType = getQueryBool(c, "validate", true);
  const result = await updateGroupSettings(db, groupId, body, { validateType }, repositoryFactory);

  return jsonOk(c, result, result.message);
});

export default systemRoutes;

