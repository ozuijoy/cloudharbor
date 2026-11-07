/**
 * WebDAV配置
 */

import { Permission } from "../../../constants/permissions.js";

/**
 * WebDAV基礎路徑
 */
export const WEBDAV_BASE_PATH = "/dav";

/**
 * WebDAV配置
 */
export const WEBDAV_CONFIG = {
  PREFIX: WEBDAV_BASE_PATH,
  METHODS: ["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PROPPATCH"],
  HEADERS: {
    DAV: "1, 2",
    "MS-Author-Via": "DAV",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, X-Custom-Auth-Key",
    "Access-Control-Expose-Headers": "DAV, Lock-Token, MS-Author-Via",
    "Access-Control-Max-Age": "86400",
  },
};

/**
 * WebDAV許可權對映 - 使用實際的位標誌許可權常量
 */
export const WEBDAV_PERMISSIONS = {
  OPTIONS: Permission.WEBDAV_READ,
  PROPFIND: Permission.WEBDAV_READ,
  GET: Permission.WEBDAV_READ,
  HEAD: Permission.WEBDAV_READ,
  PUT: Permission.WEBDAV_MANAGE,
  DELETE: Permission.WEBDAV_MANAGE,
  MKCOL: Permission.WEBDAV_MANAGE,
  COPY: Permission.WEBDAV_MANAGE,
  MOVE: Permission.WEBDAV_MANAGE,
  LOCK: Permission.WEBDAV_MANAGE,
  UNLOCK: Permission.WEBDAV_MANAGE,
  PROPPATCH: Permission.WEBDAV_MANAGE,
};

/**
 * 工具函式
 */

/**
 * 獲取WebDAV配置
 */
export function getWebDAVConfig() {
  return WEBDAV_CONFIG;
}

/**
 * 獲取方法所需的許可權
 */
export function getMethodPermission(method) {
  if (!method) return null;
  return WEBDAV_PERMISSIONS[method.toUpperCase()] || null;
}

/**
 * 判斷是否為讀操作
 */
export function isReadOperation(method) {
  if (!method) return false;
  const readMethods = ["OPTIONS", "PROPFIND", "GET", "HEAD"];
  return readMethods.includes(method.toUpperCase());
}

/**
 * 判斷是否為寫操作
 */
export function isWriteOperation(method) {
  if (!method) return false;
  const writeMethods = ["PUT", "DELETE", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PROPPATCH"];
  return writeMethods.includes(method.toUpperCase());
}

/**
 * 路徑處理
 */
export function stripPrefix(path, prefix = WEBDAV_BASE_PATH) {
  if (!prefix) return path;
  if (path.startsWith(prefix)) {
    return path.substring(prefix.length) || "/";
  }
  return path;
}
