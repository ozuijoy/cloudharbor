/**
 * 🎯 Background Sync API 整合 - 符合主流PWA最佳實踐
 *
 * 此檔案實現標準的Background Sync API功能，包括：
 * 1. 離線操作佇列的可靠同步
 * 2. 重試機制和錯誤處理
 * 3. 同步狀態管理和反饋
 * 4. 與現有PWA架構的無縫整合
 */

// 🎯 Background Sync 配置
const SYNC_CONFIG = {
  // 同步標籤
  TAGS: {
    OFFLINE_QUEUE: "sync-offline-queue",
    DATA_SYNC: "sync-data",
    RETRY_FAILED: "sync-retry-failed",
  },

  // 重試配置
  RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY: 1000, // 1秒
    BACKOFF_MULTIPLIER: 2, // 指數退避
    MAX_DELAY: 30000, // 最大30秒
  },

  // IndexedDB配置
  DB: {
    NAME: "CloudHarborOfflineDB",
    VERSION: 685, // 與pwaManager.js保持一致
    STORES: {
      OFFLINE_QUEUE: "offlineQueue",
      SYNC_STATUS: "syncStatus",
    },
  },
};

// IndexedDB操作工具類
class SyncStorageManager {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_CONFIG.DB.NAME, SYNC_CONFIG.DB.VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      // 資料庫升級時確儲存儲結構存在
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 確保離線佇列儲存存在
        if (!db.objectStoreNames.contains(SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE)) {
          const queueStore = db.createObjectStore(SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE, {
            keyPath: "id",
            autoIncrement: true,
          });
          queueStore.createIndex("timestamp", "timestamp", { unique: false });
          queueStore.createIndex("type", "type", { unique: false });
          queueStore.createIndex("status", "status", { unique: false });
        }

        // 建立同步狀態儲存
        if (!db.objectStoreNames.contains(SYNC_CONFIG.DB.STORES.SYNC_STATUS)) {
          const statusStore = db.createObjectStore(SYNC_CONFIG.DB.STORES.SYNC_STATUS, {
            keyPath: "id",
          });
          statusStore.createIndex("lastSync", "lastSync", { unique: false });
        }
      };
    });
  }

  async getOfflineQueue() {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE], "readonly");
    const store = transaction.objectStore(SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromQueue(id) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE], "readwrite");
    const store = transaction.objectStore(SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateQueueItem(id, updates) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE], "readwrite");
    const store = transaction.objectStore(SYNC_CONFIG.DB.STORES.OFFLINE_QUEUE);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          Object.assign(item, updates);
          const putRequest = store.put(item);
          putRequest.onsuccess = () => resolve(item);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error("Queue item not found"));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async updateSyncStatus(status) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction([SYNC_CONFIG.DB.STORES.SYNC_STATUS], "readwrite");
    const store = transaction.objectStore(SYNC_CONFIG.DB.STORES.SYNC_STATUS);

    const statusRecord = {
      id: "global",
      lastSync: new Date().toISOString(),
      ...status,
    };

    return new Promise((resolve, reject) => {
      const request = store.put(statusRecord);
      request.onsuccess = () => resolve(statusRecord);
      request.onerror = () => reject(request.error);
    });
  }
}

// 建立儲存管理器例項
const syncStorage = new SyncStorageManager();

// Background Sync 事件處理器
self.addEventListener("sync", async (event) => {
  console.log(`[Background Sync] 收到同步事件: ${event.tag}`);

  switch (event.tag) {
    case SYNC_CONFIG.TAGS.OFFLINE_QUEUE:
      event.waitUntil(syncOfflineQueue());
      break;

    case SYNC_CONFIG.TAGS.DATA_SYNC:
      event.waitUntil(syncApplicationData());
      break;

    case SYNC_CONFIG.TAGS.RETRY_FAILED:
      event.waitUntil(retryFailedOperations());
      break;

    default:
      console.warn(`[Background Sync] 未知的同步標籤: ${event.tag}`);
  }
});

