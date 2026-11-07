/**
 * 檔案系統索引管理服務API
 * 提供索引狀態查詢、重建、增量應用、停止和清空等管理功能
 */

import { get, post } from "../client";

/******************************************************************************
 * 型別定義 (JSDoc)
 ******************************************************************************/

/**
 * @typedef {'not_ready' | 'indexing' | 'ready' | 'error'} IndexStatus
 * 索引狀態列舉
 */

/**
 * @typedef {'none' | 'wait' | 'rebuild' | 'apply-dirty'} RecommendedAction
 * 建議操作列舉
 */

/**
 * @typedef {'indexing' | 'index_not_ready' | 'dirty_too_large' | 'dirty_pending' | null} RecommendedReason
 * 建議原因列舉
 */

/**
 * @typedef {'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'} JobStatus
 * 任務狀態列舉
 */

/**
 * @typedef {Object} IndexStatusItem
 * @property {string} mountId - 掛載點ID
 * @property {string|null} name - 掛載點名稱
 * @property {string|null} mountPath - 掛載路徑
 * @property {string|null} storageType - 儲存型別
 * @property {IndexStatus} status - 索引狀態
 * @property {number|null} lastIndexedMs - 最後索引時間戳(ms)
 * @property {number|null} updatedAtMs - 更新時間戳(ms)
 * @property {string|null} lastError - 最後錯誤資訊
 * @property {number} dirtyCount - 待處理的dirty條目數
 * @property {RecommendedAction} recommendedAction - 建議操作
 * @property {RecommendedReason} recommendedReason - 建議原因
 */

/**
 * @typedef {Object} ApplyDirtyItemResult
 * @property {string} mountId - 掛載點ID
 * @property {string|null} [mountName] - 掛載點名稱
 * @property {string|null} [mountPath] - 掛載路徑
 * @property {string|null} [storageType] - 儲存型別
 * @property {'processing' | 'success' | 'failed' | 'skipped'} status - 處理狀態
 * @property {number} [processedDirtyCount] - 處理的髒記錄數
 * @property {number} [upsertedCount] - 更新條目數
 * @property {number} [deletedCount] - 刪除條目數
 * @property {number} [skippedCount] - 跳過條目數
 * @property {number} [failedCount] - 失敗條目數
 * @property {number} [durationMs] - 耗時(ms)
 * @property {string} [error] - 錯誤資訊
 */

/**
 * @typedef {Object} RebuildItemResult
 * @property {string} mountId - 掛載點ID
 * @property {string|null} [mountName] - 掛載點名稱
 * @property {string|null} [mountPath] - 掛載路徑
 * @property {string|null} [storageType] - 儲存型別
 * @property {'processing' | 'success' | 'failed' | 'skipped'} status - 處理狀態
 * @property {number} [scannedDirs] - 掃描的目錄數
 * @property {number} [discoveredCount] - 發現的檔案/目錄數
 * @property {number} [upsertedCount] - 寫入索引數
 * @property {number} [durationMs] - 耗時(ms)
 * @property {string} [error] - 錯誤資訊
 */

/**
 * @typedef {Object} TaskStats
 * @property {number} totalItems - 總專案數
 * @property {number} processedItems - 已處理專案數
 * @property {number} successCount - 成功數
 * @property {number} failedCount - 失敗數
 * @property {number} skippedCount - 跳過數
 * @property {Array<ApplyDirtyItemResult|RebuildItemResult|Object>} [itemResults] - 任務明細（不同任務型別欄位不同）
 * @property {string} [currentMountId] - 當前處理的掛載點ID
 * @property {number} [scannedDirs] - 已掃描目錄數
 * @property {number} [discoveredCount] - 已發現條目數（遍歷過程中累計）
 * @property {number} [pendingCount] - 當前批次待寫入條目數（僅用於進度觀感）
 * @property {number} [upsertedCount] - 已更新/插入條目數
 * @property {number} [truncatedMounts] - 已清空的掛載點數
 * @property {number} [mountsHint] - 掛載點提示數
 * @property {number} [lastBatch] - 最後批次大小
 * @property {number} [heartbeatAtMs] - 進度心跳時間戳（ms）
 * @property {number} [totalDirtyProcessed] - 增量索引總處理條數
 * @property {number} [totalUpserted] - 增量索引總更新條數
 * @property {number} [totalDeleted] - 增量索引總刪除條數
 */

/**
 * @typedef {Object} AllowedActions
 * @property {boolean} canView - 是否可檢視
 * @property {boolean} canCancel - 是否可取消
 * @property {boolean} canDelete - 是否可刪除
 * @property {boolean} canRetry - 是否可重試
 */

/**
 * @typedef {Object} JobDescriptor
 * @property {string} jobId - 作業ID
 * @property {string} taskType - 任務型別 ('fs_index_rebuild' | 'fs_index_apply_dirty')
 * @property {JobStatus} status - 任務狀態
 * @property {TaskStats} stats - 任務統計
 * @property {string} createdAt - 建立時間
 * @property {string} [startedAt] - 開始時間
 * @property {string} [finishedAt] - 完成時間
 * @property {string} [updatedAt] - 更新時間
 * @property {Object} [payload] - 任務載荷
 * @property {AllowedActions} [allowedActions] - 允許的操作
 */

