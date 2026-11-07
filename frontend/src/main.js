import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import api, { getEnvironmentInfo } from "./api";
import i18n from "./i18n";
import router from "./router";
import MasonryWall from "@yeger/vue-masonry-wall";
import { createLogger } from "@/utils/logger.js";

// 匯入vue3-context-menu
import "@imengyu/vue3-context-menu/lib/vue3-context-menu.css";
import ContextMenu from "@imengyu/vue3-context-menu";

// 匯入 Notivue（全域性提示 / Toast）
import { createNotivue } from "notivue";
import "notivue/notification.css";
import "notivue/notification-progress.css";
import "notivue/animations.css";

// 匯入自定義指令
import { contextMenuDirective } from "./components/common/contextMenu.js";

const log = createLogger("Main");
const pwaLog = createLogger("PWA");

// 開發環境：清理舊的 Service Worker
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((registrations) => {
    registrations.forEach((reg) => reg.unregister());
  });
}

// 建立應用例項
const app = createApp(App);

// 建立Pinia例項
const pinia = createPinia();

// 新增全域性錯誤處理
app.config.errorHandler = (err, instance, info) => {
  log.error(`錯誤: ${err}`);
  log.error(`資訊: ${info}`);

  // 生產環境下可以考慮將錯誤傳送到後端記錄
  if (import.meta.env.PROD) {
    try {
      // 傳送錯誤到控制檯或後端API（如果有）
      log.warn("[生產環境錯誤]", {
        message: err.message,
        stack: err.stack,
        info,
        url: window.location.href,
        time: new Date().toISOString(),
      });
    } catch (e) {
      // 避免上報過程中出錯
      log.error("錯誤上報失敗:", e);
    }
  }

  // i18n特定錯誤處理
  if (err && err.message && (err.message.includes("i18n") || err.message.includes("vue-i18n") || err.message.includes("useI18n") || err.message.includes("translation"))) {
    log.warn("檢測到i18n相關錯誤:", err.message);
  }

  // 處理特定錯誤型別
  if (err && err.message) {
    // Vditor 編輯器相關錯誤
    if (err.message.includes("Cannot read properties of undefined")) {
      if (err.stack && err.stack.includes("Vditor")) {
        log.warn("檢測到Vditor編輯器屬性訪問錯誤，可能由於元件切換導致");
      } else {
        log.warn("檢測到屬性訪問錯誤，可能是元件生命週期問題");
      }
    }

    // 處理其他特定錯誤型別
    if (err.message.includes("currentMode") && err.stack && err.stack.includes("setValue")) {
      log.warn("編輯器值設定錯誤，可能是編輯器尚未完全初始化");
    }

    if (err.message.includes("element") && err.stack && err.stack.includes("destroy")) {
      log.warn("編輯器銷燬錯誤，可能是DOM已被清理");
    }
  }
};

// 掛載Pinia - 必須在其他外掛之前
app.use(pinia);

// 掛載i18n - 必須在掛載應用前使用
app.use(i18n);

// 掛載路由 - 在i18n之後掛載
app.use(router);

// 掛載MasonryWall元件 - 全域性註冊瀑布流元件
app.use(MasonryWall);

// 掛載vue3-context-menu - 全域性註冊上下文選單元件
app.use(ContextMenu);

// 掛載 Notivue - 全域性提示系統（右上角）
app.use(
  createNotivue({
    position: "top-right",
    limit: 4,
    enqueue: true,
    pauseOnHover: true,
    pauseOnTouch: true,
    avoidDuplicates: true,
    notifications: {
      global: {
        duration: 2000,
      },
      error: {
        duration: 5000,
      },
    },
  })
);

// 註冊自定義指令
app.directive("context-menu", contextMenuDirective);

// 匯入並初始化認證Store和站點配置Store
import { useAuthStore } from "./stores/authStore.js";
import { useSiteConfigStore } from "./stores/siteConfigStore.js";

// 匯入路由工具函式
import { routerUtils } from "./router";
import { useLocalStorage } from "@vueuse/core";

// 提供全域性 navigateTo 函式，保持向後相容
app.config.globalProperties.$navigateTo = routerUtils.navigateTo;
app.config.globalProperties.$routerUtils = routerUtils;

// 將API服務掛載到全域性物件，方便在元件中使用
app.config.globalProperties.$api = api;

// 在開發環境中輸出API配置資訊
if (import.meta.env.DEV) {
  log.debug("環境資訊:", getEnvironmentInfo());
}

const scheduleIdle = (fn) => {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return;
  }
  setTimeout(fn, 800);
};

scheduleIdle(async () => {
  try {
    const mod = await import("./pwa/pwaManager.js");
    const { pwaManager, pwaUtils } = mod || {};

    // 掛載 PWA 工具到全域性物件
    app.config.globalProperties.$pwa = pwaUtils;

    if (pwaManager) {
      pwaLog.debug("PWA管理器已初始化");
      pwaLog.debug("支援功能:", {
        安裝: pwaUtils?.isInstallable?.(),
        離線儲存: !!pwaUtils?.storage,
        版本: pwaUtils?.getVersion?.(),
        網路狀態: pwaUtils?.isOnline?.() ? "線上" : "離線",
      });
    }
  } catch (e) {
    pwaLog.warn("[PWA] 延遲載入失敗（不影響頁面使用）:", e);
  }
});

// 確保載入正確的語言
const savedLang = useLocalStorage("language", i18n.global.locale.value);
if (savedLang.value && i18n.global.locale.value !== savedLang.value) {
  i18n.global.locale.value = savedLang.value;
}

// 掛載應用
app.mount("#app");

// 初始化認證Store和站點配置Store（在應用掛載後）
const authStore = useAuthStore();
const siteConfigStore = useSiteConfigStore();

// 並行初始化兩個Store
Promise.all([authStore.initialize(), siteConfigStore.initialize()])
  .then(() => {
    log.debug("認證Store和站點配置Store初始化完成");
  })
  .catch((error) => {
    log.error("Store初始化失敗:", error);
  });
