/**
 * 處理WebDAV DELETE請求
 * 用於刪除檔案或目錄
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

/**
 * 處理DELETE請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @param {D1Database} db - D1資料庫例項
 */
export async function handleDelete(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("DELETE", async () => {
    const ifHeader = c.req.header("If");
    const lockConflict = checkLockPermission(lockManager, path, ifHeader, "DELETE");
    if (lockConflict) {
      console.log(`WebDAV DELETE - 鎖衝突: ${path}`);
      return new Response(lockConflict.message, {
        status: lockConflict.status,
        headers: getStandardWebDAVHeaders({
          customHeaders: { "Content-Type": "text/plain" },
        }),
      });
    }

    const pathParts = path.split("/").filter((p) => p);
    if (pathParts.length === 1) {
      return new Response("禁止刪除掛載根目錄", {
        status: 405,
        headers: getStandardWebDAVHeaders({
          customHeaders: { "Content-Type": "text/plain" },
        }),
      });
    }

    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV DELETE - 開始刪除: ${path}, userType=${userType}`);
    const result = await fileSystem.batchRemoveItems([path], userId, userType);
    console.log(`WebDAV DELETE - 刪除結果: success=${result.success}, failed=${result.failed?.length || 0}`);

    if (result.failed && result.failed.length > 0) {
      const failedItem = result.failed[0];
      console.warn(`WebDAV DELETE - 刪除失敗: ${failedItem.path} - ${failedItem.error}`);

      if (failedItem.error.includes("不存在") || failedItem.error.includes("not found")) {
        return createWebDAVErrorResponse("檔案或目錄不存在", 404, false);
      }
      if (failedItem.error.includes("許可權") || failedItem.error.includes("permission")) {
        return createWebDAVErrorResponse("許可權不足", 403, false);
      }

      return createWebDAVErrorResponse(failedItem.error, 500, false);
    }

    console.log(`WebDAV DELETE - 刪除成功: ${path}`);
    return new Response(null, {
      status: 204,
      headers: getStandardWebDAVHeaders({
        customHeaders: {
          "Content-Type": "text/plain",
          "Content-Length": "0",
        },
      }),
    });
  }, { includeDetails: false, useXmlResponse: false });
}

