/**
 * CloudHarbor PWA 管理器
 * 基於 vite-plugin-pwa 官方標準實現
 * 完整的PWA功能：安裝、更新、離線儲存、狀態管理
 */

import { reactive, watch } from "vue";
import { useEventListener, useMediaQuery, useOnline } from "@vueuse/core";
import { showOfflineToast, hideOfflineToast } from "./offlineToast.js";
import { createLogger } from "@/utils/logger.js";

const OFFLINE_DB_VERSION = 6;
const log = createLogger("PWA");

// 獲取應用版本號
const getAppVersion = () => {
  return __APP_VERSION__ || "0.6.8";
};

// PWA 狀態管理 - 完整的狀態定義
export const pwaState = reactive({
  // 安裝相關
  isInstallable: false,
  isInstalled: false,
  deferredPrompt: null,

  // 更新相關
  isUpdateAvailable: false,
  isUpdating: false,
  needRefresh: false,
  updateError: null,

  // Service Worker 相關
  registration: null,
  swState: "unknown", // 'installing', 'waiting', 'active', 'redundant'

  // 網路狀態
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,

  // 版本資訊
  version: getAppVersion(),
  swVersion: null,

  // 快取狀態
  cacheStatus: "unknown", // 'caching', 'cached', 'error'

  // 推送通知狀態
  notificationPermission: "default", // 'default', 'granted', 'denied'
  pushSubscription: null,

  // 後臺同步狀態
  backgroundSyncSupported: false,
  syncInProgress: false,
  ready: false,
});

// 離線儲存管理
class OfflineStorage {
  constructor() {
    this.dbName = "CloudHarborOfflineDB";
    this.version = OFFLINE_DB_VERSION;
    this.db = null;
  }

  // 執行資料庫遷移策略
  performDatabaseMigration(db, oldVersion, newVersion) {
    log.debug(`執行資料庫遷移: ${oldVersion} -> ${newVersion}`);

    // 版本相容性檢查
    if (oldVersion > newVersion) {
      log.warn(`[PWA] 資料庫版本回退: ${oldVersion} -> ${newVersion}，可能存在相容性問題`);
    }

    // 建立基礎資料結構（適用於新安裝）
    this.createBaseObjectStores(db);

    //執行版本特定的遷移
    this.executeVersionSpecificMigrations(db, oldVersion, newVersion);
  }

