import { Hono } from "hono";
import { ValidationError } from "../http/errors.js";
import { BackupService } from "../services/BackupService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const backupRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

const parseBackupJsonFromFormData = async (formData) => {
  const file = formData.get("backup_file");
  if (!file) {
    throw new ValidationError("請選擇備份檔案");
  }
  if (!file.name.endsWith(".json")) {
    throw new ValidationError("只支援JSON格式的備份檔案");
  }

  const fileContent = await file.text();
  return await Promise.resolve()
    .then(() => JSON.parse(fileContent))
    .catch(() => {
      throw new ValidationError("備份檔案格式錯誤，請確保是有效的JSON檔案");
    });
};

/**
 * 建立備份
 * POST /api/admin/backup/create
 */
backupRoutes.post("/api/admin/backup/create", requireAdmin, async (c) => {
  const body = await c.req.json();
  const { backup_type = "full", selected_modules = [] } = body;

  if (backup_type === "modules" && (!selected_modules || selected_modules.length === 0)) {
    throw new ValidationError("模組備份必須選擇至少一個模組");
  }

  const backupService = new BackupService(c.env.DB, c.env);
  const backupData = await backupService.createBackup({
    backup_type,
    selected_modules,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `cloudharbor-${backup_type}-${timestamp}.json`;

  return new Response(JSON.stringify(backupData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
});

/**
 * 還原預檢查（不寫入資料庫）
 * POST /api/admin/backup/restore/preview
 */
backupRoutes.post("/api/admin/backup/restore/preview", requireAdmin, async (c) => {
  const formData = await c.req.formData();
  const mode = formData.get("mode") || "overwrite";

  const backupData = await parseBackupJsonFromFormData(formData);

  const backupService = new BackupService(c.env.DB, c.env);
  const { userId: currentAdminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const skipIntegrityCheck = formData.get("skipIntegrityCheck") === "true";
  const preserveTimestamps = formData.get("preserveTimestamps") === "true";

  const preview = await backupService.previewRestoreBackup(backupData, {
    mode,
    currentAdminId,
    skipIntegrityCheck,
    preserveTimestamps,
  });

  const hardErrors = Array.isArray(preview?.issues) ? preview.issues.filter((i) => i?.level === "error") : [];
  const ok = hardErrors.length === 0;

  return jsonOk(
    c,
    {
      ok,
      preview,
    },
    ok ? "備份還原預檢查透過" : "備份還原預檢查發現問題",
  );
});

/**
 * 還原備份
 * POST /api/admin/backup/restore
 */
backupRoutes.post("/api/admin/backup/restore", requireAdmin, async (c) => {
  const formData = await c.req.formData();
  const mode = formData.get("mode") || "overwrite";
  const backupData = await parseBackupJsonFromFormData(formData);

  const backupService = new BackupService(c.env.DB, c.env);
  const { userId: currentAdminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const skipIntegrityCheck = formData.get("skipIntegrityCheck") === "true";
  const preserveTimestamps = formData.get("preserveTimestamps") === "true";

  const result = await backupService.restoreBackup(backupData, {
    mode,
    currentAdminId,
    skipIntegrityCheck,
    preserveTimestamps,
  });

  return jsonOk(
    c,
    {
      restored_tables: result.restored_tables,
      total_records: result.total_records,
      results: result.results,
      integrity_issues: result.integrityIssues || [],
      mode,
      backup_info: {
        backup_type: backupData.metadata.backup_type,
        timestamp: backupData.metadata.timestamp,
      },
    },
    "資料還原成功"
  );
});

/**
 * 獲取備份模組資訊
 * GET /api/admin/backup/modules
 */
backupRoutes.get("/api/admin/backup/modules", requireAdmin, async (c) => {
  const backupService = new BackupService(c.env.DB, c.env);
  const modules = await backupService.getModulesInfo();

  return jsonOk(c, { modules }, "獲取模組資訊成功");
});

export { backupRoutes };
