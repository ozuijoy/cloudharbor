/**
 * Telegram 檔案資訊快取（記憶體）
 *
 * 減少 Telegram Bot API 的 getFile 呼叫次數。
 * 快取：file_id -> { filePath, fileSize }
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10分鐘
const CACHE_MAX_ITEMS = 500;

/** @type {Map<string, { filePath: string, fileSize: number|null, cachedAtMs: number }>} */
const fileInfoCache = new Map();

const shouldLog = () => {
  // 只做除錯日誌：預設關閉
  try {
    if (typeof process !== "undefined" && process?.env?.DEBUG_TG_FILEINFO_CACHE === "1") return true;
  } catch {}
  try {
    if (typeof globalThis !== "undefined" && globalThis?.DEBUG_TG_FILEINFO_CACHE === true) return true;
  } catch {}
  return false;
};

export function clearTelegramFileInfoCache() {
  fileInfoCache.clear();
  if (shouldLog()) {
    console.log("[TG fileInfoCache] cleared");
  }
}

export function getCachedTelegramFileInfo(fileId) {
  const key = fileId ? String(fileId) : "";
  if (!key) return null;

  const cached = fileInfoCache.get(key) || null;
  if (!cached) return null;

  const cachedAtMs = Number(cached.cachedAtMs) || 0;
  if (cachedAtMs <= 0 || Date.now() - cachedAtMs > CACHE_TTL_MS) {
    fileInfoCache.delete(key);
    return null;
  }

  // LRU：重新整理順序（Map 的插入順序）
  fileInfoCache.delete(key);
  fileInfoCache.set(key, cached);

  if (shouldLog()) {
    console.log(`[TG fileInfoCache] hit fileId=${key}`);
  }
  return { filePath: cached.filePath, fileSize: cached.fileSize ?? null };
}

export function setCachedTelegramFileInfo(fileId, info) {
  const key = fileId ? String(fileId) : "";
  if (!key) return;

  const filePath = info?.filePath || null;
  if (!filePath) return;

  fileInfoCache.set(key, {
    filePath: String(filePath),
    fileSize: info?.fileSize ?? null,
    cachedAtMs: Date.now(),
  });

  // 超限時淘汰最舊
  while (fileInfoCache.size > CACHE_MAX_ITEMS) {
    const oldestKey = fileInfoCache.keys().next().value;
    if (!oldestKey) break;
    fileInfoCache.delete(oldestKey);
  }
}