  // 🎯 建立基礎資料結構
  createBaseObjectStores(db) {
    // 建立文字分享儲存
    if (!db.objectStoreNames.contains("pastes")) {
      log.debug("建立 pastes ObjectStore");
      const pasteStore = db.createObjectStore("pastes", { keyPath: "slug" });
      pasteStore.createIndex("created_at", "created_at", { unique: false });
      pasteStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 建立檔案資訊儲存
    if (!db.objectStoreNames.contains("files")) {
      log.debug("建立 files ObjectStore");
      const fileStore = db.createObjectStore("files", { keyPath: "slug" });
      fileStore.createIndex("created_at", "created_at", { unique: false });
      fileStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 建立目錄結構儲存
    if (!db.objectStoreNames.contains("directories")) {
      log.debug("建立 directories ObjectStore");
      const dirStore = db.createObjectStore("directories", { keyPath: "path" });
      dirStore.createIndex("lastModified", "lastModified", { unique: false });
      dirStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 建立使用者設定儲存
    if (!db.objectStoreNames.contains("settings")) {
      log.debug("建立 settings ObjectStore");
      db.createObjectStore("settings", { keyPath: "key" });
    }

    // 建立離線操作佇列儲存
    if (!db.objectStoreNames.contains("offlineQueue")) {
      log.debug("建立 offlineQueue ObjectStore");
      const queueStore = db.createObjectStore("offlineQueue", { keyPath: "id", autoIncrement: true });
      queueStore.createIndex("timestamp", "timestamp", { unique: false });
      queueStore.createIndex("type", "type", { unique: false });
    }

    // 建立搜尋歷史儲存
    if (!db.objectStoreNames.contains("searchHistory")) {
      log.debug("建立 searchHistory ObjectStore");
      const searchStore = db.createObjectStore("searchHistory", { keyPath: "id", autoIncrement: true });
      searchStore.createIndex("query", "query", { unique: false });
      searchStore.createIndex("timestamp", "timestamp", { unique: false });
    }
  }

  // 🎯 執行版本特定的遷移
  executeVersionSpecificMigrations(db, oldVersion, newVersion) {
    // 基礎版本5以下的遷移
    if (oldVersion < 5) {
      log.debug("執行基礎版本遷移");
      // 這裡可以新增資料遷移邏輯
    }

    // 版本685以上的新功能遷移（對應0.6.8版本）
    if (oldVersion < 685 && newVersion >= 685) {
      log.debug("執行0.6.8版本遷移");
      // 可以新增新功能的資料結構變更
    }

    // 未來版本的遷移可以在這裡新增
    // if (oldVersion < 700 && newVersion >= 700) { ... }
  }

  async init() {
    // 請求持久化儲存許可權
    if ("storage" in navigator && "persist" in navigator.storage) {
      try {
        const persistent = await navigator.storage.persist();
        log.debug(`持久化儲存: ${persistent ? "已啟用" : "未啟用"}`);
      } catch (error) {
        log.warn("[PWA] 無法請求持久化儲存:", error);
      }
    }

    return new Promise((resolve, reject) => {
      const openDatabase = (useExplicitVersion) => {
        let request;

        try {
          request = useExplicitVersion ? indexedDB.open(this.dbName, this.version) : indexedDB.open(this.dbName);
        } catch (error) {
          // 當請求的版本號小於已存在版本時，IndexedDB 可能會同步丟擲 VersionError
          if (useExplicitVersion && error && error.name === "VersionError") {
            log.warn(
              "[PWA] 本地離線資料庫版本高於當前程式碼要求，將跳過降級並使用現有版本繼續工作"
            );
            return openDatabase(false);
          }

          reject(error);
          return;
        }

        request.onerror = () => {
          const err = request.error;
          if (useExplicitVersion && err && err.name === "VersionError") {
            log.warn(
              "[PWA] 本地離線資料庫版本高於當前程式碼要求，將跳過降級並使用現有版本繼續工作"
            );
            return openDatabase(false);
          }

          reject(err);
        };

        request.onsuccess = () => {
          this.db = request.result;

          // 如果是使用現有版本開啟，可以同步當前實際版本號，方便日誌和後續檢查
          try {
            if (!useExplicitVersion && typeof this.db.version === "number") {
              this.version = this.db.version;
              log.debug(`使用現有離線資料庫版本: ${this.version}`);
            }
          } catch {
            // 僅用於除錯，不影響功能
          }

          resolve(this.db);
        };

        if (useExplicitVersion) {
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;
            const newVersion = event.newVersion;

            log.debug(`資料庫升級: ${oldVersion} -> ${newVersion}`);

            // 🎯 執行資料庫遷移策略
            this.performDatabaseMigration(db, oldVersion, newVersion);

            log.debug("資料庫升級完成");
          };
        }
      };

      // 首先嚐試使用當前程式碼宣告的版本號開啟資料庫；
      // 如果遇到 VersionError，則回退為“使用現有版本”開啟，避免降級錯誤。
      openDatabase(true);
    });
  }

  async savePaste(paste) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["pastes"], "readwrite");
    const store = transaction.objectStore("pastes");

    const pasteData = {
      ...paste,
      cachedAt: new Date().toISOString(),
      isOfflineCache: true,
    };

    return store.put(pasteData);
  }

