/**
 * TelegramOperations
 *
 *
 * 1) 工具函式（無副作用）：路徑/字串/JSON
 * 2) 併發閥門：避免併發失控導致 429
 * 3) Bot API 呼叫：統一“限併發 + 預設只在 429 重試”
 * 4) 索引層 CRUD：rename/copy/delete 只動 vfs_nodes
 *
 */

import { ApiStatus } from "../../../constants/index.js";
import { DriverError, ValidationError } from "../../../http/errors.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";

// =========================
// 1) 工具函式
// =========================

export function normalizeApiBaseUrl(url) {
  const raw = String(url || "").trim();
  const fallback = "https://api.telegram.org";
  if (!raw) return fallback;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function toPosixPath(p) {
  if (p == null) return "/";
  let s = String(p).replace(/\\\\/g, "/");
  s = s.replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

export function stripTrailingSlash(p) {
  const s = String(p || "");
  if (s === "/") return "/";
  return s.replace(/\/+$/, "");
}

export function splitDirAndName(posixPath) {
  const p = stripTrailingSlash(toPosixPath(posixPath));
  if (p === "/") return { dirPath: "/", name: "" };
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return { dirPath: "/", name: p.slice(1) };
  const dir = p.slice(0, idx) || "/";
  const name = p.slice(idx + 1);
  return { dirPath: dir || "/", name };
}

/**
 * 解析 Telegram 上傳的目錄與（可選）檔名：
 * - 當 target 是“目錄路徑”（以 / 結尾）時，dirPath 應為該目錄本身（而不是父目錄）
 * - 當 target 是“檔案路徑”時，按常規 splitDirAndName 解析
 *
 * 說明：前端流式/表單上傳會把目錄放在 path 裡，檔名透過 header/meta 單獨傳遞。
 * 如果後端把目錄路徑當成檔案路徑來 split，會導致寫索引時把檔案掛到根目錄。
 */
export function resolveUploadDirAndName(targetPath, { isDirectoryTarget = false } = {}) {
  const normalized = toPosixPath(targetPath);
  const treatAsDir = isDirectoryTarget === true || normalized.endsWith("/");
  if (treatAsDir) {
    const dir = stripTrailingSlash(normalized);
    return { dirPath: dir || "/", name: "" };
  }
  return splitDirAndName(normalized);
}

export function safeJsonParse(text) {
  if (!text) return null;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

export function normalizePartList(manifest) {
  const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];
  return parts
    .map((p) => ({
      partNo: Number(p?.partNo ?? p?.part_no ?? p?.part),
      size: Number(p?.size),
      fileId: p?.file_id ?? p?.fileId ?? null,
      messageId: p?.message_id ?? p?.messageId ?? null,
      chatId: p?.chat_id ?? p?.chatId ?? null,
    }))
    .filter((p) => Number.isFinite(p.partNo) && p.partNo > 0 && p.fileId);
}

// =========================
// 2) 併發閥門（Semaphore）
// =========================

class AsyncSemaphore {
  constructor(max) {
    this.max = Math.max(1, Number(max) || 1);
    this.current = 0;
    this.queue = [];
  }

  setMax(max) {
    const next = Math.max(1, Number(max) || 1);
    this.max = next;
    this._drain();
  }

  _drain() {
    while (this.current < this.max && this.queue.length) {
      this.current += 1;
      const resolve = this.queue.shift();
      resolve(this._release.bind(this));
    }
  }

  _release() {
    this.current = Math.max(0, this.current - 1);
    this._drain();
  }

  async acquire() {
    if (this.current < this.max) {
      this.current += 1;
      return this._release.bind(this);
    }
    return await new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
}

// 同一個 Worker 程序內所有 TelegramStorageDriver 例項共享併發預算
const uploadSemaphores = new Map();

export function getUploadSemaphore(key, max) {
  const k = String(key || "telegram-default");
  let sem = uploadSemaphores.get(k);
  if (!sem) {
    sem = new AsyncSemaphore(max);
    uploadSemaphores.set(k, sem);
    return sem;
  }
  sem.setMax(max);
  return sem;
}

// =========================
// 3) Bot API 呼叫（限併發 + 重試策略）
// =========================

function getTelegramSemaphoreKey(driver) {
  // 用 storage_config_id 優先：同一個配置（同一個 bot/chat）共享併發預算
  // 兜底用 chatId：避免沒有 config.id 時併發失控
  return driver?.config?.id || `${driver?.targetChatId || "unknown-chat"}`;
}

async function withTelegramConcurrency(driver, fn) {
  const sem = getUploadSemaphore(getTelegramSemaphoreKey(driver), driver?.uploadConcurrency);
  const release = await sem.acquire();
  try {
    return await fn();
  } finally {
    try {
      release?.();
    } catch {}
  }
}

function calcTelegramRetryWaitMs({ attempt, retryAfterSec, baseDelayMs }) {
  const retryAfter = Number(retryAfterSec);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    // Telegram 給的 retry_after（秒）是最權威的
    return Math.max(1000, Math.floor(retryAfter * 1000) + 200);
  }
  // 兜底：指數退避（但上限別太大，避免卡住體驗）
  return Math.min(10_000, (Number(baseDelayMs) || 900) * Math.pow(2, (Number(attempt) || 1) - 1));
}

export function buildBotApiUrl(driver, method) {
  const base = driver?.apiBaseUrl || "https://api.telegram.org";
  const m = String(method || "").replace(/^\/+/, "");
  return `${base}/bot${driver?.botToken}/${m}`;
}

export function buildBotFileUrl(driver, filePath) {
  const base = driver?.apiBaseUrl || "https://api.telegram.org";
  const fp = String(filePath || "").replace(/^\/+/, "");
  return `${base}/file/bot${driver?.botToken}/${fp}`;
}

/**
 * 統一的 Bot API JSON 請求封裝
 *
 * 預設只對 429 重試
 * 可選對 5xx/異常做退避重試
 *
 * 這裡會呼叫 driver._sleep()，driver 有統一的“可取消 sleep”。
 */
export async function callTelegramBotApiJson(driver, url, makeInit, options = {}) {
  const operation = options?.operation || "telegram-bot-api";
  const signal = options?.signal;
  const maxAttempts = Number(options?.maxAttempts) || 1;
  const baseDelayMs = Number(options?.baseDelayMs) || 900;
  const retryOn429 = options?.retryOn429 !== false;
  const retryOn5xx = options?.retryOn5xx === true;
  const retryOnException = options?.retryOnException === true;
  const errorFactory =
    typeof options?.errorFactory === "function"
      ? options.errorFactory
      : (resp, data) =>
          new DriverError(`TELEGRAM 請求失敗（${operation}）`, {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_API_FAILED",
            expose: false,
            details: { status: resp?.status ?? null, response: data ?? null },
          });

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { resp, data } = await withTelegramConcurrency(driver, async () => {
        const init = (typeof makeInit === "function" ? makeInit(attempt) : makeInit) || {};
        const r = await fetch(url, { ...init, signal });
        const d = await r.json().catch(() => null);
        return { resp: r, data: d };
      });

      if (resp.ok && data?.ok) {
        return { resp, data };
      }

      const errorCode = data?.error_code ?? resp.status ?? 0;
      const retryAfterSec = data?.parameters?.retry_after ?? null;

      if (retryOn429 && (resp.status === 429 || errorCode === 429) && attempt < maxAttempts) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }

      if (retryOn5xx && resp.status >= 500 && attempt < maxAttempts) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec: null, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }

      const err = errorFactory(resp, data);
      if (err && typeof err === "object" && typeof err.retryable !== "boolean") {
        err.retryable = false;
      }
      throw err;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && retryOnException) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec: null, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }
      break;
    }
  }

  if (lastError) throw lastError;
  throw new DriverError(`TELEGRAM 請求失敗（${operation}）`, {
    status: ApiStatus.BAD_GATEWAY,
    code: "DRIVER_ERROR.TELEGRAM_API_FAILED",
    expose: false,
  });
}

