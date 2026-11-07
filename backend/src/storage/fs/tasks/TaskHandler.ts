import type { TaskStats } from './types.js';

/**
 * 任務執行上下文 - 提供取消檢測、進度更新、檔案系統和環境訪問
 */
export interface ExecutionContext {
  /** 檢查作業是否已被取消 */
  isCancelled(jobId: string): Promise<boolean>;
  /** 更新作業進度統計 */
  updateProgress(jobId: string, stats: Partial<TaskStats>): Promise<void>;
  /** 獲取 FileSystem 例項 */
  getFileSystem(): any;
  /** 獲取環境繫結 (DB/R2/etc.) */
  getEnv(): any;
}

/**
 * 內部作業物件 - 傳遞給 TaskHandler.execute() 的作業資料
 */
export interface InternalJob {
  jobId: string;
  taskType: string;
  payload: any;
  userId: string;
  userType: string;
  stats: TaskStats;
  createdAt: Date;
}

/**
 * 任務處理器介面 - 每個任務型別實現一個處理器
 */
export interface TaskHandler {
  /** 任務型別識別符號 (必須唯一) */
  readonly taskType: string;

  /** 驗證任務載荷 - 在建立作業前呼叫 */
  validate(payload: any): Promise<void>;

  /** 執行任務 - 遍歷處理所有任務項，定期檢查取消狀態並更新進度 */
  execute(job: InternalJob, context: ExecutionContext): Promise<void>;

  /** 建立統計模板 - 根據載荷初始化統計物件 */
  createStatsTemplate(payload: any): TaskStats;
}
