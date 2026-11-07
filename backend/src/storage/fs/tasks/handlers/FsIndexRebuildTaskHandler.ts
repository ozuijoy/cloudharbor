// cSpell:words upserted

import type { TaskHandler, InternalJob, ExecutionContext } from "../TaskHandler.js";
import { ValidationError } from "../../../../http/errors.js";
import { ensureRepositoryFactory } from "../../../../utils/repositories.js";
import { FsSearchIndexStore } from "../../search/FsSearchIndexStore.js";
import { iterateListDirectoryItems } from "../../utils/listDirectoryPaging.js";

type FsIndexRebuildPayload = {
  mountIds?: string[];
  options?: {
    /**
     * 單次 upsert 的批次大小（越大寫入越少，但單批更重）
     */
    batchSize?: number;
    /**
     * 最大遍歷深度（從掛載根目錄算起，0 表示只掃根目錄本層）
     * - 不提供：不限深度
     */
    maxDepth?: number | null;
    /**
     * 單次作業最多處理的掛載點數量（可選）
     * - 不提供：不限制
     */
    maxMountsPerRun?: number | null;
    /**
     * 是否強制跳過目錄快取（預設 true，確保重建儘可能反映最新）
     */
    refresh?: boolean;
  };
};

function normalizeMountRootPath(mountPath: string): string {
  const raw = String(mountPath || "").trim();
  const collapsed = raw.replace(/\/{2,}/g, "/");
  const withoutTrailing = collapsed.replace(/\/+$/g, "") || "/";
  return withoutTrailing === "/" ? "/" : `${withoutTrailing}/`;
}