export async function getFileInfo(driver, fileId, options = {}) {
  const url = buildBotApiUrl(driver, "getFile");
  const qs = new URLSearchParams();
  qs.set("file_id", String(fileId));
  const full = `${url}?${qs.toString()}`;

  const maxAttempts = 5;
  const baseDelayMs = 900;

  const { data } = await callTelegramBotApiJson(driver, full, () => ({ method: "GET" }), {
    operation: "getFile",
    signal: options?.signal,
    maxAttempts,
    baseDelayMs,
    retryOn429: true,
    retryOn5xx: true,
    retryOnException: true,
    errorFactory: (resp, responseData) =>
      new DriverError("TELEGRAM 獲取檔案資訊失敗（getFile）", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_GET_FILE_FAILED",
        expose: false,
        details: { status: resp?.status ?? null, response: responseData ?? null },
      }),
  });

  const filePath = data?.result?.file_path || null;
  const fileSize = data?.result?.file_size ?? null;
  if (!filePath) {
    throw new DriverError("TELEGRAM getFile 回執缺少 file_path", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
      expose: false,
      details: { response: data },
    });
  }
  return { filePath, fileSize };
}

export async function getFileDownloadUrl(driver, fileId, options = {}) {
  const info = await getFileInfo(driver, fileId, options);
  return buildBotFileUrl(driver, info.filePath);
}

