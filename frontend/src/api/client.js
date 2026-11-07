/**
 * API請求客戶端
 * 提供統一的請求方法和錯誤處理
 */

import { getFullApiUrl } from "./config";
import { ApiStatus } from "./ApiStatus"; // 匯入API狀態碼常量
import { logoutViaBridge, buildAuthHeaders } from "@/modules/security/index.js";
import { enqueueOfflineOperation } from "@/modules/pwa-offline/index.js";
import { createLogger } from "@/utils/logger.js";
import { useOnline } from "@vueuse/core";

const isOnline = useOnline();

const apiLog = createLogger("API");

// - 優先使用後端返回的 message
// - 附帶請求ID（X-Request-Id）方便排查
function extractRequestIdFromResponse(response) {
  try {
    return response?.headers?.get("X-Request-Id") || response?.headers?.get("x-request-id") || null;
  } catch {
    return null;
  }
}

function isGenericServerErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) return true;
  return (
    text === "伺服器內部錯誤" ||
    text === "內部錯誤" ||
    text === "請求失敗" ||
    text === "未知錯誤" ||
    text.includes("伺服器內部錯誤") ||
    text.includes("內部錯誤")
  );
}

function appendRequestIdIfNeeded(message, requestId) {
  const text = String(message || "").trim();
  const rid = String(requestId || "").trim();
  if (!rid) return text;
  // 只在提示過於泛化時追加 requestId，避免正常業務錯誤變得很長
  if (!isGenericServerErrorMessage(text)) return text;
  return `${text}（請求ID:${rid}）`;
}

function appendDebugInfoIfNeeded(message, { requestId, debugMessage } = {}) {
  const text = String(message || "").trim();
  if (!isGenericServerErrorMessage(text)) return text;

  const parts = [];
  const rid = String(requestId || "").trim();
  if (debugMessage) {
    const reason = String(debugMessage).replace(/\s+/g, " ").trim();
    if (reason) {
      const clipped = reason.length > 160 ? `${reason.slice(0, 159)}…` : reason;
      parts.push(`原因:${clipped}`);
    }
  }
  if (rid) parts.push(`請求ID:${rid}`);
  if (!parts.length) return text;
  return `${text}（${parts.join("，")}）`;
}

/**
 * 檢查是否為密碼相關的請求
 * @param {string} endpoint - API端點
 * @param {Object} options - 請求選項
 * @returns {Object} 密碼請求型別檢查結果
 */
function checkPasswordRelatedRequest(endpoint, options) {
  // 判斷是否是密碼驗證請求（文字或檔案分享的密碼驗證）
  const isTextPasswordVerify = endpoint.match(/^(\/)?paste\/[a-zA-Z0-9_-]+$/i) && options.method === "POST";
  const isFilePasswordVerify = endpoint.match(/^(\/)?public\/files\/[a-zA-Z0-9_-]+\/verify$/i) && options.method === "POST";
  const isFsMetaPasswordVerify = endpoint.includes("/fs/meta/password/verify") && options.method === "POST";
  const hasPasswordInBody = options.body && (typeof options.body === "string" ? options.body.includes("password") : options.body.password);

  // 檢查是否是修改密碼請求
  const isChangePasswordRequest = endpoint.includes("/admin/change-password") && options.method === "POST";

  const isPasswordVerify = (isTextPasswordVerify || isFilePasswordVerify || isFsMetaPasswordVerify) && hasPasswordInBody;

  return {
    isPasswordVerify,
    isChangePasswordRequest,
    isTextPasswordVerify,
    isFilePasswordVerify,
    isFsMetaPasswordVerify,
    hasPasswordInBody,
  };
}

/**
 * 新增認證令牌到請求頭
 * @param {Object} headers - 原始請求頭
 * @returns {Promise<Object>} 新增了令牌的請求頭
 */
async function addAuthToken(headers) {
  const merged = buildAuthHeaders(headers);

  if (headers.Authorization) {
    apiLog.debug("請求已攜帶 Authorization（來自呼叫方）");
  } else if (merged.Authorization) {
    apiLog.debug("請求已攜帶 Authorization（來自 authBridge）");
  } else {
    apiLog.debug("請求未攜帶 Authorization");
  }

  return merged;
}


