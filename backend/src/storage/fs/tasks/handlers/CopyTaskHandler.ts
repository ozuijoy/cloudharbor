// cSpell:words retryable
import type { TaskHandler, InternalJob, ExecutionContext } from "../TaskHandler.js";
import type { TaskStats, CopyTaskPayload, ItemResult, RetryPolicy } from "../types.js";
import { ValidationError } from "../../../../http/errors.js";
import { invalidateFsCache } from "../../../../cache/invalidation.js";
import { FsSearchIndexStore } from "../../search/FsSearchIndexStore.js";
import { isRetryableError, calculateBackoffDelay, sleep, formatRetryLog, DEFAULT_RETRY_POLICY } from "../utils/retryUtils.js";

// 進度上報節流：限制單個檔案的進度寫入次數，避免在 Workers Free 計劃下觸發 50 次子請求上限
const MAX_PROGRESS_UPDATES_PER_ITEM = 5;
const DEFAULT_PROGRESS_BYTES_STEP = 5 * 1024 * 1024;

// Docker 環境進度節流：按時間間隔限制進度上報頻率，減少資料庫寫入壓力
const DOCKER_PROGRESS_INTERVAL_MS = 500;

// 預掃描併發數：
// - Workers: 6 個併發連線是每次 invocation 獨立的配額
// - Docker: 無硬限制
const PRESCAN_CONCURRENCY_WORKERS = 6;
const PRESCAN_CONCURRENCY_DOCKER = 10;

/**
 * 複製任務處理器 - 支援同儲存原子複製和跨儲存流式複製
 * - 同儲存: 驅動層原子複製 (S3 自動使用 CopyObject API)
 * - 跨儲存: 後端流式複製 + 位元組級進度監控
 */
export class CopyTaskHandler implements TaskHandler {
  readonly taskType = "copy";

  /** 驗證複製任務載荷 - items 非空陣列且每項包含 sourcePath 和 targetPath */
  async validate(payload: any): Promise<void> {
    // 檢查items欄位存在且為陣列
    if (!payload.items || !Array.isArray(payload.items)) {
      throw new ValidationError("items 必須是陣列");
    }

    // 檢查items非空
    if (payload.items.length === 0) {
      throw new ValidationError("items 不能為空");
    }

    // 驗證每個item的結構
    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];

      if (!item.sourcePath || typeof item.sourcePath !== "string") {
        throw new ValidationError(`items[${i}].sourcePath 必須是非空字串`);
      }