/**
 * sendDocument（上傳一個檔案）
 *
 * - 成功一次就會在頻道里產生一條訊息
 * - Bot API 沒有官方冪等機制
 *
 * 只在 429 時重試，其它失敗不自動重試。
 */
export async function sendDocument(driver, blob, { filename, contentType } = {}) {
  const url = buildBotApiUrl(driver, "sendDocument");

  const maxAttempts = 4; // 僅用於 429 重試
  const baseDelayMs = 900;
  const safeFilename = filename && String(filename).trim() ? String(filename).trim() : "file.bin";

  try {
    const { data } = await callTelegramBotApiJson(
      driver,
      url,
      () => {
        const form = new FormData();
        form.append("chat_id", driver.targetChatId);
        form.append("document", blob, safeFilename);
        form.append("disable_content_type_detection", "true");
        return { method: "POST", body: form };
      },
      {
        operation: "sendDocument",
        maxAttempts,
        baseDelayMs,
        retryOn429: true,
        retryOn5xx: false,
        retryOnException: false,
        errorFactory: (resp, data0) => {
          const err = new DriverError("TELEGRAM 上傳失敗（sendDocument）", {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_SEND_DOCUMENT_FAILED",
            expose: false,
            details: { status: resp?.status ?? null, response: data0 ?? null },
          });
          err.retryable = false;
          return err;
        },
      }
    );

    const result = data.result || null;
    const messageId = result?.message_id ?? null;

    // 回執裡“檔案欄位”可能在不同位置，做兜底提取
    const photo = Array.isArray(result?.photo) && result.photo.length ? result.photo[result.photo.length - 1] : null;
    const newChatPhoto = Array.isArray(result?.new_chat_photo) && result.new_chat_photo.length ? result.new_chat_photo[result.new_chat_photo.length - 1] : null;
    const gamePhoto = Array.isArray(result?.game?.photo) && result.game.photo.length ? result.game.photo[result.game.photo.length - 1] : null;
    const gameAnimation = result?.game?.animation || null;
    const fileLike =
      result?.document ||
      result?.audio ||
      result?.voice ||
      result?.video ||
      result?.video_note ||
      result?.animation ||
      result?.sticker ||
      photo ||
      newChatPhoto ||
      gameAnimation ||
      gamePhoto ||
      null;

    const fileId = fileLike?.file_id ?? null;
    const fileUniqueId = fileLike?.file_unique_id ?? null;

    if (!messageId || !fileId) {
      const err = new DriverError("TELEGRAM 上傳回執缺少 message_id/file_id", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
        expose: false,
        details: {
          response: data,
          resultKeys: result && typeof result === "object" ? Object.keys(result) : null,
        },
      });
      err.retryable = false;
      throw err;
    }

    // 上傳後校驗：開啟後會再呼叫 getFile 校驗大小（更慢但更穩）
    if (driver.verifyAfterUpload) {
      try {
        const info = await getFileInfo(driver, fileId, {});
        const actualSize = Number(info?.fileSize);
        if (Number.isFinite(actualSize) && actualSize >= 0 && actualSize !== blob.size) {
          const err = new DriverError("TELEGRAM 上傳後校驗失敗：檔案大小不一致", {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_UPLOAD_VERIFY_FAILED",
            expose: false,
            details: { expected: blob.size, actual: actualSize },
          });
          err.retryable = false;
          throw err;
        }
      } catch (verifyError) {
        if (verifyError && verifyError.retryable === false) {
          throw verifyError;
        }
        console.warn("[TELEGRAM] 上傳後校驗失敗（已忽略，不影響本次上傳結果）：", verifyError?.message || verifyError);
      }
    }

    void contentType;
    return { messageId, fileId, fileUniqueId };
  } catch (err) {
    // 兜底：sendDocument 任何失敗都不要讓上層自動重試
    if (err && typeof err === "object" && typeof err.retryable !== "boolean") {
      err.retryable = false;
    }
    throw err;
  }
}

