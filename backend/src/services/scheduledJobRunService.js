import { DbTables } from "../constants/index.js";
import { ValidationError, RepositoryError } from "../http/errors.js";

/**
 * 記錄排程作業執行日誌
 * @param {D1Database} db
 * @param {{
 *   taskId: string;
 *   status: "success" | "failure" | "skipped";
 *   startedAt?: string;
 *   finishedAt?: string | null;
 *   durationMs?: number | null;
 *   summary?: string | null;
 *   errorMessage?: string | null;
 *   details?: any;
 * }} entry
 */
export async function recordScheduledJobRun(db, entry) {
  try {
    const {
      taskId,
      status,
      triggerType = "auto",
      scheduledAt = null,
      startedAt = new Date().toISOString(),
      finishedAt = new Date().toISOString(),
      durationMs = null,
      summary = null,
      errorMessage = null,
      details = null,
    } = entry;

    const detailsJson =
      details && typeof details === "object" ? JSON.stringify(details) : null;

    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SCHEDULED_JOB_RUNS} (
          task_id,
          status,
          trigger_type,
          scheduled_at,
          started_at,
          finished_at,
          duration_ms,
          summary,
          error_message,
          details_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        taskId,
        status,
        triggerType,
        scheduledAt,
        startedAt,
        finishedAt,
        durationMs,
        summary,
        errorMessage,
        detailsJson,
      )
      .run();
  } catch (error) {
    console.error("[scheduledJobRunService] 記錄排程作業執行日誌失敗:", error);
    throw new RepositoryError("記錄排程作業執行日誌失敗", {
      cause: error?.message,
    });
  }
}

/**
 * 列出指定排程任務的執行記錄
 * @param {D1Database} db
 * @param {{ taskId: string, limit?: number }} params
 */
export async function listScheduledJobRuns(db, params) {
  const taskId = params?.taskId;
  const limitRaw = params?.limit;

  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必須是非空字串");
  }

  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 50;
  }
  limit = Math.min(Math.max(limit, 1), 200);

  try {
    const res = await db
      .prepare(
        `
        SELECT
          id,
          task_id,
          status,
          started_at,
          finished_at,
          duration_ms,
          summary,
          error_message,
          details_json
        FROM ${DbTables.SCHEDULED_JOB_RUNS}
        WHERE task_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `,
      )
      .bind(taskId, limit)
      .all();

    const rows = res?.results || res?.rows || [];

    return rows.map((row) => {
      let details = null;
      if (row.details_json) {
        try {
          details = JSON.parse(row.details_json);
        } catch {
          details = null;
        }
      }

      const totalSessions =
        details && typeof details.totalSessions === "number"
          ? details.totalSessions
          : null;

      return {
        id: row.id,
        taskId: row.task_id,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs:
          typeof row.duration_ms === "number" ? row.duration_ms : null,
        summary: row.summary || null,
        errorMessage: row.error_message || null,
        details,
        totalSessions,
      };
    });
  } catch (error) {
    console.error("[scheduledJobRunService] 列出排程作業執行記錄失敗:", error);
    throw new RepositoryError("列出排程作業執行記錄失敗", { cause: error?.message });
  }
}

/**
 * 獲取定時任務執行的按小時統計資料（用於熱力圖等視覺化）
 * - 預設統計最近 24 小時所有任務的執行情況
 * - 僅依賴 scheduled_job_runs 表，不區分具體任務
 *
 * @param {D1Database} db
 * @param {{ windowHours?: number }} [options]
 * @returns {Promise<{ windowHours: number, buckets: Array<{
 *   start: string;
 *   end: string;
 *   totalRuns: number;
 *   success: number;
 *   failure: number;
 *   skipped: number;
 * }> }>}
 */
export async function getScheduledJobsHourlyAnalytics(db, options = {}) {
  const windowHoursRaw = options.windowHours;
  let windowHours = Number(windowHoursRaw);
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    windowHours = 24;
  }
  // 限制視窗大小，避免一次性拉取過多歷史資料
  windowHours = Math.min(Math.max(windowHours, 1), 7 * 24);

  // 將當前時間向下取整到整點，確保 SQL 聚合桶和記憶體中的時間桶對齊
  const now = new Date();
  const endHour = new Date(now.getTime());
  endHour.setMinutes(0, 0, 0); // 當前整點，例如 10:37 -> 10:00

  // 以整點為基準計算視窗起點，例如 windowHours=24 時，從 24 小時前的整點開始
  const windowStart = new Date(
    endHour.getTime() - (windowHours - 1) * 60 * 60 * 1000,
  );
  const windowStartIso = windowStart.toISOString();

  try {
    // 按小時桶聚合執行次數（total / success / failure / skipped）
    const res = await db
      .prepare(
        `
        SELECT
          strftime('%Y-%m-%dT%H:00:00Z', started_at) AS bucket,
          COUNT(*) AS total_runs,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_runs,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_runs
        FROM ${DbTables.SCHEDULED_JOB_RUNS}
        WHERE started_at >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      )
      .bind(windowStartIso)
      .all();

    const rows = res?.results || res?.rows || [];
    const byBucket = new Map();
    for (const row of rows) {
      const bucket = row.bucket;
      if (!bucket) continue;
      byBucket.set(bucket, {
        bucket,
        totalRuns: Number(row.total_runs) || 0,
        success: Number(row.success_runs) || 0,
        failure: Number(row.failure_runs) || 0,
        skipped: Number(row.skipped_runs) || 0,
      });
    }

    // 為最近 windowHours 小時構建連續的時間桶
    const buckets = [];
    for (let i = 0; i < windowHours; i++) {
      const startDate = new Date(windowStart.getTime() + i * 60 * 60 * 1000);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      // 生成與 SQL 中 strftime('%Y-%m-%dT%H:00:00Z', ...) 一致的 bucketKey
      const iso = startDate.toISOString(); // 例如 2025-12-10T08:00:00.000Z
      const bucketKey = `${iso.slice(0, 13)}:00:00Z`; // 截斷為 2025-12-10T08:00:00Z
      const agg = byBucket.get(bucketKey);

      buckets.push({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        totalRuns: agg?.totalRuns || 0,
        success: agg?.success || 0,
        failure: agg?.failure || 0,
        skipped: agg?.skipped || 0,
      });
    }

    return {
      windowHours,
      buckets,
    };
  } catch (error) {
    console.error(
      "[scheduledJobRunService] 獲取按小時統計資料失敗:",
      error,
    );
    throw new RepositoryError("獲取定時任務執行統計失敗", {
      cause: error?.message,
    });
  }
}
