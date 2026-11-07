import type { TaskHandler, InternalJob, ExecutionContext } from "../TaskHandler.js";
import { ValidationError } from "../../../../http/errors.js";
import { ensureRepositoryFactory } from "../../../../utils/repositories.js";
import { FsSearchIndexStore } from "../../search/FsSearchIndexStore.js";
import { iterateListDirectoryItems } from "../../utils/listDirectoryPaging.js";

type FsIndexApplyDirtyPayload = {
  mountIds?: string[];
  options?: {
    /**
     * 單次拉取 dirty 的條數（上限 2000）
     */
    batchSize?: number;
    /**
     * 單次作業最多處理的 dirty 條目數量（可選）
     */
    maxItems?: number | null;
    /**
     * 對目錄 upsert：是否遞迴重建該目錄子樹（預設 true）
     */
    rebuildDirectorySubtree?: boolean;
    /**
     * 目錄子樹重建的最大深度（相對該目錄），可選
     */
    maxDepth?: number | null;
    /**
     * 是否強制跳過快取（預設 true）
     */
    refresh?: boolean;
  };
};

function coercePositiveInt(value: any, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function parseMaybeInt(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isDirectoryPath(fsPath: string): boolean {
  return typeof fsPath === "string" && fsPath.endsWith("/");
}

function tryRandomUuid(): string {
  try {
    // eslint-disable-next-line no-undef
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      // eslint-disable-next-line no-undef
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseModifiedMs(modified: any): number {
  const ms = Date.parse(String(modified || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * dirty 增量應用任務
 * - 消費 fs_search_index_dirty 佇列，更新 fs_search_index_entries（FTS 由觸發器維護）
 * - 目錄刪除：字首刪除（刪除目錄自身 + 子樹）
 * - 目錄 upsert：可選遞迴重建該目錄子樹（避免目錄 rename/move 導致索引殘留）
 */
export class FsIndexApplyDirtyTaskHandler implements TaskHandler {
  readonly taskType = "fs_index_apply_dirty";

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

    if (options.maxItems !== undefined && options.maxItems !== null) {
      const n = Number(options.maxItems);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("options.maxItems 必須是正整數或 null");
      }
    }

    if (options.maxDepth !== undefined && options.maxDepth !== null) {
      const n = Number(options.maxDepth);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError("options.maxDepth 必須是 >=0 的整數或 null");
      }
    }
  }

  createStatsTemplate(payload: any) {
    const mountIds = Array.isArray(payload?.mountIds) ? payload.mountIds : [];
    return {
      totalItems: 0,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      itemResults: [],
      mountsHint: mountIds.length > 0 ? mountIds.length : 0,
      totalDirtyProcessed: 0,
      totalUpserted: 0,
      totalDeleted: 0,
    } as any;
  }

  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = (job.payload || {}) as FsIndexApplyDirtyPayload;
    const fileSystem = context.getFileSystem();
    const env = typeof context.getEnv === "function" ? context.getEnv() : null;
    const db = env?.DB ?? fileSystem?.mountManager?.db;
    if (!db) {
      throw new ValidationError("fs_index_apply_dirty: 缺少 DB 繫結");
    }

    const isWorkersEnv =
      !!env &&
      (Object.prototype.hasOwnProperty.call(env, "DB") ||
        Object.prototype.hasOwnProperty.call(env, "JOB_WORKFLOW"));

    const options = payload.options || {};
    const batchSize = coercePositiveInt(options.batchSize, isWorkersEnv ? 50 : 200, 10, 2000);
    const maxItems = options.maxItems === null || options.maxItems === undefined ? null : parseMaybeInt(options.maxItems);
    const rebuildDirectorySubtree = options.rebuildDirectorySubtree !== false;
    const maxDepth = options.maxDepth === null || options.maxDepth === undefined ? null : parseMaybeInt(options.maxDepth);
    const refresh = options.refresh !== false;

    const store = new FsSearchIndexStore(db);
    const factory = ensureRepositoryFactory(db, fileSystem?.repositoryFactory);
    const mountRepository = factory.getMountRepository();
    const allMounts = await mountRepository.findAll(true);
    const mountInfoMap = new Map(
      allMounts.map((mount: any) => [String(mount?.id || ""), mount]),
    );

    const requestedMountIds = Array.isArray(payload.mountIds)
      ? payload.mountIds.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const mounts = requestedMountIds.length > 0 ? requestedMountIds : [];
    if (mounts.length === 0) {
      // 沒指定 mountIds：消費全域性 dirty（按 mount_id 分組掃描）
      const resp = await db
        .prepare(`SELECT DISTINCT mount_id FROM fs_search_index_dirty ORDER BY mount_id ASC LIMIT 2000`)
        .all();
      const rows = Array.isArray(resp?.results) ? resp.results : [];
      for (const r of rows) {
        const id = String(r?.mount_id || "");
        if (id) mounts.push(id);
      }
    }

    let processed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let totalUpserted = 0;
    let totalDeleted = 0;
    const itemResults: any[] = [];

    console.log(
      `[FsIndexApplyDirtyTaskHandler] 開始執行作業 ${job.jobId}, mounts=${mounts.length}, batchSize=${batchSize}, maxItems=${maxItems ?? "∞"}, rebuildDir=${rebuildDirectorySubtree}`,
    );

    for (const mountId of mounts) {
      const mountStartedAt = Date.now();
      const mountInfo = mountInfoMap.get(mountId);
      const mountSummary = {
        kind: "mount",
        mountId,
        mountName: mountInfo?.name ?? null,
        mountPath: mountInfo?.mount_path ?? null,
        storageType: mountInfo?.storage_type ?? null,
        status: "processing",
        durationMs: 0,
        processedDirtyCount: 0,
        upsertedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      } as any;
      itemResults.push(mountSummary);

      if (await context.isCancelled(job.jobId)) {
        console.warn(`[FsIndexApplyDirtyTaskHandler] 作業已取消: ${job.jobId}`);
        break;
      }

      // 未 ready 的 mount：只消費 dirty 可能導致“部分可用”，這裡選擇跳過並提示
      const stateMap = await store.getIndexStates([mountId]);
      const state = stateMap.get(mountId);
      if (String(state?.status || "not_ready") !== "ready") {
        skipped++;
        mountSummary.status = "skipped";
        mountSummary.error = "index_not_ready";
        mountSummary.durationMs = Date.now() - mountStartedAt;
        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: 0,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);
        continue;
      }

      // mount 內迴圈消費
      while (true) {
        if (await context.isCancelled(job.jobId)) {
          console.warn(`[FsIndexApplyDirtyTaskHandler] 作業已取消: ${job.jobId}`);
          break;
        }

        if (maxItems !== null && processed >= maxItems) {
          break;
        }

        const remaining = maxItems !== null ? Math.max(maxItems - processed, 0) : null;
        const take = remaining !== null ? Math.max(1, Math.min(batchSize, remaining)) : batchSize;

        const rows = await store.listDirtyBatch(mountId, take);
        if (!rows || rows.length === 0) {
          break;
        }

        const consumedKeys: string[] = [];

        for (const row of rows) {
          const fsPath = String(row?.fs_path || "");
          const op = String(row?.op || "");
          const key = String(row?.dedupe_key || "");
          if (!fsPath || !key) {
            continue;
          }

          try {
            if (op === "delete") {
              if (isDirectoryPath(fsPath)) {
                await store.deleteByPathPrefix(mountId, fsPath);
              } else {
                await store.deleteEntry(mountId, fsPath);
              }
              success++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.deletedCount++;
              totalDeleted++;
              consumedKeys.push(key);
              continue;
            }

            if (op !== "upsert") {
              // 未知 op：跳過但消費掉，避免死迴圈
              skipped++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.skippedCount++;
              consumedKeys.push(key);
              continue;
            }

            if (isDirectoryPath(fsPath) && rebuildDirectorySubtree) {
              const runId = tryRandomUuid();
              const startedDirAt = Date.now();

              // 先 upsert 目錄自身（listDirectory 不包含目錄自身）
              const dirInfo = await fileSystem.getFileInfo(fsPath, job.userId, job.userType);
              await store.upsertEntries(
                [
                  {
                    mountId,
                    fsPath: String(dirInfo?.path || fsPath),
                    name: String(dirInfo?.name || ""),
                    isDir: true,
                    size: Number(dirInfo?.size || 0),
                    modifiedMs: parseModifiedMs(dirInfo?.modified),
                    mimetype: dirInfo?.mimetype ?? null,
                  },
                ],
                { indexRunId: runId },
              );

              // 遞迴掃描子樹（BFS）
              const queue: Array<{ path: string; depth: number }> = [{ path: fsPath, depth: 0 }];
              const pending: any[] = [];
              let upserted = 0;
              const seenDirs = new Set<string>();

              while (queue.length > 0) {
                if (await context.isCancelled(job.jobId)) {
                  throw new Error("cancelled");
                }

                const current = queue.shift()!;
                const dir = current.path;
                const depth = current.depth;

                if (seenDirs.has(dir)) continue;
                seenDirs.add(dir);

                for await (const item of iterateListDirectoryItems(
                  fileSystem,
                  dir,
                  job.userId,
                  job.userType,
                  { refresh },
                )) {
                  const childPath = String(item?.path || "");
                  if (!childPath) continue;

                  const isDir = Boolean(item?.isDirectory);
                  pending.push({
                    mountId,
                    fsPath: childPath,
                    name: String(item?.name || ""),
                    isDir,
                    size: Number(item?.size) || 0,
                    modifiedMs: parseModifiedMs(item?.modified),
                    mimetype: item?.mimetype ?? null,
                  });

                  if (pending.length >= batchSize) {
                    await store.upsertEntries(pending, { indexRunId: runId });
                    upserted += pending.length;
                    pending.length = 0;
                  }

                  if (isDir) {
                    if (maxDepth !== null && depth >= maxDepth) continue;
                    queue.push({ path: childPath.endsWith("/") ? childPath : `${childPath}/`, depth: depth + 1 });
                  }
                }
              }

              if (pending.length > 0) {
                await store.upsertEntries(pending, { indexRunId: runId });
                upserted += pending.length;
                pending.length = 0;
              }

              await store.cleanupPrefixByRunId(mountId, fsPath, runId);

              success++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.upsertedCount += upserted;
              totalUpserted += upserted;
              consumedKeys.push(key);

              itemResults.push({
                kind: "path",
                label: fsPath,
                sourcePath: fsPath,
                targetPath: "",
                status: "success",
                durationMs: Date.now() - startedDirAt,
                meta: {
                  upsertedCount: upserted,
                },
              });
              continue;
            }

            // 檔案/目錄（不遞迴）：用 getFileInfo 讀取最新後設資料並 upsert
            const info = await fileSystem.getFileInfo(fsPath, job.userId, job.userType);
            const isDir = Boolean(info?.isDirectory);
            await store.upsertEntries(
              [
                {
                  mountId,
                  fsPath: String(info?.path || fsPath),
                  name: String(info?.name || ""),
                  isDir,
                  size: Number(info?.size || 0),
                  modifiedMs: parseModifiedMs(info?.modified),
                  mimetype: info?.mimetype ?? null,
                },
              ],
              { indexRunId: null },
            );

            success++;
            processed++;
            mountSummary.processedDirtyCount++;
            mountSummary.upsertedCount++;
            totalUpserted++;
            consumedKeys.push(key);
          } catch (error: any) {
            const msg = String(error?.message || error || "unknown error");
            const status = error?.status || error?.statusCode || error?.response?.status;
            // 不存在：視為 delete，並消費掉該 dirty
            if (status === 404) {
              try {
                if (isDirectoryPath(fsPath)) {
                  await store.deleteByPathPrefix(mountId, fsPath);
                } else {
                  await store.deleteEntry(mountId, fsPath);
                }
                success++;
                processed++;
                mountSummary.processedDirtyCount++;
                mountSummary.deletedCount++;
                totalDeleted++;
                consumedKeys.push(key);
                continue;
              } catch (secondary) {
                // fallthrough
              }
            }

            console.warn(
              `[FsIndexApplyDirtyTaskHandler] apply failed: mountId=${mountId}, op=${op}, path=${fsPath}, error=${msg}`,
            );
            failed++;
            processed++;
            mountSummary.processedDirtyCount++;
            mountSummary.failedCount++;
            // 失敗時不消費該 dirty：保留以便下次重試（避免丟更新）
            itemResults.push({
              kind: "path",
              label: fsPath,
              sourcePath: fsPath,
              targetPath: "",
              status: "failed",
              error: msg,
            });
          }
        }

        if (consumedKeys.length > 0) {
          await store.deleteDirtyByKeys(consumedKeys);
        }

        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: rows.length,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);

        if (rows.length < take) {
          break;
        }
      }

      if (mountSummary.status === "processing") {
        mountSummary.status = mountSummary.failedCount > 0 ? "failed" : "success";
        mountSummary.durationMs = Date.now() - mountStartedAt;
        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: 0,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);
      }
    }

    console.log(
      `[FsIndexApplyDirtyTaskHandler] 作業結束: jobId=${job.jobId}, processed=${processed}, ok=${success}, failed=${failed}, skipped=${skipped}`,
    );
  }
}
