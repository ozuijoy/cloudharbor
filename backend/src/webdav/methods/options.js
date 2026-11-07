import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { WEBDAV_CONFIG } from "../auth/config/WebDAVConfig.js";

/**
 * 處理WebDAV OPTIONS請求 - WebDAV能力發現
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string|Object} userId - 使用者ID或資訊（OPTIONS請求可能為undefined）
 * @param {string} userType - 使用者型別（OPTIONS請求可能為undefined）
 * @param {D1Database} db - 資料庫例項
 * @returns {Response} HTTP響應
 */
export async function handleOptions(c, path, userId, userType, db) {
  return handleWebDAVOptionsRequest(c, path, userType);
}


/**
 * 處理WebDAV OPTIONS請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userType - 使用者型別（可能為undefined）
 * @returns {Response} WebDAV OPTIONS響應
 */
function handleWebDAVOptionsRequest(c, path, userType) {
  // 構建靜態的WebDAV方法列表
  const allowedMethods = buildStaticAllowMethods();

  // 構建DAV合規級別
  const davLevel = buildDAVComplianceLevel();

  // 獲取客戶端資訊
  const clientInfo = detectClientInfo(c);

  // 構建響應頭
  const headers = buildWebDAVResponseHeaders(allowedMethods, davLevel, clientInfo);

  // 記錄日誌
  logOptionsRequest(c, path, userType, davLevel, allowedMethods);

  return new Response(null, {
    status: 200,
    headers: headers,
  });
}

/**
 * 構建靜態的WebDAV方法列表
 * 返回WebDAVConfig中定義的所有支援方法
 * @returns {string[]} 允許的方法列表
 */
function buildStaticAllowMethods() {
  // 返回WebDAV配置中定義的所有支援方法
  return [...WEBDAV_CONFIG.METHODS];
}

/**
 * 構建DAV合規級別 - 簡化版本
 * @returns {string} DAV合規級別字串
 */
function buildDAVComplianceLevel() {
  // CloudHarbor支援WebDAV Class 1和Class 2
  // Class 1: 基礎WebDAV功能（PROPFIND, GET, PUT, DELETE, MKCOL, COPY, MOVE）
  // Class 2: 鎖定功能（LOCK, UNLOCK）
  // Class 3: 屬性修改（PROPPATCH）當前返回405，不支援
  return "1, 2";
}

/**
 * 檢測客戶端資訊
 * @param {Object} c - Hono上下文
 * @returns {Object} 客戶端資訊
 */
function detectClientInfo(c) {
  const userAgent = c.req.header("User-Agent") || "";

  return {
    isWindows: userAgent.includes("Microsoft") || userAgent.includes("Windows"),
    isMac: userAgent.includes("Darwin") || userAgent.includes("Mac"),
    isOffice: userAgent.includes("Microsoft Office") || userAgent.includes("Word") || userAgent.includes("Excel"),
    isWebDAVClient: userAgent.includes("WebDAV") || userAgent.includes("DAV"),
    userAgent: userAgent,
  };
}

/**
 * 構建WebDAV響應頭
 * @param {string[]} allowedMethods - 允許的方法列表
 * @param {string} davLevel - DAV合規級別
 * @param {Object} clientInfo - 客戶端資訊
 * @returns {Object} 響應頭物件
 */
function buildWebDAVResponseHeaders(allowedMethods, davLevel, clientInfo) {
  // 客戶端特定頭
  const clientSpecificHeaders = {};
  if (clientInfo.isWindows) {
    clientSpecificHeaders["MS-Author-Via"] = "DAV";
  }
  if (clientInfo.isMac) {
    clientSpecificHeaders["X-DAV-Powered-By"] = "CloudHarbor";
  }

  // 使用統一的WebDAV頭部管理工具，覆蓋預設的Allow頭
  return getStandardWebDAVHeaders({
    customHeaders: {
      DAV: davLevel,
      Allow: allowedMethods.join(", "),
      Public: allowedMethods.join(", "),
      "Content-Length": "0",
      "Content-Type": "text/plain",
      Server: "CloudHarbor-WebDAV/1.0",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...clientSpecificHeaders,
    },
  });
}

/**
 * 記錄OPTIONS請求日誌
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userType - 使用者型別（可能為undefined）
 * @param {string} davLevel - DAV合規級別
 * @param {string[]} allowedMethods - 允許的方法列表
 */
function logOptionsRequest(c, path, userType, davLevel, allowedMethods) {
  const userAgent = c.req.header("User-Agent") || "Unknown";
  const authStatus = userType ? `認證使用者(${userType})` : "未認證訪問";
  console.log(`WebDAV OPTIONS請求 - 路徑: ${path}, 認證狀態: ${authStatus}, DAV級別: ${davLevel}, 方法: ${allowedMethods.length}個, 客戶端: ${userAgent.substring(0, 50)}`);
}
