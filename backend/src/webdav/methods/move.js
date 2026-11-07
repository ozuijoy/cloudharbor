/**
 * WebDAV MOVE方法實現
 * 基於RFC 4918標準和SabreDAV實現模式，採用"複製-刪除"機制
 * - 基於FileSystem抽象層的統一實現
 */

import { FileSystem } from "../../storage/fs/FileSystem.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";
import { parseDestinationPath } from "../utils/webdavUtils.js";

/**
 * 處理WebDAV MOVE請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別
 * @param {D1Database} db - D1資料庫例項
 * @returns {Promise<Response>} HTTP響應
 */
export async function handleMove(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("MOVE", async () => {
    console.log(`WebDAV MOVE - 開始處理: ${path}`);

    // 1. 解析WebDAV頭部（與COPY方法完全一致）
    const destination = c.req.header("Destination");
    const overwrite = c.req.header("Overwrite") || "T";
    const depth = c.req.header("Depth") || "infinity";
    const ifHeader = c.req.header("If");

    console.log(`WebDAV MOVE - 請求頭部: Destination=${destination}, Overwrite=${overwrite}, Depth=${depth}`);

    // 檢查鎖定狀態

    // 檢查源路徑的鎖定狀態（MOVE操作會刪除源資源）
    const sourceLockConflict = checkLockPermission(lockManager, path, ifHeader, "MOVE");
    if (sourceLockConflict) {
      console.log(`WebDAV MOVE - 源路徑鎖定衝突: ${path}`);
      return createWebDAVErrorResponse(sourceLockConflict.message, sourceLockConflict.status, false);
    }

    // 2. 驗證必需的Destination頭
    if (!destination) {
      console.warn(`WebDAV MOVE - 缺少Destination頭`);
      return createWebDAVErrorResponse("缺少Destination頭", 400, false);
    }

    // 3. 驗證Depth頭部（RFC 4918要求集合資源只能是infinity）
    if (depth !== "infinity") {
      console.error(`WebDAV MOVE - 不支援的Depth值: ${depth}`);
      return createWebDAVErrorResponse("MOVE操作只支援Depth: infinity", 412, false);
    }

    // 4. 解析目標路徑
    const destPath = parseDestinationPath(destination);
    if (!destPath) {
      console.error(`WebDAV MOVE - 無效的Destination URL: ${destination}`);
      return createWebDAVErrorResponse("無效的Destination URL", 400, false);
    }

    console.log(`WebDAV MOVE - 目標路徑: ${destPath}`);

    // 5. 驗證源路徑和目標路徑不能相同（RFC 4918標準）
    if (path === destPath) {
      console.warn(`WebDAV MOVE - 源路徑和目標路徑相同: ${path}`);
      return createWebDAVErrorResponse("源路徑和目標路徑不能相同", 403, false);
    }

    // 6. 建立FileSystem例項
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV MOVE - 開始移動: ${path} -> ${destPath}, 使用者型別: ${userType}`);

    // 7. 檢查目標是否已存在（用於確定返回的狀態碼）
    let destExists = false;
    try {
      destExists = await fileSystem.exists(destPath, userId, userType);
      console.log(`WebDAV MOVE - 目標路徑存在性檢查: ${destPath} = ${destExists}`);
    } catch (error) {
      // exists方法出錯，記錄警告但繼續執行
      console.warn(`WebDAV MOVE - 檢查目標路徑存在性失敗: ${error.message}`);
    }

    // 8. 如果目標存在且不允許覆蓋，直接返回錯誤
    if (destExists && overwrite === "F") {
      console.warn(`WebDAV MOVE - 目標已存在且不允許覆蓋: ${destPath}`);
      return createWebDAVErrorResponse("目標已存在且不允許覆蓋", 412, false); // Precondition Failed
    }

    // 9. 第一步：執行復制操作（複用COPY方法的完整邏輯）
    const copyResult = await fileSystem.copyItem(path, destPath, userId, userType, {
      skipExisting: overwrite === "F", // Overwrite: F 表示不覆蓋，即跳過已存在的檔案
    });

    console.log(`WebDAV MOVE - 複製結果:`, copyResult);

    // 10. 第二步：刪除原始檔/目錄（SabreDAV的"複製-刪除"機制）
    console.log(`WebDAV MOVE - 第二步：刪除原始檔 ${path}`);

    try {
      const deleteResult = await fileSystem.batchRemoveItems([path], userId, userType);
      console.log(`WebDAV MOVE - 刪除結果: 成功=${deleteResult.success}, 失敗=${deleteResult.failed?.length || 0}`);

      if (deleteResult.failed && deleteResult.failed.length > 0) {
        // 刪除失敗，需要回滾已複製的檔案
        console.error(`WebDAV MOVE - 刪除原始檔失敗，嘗試回滾: ${deleteResult.failed[0]?.error}`);

        try {
          // 回滾：刪除已複製的目標檔案
          await fileSystem.batchRemoveItems([destPath], userId, userType);
          console.log(`WebDAV MOVE - 回滾成功：已刪除目標檔案 ${destPath}`);
        } catch (rollbackError) {
          console.error(`WebDAV MOVE - 回滾失敗: ${rollbackError.message}`, rollbackError);
        }

        return createWebDAVErrorResponse(`移動失敗：無法刪除原始檔 - ${deleteResult.failed[0]?.error}`, 500, false);
      }
    } catch (deleteError) {
      console.error(`WebDAV MOVE - 刪除原始檔異常: ${deleteError.message}`, deleteError);

      try {
        // 回滾：刪除已複製的目標檔案
        await fileSystem.batchRemoveItems([destPath], userId, userType);
        console.log(`WebDAV MOVE - 回滾成功：已刪除目標檔案 ${destPath}`);
      } catch (rollbackError) {
        console.error(`WebDAV MOVE - 回滾失敗: ${rollbackError.message}`, rollbackError);
      }

      return createWebDAVErrorResponse(`移動失敗：刪除原始檔異常 - ${deleteError.message}`, 500, false);
    }

    // 13. 根據RFC 4918標準返回適當的狀態碼
    if (destExists) {
      // 目標已存在，移動成功（覆蓋了現有資源）
      console.log(`WebDAV MOVE - 移動成功（覆蓋現有資源）: ${path} -> ${destPath}`);
      return new Response(null, {
        status: 204, // No Content
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        }),
      });
    } else {
      // 目標不存在，移動成功（建立了新資源）
      console.log(`WebDAV MOVE - 移動成功（建立新資源）: ${path} -> ${destPath}`);
      return new Response(null, {
        status: 201, // Created
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
            Location: destination,
          },
        }),
      });
    }
  }, { includeDetails: false, useXmlResponse: false });
}