  async getPaste(slug) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["pastes"], "readonly");
    const store = transaction.objectStore("pastes");

    return new Promise((resolve, reject) => {
      const request = store.get(slug);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveFile(file) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["files"], "readwrite");
    const store = transaction.objectStore("files");

    const fileData = {
      ...file,
      cachedAt: new Date().toISOString(),
      isOfflineCache: true,
    };

    return store.put(fileData);
  }

  async getFile(slug) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["files"], "readonly");
    const store = transaction.objectStore("files");

    return new Promise((resolve, reject) => {
      const request = store.get(slug);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveDirectory(path, data) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["directories"], "readwrite");
    const store = transaction.objectStore("directories");

    const dirData = {
      path,
      data,
      cachedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    return store.put(dirData);
  }

  async getDirectory(path) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["directories"], "readonly");
    const store = transaction.objectStore("directories");

    return new Promise((resolve, reject) => {
      const request = store.get(path);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSetting(key, value) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["settings"], "readwrite");
    const store = transaction.objectStore("settings");

    return store.put({ key, value, updatedAt: new Date().toISOString() });
  }

  async getSetting(key) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["settings"], "readonly");
    const store = transaction.objectStore("settings");

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async clearExpiredCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    // 7天
    if (!this.db) await this.init();

    const cutoffTime = new Date(Date.now() - maxAge).toISOString();
    const stores = ["pastes", "files", "directories"];

    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const index = store.index("cachedAt");

      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }

    // 清理過期的設定快取
    await this.clearExpiredSettings(maxAge);
  }

  async clearExpiredSettings(maxAge = 7 * 24 * 60 * 60 * 1000) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(["settings"], "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.getAll();

      request.onsuccess = () => {
        const settings = request.result;
        const cutoffTime = Date.now() - maxAge;

        settings.forEach((setting) => {
          if (setting.updatedAt) {
            const settingTime = new Date(setting.updatedAt).getTime();
            if (settingTime < cutoffTime && setting.key.startsWith("api_cache_")) {
              store.delete(setting.key);
            }
          }
        });
      };
    } catch (error) {
      log.warn("清理過期設定快取失敗:", error);
    }
  }

  async clearAllApiCache() {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(["settings"], "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.getAll();

      request.onsuccess = () => {
        const settings = request.result;

        settings.forEach((setting) => {
          if (
            setting.key.startsWith("api_cache_") ||
            setting.key.startsWith("admin_") ||
            setting.key.startsWith("user_") ||
            setting.key.startsWith("system_") ||
            setting.key.startsWith("test_") ||
            setting.key.startsWith("storage_config_") ||
            setting.key.startsWith("url_") ||
            setting.key.startsWith("public_file_") ||
            setting.key.startsWith("raw_paste_") ||
            setting.key === "storage_configs_list" ||
            setting.key === "url_info_cache"
          ) {
            store.delete(setting.key);
          }
        });
      };

      log.debug("所有API快取已清理");
    } catch (error) {
      log.warn("清理API快取失敗:", error);
    }
  }

  // 離線操作佇列方法
  async addToOfflineQueue(operation) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readwrite");
    const store = transaction.objectStore("offlineQueue");

    const queueItem = {
      ...operation,
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    return store.add(queueItem);
  }

  async getOfflineQueue() {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readonly");
    const store = transaction.objectStore("offlineQueue");

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromOfflineQueue(id) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readwrite");
    const store = transaction.objectStore("offlineQueue");

    return store.delete(id);
  }

  // 資料庫狀態檢查工具（除錯用）
  async checkDatabaseStatus() {
    if (!this.db) await this.init();

    const objectStores = Array.from(this.db.objectStoreNames);
    log.debug("資料庫狀態檢查:", {
      name: this.db.name,
      version: this.db.version,
      objectStores: objectStores,
    });

    return {
      name: this.db.name,
      version: this.db.version,
      objectStores: objectStores,
    };
  }
}

// 建立離線儲存例項
export const offlineStorage = new OfflineStorage();

// PWA 管理器類
class PWAManager {
  constructor() {
    this._networkListenersBound = false;
    this._installPromptListenersBound = false;
    this._vitePwaEventListenersBound = false;
    this._supplementaryListenersBound = false;
    this.readyPromise = this.init();
  }

  async init() {
    log.debug("初始化 PWA 管理器");

    // 1. 初始化離線儲存
    try {
      await offlineStorage.init();
      log.debug("離線儲存初始化成功");
    } catch (error) {
      log.error("[PWA] 離線儲存初始化失敗:", error);
    }

    // 2. 監聽網路狀態
    this.setupNetworkListeners();

    // 3. 監聽安裝提示
    this.setupInstallPrompt();

    // 4. 檢查是否已安裝
    this.checkInstallStatus();

    // 5. 設定 Service Worker 更新監聽
    this.setupServiceWorkerListeners();

    // 6. 初始化推送通知
    this.initPushNotifications();

    // 7. 檢查後臺同步支援
    this.checkBackgroundSyncSupport();

    log.debug("PWA 管理器初始化完成");
    pwaState.ready = true;
  }

