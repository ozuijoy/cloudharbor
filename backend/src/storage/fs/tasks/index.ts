/**
 * 任務編排工廠和型別匯出
 * - 自動檢測執行時環境 (Workers 或 Node.js)
 * - 統一型別匯出
 */

import { WorkflowsTaskOrchestrator } from './WorkflowsTaskOrchestrator.js';
import { SQLiteTaskOrchestrator } from './SQLiteTaskOrchestrator.js';
import type { TaskOrchestratorAdapter } from './TaskOrchestratorAdapter.js';

// 型別匯出
export type { TaskOrchestratorAdapter, JobStatus } from './TaskOrchestratorAdapter.js';
export type {
  CreateCopyJobParams,
  CopyJobDescriptor,
  JobFilter,
  TaskStats,
  TaskRecord,
  CopyTaskRecord,
  CopyTaskPayload,
  RetryPolicy,
} from './types.js';
export { TaskStatus } from './types.js';

/** 執行時環境介面 */
export interface RuntimeEnv {
  // Workers 繫結
  JOB_WORKFLOW?: WorkflowNamespace;
  DB?: D1Database;
  // Node.js 配置
  TASK_DATABASE_PATH?: string;       // SQLite 路徑 (unified-entry.js 自動設定)
  TASK_WORKER_POOL_SIZE?: number;   // Worker 池大小 (預設 2)
}

/**
 * 獲取合理的 Worker 池大小
 * - 預設值: 2 
 * - 環境變數覆蓋: TASK_WORKER_POOL_SIZE
 * - 範圍限制: 1-10
 */
function getWorkerPoolSize(envSize?: number): number {
  const size = envSize ?? 2;  // 預設 2
  return Math.max(1, Math.min(10, size));  // 限制在 1-10 之間
}

/**
 * 全域性單例快取
 * - Node.js: 單例 SQLiteTaskOrchestrator（避免重複建立 Worker Pool）
 * - Workers: 每次請求需要傳入 env，但實際 Workflow 例項由 Cloudflare 管理
 */
let globalSQLiteOrchestrator: SQLiteTaskOrchestrator | null = null;

/**
 * 建立任務編排器 - 自動檢測執行時
 * - Workers: WorkflowsTaskOrchestrator (Workflows API + D1)
 * - Node.js: SQLiteTaskOrchestrator (Worker Pool + SQLite) - 全域性單例
 */
export function createTaskOrchestrator(
  fileSystem: any,
  env: RuntimeEnv
): TaskOrchestratorAdapter {
  // Workers 環境檢測 - 每次建立新例項（因為 env 包含請求級繫結）
  if (env.JOB_WORKFLOW && env.DB) {
    console.log('[TaskOrchestrator] ✓ Using WorkflowsTaskOrchestrator (Workers)');
    return new WorkflowsTaskOrchestrator(
      env as { JOB_WORKFLOW: WorkflowNamespace; DB: D1Database },
      fileSystem
    );
  }

  // Node.js 環境 - 使用全域性單例
  if (globalSQLiteOrchestrator) {
    // 更新 fileSystem 引用（可能是新例項）
    globalSQLiteOrchestrator.updateFileSystem(fileSystem);
    return globalSQLiteOrchestrator;
  }

  console.log('[TaskOrchestrator] Runtime detection:', {
    hasJobWorkflow: !!env.JOB_WORKFLOW,
    hasDB: !!env.DB,
    hasTaskDatabasePath: !!env.TASK_DATABASE_PATH,
  });

  console.log('[TaskOrchestrator] ✓ Creating SQLiteTaskOrchestrator singleton (Node.js)');
  if (!env.TASK_DATABASE_PATH) {
    console.warn('[TaskOrchestrator] WARNING: TASK_DATABASE_PATH not set, using fallback');
  }

  const poolSize = getWorkerPoolSize(env.TASK_WORKER_POOL_SIZE);
  globalSQLiteOrchestrator = new SQLiteTaskOrchestrator(
    fileSystem,
    env.TASK_DATABASE_PATH || './data/database.db',
    poolSize
  );

  return globalSQLiteOrchestrator;
}

/** Workers Workflow 名稱空間型別 */
interface WorkflowNamespace {
  create(params: { id: string; params: unknown }): Promise<any>;
  get(id: string): Promise<any>;
}
