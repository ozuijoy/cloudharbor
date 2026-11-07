import { Hono } from "hono";
import { ApiStatus, DbTables } from "../constants/index.js";
import { createErrorResponse, jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { NotFoundError } from "../http/errors.js";
import {
  listScheduledJobs,
  getScheduledJob,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
} from "../services/scheduledJobService.js";
import {
  listScheduledJobRuns,
  recordScheduledJobRun,
  getScheduledJobsHourlyAnalytics,
} from "../services/scheduledJobRunService.js";
import { scheduledTaskRegistry } from "../scheduled/ScheduledTaskRegistry.js";
import { isCloudflareWorkerEnvironment } from "../utils/environmentUtils.js";
import { computeSchedulerTickerNextTick, getSchedulerTickState } from "../services/schedulerTickerStateService.js";

// 排程任務相關路由（僅 Docker/Node 環境使用 + 管理員配置）
const scheduledRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

// ==================== Handler 型別 API ====================

// 獲取所有 handler 型別列表（管理員）
scheduledRoutes.get("/api/admin/scheduled/types", requireAdmin, async (c) => {
  const handlerTypes = scheduledTaskRegistry.getHandlerTypes();
  return jsonOk(c, { items: handlerTypes }, "獲取排程handler型別列表成功");
});

// 獲取單個 handler 型別詳情（管理員）
scheduledRoutes.get("/api/admin/scheduled/types/:taskId", requireAdmin, async (c) => {
  const taskId = c.req.param("taskId");
  const handlerType = scheduledTaskRegistry.getHandlerType(taskId);

  if (!handlerType) {
    throw new NotFoundError("排程handler型別不存在");
  }

  return jsonOk(c, handlerType, "獲取排程handler型別詳情成功");
});

// ==================== 排程作業管理 API ====================

// 列出排程作業（管理員）
scheduledRoutes.get("/api/admin/scheduled/jobs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.query("taskId") || c.req.query("task_id") || undefined;
  const enabledRaw = c.req.query("enabled");

  let enabledFilter;
  if (typeof enabledRaw === "string") {
    const v = enabledRaw.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") {
      enabledFilter = true;
    } else if (v === "false" || v === "0" || v === "no" || v === "off") {
      enabledFilter = false;
    }
  }

  const jobs = await listScheduledJobs(db, {
    taskId,
    enabled: enabledFilter,
  });

  return jsonOk(c, { items: jobs }, "獲取排程作業列表成功");
});

// 獲取單個排程作業詳情（管理員）
scheduledRoutes.get("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  const job = await getScheduledJob(db, taskId);
  return jsonOk(c, job, "獲取排程作業詳情成功");
});

// 建立排程作業（管理員）
scheduledRoutes.post("/api/admin/scheduled/jobs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  const payload = {
    // 作業ID（jobId），用於唯一標識此排程作業
    taskId: body.taskId ?? body.task_id,
    // 任務處理器型別 ID（Handler ID），預設與 taskId 相同，便於相容舊客戶端
    handlerId: body.handlerId ?? body.handler_id ?? body.taskId ?? body.task_id,
    // 作業名稱與描述（可選），預設使用 handlerId
    name: body.name ?? null,
    description: body.description ?? null,
    scheduleType: body.scheduleType ?? body.schedule_type,
    intervalSec: body.intervalSec ?? body.interval_sec,
    cronExpression: body.cronExpression ?? body.cron_expression,
    enabled: body.enabled,
  };
  // 僅當請求體中顯式提供 config 時才傳遞，未提供則由 service 使用預設 {}
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    payload.config = body.config;
  }

  const created = await createScheduledJob(db, payload);

  return jsonOk(c, created, "建立排程作業成功");
});

// 更新排程作業（管理員）
scheduledRoutes.put("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");
  const body = await c.req.json();

  const payload = {};

  // 名稱與描述（可選）
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    payload.name = body.name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    payload.description = body.description ?? null;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "scheduleType") ||
    Object.prototype.hasOwnProperty.call(body, "schedule_type")
  ) {
    payload.scheduleType = body.scheduleType ?? body.schedule_type;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "intervalSec") ||
    Object.prototype.hasOwnProperty.call(body, "interval_sec")
  ) {
    payload.intervalSec = body.intervalSec ?? body.interval_sec;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "cronExpression") ||
    Object.prototype.hasOwnProperty.call(body, "cron_expression")
  ) {
    payload.cronExpression = body.cronExpression ?? body.cron_expression;
  }

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    payload.enabled = body.enabled;
  }

  // 僅在請求體中顯式提供 config 時才嘗試更新配置
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    payload.config = body.config;
  }

  const updated = await updateScheduledJob(db, taskId, payload);

  return jsonOk(c, updated, "更新排程作業成功");
});

// 刪除排程作業（管理員）
scheduledRoutes.delete("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  await deleteScheduledJob(db, taskId);
  return jsonOk(c, { taskId }, "刪除排程作業成功");
});

// 獲取排程作業執行記錄列表（管理員）
scheduledRoutes.get("/api/admin/scheduled/jobs/:taskId/runs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");
  const limitRaw = c.req.query("limit");

  const runs = await listScheduledJobRuns(db, {
    taskId,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });

  return jsonOk(c, { items: runs }, "獲取排程作業執行記錄成功");
});

// 獲取定時任務執行的按小時統計資料（管理員）
scheduledRoutes.get("/api/admin/scheduled/analytics", requireAdmin, async (c) => {
  const db = c.env.DB;
  const windowHoursRaw = c.req.query("windowHours");

  const analytics = await getScheduledJobsHourlyAnalytics(db, {
    windowHours: windowHoursRaw ? Number(windowHoursRaw) : undefined,
  });

  return jsonOk(c, analytics, "獲取定時任務執行統計成功");
});

