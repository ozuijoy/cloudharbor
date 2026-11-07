/**
 * 排程任務登錄檔
 * - 管理後臺排程作業（scheduled_jobs）的 handler
 * - 每個 handler 透過 handler.id 進行繫結
 *   - handler.id：任務型別 ID（例如 'cleanup_upload_sessions'）
 *   - scheduled_jobs.task_id：作業例項 ID（例如 'cleanup_upload_sessions_default'）
 * - 支援儲存和查詢 handler 後設資料（name、description、category、configSchema）
 */

export class ScheduledTaskRegistry {
  constructor() {
    /**
     * 儲存完整的 handler 物件
     * @type {Map<string, {
     *   id: string,
     *   name: string,
     *   description: string,
     *   category: "maintenance" | "business",
     *   configSchema: Array<{
     *     name: string,
     *     label: string,
     *     type: "string" | "number" | "boolean" | "select" | "textarea",
     *     defaultValue: any,
     *     required: boolean,
     *     min?: number,
     *     max?: number,
     *     options?: Array<{ value: any, label: string }>,
     *     description?: string
     *   }>,
     *   run: (ctx: any) => Promise<void>
     * }>}
     */
    this.handlers = new Map();
  }

  /**
   * 註冊排程任務處理器（含後設資料）
   * @param {{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>,
   *   run: (ctx: any) => Promise<void>
   * }} handler
   */
  register(handler) {
    // 驗證必需欄位：id
    if (!handler || typeof handler.id !== "string" || handler.id.length === 0) {
      throw new Error("[ScheduledTaskRegistry] handler.id 必須是非空字串");
    }
    // 驗證必需欄位：run
    if (typeof handler.run !== "function") {
      throw new Error(
        `[ScheduledTaskRegistry] handler.run 必須是可呼叫函式 (taskId=${handler.id})`,
      );
    }
    // 驗證必需欄位：name
    if (typeof handler.name !== "string" || handler.name.length === 0) {
      throw new Error(
        `[ScheduledTaskRegistry] handler.name 必須是非空字串 (taskId=${handler.id})`,
      );
    }
    // 驗證必需欄位：category
    if (handler.category !== "maintenance" && handler.category !== "business") {
      throw new Error(
        `[ScheduledTaskRegistry] handler.category 必須是 "maintenance" 或 "business" (taskId=${handler.id})`,
      );
    }

    this.handlers.set(handler.id, handler);
  }

  /**
   * 獲取所有 handler 的後設資料
   * @returns {Array<{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>
   * }>}
   */
  getHandlerTypes() {
    return Array.from(this.handlers.values()).map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description || "",
      category: h.category,
      configSchema: h.configSchema || [],
    }));
  }

  /**
   * 獲取單個 handler 的後設資料
   * @param {string} taskId
   * @returns {{
   *   id: string,
   *   name: string,
   *   description: string,
   *   category: "maintenance" | "business",
   *   configSchema: Array<object>
   * } | null}
   */
  getHandlerType(taskId) {
    const h = this.handlers.get(taskId);
    if (!h) return null;
    return {
      id: h.id,
      name: h.name,
      description: h.description || "",
      category: h.category,
      configSchema: h.configSchema || [],
    };
  }

  /**
   * 獲取完整的 handler 物件
   * @param {string} taskId
   * @returns {{ id: string, run: (ctx: any) => Promise<void>, ... } | null}
   */
  getHandler(taskId) {
    if (!this.handlers.size) {
      return null;
    }
    return this.handlers.get(taskId) || null;
  }

  /**
   * 列出所有已註冊的任務 ID
   * @returns {string[]}
   */
  listIds() {
    return Array.from(this.handlers.keys());
  }
}

/**
 * 全域性單例登錄檔
 */
export const scheduledTaskRegistry = new ScheduledTaskRegistry();

/**
 * 註冊內建的維護任務處理器
 * - 注意：在應用啟動階段呼叫一次
 */
export function registerScheduledHandlers() {
  // 動態匯入內建任務處理器，避免 Workers 打包階段靜態分析衝突

  // 1) upload_sessions 清理任務
  import("./tasks/CleanupUploadSessionsTask.js")
    .then((mod) => {
      const TaskCtor = mod.CleanupUploadSessionsTask;
      if (TaskCtor) {
        const taskInstance = new TaskCtor();
        scheduledTaskRegistry.register(taskInstance);
        console.log(
          `[ScheduledTaskRegistry] 成功註冊排程任務: ${taskInstance.id}`,
        );
      }
    })
    .catch((err) => {
      console.warn(
        "[ScheduledTaskRegistry] 註冊 CleanupUploadSessionsTask 失敗:",
        err,
      );
    });

  // 2) 跨驅動同步任務（基於 copy Job 的單向同步）
  import("./tasks/ScheduledSyncCopyTask.js")
    .then((mod) => {
      const TaskCtor = mod.ScheduledSyncCopyTask;
      if (TaskCtor) {
        const taskInstance = new TaskCtor();
        scheduledTaskRegistry.register(taskInstance);
        console.log(
          `[ScheduledTaskRegistry] 成功註冊排程任務: ${taskInstance.id}`,
        );
      }
    })
    .catch((err) => {
      console.warn(
        "[ScheduledTaskRegistry] 註冊 ScheduledSyncCopyTask 失敗:",
        err,
      );
    });

  // 3) FS 搜尋索引重建（可選業務任務；不預設建立 scheduled_jobs 記錄）
  import("./tasks/ScheduledFsIndexRebuildTask.js")
    .then((mod) => {
      const TaskCtor = mod.ScheduledFsIndexRebuildTask;
      if (TaskCtor) {
        const taskInstance = new TaskCtor();
        scheduledTaskRegistry.register(taskInstance);
        console.log(
          `[ScheduledTaskRegistry] 成功註冊排程任務: ${taskInstance.id}`,
        );
      }
    })
    .catch((err) => {
      console.warn(
        "[ScheduledTaskRegistry] 註冊 ScheduledFsIndexRebuildTask 失敗:",
        err,
      );
    });

  // 4) FS 搜尋索引 dirty 增量應用（可選業務任務；不預設建立 scheduled_jobs 記錄）
  import("./tasks/ScheduledFsIndexApplyDirtyTask.js")
    .then((mod) => {
      const TaskCtor = mod.ScheduledFsIndexApplyDirtyTask;
      if (TaskCtor) {
        const taskInstance = new TaskCtor();
        scheduledTaskRegistry.register(taskInstance);
        console.log(
          `[ScheduledTaskRegistry] 成功註冊排程任務: ${taskInstance.id}`,
        );
      }
    })
    .catch((err) => {
      console.warn(
        "[ScheduledTaskRegistry] 註冊 ScheduledFsIndexApplyDirtyTask 失敗:",
        err,
      );
    });

  // 5) 儲存用量快照重新整理（預設建立 scheduled_jobs 記錄）
  import("./tasks/RefreshStorageUsageSnapshotsTask.js")
    .then((mod) => {
      const TaskCtor = mod.RefreshStorageUsageSnapshotsTask;
      if (TaskCtor) {
        const taskInstance = new TaskCtor();
        scheduledTaskRegistry.register(taskInstance);
        console.log(
          `[ScheduledTaskRegistry] 成功註冊排程任務: ${taskInstance.id}`,
        );
      }
    })
    .catch((err) => {
      console.warn(
        "[ScheduledTaskRegistry] 註冊 RefreshStorageUsageSnapshotsTask 失敗:",
        err,
      );
    });
}