  // 網路狀態監聽 - 整合offlineToast
  setupNetworkListeners() {
    if (this._networkListenersBound) return;
    this._networkListenersBound = true;

    const online = useOnline();

    const updateOnlineStatus = (isOnlineNow) => {
      const wasOffline = pwaState.isOffline;
      pwaState.isOffline = !isOnlineNow;

      log.debug(`網路狀態: ${isOnlineNow ? "線上" : "離線"}`);

      // 整合offlineToast顯示使用者友好的提示
      if (!isOnlineNow && !wasOffline) {
        // 剛剛離線 - 使用國際化文字
        showOfflineToast("您已離線，部分功能可能受限");
      } else if (isOnlineNow && wasOffline) {
        // 剛剛恢復線上
        hideOfflineToast();
        showOfflineToast("網路已恢復，正在同步資料...");

        // 3秒後隱藏恢復提示
        setTimeout(() => {
          hideOfflineToast();
        }, 3000);

        // 觸發資料同步
        this.syncOfflineData();
      }
    };

    watch(
      online,
      (isOnlineNow) => {
        updateOnlineStatus(isOnlineNow);
      },
      { immediate: true }
    );
  }

  // 同步離線資料 - 整合Background Sync API
  async syncOfflineData() {
    try {
      log.debug("開始同步離線資料");
      pwaState.syncInProgress = true;

      // 🎯 優先使用Background Sync API進行可靠同步
      if (pwaState.backgroundSyncSupported && pwaState.registration) {
        log.debug("使用Background Sync API進行同步");
        await this.triggerBackgroundSync();
      } else {
        log.debug("使用傳統同步方式");
        await this.fallbackSync();
      }

      pwaState.syncInProgress = false;
      log.debug("離線資料同步完成");
    } catch (error) {
      pwaState.syncInProgress = false;
      log.error("[PWA] 離線資料同步失敗:", error);
      showOfflineToast("資料同步失敗，請稍後重試");
    }
  }

  // 🎯 觸發Background Sync API同步
  async triggerBackgroundSync() {
    try {
      // 註冊後臺同步事件
      await pwaState.registration.sync.register("sync-offline-queue");
      log.debug("Background Sync 已註冊，等待瀏覽器排程");

      // 獲取同步狀態
      const syncStatus = await this.getBackgroundSyncStatus();
      log.debug("當前同步狀態:", syncStatus);
    } catch (error) {
      log.error("[PWA] Background Sync 註冊失敗，回退到傳統同步:", error);
      await this.fallbackSync();
    }
  }

  // 🎯 傳統同步方式（相容性回退）
  async fallbackSync() {
    // 處理離線操作佇列
    const offlineQueue = await offlineStorage.getOfflineQueue();

    if (offlineQueue && offlineQueue.length > 0) {
      log.debug(`發現 ${offlineQueue.length} 個離線操作待同步`);

      let successCount = 0;
      let failureCount = 0;
      const syncedOperations = [];

      for (const operation of offlineQueue) {
        try {
          await this.processOfflineOperation(operation);
          await offlineStorage.removeFromOfflineQueue(operation.id);
          successCount++;
          syncedOperations.push({
            type: operation.type,
            id: operation.id,
            timestamp: operation.timestamp,
          });
          log.debug(`離線操作同步成功: ${operation.type}`);
        } catch (error) {
          failureCount++;
          log.error(`[PWA] 離線操作同步失敗: ${operation.type}`, error);
        }
      }

      // 🎯 傳統同步完成後也傳送通知 - 確保UI更新
      if (successCount > 0 || failureCount > 0) {
        this.handleSyncCompletedMessage({
          syncType: "offline-queue",
          successCount,
          failureCount,
          totalProcessed: offlineQueue.length,
          syncedOperations,
          timestamp: new Date().toISOString(),
          source: "fallback-sync",
        });
      }
    }
  }

  // 處理單個離線操作 - 基於實際API介面
  async processOfflineOperation(operation) {
    const { type, data, endpoint, method } = operation;
    const { post, put, del } = await import("../api/client.js");

    switch (type) {
      // 📝 文字分享操作
      case "createPaste":
        return await post("/api/paste", data);

      // 📝 統一文字分享操作
      case "updatePaste":
        return await put(endpoint, data); // /api/pastes/:slug
      case "batchDeletePastes":
        return await del("/api/pastes/batch-delete", data);
      case "clearExpiredPastes":
        return await post("/api/pastes/clear-expired", data);

      // ⚙️ 系統管理操作
      case "updateGroupSettings":
        // endpoint 應該是 /api/admin/settings/group/:groupId
        return await put(endpoint, data);
      case "clearCache":
        return await post("/api/admin/cache/clear", data);

      // 🔐 檔案密碼驗證
      case "verifyFilePassword":
        return await post(endpoint, data);

      default:
        log.warn(`[PWA] 未知的離線操作型別: ${type}`);
        return null;
    }
  }