/**
 * @typedef {Object} IndexStatusHints
 * @property {number} minQueryLength - 最小查詢長度
 * @property {number} dirtyRebuildThreshold - dirty重建閾值
 */

/**
 * @typedef {Object} IndexStatusResponse
 * @property {IndexStatusItem[]} items - 掛載點索引狀態列表
 * @property {JobDescriptor[]} runningJobs - 執行中的任務列表
 * @property {IndexStatusHints} hints - 提示資訊
 */

/**
 * @typedef {Object} RebuildOptions
 * @property {number} [batchSize] - 單次upsert批次大小，預設200
 * @property {number|null} [maxDepth] - 最大遍歷深度，null表示不限制
 * @property {number|null} [maxMountsPerRun] - 單次作業最多處理的掛載點數量
 * @property {boolean} [refresh] - 是否強制跳過快取，預設true
 */

/**
 * @typedef {Object} ApplyDirtyOptions
 * @property {number} [batchSize] - 單次拉取dirty條數，預設200
 * @property {number|null} [maxItems] - 單次作業最多處理的dirty條目數量
 * @property {boolean} [rebuildDirectorySubtree] - 目錄upsert是否遞迴重建子樹，預設true
 * @property {number|null} [maxDepth] - 目錄子樹重建的最大深度
 * @property {boolean} [refresh] - 是否強制跳過快取，預設true
 */

/******************************************************************************
 * API函式
 ******************************************************************************/

/**
 * 獲取所有掛載點的索引狀態
 * @returns {Promise<{success: boolean, data: IndexStatusResponse, message: string}>}
 */
export async function getIndexStatus() {
  return get("/admin/fs/index/status");
}

/**
 * 建立索引重建作業
 * @param {string[]} [mountIds] - 要重建的掛載點ID列表，不提供則重建所有
 * @param {RebuildOptions} [options] - 重建選項
 * @returns {Promise<{success: boolean, data: {jobId: string, taskType: string}, message: string}>}
 */
export async function rebuildIndex(mountIds, options = {}) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  if (Object.keys(options).length > 0) {
    payload.options = options;
  }

  return post("/admin/fs/index/rebuild", payload);
}

/**
 * 建立索引增量應用作業
 * @param {string[]} [mountIds] - 要處理的掛載點ID列表，不提供則處理所有
 * @param {ApplyDirtyOptions} [options] - 增量應用選項
 * @returns {Promise<{success: boolean, data: {jobId: string, taskType: string}, message: string}>}
 */
export async function applyDirty(mountIds, options = {}) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  if (Object.keys(options).length > 0) {
    payload.options = options;
  }

  return post("/admin/fs/index/apply-dirty", payload);
}

/**
 * 停止索引作業
 * @param {string} jobId - 要停止的作業ID
 * @returns {Promise<{success: boolean, data: {jobId: string, mountIds: string[]}, message: string}>}
 */
export async function stopIndexJob(jobId) {
  return post("/admin/fs/index/stop", { jobId });
}

/**
 * 清空索引資料
 * @param {string[]} [mountIds] - 要清空的掛載點ID列表，不提供則清空所有
 * @returns {Promise<{success: boolean, data: {scope: 'all' | 'mount', mountIds?: string[]}, message: string}>}
 */
export async function clearIndex(mountIds) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  return post("/admin/fs/index/clear", payload);
}

/******************************************************************************
 * 輔助函式
 ******************************************************************************/

/**
 * 獲取索引狀態的顯示文字
 * @param {IndexStatus} status - 索引狀態
 * @returns {string} 狀態顯示文字鍵名（用於i18n）
 */
export function getStatusTextKey(status) {
  const statusMap = {
    not_ready: "admin.fsIndex.status.notReady",
    indexing: "admin.fsIndex.status.indexing",
    ready: "admin.fsIndex.status.ready",
    error: "admin.fsIndex.status.error",
  };
  return statusMap[status] || "admin.fsIndex.status.unknown";
}

/**
 * 獲取索引狀態的樣式類
 * @param {IndexStatus} status - 索引狀態
 * @returns {string} Tailwind CSS類名
 */
export function getStatusBadgeClass(status) {
  const classMap = {
    ready: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
    indexing: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
    not_ready: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  };
  return classMap[status] || "bg-gray-100 text-gray-800 dark:bg-gray-900/50 dark:text-gray-200";
}

/**
 * 計算任務進度百分比
 * @param {TaskStats} stats - 任務統計
 * @returns {number} 進度百分比 (0-100)
 */
export function calculateJobProgress(stats) {
  if (!stats || stats.totalItems === 0) return 0;
  return Math.round((stats.processedItems / stats.totalItems) * 100);
}

/**
 * 格式化時間戳為本地時間字串
 * @param {number|string|null} timestamp - 時間戳(ms)或ISO字串
 * @returns {string} 格式化的時間字串
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return "-";

  const date = typeof timestamp === "number"
    ? new Date(timestamp)
    : new Date(timestamp);

  if (isNaN(date.getTime())) return "-";

  return date.toLocaleString();
}
