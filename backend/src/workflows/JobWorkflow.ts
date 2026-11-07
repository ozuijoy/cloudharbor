/**
 * Cloudflare Workflows 通用作業入口點
 * - 支援任意任務型別,透過 TaskRegistry 動態分發
 * - 持久化執行 + 步驟級重試
 * - 雙層資料: Workflow 例項 (3-7天) + D1 tasks 表 (永久)
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

// @ts-ignore - JS modules lack type declarations
import { MountManager } from "../storage/managers/MountManager.js";
// @ts-ignore - JS modules lack type declarations
import { FileSystem } from "../storage/fs/FileSystem.js";
// @ts-ignore - JS modules lack type declarations
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { DbTables } from "../constants/index.js";
import { taskRegistry } from "../storage/fs/tasks/TaskRegistry.js";
import type { ExecutionContext, InternalJob } from "../storage/fs/tasks/TaskHandler.js";
import { TaskStatus } from "../storage/fs/tasks/types.js";
import type { TaskStats } from "../storage/fs/tasks/types.js";

/** Workflow 引數 */
export interface JobWorkflowParams {
  jobId: string;
  taskType: string;
  payload: any;
  userId: string;
  userType: string;
}

/** Workers 環境繫結 */
interface Env {
  DB: D1Database;
  ENCRYPTION_SECRET: string;
}

