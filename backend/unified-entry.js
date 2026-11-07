// unified-entry.js - 統一入口
// 在 Cloudflare Workers 環境下匯出 { fetch } 處理函式
// 在 Node/Docker 環境下啟動基於 Hono 的 HTTP 伺服器

// 頂層匯入僅包含跨環境可用的模組（Hono 應用與公共工具）
import app from "./src/index.js";
import { ApiStatus } from "./src/constants/index.js";
import { ensureDatabaseReady } from "./src/db/index.js";
import { registerTaskHandlers } from "./src/storage/fs/tasks/registerHandlers.js";
import { registerJobTypes, validateJobTypesConsistency } from "./src/storage/fs/tasks/registerJobTypes.js";
import { registerScheduledHandlers } from "./src/scheduled/ScheduledTaskRegistry.js";
import { runDueScheduledJobs } from "./src/scheduled/runDueScheduledJobs.js";
import { upsertSchedulerTickState } from "./src/services/schedulerTickerStateService.js";

// 在模組載入時註冊所有任務處理器和排程任務處理器
registerTaskHandlers();
registerJobTypes();
validateJobTypesConsistency();
registerScheduledHandlers();

// 執行時環境檢測：透過 caches.default 判斷是否為 Cloudflare Workers
const isCloudflareWorkers = (() => {
  try {
    return typeof caches !== "undefined" && typeof caches.default !== "undefined";
  } catch {
    return false;
  }
})();

// Cloudflare Workflows 條件匯出（僅在 Workers 環境下實際使用）
export const JobWorkflow = isCloudflareWorkers
  ? (await import("./src/workflows/JobWorkflow.ts")).JobWorkflow
  : class JobWorkflow {
      constructor() {
        console.warn("JobWorkflow 在 Node 環境下不可用");
      }
      async run() {
        throw new Error("JobWorkflow 僅在 Cloudflare Workers 環境下可用");
      }
    };

// ============ Cloudflare Workers 環境匯出 ============
// 預設匯出 fetch，只在 Workers 環境下由 Cloudflare 呼叫；
// 在 Node 環境下不會被使用
let dbInitPromise = null;

async function ensureDbReadyOnce(env) {
  if (dbInitPromise) return dbInitPromise;
  if (!env?.DB) {
    throw new Error("DB 未繫結，請在 Cloudflare 繫結中配置 D1 資料庫");
  }

  dbInitPromise = ensureDatabaseReady({ db: env.DB, env });
  try {
    await dbInitPromise;
  } catch (error) {
    // 初始化失敗時允許後續請求重試，避免一次失敗後永久跳過
    dbInitPromise = null;
    throw error;
  }
  return dbInitPromise;
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env || !env.ENCRYPTION_SECRET) {
        throw new Error("ENCRYPTION_SECRET 未配置，請在Cloudflare繫結中設定安全金鑰");
      }

      const bindings = {
        ...env,
        DB: env.DB,
        ENCRYPTION_SECRET: env.ENCRYPTION_SECRET,
      };

      await ensureDbReadyOnce(env);

      return app.fetch(request, bindings, ctx);
    } catch (error) {
      console.error("處理請求時發生錯誤:", error);
      return new Response(
        JSON.stringify({
          code: ApiStatus.INTERNAL_ERROR,
          message: "伺服器內部錯誤",
          error: error.message,
          success: false,
          data: null,
        }),
        {
          status: ApiStatus.INTERNAL_ERROR,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      if (!env || !env.DB) {
        console.warn("[scheduled] 缺少 DB 繫結，跳過維護任務執行");
        return;
      }

      console.log("[scheduled] Cloudflare scheduled 觸發，開始檢查到期後臺任務...", new Date().toISOString());

      await ensureDbReadyOnce(env);
      // 記錄“真實觸發發生”的證據
      await upsertSchedulerTickState(env.DB, {
        lastMs: Date.now(),
        lastCron: controller?.cron ? String(controller.cron) : null,
      });
      await runDueScheduledJobs(env.DB, env);
    } catch (error) {
      console.error("[scheduled] 執行維護任務時發生錯誤:", error);
    }
  },
};