// =========================
// 4) 索引層 CRUD（只動 vfs_nodes）
// =========================

export async function renameItem(driver, oldSubPath, newSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.renameItem: 缺少 db");

  const oldPath = ctx?.oldPath;
  const newPath = ctx?.newPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const oldSub = toPosixPath(oldSubPath || "/");
  const newSub = toPosixPath(newSubPath || "/");

  const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: oldSub });
  if (!node) {
    return { success: false, source: oldPath, target: newPath, message: "源路徑不存在" };
  }

  const { dirPath: newDirPath, name: newName } = splitDirAndName(newSub);
  if (!newName) {
    return { success: false, source: oldPath, target: newPath, message: "目標名稱為空" };
  }

  // 確保目標父目錄存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: newDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // 先改名，再移動
  let current = node;
  if (String(current.name) !== String(newName)) {
    current = await repo.renameNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(current.id), newName });
  }

  if (String(current.parent_id) !== String(targetParentId)) {
    current = await repo.moveNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      nodeId: String(current.id),
      newParentId: targetParentId,
    });
  }

  return { success: true, source: oldPath, target: newPath, message: undefined };
}

export async function batchRemoveItems(driver, subPaths, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.batchRemoveItems: 缺少 db");

  if (!Array.isArray(subPaths) || subPaths.length === 0) {
    return { success: 0, failed: [] };
  }

  if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
    throw new ValidationError("TELEGRAM.batchRemoveItems 需要 ctx.paths 與 subPaths 一一對應（不做相容）");
  }

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const fsPaths = ctx.paths;
  const failed = [];
  let success = 0;

  for (let i = 0; i < subPaths.length; i += 1) {
    const fsPath = fsPaths[i];
    const sub = toPosixPath(subPaths[i] || "/");

    try {
      const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: sub });
      if (!node) {
        success += 1;
        continue;
      }

      // Telegram：只刪索引，不刪 Telegram 內容
      await repo.deleteNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(node.id), mode: "hard" });
      success += 1;
    } catch (e) {
      failed.push({ path: fsPath, error: e?.message || String(e) });
    }
  }

  return { success, failed };
}

