/**
 * WebDAV服務入口檔案
 *
 */

import { handlePropfind } from "./methods/propfind.js";
import { handleOptions } from "./methods/options.js";
import { handlePut } from "./methods/put.js";
import { handleGet } from "./methods/get.js";
import { handleDelete } from "./methods/delete.js";
import { handleMkcol } from "./methods/mkcol.js";
import { handleMove } from "./methods/move.js";
import { handleCopy } from "./methods/copy.js";
import { handleLock } from "./methods/lock.js";
import { handleUnlock } from "./methods/unlock.js";
import { handleProppatch } from "./methods/proppatch.js";
import { AppError } from "../http/errors.js";
import { ApiStatus } from "../constants/index.js";
import { WebDAVAuth } from "./auth/core/WebDAVAuth.js";
import { processWebDAVPath } from "./utils/webdavUtils.js";

/**
 * 安全的路徑處理
 * 防止路徑遍歷攻擊和其他安全漏洞
 */
function processPath(rawPath) {
  return processWebDAVPath(rawPath, true); // 丟擲異常模式
}

/**
 * WebDAV統一認證中介軟體
 *
 * @param {Object} c - Hono上下文
 * @param {Function} next - 下一個中介軟體
 */
export const webdavAuthMiddleware = (c, next) => {
  const webdavAuth = new WebDAVAuth(c.env.DB);
  const middleware = webdavAuth.createMiddleware();
  return middleware(c, next);
};

/**
 * WebDAV主處理函式
 *
 *
 * @param {Object} c - Hono上下文
 * @returns {Response} HTTP響應
 */
export async function handleWebDAV(c) {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const userId = c.get("userId");
  const userType = c.get("userType");
  const rawPath = url.pathname;
  const path = processPath(rawPath);
  const db = c.env.DB;

  console.log(`WebDAV請求: ${method} ${path}, 使用者型別: ${userType}`);

  let response;
  switch (method) {
    case "OPTIONS":
      response = await handleOptions(c, path, userId, userType, db);
      break;
    case "PROPFIND":
      response = await handlePropfind(c, path, userId, userType, db);
      break;
    case "GET":
    case "HEAD":
      response = await handleGet(c, path, userId, userType, db);
      break;
    case "PUT":
      response = await handlePut(c, path, userId, userType, db);
      break;
    case "DELETE":
      response = await handleDelete(c, path, userId, userType, db);
      break;
    case "MKCOL":
      response = await handleMkcol(c, path, userId, userType, db);
      break;
    case "MOVE":
      response = await handleMove(c, path, userId, userType, db);
      break;
    case "COPY":
      response = await handleCopy(c, path, userId, userType, db);
      break;
    case "LOCK":
      response = await handleLock(c, path, userId, userType, db);
      break;
    case "UNLOCK":
      response = await handleUnlock(c, path, userId, userType, db);
      break;
    case "PROPPATCH":
      response = await handleProppatch(c, path, userId, userType, db);
      break;
    default:
      console.warn(`WebDAV不支援的方法: ${method}`);
      throw new AppError(`Method ${method} not supported`, { status: ApiStatus.METHOD_NOT_ALLOWED, code: "METHOD_NOT_ALLOWED", expose: true });
  }

  console.log(`WebDAV響應: ${method} ${path}, 狀態碼: ${response.status}`);
  return response;
}

