import { taskRegistry } from './TaskRegistry.js';
import { CopyTaskHandler } from './handlers/CopyTaskHandler.js';
import { FsIndexRebuildTaskHandler } from './handlers/FsIndexRebuildTaskHandler.js';
import { FsIndexApplyDirtyTaskHandler } from './handlers/FsIndexApplyDirtyTaskHandler.js';

/**
 * 註冊所有任務處理器
 *
 * 在應用啟動時呼叫,向 TaskRegistry 註冊所有任務型別的處理器
 *
 * 註冊順序:
 * 1. CopyTaskHandler - 複製任務
 * 2. (未來) ScheduledSyncTaskHandler - 定時同步任務
 * 3. (未來) CleanupTaskHandler - 清理任務
 * 4. (未來) ArchiveTaskHandler - 歸檔任務
 *
 * @example
 * ```typescript
 * // backend/unified-entry.js
 * import { registerTaskHandlers } from './src/storage/fs/tasks/registerHandlers.js';
 *
 * // 應用啟動時註冊
 * registerTaskHandlers();
 * ```
 */
export function registerTaskHandlers(): void {
  console.log('[TaskRegistry] 開始註冊任務處理器...');

  // 註冊複製任務處理器
  taskRegistry.register(new CopyTaskHandler());

  // 註冊 FS 索引重建任務處理器
  taskRegistry.register(new FsIndexRebuildTaskHandler());

  // 註冊 FS 索引增量應用任務處理器（消費 dirty 佇列）
  taskRegistry.register(new FsIndexApplyDirtyTaskHandler());

  // 未來擴充套件 (零核心程式碼修改):
  // taskRegistry.register(new ScheduledSyncTaskHandler());
  // taskRegistry.register(new CleanupTaskHandler());
  // taskRegistry.register(new ArchiveTaskHandler());

  const supportedTypes = taskRegistry.getSupportedTypes();
  console.log(
    `[TaskRegistry] 註冊完成! 共註冊 ${supportedTypes.length} 個任務型別: ${supportedTypes.join(', ')}`
  );
}
