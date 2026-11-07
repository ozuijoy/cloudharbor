/**
 * SQLite 通用任務編排器實現 (Docker/Node.js 環境)
 *
 *
 */

import Database from 'better-sqlite3';
import { DbTables } from '../../../constants/index.js';
import { taskRegistry } from './TaskRegistry.js';
import type { TaskHandler, InternalJob, ExecutionContext } from './TaskHandler.js';
import type {
  TaskOrchestratorAdapter,
  CreateJobParams,
  JobDescriptor,
  JobStatus,
} from './TaskOrchestratorAdapter.js';
import { TaskStatus } from './types.js';
import type { JobFilter, JobListResult, TaskStats } from './types.js';

export class SQLiteTaskOrchestrator implements TaskOrchestratorAdapter {
  private db: Database.Database;
  private workers: Promise<void>[] = [];
  private running = false;
  private fileSystem: any;

  constructor(
    fileSystem: any,  // FileSystem 例項 (從工廠傳入)
    private dbPath: string = './data/database.db',  // 現有 D1 相容 SQLite 資料庫路徑
    private concurrency: number = 10  // Worker Pool 併發數
  ) {
    this.fileSystem = fileSystem;
    // 初始化 SQLite 連線 (tasks 表已由 database.js migration case 25 建立)
    this.db = new Database(dbPath);

    // PRAGMA 最佳化
    this.db.pragma('journal_mode = WAL');      // 併發讀效能
    this.db.pragma('synchronous = 1');         // 事務速度 (NORMAL 模式)
    this.db.pragma('busy_timeout = 5000');     // 5秒重試超時,避免 SQLITE_BUSY 錯誤

    // 啟動時恢復 pending/running 作業 (崩潰恢復)
    this.recoverJobs();

    // 啟動記憶體 Worker Pool
    this.startWorkers();

    console.log(
      `[SQLiteTaskOrchestrator] 已啟動 (併發數: ${concurrency}, 資料庫: ${dbPath})`
    );
  }

  /**
   * 更新 FileSystem 例項引用（單例模式下每次請求可能傳入不同例項）
   */
  updateFileSystem(fileSystem: any): void {
    this.fileSystem = fileSystem;
  }

  /**
   * 建立任意型別的作業
   */
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

    // 驗證任務型別並獲取處理器
    const handler = taskRegistry.getHandler(taskType);
    await handler.validate(payload);

    // 生成作業 ID (帶任務型別字首)
    const jobId = this.generateJobId(taskType);
    const now = Date.now();

    // 建立初始統計模板
    const stats = handler.createStatsTemplate(payload);

    // 插入資料庫
    this.db.prepare(`
      INSERT INTO ${DbTables.TASKS} (
        task_id, task_type, status, payload, stats,
        user_id, user_type,
        trigger_type, trigger_ref,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      taskType,  // 動態任務型別
      'pending',
      JSON.stringify(payload),
      JSON.stringify(stats),
      userId,
      userType,
      triggerType,
      triggerRef,
      now,
      now
    );

    console.log(
      `[SQLiteTaskOrchestrator] 已建立作業 ${jobId} (任務型別: ${taskType})`
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

  /**
   * 獲取作業狀態
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    // JOIN api_keys 表獲取金鑰名稱
    const row = this.db.prepare(`
      SELECT 
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      WHERE t.task_id = ?
    `).get(jobId) as any;

    if (!row) {
      throw new Error(`作業 ${jobId} 不存在`);
    }

    const payload = JSON.parse(row.payload);

    return {
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status as TaskStatus,
      stats: JSON.parse(row.stats) as TaskStats,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),  // 新增: 最後更新時間
      errorMessage: row.error_message || undefined,
      payload,
      userId: row.user_id,
      keyName: row.key_name || null,  // API 金鑰名稱
      triggerType: row.trigger_type || 'manual',
      triggerRef: row.trigger_ref ?? null,
    };
  }

  /**
   * 取消作業
   */
  async cancelJob(jobId: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, updated_at = ?
      WHERE task_id = ? AND status IN ('pending', 'running')
    `).run(
      TaskStatus.CANCELLED,
      Date.now(),
      jobId
    );

    if (result.changes === 0) {
      throw new Error('作業不存在或已完成,無法取消');
    }

