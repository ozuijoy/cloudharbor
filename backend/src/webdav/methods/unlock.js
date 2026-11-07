/**
 * 處理WebDAV UNLOCK請求
 * 刪除檔案/目錄的鎖定
 */

import { lockManager } from "../utils/LockManager.js";
import { parseLockTokenHeader } from "../utils/lockUtils.js";
import { withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { AppError, ValidationError, ConflictError } from "../../http/errors.js";

/**
 * 處理UNLOCK請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string|Object} userId - 使用者ID或資訊
 * @param {string} userType - 使用者型別
 * @param {D1Database} db - 資料庫例項
 * @returns {Response} HTTP響應
 */
export async function handleUnlock(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("UNLOCK", async () => {
    console.log(`WebDAV UNLOCK 請求 - 路徑: ${path}, 使用者型別: ${userType}`);

    // 獲取Lock-Token頭
    const lockTokenHeader = c.req.header("Lock-Token");
    if (!lockTokenHeader) {
      console.log(`UNLOCK失敗 - 路徑: ${path}, 缺少Lock-Token頭`);
      throw new ValidationError("缺少Lock-Token頭");
    }

    // 解析鎖令牌
    const token = parseLockTokenHeader(lockTokenHeader);
    if (!token) {
      console.log(`UNLOCK失敗 - 路徑: ${path}, 無效的Lock-Token格式: ${lockTokenHeader}`);
      throw new ValidationError("無效的Lock-Token格式");
    }

    console.log(`UNLOCK請求 - 路徑: ${path}, 令牌: ${token}`);

    // 直接透過令牌獲取鎖定資訊（更健壯的方式）
    const lockInfo = lockManager.getLockByToken(token);
    if (!lockInfo) {
      console.log(`UNLOCK失敗 - 令牌: ${token}, 鎖定不存在或已過期`);
      throw new ConflictError("鎖定不存在或已過期");
    }

    // 驗證路徑匹配
    if (lockInfo.path !== path) {
      console.log(`UNLOCK警告 - 路徑不完全匹配: 鎖定路徑 ${lockInfo.path}, 請求路徑 ${path}`);
      // 注意：不返回錯誤，因為令牌是權威的身份證明
    }

    // 驗證所有權（可選的安全檢查）
    let expectedOwner = "unknown";
    if (userType === UserType.ADMIN) {
      expectedOwner = `admin:${userId}`;
    } else if (userType === UserType.API_KEY && typeof userId === "object") {
      expectedOwner = `apiKey:${userId.name || userId.id}`;
    }

    // 注意：這裡不強制驗證所有權，因為鎖令牌本身就是許可權證明
    // 但可以記錄日誌用於審計
    if (lockInfo.owner !== expectedOwner) {
      console.log(`UNLOCK警告 - 路徑: ${path}, 所有者不匹配: 鎖定所有者 ${lockInfo.owner}, 請求者 ${expectedOwner}`);
    }

    // 刪除鎖定
    const unlocked = lockManager.unlock(token);
    if (!unlocked) {
      console.log(`UNLOCK失敗 - 路徑: ${path}, 刪除鎖定失敗`);
      throw new AppError("刪除鎖定失敗", { status: ApiStatus.INTERNAL_ERROR, code: "INTERNAL_ERROR", expose: true });
    }

    console.log(`UNLOCK成功 - 路徑: ${path}, 令牌: ${token}`);

    // 返回204 No Content
    return new Response(null, {
      status: 204,
      headers: getStandardWebDAVHeaders({
        customHeaders: {
          DAV: "1, 2",
        },
      }),
    });
  }, { includeDetails: false });
}
