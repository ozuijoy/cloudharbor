/**
 * 檔案系統服務API
 */

import { get, post, del } from "../client";
// Legacy StorageMultipartUploader removed. Multipart flows are handled by Uppy AwsS3 plugin or driver engine.

/******************************************************************************
 * 統一檔案系統API函式
 ******************************************************************************/

/**
 * 獲取目錄列表
 * @param {string} path 請求路徑
 * @param {Object} options 選項引數
 * @param {boolean} options.refresh 是否強制重新整理，跳過快取
 * @param {AbortSignal} options.signal 用於取消請求的 AbortSignal
 * @returns {Promise<Object>} 目錄列表響應物件
 */
export async function getDirectoryList(path, options = {}) {
  const params = { path };
  if (options.refresh) {
    params.refresh = "true";
  }
  if (options.cursor) {
    params.cursor = String(options.cursor);
  }
  if (options.limit) {
    params.limit = String(options.limit);
  }
  // 允許前端顯式指定是否啟用分頁模式
  if (options.paged) {
    params.paged = "true";
  }
  const requestOptions = { params };
  if (options.headers) {
    requestOptions.headers = options.headers;
  }
  // 支援請求取消
  if (options.signal) {
    requestOptions.signal = options.signal;
  }
  return get("/fs/list", requestOptions);
}

/**
 * 獲取檔案資訊
 * @param {string} path 檔案路徑
 * @param {{ headers?: Record<string,string>, signal?: AbortSignal }} [options] 可選請求配置（如路徑密碼token、取消訊號等）
 * @returns {Promise<Object>} 檔案資訊響應物件
 */
export async function getFileInfo(path, options = {}) {
  /** @type {{ params: Record<string,string>, headers?: Record<string,string>, signal?: AbortSignal }} */
  const requestOptions = {
    params: { path },
  };
  if (options.headers) {
    requestOptions.headers = options.headers;
  }
  // 支援請求取消
  if (options.signal) {
    requestOptions.signal = options.signal;
  }
  return get("/fs/get", requestOptions);
}

/**
 * 搜尋檔案
 * @param {string} query 搜尋查詢字串
 * @param {Object} searchParams 搜尋引數物件
 * @param {string} searchParams.scope 搜尋範圍 ('global', 'mount', 'directory')
 * @param {string} searchParams.mountId 掛載點ID（當scope為'mount'時）
 * @param {string} searchParams.path 搜尋路徑（當scope為'directory'時）
 * @param {number} searchParams.limit 結果限制數量，預設50
 * @param {string|null} searchParams.cursor 分頁遊標（不透明字串），預設null
 * @param {string} searchParams.pathToken 路徑密碼 token（可選）
 * @param {string[]} searchParams.pathTokens 路徑密碼 token 列表（可選）
 * @returns {Promise<Object>} 搜尋結果響應物件
 */
export async function searchFiles(query, searchParams = {}) {
  const params = {
    q: query,
    scope: searchParams.scope || "global",
    limit: (searchParams.limit || 50).toString(),
  };

  // 新增可選引數
  if (searchParams.mountId) {
    params.mount_id = searchParams.mountId;
  }
  if (searchParams.path) {
    params.path = searchParams.path;
  }
  if (searchParams.cursor) {
    params.cursor = String(searchParams.cursor);
  }

  const headers = {};
  if (searchParams.pathToken) {
    headers["x-fs-path-token"] = searchParams.pathToken;
  }
  if (Array.isArray(searchParams.pathTokens) && searchParams.pathTokens.length > 0) {
    headers["x-fs-path-tokens"] = searchParams.pathTokens.join(",");
  }

  const requestOptions = { params };
  if (Object.keys(headers).length > 0) {
    requestOptions.headers = headers;
  }

  return get("/fs/search", requestOptions);
}

/**
 * 建立目錄
 * @param {string} path 目錄路徑
 * @returns {Promise<Object>} 建立結果響應物件
 */
export async function createDirectory(path) {
  return post(`/fs/mkdir`, { path });
}

/**
 * 上傳檔案（透過 /fs/upload，後端根據儲存驅動自適應選擇流式/表單實現）
 * @param {string} path 目標路徑
 * @param {File} file 檔案物件
 * @param {Function} onXhrCreated XHR建立後的回撥，用於儲存引用以便取消請求
 * @returns {Promise<Object>} 上傳結果響應物件
 */
