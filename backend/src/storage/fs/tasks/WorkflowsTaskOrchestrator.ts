/**
 * Cloudflare Workers 任務編排器 - 使用 Workflows API
 * - 持久化執行 + 步驟級重試
 * - 雙層資料: Workflow 例項 (3-7天) + D1 tasks 表 (永久)
 * - 支援多工型別 (TaskRegistry + TaskHandler)
 */

import { DbTables } from '../../../constants/index.js';
import { taskRegistry } from './TaskRegistry.js';
import type { TaskHandler } from './TaskHandler.js';
import type {
  TaskOrchestratorAdapter,
  CreateJobParams,
  JobDescriptor,
  JobStatus,
} from './TaskOrchestratorAdapter.js';
import { TaskStatus } from './types.js';
import type {
  JobFilter,
  JobListResult,
  TaskStats,
} from './types.js';

/** Workers 環境繫結 */
interface WorkersEnv {
  JOB_WORKFLOW: WorkflowNamespace;
  DB: D1Database;
}

/** Workflow 例項狀態 */
interface WorkflowInstanceStatus {
  id: string;
  status: string;
  output?: {
    totalItems?: number;
    processedItems?: number;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    finishedAt?: string;
  };
  created: string;
  modified: string;
}

/** Workflow 名稱空間 */
interface WorkflowNamespace {
  create(params: { id: string; params: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

/** Workflow 例項 */
interface WorkflowInstance {
  id: string;
  status(): Promise<WorkflowInstanceStatus>;
  terminate(): Promise<void>;
}

export class WorkflowsTaskOrchestrator implements TaskOrchestratorAdapter {
  constructor(
    private env: WorkersEnv,
    private fileSystem: any
  ) {}

  /** 建立作業 - 驗證任務型別 → 生成 ID → 建立 Workflow 例項 → 插入資料庫 */
  async createJob(params: CreateJobParams): Promise<JobDescriptor> {
    const {
      taskType,
      payload,
      userId,
      userType,
      triggerType: triggerTypeRaw,
      triggerRef: triggerRefRaw,
    } = params;
    const triggerType = triggerTypeRaw ?? 'manual';
    const triggerRef = triggerRefRaw ?? null;

    const handler = taskRegistry.getHandler(taskType);
    await handler.validate(payload);

    const jobId = this.generateJobId(taskType);
    const now = Date.now();
    const stats = handler.createStatsTemplate(payload);

    const workflowInstance = await this.env.JOB_WORKFLOW.create({
      id: jobId,
      params: {
        jobId,
        taskType,
        payload,
        userId,
        userType,
        triggerType,
        triggerRef,
      },
    });

    await this.env.DB.prepare(`
      INSERT INTO ${DbTables.TASKS} (
        task_id, task_type, status, payload, stats,
        user_id, user_type, workflow_instance_id,
        trigger_type, trigger_ref,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      taskType,
      'pending',
      JSON.stringify(payload),
      JSON.stringify(stats),
      userId,
      userType,
      jobId,
      triggerType,
      triggerRef,
      now,
      now
    ).run();

    console.log(
      `[WorkflowsTaskOrchestrator] 已建立作業 ${jobId} (任務型別: ${taskType})`
    );

    return {
      jobId,
      taskType,
      status: TaskStatus.PENDING,
      stats,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      triggerType,
      triggerRef,
    };
  }

  /** 獲取作業狀態 - 資料庫靜態資料 + Workflow 實時進度 */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const taskRecord = await this.env.DB.prepare(`
      SELECT
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      WHERE t.task_id = ?
    `).bind(jobId).first();

    if (!taskRecord) {
      throw new Error(`作業 ${jobId} 不存在`);
    }

    const payload = JSON.parse(taskRecord.payload as string);
    const dbStats = JSON.parse(taskRecord.stats as string) as TaskStats;

    let workflowStatus: WorkflowInstanceStatus | null = null;
    try {
      const instance = await this.env.JOB_WORKFLOW.get(jobId);
      workflowStatus = await instance.status();
    } catch (error) {
      console.log(`Workflow ${jobId} 不可用，使用資料庫狀態:`, error);
    }

    // 當前資料庫中的狀態
    let dbStatus = taskRecord.status as string;

    if (workflowStatus) {
      // 對映 Workflow 例項狀態到任務狀態
      const mappedStatus = this.mapWorkflowStatus(workflowStatus.status);

      // 如果 Workflow 已經進入終態，而資料庫仍然是 pending/running，則進行一次狀態同步
      const isDbRunning =
        dbStatus === TaskStatus.PENDING || dbStatus === TaskStatus.RUNNING;
      const isFinalStatus =
        mappedStatus === TaskStatus.COMPLETED ||
        mappedStatus === TaskStatus.FAILED ||
        mappedStatus === TaskStatus.CANCELLED ||
        mappedStatus === TaskStatus.PARTIAL;

      if (isDbRunning && isFinalStatus) {
        try {
          const finishedAtMs = workflowStatus.output?.finishedAt
            ? new Date(workflowStatus.output.finishedAt).getTime()
            : Date.now();
          const updatedAtMs = Date.now();

          await this.env.DB.prepare(`
            UPDATE ${DbTables.TASKS}
            SET status = ?, finished_at = ?, updated_at = ?
            WHERE task_id = ?
          `)
            .bind(mappedStatus, finishedAtMs, updatedAtMs, jobId)
            .run();

          dbStatus = mappedStatus;
        } catch (error) {
          console.warn(
            `[WorkflowsTaskOrchestrator] 同步作業 ${jobId} 狀態到 D1 失敗，將繼續使用記憶體狀態:`,
            error,
          );
        }
      }

      const effectiveStatus =
        dbStatus === TaskStatus.CANCELLED ? TaskStatus.CANCELLED : mappedStatus;

      return {
        jobId: taskRecord.task_id as string,
        taskType: taskRecord.task_type as string,
        status: effectiveStatus,
        stats: {
          totalItems: workflowStatus.output?.totalItems ?? dbStats.totalItems,
          processedItems: workflowStatus.output?.processedItems ?? dbStats.processedItems,
          successCount: workflowStatus.output?.successCount ?? dbStats.successCount,
          failedCount: workflowStatus.output?.failedCount ?? dbStats.failedCount,
          skippedCount: workflowStatus.output?.skippedCount ?? dbStats.skippedCount,
          totalBytes: dbStats.totalBytes,
          bytesTransferred: dbStats.bytesTransferred,
          itemResults: dbStats.itemResults,
        },
        createdAt: new Date(taskRecord.created_at as number),
        startedAt: taskRecord.started_at ? new Date(taskRecord.started_at as number) : undefined,
        finishedAt: workflowStatus.output?.finishedAt
          ? new Date(workflowStatus.output.finishedAt)
          : (taskRecord.finished_at ? new Date(taskRecord.finished_at as number) : undefined),
        updatedAt: new Date(taskRecord.updated_at as number),
        errorMessage: taskRecord.error_message as string | undefined,
        payload,
        userId: taskRecord.user_id as string,
        keyName: taskRecord.key_name as string | null,
        triggerType: (taskRecord as any).trigger_type as string,
        triggerRef: ((taskRecord as any).trigger_ref as string) ?? null,
      };
    }

    return {
      jobId: taskRecord.task_id as string,
      taskType: taskRecord.task_type as string,
      status: taskRecord.status as TaskStatus,
      stats: dbStats,
      createdAt: new Date(taskRecord.created_at as number),
      startedAt: taskRecord.started_at ? new Date(taskRecord.started_at as number) : undefined,
      finishedAt: taskRecord.finished_at ? new Date(taskRecord.finished_at as number) : undefined,
      updatedAt: new Date(taskRecord.updated_at as number),
      errorMessage: taskRecord.error_message as string | undefined,
      payload,
      userId: taskRecord.user_id as string,
      keyName: taskRecord.key_name as string | null,
      triggerType: (taskRecord as any).trigger_type as string,
      triggerRef: ((taskRecord as any).trigger_ref as string) ?? null,
    };
  }

  /** 取消作業 - 終止 Workflow 例項 + 更新資料庫狀態 */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const instance = await this.env.JOB_WORKFLOW.get(jobId);
      await instance.terminate();
    } catch (error) {
      console.log(`終止 Workflow ${jobId} 失敗:`, error);
    }

    await this.env.DB.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, updated_at = ?
      WHERE task_id = ?
    `).bind(
      'cancelled',
      Date.now(),
      jobId
    ).run();

    console.log(`[WorkflowsTaskOrchestrator] 已取消作業 ${jobId}`);
  }

  /** 列出作業 - 支援任務型別、狀態、使用者過濾 + 分頁 */
  async listJobs(filter?: JobFilter): Promise<JobListResult> {
    let whereClause = 'WHERE 1=1';
    const baseParams: (string | number)[] = [];

    if (filter?.taskType) {
      whereClause += ' AND t.task_type = ?';
      baseParams.push(filter.taskType);
    } else if (filter?.taskTypes && filter.taskTypes.length > 0) {
      const placeholders = filter.taskTypes.map(() => '?').join(', ');
      whereClause += ` AND t.task_type IN (${placeholders})`;
      baseParams.push(...filter.taskTypes);
    }

    if (filter?.status) {
      whereClause += ' AND t.status = ?';
      baseParams.push(filter.status);
    }

    if (filter?.userId) {
      whereClause += ' AND t.user_id = ?';
      baseParams.push(filter.userId);
    }

    const countQuery = `
      SELECT COUNT(1) as total
      FROM ${DbTables.TASKS} t
      ${whereClause}
    `;
    const countResult = await this.env.DB.prepare(countQuery).bind(...baseParams).first();
    const total = Number((countResult as any)?.total || 0);

    let query = `
      SELECT
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      ${whereClause}
      ORDER BY t.created_at DESC
    `;
    const params = [...baseParams];

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);

      if (filter.offset) {
        query += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const results = await this.env.DB.prepare(query).bind(...params).all();
    const jobs = results.results.map((row: any) => ({
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status,
      stats: JSON.parse(row.stats),
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),
      payload: JSON.parse(row.payload),
      userId: row.user_id,
      keyName: row.key_name || null,
      triggerType: row.trigger_type || 'manual',
      triggerRef: row.trigger_ref ?? null,
    }));

    return { jobs, total };
  }

  /** 刪除作業 - 僅終態作業，執行中需先取消 */
  async deleteJob(jobId: string): Promise<void> {
    const taskRecord = await this.env.DB.prepare(`
      SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).first();

    if (!taskRecord) {
      throw new Error(`作業 ${jobId} 不存在`);
    }

    const status = taskRecord.status as string;
    if (status === 'pending' || status === 'running') {
      throw new Error(`不能刪除執行中的作業 ${jobId},請先取消`);
    }

    await this.env.DB.prepare(`
      DELETE FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).run();

    console.log(`[WorkflowsTaskOrchestrator] 已刪除作業 ${jobId}`);
  }

  private parseWorkflowStatus(status: WorkflowInstanceStatus): JobStatus {
    return {
      jobId: status.id,
      taskType: '',  // 佔位符,實際使用時從資料庫獲取
      status: this.mapWorkflowStatus(status.status),
      stats: {
        totalItems: status.output?.totalItems || 0,
        processedItems: status.output?.processedItems || 0,
        successCount: status.output?.successCount || 0,
        failedCount: status.output?.failedCount || 0,
        skippedCount: status.output?.skippedCount || 0,
        bytesTransferred: 0,
      },
      createdAt: new Date(status.created),
      finishedAt: status.output?.finishedAt ? new Date(status.output.finishedAt) : undefined,
      payload: {},
    };
  }

  private mapWorkflowStatus(workflowStatus: string): TaskStatus {
    switch (workflowStatus) {
      case 'queued':
        return TaskStatus.PENDING;
      case 'running':
        return TaskStatus.RUNNING;
      // Workflows 的 status() 可能返回更多“非終態”狀態：
      // - waiting: 休眠/等待事件（不消耗 CPU，但例項仍在生命週期中）
      // - paused: 顯式暫停
      // - waitingForPause: 正在收尾以進入 paused
      // - unknown: 平臺無法判定（文件列出該值）
      //
      // 本專案內部 TaskStatus 僅建模 pending/running/...，沒有 paused/waiting。
      // 因此這裡做“語義摺疊”：
      // - waiting/paused/unknown → pending（非終態、非執行態）
      // - waitingForPause → running（仍可能在執行當前工作單元）
      //
      // 注意：是否允許“取消/終止”不應依賴 UI 文案，而應以終態判定為準；
      // 這裡的對映主要用於：列表展示 + allowedActions 的粗粒度判斷。
      case 'waiting':
      case 'paused':
      case 'unknown':
        return TaskStatus.PENDING;
      case 'waitingForPause':
        return TaskStatus.RUNNING;
      case 'complete':
        return TaskStatus.COMPLETED;
      case 'errored':
        return TaskStatus.FAILED;
      case 'terminated':
        return TaskStatus.CANCELLED;
      default:
        return TaskStatus.PENDING;
    }
  }

  /** 生成作業 ID - 格式: taskType-YYMMDDHHMM-random6 */
  private generateJobId(taskType: string): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${year}${month}${day}${hour}${minute}`;
    const random = Math.random().toString(36).substring(2, 8);
    return `${taskType}-${timeStr}-${random}`;
  }
}