// 獲取“平臺觸發器 tick”的狀態（管理員）
// - 這個 tick 是 Cloudflare Cron Trigger 或 Docker node-schedule 觸發 scheduled 掃描的“外部觸發器”
// - 管理面板用它來顯示：cron 規則 + 下次觸發倒計時 + 上次觸發時間
scheduledRoutes.get("/api/admin/scheduled/ticker", requireAdmin, async (c) => {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 當前執行環境與“本地配置 cron”
  // Docker/Node：cron 透過環境變數 SCHEDULED_TICK_CRON 配置（預設每分鐘一次）
  // Workers：使用“真實觸發時記錄的 lastCron”
  const runtime = isCloudflareWorkerEnvironment() ? "cloudflare" : "docker";
  const processEnv =
    typeof process !== "undefined" && process?.env ? process.env : {};
  const configuredCronRaw =
    runtime === "docker" ? processEnv.SCHEDULED_TICK_CRON || null : null;
  const configuredCron =
    typeof configuredCronRaw === "string" && configuredCronRaw.trim()
      ? configuredCronRaw.trim()
      : runtime === "docker"
        ? "*/1 * * * *"
        : null;

  const cronSource =
    typeof configuredCronRaw === "string" && configuredCronRaw.trim()
      ? "env"
      : runtime === "docker"
        ? "default"
        : "missing";

  const tickState = await getSchedulerTickState(c.env.DB);
  const observedCron = tickState.lastCron || null;
  // 1) lastCron（來自“真實觸發”的 cron）
  // 2) Docker 環境回退到 configuredCron（因為 Docker 的觸發器就是靠它配置的）
  // 3) Workers 環境沒有 lastCron 前，無法計算 next（只能等待首次真實觸發）
  const activeCron = observedCron || (runtime === "docker" ? configuredCron : null);

  const lastTickMs = tickState.lastMs;
  const lastTickAt = lastTickMs ? new Date(lastTickMs).toISOString() : null;
  const nextTick = computeSchedulerTickerNextTick({ activeCron, nowIso, lastTickMs });

  return jsonOk(
    c,
    {
      now: nowIso,
      nowMs,
      runtime,
      cron: {
        configured: configuredCron,
        source: cronSource,
        active: activeCron,
        lastSeen: observedCron,
      },
      lastTick: {
        ms: lastTickMs,
        at: lastTickAt,
        source: lastTickMs ? "system_settings" : null,
      },
      nextTick: {
        at: nextTick.at,
        scheduledAt: nextTick.scheduledAt,
        estimatedAt: nextTick.estimatedAt,
        intervalSec: nextTick.intervalSec,
        cronParseError: nextTick.cronParseError,
      },
      note:
        runtime === "cloudflare" && !observedCron
          ? "尚未觀察到平臺觸發器的首次真實觸發：暫時無法計算預計下次觸發時間；首次觸發後會自動顯示。"
          : "提示：at 優先按“上次真實觸發 + 間隔”估算（可能包含延遲）；scheduledAt 是 cron 的計劃時間（通常是整分/整 5 分鐘）。到點後可點右下角重新整理校準。",
    },
    "獲取平臺觸發器狀態成功",
  );
});

// 立即執行排程作業（管理員）
scheduledRoutes.post("/api/admin/scheduled/jobs/:taskId/run", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  // 獲取任務配置
  const job = await getScheduledJob(db, taskId);
  
  // 獲取handler（根據 handlerId 排程具體任務型別）
  const handler = scheduledTaskRegistry.getHandler(job.handlerId);
  if (!handler) {
    throw new NotFoundError("任務處理器不存在");
  }

  // 立即執行
  const startTime = Date.now();
  let status = "success";
  let errorMessage = null;
  let summary = null;
  let handlerResult = null;

  try {
    // 構造handler期望的上下文物件
    const ctx = {
      db,
      env: c.env,
      now: new Date().toISOString(),
      config: job.config || {},
    };
    handlerResult = await handler.run(ctx);
    summary = handlerResult?.summary || "手動執行成功";
  } catch (error) {
    status = "failure";
    errorMessage = error.message || "執行失敗";
    console.error(`[scheduledRoutes] 手動執行任務 ${taskId} 失敗:`, error);
  }

  const durationMs = Date.now() - startTime;
  const finishedAt = new Date().toISOString();
  const startedAtIso = new Date(startTime).toISOString();

  // 記錄執行歷史
  await recordScheduledJobRun(db, {
    taskId,
    status,
    startedAt: startedAtIso,
    finishedAt,
    durationMs,
    summary,
    errorMessage,
    details:
      handlerResult && typeof handlerResult === "object" ? handlerResult : null,
    triggerType: "manual",
  });

  // 手動執行完成後，同步更新 scheduled_jobs 彙總欄位
  const sets = [
    "run_count = run_count + 1",
    "last_run_status = ?",
    "last_run_started_at = ?",
    "last_run_finished_at = ?",
  ];
  const binds = [status, startedAtIso, finishedAt];
  if (status === "failure") {
    sets.push("failure_count = failure_count + 1");
  }
  const sql = `
    UPDATE ${DbTables.SCHEDULED_JOBS}
    SET ${sets.join(", ")}
    WHERE task_id = ?
  `;
  binds.push(taskId);
  await db.prepare(sql).bind(...binds).run();

  return jsonOk(
    c,
    {
      taskId,
      status,
      durationMs,
      summary,
      errorMessage,
    },
    status === "success" ? "任務執行成功" : "任務執行失敗"
  );
});

export default scheduledRoutes;