  setupInstallPrompt() {
    if (this._installPromptListenersBound) return;
    this._installPromptListenersBound = true;

    useEventListener(window, "beforeinstallprompt", (e) => {
      e.preventDefault();
      pwaState.deferredPrompt = e;
      pwaState.isInstallable = true;
      log.debug("應用可安裝");
    });

    useEventListener(window, "appinstalled", () => {
      pwaState.isInstalled = true;
      pwaState.isInstallable = false;
      pwaState.deferredPrompt = null;
      log.debug("應用已安裝");
    });
  }

  checkInstallStatus() {
    // 檢查是否在獨立模式下執行（已安裝）
    if (this._standaloneQueryBound) return;
    this._standaloneQueryBound = true;

    const isStandalone = useMediaQuery("(display-mode: standalone)");
    watch(
      isStandalone,
      (val) => {
        pwaState.isInstalled = Boolean(val);
      },
      { immediate: true }
    );
  }

  // Service Worker 監聽 - 統一使用vite-plugin-pwa標準事件
  setupServiceWorkerListeners() {
    if (!("serviceWorker" in navigator)) {
      log.warn("[PWA] Service Worker 不受支援");
      return;
    }

    // 優先使用vite-plugin-pwa標準事件，避免重複監聽
    this.setupVitePWAEventListeners();

    // 僅在必要時新增補充監聽，避免與vite-plugin-pwa衝突
    this.setupSupplementaryListeners();
  }

  // 設定vite-plugin-pwa標準事件監聽
  setupVitePWAEventListeners() {
    if (this._vitePwaEventListenersBound) return;
    this._vitePwaEventListenersBound = true;

    // 監聽vite-plugin-pwa的標準更新事件
    useEventListener(window, "vite:pwa-update-available", () => {
      pwaState.isUpdateAvailable = true;
      log.debug("檢測到應用更新（vite-plugin-pwa標準事件）");
      this.notifyUpdate();
    });

    // 監聽vite-plugin-pwa的其他標準事件
    useEventListener(window, "vite:pwa-updated", () => {
      pwaState.needRefresh = true;
      log.debug("應用已更新，需要重新整理");
    });

    useEventListener(window, "vite:pwa-offline-ready", () => {
      log.debug("應用已準備好離線使用");
      pwaState.cacheStatus = "cached";
    });

    // 監聽vite-plugin-pwa的錯誤事件
    useEventListener(window, "vite:pwa-error", (event) => {
      log.error("[PWA] vite-plugin-pwa錯誤:", event.detail);
      pwaState.updateError = event.detail?.message || "PWA更新錯誤";
    });
  }

  // 設定補充監聽器（僅在vite-plugin-pwa未覆蓋的場景）
  setupSupplementaryListeners() {
    if (this._supplementaryListenersBound) return;
    this._supplementaryListenersBound = true;

    // 監聽Service Worker訊息，包括同步完成通知
    useEventListener(navigator.serviceWorker, "message", (event) => {
      if (event.data && event.data.type === "SW_UPDATED") {
        // 這是來自自定義Service Worker的訊息，vite-plugin-pwa可能未處理
        pwaState.isUpdateAvailable = true;
        log.debug("檢測到應用更新（Service Worker訊息）");
        this.notifyUpdate();
      } else if (event.data && event.data.type === "PWA_SYNC_COMPLETED") {
        // 第2層：PWA Manager → 全域性事件系統
        // 接收Service Worker的同步完成通知並轉發為標準事件
        this.handleSyncCompletedMessage(event.data.payload);
      }
    });

    // 等待Service Worker註冊完成，獲取registration物件
    navigator.serviceWorker.ready
      .then((registration) => {
        pwaState.registration = registration;
        log.debug("Service Worker 已註冊");

        // 更新Service Worker狀態
        if (registration.active) {
          pwaState.swState = "active";
        }
      })
      .catch((error) => {
        log.error("[PWA] Service Worker 註冊失敗:", error);
        pwaState.updateError = error.message;
      });
  }

  // 通知更新可用
  notifyUpdate() {
    // 傳送自定義事件
    window.dispatchEvent(
      new CustomEvent("pwa-update-available", {
        detail: {
          version: pwaState.version,
          swVersion: pwaState.swVersion,
        },
      })
    );
  }