// ============ Node/Docker 環境啟動邏輯 ============
if (!isCloudflareWorkers) {
  const bootstrap = async () => {
    const [{ serve }, { default: path }, { default: fs }, { fileURLToPath }, { createSQLiteAdapter }] = await Promise.all([
      import("@hono/node-server"),
      import("path"),
      import("fs"),
      import("url"),
      // 動態字串拼接避免 Wrangler esbuild 靜態分析,Workers 環境不會執行此分支
      import(`${"."}/src/adapters/SQLiteAdapter.js`),
    ]);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const port = Number(process.env.PORT) || 8787;
    const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "cloudharbor.db");

    const sqliteAdapter = await createSQLiteAdapter(dbPath);
    await ensureDatabaseReady({ db: sqliteAdapter, env: process.env });

    const bindings = {
      DB: sqliteAdapter,
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
      TASK_DATABASE_PATH: dbPath,
      TASK_WORKER_POOL_SIZE: Number(process.env.TASK_WORKER_POOL_SIZE) || 10,
    };

    if (!bindings.ENCRYPTION_SECRET) {
      throw new Error("ENCRYPTION_SECRET 未設定，請在環境變數中配置安全金鑰");
    }

    // 啟動 Node/Docker 環境內部排程器：
    // - 使用 node-schedule 定期觸發 runDueScheduledJobs
    // - cron 表示式可以透過環境變數 SCHEDULED_TICK_CRON 覆蓋，預設每分鐘一次
    const cronExpr = process.env.SCHEDULED_TICK_CRON || "*/1 * * * *";
    const { scheduleJob } = await import("node-schedule");
    try {
      scheduleJob(cronExpr, async () => {
        const tickStartedAt = new Date();
        const tickStartedIso = tickStartedAt.toISOString();
        console.log("[scheduled] node-schedule tick 觸發", { time: tickStartedIso, cron: cronExpr });

        const startedMs = Date.now();
        try {
          // 記錄“真實觸發發生”的證據
          await upsertSchedulerTickState(sqliteAdapter, {
            lastMs: startedMs,
            lastCron: cronExpr,
          });
          await runDueScheduledJobs(sqliteAdapter, bindings);
        } catch (error) {
          const durationMs = Date.now() - startedMs;
          console.error("[scheduled] node-schedule tick 執行失敗:", {
            time: new Date().toISOString(),
            durationMs,
            error,
          });
        }
      });
      console.log(`[scheduled] 已在 Node/Docker 環境啟動內部排程器，cron=${cronExpr}`);
    } catch (error) {
      console.error("[scheduled] 啟動內部排程器失敗:", error);
    }

    // Node HTTP 伺服器超時配置
    // ---------------------------------------------------------------
    // Node 預設的 server.requestTimeout 是 300000ms（5 分鐘），它限制的是「整個請求」
    // 的接收時長。部署到 Docker 後上傳大檔案（尤其是跨公網、慢速鏈路）很容易超過
    // 5 分鐘，此時 Node 會直接斷開連線，前端表現為「上傳到一半失敗 / 連線中斷」。
    // 因此這裡預設關閉 requestTimeout（0 = 不限制），僅保留 headersTimeout 防護
    // 慢速請求頭攻擊。如需恢復限制，可透過環境變數 HTTP_REQUEST_TIMEOUT_MS 指定。
    const parseTimeoutEnv = (rawValue, fallback) => {
      const parsed = Number.parseInt(String(rawValue ?? ""), 10);
      if (!Number.isFinite(parsed) || parsed < 0) return fallback;
      return parsed;
    };
    const requestTimeoutMs = parseTimeoutEnv(process.env.HTTP_REQUEST_TIMEOUT_MS, 0);
    const headersTimeoutMs = parseTimeoutEnv(process.env.HTTP_HEADERS_TIMEOUT_MS, 60000);
    // keepAliveTimeout 需略大於反向代理的 keepalive 時間，避免代理複用連線時撞上
    // Node 主動關閉連線（表現為偶發的 "socket hang up" / 上傳請求直接失敗）。
    const keepAliveTimeoutMs = parseTimeoutEnv(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 65000);

    // 使用 @hono/node-server 啟動 Node 伺服器
    serve(
      {
        fetch: (request) => app.fetch(request, bindings),
        port,
        // 傳入 Node http.Server 的選項，放寬大檔案上傳時的連線超時限制
        serverOptions: {
          requestTimeout: requestTimeoutMs,
          // headersTimeout 不能大於 requestTimeout；requestTimeout=0（不限制）時
          // Node 允許單獨設定 headersTimeout。
          headersTimeout: requestTimeoutMs > 0 ? Math.min(headersTimeoutMs, requestTimeoutMs) : headersTimeoutMs,
          keepAliveTimeout: keepAliveTimeoutMs,
        },
        // 保持預設的 overrideGlobalObjects/autoCleanupIncoming 配置
      },
      (info) => {
        console.log(`CloudHarbor 後端服務執行在 http://0.0.0.0:${info.port}`);
        console.log(
          `HTTP 超時配置: requestTimeout=${requestTimeoutMs === 0 ? "不限制" : `${requestTimeoutMs}ms`}, headersTimeout=${headersTimeoutMs}ms, keepAliveTimeout=${keepAliveTimeoutMs}ms`
        );
        // 啟動 Docker/Node 環境記憶體監控（包括容器記憶體檢測）
        startMemoryMonitoring(fs);
      }
    );
  };

  // 直接在 Node 環境中啟動
  bootstrap();
}

