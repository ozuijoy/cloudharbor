import type { TaskHandler } from './TaskHandler.js';

/**
 * 任務型別登錄檔 (單例) - 註冊和分發任務處理器
 */
class TaskRegistry {
  private static instance: TaskRegistry;
  private handlers = new Map<string, TaskHandler>();

  private constructor() {}

  static getInstance(): TaskRegistry {
    if (!TaskRegistry.instance) {
      TaskRegistry.instance = new TaskRegistry();
    }
    return TaskRegistry.instance;
  }

  /** 註冊任務處理器 */
  register(handler: TaskHandler): void {
    if (this.handlers.has(handler.taskType)) {
      throw new Error(`任務型別 "${handler.taskType}" 已註冊,不允許重複註冊`);
    }
    this.handlers.set(handler.taskType, handler);
    console.log(`[TaskRegistry] 已註冊任務型別: ${handler.taskType}`);
  }

  /** 獲取任務處理器 */
  getHandler(taskType: string): TaskHandler {
    const handler = this.handlers.get(taskType);
    if (!handler) {
      throw new Error(
        `未知任務型別: "${taskType}"\n` +
          `支援的任務型別: ${this.getSupportedTypes().join(', ')}`
      );
    }
    return handler;
  }

  /** 獲取所有支援的任務型別 */
  getSupportedTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** 檢查任務型別是否已註冊 */
  hasType(taskType: string): boolean {
    return this.handlers.has(taskType);
  }

  /** 獲取已註冊的任務處理器數量 */
  getHandlerCount(): number {
    return this.handlers.size;
  }
}

/** 全域性單例例項 - 在應用啟動時註冊所有任務處理器 */
export const taskRegistry = TaskRegistry.getInstance();