  // 處理同步完成訊息 - 分層事件通訊架構的第2層
  handleSyncCompletedMessage(payload) {
    try {
      log.debug("收到Service Worker同步完成通知", payload);

      // 更新PWA狀態
      pwaState.syncInProgress = false;

      // 傳送標準化的全域性事件 - 第2層：PWA Manager → 全域性事件系統
      const eventDetail = {
        syncType: payload.syncType,
        successCount: payload.successCount,
        failureCount: payload.failureCount,
        totalProcessed: payload.totalProcessed,
        syncedOperations: payload.syncedOperations || [],
        timestamp: payload.timestamp,
        source: payload.source,
      };

      // 傳送通用的同步完成事件
      window.dispatchEvent(
        new CustomEvent("pwa:sync-completed", {
          detail: eventDetail,
        })
      );

      // 根據同步型別傳送特定事件
      if (payload.syncType === "offline-queue") {
        window.dispatchEvent(
          new CustomEvent("pwa:offline-queue-synced", {
            detail: eventDetail,
          })
        );
      }

      log.debug("已傳送全域性同步完成事件", eventDetail);

      // 顯示使用者友好的提示
      if (payload.successCount > 0) {
        showOfflineToast(`成功同步 ${payload.successCount} 個離線操作`);
        setTimeout(() => {
          hideOfflineToast();
        }, 3000);

        // 全域性頁面重新整理機制
        // 檢查當前頁面是否需要重新整理資料
        this.refreshCurrentPageIfNeeded(payload.syncedOperations);
      }
    } catch (error) {
      log.error("[PWA] 處理同步完成訊息失敗:", error);
    }
  }

  // 智慧頁面重新整理機制 - 根據同步的操作型別重新整理相關頁面
  refreshCurrentPageIfNeeded(syncedOperations) {
    try {
      if (!syncedOperations || syncedOperations.length === 0) {
        return;
      }

      // 獲取當前頁面路徑
      const currentPath = window.location.pathname;
      log.debug("檢查頁面重新整理需求", { currentPath, syncedOperations });

      // 檢查是否有文字分享相關的同步操作
      const hasTextOperations = syncedOperations.some(
        (op) => op.type === "createPaste" || op.type === "updatePaste" || op.type === "batchDeletePastes" || op.type === "clearExpiredPastes"
      );

      // 如果當前在文字管理頁面且有文字相關操作，則重新整理頁面
      if (hasTextOperations && (currentPath.includes("/admin") || currentPath.includes("/management"))) {
        log.debug("檢測到文字管理頁面需要重新整理資料");

        // 使用溫和的頁面重新整理方式
        setTimeout(() => {
          window.location.reload();
        }, 1000); // 延遲1秒
      }

      // 可以根據需要新增其他頁面的重新整理邏輯
      // 例如：檔案管理頁面、系統設定頁面等
    } catch (error) {
      log.error("[PWA] 頁面重新整理檢查失敗:", error);
    }
  }