/**
 * 啟動記憶體使用監控：
 * - 週期性輸出 Node 程序記憶體使用情況
 * - 如在容器內執行，嘗試讀取 cgroup v2/v1 的記憶體使用與上限
 * - 在記憶體使用率較高時嘗試觸發一次 GC（如果啟用了 --expose-gc）
 */
function startMemoryMonitoring(fs, interval = 1200000) {
  // 讀取容器記憶體使用情況（優先 cgroup v2，其次 v1）
  const getContainerMemory = () => {
    try {
      let usage = null;
      let limit = null;

      // cgroup v2
      if (fs.existsSync("/sys/fs/cgroup/memory.current")) {
        usage = parseInt(fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8"));
        const maxContent = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
        if (maxContent !== "max") {
          limit = parseInt(maxContent);
        }
      }
      // cgroup v1
      else if (fs.existsSync("/sys/fs/cgroup/memory/memory.usage_in_bytes")) {
        usage = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8"));
        const limitValue = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8"));
        if (Number.isFinite(limitValue) && limitValue < Number.MAX_SAFE_INTEGER) {
          limit = limitValue;
        }
      }

      return usage && limit ? { usage, limit } : null;
    } catch {
      // 非容器環境或無許可權時靜默忽略
      return null;
    }
  };

  const logMemoryUsage = () => {
    const mem = process.memoryUsage();
    const containerMem = getContainerMemory();

    const memoryInfo = {
      rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(mem.external / 1024 / 1024)} MB`,
      arrayBuffers: mem.arrayBuffers ? `${Math.round(mem.arrayBuffers / 1024 / 1024)} MB` : "N/A",
    };

    if (containerMem) {
      memoryInfo.container = `${Math.round(containerMem.usage / 1024 / 1024)} MB / ${Math.round(containerMem.limit / 1024 / 1024)} MB`;
      memoryInfo.containerUsage = `${Math.round((containerMem.usage / containerMem.limit) * 100)}%`;
    }

    console.log("記憶體使用情況:", memoryInfo);

    // 簡單的高佔用檢測邏輯
    let shouldGC = false;
    if (containerMem) {
      // 容器記憶體使用率超過 85% 時嘗試 GC
      shouldGC = containerMem.usage / containerMem.limit > 0.85;
    } else {
      // 非容器環境回退到程序記憶體判斷
      shouldGC = mem.heapUsed / mem.heapTotal > 0.85 || mem.external > 50 * 1024 * 1024 || (mem.arrayBuffers && mem.arrayBuffers > 50 * 1024 * 1024);
    }

    if (global.gc && shouldGC) {
      console.log("檢測到記憶體使用較高，嘗試手動垃圾回收");
      try {
        global.gc();
      } catch (e) {
        console.warn("手動垃圾回收失敗:", e?.message || e);
      }
    }
  };

  // 立即輸出一次
  logMemoryUsage();

  // 週期性輸出
  const intervalId = setInterval(logMemoryUsage, interval);

  // 防止定時器阻止程序退出
  process.on("exit", () => {
    clearInterval(intervalId);
  });

  return {
    stop: () => clearInterval(intervalId),
    logNow: () => logMemoryUsage(),
  };
}
