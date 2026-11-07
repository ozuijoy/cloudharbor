import { getAuthSnapshot } from "@/modules/security/index.js";
import { createLogger } from "@/utils/logger.js";

/**
 * PWA Offline 模組入口
 *
 * - 統一封裝離線操作佇列的寫入邏輯
 * - 對外提供輕量 API，供 api/client 等模組呼叫
 */

let offlineOperationLock = false;
const log = createLogger("OfflineQueue");

/**
 * 根據 endpoint/method 判定離線操作型別
 */
export function getOfflineOperationType(endpoint, method) {
  if (endpoint.includes("/paste") && method === "POST") {
    return { type: "createPaste", description: "離線建立文字分享已加入佇列" };
  }

  if (endpoint.includes("/pastes/")) {
    if (method === "PUT") return { type: "updatePaste", description: "離線更新文字分享已加入佇列" };
  }

  if (endpoint.includes("/pastes/batch-delete") && method === "DELETE") {
    return { type: "batchDeletePastes", description: "離線批次刪除文字分享已加入佇列" };
  }

  if (endpoint.includes("/pastes/clear-expired") && method === "POST") {
    return { type: "clearExpiredPastes", description: "離線清理過期文字分享已加入佇列" };
  }

  if (endpoint.includes("/admin/settings/group/") && method === "PUT") {
    return { type: "updateGroupSettings", description: "離線分組設定更新已加入佇列" };
  }

  if (endpoint.includes("/admin/cache/clear") && method === "POST") {
    return { type: "clearCache", description: "離線快取清理已加入佇列" };
  }

  if (endpoint.includes("/share/verify/") && method === "POST") {
    return { type: "verifyFilePassword", description: "離線檔案密碼驗證已加入佇列" };
  }

  return null;
}

/**
 * 將離線操作寫入離線佇列（IndexedDB）
 * 行為與原 client.js 中的 handleOfflineOperation 保持一致
 */
export async function enqueueOfflineOperation(endpoint, options) {
  if (offlineOperationLock) {
    log.debug("離線操作正在處理中，跳過重複操作");
    return;
  }

  log.debug(`處理離線操作: ${options.method} ${endpoint}`);
  try {
    offlineOperationLock = true;

    const { pwaUtils } = await import("../../pwa/pwaManager.js");
    if (!pwaUtils || !pwaUtils.storage) {
      log.warn("[PWA] pwaUtils或storage不可用");
      return;
    }

    // 獲取當前認證資訊
    let authToken = null;
    let authType = null;
    const authState = getAuthSnapshot();

    if (authState) {
      if (authState.authType === "admin" && authState.adminToken) {
        authToken = authState.adminToken;
        authType = "admin";
        log.debug(`獲取管理員認證資訊，token長度: ${authToken.length}`);
      } else if (authState.authType === "apikey" && authState.apiKey) {
        authToken = authState.apiKey;
        authType = "apikey";
        log.debug(`獲取API金鑰認證資訊，token長度: ${authToken.length}`);
      }
    }

    const operation = {
      endpoint,
      method: options.method,
      data: options.body,
      authToken,
      authType,
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    const operationType = getOfflineOperationType(endpoint, options.method);
    if (!operationType) {
      log.debug(`跳過離線操作（不適合離線處理）: ${options.method} ${endpoint}`);
      return;
    }

    operation.type = operationType.type;
    await pwaUtils.storage.addToOfflineQueue(operation);
    log.debug(operationType.description);

    if (pwaUtils.isBackgroundSyncSupported()) {
      try {
        await pwaUtils.registerBackgroundSync("sync-offline-queue");
        log.debug("Background Sync 已註冊，操作將在網路恢復時自動同步");
      } catch (error) {
        log.warn("[PWA] Background Sync 註冊失敗:", error);
      }
    }
  } catch (error) {
    log.warn("[PWA] 離線操作處理失敗:", error);
  } finally {
    offlineOperationLock = false;
  }
}
