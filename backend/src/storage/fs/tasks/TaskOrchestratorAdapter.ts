/**
 * 執行時無關的任務編排器介面
 * - Workers: WorkflowsTaskOrchestrator (Workflows API)
 * - Node.js: SQLiteTaskOrchestrator (Worker Pool + SQLite)
 */

import type { JobFilter, JobListResult, TaskStatus, TaskStats } from './types.js';

/** 建立作業引數 */
export interface CreateJobParams {
  /** 任務型別 (如 'copy', 'sync') - 必須在 TaskRegistry 中註冊 */
  taskType: string;
  /** 任務載荷 - 不同 taskType 結構不同 */
  payload: any;
  /** 使用者 ID */
  userId: string;
  /** 使用者型別 */
  userType: string;
  /**
   * 觸發方式
   * - manual: 使用者/管理員在頁面或 API 主動觸發
   * - scheduled: 由 scheduled_jobs 定時任務觸發
   */
  triggerType?: 'manual' | 'scheduled' | string;
  /**
   * 來源引用（可選）
   * - 例如 scheduled handlerId（scheduled_xxx）
   * - 或某個頁面/介面標識（如 admin/fs-index/rebuild）
   */
  triggerRef?: string | null;
}

/** 作業描述符 - 用於 API 響應 */
export interface JobDescriptor {
  /** 作業 ID - 格式: ${taskType}-${timestamp}-${random} */
  jobId: string;
  /** 任務型別 */
  taskType: string;
  /** 當前狀態 */
  status: TaskStatus;
  /** 聚合統計 */
  stats: TaskStats;
  /** 建立時間 */
  createdAt: Date;
  /** 開始時間 */
  startedAt?: Date;
  /** 完成時間 */
  finishedAt?: Date;
  /** 最後更新時間 */
  updatedAt?: Date;
  /** 原始載荷 */
  payload?: any;
  /** 觸發方式 */
  triggerType?: string;
  /** 來源引用 */
  triggerRef?: string | null;
}

/** 作業狀態響應 - 擴充套件描述符 */
export interface JobStatus extends JobDescriptor {
  /** 錯誤訊息 */
  errorMessage?: string;
  /** 原始載荷 */
  payload?: any;
  /** 使用者 ID */
  userId?: string;
  /** API 金鑰名稱 */
  keyName?: string | null;
}

/**
 * 任務編排器介面 - 支援多工型別
 */
export interface TaskOrchestratorAdapter {
  /**
   * 建立任意型別作業
   * 流程: 驗證型別 → 驗證載荷 → 生成 ID → 建立統計模板 → 啟動執行
   */
  createJob(params: CreateJobParams): Promise<JobDescriptor>;

  /** 獲取作業狀態 - 返回實時狀態和統計 */
  getJobStatus(jobId: string): Promise<JobStatus>;

  /** 取消作業 - 協作式取消，已完成項保持完成 */
  cancelJob(jobId: string): Promise<void>;

  /** 列出作業 - 支援過濾和分頁，按建立時間倒序 */
  listJobs(filter?: JobFilter): Promise<JobListResult>;

  /** 刪除作業 - 僅終態作業，執行中需先取消 */
  deleteJob(jobId: string): Promise<void>;
}
