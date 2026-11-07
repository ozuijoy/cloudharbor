import { reactive, readonly } from "vue";
import { useDebounceFn, useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

// localStorage鍵名
const STORAGE_KEY = "cloudharbor_tasks";

// 配置項
const MAX_TASK_AGE_DAYS = 7; // 保留任務的最大天數
const log = createLogger("TaskManager");

// 任務狀態列舉
export const TaskStatus = {
  PENDING: "pending", // 待處理
  RUNNING: "running", // 執行中
  COMPLETED: "completed", // 已完成
  FAILED: "failed", // 失敗
  CANCELLED: "cancelled", // 已取消
};

// 任務型別列舉
export const TaskType = {
  COPY: "copy", // 複製任務
  UPLOAD: "upload", // 上傳任務
  DELETE: "delete", // 刪除任務
  DOWNLOAD: "download", // 下載任務
};

// 建立任務狀態儲存
const state = reactive({
  tasks: [], // 任務列表
  nextId: 1, // 下一個任務ID
});

// 管理持久化
const storedTasksState = useLocalStorage(STORAGE_KEY, null);
const persistNow = () => {
  storedTasksState.value = {
    tasks: state.tasks,
    nextId: state.nextId,
  };
};
const persistDebounced = useDebounceFn(persistNow, 500);
const saveTasksToStorage = () => {
  try {
    persistDebounced();
  } catch (error) {
    log.error("儲存任務到本地儲存失敗:", error);
  }
};

// 清理過期任務
const cleanExpiredTasks = (tasks) => {
  if (!Array.isArray(tasks)) return [];

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - MAX_TASK_AGE_DAYS * 24 * 60 * 60 * 1000);

  return tasks.filter((task) => {
    const taskDate = new Date(task.updatedAt);
    return taskDate >= cutoffDate;
  });
};

// 從localStorage載入任務
const loadTasksFromStorage = () => {
  try {
    const parsedData = storedTasksState.value;
    if (parsedData) {

      // 恢復日期物件（JSON.parse會將日期字串轉為字串）
      if (parsedData.tasks && Array.isArray(parsedData.tasks)) {
        parsedData.tasks.forEach((task) => {
          task.createdAt = new Date(task.createdAt);
          task.updatedAt = new Date(task.updatedAt);
        });

        // 清理過期任務
        const cleanedTasks = cleanExpiredTasks(parsedData.tasks);

        // 更新狀態
        state.tasks = cleanedTasks;
        state.nextId = parsedData.nextId || 1;

        log.debug(`從本地儲存載入了 ${cleanedTasks.length} 個任務`);
      }
    }
  } catch (error) {
    log.error("從本地儲存載入任務失敗:", error);
  }
};

// 初始化時載入任務
loadTasksFromStorage();

// 工作管理員方法
const taskManager = {
  // 新增新任務
  addTask(taskType, name, total = 100) {
    const task = {
      id: state.nextId++,
      type: taskType,
      name,
      progress: 0,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      total,
      error: null,
      details: {},
    };

    state.tasks.push(task);
    saveTasksToStorage(); // 儲存到本地儲存
    return task.id;
  },

  // 更新任務進度
  updateTaskProgress(taskId, progress, details = {}) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (task) {
      task.progress = progress;
      task.status = TaskStatus.RUNNING;
      task.updatedAt = new Date();
      task.details = { ...task.details, ...details };
      saveTasksToStorage(); // 儲存到本地儲存
    }
  },

  // 完成任務
  completeTask(taskId, details = {}) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (task) {
      task.progress = 100;
      task.status = TaskStatus.COMPLETED;
      task.updatedAt = new Date();
      task.details = { ...task.details, ...details };
      saveTasksToStorage(); // 儲存到本地儲存
    }
  },

  // 標記任務失敗
  failTask(taskId, error, details = {}) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = TaskStatus.FAILED;
      task.error = error;
      task.updatedAt = new Date();
      task.details = { ...task.details, ...details };
      saveTasksToStorage(); // 儲存到本地儲存
    }
  },

  // 取消任務
  cancelTask(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = TaskStatus.CANCELLED;
      task.updatedAt = new Date();
      saveTasksToStorage(); // 儲存到本地儲存
    }
  },

  // 清除已完成的任務
  clearCompletedTasks() {
    state.tasks = state.tasks.filter((t) => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.FAILED && t.status !== TaskStatus.CANCELLED);
    saveTasksToStorage(); // 儲存到本地儲存
  },

  // 清除所有任務
  clearAllTasks() {
    state.tasks = [];
    saveTasksToStorage();
  },

  // 手動儲存任務到本地儲存
  manualSaveToStorage() {
    saveTasksToStorage();
  },

  // 手動從本地儲存載入任務
  manualLoadFromStorage() {
    loadTasksFromStorage();
  },

  // 獲取任務儲存統計資訊
  getStorageStats() {
    try {
      const stats = {
        totalTasks: state.tasks.length,
        byStatus: {
          [TaskStatus.PENDING]: 0,
          [TaskStatus.RUNNING]: 0,
          [TaskStatus.COMPLETED]: 0,
          [TaskStatus.FAILED]: 0,
          [TaskStatus.CANCELLED]: 0,
        },
        byType: {
          [TaskType.COPY]: 0,
          [TaskType.UPLOAD]: 0,
          [TaskType.DELETE]: 0,
          [TaskType.DOWNLOAD]: 0,
        },
        oldestTask: null,
        newestTask: null,
        storageUsage: 0,
      };

      // 統計各狀態和型別的任務數量
      state.tasks.forEach((task) => {
        stats.byStatus[task.status]++;
        stats.byType[task.type]++;
      });

      // 找出最早和最新的任務
      if (state.tasks.length > 0) {
        const sortedTasks = [...state.tasks].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        stats.oldestTask = sortedTasks[0].createdAt;
        stats.newestTask = sortedTasks[sortedTasks.length - 1].createdAt;
      }

      // 估計儲存使用量
      const storageData = JSON.stringify({
        tasks: state.tasks,
        nextId: state.nextId,
      });
      stats.storageUsage = new Blob([storageData]).size;

      return stats;
    } catch (error) {
      log.error("獲取儲存統計資訊失敗:", error);
      return null;
    }
  },

  // 獲取所有任務
  getTasks() {
    return state.tasks;
  },
};

// 匯出只讀狀態和方法
export const useTaskManager = () => {
  return {
    state: readonly(state),
    ...taskManager,
  };
};
