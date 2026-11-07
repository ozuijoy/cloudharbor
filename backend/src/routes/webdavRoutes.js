/**
 * WebDAV路由定義
 */
import { Hono } from "hono";
import { webdavAuthMiddleware, handleWebDAV } from "../webdav/index.js";
import { WEBDAV_BASE_PATH, isReadOperation } from "../webdav/auth/config/WebDAVConfig.js";
import { webdavHeaders } from "../webdav/middlewares/webdavHeaders.js";
import { usePolicy } from "../security/policies/policies.js";

// 建立WebDAV路由處理程式
const webdavRoutes = new Hono();

// WebDAV標準響應頭
webdavRoutes.use(WEBDAV_BASE_PATH, webdavHeaders());
webdavRoutes.use(`${WEBDAV_BASE_PATH}/*`, webdavHeaders());

const webdavReadPolicy = usePolicy("webdav.read");
const webdavManagePolicy = usePolicy("webdav.manage");

// WebDAV 每種方法都需要：Basic 認證 → read/manage 策略。
// OPTIONS 走能力發現，不做策略判定。
const buildMiddlewareChain = (method) => {
  const chain = [webdavAuthMiddleware];
  if (method !== "OPTIONS") {
    chain.push(isReadOperation(method) ? webdavReadPolicy : webdavManagePolicy);
  }
  return chain;
};

// 明確定義各種WebDAV方法的處理函式，避免使用all萬用字元
const webdavMethods = ["GET", "PUT", "DELETE", "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "HEAD"];

const wrapWebDAVHandler = () => {
  return (c) => handleWebDAV(c);
};
// 註冊WebDAV路由處理器
webdavMethods.forEach((method) => {
  const baseMiddlewares = buildMiddlewareChain(method);
  webdavRoutes.on(method, WEBDAV_BASE_PATH, ...baseMiddlewares, wrapWebDAVHandler());
});

// 處理WebDAV子路徑的請求
webdavMethods.forEach((method) => {
  const nestedMiddlewares = buildMiddlewareChain(method);
  webdavRoutes.on(method, `${WEBDAV_BASE_PATH}/*`, ...nestedMiddlewares, wrapWebDAVHandler());
});

export default webdavRoutes;
