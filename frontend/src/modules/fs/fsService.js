import { api } from "@/api";
import { useAuthStore } from "@/stores/authStore.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { useExplorerSettings } from "@/composables/useExplorerSettings.js";
import { createLogger } from "@/utils/logger.js";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

/**
 * FS 服務封裝
 *
 * - 基於 api.fs 提供的底層介面做統一封裝
 * - 統一目錄/檔案資訊/批次刪除/複製/預簽名連結等能力
 * - 支援請求取消（AbortController）以最佳化導航體驗
 *
 * 使用場景
 * - UI 側透過 DOM 操作建立 <a> 元素觸發下載或預覽
 */
export function useFsService() {
  const authStore = useAuthStore();
  const pathPassword = usePathPassword();
  const explorerSettings = useExplorerSettings();
  const log = createLogger("FsService");

  // 目錄列表條件請求快取（強一致性路線：依賴後端 ETag；前端僅做“可驗證快取”）
  const DIRECTORY_LIST_CACHE_LIMIT = 50;
  /** @type {Map<string, { etag: string, data: FsDirectoryResponse }>} */
  const directoryListCache = new Map();
  const setDirectoryListCache = (key, value) => {
    directoryListCache.set(key, value);
    if (directoryListCache.size <= DIRECTORY_LIST_CACHE_LIMIT) return;
    const firstKey = directoryListCache.keys().next().value;
    if (firstKey) {
      directoryListCache.delete(firstKey);
    }
  };

  // 請求取消控制器管理
  /** @type {{ directory: AbortController | null, fileInfo: AbortController | null }} */
  const abortControllers = {
    directory: null,
    fileInfo: null,
  };

  /**
   * 取消目錄列表請求
   * 在發起新請求前呼叫，避免舊請求的響應覆蓋新資料
   */
  const cancelDirectoryRequest = () => {
    if (abortControllers.directory) {
      abortControllers.directory.abort();
      abortControllers.directory = null;
    }
  };

  /**
   * 取消檔案資訊請求
   * 在發起新請求前呼叫，避免舊請求的響應覆蓋新資料
   */
  const cancelFileInfoRequest = () => {
    if (abortControllers.fileInfo) {
      abortControllers.fileInfo.abort();
      abortControllers.fileInfo = null;
    }
  };

  /**
   * 取消所有進行中的請求
   * 用於路由切換、元件解除安裝等場景
   */
  const cancelAllRequests = () => {
    cancelDirectoryRequest();
    cancelFileInfoRequest();
  };

  const normalizeDirApiPath = (path) => {
    const raw = typeof path === "string" && path ? path : "/";
    const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
    const collapsed = withLeading.replace(/\/{2,}/g, "/");
    if (collapsed === "/") return "/";
    return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  };

  const clearDirectoryListCache = () => {
    directoryListCache.clear();
  };

  /**
   * 獲取目錄列表
   * @param {string} path
   * @param {{ refresh?: boolean, cursor?: (string|null), limit?: (number|null), paged?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse>}
   */
  const getDirectoryList = async (path, options = {}) => {
    const normalizedPath = normalizeDirApiPath(path || "/");
    const isAdmin = authStore.isAdmin;
    const cursor = options && options.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
    const limitRaw = options && options.limit != null && options.limit !== "" ? Number(options.limit) : null;
    const limit = limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;
    const paged = options && options.paged === true;

    // 取消之前的目錄請求，避免競態條件
    cancelDirectoryRequest();

    // 建立新的 AbortController
    const controller = new AbortController();
    abortControllers.directory = controller;

    /** @type {{ refresh?: boolean; cursor?: (string|null); limit?: (number|null); paged?: boolean; headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      refresh: options.refresh,
      cursor,
      limit,
      paged,
      signal: controller.signal,
    };

    // 分頁請求的 cache key 必須包含 cursor/limit/paged
    const cacheKey = `${normalizedPath}|cursor=${cursor || ""}|limit=${limit || ""}|paged=${paged ? "1" : "0"}`;

    const cached = directoryListCache.get(cacheKey) || null;
    // 只有“首頁”才值得走 If-None-Match：分頁頁的 304 對後端沒意義（後端仍要打上游才能算 ETag）
    const shouldUseConditional = !options.refresh && !cursor && !!cached?.etag;

    // 非管理員訪問時，如果已有 token，則附帶在請求頭中
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          ...(requestOptions.headers || {}),
          "X-FS-Path-Token": token,
        };
      }
    }

    if (shouldUseConditional) {
      requestOptions.headers = {
        ...(requestOptions.headers || {}),
        "If-None-Match": cached.etag,
      };
    }

    try {
      const response = await api.fs.getDirectoryList(normalizedPath, requestOptions);
      if (response?.notModified) {
        if (cached?.data) {
          return cached.data;
        }
        // 理論上不會發生：只有命中快取才會發 If-None-Match
        throw new Error("目錄快取缺失（304 Not Modified 但本地無可用快取）");
      }
      if (!response?.success) {
        throw new Error(response?.message || "獲取目錄列表失敗");
      }

      const data = /** @type {FsDirectoryResponse} */ (response.data);
      const etag = typeof data?.dirEtag === "string" && data.dirEtag ? data.dirEtag : null;
      if (etag && data) {
        setDirectoryListCache(cacheKey, { etag, data });
      }
      return data;
    } catch (error) {
      // 請求被取消時，靜默處理，不丟擲錯誤
      if (error.name === "AbortError") {
        return null;
      }

      // 目錄路徑密碼缺失或失效：觸發前端密碼驗證流程
      if (!isAdmin && error && error.code === "FS_PATH_PASSWORD_REQUIRED") {
        log.warn("目錄需要路徑密碼，觸發密碼驗證流程:", { path: normalizedPath, error });
        // 舊 token 失效，清除後重新走驗證
        pathPassword.removePathToken(normalizedPath);
        pathPassword.setPendingPath(normalizedPath);
        pathPassword.openPasswordDialog();

        const friendlyError = new Error(error.message || "目錄需要密碼訪問");
        friendlyError.code = "FS_PATH_PASSWORD_REQUIRED";
        friendlyError.__logged = true;
        throw friendlyError;
      }

      throw error;
    } finally {
      // 清理 controller 引用
      if (abortControllers.directory === controller) {
        abortControllers.directory = null;
      }
    }
  };

  /**
   * 獲取單個檔案資訊
   * @param {string} path
   * @param {{ headers?: Record<string,string>; signal?: AbortSignal; cancelPrevious?: boolean }} [options]
   * - cancelPrevious=true：保持舊行為（新的請求會取消上一條 fileInfo 請求），適合“單檔案預覽/詳情面板”
   * - cancelPrevious=false：允許併發請求，適合“圖廊懶載入/批次預取”
   * @returns {Promise<FsDirectoryItem|null>}
   */
  const getFileInfo = async (path, options = {}) => {
    const isAdmin = authStore.isAdmin;
    const normalizedPath = path || "/";

    // 建立新的 AbortController
    const controller = new AbortController();
    const shouldCancelPrevious = options.cancelPrevious !== false;
    if (shouldCancelPrevious) {
      cancelFileInfoRequest();
      abortControllers.fileInfo = controller;
    }

    /** @type {{ headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      signal: options.signal || controller.signal,
    };

    // 非管理員訪問時，為檔案路徑附加路徑密碼 token（如果存在）
    if (!isAdmin) {
      const token = pathPassword.getPathToken(path);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    // 允許呼叫方追加 headers（如自定義 token/trace 等）
    if (options.headers) {
      requestOptions.headers = {
        ...(requestOptions.headers || {}),
        ...options.headers,
      };
    }

    try {
      const response = await api.fs.getFileInfo(path, requestOptions);
      if (!response?.success) {
        throw new Error(response?.message || "獲取檔案資訊失敗");
      }
      return /** @type {FsDirectoryItem} */ (response.data);
    } catch (error) {
      // 請求被取消時，靜默處理，不丟擲錯誤
      if (error.name === "AbortError") {
        return null;
      }

      // 檔案路徑也可能受“路徑密碼”保護：沿用目錄列表的互動，觸發密碼彈窗
      if (!isAdmin && error && error.code === "FS_PATH_PASSWORD_REQUIRED") {
        // 檔案的密碼域通常屬於其父目錄，統一按父目錄觸發驗證
        const parentDir =
          normalizedPath && normalizedPath !== "/" ? `${normalizedPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/")}/` : "/";
        const ownerPath = parentDir.startsWith("/") ? parentDir : `/${parentDir}`;

        log.warn("檔案需要路徑密碼，觸發密碼驗證流程:", { path: normalizedPath, ownerPath, error });

        // 舊 token 失效，清除後重新走驗證
        pathPassword.removePathToken(ownerPath);
        pathPassword.setPendingPath(ownerPath);
        pathPassword.openPasswordDialog();

        const friendlyError = new Error(error.message || "目錄需要密碼訪問");
        friendlyError.code = "FS_PATH_PASSWORD_REQUIRED";
        friendlyError.__logged = true;
        throw friendlyError;
      }

      throw error;
    } finally {
      // 清理 controller 引用
      if (abortControllers.fileInfo === controller) {
        abortControllers.fileInfo = null;
      }
    }
  };

  /**
   * 預熱目錄列表（不取消當前目錄請求）
   * - 用於麵包屑 hover 等場景
   * - 不寫入內部 abortControllers.directory，避免影響主導航
   * @param {string} path
   * @param {{ refresh?: boolean; returnNullOnNotModified?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse|null>}
   */
  const prefetchDirectoryList = async (path, options = {}) => {
    const normalizedPath = normalizeDirApiPath(path || "/");
    const isAdmin = authStore.isAdmin;

    const controller = new AbortController();

    /** @type {{ refresh?: boolean; headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      refresh: options.refresh ?? false,
      signal: controller.signal,
    };

    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    try {
      // prefetch 只用於“首頁”，因此 key 固定為 cursor/limit/paged 都為空
      const baseKey = `${normalizedPath}|cursor=|limit=|paged=0`;
      const cached = directoryListCache.get(baseKey) || null;
      if (!options.refresh && cached?.etag) {
        requestOptions.headers = {
          ...(requestOptions.headers || {}),
          "If-None-Match": cached.etag,
        };
      }

      const response = await api.fs.getDirectoryList(normalizedPath, requestOptions);
      if (response?.notModified) {
        // 某些呼叫方（如後臺無感 revalidate）不希望在 304 時回寫 data（避免重複賦值引發微小閃爍）
        if (options.returnNullOnNotModified) {
          return null;
        }
        return cached?.data || null;
      }
      if (!response?.success) {
        throw new Error(response?.message || "獲取目錄列表失敗");
      }
      const data = /** @type {FsDirectoryResponse} */ (response.data);
      const etag = typeof data?.dirEtag === "string" && data.dirEtag ? data.dirEtag : null;
      if (etag && data) {
        setDirectoryListCache(baseKey, { etag, data });
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      }
      return null;
    }
  };

  /**
   * 重新命名檔案/目錄
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {Promise<true>}
   */
  const renameItem = async (oldPath, newPath) => {
    const response = await api.fs.renameItem(oldPath, newPath);
    if (!response?.success) {
      throw new Error(response?.message || "重新命名失敗");
    }
    return true;
  };

  /**
   * 建立目錄
   * @param {string} fullPath
   * @returns {Promise<true>}
   */
  const createDirectory = async (fullPath) => {
    const response = await api.fs.createDirectory(fullPath);
    if (!response?.success) {
      throw new Error(response?.message || "建立目錄失敗");
    }
    return true;
  };

  /**
   * 批次刪除
   * @param {string[]} paths
   * @returns {Promise<{ success: true; raw: any }>}
   */
  const batchDeleteItems = async (paths) => {
    const response = await api.fs.batchDeleteItems(paths);
    const payload = response && typeof response === "object" && "data" in response ? response.data : response;

    if (payload && Array.isArray(payload.failed) && payload.failed.length > 0) {
      throw new Error(payload.failed[0].error || "批次刪除失敗");
    }

    return {
      success: true,
      raw: payload,
    };
  };

  /**
   * 批次複製檔案/目錄
   * @param {Array<{sourcePath:string,targetPath:string}>} items
   * @param {Object} [options]
   * @param {boolean} [options.skipExisting=true] 是否跳過已存在的檔案
   * @returns {Promise<Object>} 原始複製結果，由後端定義結構
   */
  const batchCopyItems = async (items, options = {}) => {
    return api.fs.batchCopyItems(items, options);
  };

  /**
   * 獲取檔案預簽名訪問連結
   * @param {string} path
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<string>}
   */
  const getFileLink = async (path, expiresIn = null, forceDownload = true) => {
    const isAdmin = authStore.isAdmin;
    const normalizedPath = path || "/";

    /** @type {{ headers?: Record<string,string> }} */
    const requestOptions = {};

    // 非管理員訪問時，附帶路徑密碼 token（如果存在）
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    const url = await api.fs.getFileLink(normalizedPath, expiresIn, forceDownload, requestOptions);
    if (!url) {
      throw new Error("獲取檔案直鏈失敗");
    }
    return url;
  };

  /**
   * 下載檔案（透過獲取直鏈並讓瀏覽器直接導航）
   * @param {string} path
   * @param {string} filename
   * @returns {Promise<void>}
   */
  const downloadFile = async (path, filename) => {
    const normalizedPath = path || "/";
    const url = await getFileLink(normalizedPath, null, true);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * 建立通用作業（支援多種任務型別）
   * @param {string} taskType 任務型別（'copy', 'scheduled-sync', 'cleanup' 等）
   * @param {Object} payload 任務載荷
   * @param {Object} [options] 選項引數
   * @returns {Promise<Object>} 作業描述符
   */
  const createJob = async (taskType, payload, options = {}) => {
    return api.fs.createJob(taskType, payload, options);
  };

  /**
   * 獲取作業狀態
   * @param {string} jobId 作業ID
   * @returns {Promise<Object>} 作業狀態資訊
   */
  const getJobStatus = async (jobId) => {
    return api.fs.getJobStatus(jobId);
  };

  /**
   * 取消作業
   * @param {string} jobId 作業ID
   * @returns {Promise<Object>} 取消操作結果
   */
  const cancelJob = async (jobId) => {
    return api.fs.cancelJob(jobId);
  };

  /**
   * 列出作業
   * @param {Object} [filter] 過濾條件
   * @returns {Promise<Object>} 作業列表
   */
  const listJobs = async (filter = {}) => {
    return api.fs.listJobs(filter);
  };

  /**
   * 刪除作業
   * @param {string} jobId 作業ID
   * @returns {Promise<Object>} 刪除結果
   */
  const deleteJob = async (jobId) => {
    return api.fs.deleteJob(jobId);
  };

  return {
    getDirectoryList,
    getFileInfo,
    prefetchDirectoryList,
    clearDirectoryListCache,
    renameItem,
    createDirectory,
    batchDeleteItems,
    batchCopyItems,
    getFileLink,
    downloadFile,
    createJob,
    getJobStatus,
    cancelJob,
    listJobs,
    deleteJob,
    cancelDirectoryRequest,
    cancelFileInfoRequest,
    cancelAllRequests,
  };
}
