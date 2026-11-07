import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getVirtualDirectoryListing, isVirtualPath } from "../../storage/fs/utils/VirtualDirectory.js";
import { createErrorResponse, getQueryBool, jsonOk } from "../../utils/common.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { LinkService } from "../../storage/link/LinkService.js";
import { resolvePreviewSelection } from "../../services/documentPreviewService.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../../storage/streaming/index.js";
import { normalizePath as normalizeFsPath } from "../../storage/fs/utils/PathResolver.js";
import { FsSearchIndexStore } from "../../storage/fs/search/FsSearchIndexStore.js";
import { fsFolderSummaryCacheManager } from "../../cache/index.js";

const toIsoFromMs = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
};

const isValidSize = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

const isFolderSummaryMissing = (item) => {
  if (!item || !item.isDirectory || item.isVirtual) return false;
  const sizeMissing = typeof item.size !== "number" || !Number.isFinite(item.size) || item.size < 0;
  const modifiedMissing = !item.modified;
  return sizeMissing || modifiedMissing;
};

const ensureFolderSummarySources = (item) => {
  if (!item || !item.isDirectory || item.isVirtual) return;

  if (!item.size_source) {
    item.size_source = isValidSize(item.size) ? "storage" : "none";
  }
  if (!item.modified_source) {
    item.modified_source = item.modified ? "storage" : "none";
  }
};

const normalizeDir = (p) => {
  const raw = typeof p === "string" && p ? p : "/";
  const normalized = normalizeFsPath(raw, true);
  return normalized;
};

const normalizeSummarySource = (raw) => {
  const v = raw ? String(raw) : "";
  if (v === "storage" || v === "index" || v === "compute" || v === "none") return v;
  return null;
};

// 目錄摘要計算（compute）singleflight：同一 mount + 同一路徑 + 同一使用者上下文併發時只算一次。
// 目的：避免 TTL 較短或多人同時重新整理導致“遞迴遍歷”被放大成 N 倍。
const inflightFolderSummaryCompute = new Map();

const buildFolderSummaryComputeUserKey = (userIdOrInfo, userType) => {
  const typeKey = userType != null ? String(userType) : "";
  let idKey = "";
  if (typeof userIdOrInfo === "string" || typeof userIdOrInfo === "number") {
    idKey = String(userIdOrInfo);
  } else if (userIdOrInfo && typeof userIdOrInfo === "object" && userIdOrInfo.id != null) {
    idKey = String(userIdOrInfo.id);
  }
  return `${typeKey}:${idKey}`;
};

const computeFolderSummaryByTraversalSingleflight = async (mountId, dirPath, fileSystem, userIdOrInfo, userType, options = {}) => {
  const mountKey = mountId != null ? String(mountId) : "";
  const dirKey = normalizeDir(dirPath);
  const userKey = buildFolderSummaryComputeUserKey(userIdOrInfo, userType);
  const baseKey = `${mountKey}::${userKey}::${dirKey}`;

  // refresh=true 必須“更強”：不能複用 refresh=false 的 inflight（可能是舊的）
  // refresh=false 可以複用 refresh=true 的 inflight（因為更“新”）
  const refreshKey = `${baseKey}::refresh`;
  const normalKey = `${baseKey}::normal`;
  const key = options?.refresh ? refreshKey : inflightFolderSummaryCompute.has(refreshKey) ? refreshKey : normalKey;

  let inflight = inflightFolderSummaryCompute.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        return await computeFolderSummaryByTraversal(fileSystem, dirKey, userIdOrInfo, userType, options);
      } finally {
        inflightFolderSummaryCompute.delete(key);
      }
    })();
    inflightFolderSummaryCompute.set(key, inflight);
  }

  return inflight;
};

// computeDirectChildDirSummaries 輸出結果依賴 childDirNameToFsPath（它決定“要算哪些子目錄”）。
// 因此 key 裡必須包含“子目錄名集合”的 hash，避免不同請求之間複用錯誤結果。
const inflightDirectChildDirSummaries = new Map();