  // 清理應用快取
  clearApplicationCache() {
    try {
      // 清理 localStorage 中的臨時資料
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes("cache_") || key.includes("temp_"))) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
      log.debug(`已清理 ${keysToRemove.length} 個臨時儲存項`);
    } catch (error) {
      log.warn("[PWA] 清理應用快取失敗:", error);
    }
  }

  async installApp() {
    if (!pwaState.deferredPrompt) {
      log.warn("[PWA] 無法安裝應用：沒有安裝提示");
      return false;
    }

    try {
      pwaState.deferredPrompt.prompt();
      const { outcome } = await pwaState.deferredPrompt.userChoice;

      if (outcome === "accepted") {
        log.debug("使用者接受安裝");
        pwaState.isInstallable = false;
        return true;
      } else {
        log.debug("使用者拒絕安裝");
        return false;
      }
    } catch (error) {
      log.error("[PWA] 安裝失敗:", error);
      return false;
    } finally {
      pwaState.deferredPrompt = null;
    }
  }

  // 按照官方標準實現應用更新
  async updateApp() {
    try {
      pwaState.isUpdating = true;
      pwaState.updateError = null;
      log.debug("開始應用更新...");

      // autoUpdate模式：直接重新整理頁面應用更新
      if (pwaState.needRefresh) {
        log.debug("autoUpdate模式：重新整理頁面應用更新");
        this.reloadApp();
        return true;
      }

      // 如果有等待中的Service Worker，傳送skipWaiting訊息
      if (pwaState.registration && pwaState.registration.waiting) {
        log.debug("傳送skipWaiting訊息");
        pwaState.registration.waiting.postMessage({ type: "SKIP_WAITING" });
        return true;
      }

      log.warn("[PWA] 沒有可用的更新");
      return false;
    } catch (error) {
      log.error("[PWA] 更新應用失敗:", error);
      pwaState.updateError = error.message;
      pwaState.isUpdating = false;
      return false;
    }
  }

  // 檢查應用更新
  async checkForUpdate() {
    if (!pwaState.registration) {
      log.warn("[PWA] Service Worker 未註冊");
      return false;
    }

    try {
      log.debug("檢查應用更新...");
      await pwaState.registration.update();
      return true;
    } catch (error) {
      log.error("[PWA] 檢查更新失敗:", error);
      return false;
    }
  }

  // 強制重新整理頁面（更新後）
  reloadApp() {
    log.debug("重新載入應用以應用更新");
    window.location.reload();
  }

  // 初始化推送通知
  async initPushNotifications() {
    if (!("Notification" in window)) {
      log.warn("[PWA] 瀏覽器不支援推送通知");
      return;
    }

    // 檢查當前許可權狀態
    pwaState.notificationPermission = Notification.permission;
    log.debug(`通知許可權狀態: ${pwaState.notificationPermission}`);

    // 如果已授權，嘗試獲取推送訂閱
    if (pwaState.notificationPermission === "granted" && pwaState.registration) {
      try {
        const subscription = await pwaState.registration.pushManager.getSubscription();
        pwaState.pushSubscription = subscription;
        log.debug("推送訂閱狀態:", subscription ? "已訂閱" : "未訂閱");
      } catch (error) {
        log.error("[PWA] 獲取推送訂閱失敗:", error);
      }
    }
  }

  // 請求通知許可權
  async requestNotificationPermission() {
    if (!("Notification" in window)) {
      throw new Error("瀏覽器不支援推送通知");
    }

    try {
      const permission = await Notification.requestPermission();
      pwaState.notificationPermission = permission;

      if (permission === "granted") {
        log.debug("通知許可權已授予");
        await this.initPushNotifications();
        return true;
      } else {
        log.debug("通知許可權被拒絕");
        return false;
      }
    } catch (error) {
      log.error("[PWA] 請求通知許可權失敗:", error);
      throw error;
    }
  }

  // 檢查後臺同步支援
  checkBackgroundSyncSupport() {
    if ("serviceWorker" in navigator && "sync" in window.ServiceWorkerRegistration.prototype) {
      pwaState.backgroundSyncSupported = true;
      log.debug("後臺同步功能受支援");
    } else {
      pwaState.backgroundSyncSupported = false;
      log.debug("後臺同步功能不受支援");
    }
  }

  // 註冊後臺同步
  async registerBackgroundSync(tag) {
    if (!pwaState.backgroundSyncSupported || !pwaState.registration) {
      log.warn("[PWA] 後臺同步不可用");
      return false;
    }

    try {
      await pwaState.registration.sync.register(tag);
      log.debug(`後臺同步已註冊: ${tag}`);
      return true;
    } catch (error) {
      log.error("[PWA] 註冊後臺同步失敗:", error);
      return false;
    }
  }

  // 獲取Background Sync狀態
  async getBackgroundSyncStatus() {
    if (!pwaState.registration || !pwaState.registration.active) {
      return { error: "Service Worker未啟用" };
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      pwaState.registration.active.postMessage({ type: "GET_SYNC_STATUS" }, [messageChannel.port2]);

      // 設定超時
      setTimeout(() => {
        resolve({ error: "獲取狀態超時" });
      }, 5000);
    });
  }

  // 手動觸發Background Sync
  async triggerManualSync(tag = "sync-offline-queue") {
    if (!pwaState.backgroundSyncSupported || !pwaState.registration) {
      log.warn("[PWA] 後臺同步不可用，使用傳統同步");
      await this.fallbackSync();
      return false;
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      pwaState.registration.active.postMessage({ type: "REGISTER_BACKGROUND_SYNC", data: { tag } }, [messageChannel.port2]);

      // 設定超時
      setTimeout(() => {
        resolve({ success: false, error: "註冊超時" });
      }, 5000);
    });
  }
}

