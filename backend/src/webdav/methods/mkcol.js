/**
 * 處理WebDAV MKCOL請求
 * 用於建立目錄
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";

/**
 * 處理MKCOL請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @param {D1Database} db - D1資料庫例項
 */
export async function handleMkcol(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("MKCOL", async () => {
    // 檢查請求是否包含正文（基本MKCOL請求不應包含正文）
    // 符合RFC 4918標準：基本MKCOL不應包含請求體，擴充套件MKCOL可以包含XML
    const body = await c.req.text();
    if (body.length > 0) {
      return new Response("MKCOL請求不應包含正文", {
        status: 415, // Unsupported Media Type
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 建立FileSystem例項
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV MKCOL - 開始建立目錄: ${path}, 使用者型別: ${userType}`);

    // 處理根目錄特殊情況（符合WebDAV標準的特殊處理）
    const pathParts = path.split("/").filter((p) => p);
    if (pathParts.length === 1) {
      console.log(`WebDAV MKCOL - 檢測到根目錄請求，執行儲存驅動驗證`);

      try {
        // 透過嘗試獲取掛載點資訊來驗證訪問許可權
        const { mount } = await mountManager.getDriverByPath(path, userId, userType);
        console.log(`WebDAV MKCOL - 成功驗證根目錄訪問許可權，掛載點: ${mount.id}`);

        // 對於根目錄請求，直接返回成功狀態碼（符合WebDAV標準處理）
        return new Response(null, {
          status: 201, // Created
          headers: getStandardWebDAVHeaders({
            customHeaders: {
              "Content-Type": "text/plain",
              "Content-Length": "0",
            },
          }),
        });
      } catch (error) {
        console.warn(`WebDAV MKCOL - 根目錄驗證失敗: ${error.message}`);
        return createWebDAVErrorResponse("根目錄訪問驗證失敗", 403, false);
      }
    }

    // 使用FileSystem統一抽象層建立目錄
    try {
      await fileSystem.createDirectory(path, userId, userType);
      console.log(`WebDAV MKCOL - 目錄建立成功: ${path}`);

      // 返回成功響應（符合WebDAV MKCOL標準）
      return new Response(null, {
        status: 201, // Created
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        }),
      });
    } catch (error) {
      // 處理FileSystem的409錯誤，嚴格遵循RFC 4918標準
      if (error.status === 409) {
        if (error.message === "目錄已存在") {
          // RFC 4918標準：目錄已存在時返回405 Method Not Allowed
          console.log(`WebDAV MKCOL - 目錄已存在，返回405 Method Not Allowed: ${path}`);
          return new Response("Collection already exists", {
            status: 405, // Method Not Allowed
            headers: getStandardWebDAVHeaders({
              customHeaders: {
                "Content-Type": "text/plain",
              },
            }),
          });
        } else if (error.message === "父目錄不存在") {
          // RFC 4918標準：父目錄不存在時返回409 Conflict
          console.log(`WebDAV MKCOL - 父目錄不存在，返回409 Conflict: ${path}`);
          return new Response("Parent collection does not exist", {
            status: 409, // Conflict
            headers: getStandardWebDAVHeaders({
              customHeaders: {
                "Content-Type": "text/plain",
              },
            }),
          });
        }
      }

      // 其他錯誤直接丟擲
      throw error;
    }
  }, { includeDetails: false, useXmlResponse: false });
}
