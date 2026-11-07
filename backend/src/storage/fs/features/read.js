import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as featureGenerateFileLink } from "./presign.js";
import { normalizePath } from "../utils/PathResolver.js";
import { directoryCacheManager } from "../../../cache/index.js";

// 同一目錄同一時刻只允許一次真實 list（防止併發把儲存打爆）
// key = mountId:subPath:(refresh?1:0)
const inflightDirectoryList = new Map();

const cloneDirectoryResult = (result) => {
  if (!result || typeof result !== "object") return result;
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    ...result,
    items: items.map((item) => (item && typeof item === "object" ? { ...item } : item)),
  };
};

export async function listDirectory(fs, path, userIdOrInfo, userType, options = {}) {
  // 目錄列表介面的路徑語義：目錄路徑必須以 / 結尾（root 除外）。
  const dirPath = normalizePath(path, true);
  if (typeof path === "string" && path !== dirPath) {
    console.warn("[fs.listDirectory] 輸入路徑未按目錄格式(缺少尾部/)，已自動規範化:", { path, dirPath });
  }

  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(dirPath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援讀取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const refresh = !!options.refresh;
  const cacheTrace = !!options.cacheTrace;
  const cacheTtl = typeof mount?.cache_ttl === "number" && Number.isFinite(mount.cache_ttl) ? mount.cache_ttl : 0;
  const cacheEnabled = cacheTtl > 0 && !!mount?.id;

  const cacheSubPath = normalizePath(subPath || "/", true);
  // 目錄分頁支援
  // - cursor：不透明字串，由上游/驅動定義（例如 HF tree 的 cursor）
  // - limit：每頁數量（用於驅動按頁返回，而不是一次性全量返回）
  // - autoPaged：僅用於“/api/fs/list 這種 UI 列目錄”，允許後端根據驅動能力自動切到分頁（內部遞迴遍歷等不要自動分頁）
  const autoPaged = options?.autoPaged === true;
  const pagedOpt = options?.paged;
  const pagedProvided = pagedOpt === true || pagedOpt === false;
  let paged = pagedOpt === true;
  const pageCursor = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
  const pageLimitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
  const pageLimit = pageLimitRaw != null && Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? Math.floor(pageLimitRaw) : null;
  if (!pagedProvided && autoPaged) {
    // 客戶端沒明確說 paged（未傳），但這是 UI 列目錄：允許自動決定
    // - 如果傳了 cursor/limit：必然是分頁請求
    // - 否則：看驅動有沒有宣告 PAGED_LIST 能力
    if (pageCursor || pageLimit != null) {
      paged = true;
    } else if (typeof driver?.hasCapability === "function" && driver.hasCapability(CAPABILITIES.PAGED_LIST)) {
      paged = true;
    }
  }
  const isPagedRequest = paged || !!pageCursor || pageLimit != null;

  const inflightKey = `${mount?.id}:${cacheSubPath}:${refresh ? "1" : "0"}:${isPagedRequest ? "paged" : "full"}:${paged ? "1" : "0"}:${pageCursor || ""}:${pageLimit || ""}`;

  // 1) 不 refresh：先讀快取
  if (cacheEnabled && !refresh && !isPagedRequest) {
    const cached = directoryCacheManager.get(mount.id, cacheSubPath);
    if (cached && Array.isArray(cached.items)) {
      if (cacheTrace) {
        console.log("[DirectoryCache] HIT", {
          mountId: mount?.id,
          path: dirPath,
          subPath: cacheSubPath,
          ttl: cacheTtl,
          items: cached.items.length,
        });
      }
      return cloneDirectoryResult(cached);
    }
    if (cacheTrace) {
      console.log("[DirectoryCache] MISS", { mountId: mount?.id, path: dirPath, subPath: cacheSubPath, ttl: cacheTtl });
    }
  } else if (cacheTrace) {
    console.log("[DirectoryCache] BYPASS", {
      mountId: mount?.id,
      path: dirPath,
      subPath: cacheSubPath,
      ttl: cacheTtl,
      reason: refresh ? "refresh=true" : isPagedRequest ? "paged_request" : "cache_disabled",
    });
  }

  // 2) singleflight 去重：同目錄併發只打一次儲存
  if (inflightDirectoryList.has(inflightKey)) {
    if (cacheTrace) {
      console.log("[DirectoryCache] INFLIGHT", { mountId: mount?.id, path: dirPath, subPath: cacheSubPath, refresh });
    }
    return await inflightDirectoryList.get(inflightKey);
  }

  const fetchPromise = (async () => {
    const startedAt = Date.now();
    const result = await driver.listDirectory(cacheSubPath, {
      path: dirPath,
      mount,
      subPath: cacheSubPath,
      db: fs.mountManager.db,
      ...options,
      cursor: pageCursor,
      limit: pageLimit,
      userIdOrInfo,
      userType,
      // refresh 只負責“本次請求繞過快取”，不做“提前清快取”
      refresh,
    });

    // 3) list 完成後更新快取（refresh 也會寫回快取）
    if (cacheEnabled && !isPagedRequest) {
      const items = Array.isArray(result?.items) ? result.items : [];
      if (items.length > 0) {
        directoryCacheManager.set(mount.id, cacheSubPath, cloneDirectoryResult(result), cacheTtl);
      } else {
        // 空目錄：不快取空陣列，並遞迴清掉該目錄子樹快取，避免“幽靈目錄/幽靈檔案”殘留
        directoryCacheManager.invalidatePathTree(mount.id, cacheSubPath);
      }
    }

    if (cacheTrace) {
      const durationMs = Date.now() - startedAt;
      const items = Array.isArray(result?.items) ? result.items : [];
      console.log("[DirectoryCache] FETCHED", {
        mountId: mount?.id,
        path: dirPath,
        subPath: cacheSubPath,
        refresh,
        cacheEnabled,
        ttl: cacheTtl,
        items: items.length,
        durationMs,
      });
    }

    // 返回值也統一 clone，避免：
    // - 多個併發請求共享同一個 result 引用而互相汙染
    // - 上層 enrich/排序直接修改到快取物件
    return cloneDirectoryResult(result);
  })()
    .finally(() => {
      inflightDirectoryList.delete(inflightKey);
    });

  inflightDirectoryList.set(inflightKey, fetchPromise);
  return await fetchPromise;
}

export async function getFileInfo(fs, path, userIdOrInfo, userType, request = null) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援讀取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // 先獲取基礎檔案資訊（不關心其中是否包含任何 legacy 連結欄位）
  const baseInfo = await driver.getFileInfo(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    request,
  });

  return {
    ...baseInfo,
  };
}

export async function downloadFile(fs, path, fileName, request, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援讀取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.downloadFile(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    request,
    userIdOrInfo,
    userType,
  });
}

export async function exists(fs, path, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);
  return await driver.exists(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });
}