// 先定義物件避免迴圈依賴
export const pwaUtils = {
  // 狀態訪問
  state: pwaState,

  // 網路狀態
  isOnline: () => !pwaState.isOffline,
  isOffline: () => pwaState.isOffline,

  // 安裝相關
  isInstallable: () => pwaState.isInstallable,
  isInstalled: () => pwaState.isInstalled,
  install: () => log.warn("PWA安裝功能需要在PWA管理器初始化後使用"),

  // 更新相關
  isUpdateAvailable: () => pwaState.isUpdateAvailable,
  needRefresh: () => pwaState.needRefresh,
  isUpdating: () => pwaState.isUpdating,
  update: () => log.warn("PWA更新功能需要在PWA管理器初始化後使用"),
  checkForUpdate: () => log.warn("PWA檢查更新功能需要在PWA管理器初始化後使用"),
  reloadApp: () => window.location.reload(),

  // 版本資訊
  getVersion: () => pwaState.version,
  getSWVersion: () => pwaState.swVersion,

  // Service Worker 狀態
  getSWState: () => pwaState.swState,
  getRegistration: () => pwaState.registration,

  // 快取狀態
  getCacheStatus: () => pwaState.cacheStatus,

  // 推送通知相關
  getNotificationPermission: () => pwaState.notificationPermission,
  requestNotificationPermission: () => log.warn("PWA通知功能需要在PWA管理器初始化後使用"),
  getPushSubscription: () => pwaState.pushSubscription,

  // 後臺同步相關
  isBackgroundSyncSupported: () => pwaState.backgroundSyncSupported,
  isSyncInProgress: () => pwaState.syncInProgress,
  registerBackgroundSync: (tag) => log.warn("PWA後臺同步功能需要在PWA管理器初始化後使用"),
  getBackgroundSyncStatus: () => log.warn("PWA後臺同步狀態功能需要在PWA管理器初始化後使用"),
  triggerManualSync: (tag) => log.warn("PWA手動同步功能需要在PWA管理器初始化後使用"),

  // 離線儲存工具
  storage: {
    savePaste: (paste) => offlineStorage.savePaste(paste),
    getPaste: (slug) => offlineStorage.getPaste(slug),
    saveFile: (file) => offlineStorage.saveFile(file),
    getFile: (slug) => offlineStorage.getFile(slug),
    saveDirectory: (path, data) => offlineStorage.saveDirectory(path, data),
    getDirectory: (path) => offlineStorage.getDirectory(path),
    saveSetting: (key, value) => offlineStorage.saveSetting(key, value),
    getSetting: (key) => offlineStorage.getSetting(key),
    clearExpiredCache: () => offlineStorage.clearExpiredCache(),
    clearAllApiCache: () => offlineStorage.clearAllApiCache(),
    clearExpiredSettings: (maxAge) => offlineStorage.clearExpiredSettings(maxAge),

    // 離線操作佇列
    addToOfflineQueue: (operation) => offlineStorage.addToOfflineQueue(operation),
    getOfflineQueue: () => offlineStorage.getOfflineQueue(),
    removeFromOfflineQueue: (id) => offlineStorage.removeFromOfflineQueue(id),

    // 資料庫狀態檢查（除錯用）
    checkDatabaseStatus: () => offlineStorage.checkDatabaseStatus(),
  },
};

// 建立PWA管理器例項
const pwaManager = new PWAManager();

const bindManagerFunctions = () => {
  pwaUtils.install = () => pwaManager.installApp();
  pwaUtils.update = () => pwaManager.updateApp();
  pwaUtils.checkForUpdate = () => pwaManager.checkForUpdate();
  pwaUtils.requestNotificationPermission = () => pwaManager.requestNotificationPermission();
  pwaUtils.registerBackgroundSync = (tag) => pwaManager.registerBackgroundSync(tag);
  pwaUtils.getBackgroundSyncStatus = () => pwaManager.getBackgroundSyncStatus();
  pwaUtils.triggerManualSync = (tag) => pwaManager.triggerManualSync(tag);
  log.debug("功能繫結完成");
};

pwaManager.readyPromise
  .then(bindManagerFunctions)
  .catch((error) => {
    log.error("[PWA] 初始化失敗，部分PWA功能不可用:", error);
  });

// 匯出例項
export { pwaManager };
