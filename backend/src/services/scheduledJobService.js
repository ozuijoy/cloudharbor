import { DbTables } from "../constants/index.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  RepositoryError,
} from "../http/errors.js";
import { scheduledTaskRegistry } from "../scheduled/ScheduledTaskRegistry.js";
import { CronExpressionParser } from "cron-parser";

/**
 * 計算未來若干次計劃執行時間（僅用於前端視覺化預覽，不參與真實排程）
 * @param {any} row scheduled_jobs 錶行
 * @param {number} [limit=5] 需要預覽的最大次數
 * @returns {string[]} ISO 字串陣列
 */
function computePreviewNextRuns(row, limit = 5) {
  const nextRuns = [];

  const enabledNum =
    typeof row.enabled === "boolean"
      ? row.enabled
        ? 1
        : 0
      : Number(row.enabled) || 0;

  if (!enabledNum) return nextRuns;
  if (!row.next_run_after) return nextRuns;

  const scheduleType = (row.schedule_type || "interval").toLowerCase();

  const nextTime = new Date(row.next_run_after);
  if (Number.isNaN(nextTime.getTime())) return nextRuns;

  // 第一個一定是 next_run_after 本身
  nextRuns.push(nextTime.toISOString());

  // 僅按 limit 控制預覽次數
  const remainingAllowed = Math.max(0, limit - 1);
  if (remainingAllowed <= 0) return nextRuns;

  if (scheduleType === "interval") {
    const intervalSec = Number(row.interval_sec) || 0;
    if (intervalSec <= 0) return nextRuns;
    const intervalMs = intervalSec * 1000;
    for (let i = 1; i <= remainingAllowed; i++) {
      const future = new Date(nextTime.getTime() + i * intervalMs);
      nextRuns.push(future.toISOString());
    }
    return nextRuns;
  }

  if (scheduleType === "cron" && row.cron_expression) {
    try {
      const expr = CronExpressionParser.parse(row.cron_expression, {
        currentDate: nextTime,
      });
      for (let i = 0; i < remainingAllowed; i++) {
        const future = expr.next().toDate();
        nextRuns.push(future.toISOString());
      }
    } catch (e) {
      console.warn(
        "[scheduledJobService] 解析 cron_expression 失敗，無法計算 previewNextRuns:",
        { taskId: row.task_id, cron: row.cron_expression, error: e?.message || e },
      );
    }
  }

  return nextRuns;
}

/**
 * 將 scheduled_jobs 行對映為對前端友好的物件
 * @param {any} row
 */