const hashChildDirNameSet = (childDirNameToFsPath) => {
  let hash = 0x811c9dc5;
  const names = Array.from(childDirNameToFsPath?.keys?.() ?? []);
  names.sort();
  for (const name of names) {
    const str = typeof name === "string" ? name : String(name ?? "");
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    // separator
    hash ^= 124; // '|'
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return (hash >>> 0).toString(16);
};

const computeDirectChildDirSummariesSingleflight = async (
  mountId,
  relativeSubPath,
  childDirNameToFsPath,
  directoryOps,
  userIdOrInfo,
  userType,
  options = {}
) => {
  const mountKey = mountId != null ? String(mountId) : "";
  const subKey = typeof relativeSubPath === "string" ? relativeSubPath : String(relativeSubPath ?? "");
  const userKey = buildFolderSummaryComputeUserKey(userIdOrInfo, userType);
  const nameSetHash = hashChildDirNameSet(childDirNameToFsPath);
  const baseKey = `${mountKey}::${userKey}::${subKey}::${nameSetHash}`;

  // refresh=true 不能複用 refresh=false 的 inflight（可能是舊的）；refresh=false 可複用 refresh=true 的 inflight（更“新”）
  const refreshKey = `${baseKey}::refresh`;
  const normalKey = `${baseKey}::normal`;
  const key = options?.refresh ? refreshKey : inflightDirectChildDirSummaries.has(refreshKey) ? refreshKey : normalKey;

  let inflight = inflightDirectChildDirSummaries.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        if (!directoryOps || typeof directoryOps.computeDirectChildDirSummaries !== "function") {
          return { results: new Map(), completed: false, visited: 0 };
        }
        return await directoryOps.computeDirectChildDirSummaries(subKey, childDirNameToFsPath, options);
      } finally {
        inflightDirectChildDirSummaries.delete(key);
      }
    })();
    inflightDirectChildDirSummaries.set(key, inflight);
  }

  return inflight;
};

/**
 * 遞迴遍歷目錄計算摘要（可選能力）
 * - 只用於“目錄”的 size/modified 缺失兜底
 * - modified 語義：子孫項 modified 的最大值
 * 儲存原生 > 計算 > 索引庫本體 > 未知
 */
const computeFolderSummaryByTraversal = async (fileSystem, dirPath, userIdOrInfo, userType, options = {}) => {
  const maxItems = 20000;
  const maxMs = 5000;
  const startedAt = Date.now();

  let totalSize = 0;
  let latestModifiedMs = 0;
  let visited = 0;
  let completed = true;

  const queue = [normalizeDir(dirPath)];

  while (queue.length > 0) {
    if (Date.now() - startedAt > maxMs || visited >= maxItems) {
      completed = false;
      break;
    }

    const current = queue.shift();
    const res = await fileSystem.listDirectory(current, userIdOrInfo, userType, { refresh: !!options.refresh });
    const items = Array.isArray(res?.items) ? res.items : [];

    for (const item of items) {
      visited += 1;
      if (visited >= maxItems) {
        completed = false;
        break;
      }

      if (item?.isVirtual) {
        continue;
      }

      if (item?.isDirectory) {
        queue.push(normalizeDir(item.path));
        // 目錄自身 modified 若存在，也可參與“內容更新時間”的估算
        if (item.modified) {
          const ms = Date.parse(String(item.modified));
          if (Number.isFinite(ms) && ms > latestModifiedMs) latestModifiedMs = ms;
        }
        continue;
      }

      if (typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0) {
        totalSize += item.size;
      }
      if (item.modified) {
        const ms = Date.parse(String(item.modified));
        if (Number.isFinite(ms) && ms > latestModifiedMs) latestModifiedMs = ms;
      }
    }
  }

  return {
    size: totalSize,
    modified: latestModifiedMs > 0 ? new Date(latestModifiedMs).toISOString() : null,
    completed,
    calculatedAt: new Date().toISOString(),
  };
};