export async function uploadFile(path, file, onXhrCreated) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  return post(`/fs/upload`, formData, { onXhrCreated });
}

/**
 * 批次刪除檔案或目錄（統一刪除介面）
 * 支援單個路徑或路徑陣列，檔案直接刪除，目錄遞迴刪除
 * @param {string|Array<string>} pathsOrPath 檔案路徑或路徑陣列
 * @returns {Promise<Object>} 刪除結果響應物件
 */
export async function batchDeleteItems(pathsOrPath) {
  // 統一處理單個路徑和路徑陣列
  const paths = Array.isArray(pathsOrPath) ? pathsOrPath : [pathsOrPath];

  // 統一使用批次刪除介面，DELETE 方法帶請求體
  return del(`/fs/batch-remove`, { paths });
}

/**
 * 重新命名檔案或目錄
 * @param {string} oldPath 舊路徑
 * @param {string} newPath 新路徑
 * @returns {Promise<Object>} 重新命名結果響應物件
 */
export async function renameItem(oldPath, newPath) {
  return post(`/fs/rename`, { oldPath, newPath });
}

/**
 * 更新檔案內容
 * @param {string} path 檔案路徑
 * @param {string} content 新的檔案內容
 * @returns {Promise<Object>} 更新結果響應物件
 */
export async function updateFile(path, content) {
  return post(`/fs/update`, { path, content });
}

/**
 * 獲取檔案直鏈
 * @param {string} path 檔案路徑
 * @param {number|null} expiresIn 過期時間（秒），null表示使用儲存配置的預設簽名時間
 * @param {boolean} forceDownload 是否強制下載而非預覽
 * @param {{ headers?: Record<string,string> }} [options] 可選請求配置（例如路徑密碼 token）
 * @returns {Promise<string>} 預簽名訪問 URL（可能是直鏈或代理 URL）
 */
export async function getFileLink(path, expiresIn = null, forceDownload = false, options = {}) {
  const params = {
    path: path,
    force_download: forceDownload.toString(),
  };

  // 只有當expiresIn不為null時才新增expires_in引數
  if (expiresIn !== null) {
    params.expires_in = expiresIn.toString();
  }

  /** @type {{ params: Record<string,string>, headers?: Record<string,string> }} */
  const requestOptions = { params };
  if (options.headers) {
    requestOptions.headers = options.headers;
  }

  const resp = await get("/fs/file-link", requestOptions);
  if (!resp || resp.success === false) {
    throw new Error(resp?.message || "獲取檔案直鏈失敗");
  }
  const url = resp?.data?.url;
  if (!url) {
    throw new Error(resp?.message || "獲取檔案直鏈失敗");
  }
  return url;
}

/**
 * 校驗目錄路徑密碼
 * @param {string} path 目標路徑
 * @param {string} password 明文密碼
 * @returns {Promise<{ success: boolean; requiresPassword: boolean; verified: boolean; token?: string | null; path?: string }>}
 */
export async function verifyPathPassword(path, password) {
  const response = await post("/fs/meta/password/verify", { path, password });
  if (response && typeof response === "object" && "data" in response) {
    return /** @type {{ verified: boolean; requiresPassword: boolean; token?: string | null; path?: string }} */ (
      response.data
    );
  }
  return response;
}

/******************************************************************************
 * 分片上傳相關API函式
 ******************************************************************************/

/**
 * 初始化前端分片上傳（生成預簽名URL列表）
 * @param {string} path 目標路徑
 * @param {string} fileName 檔名
 * @param {number} fileSize 檔案大小
 * @param {string} contentType 檔案型別（可選，後端會推斷）
 * @param {number} partSize 分片大小（預設5MB）
 * @returns {Promise<Object>} 初始化結果響應物件
 */
export async function initMultipartUpload(path, fileName, fileSize, contentType, partSize = 5 * 1024 * 1024, extra = {}) {
  const partCount = Math.ceil(fileSize / partSize);

  const sha256 = extra?.sha256 || extra?.oid || null;

  return post(`/fs/multipart/init`, {
    path,
    fileName,
    fileSize,
    partSize,
    partCount,
    ...(contentType ? { contentType } : {}),
    ...(sha256 ? { sha256 } : {}),
  });
}

