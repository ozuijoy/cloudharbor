import { get, post, put, del } from "@/api/client";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ScheduledJobService");

/**
 * @typedef {Object} ScheduledJob
 * @property {string} taskId - 作業ID（jobId，唯一標識此排程作業）
 * @property {string} [handlerId] - 任務處理器型別ID（Handler ID），對應後端 ScheduledTaskRegistry 中的 handler.id
 * @property {string} [name] - 作業名稱（展示用）
 * @property {string|null} [description] - 作業描述/備註
 * @property {boolean} enabled - 是否啟用
 * @property {"interval"|"cron"} scheduleType - 排程型別
 * @property {number} [intervalSec] - 執行間隔(秒)，僅 interval 模式有效
 * @property {string|null} [cronExpression] - Cron 表示式，僅 cron 模式有效
 * @property {number} [runCount] - 累計執行次數（成功/失敗均計入）
 * @property {number} [failureCount] - 累計失敗次數
 * @property {string|null} [lastRunStatus] - 最近一次執行狀態 success/failure/skipped
 * @property {string|null} [lastRunStartedAt] - 最近一次執行開始時間(ISO格式)
 * @property {string|null} [lastRunFinishedAt] - 最近一次執行結束時間(ISO格式)
 * @property {string|null} nextRunAfter - 下次執行時間(ISO格式)
 * @property {string|null} lockUntil - 鎖過期時間(ISO格式)
 * @property {"disabled"|"scheduled"|"pending"|"running"|"idle"} [runtimeState] - 當前執行狀態
 * @property {Object} config - 任務配置引數
 * @property {string[]} [previewNextRuns] - 未來預覽的執行時間列表（ISO字串，最多5條）
 */

/**
 * @typedef {Object} ScheduledJobRun
 * @property {number} id - 執行記錄ID
 * @property {string} taskId - 任務ID
 * @property {string} status - 執行狀態 (success/failure/skipped)
 * @property {string} startedAt - 開始時間(ISO格式)
 * @property {string|null} finishedAt - 結束時間(ISO格式)
 * @property {number|null} durationMs - 執行耗時(毫秒)
 * @property {string|null} summary - 簡要摘要
 * @property {string|null} errorMessage - 錯誤資訊
 */

/**
 * @typedef {Object} FieldSchema
 * @property {string} name - 欄位名
 * @property {string} label - 欄位標籤
 * @property {"string"|"number"|"boolean"|"select"|"textarea"} type - 欄位型別
 * @property {any} defaultValue - 預設值
 * @property {boolean} required - 是否必填
 * @property {number} [min] - 最小值（number型別）
 * @property {number} [max] - 最大值（number型別）
 * @property {Array<{value: any, label: string}>} [options] - 選項（select型別）
 * @property {string} [description] - 欄位描述
 */

/**
 * @typedef {Object} HandlerType
 * @property {string} id - Handler ID
 * @property {string} name - Handler 顯示名稱
 * @property {string} description - Handler 描述
 * @property {"maintenance"|"business"} category - Handler 類別
 * @property {FieldSchema[]} configSchema - 配置引數 Schema
 */

/**
 * 定時任務管理 Service
 * 
 * 封裝定時任務相關的所有API呼叫
 */
