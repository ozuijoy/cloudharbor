/**
 * 跨儲存任務編排的共享型別定義（跨執行時）
 */

import type { JobDescriptor } from './TaskOrchestratorAdapter.js';

/** 任務狀態列舉 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  PARTIAL = 'partial',    // 部分項失敗
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** 單個檔案/專案的處理狀態 */
export type ItemStatus = 'pending' | 'processing' | 'retrying' | 'success' | 'failed' | 'skipped';

/**
 * 單個專案的處理結果（通用）
 *
 */
export interface ItemResult {
  /** 專案型別（可選）：copy/mount/path/... */
  kind?: string;
  /** 給 UI 展示的短文字（可選） */
  label?: string;

  /** copy 語義欄位（可選，copy 任務必填；其他任務可不填） */
  sourcePath?: string;
  targetPath?: string;

  status: ItemStatus;
  error?: string;              // 失敗時的錯誤資訊
  message?: string;            // 非失敗的提示資訊
  fileSize?: number;           // 檔案總大小（位元組）
  bytesTransferred?: number;   // 已傳輸位元組數
  retryCount?: number;         // 重試次數
  lastRetryAt?: number;        // 最後重試時間戳
  /** 通用耗時（毫秒），用於非 copy 任務描述“處理耗時” */
  durationMs?: number;
  /** 擴充套件欄位 */
  meta?: Record<string, any>;
}

/** 任務統計（通用，可擴充套件） */
export interface TaskStats {
  totalItems: number;
  processedItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes?: number;         // 總位元組數 (用於進度計算)
  bytesTransferred?: number;   // 已傳輸位元組數
  itemResults?: ItemResult[];  // 每個檔案的處理結果
  /** 允許不同任務型別擴充套件 stats 欄位 */
  [key: string]: any;
}

/** 重試策略 */
export interface RetryPolicy {
  limit: number;                      // 最大重試次數
  delay: number;                      // 重試延遲 (ms)
  backoff: 'linear' | 'exponential';  // 退避策略
}

/** 複製任務載荷 */
export interface CopyTaskPayload {
  items: Array<{
    sourcePath: string;
    targetPath: string;
  }>;
  options?: {
    skipExisting?: boolean;
    maxConcurrency?: number;
    retryPolicy?: RetryPolicy;
  };
}

/** 任務資料庫記錄 */
export interface TaskRecord<TPayload = unknown> {
  task_id: string;
  task_type: string;
  status: TaskStatus;
  payload: TPayload;
  stats: TaskStats;
  error_message?: string;
  user_id: string;
  user_type: string;
  workflow_instance_id?: string;  // Workers 專用
  created_at: number;
  started_at?: number;
  updated_at: number;
  finished_at?: number;
}

/** 複製任務記錄 */
export type CopyTaskRecord = TaskRecord<CopyTaskPayload>;

/** 復製作業描述符 (API 響應) */
export interface CopyJobDescriptor {
  jobId: string;
  status: TaskStatus;
  stats: TaskStats;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  items?: Array<{ sourcePath: string; targetPath: string }>;
  userId?: string;
}

/** 建立復製作業引數 */
export interface CreateCopyJobParams {
  userId: string;
  userType: string;
  items: Array<{ sourcePath: string; targetPath: string }>;
  options?: {
    skipExisting?: boolean;
    maxConcurrency?: number;
    retryPolicy?: RetryPolicy;
  };
}

/** 作業過濾條件 */
export interface JobFilter {
  status?: TaskStatus;
  taskType?: string;
  taskTypes?: string[];
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface JobListResult {
  jobs: JobDescriptor[];
  total: number;
}