/**
 * 完成前端分片上傳
 * @param {string} path 檔案路徑
 * @param {string} uploadId 上傳ID
 * @param {Array<{partNumber: number, etag: string}>} parts 所有已上傳分片的資訊
 * @param {string} fileName 檔名
 * @param {number} fileSize 檔案大小（位元組）
 * @returns {Promise<Object>} 完成上傳結果響應物件
 */
export async function completeMultipartUpload(path, uploadId, parts, fileName, fileSize) {
  return post(`/fs/multipart/complete`, {
    path,
    uploadId,
    parts,
    fileName,
    fileSize,
  });
}

/**
 * 中止前端分片上傳
 * @param {string} path 檔案路徑
 * @param {string} uploadId 上傳ID
 * @param {string} fileName 檔名
 * @returns {Promise<Object>} 中止上傳結果響應物件
 */
export async function abortMultipartUpload(path, uploadId, fileName) {
  return post(`/fs/multipart/abort`, { path, uploadId, fileName });
}

//============斷點續傳================

/**
 * 列出進行中的分片上傳
 * @param {string} path 目標路徑（可選，用於過濾特定檔案的上傳）
 * @returns {Promise<Object>} 進行中的上傳列表響應物件
 */
export async function listMultipartUploads(path = "") {
  return post(`/fs/multipart/list-uploads`, { path });
}

/**
 * 列出已上傳的分片
 * @param {string} path 檔案路徑
 * @param {string} uploadId 上傳ID
 * @param {string} fileName 檔名
 * @returns {Promise<Object>} 已上傳的分片列表響應物件
 */
export async function listMultipartParts(path, uploadId, fileName) {
  return post(`/fs/multipart/list-parts`, { path, uploadId, fileName });
}

/**
 * 獲取/重新整理分片上傳引數（統一入口）
 * @param {string} path 檔案路徑
 * @param {string} uploadId 現有的上傳ID
 * @param {Array} partNumbers 需要簽名的分片編號陣列：
 * @returns {Promise<Object>} 分片上傳引數響應物件
 */
export async function signMultipartParts(path, uploadId, partNumbers) {
  return post(`/fs/multipart/sign-parts`, { path, uploadId, partNumbers });
}

/******************************************************************************
 * 預簽名URL上傳相關API函式
 ******************************************************************************/

/**
 * 獲取預簽名上傳URL
 * @param {string} path 目標路徑
 * @param {string} fileName 檔名
 * @param {string} contentType 檔案型別
 * @param {number} fileSize 檔案大小
 * @param {string} [sha256] 檔案 SHA-256（hex）。
 * @returns {Promise<Object>} 預簽名URL響應物件
 */
export async function getPresignedUploadUrl(path, fileName, contentType, fileSize, sha256 = null) {
  return post(`/fs/presign`, {
    path,
    fileName,
    contentType,
    fileSize,
    sha256,
  });
}

/**
 * 提交預簽名URL上傳完成
 * @param {Object} uploadInfo 上傳資訊物件
 * @param {string} etag ETag
 * @param {string} contentType 檔案MIME型別
 * @param {number} fileSize 檔案大小
 * @returns {Promise<Object>} 提交結果響應物件
 */
export async function commitPresignedUpload(uploadInfo, etag, contentType, fileSize) {
  return post(`/fs/presign/commit`, {
    ...uploadInfo,
    etag,
    contentType,
    fileSize,
  });
}

/******************************************************************************
 * 複製相關API函式
 ******************************************************************************/

/**
 * 批次複製檔案或目錄（統一任務模式）
 *
 * 所有複製操作統一建立任務，由後端 CopyTaskHandler 負責執行。
 * 複製策略（同儲存/跨儲存/S3最佳化）由後端內部決策。
 *
 * @param {Array<{sourcePath: string, targetPath: string}>} items 要複製的專案陣列，每項包含源路徑和目標路徑
 * @param {Object} options 選項引數
 * @param {boolean} [options.skipExisting=true] 是否跳過已存在的檔案
 * @returns {Promise<Object>} 批次複製結果響應物件 { success, data: { jobId, taskType, status, stats, createdAt } }
 */