export function useScheduledJobService() {
  /**
   * 獲取定時任務列表
   * @param {{taskId?: string, enabled?: boolean}} [params] - 查詢引數
   * @returns {Promise<{items: ScheduledJob[]}>}
   */
  const getScheduledJobs = async (params = {}) => {
    try {
      const resp = await get("/admin/scheduled/jobs", { params });
      
      if (!resp) {
        throw new Error("獲取定時任務列表失敗");
      }

      // 處理統一響應格式
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取定時任務列表失敗");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      // 直接返回陣列或包含items的物件
      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error("[ScheduledJobService] 獲取任務列表失敗:", error);
      throw error;
    }
  };

  /**
   * 獲取單個定時任務詳情
   * @param {string} taskId - 任務ID
   * @returns {Promise<ScheduledJob>}
   */
  const getScheduledJob = async (taskId) => {
    try {
      const resp = await get(`/admin/scheduled/jobs/${taskId}`);
      
      if (!resp) {
        throw new Error("獲取任務詳情失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取任務詳情失敗");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 獲取任務詳情失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 建立定時任務
   * @param {{taskId?: string, handlerId: string, name?: string, description?: string, scheduleType?: "interval"|"cron", intervalSec?: number, cronExpression?: string, enabled?: boolean, config?: Object}} data - 任務資料
   * @returns {Promise<ScheduledJob>}
   */
  const createScheduledJob = async (data) => {
    try {
      const resp = await post("/admin/scheduled/jobs", data);
      
      if (!resp) {
        throw new Error("建立定時任務失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "建立定時任務失敗");
        }
        return resp.data || data;
      }

      return resp;
    } catch (error) {
    log.error("[ScheduledJobService] 建立任務失敗:", error);
      throw error;
    }
  };

  /**
   * 更新定時任務
   * @param {string} taskId - 任務ID
   * @param {{scheduleType?: "interval"|"cron", intervalSec?: number, cronExpression?: string, enabled?: boolean, config?: Object, name?: string, description?: string, handlerId?: string}} data - 更新資料
   * @returns {Promise<ScheduledJob>}
   */
  const updateScheduledJob = async (taskId, data) => {
    try {
      const resp = await put(`/admin/scheduled/jobs/${taskId}`, data);
      
      if (!resp) {
        throw new Error("更新定時任務失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "更新定時任務失敗");
        }
        return resp.data || { taskId, ...data };
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 更新任務失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 刪除定時任務
   * @param {string} taskId - 任務ID
   * @returns {Promise<boolean>}
   */
  const deleteScheduledJob = async (taskId) => {
    try {
      const resp = await del(`/admin/scheduled/jobs/${taskId}`);
      
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "刪除定時任務失敗");
        }
      }

      return true;
    } catch (error) {
    log.error(`[ScheduledJobService] 刪除任務失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 獲取任務執行歷史記錄
   * @param {string} taskId - 任務ID
   * @param {{limit?: number}} [params] - 查詢引數
   * @returns {Promise<{items: ScheduledJobRun[]}>}
   */
  const getScheduledJobRuns = async (taskId, params = {}) => {
    try {
      const resp = await get(`/admin/scheduled/jobs/${taskId}/runs`, { params });
      
      if (!resp) {
        throw new Error("獲取執行歷史失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取執行歷史失敗");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error(`[ScheduledJobService] 獲取執行歷史失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 切換任務啟用狀態
   * @param {string} taskId - 任務ID
   * @param {boolean} enabled - 是否啟用
   * @returns {Promise<ScheduledJob>}
   */
  const toggleScheduledJob = async (taskId, enabled) => {
    return updateScheduledJob(taskId, { enabled });
  };

  // ==================== Handler 型別 API ====================

  /**
   * 獲取所有 handler 型別列表
   * @returns {Promise<{items: HandlerType[]}>}
   */
  const getHandlerTypes = async () => {
    try {
      const resp = await get("/admin/scheduled/types");

      if (!resp) {
        throw new Error("獲取handler型別列表失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取handler型別列表失敗");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error("[ScheduledJobService] 獲取handler型別列表失敗:", error);
      throw error;
    }
  };

  /**
   * 獲取單個 handler 型別詳情
   * @param {string} taskId - Handler ID
   * @returns {Promise<HandlerType>}
   */
  const getHandlerType = async (taskId) => {
    try {
      const resp = await get(`/admin/scheduled/types/${taskId}`);

      if (!resp) {
        throw new Error("獲取handler型別詳情失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取handler型別詳情失敗");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 獲取handler型別詳情失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 立即執行定時任務
   * @param {string} taskId - 任務ID
   * @returns {Promise<Object>}
   */
  const runScheduledJobNow = async (taskId) => {
    try {
      const resp = await post(`/admin/scheduled/jobs/${taskId}/run`);

      if (!resp) {
        throw new Error("執行任務失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "執行任務失敗");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 執行任務失敗 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 獲取按小時統計的執行資料
   * @param {number} windowHours - 時間視窗（小時數，預設24）
   * @returns {Promise<{windowHours: number, buckets: Array}>}
   */
  const getHourlyAnalytics = async (windowHours = 24) => {
    try {
      const resp = await get('/admin/scheduled/analytics', { 
        params: { windowHours } 
      });
      
      if (!resp) {
        throw new Error('獲取統計資料失敗');
      }

      // 處理統一響應格式
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取統計資料失敗");
        }
        return resp.data || resp;
      }
      
      return resp;
    } catch (error) {
    log.error('[ScheduledJobService] 獲取按小時統計資料失敗:', error);
      throw error;
    }
  };

  /**
   * 獲取“平臺觸發器 tick”的狀態
   * - Cloudflare Workers：cron 來自實際觸發 scheduled() 的 controller.cron
   * - Docker/Node：cron 來自環境變數 SCHEDULED_TICK_CRON（預設每分鐘一次）
   *
   * @returns {Promise<{
   *   now: string,
   *   runtime: 'cloudflare' | 'docker',
   *   cron: { active: string|null, source: string, configured: string|null, lastSeen: string|null, cloudflareApi: string[]|null, cloudflareApiError: string|null },
   *   lastTick: { taskId: string, at: string|null, source: string|null, scheduledTimeMs: number|null },
   *   nextTick: { at: string|null, cronParseError: string|null },
   *   note?: string|null
   * }>}
   */
  const getSchedulerTicker = async () => {
    try {
      const resp = await get("/admin/scheduled/ticker");

      if (!resp) {
        throw new Error("獲取觸發器狀態失敗");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "獲取觸發器狀態失敗");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error("[ScheduledJobService] 獲取觸發器狀態失敗:", error);
      throw error;
    }
  };

  return {
    getScheduledJobs,
    getScheduledJob,
    createScheduledJob,
    updateScheduledJob,
    deleteScheduledJob,
    getScheduledJobRuns,
    getHourlyAnalytics,
    getSchedulerTicker,
    toggleScheduledJob,
    runScheduledJobNow,
    getHandlerTypes,
    getHandlerType,
  };
}