function mapScheduledJobRow(row) {
  if (!row) return null;

  let config = {};
  if (row.config_json) {
    try {
      config = JSON.parse(row.config_json);
    } catch (e) {
      // 保持健壯性，解析失敗時退回空物件
      console.warn(
        "[scheduledJobService] 解析 config_json 失敗，將返回空物件:",
        e,
      );
      config = {};
    }
  }

  const enabledNum =
    typeof row.enabled === "boolean"
      ? row.enabled
        ? 1
        : 0
      : Number(row.enabled) || 0;

  // Handler ID（任務型別ID）
  const handlerId = row.handler_id;
  const name = row.name || handlerId;
  const description = row.description || null;

  // 檢查 handler 是否仍然存在（用於前端顯示\"未知型別\"標籤）
  const handlerExists = scheduledTaskRegistry.getHandler(handlerId) !== null;

  // 計算 intervalSec：對於 cron 型別，從表示式推導一個代表性的間隔（僅用於 UI 展示）
  let intervalSec = Number(row.interval_sec) || 0;
  const scheduleType = (row.schedule_type || "interval").toLowerCase();
  
  if (scheduleType === "cron" && row.cron_expression && intervalSec === 0) {
    try {
      const expr = CronExpressionParser.parse(row.cron_expression);
      const next1 = expr.next().toDate();
      const next2 = expr.next().toDate();
      intervalSec = Math.floor((next2.getTime() - next1.getTime()) / 1000);
    } catch (e) {
      console.warn(
        "[scheduledJobService] 解析 cron_expression 失敗，無法計算 intervalSec:",
        { taskId: row.task_id, cron: row.cron_expression, error: e?.message || e },
      );
      // 解析失敗時保持 intervalSec = 0，前端會從執行歷史估算
    }
  }

  const runCount = Number(row.run_count) || 0;
  const failureCount =
    row.failure_count === null || row.failure_count === undefined
      ? 0
      : Number(row.failure_count) || 0;

  // 執行時狀態（派生欄位，用於前端展示當前任務所處階段）
  // - disabled: 已禁用
  // - scheduled: 已啟用，且未到 next_run_after
  // - pending: 已啟用，已到 next_run_after，但當前未持有鎖（等待下一次 tick 觸發）
  // - running: 已啟用，當前持有鎖（最近一次 tick 正在或剛剛執行 handler）
  // - idle: 其他情況（例如缺少 next_run_after），作為保底狀態
  let runtimeState = "idle";
  const now = new Date();
  const nextRunAfter =
    row.next_run_after != null ? new Date(row.next_run_after) : null;
  const lockUntil =
    row.lock_until != null ? new Date(row.lock_until) : null;

  if (!enabledNum) {
    runtimeState = "disabled";
  } else if (lockUntil && !Number.isNaN(lockUntil.getTime()) && lockUntil > now) {
    // 持有鎖優先視為 running —— 即便 next_run_after 在未來，說明正在執行或剛剛執行完一次
    runtimeState = "running";
  } else if (!nextRunAfter || Number.isNaN(nextRunAfter.getTime())) {
    runtimeState = "idle";
  } else if (now < nextRunAfter) {
    runtimeState = "scheduled";
  } else {
    // now >= nextRunAfter 且當前沒有有效鎖：已到時間，等待下一次 tick 觸發
    runtimeState = "pending";
  }

  return {
    taskId: row.task_id,
    handlerId,
    name,
    description,
    enabled: enabledNum === 1,
    scheduleType,
    intervalSec,
    cronExpression: row.cron_expression || null,
    runCount,
    failureCount,
    lastRunStatus: row.last_run_status || null,
    lastRunStartedAt: row.last_run_started_at || null,
    lastRunFinishedAt: row.last_run_finished_at || null,
    nextRunAfter: row.next_run_after || null,
    lockUntil: row.lock_until || null,
    runtimeState,
    config,
    handlerExists,
    previewNextRuns: computePreviewNextRuns(row, 5),
  };
}

/**
 * 簡單布林解析
 * @param {any} value
 * @returns {boolean}
 */
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

/**
 * 列出排程作業
 * @param {D1Database} db
 * @param {{ taskId?: string, enabled?: boolean }} [filter]
 */
export async function listScheduledJobs(db, filter = {}) {
  try {
    let sql = `
      SELECT
        task_id,
        handler_id,
        name,
        description,
        enabled,
        schedule_type,
        interval_sec,
        cron_expression,
        run_count,
        failure_count,
        last_run_status,
        last_run_started_at,
        last_run_finished_at,
        next_run_after,
        lock_until,
        config_json
      FROM ${DbTables.SCHEDULED_JOBS}
      WHERE 1 = 1
    `;
    const binds = [];

    if (filter.taskId) {
      sql += " AND task_id = ?";
      binds.push(filter.taskId);
    }

    if (typeof filter.enabled === "boolean") {
      sql += " AND enabled = ?";
      binds.push(filter.enabled ? 1 : 0);
    }

    sql += " ORDER BY task_id ASC";

    const stmt = db.prepare(sql);
    const result = binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    
    // D1 返回格式: { results: [...], success: true, meta: {...} }
    const rows = result?.results || [];

    return rows.map(mapScheduledJobRow);
  } catch (error) {
    console.error("[scheduledJobService] 列出排程作業失敗:", error);
    throw new RepositoryError("列出排程作業失敗", { cause: error?.message });
  }
}

/**
 * 獲取單個排程作業
 * @param {D1Database} db
 * @param {string} taskId
 */
