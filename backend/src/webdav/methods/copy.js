/**
 * 處理WebDAV COPY請求
 * 用於複製檔案和目錄
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { parseDestinationPath } from "../utils/webdavUtils.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

/**
 * 處理COPY請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @param {D1Database} db - D1資料庫例項
 */
export async function handleCopy(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("COPY", async () => {
    // 1. 解析WebDAV頭部
    const destination = c.req.header("Destination");
    const overwrite = c.req.header("Overwrite") || "T";
    const depth = c.req.header("Depth") || "infinity";
    const ifHeader = c.req.header("If");

    console.log(`WebDAV COPY - 請求頭部: Destination=${destination}, Overwrite=${overwrite}, Depth=${depth}`);

    // 2. 驗證必需的Destination頭
    if (!destination) {
      console.warn(`WebDAV COPY - 缺少Destination頭`);
      return createWebDAVErrorResponse("缺少Destination頭", 400, false);
    }

    // 3. 解析目標路徑
    const destPath = parseDestinationPath(destination);
    if (!destPath) {
      console.warn(`WebDAV COPY - 無效的Destination頭: ${destination}`);
      return createWebDAVErrorResponse("無效的Destination頭", 400, false);
    }

    // 檢查目標路徑的鎖定狀態（COPY操作會在目標位置建立新資源）
    const lockConflict = checkLockPermission(lockManager, destPath, ifHeader, "COPY");
    if (lockConflict) {
      console.log(`WebDAV COPY - 目標路徑鎖定衝突: ${destPath}`);
      return createWebDAVErrorResponse(lockConflict.message, lockConflict.status, false);
    }

    // 4. 檢查源路徑和目標路徑是否相同
    if (path === destPath) {
      console.warn(`WebDAV COPY - 源路徑和目標路徑相同: ${path}`);
      return createWebDAVErrorResponse("源路徑和目標路徑不能相同", 403, false);
    }

    // 5. 驗證Depth頭（對於集合資源）
    if (depth !== "0" && depth !== "infinity") {
      console.warn(`WebDAV COPY - 無效的Depth頭: ${depth}`);
      return createWebDAVErrorResponse("無效的Depth頭", 400, false);
    }

    // 6. 建立FileSystem例項
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV COPY - 開始複製: ${path} -> ${destPath}, 使用者型別: ${userType}`);

    // 7. 檢查目標是否已存在（用於確定返回的狀態碼）
    let destExists = false;
    try {
      destExists = await fileSystem.exists(destPath, userId, userType);
      console.log(`WebDAV COPY - 目標路徑存在性檢查: ${destPath} = ${destExists}`);
    } catch (error) {
      // exists方法出錯，記錄警告但繼續執行
      console.warn(`WebDAV COPY - 檢查目標路徑存在性失敗: ${error.message}`);
    }

    // 8. 如果目標存在且不允許覆蓋，直接返回錯誤
    if (destExists && overwrite === "F") {
      console.warn(`WebDAV COPY - 目標已存在且不允許覆蓋: ${destPath}`);
      return createWebDAVErrorResponse("目標已存在且不允許覆蓋", 412, false); // Precondition Failed
    }

    // 9. 使用FileSystem統一抽象層執行復制
    // 將WebDAV的Overwrite頭對映為FileSystem的skipExisting選項
    const result = await fileSystem.copyItem(path, destPath, userId, userType, {
      skipExisting: overwrite === "F", // Overwrite: F 表示不覆蓋，即跳過已存在的檔案
    });

    // console.log(`WebDAV COPY - 複製結果:`, result);

    // 10. 處理跳過的情況（這種情況理論上不應該發生，因為我們已經預先檢查了）
    if (result.skipped === true || result.status === "skipped") {
      console.warn(`WebDAV COPY - 複製被跳過: ${path} -> ${destPath}`);
      return createWebDAVErrorResponse("目標已存在且不允許覆蓋", 412, false); // Precondition Failed
    }

    console.log(`WebDAV COPY - 複製成功: ${path} -> ${destPath}`);

    // 13. 返回成功響應（符合WebDAV COPY標準）
    // 根據目標是否已存在返回正確的狀態碼
    const statusCode = destExists ? 204 : 201; // 204 No Content (覆蓋) 或 201 Created (新建)
    const statusText = destExists ? "No Content" : "Created";

    console.log(`WebDAV COPY - 返回狀態碼: ${statusCode} (${statusText})`);

    return new Response(null, {
      status: statusCode,
      headers: getStandardWebDAVHeaders({
        customHeaders: {
          "Content-Type": "text/plain",
          "Content-Length": "0",
        },
      }),
    });
  }, { includeDetails: false, useXmlResponse: false });
}