async function copyDirectoryTree(driver, repo, { ownerType, ownerId, scopeType, scopeId, sourceDirId, targetDirId }) {
  const children = await repo.listChildrenByParentId({ ownerType, ownerId, scopeType, scopeId, parentId: sourceDirId });
  for (const row of children) {
    if (row.node_type === "dir") {
      const newDir = await repo
        .createDirectory({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: targetDirId,
          name: row.name,
        })
        .catch(async () => {
          const existsDir = await repo.getChildByName({
            ownerType,
            ownerId,
            scopeType,
            scopeId,
            parentId: targetDirId,
            name: row.name,
          });
          if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目錄複製衝突：目標同名不是目錄");
          return existsDir;
        });

      await copyDirectoryTree(driver, repo, {
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        sourceDirId: String(row.id),
        targetDirId: String(newDir.id),
      });
      continue;
    }

    await repo.createOrUpdateFileNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: targetDirId,
      name: row.name,
      mimeType: row.mime_type || null,
      size: row.size || null,
      storageType: row.storage_type || driver.type,
      contentRef: safeJsonParse(row.content_ref) || row.content_ref,
    });
  }
}

export async function copyItem(driver, sourceSubPath, targetSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.copyItem: 缺少 db");

  const sourcePath = ctx?.sourcePath;
  const targetPath = ctx?.targetPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const skipExisting = !!ctx?.skipExisting;

  const sourceSub = toPosixPath(sourceSubPath || "/");
  const targetSub = toPosixPath(targetSubPath || "/");

  const src = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: sourceSub });
  if (!src) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "源路徑不存在" };
  }

  const { dirPath: targetDirPath, name: targetName } = splitDirAndName(targetSub);
  if (!targetName) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "目標名稱為空" };
  }

  // 確保目標父目錄存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: targetDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // skipExisting：如果目標已存在，直接跳過
  if (skipExisting) {
    const exists = await repo.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName });
    if (exists) {
      return { status: "skipped", source: sourcePath, target: targetPath, skipped: true, reason: "target_exists" };
    }
  }

  if (src.node_type === "dir") {
    const targetDirNode = await repo.createDirectory({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName }).catch(async () => {
      const existsDir = await repo.getChildByName({
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        parentId: targetParentId,
        name: targetName,
      });
      if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目標已存在但不是目錄");
      return existsDir;
    });

    await copyDirectoryTree(driver, repo, {
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      sourceDirId: String(src.id),
      targetDirId: String(targetDirNode.id),
    });
    return { status: "success", source: sourcePath, target: targetPath, skipped: false };
  }

  // 檔案複製：複用 content_ref（manifest）
  await repo.createOrUpdateFileNode({
    ownerType,
    ownerId,
    scopeType,
    scopeId,
    parentId: targetParentId,
    name: targetName,
    mimeType: src.mime_type || null,
    size: src.size || null,
    storageType: src.storage_type || driver.type,
    contentRef: safeJsonParse(src.content_ref) || src.content_ref,
  });

  return { status: "success", source: sourcePath, target: targetPath, skipped: false };
}

export async function deleteObjectByStoragePath(driver, storagePath, options = {}) {
  driver._ensureInitialized();
  const db = options?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.deleteObjectByStoragePath: 缺少 db");

  const nodeId = driver._parseVfsStoragePath(storagePath);
  if (!nodeId) {
    throw new ValidationError("TELEGRAM.deleteObjectByStoragePath: 僅支援 vfs:<id> 形式的 storagePath");
  }

  const repo = new VfsNodesRepository(db, null);
  const node = await repo.getNodeByIdUnsafe(nodeId);
  if (!node) return { success: true };

  await repo.deleteNode({
    ownerType: node.owner_type,
    ownerId: node.owner_id,
    scopeType: node.scope_type,
    scopeId: node.scope_id,
    nodeId: String(node.id),
    mode: "hard",
  });

  return { success: true };
}