const enrichDirectoryListWithFolderSummaries = async ({ db, fileSystem, result, userIdOrInfo, userType, refresh }) => {
  if (!result || !Array.isArray(result.items) || result.items.length === 0) return;

  // 當前目錄列表通常只屬於一個 mount，這裡優先從 result.mount_id 取
  const mountIdRaw = result.mount_id ?? result.items.find((it) => it?.mount_id != null)?.mount_id ?? null;
  const mountId = mountIdRaw != null ? String(mountIdRaw) : "";
  if (!mountId) return;

  // 計算開關：交給“掛載配置”決定
  const mountRow = await db
    .prepare(
      "SELECT id, mount_path, storage_type, storage_config_id, cache_ttl, enable_folder_summary_compute FROM storage_mounts WHERE id = ?"
    )
    .bind(mountId)
    .first();
  const computeEnabled = !!mountRow?.enable_folder_summary_compute;
  const mountStorageType = mountRow?.storage_type ? String(mountRow.storage_type) : "";
  const mountPath = mountRow?.mount_path ? String(mountRow.mount_path) : "/";
  const folderSummaryCacheTtl =
    typeof mountRow?.cache_ttl === "number" && Number.isFinite(mountRow.cache_ttl) ? mountRow.cache_ttl : Number(mountRow?.cache_ttl || 0);

  // 索引狀態（用於決定“索引 vs 計算”的優先順序）
  const store = new FsSearchIndexStore(db);
  const states = await store.getIndexStates([mountId]);
  const state = states.get(mountId);
  const isIndexReady = state && String(state.status) === "ready";

  // 目標兜底來源（用於“允許從記憶體快取填充”的來源過濾）：
  // 新規則：儲存原生 > 計算 > 索引 > 未知
  // - 開啟計算：優先用 compute（即使索引 ready）
  // - 未開啟計算：若索引 ready 則用 index
  const desiredFallbackSource = computeEnabled ? "compute" : isIndexReady ? "index" : null;

  // refresh 只代表“本次不讀快取”，不做“提前清快取”
  if (!refresh) {
    // 1) 先用記憶體快取填充（但只允許填充“當前 desiredFallbackSource”的欄位）
    for (const item of result.items) {
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);
      const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
      if (!cached) continue;

      const cachedSizeSource = normalizeSummarySource(cached.size_source);
      const cachedModifiedSource = normalizeSummarySource(cached.modified_source);

      if (
        desiredFallbackSource &&
        !isValidSize(item.size) &&
        isValidSize(cached.size) &&
        cachedSizeSource === desiredFallbackSource
      ) {
        item.size = cached.size;
        item.size_source = desiredFallbackSource;
      }
      if (desiredFallbackSource && !item.modified && cached.modified && cachedModifiedSource === desiredFallbackSource) {
        item.modified = cached.modified;
        item.modified_source = desiredFallbackSource;
      }
    }
  }

  // 2) 可選計算（優先於索引）：允許遞迴遍歷（或 S3 批次）計算
  if (computeEnabled) {
    // 如果 driver 提供 computeDirectChildDirSummaries，就優先“批次計算當前目錄的直接子目錄摘要”
    // - S3 會用一次 ListObjects 掃描，避免 N 倍遞迴
    // - HuggingFace Datasets 用官方 treesize，避免遞迴遍歷
    // 非 refresh 時先用“compute 快取”填充，避免重複算；refresh 則跳過快取，強制走本次計算
    const childDirNameToPath = new Map();
    for (const item of result.items) {
      if (!item || !item.isDirectory || item.isVirtual) continue;
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);

      if (!refresh) {
        const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
        if (cached) {
          const cachedSizeSource = normalizeSummarySource(cached.size_source);
          const cachedModifiedSource = normalizeSummarySource(cached.modified_source);
          if (!isValidSize(item.size) && isValidSize(cached.size) && cachedSizeSource === "compute") {
            item.size = cached.size;
            item.size_source = "compute";
          }
          if (!item.modified && cached.modified && cachedModifiedSource === "compute") {
            item.modified = cached.modified;
            item.modified_source = "compute";
          }
        }
      }

      // 仍然缺失的，進入本次批次計算
      if (isFolderSummaryMissing(item)) {
        if (typeof item.name === "string" && item.name) {
          childDirNameToPath.set(item.name, item.path);
        }
      }
    }

    if (childDirNameToPath.size > 0) {
      // 獲取 driver
      const driver = await fileSystem.mountManager.getDriver(mountRow);
      const directoryOps = driver?.directoryOps || null;
      if (directoryOps && typeof directoryOps.computeDirectChildDirSummaries === "function") {
        // 計算當前目錄在掛載內的相對路徑（/ 或 /a/b/）
        const normalizedMountPath = normalizeFsPath(mountPath, true).replace(/\/+$/g, "") || "/";
        const normalizedDirPath = normalizeFsPath(result.path || "/", true);
        const relativeSubPath =
          normalizedMountPath === "/"
            ? normalizedDirPath
            : normalizedDirPath.startsWith(normalizedMountPath)
            ? normalizedDirPath.slice(normalizedMountPath.length) || "/"
            : normalizedDirPath;

        const { results: computedMap } = await computeDirectChildDirSummariesSingleflight(
          mountId,
          relativeSubPath,
          childDirNameToPath,
          directoryOps,
          userIdOrInfo,
          userType,
          { refresh }
        );

        for (const item of result.items) {
          if (!item || !item.isDirectory || item.isVirtual) continue;
          if (!isFolderSummaryMissing(item)) continue;
          const computed = computedMap.get(item.path);
          if (!computed) continue;

          const computedEntry = {
            ...computed,
            size_source: isValidSize(computed.size) ? "compute" : undefined,
            modified_source: computed.modified ? "compute" : undefined,
          };
          if (folderSummaryCacheTtl > 0) {
            fsFolderSummaryCacheManager.set(mountId, item.path, computedEntry, folderSummaryCacheTtl);
          }

          if (!isValidSize(item.size) && isValidSize(computed.size)) {
            item.size = computed.size;
            item.size_source = "compute";
          }
          if (!item.modified && computed.modified) {
            item.modified = computed.modified;
            item.modified_source = "compute";
          }
        }
      }
    }

    for (const item of result.items) {
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);
      if (!refresh) {
        const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
        if (cached) {
          const cachedSizeSource = normalizeSummarySource(cached.size_source);
          const cachedModifiedSource = normalizeSummarySource(cached.modified_source);
          if (!isValidSize(item.size) && isValidSize(cached.size) && cachedSizeSource === "compute") {
            item.size = cached.size;
            item.size_source = "compute";
          }
          if (!item.modified && cached.modified && cachedModifiedSource === "compute") {
            item.modified = cached.modified;
            item.modified_source = "compute";
          }
          continue;
        }
      }

      const computed = await computeFolderSummaryByTraversalSingleflight(mountId, item.path, fileSystem, userIdOrInfo, userType, { refresh });
      const computedEntry = {
        ...computed,
        size_source: isValidSize(computed.size) ? "compute" : undefined,
        modified_source: computed.modified ? "compute" : undefined,
      };
      if (folderSummaryCacheTtl > 0) {
        fsFolderSummaryCacheManager.set(mountId, item.path, computedEntry, folderSummaryCacheTtl);
      }

      if (!isValidSize(item.size) && isValidSize(computed.size)) {
        item.size = computed.size;
        item.size_source = "compute";
      }
      if (!item.modified && computed.modified) {
        item.modified = computed.modified;
        item.modified_source = "compute";
      }
    }
  }

  // 3) 索引兜底（僅當索引 ready）：用於 compute 未覆蓋/未完成時補齊
  const remainingDirs = result.items.filter((it) => isFolderSummaryMissing(it));
  if (remainingDirs.length === 0) return;

  if (isIndexReady) {
    const rows = await store.getChildDirectoryAggregates(mountId, result.path);
    const map = new Map();
    for (const row of rows) {
      const dirPath = row?.dir_path ? String(row.dir_path) : "";
      if (!dirPath) continue;
      map.set(dirPath, {
        size: typeof row.total_size === "number" ? row.total_size : Number(row.total_size || 0),
        modified: toIsoFromMs(row.latest_modified_ms),
      });
    }

    for (const item of remainingDirs) {
      if (!isFolderSummaryMissing(item)) continue;
      const summary = map.get(String(item.path));
      if (!summary) continue;
      ensureFolderSummarySources(item);

      const cacheEntry = {
        ...summary,
        size_source: isValidSize(summary.size) ? "index" : undefined,
        modified_source: summary.modified ? "index" : undefined,
      };
      if (folderSummaryCacheTtl > 0) {
        fsFolderSummaryCacheManager.set(mountId, item.path, cacheEntry, folderSummaryCacheTtl);
      }

      if (!isValidSize(item.size) && isValidSize(summary.size)) {
        item.size = summary.size;
        item.size_source = "index";
      }
      if (!item.modified && summary.modified) {
        item.modified = summary.modified;
        item.modified_source = "index";
      }
    }
  }

  // 兜底：如果依然缺失，把來源欄位補齊為 none（避免前端判斷不一致）
  for (const item of result.items) {
    ensureFolderSummarySources(item);
  }
};