/** 通用作業 Workflow - 持久化執行 + 自動重試 */
export class JobWorkflow extends WorkflowEntrypoint<Env, JobWorkflowParams> {
  async run(event: WorkflowEvent<JobWorkflowParams>, step: WorkflowStep) {
    const { jobId, taskType, payload, userId, userType } = event.payload;

    console.log(`[JobWorkflow] 啟動作業 ${jobId}, 任務型別: ${taskType}`);

    // 獲取任務處理器
    let handler;
    try {
      handler = taskRegistry.getHandler(taskType);
    } catch (error: any) {
      console.error(`[JobWorkflow] 未知任務型別 ${taskType}:`, error);

      await step.do('record-invalid-task-type', async () => {
        await this.env.DB.prepare(`
          UPDATE ${DbTables.TASKS}
          SET status = ?, error_message = ?, updated_at = ?, finished_at = ?
          WHERE task_id = ?
        `).bind(
          'failed',
          `未知任務型別: ${taskType}`,
          Date.now(),
          Date.now(),
          jobId
        ).run();
        return { error: 'invalid_task_type' };
      });

      throw error;
    }

    // 標記為 running
    await step.do('mark-running', async () => {
      await this.env.DB.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, started_at = ?, updated_at = ?
        WHERE task_id = ?
      `).bind(
        'running',
        Date.now(),
        Date.now(),
        jobId
      ).run();
      return { success: true };
    });

    // 執行任務
    let taskSuccess = true;
    let taskError: Error | null = null;

    await step.do(
      'execute-task',
      {
        retries: {
          limit: 3,
          delay: 10000,
          backoff: "exponential" as const,
        },
        timeout: 600000,
      },
      async () => {
        try {
          console.log(`[JobWorkflow] 執行任務 ${jobId} (型別: ${taskType})`);

          // 建立執行上下文
          // 進度更新節流：避免高頻寫 D1 導致放大
          // - Handler 積極地上報（例如每 N 個目錄/每批 upsert）
          let lastProgressWriteAtMs = 0;
          let pendingProgressPatch: Partial<TaskStats> | null = null;

          const context: ExecutionContext = {
            isCancelled: async (jobId: string) => {
              const row = await this.env.DB.prepare(`
                SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
              `).bind(jobId).first();
              return row?.status === 'cancelled';
            },

            updateProgress: async (jobId: string, stats: Partial<TaskStats>) => {
              const nowMs = Date.now();

              // 合併到 pending（低成本，避免頻繁讀寫 DB）
              pendingProgressPatch = { ...(pendingProgressPatch || {}), ...(stats || {}) };

              // 強制寫入條件：關鍵統計變化（mount 級/結果級）
              const forceWrite =
                stats?.processedItems !== undefined ||
                stats?.totalItems !== undefined ||
                stats?.successCount !== undefined ||
                stats?.failedCount !== undefined ||
                stats?.skippedCount !== undefined;

              // 時間節流：預設 2s 寫一次（forceWrite 例外）
              if (!forceWrite && nowMs - lastProgressWriteAtMs < 2000) {
                return;
              }
              lastProgressWriteAtMs = nowMs;

              const currentRow = await this.env.DB.prepare(`
                SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
              `).bind(jobId).first();

              if (!currentRow) {
                console.error(`[JobWorkflow] 作業 ${jobId} 未找到,無法更新進度`);
                return;
              }

              const currentStats = JSON.parse(currentRow.stats as string);
              const updatedStats = {
                ...currentStats,
                ...(pendingProgressPatch || {}),
                heartbeatAtMs: nowMs,
              };
              pendingProgressPatch = null;

              await this.env.DB.prepare(`
                UPDATE ${DbTables.TASKS}
                SET stats = ?, updated_at = ?
                WHERE task_id = ?
              `).bind(
                JSON.stringify(updatedStats),
                Date.now(),
                jobId
              ).run();
            },

            getFileSystem: () => {
              const repositoryFactory = ensureRepositoryFactory(this.env.DB);
              const mountManager = new MountManager(
                this.env.DB,
                this.env.ENCRYPTION_SECRET,
                repositoryFactory,
                { env: this.env as any },
              );
              return new FileSystem(mountManager, this.env);
            },

            getEnv: () => this.env,
          };

          const job: InternalJob = {
            jobId,
            taskType,
            payload,
            userId,
            userType,
            stats: {
              totalItems: 0,
              processedItems: 0,
              successCount: 0,
              failedCount: 0,
              skippedCount: 0,
            },
            createdAt: new Date(),
          };

          await handler.execute(job, context);

          console.log(`[JobWorkflow] ✓ 任務 ${jobId} 執行成功`);
          return { success: true };
        } catch (error: any) {
          taskSuccess = false;
          taskError = error;
          console.error(`[JobWorkflow] ✗ 任務 ${jobId} 執行失敗:`, error);

          return {
            success: false,
            error: error.message || String(error),
          };
        }
      }
    );

    // 最終化狀態
    await step.do('finalize-task-record', async () => {
      console.log(`[JobWorkflow] 最終化作業記錄 ${jobId}`);

      const finalRow = await this.env.DB.prepare(`
        SELECT status, stats FROM ${DbTables.TASKS} WHERE task_id = ?
      `).bind(jobId).first();

      if (finalRow?.status === 'cancelled') {
        console.log(`[JobWorkflow] 作業 ${jobId} 已被使用者取消,保持 cancelled 狀態`);
        return { cancelled: true };
      }

      const finalStats = JSON.parse(finalRow?.stats as string || '{}') as TaskStats;
      let finalStatus: TaskStatus;

      if (!taskSuccess && taskError) {
        finalStatus = TaskStatus.FAILED;
      } else {
        finalStatus =
          finalStats.failedCount === 0 ? TaskStatus.COMPLETED :
          finalStats.successCount === 0 ? TaskStatus.FAILED :
          TaskStatus.PARTIAL;
      }

      const errorMessage =
        finalRow?.status === 'cancelled' ? '任務已被使用者取消' :
        taskError ? taskError.message || String(taskError) :
        finalStats.failedCount > 0 ? `部分專案失敗 (${finalStats.failedCount}/${finalStats.totalItems})` :
        null;

      await this.env.DB.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, stats = ?, finished_at = ?, updated_at = ?, error_message = ?
        WHERE task_id = ?
      `).bind(
        finalStatus,
        JSON.stringify(finalStats),
        Date.now(),
        Date.now(),
        errorMessage,
        jobId
      ).run();

      console.log(`[JobWorkflow] ✓ 作業記錄已最終化,狀態: ${finalStatus}`);
      return { status: finalStatus };
    });

    const finalRow = await this.env.DB.prepare(`
      SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).first();

    const finalStats = finalRow ? JSON.parse(finalRow.stats as string) as TaskStats : {
      totalItems: 0,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    return {
      ...finalStats,
      finishedAt: new Date().toISOString(),
    };
  }
}
