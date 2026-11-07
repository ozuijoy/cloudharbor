/**
 * 上傳進度跟蹤工具（後端通用）
 * 目前僅用於內部記錄和日誌，後續可擴充套件為對外查詢介面
 */

/** @type {Map<string, { id: string; loaded: number; total: number|null; path?: string|null; storageType?: string|null; updatedAt: number; completed: boolean }>} */
const progressStore = new Map();

/**
 * 更新上傳進度
 * @param {string} id - 進度ID（可使用 uploadId 或儲存路徑）
 * @param {{ loaded: number; total?: number|null; path?: string|null; storageType?: string|null; completed?: boolean }} payload
 */
export function updateUploadProgress(id, payload) {
  if (!id) return;
  const prev = progressStore.get(id);
  const loaded = typeof payload.loaded === "number" ? payload.loaded : prev?.loaded ?? 0;
  const total =
    typeof payload.total === "number"
      ? payload.total
      : payload.total === null
      ? null
      : prev?.total ?? null;

  progressStore.set(id, {
    id,
    loaded,
    total,
    path: payload.path ?? prev?.path ?? null,
    storageType: payload.storageType ?? prev?.storageType ?? null,
    updatedAt: Date.now(),
    completed: payload.completed ?? prev?.completed ?? false,
  });
}

/**
 * 標記上傳完成
 * @param {string} id
 */
export function completeUploadProgress(id) {
  if (!id || !progressStore.has(id)) return;
  const prev = progressStore.get(id);
  if (!prev) return;
  progressStore.set(id, {
    ...prev,
    completed: true,
    updatedAt: Date.now(),
  });
}

/**
 * 獲取上傳進度
 * @param {string} id
 * @returns {{ id: string; loaded: number; total: number|null; path?: string|null; storageType?: string|null; updatedAt: number; completed: boolean }|null}
 */
export function getUploadProgress(id) {
  return id ? progressStore.get(id) ?? null : null;
}

/**
 * 刪除上傳進度（可用於清理完成或過期記錄）
 * @param {string} id
 */
export function removeUploadProgress(id) {
  if (!id) return;
  progressStore.delete(id);
}