export async function getScheduledJob(db, taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必須是非空字串");
  }

  try {
    const row = await db
      .prepare(
        `
        SELECT
          task_id,
          handler_id,
          name,
          description,
          enabled,
          schedule_type,
          interval_sec,
          cron_expression,
          run_count,
          failure_count,
          last_run_status,
          last_run_started_at,
          last_run_finished_at,
          next_run_after,
          lock_until,
          config_json
        FROM ${DbTables.SCHEDULED_JOBS}
        WHERE task_id = ?
      `,
      )
      .bind(taskId)
      .first();

    if (!row) {
      throw new NotFoundError("排程作業不存在");
    }

    return mapScheduledJobRow(row);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error("[scheduledJobService] 獲取排程作業失敗:", error);
    throw new RepositoryError("獲取排程作業失敗", { cause: error?.message });
  }
}

/**
 * 建立排程作業
 * @param {D1Database} db
 * @param {{
 *   taskId?: string,
 *   handlerId: string,
 *   name?: string,
 *   description?: string,
 *   scheduleType?: 'interval' | 'cron',
 *   intervalSec?: number,
 *   cronExpression?: string,
 *   enabled?: boolean,
   *   config?: any
 * }} payload
 */
export async function createScheduledJob(db, payload) {
  let taskId = (payload?.taskId || "").trim();
  const enabled = payload?.enabled ?? true;
  const config = payload?.config ?? {};
  const scheduleTypeRaw = payload?.scheduleType || "interval";
  const scheduleType = scheduleTypeRaw.toLowerCase();
  const intervalSec =
    payload?.intervalSec !== undefined && payload?.intervalSec !== null
      ? Number(payload.intervalSec)
      : null;
  const cronExpression = payload?.cronExpression || null;

  if (!payload?.handlerId || typeof payload.handlerId !== "string" || !payload.handlerId.trim()) {
    throw new ValidationError("handlerId 必須是非空字串");
  }
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("config 必須是物件");
  }

  // 校驗排程型別與引數
  if (!["interval", "cron"].includes(scheduleType)) {
    throw new ValidationError("scheduleType 必須是 interval/cron 之一");
  }

  if (scheduleType === "interval") {
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      throw new ValidationError("intervalSec 必須是大於 0 的數字（interval 模式）");
    }
  }

  if (scheduleType === "cron") {
    if (!cronExpression || typeof cronExpression !== "string") {
      throw new ValidationError("cronExpression 在 cron 模式下必須是非空字串");
    }
    try {
      // 僅用於校驗表示式是否合法
      CronExpressionParser.parse(cronExpression);
    } catch (e) {
      throw new ValidationError(
        `無效的 cronExpression: ${e?.message || String(e)}`,
      );
    }
  }

  try {
    // 若未顯式提供 taskId，則基於 handlerId 自動生成一個作業ID
    if (!taskId) {
      const normalized = payload.handlerId.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() || "job";
      const suffix = crypto.randomUUID().slice(0, 8);
      taskId = `${normalized}_${suffix}`;
    }

    // 先檢查是否已存在
    const existing = await db
      .prepare(
        `SELECT task_id FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .first();

    if (existing) {
      throw new ConflictError("排程作業已存在");
    }

    const enabledNum = toBoolean(enabled) ? 1 : 0;
    const configJson = JSON.stringify(config ?? {});

    // 任務型別 ID 與名稱：
    const handlerId = payload?.handlerId;
    const name = payload?.name || handlerId;
    const description =
      typeof payload?.description === "string" ? payload.description : null;

    // 初始排程：根據 scheduleType 計算首個 next_run_after
    const nowIso = new Date().toISOString();
    let firstNextRunIso = null;

    if (scheduleType === "interval") {
      firstNextRunIso = new Date(
        Date.now() + intervalSec * 1000,
      ).toISOString();
    } else if (scheduleType === "cron") {
      const expr = CronExpressionParser.parse(cronExpression, {
        currentDate: nowIso,
      });
      firstNextRunIso = expr.next().toDate().toISOString();
    }
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SCHEDULED_JOBS} (
          task_id,
          handler_id,
          name,
          description,
          enabled,
          schedule_type,
          interval_sec,
          cron_expression,
          run_count,
          failure_count,
          last_run_status,
          last_run_started_at,
          last_run_finished_at,
          next_run_after,
          lock_until,
          config_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, NULL, ?)
      `,
      )
      .bind(
        taskId,
        handlerId,
        name,
        description,
        enabledNum,
        scheduleType,
        scheduleType === "interval" ? intervalSec : null,
        scheduleType === "cron" ? cronExpression : null,
        firstNextRunIso,
        configJson,
      )
      .run();

    // 返回建立後的完整物件
    return await getScheduledJob(db, taskId);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ConflictError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    console.error("[scheduledJobService] 建立排程作業失敗:", error);
    throw new RepositoryError("建立排程作業失敗", { cause: error?.message });
  }
}