function parseModifiedMs(modified: any): number {
  const ms = Date.parse(String(modified || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function coercePositiveInt(value: any, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function tryRandomUuid(): string {
  try {
    // Workers / Node 18+ 通常支援全域性 crypto.randomUUID()
    // eslint-disable-next-line no-undef
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      // eslint-disable-next-line no-undef
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  // 退化：時間戳 + 隨機數（僅用於 runId，不作為安全用途）
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * FS 索引重建任務（Index-first 的寫入側）
 * - 全量遍歷（BFS）每個掛載點，批次 upsert 到 fs_search_index_entries（FTS5 由觸發器同步）
 * - 無停機：使用 index_run_id 標記本輪寫入，最後清理舊 runId 的條目
 * - 可取消：迴圈內協作式檢查 cancel
 */
export class FsIndexRebuildTaskHandler implements TaskHandler {
  readonly taskType = "fs_index_rebuild";

  async validate(payload: any): Promise<void> {
    if (payload === null || typeof payload !== "object") {
      throw new ValidationError("payload 必須是物件");
    }

    const mountIds = payload.mountIds;
    if (mountIds !== undefined && mountIds !== null) {
      if (!Array.isArray(mountIds)) {
        throw new ValidationError("mountIds 必須是字串陣列");
      }
      for (let i = 0; i < mountIds.length; i++) {
        const id = mountIds[i];
        if (typeof id !== "string" || !id.trim()) {
          throw new ValidationError(`mountIds[${i}] 必須是非空字串`);
        }
      }
    }

    const options = payload.options ?? {};
    if (options && typeof options !== "object") {
      throw new ValidationError("options 必須是物件");
    }

    if (options.batchSize !== undefined) {
      const n = Number(options.batchSize);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("options.batchSize 必須是正整數");
      }
    }

    if (options.maxDepth !== undefined && options.maxDepth !== null) {
      const n = Number(options.maxDepth);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError("options.maxDepth 必須是 >= 0 的整數或 null");
      }
    }

    if (options.maxMountsPerRun !== undefined && options.maxMountsPerRun !== null) {
      const n = Number(options.maxMountsPerRun);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("options.maxMountsPerRun 必須是正整數或 null");
      }
    }
  }

  createStatsTemplate(payload: any) {
    const mountIds = Array.isArray(payload?.mountIds) ? payload.mountIds : [];
    const total = mountIds.length > 0 ? mountIds.length : 0;
    return {
      totalItems: total,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      // 複用 itemResults 以便前端任務列表可展示“每個掛載點”的結果
      itemResults: [],
    } as any;
  }

  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = (job.payload || {}) as FsIndexRebuildPayload;
    const fileSystem = context.getFileSystem();
    const env = typeof context.getEnv === "function" ? context.getEnv() : null;
    const db = env?.DB ?? fileSystem?.mountManager?.db;
    if (!db) {
      throw new ValidationError("fs_index_rebuild: 缺少 DB 繫結");
    }

    const factory = ensureRepositoryFactory(db, fileSystem?.repositoryFactory);
    const mountRepository = factory.getMountRepository();

    const allActiveMounts = await mountRepository.findAll(false);
    const requestedMountIds = Array.isArray(payload.mountIds)
      ? payload.mountIds.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const mounts =
      requestedMountIds.length > 0
        ? allActiveMounts.filter((m: any) => requestedMountIds.includes(String(m?.id)))
        : allActiveMounts;

    if (!mounts || mounts.length === 0) {
      // 沒有可重建的掛載點：直接結束（視作成功）
      await context.updateProgress(job.jobId, {
        totalItems: 0,
        processedItems: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        itemResults: [],
      } as any);
      return;
    }

    const options = payload.options || {};
    const batchSize = coercePositiveInt(options.batchSize, 200, 20, 1000);
    const maxDepth =
      options.maxDepth === null || options.maxDepth === undefined
        ? null
        : coercePositiveInt(options.maxDepth, 0, 0, 1000);
    const maxMountsPerRun =
      options.maxMountsPerRun === null || options.maxMountsPerRun === undefined
        ? null
        : coercePositiveInt(options.maxMountsPerRun, 1, 1, 10000);
    const refresh = options.refresh !== false;

    const store = new FsSearchIndexStore(db);

    let processedMounts = 0;
    let successMounts = 0;
    let failedMounts = 0;
    let skippedMounts = 0;
    const itemResults: any[] = [];

    // 預算保護：可選限制單次作業處理的掛載點數量（不提供則不限制）
    const effectiveMounts = maxMountsPerRun ? mounts.slice(0, maxMountsPerRun) : mounts;
    const truncatedMounts = mounts.length - effectiveMounts.length;

    // totalItems：按 mount 計數（而不是檔案數量），便於 UI 展示進度條
    const totalItems = effectiveMounts.length;

    console.log(
      `[FsIndexRebuildTaskHandler] 開始執行作業 ${job.jobId}, mounts=${effectiveMounts.length}/${mounts.length}, batchSize=${batchSize}, maxDepth=${maxDepth ?? "∞"}`,
    );

    for (const mount of effectiveMounts) {
      const mountId = String(mount?.id || "");
      const mountPath = normalizeMountRootPath(String(mount?.mount_path || "/"));
      const mountSummary = {
        kind: "mount",
        mountId,
        mountName: mount?.name ?? null,
        mountPath,
        storageType: mount?.storage_type ?? null,
        status: "processing",
        scannedDirs: 0,
        discoveredCount: 0,
        upsertedCount: 0,
      } as any;
      itemResults.push(mountSummary);

      // 取消檢查（mount 維度）
      if (await context.isCancelled(job.jobId)) {
        console.warn(`[FsIndexRebuildTaskHandler] 作業已取消: ${job.jobId}`);
        // 對未處理的掛載點保持 not_ready（或維持原狀態）；對當前 mount 標記 error，避免一直 indexing
        if (mountId) {
          await store.markError(mountId, "索引重建已取消");
          mountSummary.status = "skipped";
          mountSummary.error = "cancelled";
          skippedMounts++;
          await context.updateProgress(job.jobId, {
            totalItems,
            processedItems: processedMounts,
            successCount: successMounts,
            failedCount: failedMounts,
            skippedCount: skippedMounts,
            itemResults,
            currentMountId: mountId,
          } as any);
        }
        break;
      }

      const runId = tryRandomUuid();
      const startedAt = Date.now();
      let upsertedCount = 0;
      let discoveredCount = 0;
      let scannedDirs = 0;
      let lastProgressReportAtMs = 0;

      try {
        if (!mountId) {
          throw new ValidationError("mount.id 缺失");
        }

        await store.markIndexing(mountId, { jobId: job.jobId });

        const queue: Array<{ path: string; depth: number }> = [{ path: mountPath, depth: 0 }];
        const pending: any[] = [];
        const seenDirs = new Set<string>();

        await context.updateProgress(job.jobId, {
          totalItems,
          processedItems: processedMounts,
          successCount: successMounts,
          failedCount: failedMounts,
          skippedCount: skippedMounts,
          itemResults,
          currentMountId: mountId,
          scannedDirs,
          upsertedCount,
          discoveredCount,
          pendingCount: pending.length,
        } as any);

        while (queue.length > 0) {
          if (await context.isCancelled(job.jobId)) {
            throw new Error("cancelled");
          }

          const current = queue.shift()!;
          const dirPath = current.path;
          const depth = current.depth;

          if (seenDirs.has(dirPath)) {
            continue;
          }
          seenDirs.add(dirPath);
          scannedDirs = seenDirs.size;

          for await (const item of iterateListDirectoryItems(
            fileSystem,
            dirPath,
            job.userId,
            job.userType,
            { refresh },
          )) {
            const fsPath = String(item?.path || "");
            if (!fsPath) continue;

            const isDir = Boolean(item?.isDirectory);
            discoveredCount++;

            pending.push({
              mountId,
              fsPath,
              name: String(item?.name || ""),
              isDir,
              size: Number(item?.size) || 0,
              modifiedMs: parseModifiedMs(item?.modified),
              mimetype: item?.mimetype ?? null,
            });

            if (pending.length >= batchSize) {
              if (await context.isCancelled(job.jobId)) {
                throw new Error("cancelled");
              }
              await store.upsertEntries(pending, { indexRunId: runId });
              upsertedCount += pending.length;
              pending.length = 0;
            }

            if (isDir) {
              if (maxDepth !== null && depth >= maxDepth) {
                continue;
              }
              // 目錄列表契約：目錄路徑應以 / 結尾。這裡做一次規範化兜底。
              const childDir = fsPath.endsWith("/") ? fsPath : `${fsPath}/`;
              queue.push({ path: childDir, depth: depth + 1 });
            }
          }

          // 目錄級進度上報（低頻、可觀察）
          // - seenDirs.size === 1：快速給 UI 一個“正在掃描”的訊號，避免長時間 0（尤其是小掛載點/小目錄樹）
          // - 之後每 25 個目錄彙報一次，避免 D1/SQLite 寫放大
          const nowMs = Date.now();
          const timeDue = nowMs - lastProgressReportAtMs >= 1500;
          if (seenDirs.size === 1 || seenDirs.size % 25 === 0 || timeDue) {
            lastProgressReportAtMs = nowMs;
            mountSummary.scannedDirs = scannedDirs;
            mountSummary.discoveredCount = discoveredCount;
            mountSummary.upsertedCount = upsertedCount;
            await context.updateProgress(job.jobId, {
              totalItems,
              processedItems: processedMounts,
              successCount: successMounts,
              failedCount: failedMounts,
              skippedCount: skippedMounts,
              itemResults,
              currentMountId: mountId,
              scannedDirs,
              upsertedCount,
              discoveredCount,
              pendingCount: pending.length,
            } as any);
          }
        }

        if (pending.length > 0) {
          if (await context.isCancelled(job.jobId)) {
            throw new Error("cancelled");
          }
          await store.upsertEntries(pending, { indexRunId: runId });
          upsertedCount += pending.length;
          pending.length = 0;
        }

        // 無停機重建：清理舊 runId
        await store.cleanupMountByRunId(mountId, runId);
        await store.clearDirtyByMount(mountId);

        await store.markReady(mountId, Date.now());

        processedMounts++;
        successMounts++;
        mountSummary.status = "success";
        mountSummary.scannedDirs = scannedDirs;
        mountSummary.discoveredCount = discoveredCount;
        mountSummary.upsertedCount = upsertedCount;
        mountSummary.durationMs = Date.now() - startedAt;

        await context.updateProgress(job.jobId, {
          totalItems,
          processedItems: processedMounts,
          successCount: successMounts,
          failedCount: failedMounts,
          skippedCount: skippedMounts,
          itemResults,
          currentMountId: mountId,
          upsertedCount,
          discoveredCount,
          pendingCount: pending.length,
        } as any);
      } catch (error: any) {
        const cancelled = String(error?.message || "").toLowerCase() === "cancelled";
        const msg = cancelled ? "索引重建已取消" : String(error?.message || error || "unknown error");
        console.warn(
          `[FsIndexRebuildTaskHandler] mount 重建失敗: mountId=${mountId}, path=${mountPath}, error=${msg}`,
        );
        if (mountId) {
          await store.markError(mountId, msg);
        }

        processedMounts++;
        if (cancelled) {
          skippedMounts++;
          mountSummary.status = "skipped";
          mountSummary.scannedDirs = scannedDirs;
          mountSummary.discoveredCount = discoveredCount;
          mountSummary.upsertedCount = upsertedCount;
          mountSummary.error = "cancelled";
        } else {
          failedMounts++;
          mountSummary.status = "failed";
          mountSummary.scannedDirs = scannedDirs;
          mountSummary.discoveredCount = discoveredCount;
          mountSummary.upsertedCount = upsertedCount;
          mountSummary.error = msg;
        }

        await context.updateProgress(job.jobId, {
          totalItems,
          processedItems: processedMounts,
          successCount: successMounts,
          failedCount: failedMounts,
          skippedCount: skippedMounts,
          itemResults,
          currentMountId: mountId,
          discoveredCount,
        } as any);

        if (cancelled) {
          break;
        }
        // mount 單點失敗：不中斷全域性作業，繼續下一個 mount
        continue;
      }
    }

    console.log(
      `[FsIndexRebuildTaskHandler] 作業完成: jobId=${job.jobId}, processed=${processedMounts}/${effectiveMounts.length}, ok=${successMounts}, failed=${failedMounts}, skipped=${skippedMounts}`,
    );

    // 若因預算限制截斷了掛載點列表，寫入一個可觀察的提示（不影響作業狀態）
    if (truncatedMounts > 0) {
      await context.updateProgress(job.jobId, {
        totalItems,
        processedItems: processedMounts,
        successCount: successMounts,
        failedCount: failedMounts,
        skippedCount: skippedMounts,
        itemResults,
        truncatedMounts,
      } as any);
    }
  }
}
