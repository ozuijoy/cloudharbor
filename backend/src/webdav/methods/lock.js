/**
 * 處理WebDAV LOCK請求
 * 建立或重新整理檔案/目錄的鎖定
 * 遵循RFC 4918標準，支援exclusive write locks
 */

import { lockManager } from "../utils/LockManager.js";
import { parseLockXML, parseTimeoutHeader, parseDepthHeader, buildLockResponseXML, hasLockConflict } from "../utils/lockUtils.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { UserType } from "../../constants/index.js";
import { AppError } from "../../http/errors.js";

/**
 * 處理LOCK請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string|Object} userId - 使用者ID或資訊
 * @param {string} userType - 使用者型別
 * @param {D1Database} db - 資料庫例項
 * @returns {Response} HTTP響應
 */
export async function handleLock(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("LOCK", async () => {
    console.log(`WebDAV LOCK 請求 - 路徑: ${path}, 使用者型別: ${userType}`);

    // 獲取請求頭
    const ifHeader = c.req.header("If");
    const timeoutHeader = c.req.header("Timeout");
    const depthHeader = c.req.header("Depth");

    // 解析超時和深度
    const timeoutSeconds = parseTimeoutHeader(timeoutHeader);
    const depth = parseDepthHeader(depthHeader);

    // 確定鎖定所有者
    let owner = "unknown";
    if (userType === UserType.ADMIN) {
      owner = `admin:${userId}`;
    } else if (userType === UserType.API_KEY && typeof userId === "object") {
      owner = `apiKey:${userId.name || userId.id}`;
    }

    // 獲取請求體
    let requestBody = "";
    try {
      requestBody = await c.req.text();
    } catch (error) {
      console.error("LOCK請求體讀取失敗:", error);
      return createWebDAVErrorResponse("無法讀取請求體", 400);
    }

    console.log("LOCK請求體:", requestBody);

    // 檢查是否為鎖定重新整理請求
    // RFC 4918: 如果有If頭且沒有請求體，則為重新整理請求
    if (ifHeader && (!requestBody || requestBody.trim() === "")) {
      return await handleLockRefresh(c, path, ifHeader, timeoutSeconds);
    }

    // 解析XML請求體
    let lockRequest;
    try {
      lockRequest = parseLockXML(requestBody);
    } catch (error) {
      console.error("LOCK請求解析失敗:", error);
      return createWebDAVErrorResponse("無效的LOCK請求格式", 400);
    }

    console.log("解析的LOCK請求:", lockRequest);

    // 檢查現有鎖定
    const existingLock = lockManager.getLockByPath(path);
    if (existingLock) {
      // 檢查鎖定衝突
      if (hasLockConflict(existingLock, lockRequest.scope)) {
        console.log(`LOCK衝突 - 路徑: ${path}, 現有鎖定: ${existingLock.scope} by ${existingLock.owner}`);
        return createWebDAVErrorResponse("資源已被鎖定", 423);
      }
    }

    // 建立新鎖定
    let lockInfo;
    try {
      lockInfo = lockManager.createLock(path, lockRequest.owner || owner, timeoutSeconds, depth, lockRequest.scope, lockRequest.type);
    } catch (error) {
      console.error("建立鎖定失敗:", error);
      if (error instanceof AppError) {
        return createWebDAVErrorResponse(error.message, error.status ?? 500);
      }
      return createWebDAVErrorResponse("建立鎖定失敗", 500);
    }

    // 構建響應XML
    const responseXML = buildLockResponseXML(path, lockInfo);

    console.log(`LOCK成功 - 路徑: ${path}, 令牌: ${lockInfo.token}, 超時: ${timeoutSeconds}秒`);

    return new Response(responseXML, {
      status: 200,
      headers: getStandardWebDAVHeaders({
        customHeaders: {
          "Content-Type": "application/xml; charset=utf-8",
          "Lock-Token": `<${lockInfo.token}>`,
          DAV: "1, 2",
        },
      }),
    });
  }, { includeDetails: false });
}

/**
 * 處理鎖定重新整理請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} ifHeader - If頭的值
 * @param {number} timeoutSeconds - 超時時間
 * @returns {Response} HTTP響應
 */
async function handleLockRefresh(c, path, ifHeader, timeoutSeconds) {
  console.log(`LOCK重新整理請求 - 路徑: ${path}, If頭: ${ifHeader}`);

  // 從If頭中提取鎖令牌
  const tokenMatch = ifHeader.match(/<([^>]+)>/);
  if (!tokenMatch) {
    return createWebDAVErrorResponse("無效的If頭格式", 400);
  }

  const token = tokenMatch[1];

  // 重新整理鎖定
  const refreshedLock = lockManager.refreshLock(token, timeoutSeconds);
  if (!refreshedLock) {
    return createWebDAVErrorResponse("鎖定不存在或已過期", 412);
  }

  // 驗證路徑匹配
  if (refreshedLock.path !== path) {
    return createWebDAVErrorResponse("鎖定路徑不匹配", 409);
  }

  // 構建響應XML
  const responseXML = buildLockResponseXML(path, refreshedLock);

  console.log(`LOCK重新整理成功 - 路徑: ${path}, 令牌: ${token}, 新超時: ${timeoutSeconds}秒`);

  return new Response(responseXML, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Lock-Token": `<${refreshedLock.token}>`,
      DAV: "1, 2",
    },
  });
}