export async function batchCopyItems(items, options = {}) {
  // 複製策略由後端 CopyTaskHandler 內部決策
  return createJob("copy", { items, options });
}

/**
 * 從檔案系統建立分享連結
 * @param {string} path 檔案路徑
 * @returns {Promise<Object>} 建立結果響應物件
 */
export async function createShareFromFileSystem(path) {
  return post(`/fs/create-share`, { path });
}

/******************************************************************************
 * 輔助上傳功能API函式
 ******************************************************************************/

/**
 * 使用預簽名URL上傳檔案
 * @param {string} url 預簽名URL
 * @param {File|Blob|ArrayBuffer} data 要上傳的資料
 * @param {string} contentType 檔案MIME型別
 * @param {Function} onProgress 進度回撥函式
 * @param {Function} onCancel 取消檢查函式
 * @param {Function} setXhr 設定XHR引用的函式
 * @returns {Promise<Object>} 上傳結果，包含etag和size
 */
export async function uploadWithPresignedUrl(url, data, contentType, onProgress, onCancel, setXhr) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (setXhr) {
      setXhr(xhr);
    }

    // 設定進度監聽
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress, event.loaded, event.total);
        }
      });
    }

    xhr.onload = function () {
      if (cancelChecker) {
        clearTimeout(cancelChecker);
      }

      if (xhr.status === 200) {
        const etag = xhr.getResponseHeader("ETag");
        resolve({
          etag: etag ? etag.replace(/"/g, "") : null,
          size: data.size || data.byteLength || 0,
        });
      } else {
        reject(new Error(`上傳失敗: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = function () {
      if (cancelChecker) {
        clearTimeout(cancelChecker);
      }
      reject(new Error("上傳過程中發生網路錯誤"));
    };

    xhr.onabort = function () {
      if (cancelChecker) {
        clearTimeout(cancelChecker);
      }
      reject(new Error("上傳已取消"));
    };

    // 定期檢查取消狀態
    let cancelChecker = null;
    if (onCancel) {
      const checkCancel = () => {
        if (onCancel()) {
          if (cancelChecker) {
            clearTimeout(cancelChecker);
            cancelChecker = null;
          }
          xhr.abort();
          return;
        }
        cancelChecker = setTimeout(checkCancel, 100);
      };
      cancelChecker = setTimeout(checkCancel, 100);
    }

    // 開始上傳
    xhr.open("PUT", url);
    // 設定Content-Type頭部，使用後端推斷的正確MIME型別
    if (contentType && contentType !== null) {
      xhr.setRequestHeader("Content-Type", contentType);
    }
    xhr.send(data);
  });
}

/**
 * 獲取檔案內容
 * @param {Object} options 獲取選項
 * @param {string} options.url 檔案URL
 * @param {Function} [options.onProgress] 進度回撥函式
 * @param {Function} [options.onCancel] 取消檢查函式
 * @param {Function} [options.setXhr] 設定XHR引用的函式
 * @returns {Promise<ArrayBuffer>} 檔案內容
 */
export async function fetchFileContent(options) {
  const { url, onProgress, onCancel, setXhr } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (setXhr) {
      setXhr(xhr);
    }

    // 設定響應型別為ArrayBuffer
    xhr.responseType = "arraybuffer";

    // 設定進度監聽
    if (onProgress) {
      xhr.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress, event.loaded, event.total);
        }
      });
    }

    // 設定狀態變化監聽
    xhr.addEventListener("readystatechange", () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error(`下載失敗: ${xhr.status} ${xhr.statusText}`));
        }
      }
    });

    // 設定錯誤監聽
    xhr.addEventListener("error", () => {
      reject(new Error("網路錯誤"));
    });

    // 設定中止監聽
    xhr.addEventListener("abort", () => {
      reject(new Error("下載已取消"));
    });

    // 定期檢查取消狀態
    if (onCancel) {
      const checkCancel = () => {
        if (onCancel()) {
          xhr.abort();
          return;
        }
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          setTimeout(checkCancel, 100);
        }
      };
      setTimeout(checkCancel, 100);
    }

    // 開始下載
    xhr.open("GET", url);
    xhr.send();
  });
}

/**
 * 上傳到預簽名URL
 * @param {Object} options 上傳選項
 * @param {string} options.url 預簽名URL
 * @param {ArrayBuffer|Blob} options.data 要上傳的資料
 * @param {string} options.contentType 檔案MIME型別
 * @param {Function} [options.onProgress] 進度回撥函式
 * @param {Function} [options.onCancel] 取消檢查函式
 * @param {Function} [options.setXhr] 設定XHR引用的函式
 * @returns {Promise<Object>} 上傳結果，包含etag和size
 */
export async function uploadToPresignedUrl(options) {
  const { url, data, contentType, onProgress, onCancel, setXhr } = options;
  return uploadWithPresignedUrl(url, data, contentType, onProgress, onCancel, setXhr);
}




/******************************************************************************
 * 通用作業（Generic Jobs）API函式
 ******************************************************************************/

/**
 * 建立通用作業（支援多種任務型別的非同步後臺處理）
 * @param {string} taskType 任務型別（'copy', 'scheduled-sync', 'cleanup' 等）
 * @param {Object} payload 任務載荷（由具體任務型別決定）
 * @param {Object} options 選項引數
 * @param {boolean} [options.skipExisting=true] 是否跳過已存在的檔案（適用於複製任務）
 * @param {number} [options.maxConcurrency=10] 最大併發數
 * @param {Object} [options.retryPolicy] 重試策略
 * @returns {Promise<Object>} 作業描述符 { jobId, taskType, status, stats, createdAt }
 */
export async function createJob(taskType, payload, options = {}) {
  const type = String(taskType || "").trim();
  if (!type) {
    throw new Error("taskType 不能為空");
  }

  if (type === "copy") {
    const items = Array.isArray(payload) ? payload : (payload?.items ?? payload);
    const payloadOptions = (!Array.isArray(payload) && payload && typeof payload === "object")
      ? (payload.options || {})
      : {};
    const mergedOptions = { ...payloadOptions, ...options };

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("copy 任務的 items 不能為空");
    }
    return post("/fs/jobs", {
      taskType: type,
      payload: {
        items,
        options: {
          skipExisting: mergedOptions.skipExisting !== false,
          maxConcurrency: mergedOptions.maxConcurrency || 10,
          retryPolicy: mergedOptions.retryPolicy,
        },
      },
    });
  }

  return post("/fs/jobs", {
    taskType: type,
    payload: payload || {},
  });
}

/**
 * 獲取作業狀態
 * @param {string} jobId 作業ID
 * @returns {Promise<Object>} 作業狀態 { jobId, taskType, status, stats, createdAt, startedAt?, finishedAt?, errorMessage? }
 */
export async function getJobStatus(jobId) {
  return get(`/fs/jobs/${jobId}`);
}

/**
 * 取消作業
 * @param {string} jobId 作業ID
 * @returns {Promise<Object>} 取消結果
 */
export async function cancelJob(jobId) {
  return post(`/fs/jobs/${jobId}/cancel`);
}

/**
 * 列出作業
 * @param {Object} filter 過濾條件
 * @param {string} [filter.taskType] 任務型別（'copy', 'scheduled-sync' 等）
 * @param {string} [filter.status] 作業狀態（pending/running/completed/partial/failed/cancelled）
 * @param {number} [filter.limit=20] 返回數量限制
 * @param {number} [filter.offset=0] 偏移量
 * @returns {Promise<Object>} 作業列表 { jobs, total, limit, offset }
 */
export async function listJobs(filter = {}) {
  const params = {
    limit: (filter.limit || 20).toString(),
    offset: (filter.offset || 0).toString(),
  };

  if (filter.taskType) {
    params.taskType = filter.taskType;
  }

  if (filter.status) {
    params.status = filter.status;
  }

  return get('/fs/jobs', { params });
}

/**
 * 獲取當前使用者可見的任務型別清單（用於任務管理 UI 做篩選/展示名）
 * @returns {Promise<Object>} { types: Array<{ taskType, i18nKey?, displayName?, category?, capabilities? }> }
 */
export async function listJobTypes() {
  return get("/fs/job-types");
}

/**
 * 刪除作業
 * @param {string} jobId 作業ID
 * @returns {Promise<Object>} 刪除結果
 */
export async function deleteJob(jobId) {
  return del(`/fs/jobs/${jobId}`);
}