    console.log(`[SQLiteTaskOrchestrator] 已取消作業 ${jobId}`);
  }

  /**
   * 列出作業 (支援任務型別過濾)
   */
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
    const countRow = this.db.prepare(countQuery).get(...baseParams) as any;
    const total = Number(countRow?.total || 0);

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

      if (filter?.offset) {
        query += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const results = this.db.prepare(query).all(...params) as any[];
    const jobs = results.map((row) => ({
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status as TaskStatus,
      stats: JSON.parse(row.stats) as TaskStats,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),  // 新增: 最後更新時間
      payload: JSON.parse(row.payload),
      userId: row.user_id,
      keyName: row.key_name || null,  // API 金鑰名稱
      triggerType: row.trigger_type || 'manual',
      triggerRef: row.trigger_ref ?? null,
    }));

    return { jobs, total };
  }

  /**
   * 刪除作業
   */
  async deleteJob(jobId: string): Promise<void> {
    const row = this.db.prepare(`
      SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
    `).get(jobId) as any;

    if (!row) {
      throw new Error(`作業 ${jobId} 不存在`);
    }

    if (row.status === TaskStatus.PENDING || row.status === TaskStatus.RUNNING) {
      throw new Error(`不能刪除執行中的作業 ${jobId},請先取消`);
    }

    this.db.prepare(`
      DELETE FROM ${DbTables.TASKS} WHERE task_id = ?
    `).run(jobId);

    console.log(`[SQLiteTaskOrchestrator] 已刪除作業 ${jobId}`);
  }

  // ==================== 內部方法 ====================

  /**
   * 啟動記憶體 Worker Pool
   */
  private startWorkers(): void {
    this.running = true;

    for (let i = 0; i < this.concurrency; i++) {
      this.workers.push(this.workerLoop());
    }

    console.log(`[SQLiteTaskOrchestrator] 已啟動 ${this.concurrency} 個 Worker`);
  }

  /**
   * Worker 迴圈 (持續執行直到 orchestrator 停止)
   * 使用指數退避策略最佳化空閒輪詢：初始 500ms，每次空閒翻倍，最大 8 秒
   */
  private async workerLoop(): Promise<void> {
    const MIN_POLL_INTERVAL = 500;   // 初始輪詢間隔 500ms
    const MAX_POLL_INTERVAL = 8000; // 最大輪詢間隔 8 秒
    let currentInterval = MIN_POLL_INTERVAL;

    while (this.running) {
      // 原子獲取下一個待執行作業
      const job = this.getNextJob();

      if (job) {
        // 有作業時重置輪詢間隔
        currentInterval = MIN_POLL_INTERVAL;
        await this.processJob(job);
      } else {
        // 無待處理作業，使用指數退避休眠
        await new Promise(resolve => setTimeout(resolve, currentInterval));
        // 指數增長，但不超過最大值
        currentInterval = Math.min(currentInterval * 2, MAX_POLL_INTERVAL);
      }
    }
  }

  /**
   * 原子獲取下一個待執行作業並標記為 running
   *
   * 使用 BEGIN IMMEDIATE TRANSACTION (而非 BEGIN TRANSACTION) 防止死鎖
   */
  private getNextJob(): InternalJob | null {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');  // 關鍵: IMMEDIATE 避免死鎖

    try {
      const row = this.db.prepare(`
        SELECT * FROM ${DbTables.TASKS}
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
      `).get() as any;

      if (row) {
        const now = Date.now();

        // 標記為 running
        this.db.prepare(`
          UPDATE ${DbTables.TASKS}
          SET status = ?, started_at = ?, updated_at = ?
          WHERE task_id = ?
        `).run(
          TaskStatus.RUNNING,
          now,
          now,
          row.task_id
        );

        this.db.exec('COMMIT');

        const payload = JSON.parse(row.payload);
        const stats: TaskStats = JSON.parse(row.stats);

        return {
          jobId: row.task_id,
          taskType: row.task_type,  // 從資料庫讀取
          payload,
          userId: row.user_id,
          userType: row.user_type,
          stats,
          createdAt: new Date(row.created_at),
        };
      }

      this.db.exec('ROLLBACK');
      return null;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 處理作業 (使用 TaskHandler 執行)
   */
  private async processJob(job: InternalJob): Promise<void> {
    console.log(
      `[SQLiteTaskOrchestrator] 開始處理作業 ${job.jobId} (任務型別: ${job.taskType})`
    );

    let errorMessage: string | undefined;

    try {
      // 獲取任務處理器
      const handler = taskRegistry.getHandler(job.taskType);

      // 建立執行上下文
      const context: ExecutionContext = {
        isCancelled: async (jobId: string) => {
          const row = this.db.prepare(`
            SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
          `).get(jobId) as any;
          return row?.status === TaskStatus.CANCELLED;
        },

        updateProgress: async (jobId: string, stats: Partial<TaskStats>) => {
          const currentRow = this.db.prepare(`
            SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
          `).get(jobId) as any;

          const currentStats = JSON.parse(currentRow.stats);
          const updatedStats = { ...currentStats, ...stats };

          this.db.prepare(`
            UPDATE ${DbTables.TASKS}
            SET stats = ?, updated_at = ?
            WHERE task_id = ?
          `).run(
            JSON.stringify(updatedStats),
            Date.now(),
            jobId
          );
        },

        getFileSystem: () => this.fileSystem,
        getEnv: () => ({ db: this.db }),
      };

      // 執行任務 (委託給 TaskHandler)
      await handler.execute(job, context);
    } catch (error: any) {
      errorMessage = error.message || String(error);
      console.error(
        `[SQLiteTaskOrchestrator] 作業 ${job.jobId} 執行失敗:`,
        error
      );
    }

    // 檢查最終狀態 (可能已被取消)
    const finalRow = this.db.prepare(`
      SELECT status, stats FROM ${DbTables.TASKS} WHERE task_id = ?
    `).get(job.jobId) as any;

    if (finalRow.status === TaskStatus.CANCELLED) {
      console.log(
        `[SQLiteTaskOrchestrator] 作業 ${job.jobId} 已被使用者取消,保持 cancelled 狀態`
      );
      return;
    }

    // 根據統計結果確定最終狀態
    const finalStats = JSON.parse(finalRow.stats) as TaskStats;
    const finalStatus: TaskStatus =
      errorMessage ? TaskStatus.FAILED :
      finalStats.failedCount === 0 ? TaskStatus.COMPLETED :
      finalStats.successCount === 0 ? TaskStatus.FAILED :
      TaskStatus.PARTIAL;

    // 更新最終狀態
    this.db.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, finished_at = ?, updated_at = ?, error_message = ?
      WHERE task_id = ?
    `).run(
      finalStatus,
      Date.now(),
      Date.now(),
      errorMessage || null,
      job.jobId
    );

    console.log(
      `[SQLiteTaskOrchestrator] 作業 ${job.jobId} 執行完成 (最終狀態: ${finalStatus})`
    );
  }

  /**
   * 崩潰恢復: 啟動時恢復 pending/running 作業
   */
  private recoverJobs(): void {
    const rows = this.db.prepare(`
      SELECT task_id, task_type FROM ${DbTables.TASKS}
      WHERE status IN ('pending', 'running')
      ORDER BY created_at
    `).all() as any[];

    for (const row of rows) {
      this.db.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, updated_at = ?
        WHERE task_id = ?
      `).run(
        'pending',
        Date.now(),
        row.task_id
      );
    }

    if (rows.length > 0) {
      console.log(
        `[SQLiteTaskOrchestrator] 已恢復 ${rows.length} 個待處理作業 ` +
          `(任務型別: ${[...new Set(rows.map(r => r.task_type))].join(', ')})`
      );
    }
  }

  /**
   * 生成唯一作業 ID (格式: taskType-YYMMDDHHMM-random6)
   * 示例: copy-2512011430-a3f5g7
   */
  private generateJobId(taskType: string): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2); // 25
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // 12
    const day = now.getDate().toString().padStart(2, '0'); // 01
    const hour = now.getHours().toString().padStart(2, '0'); // 14
    const minute = now.getMinutes().toString().padStart(2, '0'); // 30
    const timeStr = `${year}${month}${day}${hour}${minute}`; // 2512011430
    const random = Math.random().toString(36).substring(2, 8); // 6位隨機碼
    return `${taskType}-${timeStr}-${random}`;
  }

  /**
   * 優雅關閉 orchestrator (停止 Worker,關閉資料庫)
   */
  async shutdown(): Promise<void> {
    console.log('[SQLiteTaskOrchestrator] 正在關閉...');
    this.running = false;
    await Promise.all(this.workers);
    this.db.close();
    console.log('[SQLiteTaskOrchestrator] 已關閉');
  }
}