      if (!item.targetPath || typeof item.targetPath !== "string") {
        throw new ValidationError(`items[${i}].targetPath 必須是非空字串`);
      }
    }
  }

  /** 執行復制任務 - 預掃描檔案大小 → 逐項複製 + 支援重試和取消 */
  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = job.payload as CopyTaskPayload;
    const fileSystem = context.getFileSystem();

    // 透過 ExecutionContext 獲取執行時環境，用於區分 Cloudflare Workers (D1/Workflows) 與本地 SQLite (Docker/Node)
    // 只有在 Workers 環境下才開啟進度上報節流，Docker 部署仍保持細粒度進度反饋
    const env = typeof context.getEnv === "function" ? context.getEnv() : null;
    const isWorkersEnv = !!env && (Object.prototype.hasOwnProperty.call(env, "DB") || Object.prototype.hasOwnProperty.call(env, "JOB_WORKFLOW"));

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalBytesTransferred = 0; // 累計已傳輸位元組

    console.log(`[CopyTaskHandler] 開始執行作業 ${job.jobId}, 共 ${payload.items.length} 項`);

    // 預掃描所有原始檔，獲取 totalBytes 和每個檔案大小（併發執行）
    const prescanConcurrency = isWorkersEnv ? PRESCAN_CONCURRENCY_WORKERS : PRESCAN_CONCURRENCY_DOCKER;

    const fileSizes: number[] = new Array(payload.items.length).fill(0);

    // 批次併發預掃描
    for (let batchStart = 0; batchStart < payload.items.length; batchStart += prescanConcurrency) {
      const batchEnd = Math.min(batchStart + prescanConcurrency, payload.items.length);
      const batchPromises: Promise<void>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const item = payload.items[i];

        // 目錄跳過
        if (item.sourcePath.endsWith("/")) {
          continue;
        }

        const scanPromise = (async () => {
          try {
            const fileInfo = await fileSystem.getFileInfo(item.sourcePath, job.userId, job.userType);
            fileSizes[i] = fileInfo?.size || 0;
          } catch (error) {
            console.warn(`[CopyTaskHandler] 無法獲取檔案大小: ${item.sourcePath}`, error);
          }
        })();

        batchPromises.push(scanPromise);
      }

      await Promise.all(batchPromises);
    }

    const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);

    // 初始化每個檔案的狀態跟蹤陣列（包含檔案大小）
    const itemResults: ItemResult[] = payload.items.map((item, index) => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: "pending" as const,
      fileSize: fileSizes[index],
    }));

    await context.updateProgress(job.jobId, { totalBytes, itemResults });

    console.log(`[CopyTaskHandler] 預掃描完成，總大小: ${totalBytes} 位元組`);

    // 獲取重試策略
    const retryPolicy: RetryPolicy = payload.options?.retryPolicy || DEFAULT_RETRY_POLICY;
    console.log(`[CopyTaskHandler] 重試策略: limit=${retryPolicy.limit}, delay=${retryPolicy.delay}ms, backoff=${retryPolicy.backoff}`);

    // 為每個檔案計算進度上報的最小步長和最近一次上報的位元組數（僅在 Workers 環境下會使用）
    const lastReportedBytesPerItem: number[] = new Array(payload.items.length).fill(0);
    const progressStepPerItem: number[] = fileSizes.map((size) => {
      if (!size || size <= 0) {
        return DEFAULT_PROGRESS_BYTES_STEP;
      }
      const step = Math.ceil(size / MAX_PROGRESS_UPDATES_PER_ITEM);
      return Math.max(step, DEFAULT_PROGRESS_BYTES_STEP);
    });

    // Docker 環境：基於時間間隔的進度節流，避免高頻寫入 SQLite
    let lastDockerProgressTime = 0;

    // 計算單個作業內的複製併發數
    const userMaxConcurrency = payload.options?.maxConcurrency;
    let jobConcurrency = Number(userMaxConcurrency);
    if (!Number.isFinite(jobConcurrency) || jobConcurrency <= 0) {
      jobConcurrency = 2;
    }
    jobConcurrency = Math.min(Math.max(jobConcurrency, 1), 32);

    console.log(`[CopyTaskHandler] 作業內複製併發數: ${jobConcurrency} (isWorkersEnv=${isWorkersEnv})`);

    const processItem = async (i: number): Promise<void> => {
      const item = payload.items[i];

      // 檢查取消狀態（避免在 Job 已被取消時繼續處理新檔案）
      if (await context.isCancelled(job.jobId)) {
        console.log(`[CopyTaskHandler] 作業 ${job.jobId} 已取消, 跳過剩餘項 (當前索引 ${i + 1}/${payload.items.length})`);
        return;
      }

      // 單檔案重試迴圈
      let lastError: Error | null = null;
      let fileSuccess = false;
      let fileSkipped = false;
      let currentFileBytes = 0;

      for (let attempt = 0; attempt <= retryPolicy.limit; attempt++) {
        if (attempt > 0) {
          const delay = calculateBackoffDelay(attempt, retryPolicy);

          console.log(`[CopyTaskHandler] ${formatRetryLog(attempt, retryPolicy.limit, delay, item.sourcePath, lastError?.message)}`);

          itemResults[i].status = "retrying";
          itemResults[i].retryCount = attempt;
          itemResults[i].lastRetryAt = Date.now();
          await context.updateProgress(job.jobId, { itemResults });

          await sleep(delay);

          // 重試前再次檢查取消
          if (await context.isCancelled(job.jobId)) {
            console.log(`[CopyTaskHandler] 作業 ${job.jobId} 在重試等待期間被取消`);
            return;
          }
        }

        itemResults[i].status = attempt > 0 ? "retrying" : "processing";
        currentFileBytes = 0;

        try {
          // 呼叫 FileSystem.copyItem() - 自動選擇同儲存原子複製或跨儲存流式複製
          const copyResult = await fileSystem.copyItem(item.sourcePath, item.targetPath, job.userId, job.userType, {
            ...payload.options,
            onProgress: (bytesTransferred: number) => {
              currentFileBytes = bytesTransferred;
              itemResults[i].bytesTransferred = bytesTransferred;
              const absoluteBytes = totalBytesTransferred + currentFileBytes;

              // Docker/Node.js 環境：按時間間隔節流
              if (!isWorkersEnv) {
                const now = Date.now();
                if (now - lastDockerProgressTime >= DOCKER_PROGRESS_INTERVAL_MS) {
                  lastDockerProgressTime = now;
                  context
                    .updateProgress(job.jobId, {
                      bytesTransferred: absoluteBytes,
                      itemResults,
                    })
                    .catch(() => {});
                }
                return;
              }

              // Cloudflare Workers 環境：按位元組步長節流進度上報，減少 D1 子請求次數
              const lastReported = lastReportedBytesPerItem[i];
              const step = progressStepPerItem[i];
              if (absoluteBytes - lastReported >= step) {
                lastReportedBytesPerItem[i] = absoluteBytes;
                context
                  .updateProgress(job.jobId, {
                    bytesTransferred: absoluteBytes,
                    itemResults,
                  })
                  .catch(() => {});
              }
            },
          });

          const resultStatus = (copyResult?.status as string) || "success";
          const isSkipped = resultStatus === "skipped" || copyResult?.skipped === true;

          if (isSkipped) {
            // 驅動顯式表示跳過：不計入失敗，但標記為 skipped
            fileSkipped = true;
            // 記錄跳過原因，供前端展示（不影響任務最終狀態）
            // - 優先使用驅動返回的 message/error
            // - 否則給一個可讀的預設原因（最常見是 skipExisting 導致）
            const skipReason =
              copyResult?.message ||
              copyResult?.error ||
              (payload.options?.skipExisting
                ? "目標已存在，已按“跳過已存在檔案”設定跳過"
                : "已跳過");
            itemResults[i].message = String(skipReason);
          } else if (resultStatus === "failed") {
            // 驅動顯式表示失敗：丟擲錯誤觸發重試/失敗分支，並保留 message 供上層使用
            const reason = copyResult?.message || copyResult?.error || "複製失敗";
            throw new Error(reason);
          } else {
            // 視為成功：累計位元組數並記錄傳輸進度
            const fileBytes = copyResult?.contentLength || currentFileBytes || 0;
            totalBytesTransferred += fileBytes;
            itemResults[i].bytesTransferred = fileBytes;
            fileSuccess = true;
          }

          itemResults[i].retryCount = attempt;
          break;
        } catch (error: any) {
          lastError = error;

          const canRetry = isRetryableError(error);
          const hasMoreRetries = attempt < retryPolicy.limit;

          if (!canRetry || !hasMoreRetries) {
            const retryInfo = attempt > 0 ? ` (已重試 ${attempt}/${retryPolicy.limit} 次)` : "";
            const retryableInfo = !canRetry ? " [不可重試錯誤]" : "";

            itemResults[i].status = "failed";
            itemResults[i].error = `${error.message || String(error)}${retryInfo}${retryableInfo}`;
            itemResults[i].retryCount = attempt;

            console.error(
              `[CopyTaskHandler] 複製最終失敗 [${i + 1}/${payload.items.length}]${retryInfo}${retryableInfo} ` +
                `${item.sourcePath} → ${item.targetPath}: ${error.message || error}`
            );

            break;
          }

          console.warn(
            `[CopyTaskHandler] 複製失敗 [${i + 1}/${payload.items.length}] (嘗試 ${attempt + 1}/${retryPolicy.limit + 1}) ` +
              `${item.sourcePath}: ${error.message || error} [將重試]`
          );
        }
      }

      // 更新最終狀態
      if (fileSkipped) {
        itemResults[i].status = "skipped";
        itemResults[i].bytesTransferred = 0;
        skippedCount++;
      } else if (fileSuccess) {
        itemResults[i].status = "success";
        successCount++;
        const retryCount = itemResults[i].retryCount;
        if (retryCount !== undefined && retryCount > 0) {
          console.log(`[CopyTaskHandler] ✓ 複製成功 (經 ${retryCount} 次重試) ${item.sourcePath}`);
        }
      } else {
        failedCount++;
      }

      // 更新進度
      await context.updateProgress(job.jobId, {
        processedItems: successCount + failedCount + skippedCount,
        successCount,
        failedCount,
        skippedCount,
        bytesTransferred: totalBytesTransferred,
        itemResults,
      });
    };

    // 按 jobConcurrency 進行分批併發執行，保證單個作業內不會超過配置的複製併發數
    for (let batchStart = 0; batchStart < payload.items.length; batchStart += jobConcurrency) {
      // 在啟動新批次前檢查是否已經取消
      if (await context.isCancelled(job.jobId)) {
        console.log(`[CopyTaskHandler] 作業 ${job.jobId} 已取消, 停止啟動新的複製批次 (已處理 ~${batchStart}/${payload.items.length} 項)`);
        break;
      }

      const batchEnd = Math.min(batchStart + jobConcurrency, payload.items.length);
      const batchPromises: Promise<void>[] = [];
      for (let i = batchStart; i < batchEnd; i++) {
        batchPromises.push(processItem(i));
      }
      await Promise.all(batchPromises);
    }

    console.log(`[CopyTaskHandler] 作業 ${job.jobId} 執行完成: ` + `成功 ${successCount}, 失敗 ${failedCount}, 跳過 ${skippedCount}, ` + `傳輸 ${totalBytesTransferred} 位元組`);

    // 寫操作後的快取一致性：複製成功後主動失效目標掛載點目錄快取
    if (successCount > 0) {
      try {
        // 收斂失效粒度（更接近成熟系統的做法）：
        // - 優先使用“子路徑(subPath) + 祖先目錄”失效，而不是整 mount 失效
        // - 僅當無法解析 subPath 或路徑數量過多時，降級為 mount 級失效（一致性優先）
        const mountDirPaths = new Map<string, Set<string>>();
        const mountFallback = new Set<string>();
        const dirtyTargetPathsByMount = new Map<string, string[]>();
        const indexStore = (() => {
          const db = fileSystem.mountManager?.db ?? null;
          return db ? new FsSearchIndexStore(db) : null;
        })();

        const toParentDir = (subPath: string): string => {
          const raw = subPath ? String(subPath) : "/";
          const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
          const collapsed = withLeading.replace(/\/{2,}/g, "/");
          if (collapsed === "/") return "/";
          const normalized = collapsed.replace(/\/+$/, "");
          const lastSlash = normalized.lastIndexOf("/");
          if (lastSlash <= 0) return "/";
          return normalized.slice(0, lastSlash) || "/";
        };

        for (const item of itemResults) {
          if (item?.status !== "success") continue;
          if (!item?.targetPath) continue;

          const resolved = await fileSystem.mountManager.getDriverByPath(item.targetPath, job.userId, job.userType);
          const mountId = resolved?.mount?.id || null;
          const subPath = resolved?.subPath || null;
          if (!mountId) continue;

          // 索引增量：僅收整合功項的 targetPath，統一“收斂 + 入隊”
          if (!dirtyTargetPathsByMount.has(mountId)) {
            dirtyTargetPathsByMount.set(mountId, []);
          }
          dirtyTargetPathsByMount.get(mountId)?.push(String(item.targetPath));

          if (!subPath) {
            mountFallback.add(mountId);
            continue;
          }

          const isDirectoryHint = item.targetPath.endsWith("/");
          const dirPath = isDirectoryHint ? subPath : toParentDir(subPath);

          if (!mountDirPaths.has(mountId)) {
            mountDirPaths.set(mountId, new Set<string>());
          }
          mountDirPaths.get(mountId)?.add(dirPath);
        }

        const MAX_PATHS_PER_MOUNT = 200;
        const mountsToLog: string[] = [];

        for (const [mountId, dirPathSet] of mountDirPaths.entries()) {
          if (mountFallback.has(mountId)) {
            invalidateFsCache({ mountId, reason: "copy-job", db: fileSystem.mountManager?.db ?? null });
            mountsToLog.push(`${mountId}(mount)`);
            continue;
          }

          const dirPaths = Array.from(dirPathSet);
          if (dirPaths.length === 0) continue;

          if (dirPaths.length > MAX_PATHS_PER_MOUNT) {
            invalidateFsCache({ mountId, reason: "copy-job", db: fileSystem.mountManager?.db ?? null });
            mountsToLog.push(`${mountId}(mount,paths=${dirPaths.length})`);
            continue;
          }

          invalidateFsCache({ mountId, paths: dirPaths, reason: "copy-job", db: fileSystem.mountManager?.db ?? null });
          mountsToLog.push(`${mountId}(paths=${dirPaths.length})`);
        }

        // 僅出現在“所有成功項都無法解析 subPath”的情況下
        for (const mountId of mountFallback) {
          if (mountDirPaths.has(mountId)) continue;
          invalidateFsCache({ mountId, reason: "copy-job", db: fileSystem.mountManager?.db ?? null });
          mountsToLog.push(`${mountId}(mount)`);
        }

        if (mountsToLog.length > 0) {
          console.log(`[CopyTaskHandler] 已觸發目錄快取失效: ${mountsToLog.join(", ")}`);
        }

        // 索引 dirty 入隊（合併閾值）：避免複製大批次檔案時對 D1/SQLite 造成寫入放大
        if (indexStore && dirtyTargetPathsByMount.size > 0) {
          const MAX_DIRTY_OPS_PER_MOUNT = 200;

          const ensureDirPath = (p: string): string => {
            const raw = typeof p === "string" && p ? p : "/";
            const trimmed = raw.replace(/\/+$/g, "");
            if (!trimmed || trimmed === "/") return "/";
            return `${trimmed}/`;
          };

          const parentDirPath = (p: string): string => {
            const raw = typeof p === "string" && p ? p : "/";
            const trimmed = raw.replace(/\/+$/g, "");
            if (!trimmed || trimmed === "/") return "/";
            const idx = trimmed.lastIndexOf("/");
            if (idx <= 0) return "/";
            return ensureDirPath(trimmed.slice(0, idx) || "/");
          };

          const toDirtyDirectory = (p: string): string => (p.endsWith("/") ? ensureDirPath(p) : parentDirPath(p));

          const commonDirPrefix = (dirs: string[]): string => {
            const list = Array.isArray(dirs) ? dirs.filter(Boolean) : [];
            if (list.length === 0) return "/";

            const toSegs = (dir: string) =>
              String(dir || "/")
                .replace(/^\/+|\/+$/g, "")
                .split("/")
                .filter(Boolean);

            let prefix = toSegs(list[0]);
            for (let i = 1; i < list.length; i++) {
              const segs = toSegs(list[i]);
              const next: string[] = [];
              const len = Math.min(prefix.length, segs.length);
              for (let j = 0; j < len; j++) {
                if (prefix[j] !== segs[j]) break;
                next.push(prefix[j]);
              }
              prefix = next;
              if (prefix.length === 0) break;
            }

            if (prefix.length === 0) return "/";
            return `/${prefix.join("/")}/`;
          };

          for (const [mountId, paths] of dirtyTargetPathsByMount.entries()) {
            const unique = Array.from(new Set((paths || []).filter(Boolean)));
            if (unique.length === 0) continue;

            try {
              if (unique.length > MAX_DIRTY_OPS_PER_MOUNT) {
                const dirPrefix = commonDirPrefix(unique.map(toDirtyDirectory));
                await indexStore.upsertDirty({ mountId: String(mountId), fsPath: dirPrefix, op: "upsert" });
              } else {
                for (const p of unique) {
                  await indexStore.upsertDirty({ mountId: String(mountId), fsPath: String(p), op: "upsert" });
                }
              }
            } catch (err: unknown) {
              const errMessage = err instanceof Error ? err.message : String(err);
              console.warn("[CopyTaskHandler] upsertDirty 失敗（已忽略）", errMessage);
            }
          }
        }
      } catch (error) {
        // 快取失效失敗不應影響作業結果；但需要日誌以便排查一致性問題
        console.warn("[CopyTaskHandler] 目錄快取失效失敗（已忽略）", error);
      }
    }
  }

  /** 建立統計模板 - 初始化所有項狀態為 pending */
  createStatsTemplate(payload: any): TaskStats {
    const copyPayload = payload as CopyTaskPayload;

    const itemResults: ItemResult[] = copyPayload.items.map((item) => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: "pending" as const,
    }));

    return {
      totalItems: copyPayload.items.length,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      bytesTransferred: 0,
      itemResults,
    };
  }
}