const fnv1a32Init = () => 0x811c9dc5;

const fnv1a32Update = (hash, input) => {
  const str = typeof input === "string" ? input : String(input ?? "");
  let next = hash >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    next ^= str.charCodeAt(i);
    // 32-bit FNV-1a: next *= 16777619
    next = (next + ((next << 1) + (next << 4) + (next << 7) + (next << 8) + (next << 24))) >>> 0;
  }
  return next >>> 0;
};

const computeDirectoryListEtag = (result) => {
  // 如果目錄結果來自服務端快取，可能已攜帶上次計算出的 ETag（避免重複 O(n) 掃描）。
  if (result && typeof result.dirEtag === "string" && result.dirEtag.length > 0) {
    return result.dirEtag;
  }

  if (!result || !Array.isArray(result.items)) {
    return null;
  }

  const mountId = result.mount_id ?? "";
  const dirPath = result.path ?? "";

  // 強一致性優先：ETag 需要隨目錄條目變化而變化。
  // - 使用輕量 hash（FNV-1a 32）
  // - 參與欄位：path/isDirectory/size/modified/etag（若存在）
  // - 不依賴條目物件引用，確保跨快取一致
  let hash = fnv1a32Init();
  hash = fnv1a32Update(hash, mountId);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, dirPath);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, result.type ?? "");
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, String(result.items.length));

  for (const item of result.items) {
    hash = fnv1a32Update(hash, "|");
    hash = fnv1a32Update(hash, item?.path ?? "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.isDirectory ? "1" : "0");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, typeof item?.size === "number" ? String(item.size) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.modified ? String(item.modified) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.etag ? String(item.etag) : "");
  }

  const hex = (hash >>> 0).toString(16);
  // 弱 ETag：目錄列表是“派生檢視”，避免中間層對比語義過強
  return `W/"${mountId}:${hex}"`;
};