/**
 * 通用API請求方法
 * @param {string} endpoint - API端點路徑
 * @param {Object} options - 請求選項
 * @returns {Promise<any>} 請求響應資料
 */
export async function fetchApi(endpoint, options = {}) {
  // 規範化查詢引數處理
  let finalEndpoint = endpoint;
  if (options.params && Object.keys(options.params).length > 0) {
    const searchParams = new URLSearchParams();

    Object.entries(options.params).forEach(([key, value]) => {
      // 跳過undefined值（符合標準）
      if (value === undefined) {
        return;
      }

      // 處理陣列引數（符合標準）
      if (Array.isArray(value)) {
        value.forEach((v) => {
          if (v !== undefined) {
            searchParams.append(key, String(v));
          }
        });
      } else if (value !== null) {
        // 單值引數使用set（避免重複）
        searchParams.set(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    if (queryString) {
      finalEndpoint = endpoint.includes("?") ? `${endpoint}&${queryString}` : `${endpoint}?${queryString}`;
    }
  }

  const url = getFullApiUrl(finalEndpoint);

  // 詳細的除錯日誌
  const debugInfo = {
    url,
    method: options.method || "GET",
    headers: { ...(options.headers || {}) },
    body: options.body,
    timestamp: new Date().toISOString(),
  };

  apiLog.debug(`API請求: ${debugInfo.method} ${debugInfo.url}`, {
    hasBody: !!debugInfo.body,
    headerKeys: Object.keys(debugInfo.headers || {}),
  });

  // PWA網路狀態檢測 - 符合最佳實踐
  if (!isOnline.value) {
    apiLog.warn("離線狀態，API請求可能失敗:", url);
    if (options.method && options.method !== "GET") {
      await enqueueOfflineOperation(endpoint, options);
    }
  }

  // 檢查請求體是否為FormData型別
  const isFormData = options.body instanceof FormData;

  // 判斷是否為「上傳/下載大資料」請求：
  // - FormData（表單上傳）
  // - Blob / File / ArrayBuffer（流式或分片上傳）
  // - ReadableStream（流式上傳）
  // 這類請求耗時取決於檔案大小與網路速度，不能套用一般 API 的 30 秒超時，
  // 否則大檔案上傳會在傳輸中途被 AbortSignal 中斷（前端表現為「上傳失敗/連線中斷」）。
  const isBinaryBody =
    (typeof Blob !== "undefined" && options.body instanceof Blob) ||
    (typeof ArrayBuffer !== "undefined" && options.body instanceof ArrayBuffer) ||
    (typeof ReadableStream !== "undefined" && options.body instanceof ReadableStream);
  const isUploadRequest = isFormData || isBinaryBody;

  // 預設請求選項
  const defaultOptions = {
    headers: {
      // 如果是FormData，不設定預設的Content-Type，讓瀏覽器自動處理
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
    },
  };

  // 合併預設選項和使用者傳入的選項，並新增認證令牌
  const requestOptions = {
    ...defaultOptions,
    ...options,
    headers: await addAuthToken({
      ...defaultOptions.headers,
      ...options.headers,
    }),
  };

  // 如果請求體是物件型別但不是FormData／二進位資料，則自動序列化為JSON
  // （Blob／ArrayBuffer／ReadableStream 若被 JSON.stringify 會變成 "{}"，直接毀掉上傳內容）
  if (requestOptions.body && typeof requestOptions.body === "object" && !isFormData && !isBinaryBody) {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  try {
    const startTime = Date.now();

    // 新增預設超時處理：
    // - 一般 API：30 秒
    // - 上傳/二進位請求：預設不自動中斷（0），由使用者或 XHR 層自行控制，
    //   避免大檔案上傳耗時超過 30 秒就被中斷
    // - 呼叫端明確傳入 timeout（含 0）時以呼叫端為準
    // 可用 window.appConfig.apiTimeoutMs / uploadTimeoutMs 覆寫（0 表示不限）
    const readConfiguredTimeout = (key, fallback) => {
      try {
        const raw = typeof window !== "undefined" ? window?.appConfig?.[key] : undefined;
        if (raw === undefined || raw === null || raw === "") return fallback;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
      } catch {
        return fallback;
      }
    };
    const DEFAULT_API_TIMEOUT_MS = readConfiguredTimeout("apiTimeoutMs", 30000);
    const UPLOAD_NO_TIMEOUT_MS = readConfiguredTimeout("uploadTimeoutMs", 0);
    const hasExplicitTimeout = Object.prototype.hasOwnProperty.call(options, "timeout");
    const timeoutMs = hasExplicitTimeout
      ? Number(options.timeout) || 0
      : isUploadRequest
        ? UPLOAD_NO_TIMEOUT_MS
        : DEFAULT_API_TIMEOUT_MS;
    let signal = requestOptions.signal;

    // 如果沒有提供signal，使用AbortSignal.timeout()（現代瀏覽器）
    // timeoutMs 為 0 表示不限制時間
    if (!signal && timeoutMs > 0) {
      if (typeof AbortSignal.timeout === "function") {
        // 使用官方推薦的AbortSignal.timeout()
        signal = AbortSignal.timeout(timeoutMs);
      } else {
        // 降級到傳統方式（相容舊瀏覽器）
        const controller = new AbortController();
        signal = controller.signal;
        setTimeout(() => controller.abort(), timeoutMs);
      }
    }

    const response = await fetch(url, {
      ...requestOptions,
      signal,
    });
    const endTime = Date.now();
    const timeTaken = endTime - startTime;

    apiLog.debug(`API響應耗時: ${timeTaken}ms, 狀態: ${response.status}`, {
      url,
      status: response.status,
      statusText: response.statusText,
    });

    // 304 Not Modified：成熟專案常用的條件請求語義（If-None-Match）
    // - 304 無響應體，不應嘗試解析 JSON
    // - 交由上層用本地快取資料兜底
    if (response.status === 304) {
      const etag = response.headers.get("etag") || response.headers.get("ETag") || null;
      apiLog.debug(`API響應: 304 Not Modified`, { url, etag });
      return {
        success: true,
        notModified: true,
        status: 304,
        etag,
        data: null,
      };
    }

    // 首先解析響應內容
    let responseData;
    const contentType = response.headers.get("content-type");
    const requestId = extractRequestIdFromResponse(response);

    // 檢查是否需要返回blob響應
    if (options.responseType === "blob") {
      responseData = await response.blob();
      apiLog.debug(`API響應Blob: ${responseData.size} 位元組`, { url, type: responseData.type });
    } else if (contentType && contentType.includes("application/json")) {
      responseData = await response.json();
      apiLog.debug(`API響應JSON`, {
        url,
        kind: Array.isArray(responseData) ? "array" : typeof responseData,
        keys: responseData && typeof responseData === "object" && !Array.isArray(responseData) ? Object.keys(responseData).slice(0, 20) : undefined,
        length: Array.isArray(responseData) ? responseData.length : undefined,
      });
    } else {
      responseData = await response.text();
      apiLog.debug(`API響應文字: ${responseData.substring(0, 100)}${responseData.length > 100 ? "..." : ""}`);
    }

    // 如果響應不成功，丟擲錯誤
    if (!response.ok) {
      // 對於blob響應的錯誤，需要重新解析為JSON獲取錯誤資訊
      if (options.responseType === "blob" && responseData instanceof Blob) {
        try {
          const errorText = await responseData.text();
          const errorData = JSON.parse(errorText);
          responseData = errorData;
        } catch (e) {
          // 如果無法解析為JSON，使用預設錯誤資訊
          responseData = { message: `HTTP錯誤 ${response.status}` };
        }
      }

      // 特殊處理401未授權錯誤
      if (response.status === ApiStatus.UNAUTHORIZED) {
        apiLog.error(`🚫 授權失敗(${url}):`, responseData);

        // 檢查特殊的密碼驗證請求型別
        const isPasswordRelatedRequest = checkPasswordRelatedRequest(endpoint, options);
        const { isPasswordVerify, isChangePasswordRequest } = isPasswordRelatedRequest;

        // 如果是密碼驗證請求，直接返回錯誤，不清除令牌
        if (isPasswordVerify) {
          apiLog.debug(`密碼驗證失敗：不清除認證令牌（端點: ${endpoint}）`);

          // 確保返回後端提供的具體錯誤資訊
          const errorMessage = responseData && responseData.message ? responseData.message : "密碼錯誤";

          const error = new Error(errorMessage);
          error.__logged = true;
          throw error;
        }

        // 如果是修改密碼請求，可能是當前密碼驗證失敗
        if (isChangePasswordRequest) {
          // 返回具體的錯誤資訊，通常是"當前密碼錯誤"
          const errorMessage = responseData && responseData.message ? responseData.message : "驗證失敗";

          const error = new Error(errorMessage);
          error.__logged = true;
          throw error;
        }

        // 判斷使用的是哪種認證方式
        const authHeader = requestOptions.headers.Authorization || "";
        const errorCode =
          responseData && typeof responseData === "object" && typeof responseData.code === "string"
            ? responseData.code
            : "";

        const isAuthErrorCode =
          errorCode === "UNAUTHORIZED" ||
          errorCode === "AUTH_ERROR" ||
          errorCode === "AUTHENTICATION_ERROR" ||
          errorCode === "AUTH_INVALID" ||
          errorCode === "AUTH_EXPIRED";

        // 管理員令牌過期
        if (authHeader.startsWith("Bearer ")) {
          // 僅在明確的認證錯誤場景下才執行登出：
          // - 後端返回的 code 表明是認證問題
          // - 或請求命中了 /admin 登入態相關介面
          const isAdminAuthEndpoint = endpoint.startsWith("/admin") || endpoint.includes("/admin/");

          if (isAuthErrorCode || isAdminAuthEndpoint) {
            apiLog.debug("管理員令牌驗證失敗：執行登出");
            await logoutViaBridge();
            const error = new Error("管理員會話已過期，請重新登入");
            error.__logged = true;
            throw error;
          }

          // 對於非認證類 401（例如儲存驅動或業務錯誤），保留會話，僅丟擲業務錯誤
          const errorMessage =
            responseData && typeof responseData === "object" && responseData.message
              ? responseData.message
              : "請求未授權，但當前管理員會話仍保持，請檢查配置或稍後重試";

          const error = new Error(errorMessage);
          error.__logged = true;
          throw error;
        }

        // API金鑰處理
        if (authHeader.startsWith("ApiKey ")) {
          const isPermissionIssue =
            responseData &&
            responseData.message &&
            (responseData.message.includes("未授權訪問") ||
              responseData.message.includes("無權訪問") ||
              responseData.message.includes("需要管理員許可權或有效的API金鑰") ||
              responseData.message.includes("許可權不足") ||
              responseData.message.includes("沒有許可權"));

          if (isPermissionIssue) {
            apiLog.debug("API金鑰許可權不足：不執行登出");
            const error = new Error(responseData.message || "訪問被拒絕，您可能無權執行此操作");
            error.__logged = true;
            throw error;
          }

          apiLog.debug("API金鑰驗證失敗：執行登出");
          await logoutViaBridge();
          const apiKeyError = new Error("API金鑰無效或已過期");
          apiKeyError.__logged = true;
          throw apiKeyError;
        }

        const unauthorizedError = new Error("未授權訪問，請登入後重試");
        unauthorizedError.__logged = true;
        throw unauthorizedError;
      }

      // 對409狀態碼做特殊處理（連結字尾衝突或其他衝突）
      if (response.status === ApiStatus.CONFLICT) {
        apiLog.error(`❌ 資源衝突錯誤(${url}):`, responseData);
        // 使用後端返回的具體錯誤資訊，無論是字串形式還是物件形式
        if (typeof responseData === "string") {
          const error = new Error(responseData);
          error.__logged = true;
          throw error;
        } else if (responseData && typeof responseData === "object" && responseData.message) {
          const error = new Error(responseData.message);
          error.__logged = true;
          throw error;
        } else {
          const error = new Error("連結字尾已被佔用，請嘗試其他字尾");
          error.__logged = true;
          throw error;
        }
      }

      // 處理新的後端錯誤格式 (code, message)
      if (responseData && typeof responseData === "object") {
        apiLog.error(`❌ API錯誤(${url}):`, responseData);
        const baseMessage = responseData.message || `HTTP錯誤 ${response.status}: ${response.statusText}`;
        const payloadRequestId =
          typeof responseData.requestId === "string" && responseData.requestId.trim()
            ? responseData.requestId.trim()
            : requestId;
        const debugMessage = typeof responseData.debugMessage === "string" ? responseData.debugMessage : null;
        const error = new Error(appendDebugInfoIfNeeded(baseMessage, { requestId: payloadRequestId, debugMessage }));
        error.__logged = true;
        if (responseData.code) {
          error.code = responseData.code;
        }
        if (Object.prototype.hasOwnProperty.call(responseData, "data")) {
          error.data = responseData.data;
        }
        if (payloadRequestId) {
          error.requestId = payloadRequestId;
        }
        if (debugMessage) {
          error.debugMessage = debugMessage;
        }
        throw error;
      }

      apiLog.error(`❌ HTTP錯誤(${url}): ${response.status}`, responseData);
      const error = new Error(appendRequestIdIfNeeded(`HTTP錯誤 ${response.status}: ${response.statusText}`, requestId));
      error.__logged = true;
      if (requestId) {
        error.requestId = requestId;
      }
      throw error;
    }

    // 處理新的後端統一響應格式 (code, message, data)
    if (responseData && typeof responseData === "object") {
      // success 布林判斷
      if ("success" in responseData) {
        if (responseData.success !== true) {
          apiLog.error(`❌ API業務錯誤(${url}):`, responseData);
          const baseMessage = responseData.message || "請求失敗";
          const payloadRequestId =
            typeof responseData.requestId === "string" && responseData.requestId.trim()
              ? responseData.requestId.trim()
              : requestId;
          const debugMessage = typeof responseData.debugMessage === "string" ? responseData.debugMessage : null;
          const error = new Error(appendDebugInfoIfNeeded(baseMessage, { requestId: payloadRequestId, debugMessage }));
          error.__logged = true;
          if (responseData.code) {
            error.code = responseData.code;
          }
          if (payloadRequestId) {
            error.requestId = payloadRequestId;
          }
          if (debugMessage) {
            error.debugMessage = debugMessage;
          }
          throw error;
        }
        return responseData;
      }

      // 相容舊介面：HTTP 200 但 payload 的 code 表示失敗（例如 code=500）
      if (
        typeof responseData.code === "number" &&
        responseData.code >= 400 &&
        responseData.message &&
        responseData.success !== true
      ) {
        const payloadRequestId =
          typeof responseData.requestId === "string" && responseData.requestId.trim()
            ? responseData.requestId.trim()
            : requestId;
        const debugMessage = typeof responseData.debugMessage === "string" ? responseData.debugMessage : null;
        const error = new Error(appendDebugInfoIfNeeded(responseData.message, { requestId: payloadRequestId, debugMessage }));
        error.__logged = true;
        error.code = responseData.code;
        if (payloadRequestId) {
          error.requestId = payloadRequestId;
        }
        if (debugMessage) {
          error.debugMessage = debugMessage;
        }
        throw error;
      }

      // 如果響應不包含code欄位，直接返回整個響應
      return responseData;
    }

    // 成功響應後儲存重要業務資料到IndexedDB
    await handleSuccessfulResponse(endpoint, options, responseData);

    // 如果響應不符合統一格式，則直接返回
    return responseData;
  } catch (error) {
    // 處理不同型別的錯誤
    if (error.name === "AbortError") {
      // 請求被主動取消時，靜默處理，不丟擲錯誤
      apiLog.debug(`API請求被取消(${url})`);
      // 建立一個特殊的 AbortError 物件，讓呼叫方可以識別
      const abortError = new Error("請求已取消");
      abortError.name = "AbortError";
      abortError.__aborted = true;
      abortError.__logged = true;
      throw abortError;
    } else if (error.name === "TimeoutError") {
      apiLog.error(`⏰ API請求超時(${url}):`, error.message);
      throw new Error("請求超時，伺服器響應時間過長");
    } else if (error.name === "TypeError" && error.message.includes("fetch")) {
      apiLog.error(`🌐 網路錯誤(${url}):`, error.message);
      throw new Error("網路連線失敗，請檢查網路設定");
    } else {
      // 避免對已經在上層記錄過的業務錯誤重複列印日誌
      if (!error.__logged) {
        apiLog.error(`❌ API請求失敗(${url}):`, error);
      }
      // 兜底：保證丟擲去的一定是 Error，避免上層拿不到 error.message 而只能顯示“未知錯誤”
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error ?? "未知錯誤"));
    }
  }
}

// 離線操作鎖
let offlineOperationLock = false;

// 處理離線操作（PWA
// 處理成功響應的業務資料儲存（PWA離線）
async function handleSuccessfulResponse(endpoint, options, responseData) {
  try {
    const { pwaUtils } = await import("../pwa/pwaManager.js");
    if (!pwaUtils || !pwaUtils.storage) return;

    const method = options.method || "GET";

    // 只儲存使用者建立的重要業務資料，不儲存所有API響應
    if (method === "POST" && endpoint.includes("/paste") && responseData.data) {
      // 儲存新建立的文字分享
      await pwaUtils.storage.savePaste(responseData.data);
      apiLog.debug(`[PWA] 已儲存文字分享: ${responseData.data.slug}`);
    } else if (method === "POST" && endpoint.includes("/upload") && responseData.data) {
      // 儲存上傳的檔案資訊
      await pwaUtils.storage.saveFile(responseData.data);
      apiLog.debug(`[PWA] 已儲存檔案資訊: ${responseData.data.filename || responseData.data.slug}`);
    } else if (method === "POST" && endpoint.includes("/admin/settings")) {
      // 儲存重要設定更新
      const settingKey = `admin_setting_${Date.now()}`;
      await pwaUtils.storage.saveSetting(settingKey, responseData);
      apiLog.debug(`[PWA] 已儲存管理員設定: ${settingKey}`);
    }
  } catch (error) {
    apiLog.warn("[PWA] 業務資料儲存失敗:", error);
  }
}

/**
 * GET請求方法
 */
export function get(endpoint, options = {}) {
  return fetchApi(endpoint, { ...options, method: "GET" });
}

/**
 * 傳送POST請求
 * @param {string} endpoint - API端點
 * @param {Object|ArrayBuffer|Blob} data - 請求資料
 * @param {Object} options - 可選配置
 * @returns {Promise<Object>} 響應資料
 */
export async function post(endpoint, data, options = {}) {
  try {
    // 檢查是否需要傳送原始二進位制資料（用於分片上傳）
    if (options.rawBody && (data instanceof ArrayBuffer || data instanceof Blob)) {
      const url = getFullApiUrl(endpoint);

      // 獲取認證頭
      const authHeaders = await addAuthToken({});
      const headers = {
        ...authHeaders,
        ...options.headers,
      };

      // 提取分片資訊（如果存在）
      let partInfo = "";
      const partNumberMatch = endpoint.match(/partNumber=(\d+)/);
      const isLastPartMatch = endpoint.match(/isLastPart=(true|false)/);

      if (partNumberMatch) {
        const partNumber = partNumberMatch[1];
        const isLastPart = isLastPartMatch ? isLastPartMatch[1] === "true" : false;
        partInfo = `，分片: ${partNumber}${isLastPart ? " (最後分片)" : ""}`;
      }

      apiLog.debug(`傳送二進位制資料到 ${url}${partInfo}`, { size: data instanceof Blob ? data.size : data.byteLength });

      // 新增對 XHR 物件的處理，以支援取消功能
      const xhr = new XMLHttpRequest();

      // 如果提供了 XHR 建立回撥，呼叫它以支援取消操作
      if (options.onXhrCreated && typeof options.onXhrCreated === "function") {
        options.onXhrCreated(xhr);
      }

      // 返回一個基於 XHR 的 Promise
      return new Promise((resolve, reject) => {
        xhr.open("POST", url, true);

        // 設定請求頭
        Object.keys(headers).forEach((key) => {
          xhr.setRequestHeader(key, headers[key]);
        });

        // 設定超時（0 表示不限制；未指定時由下方統一設定）
        if (Object.prototype.hasOwnProperty.call(options, "timeout")) {
          xhr.timeout = Number(options.timeout) || 0;
        }

        // 設定響應型別為 JSON
        xhr.responseType = "json";

        // 監聽上傳進度
        if (options.onUploadProgress && typeof options.onUploadProgress === "function") {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              options.onUploadProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
        }

        // 監聽請求完成
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            let responseData;

            // 嘗試解析響應
            try {
              if (xhr.response) {
                responseData = xhr.response;
              } else if (xhr.responseType === "" || xhr.responseType === "text") {
                // 如果響應型別為文字，嘗試解析為 JSON
                try {
                  responseData = JSON.parse(xhr.responseText);
                } catch (e) {
                  responseData = xhr.responseText;
                }
              } else {
                responseData = xhr.response;
              }

              apiLog.debug(`二進位制上傳請求成功 ${url}${partInfo}`);
              resolve(responseData);
            } catch (e) {
              apiLog.error(`解析響應錯誤: ${e.message}`);
              reject(new Error(`解析響應錯誤: ${e.message}`));
            }
          } else {
            let errorMsg;
            try {
              if (xhr.responseType === "" || xhr.responseType === "text") {
                try {
                  const errorObj = JSON.parse(xhr.responseText);
                  errorMsg = errorObj.message || `HTTP錯誤 ${xhr.status}`;
                } catch (e) {
                  errorMsg = xhr.responseText || `HTTP錯誤 ${xhr.status}`;
                }
              } else if (xhr.response && xhr.response.message) {
                errorMsg = xhr.response.message;
              } else {
                errorMsg = `HTTP錯誤 ${xhr.status}`;
              }
            } catch (e) {
              errorMsg = `HTTP錯誤 ${xhr.status}`;
            }

            apiLog.error(`❌ 二進位制上傳請求失敗 ${url}${partInfo}: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        };

        // 監聽網路錯誤
        xhr.onerror = function () {
          apiLog.error(`❌ 網路錯誤: ${url}${partInfo}`);
          reject(new Error("網路錯誤，請檢查連線"));
        };

        // 超時時間：二進位上傳/分片資料不預設中斷，避免大檔案傳輸到一半被中止
        // （XHR 的 timeout = 0 表示不限時間）
        xhr.timeout = Object.prototype.hasOwnProperty.call(options, "timeout") ? Number(options.timeout) || 0 : 0;

        // 監聽超時
        xhr.ontimeout = function () {
          apiLog.error(`❌ 請求超時: ${url}${partInfo}`);
          reject(new Error("請求超時，伺服器響應時間過長"));
        };

        // 監聽中止
        xhr.onabort = function () {
          apiLog.debug(`請求已被中止: ${url}${partInfo}`);
          reject(new Error("請求已被使用者取消"));
        };

        // 傳送請求
        xhr.send(data);
      });
    }

    // 常規JSON資料或FormData
    return await fetchApi(endpoint, {
      ...options,
      method: "POST",
      body: data,
    });
  } catch (error) {
    apiLog.error(`POST ${endpoint} 請求錯誤:`, error);
    throw error;
  }
}

/**
 * PUT請求方法
 */
export function put(endpoint, data, options = {}) {
  return fetchApi(endpoint, { ...options, method: "PUT", body: data });
}

/**
 * DELETE請求方法
 */
export function del(endpoint, data, options = {}) {
  return fetchApi(endpoint, { ...options, method: "DELETE", body: data });
}