/**
 * 更新排程作業
 * - 支援部分欄位更新：
 *   - 排程相關：scheduleType / intervalSec / cronExpression
 *   - 其他：enabled / config / name / description
 * - 當排程配置或 enabled 從禁用改為啟用時，重置 next_run_after
 * @param {D1Database} db
 * @param {string} taskId
 * @param {{
 *   scheduleType?: 'interval' | 'cron',
 *   intervalSec?: number,
 *   cronExpression?: string,
 *   enabled?: boolean,
 *   config?: any,
 *   name?: string,
 *   description?: string
 * }} payload
 */
export async function updateScheduledJob(db, taskId, payload) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必須是非空字串");
  }
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("請求體必須是物件");
  }

  // 僅當 intervalSec 有有效值時才視為“要更新間隔”
  const intervalProvided =
    Object.prototype.hasOwnProperty.call(payload, "intervalSec") &&
    payload.intervalSec !== undefined &&
    payload.intervalSec !== null &&
    payload.intervalSec !== "";

  const hasEnabled = Object.prototype.hasOwnProperty.call(payload, "enabled");
  const hasConfig = Object.prototype.hasOwnProperty.call(payload, "config");
  const hasName = Object.prototype.hasOwnProperty.call(payload, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(payload, "description");
  const hasScheduleType = Object.prototype.hasOwnProperty.call(payload, "scheduleType");
  const hasCronExpression = Object.prototype.hasOwnProperty.call(payload, "cronExpression");

  if (
    !intervalProvided &&
    !hasEnabled &&
    !hasConfig &&
    !hasName &&
    !hasDescription &&
    !hasScheduleType &&
    !hasCronExpression
  ) {
    throw new ValidationError("至少需要提供一個可更新欄位");
  }

  try {
    const row = await db
      .prepare(
        `SELECT task_id, enabled, schedule_type, interval_sec, cron_expression, run_count
         FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .first();

    if (!row) {
      throw new NotFoundError("排程作業不存在");
    }

    const currentEnabledNum =
      typeof row.enabled === "boolean"
        ? row.enabled
          ? 1
          : 0
        : Number(row.enabled) || 0;

    // 現有排程配置
    let nextScheduleType = (row.schedule_type || "interval").toLowerCase();
    let nextIntervalSec = row.interval_sec === null ? null : Number(row.interval_sec) || 0;
    let nextCronExpression = row.cron_expression || null;

    // 更新 scheduleType
    if (hasScheduleType && payload.scheduleType) {
      const st = payload.scheduleType.toLowerCase();
      if (!["interval", "cron"].includes(st)) {
        throw new ValidationError("scheduleType 必須是 interval/cron 之一");
      }
      nextScheduleType = st;
    }

    // 更新 intervalSec
    if (intervalProvided) {
      const newInterval = Number(payload.intervalSec);
      if (!Number.isFinite(newInterval) || newInterval <= 0) {
        throw new ValidationError("intervalSec 必須是大於 0 的數字");
      }
      nextIntervalSec = newInterval;
    }

    // 更新 cronExpression
    if (hasCronExpression) {
      nextCronExpression = payload.cronExpression || null;
    }

    // 根據排程型別做一次校驗
    if (nextScheduleType === "interval") {
      if (!Number.isFinite(nextIntervalSec) || nextIntervalSec <= 0) {
        throw new ValidationError("intervalSec 必須在 interval 模式下為大於 0 的數字");
      }
      nextCronExpression = null;
    } else if (nextScheduleType === "cron") {
      if (!nextCronExpression || typeof nextCronExpression !== "string") {
        throw new ValidationError("cronExpression 在 cron 模式下必須是非空字串");
      }
      try {
        // 僅用於校驗表示式是否合法
        CronExpressionParser.parse(nextCronExpression);
      } catch (e) {
        throw new ValidationError(
          `無效的 cronExpression: ${e?.message || String(e)}`,
        );
      }
      nextIntervalSec = null;
    }

    let nextEnabledNum = currentEnabledNum;
    if (hasEnabled) {
      nextEnabledNum = toBoolean(payload.enabled) ? 1 : 0;
    }

    let nextConfigJson = null;
    if (hasConfig) {
      if (typeof payload.config !== "object" || payload.config === null) {
        throw new ValidationError("config 必須是物件");
      }
      nextConfigJson = JSON.stringify(payload.config ?? {});
    }

    // 是否需要重置 next_run_after:
    // - 排程型別或引數改變
    // - enabled 從 0 -> 1
    const shouldResetSchedule =
      hasScheduleType ||
      intervalProvided ||
      hasCronExpression ||
      (hasEnabled && currentEnabledNum === 0 && nextEnabledNum === 1);

    let nextRunAfter = null;
    if (shouldResetSchedule) {
      const nowIso = new Date().toISOString();
      if (nextScheduleType === "interval") {
        nextRunAfter = new Date(
          Date.now() + nextIntervalSec * 1000,
        ).toISOString();
      } else if (nextScheduleType === "cron") {
        const expr = CronExpressionParser.parse(nextCronExpression, {
          currentDate: nowIso,
        });
        nextRunAfter = expr.next().toDate().toISOString();
      }
    }

    const sets = [];
    const binds = [];

    if (hasScheduleType) {
      sets.push("schedule_type = ?");
      binds.push(nextScheduleType);
    }
    if (intervalProvided || nextScheduleType === "interval") {
      sets.push("interval_sec = ?");
      binds.push(nextScheduleType === "interval" ? nextIntervalSec : null);
    }
    if (hasCronExpression || nextScheduleType === "cron") {
      sets.push("cron_expression = ?");
      binds.push(nextScheduleType === "cron" ? nextCronExpression : null);
    }
    if (intervalProvided) {
      // 已在上方處理 interval_sec，這裡不重複
    }
    if (hasEnabled) {
      sets.push("enabled = ?");
      binds.push(nextEnabledNum);
    }
    if (hasConfig) {
      sets.push("config_json = ?");
      binds.push(nextConfigJson);
    }
    if (hasName) {
      sets.push("name = ?");
      binds.push(payload.name ?? null);
    }
    if (hasDescription) {
      sets.push("description = ?");
      binds.push(payload.description ?? null);
    }
    if (shouldResetSchedule) {
      sets.push("next_run_after = ?");
      binds.push(nextRunAfter);
    }

    if (!sets.length) {
      // 理論上不會走到這裡，前面已校驗
      throw new ValidationError("沒有有效的更新欄位");
    }

    const sql = `
      UPDATE ${DbTables.SCHEDULED_JOBS}
      SET ${sets.join(", ")}
      WHERE task_id = ?
    `;
    binds.push(taskId);

    await db.prepare(sql).bind(...binds).run();

    return await getScheduledJob(db, taskId);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    console.error("[scheduledJobService] 更新排程作業失敗:", error);
    throw new RepositoryError("更新排程作業失敗", { cause: error?.message });
  }
}

/**
 * 刪除排程作業
 * @param {D1Database} db
 * @param {string} taskId
 */
export async function deleteScheduledJob(db, taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必須是非空字串");
  }

  try {
    // 先刪除執行歷史，再刪除排程作業本身
    await db
      .prepare(
        `DELETE FROM ${DbTables.SCHEDULED_JOB_RUNS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .run();

    const res = await db
      .prepare(
        `DELETE FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .run();

    const changes = res?.meta?.changes ?? res?.changes ?? 0;
    if (!changes) {
      throw new NotFoundError("排程作業不存在");
    }
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }
    console.error("[scheduledJobService] 刪除排程作業失敗:", error);
    throw new RepositoryError("刪除排程作業失敗", { cause: error?.message });
  }
}