export const registerBrowseRoutes = (router, helpers) => {
  const { getAccessibleMounts, getServiceParams, verifyPathPasswordToken } = helpers;

  router.get("/api/fs/list", async (c) => {
    const db = c.env.DB;
    const rawPath = c.req.query("path") || "/";
    const path = normalizeFsPath(rawPath, true);
    const refresh = getQueryBool(c, "refresh", false);
    // 目錄分頁（可選）
    // - cursor：不透明字串，由後端/驅動定義（例如 HF tree 的 cursor）
    // - limit：每頁數量（正整數）
    // - paged：是否啟用分頁模式（即使 cursor=null 也只返回一頁）
    const pagedRaw = c.req.query("paged");
    const pagedProvided = pagedRaw !== undefined;
    const paged = getQueryBool(c, "paged", false);
    const cursorRaw = c.req.query("cursor");
    const cursor = typeof cursorRaw === "string" && cursorRaw.trim() ? cursorRaw.trim() : null;
    const limitRaw = c.req.query("limit");
    const parsedLimit = limitRaw != null && limitRaw !== "" ? Number.parseInt(String(limitRaw), 10) : null;
    const limit = parsedLimit != null && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
    // 除錯用：輸出快取命中日誌（預設關閉）
    // - 環境變數：DEBUG_DRIVER_CACHE=true/false
    // - 單次請求：debug_cache=true（query param）
    // - 預設 false：不列印，環境變數為 true：全域性列印
    // - debug_cache=true：僅本次請求列印（即使環境變數為 false）
    const debugDriverCacheEnv = MountManager.resolveDebugDriverCache({ env: c.env });
    const debugCacheQuery = getQueryBool(c, "debug_cache", false);
    const cacheTrace = debugDriverCacheEnv || debugCacheQuery;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (refresh) {
      console.log("[後端路由] 收到強制重新整理請求:", { path, refresh });
    }

    // 管理員不受路徑密碼限制；僅對非管理員使用者應用路徑密碼控制
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目錄路徑密碼已更新，請重新輸入"
                : "該目錄需要密碼訪問",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mounts = await getAccessibleMounts(db, userIdOrInfo, userType);

    if (isVirtualPath(path, mounts)) {
      const basicPath = userType === UserType.API_KEY ? userIdOrInfo.basicPath : null;
      const result = await getVirtualDirectoryListing(mounts, path, basicPath);

      const etag = computeDirectoryListEtag(result);
      if (etag) {
        const ifNoneMatch = c.req.header("if-none-match") || null;
        c.header("ETag", etag);
        c.header("Cache-Control", "private, no-cache");
        c.header("Vary", "Authorization, X-FS-Path-Token");

        if (!refresh && ifNoneMatch === etag) {
          return c.body(null, 304);
        }

        result.dirEtag = etag;
      }

      return jsonOk(c, result, "獲取目錄列表成功");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    // 目錄分頁預設策略：
    // - 如果客戶端顯式傳了 paged：按客戶端的來
    // - 如果客戶端沒傳 paged：讓 FS 層基於“驅動能力 + cursor/limit”自動決定是否按頁返回
    const result = await fileSystem.listDirectory(path, userIdOrInfo, userType, {
      refresh,
      cacheTrace,
      ...(pagedProvided ? { paged } : {}),
      autoPaged: !pagedProvided,
      cursor,
      limit,
    });

    await enrichDirectoryListWithFolderSummaries({
      db,
      fileSystem,
      result,
      userIdOrInfo,
      userType,
      refresh,
    });

    if (cacheTrace) {
      try {
        const items = Array.isArray(result?.items) ? result.items : [];
        const dirItems = items.filter((it) => it?.isDirectory && !it?.isVirtual);

        const countBy = (key) => {
          const map = new Map();
          for (const it of dirItems) {
            const v = it?.[key] ? String(it[key]) : "none";
            map.set(v, (map.get(v) || 0) + 1);
          }
          return Object.fromEntries(map.entries());
        };

        console.log("[FolderSummary] SOURCES", {
          mountId: result?.mount_id ?? null,
          path: result?.path ?? path,
          refresh,
          totalItems: items.length,
          dirs: dirItems.length,
          size_source: countBy("size_source"),
          modified_source: countBy("modified_source"),
        });
      } catch (error) {
        console.warn("[FolderSummary] SOURCES log failed", error);
      }
    }

    const etag = computeDirectoryListEtag(result);
    if (etag) {
      const ifNoneMatch = c.req.header("if-none-match") || null;
      c.header("ETag", etag);
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Authorization, X-FS-Path-Token");

      if (!refresh && ifNoneMatch === etag) {
        return c.body(null, 304);
      }

      result.dirEtag = etag;
    }

    return jsonOk(c, result, "獲取目錄列表成功");
  });

  router.get("/api/fs/get", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("請提供檔案路徑");
    }

    // 對受路徑密碼保護的檔案路徑應用與目錄列表相同的校驗邏輯
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目錄路徑密碼已更新，請重新輸入"
                : "該目錄需要密碼訪問",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);

    // 目錄不生成直鏈
    let previewLink = { url: null, kind: null };
    let downloadLink = { url: null, kind: null };
    if (!result?.isDirectory) {
      // 透過 LinkService 生成語義清晰的預覽/下載入口
      const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
      previewLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
        forceDownload: false,
        request: c.req.raw,
      });

      downloadLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
        forceDownload: true,
        request: c.req.raw,
      });
    }

    const previewUrl = previewLink?.url || null;
    const downloadUrl = downloadLink?.url || null;
    const linkType = previewLink?.kind || null;

    const responsePayload = {
      ...result,
      previewUrl,
      downloadUrl,
      linkType,
    };

    const previewSelection = result?.isDirectory
      ? null
      : await resolvePreviewSelection(
          {
            type: responsePayload.type,
            typeName: responsePayload.typeName,
            mimetype: responsePayload.mimetype,
            filename: responsePayload.name,
            name: responsePayload.name,
            size: responsePayload.size,
          },
          {
            previewUrl,
            downloadUrl,
            linkType,
            use_proxy: responsePayload.use_proxy ?? 0,
          },
        );

    return jsonOk(
      c,
      {
        ...responsePayload,
        previewSelection,
      },
      "獲取檔案資訊成功",
    );
  });

  //內部
  router.get("/api/fs/download", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("請提供檔案路徑");
    }

    // 下載路由與後設資料路由共享相同的路徑密碼校驗規則
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目錄路徑密碼已更新，請重新輸入"
                : "該目錄需要密碼訪問",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const fileInfo = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);
    if (fileInfo?.isDirectory) {
      throw new ValidationError("目錄不支援下載");
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: true,
      request: c.req.raw,
    });

    if (link.url) {
      // 無論直鏈還是代理 / Worker 入口，只要給出了 URL，一律透過 302 交給下游處理
      return c.redirect(link.url, 302);
    }

    // 未能生成任何 URL 時兜底：使用 StorageStreaming 層做服務端流式下載
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });
    return response;
  });

  /**
   * 檔案內容訪問介面（統一內容 API）
   * - 語義：返回指定 FS 路徑下檔案的原始內容，用於前端預覽、編碼檢測等場景
   * - 特點：始終由 CloudHarbor 後端代理訪問上游儲存，避免前端直接對第三方直鏈發起跨域請求
   * - 與 /api/fs/download 的區別：content 更偏“讀取內容”，download 更偏“觸發下載（可 302 直鏈）”
   */
  router.get("/api/fs/content", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("請提供檔案路徑");
    }

    // 路徑密碼校驗規則與 /list /get /download 保持一致
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目錄路徑密碼已更新，請重新輸入"
                : "該目錄需要密碼訪問",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });

    return response;
  });

  router.get("/api/fs/file-link", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const expiresInParam = c.req.query("expires_in");
    const parsedExpiresIn =
      expiresInParam === undefined || expiresInParam === "null" ? null : parseInt(expiresInParam, 10);
    const expiresIn = parsedExpiresIn !== null && Number.isNaN(parsedExpiresIn) ? null : parsedExpiresIn;
    const forceDownload = getQueryBool(c, "force_download", false);

    if (!path) {
      throw new ValidationError("請提供檔案路徑");
    }

    // 與目錄列表/檔案資訊/下載保持一致：對受路徑密碼保護的路徑進行校驗
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目錄路徑密碼已更新，請重新輸入"
                : "該目錄需要密碼訪問",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const fileInfo = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);
    if (fileInfo?.isDirectory) {
      throw new ValidationError("目錄不支援生成檔案直鏈");
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      expiresIn,
      forceDownload,
      request: c.req.raw,
    });

    const responsePayload = {
      url: link.url,
      linkType: link.kind,
    };

    return jsonOk(c, responsePayload, "獲取檔案直鏈成功");
  });
};