// 同步離線操作佇列
async function syncOfflineQueue() {
  try {
    console.log("[Background Sync] 開始同步離線操作佇列");

    const queue = await syncStorage.getOfflineQueue();
    const pendingItems = queue.filter((item) => item.status === "pending");

    if (pendingItems.length === 0) {
      console.log("[Background Sync] 沒有待同步的離線操作");
      return;
    }

    console.log(`[Background Sync] 發現 ${pendingItems.length} 個待同步操作`);

    let successCount = 0;
    let failureCount = 0;

    for (const item of pendingItems) {
      try {
        await processQueueItem(item);
        await syncStorage.removeFromQueue(item.id);
        successCount++;
        console.log(`[Background Sync] 操作同步成功: ${item.type} (ID: ${item.id})`);
      } catch (error) {
        failureCount++;
        console.error(`[Background Sync] 操作同步失敗: ${item.type} (ID: ${item.id})`, error);

        // 更新重試計數
        const retryCount = (item.retryCount || 0) + 1;
        if (retryCount < SYNC_CONFIG.RETRY.MAX_ATTEMPTS) {
          await syncStorage.updateQueueItem(item.id, {
            status: "retry",
            retryCount,
            lastError: error.message,
            nextRetry: new Date(Date.now() + calculateRetryDelay(retryCount)).toISOString(),
          });
        } else {
          await syncStorage.updateQueueItem(item.id, {
            status: "failed",
            retryCount,
            lastError: error.message,
            failedAt: new Date().toISOString(),
          });
        }
      }
    }

    // 更新同步狀態
    try {
      await syncStorage.updateSyncStatus({
        type: "offline-queue",
        successCount,
        failureCount,
        totalProcessed: pendingItems.length,
      });
      console.log(`[Background Sync] 同步狀態已更新`);
    } catch (error) {
      console.error(`[Background Sync] 更新同步狀態失敗:`, error);
      // 不阻止後續通知流程
    }

    console.log(`[Background Sync] 離線佇列同步完成: 成功 ${successCount}, 失敗 ${failureCount}`);

    // 第1層：Service Worker → PWA Manager 通訊
    // 同步完成後通知所有客戶端頁面
    console.log(`[Background Sync] 準備通知客戶端: successCount=${successCount}, failureCount=${failureCount}`);

    if (successCount > 0 || failureCount > 0) {
      const syncedOperations = pendingItems.slice(0, successCount).map((item) => ({
        type: item.type,
        id: item.id,
        timestamp: item.timestamp,
      }));

      console.log(`[Background Sync] 傳送通知給客戶端`, { successCount, failureCount, syncedOperations });

      await notifyClientsOfSyncCompletion({
        type: "offline-queue",
        successCount,
        failureCount,
        totalProcessed: pendingItems.length,
        syncedOperations,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log(`[Background Sync] 跳過通知：沒有成功或失敗的操作`);
    }

    // 如果有失敗的操作，註冊重試同步
    if (failureCount > 0) {
      await registerRetrySync();
    }
  } catch (error) {
    console.error("[Background Sync] 同步離線佇列失敗:", error);
    throw error;
  }
}

// 處理單個佇列專案
async function processQueueItem(item) {
  const { endpoint, method, data, type, authToken, authType } = item;

  // 構建請求URL
  const baseUrl = self.location.origin;
  const url = endpoint.startsWith("/") ? `${baseUrl}/api${endpoint}` : `${baseUrl}/api/${endpoint}`;

  // 構建請求選項
  const options = {
    method: method || "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  // 新增認證資訊
  if (authToken && authType) {
    if (authType === "admin") {
      options.headers.Authorization = `Bearer ${authToken}`;
    } else if (authType === "apikey") {
      options.headers.Authorization = `ApiKey ${authToken}`;
    }
    console.log(`[Background Sync] 新增認證資訊: ${authType} (token長度: ${authToken.length})`);
  } else {
    console.warn(`[Background Sync] 缺少認證資訊: authToken=${!!authToken}, authType=${authType}`);
  }

  // 新增請求體
  if (data && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = typeof data === "string" ? data : JSON.stringify(data);
  }

  console.log(`[Background Sync] 傳送請求: ${method} ${url}`, { headers: options.headers, hasBody: !!options.body });

  // 傳送請求
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Background Sync] API請求失敗: ${response.status} ${response.statusText}`, errorText);
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  console.log(`[Background Sync] API請求成功:`, result);
  return result;
}

// 計算重試延遲（指數退避）
function calculateRetryDelay(retryCount) {
  const delay = SYNC_CONFIG.RETRY.INITIAL_DELAY * Math.pow(SYNC_CONFIG.RETRY.BACKOFF_MULTIPLIER, retryCount - 1);
  return Math.min(delay, SYNC_CONFIG.RETRY.MAX_DELAY);
}

// 註冊重試同步
async function registerRetrySync() {
  try {
    await self.registration.sync.register(SYNC_CONFIG.TAGS.RETRY_FAILED);
    console.log("[Background Sync] 重試同步已註冊");
  } catch (error) {
    console.error("[Background Sync] 註冊重試同步失敗:", error);
  }
}

// 通知客戶端同步完成 - 分層事件通訊架構的第1層
async function notifyClientsOfSyncCompletion(syncResult) {
  try {
    // 獲取所有活躍的客戶端頁面
    const clients = await self.clients.matchAll({
      includeUncontrolled: true,
      type: "window",
    });

    if (clients.length === 0) {
      console.log("[Background Sync] 沒有活躍的客戶端頁面需要通知");
      return;
    }

    // 構建標準化的通知訊息
    const message = {
      type: "PWA_SYNC_COMPLETED",
      payload: {
        syncType: syncResult.type,
        successCount: syncResult.successCount,
        failureCount: syncResult.failureCount,
        totalProcessed: syncResult.totalProcessed,
        syncedOperations: syncResult.syncedOperations || [],
        timestamp: syncResult.timestamp,
        source: "background-sync",
      },
    };

    // 向所有客戶端傳送通知
    const notificationPromises = clients.map((client) => {
      try {
        client.postMessage(message);
        return Promise.resolve();
      } catch (error) {
        console.error("[Background Sync] 向客戶端傳送訊息失敗:", error);
        return Promise.reject(error);
      }
    });

    await Promise.allSettled(notificationPromises);
    console.log(`[Background Sync] 已通知 ${clients.length} 個客戶端頁面同步完成`, syncResult);
  } catch (error) {
    console.error("[Background Sync] 通知客戶端失敗:", error);
  }
}

// 重試失敗的操作
async function retryFailedOperations() {
  try {
    console.log("[Background Sync] 開始重試失敗的操作");

    const queue = await syncStorage.getOfflineQueue();
    const retryItems = queue.filter((item) => item.status === "retry" && new Date(item.nextRetry) <= new Date());

    if (retryItems.length === 0) {
      console.log("[Background Sync] 沒有需要重試的操作");
      return;
    }

    console.log(`[Background Sync] 發現 ${retryItems.length} 個需要重試的操作`);

    // 將重試專案狀態重置為pending，讓主同步流程處理
    for (const item of retryItems) {
      await syncStorage.updateQueueItem(item.id, {
        status: "pending",
      });
    }

    // 觸發主同步流程
    await syncOfflineQueue();
  } catch (error) {
    console.error("[Background Sync] 重試失敗操作出錯:", error);
    throw error;
  }
}

// 同步應用資料（可擴充套件）
async function syncApplicationData() {
  try {
    console.log("[Background Sync] 開始同步應用資料");

    // 這裡可以新增其他應用資料的同步邏輯
    // 例如：使用者設定、快取更新等

    await syncStorage.updateSyncStatus({
      type: "application-data",
      status: "completed",
    });

    console.log("[Background Sync] 應用資料同步完成");
  } catch (error) {
    console.error("[Background Sync] 同步應用資料失敗:", error);
    throw error;
  }
}

// 訊息處理 - 與主應用通訊
self.addEventListener("message", async (event) => {
  const { type, data } = event.data || {};

  switch (type) {
    case "REGISTER_BACKGROUND_SYNC":
      try {
        await self.registration.sync.register(data.tag || SYNC_CONFIG.TAGS.OFFLINE_QUEUE);
        event.ports[0]?.postMessage({ success: true });
      } catch (error) {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      }
      break;

    case "GET_SYNC_STATUS":
      try {
        const queue = await syncStorage.getOfflineQueue();
        const pendingCount = queue.filter((item) => item.status === "pending").length;
        const failedCount = queue.filter((item) => item.status === "failed").length;

        event.ports[0]?.postMessage({
          success: true,
          data: { pendingCount, failedCount, totalCount: queue.length },
        });
      } catch (error) {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      }
      break;

    default:
      console.warn(`[Background Sync] 未知的訊息型別: ${type}`);
  }
});

console.log("[Background Sync] Service Worker 指令碼已載入");
