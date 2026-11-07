/**
 * Vue Router 配置
 */

import { createRouter, createWebHistory } from "vue-router";
import OfflineFallback from "../components/OfflineFallback.vue";
import { showPageUnavailableToast } from "../pwa/offlineToast.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useSiteConfigStore } from "@/stores/siteConfigStore.js";
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("Router");

const isProbablyOffline = () => {
  return typeof navigator !== "undefined" && navigator.onLine === false;
};

// 懶載入元件 - 新增離線錯誤處理
const createOfflineAwareImport = (importFn, componentName = "頁面") => {
  return () =>
    importFn().catch((error) => {
      log.error("元件載入失敗:", error);

      NProgress.done();

      // 如果是離線狀態且載入失敗，顯示離線回退頁面和Toast提示
      if (isProbablyOffline()) {
        log.debug("[離線模式] 元件未快取，顯示離線回退頁面");

        // 顯示Toast提示
        setTimeout(() => {
          showPageUnavailableToast(componentName);
        }, 100);

        return OfflineFallback;
      }

      // 線上狀態下的載入失敗，重新丟擲錯誤
      throw error;
    });
};

const HomeView = createOfflineAwareImport(() => import("../modules/paste/editor/MarkdownEditorView.vue"), "首頁");
const UploadView = createOfflineAwareImport(() => import("../modules/upload/public/UploadView.vue"), "檔案上傳頁面");
const PasteView = createOfflineAwareImport(() => import("../modules/paste/public/PasteView.vue"), "文字分享頁面");
const FileView = createOfflineAwareImport(() => import("../modules/fileshare/public/FileView.vue"), "檔案預覽頁面");
const MountExplorerView = createOfflineAwareImport(() => import("../modules/fs/MountExplorerView.vue"), "掛載瀏覽器");

// 路由配置 - 完全對應原有的頁面邏輯
const routes = [
  {
    path: "/",
    name: "Home",
    component: HomeView,
    meta: {
      title: "CloudHarbor - 線上剪貼簿",
      originalPage: "home",
    },
  },
  {
    path: "/upload",
    name: "Upload",
    component: UploadView,
    meta: {
      title: "檔案上傳 - CloudHarbor",
      originalPage: "upload",
    },
  },
  // 管理員登入頁面
  {
    path: "/admin/login",
    name: "AdminLogin",
    component: createOfflineAwareImport(() => import("../modules/admin/views/AdminLoginView.vue"), "管理員登入"),
    meta: {
      title: "登入 - CloudHarbor",
      originalPage: "admin-login",
    },
  },
  // 管理面板
  {
    path: "/admin",
    component: createOfflineAwareImport(() => import("../modules/admin/views/AdminLayout.vue"), "管理面板佈局"),
    meta: {
      title: "管理面板 - CloudHarbor",
      originalPage: "admin",
      requiresAuth: true,
    },
    children: [
      {
        path: "dashboard",
        name: "AdminDashboard",
        component: createOfflineAwareImport(() => import("../modules/admin/views/DashboardView.vue"), "儀表板"),
        meta: {
          title: "儀表板 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "text-management",
        name: "AdminTextManagement",
        component: createOfflineAwareImport(() => import("../modules/paste/admin/TextManagementView.vue"), "文字管理"),
        meta: {
          title: "文字管理 - CloudHarbor",
          requiredPermissions: ["text"], // 需要文字許可權
        },
      },
      {
        path: "file-management",
        name: "AdminFileManagement",
        component: createOfflineAwareImport(() => import("../modules/fileshare/admin/FileManagementView.vue"), "檔案管理"),
        meta: {
          title: "檔案管理 - CloudHarbor",
          requiredPermissions: ["file"], // 需要檔案許可權
        },
      },
      {
        path: "key-management",
        name: "AdminKeyManagement",
        component: createOfflineAwareImport(() => import("../modules/admin/views/KeyManagementView.vue"), "金鑰管理"),
        meta: {
          title: "金鑰管理 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "mount-management",
        name: "AdminMountManagement",
        component: createOfflineAwareImport(() => import("../modules/admin/views/MountManagementView.vue"), "掛載管理"),
        meta: {
          title: "掛載管理 - CloudHarbor",
          requiredPermissions: ["mount"], // 需要掛載許可權
        },
      },
      {
        path: "fs-meta-management",
        name: "AdminFsMetaManagement",
        component: createOfflineAwareImport(() => import("../modules/admin/views/FsMetaManagementView.vue"), "元資訊管理"),
        meta: {
          title: "元資訊管理 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "storage",
        name: "AdminStorage",
        component: createOfflineAwareImport(() => import("../modules/admin/views/StorageConfigView.vue"), "儲存管理"),
        meta: {
          title: "儲存管理 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "storage-config",
        redirect: { name: "AdminStorage" },
        meta: {
          adminOnly: true,
        },
      },
      {
        path: "scheduled-jobs",
        name: "AdminScheduledJobs",
        component: createOfflineAwareImport(() => import("../modules/admin/views/ScheduledJobsView.vue"), "定時任務管理"),
        meta: {
          title: "定時任務管理 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "scheduled-jobs/create",
        name: "AdminScheduledJobCreate",
        component: createOfflineAwareImport(() => import("../modules/admin/views/ScheduledJobFormView.vue"), "建立定時任務"),
        meta: {
          title: "建立定時任務 - CloudHarbor",
          adminOnly: true,
        },
      },
      {
        path: "scheduled-jobs/:id/edit",
        name: "AdminScheduledJobEdit",
        component: createOfflineAwareImport(() => import("../modules/admin/views/ScheduledJobFormView.vue"), "編輯定時任務"),
        meta: {
          title: "編輯定時任務 - CloudHarbor",
          adminOnly: true,
        },
      },
      {
        path: "account",
        name: "AdminAccountManagement",
        component: createOfflineAwareImport(() => import("../modules/admin/views/AccountManagementView.vue"), "賬號管理"),
        meta: {
          title: "賬號管理 - CloudHarbor",
          requiresAuth: true, // 管理員和API金鑰使用者都可訪問
        },
      },
      {
        path: "backup",
        name: "AdminBackup",
        component: createOfflineAwareImport(() => import("../modules/admin/views/BackupView.vue"), "資料備份"),
        meta: {
          title: "資料備份 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "tasks",
        name: "AdminTasks",
        component: createOfflineAwareImport(() => import("../modules/admin/views/AdminTasksView.vue"), "任務管理"),
        meta: {
          title: "任務管理 - CloudHarbor",
          requiredPermissions: ["mount"],
        },
      },
      {
        path: "fs-index",
        name: "AdminFsIndexManagement",
        component: createOfflineAwareImport(() => import("../modules/admin/views/FsIndexManagement.vue"), "檔案系統索引管理"),
        meta: {
          title: "索引管理 - CloudHarbor",
          adminOnly: true, // 只有管理員可訪問
        },
      },
      {
        path: "settings",
        children: [
          {
            path: "global",
            name: "AdminGlobalSettings",
            component: createOfflineAwareImport(() => import("../modules/admin/views/settings/GlobalSettingsView.vue"), "全域性設定"),
            meta: {
              title: "全域性設定 - CloudHarbor",
              adminOnly: true, // 只有管理員可訪問
            },
          },

          {
            path: "webdav",
            name: "AdminWebDAVSettings",
            component: createOfflineAwareImport(() => import("../modules/admin/views/settings/WebDAVSettingsView.vue"), "WebDAV設定"),
            meta: {
              title: "WebDAV設定 - CloudHarbor",
              adminOnly: true, // 只有管理員可訪問
            },
          },
          {
            path: "preview",
            name: "AdminPreviewSettings",
            component: createOfflineAwareImport(() => import("../modules/admin/views/settings/PreviewSettingsView.vue"), "預覽設定"),
            meta: {
              title: "預覽設定 - CloudHarbor",
              adminOnly: true, // 只有管理員可訪問
            },
          },
          {
            path: "site",
            name: "AdminSiteSettings",
            component: createOfflineAwareImport(() => import("../modules/admin/views/settings/SiteSettingsView.vue"), "站點設定"),
            meta: {
              title: "站點設定 - CloudHarbor",
              adminOnly: true, // 只有管理員可訪問
            },
          },
        ],
      },
    ],
  },
  {
    path: "/paste/:slug",
    name: "PasteView",
    component: PasteView,
    props: true,
    meta: {
      title: "檢視分享 - CloudHarbor",
      originalPage: "paste-view",
    },
  },
  {
    path: "/file/:slug",
    name: "FileView",
    component: FileView,
    props: true,
    meta: {
      title: "檔案預覽 - CloudHarbor",
      originalPage: "file-view",
    },
  },
  {
    path: "/mount-explorer",
    name: "MountExplorer",
    component: MountExplorerView,
    props: (route) => ({
      darkMode: route.meta.darkMode || false,
    }),
    meta: {
      title: "掛載瀏覽 - CloudHarbor",
      originalPage: "mount-explorer",
    },
  },
  {
    path: "/mount-explorer/:pathMatch(.*)+",
    name: "MountExplorerPath",
    component: MountExplorerView,
    props: (route) => ({
      darkMode: route.meta.darkMode || false,
    }),
    meta: {
      title: "掛載瀏覽 - CloudHarbor",
      originalPage: "mount-explorer",
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    redirect: "/",
    meta: {
      title: "頁面未找到 - CloudHarbor",
    },
  },
];

// 建立路由例項
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // MountExplorer 的滾動由頁面自身管理（用於“預覽 ↔ 列表”保持原位/恢復）
    const isMountExplorer = (r) => r?.name === "MountExplorer" || r?.name === "MountExplorerPath";
    if (isMountExplorer(to) && isMountExplorer(from)) {
      // 返回 false：表示不做任何自動滾動處理，保持當前滾動
      return false;
    }

    // 瀏覽器前進/後退：優先使用瀏覽器提供的滾動位置
    if (savedPosition) return savedPosition;

    // 其它頁面：保持預設“進新頁回到頂部”的行為
    return { top: 0 };
  },
});

const normalizeFsPathForMountExplorer = (path) => {
  const raw = typeof path === "string" && path ? path : "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  const collapsed = withLeading.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "");
};

const buildMountExplorerRoutePath = (fsPath) => {
  const normalized = normalizeFsPathForMountExplorer(fsPath);
  if (normalized === "/") return "/mount-explorer";
  const segments = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
  return `/mount-explorer/${segments.map((seg) => encodeURIComponent(seg)).join("/")}`;
};

// 配置NProgress - 遵循官方預設值
NProgress.configure({
  showSpinner: false, // 隱藏旋轉器
});

// 許可權檢查工具函式
const hasRoutePermission = (route, authStore) => {
  // 檢查是否只有管理員可訪問
  if (route.meta?.adminOnly) {
    return authStore.isAdmin;
  }

  // 檢查是否需要特定許可權
  if (route.meta?.requiredPermissions) {
    return route.meta.requiredPermissions.some((permission) => {
      switch (permission) {
        case "text":
          return authStore.hasTextManagePermission;
        case "file":
          return authStore.hasFileManagePermission;
        case "mount":
          return authStore.hasMountPermission;
        default:
          return false;
      }
    });
  }

  // 預設允許訪問
  return true;
};

// 前臺入口開關
const isPublicEntryDisabled = (pageKey, siteConfigStore) => {
  if (!siteConfigStore?.isInitialized) return false;
  if (pageKey === "home") return siteConfigStore.siteHomeEditorEnabled === false;
  if (pageKey === "upload") return siteConfigStore.siteUploadPageEnabled === false;
  if (pageKey === "mount-explorer") return siteConfigStore.siteMountExplorerEnabled === false;
  return false;
};

// 禁用頁面時的預設落點：優先跳到仍然開啟的公開頁面；全關則跳管理入口
const getFallbackRoute = (authStore, siteConfigStore) => {
  if (!siteConfigStore?.isInitialized) {
    return { name: "Home" };
  }

  if (siteConfigStore.siteHomeEditorEnabled) return { name: "Home" };
  if (siteConfigStore.siteUploadPageEnabled) return { name: "Upload" };
  if (siteConfigStore.siteMountExplorerEnabled) return { name: "MountExplorer" };

  // 三個入口都關了：讓使用者進管理入口（未登入會自動去登入頁）
  if (authStore?.isAuthenticated) return { path: "/admin" };
  return { name: "AdminLogin" };
};

const dispatchPublicEntryDisabledMessage = () => {
  try {
    window.dispatchEvent(
      new CustomEvent("global-message", {
        detail: {
          type: "warning",
          content: "該頁面已被管理員關閉，已為你跳轉到其它頁面。（This page is disabled and you have been redirected.）",
          duration: 2500,
        },
      })
    );
  } catch {}
};

// 獲取使用者預設路由
const getDefaultRouteForUser = (authStore) => {
  if (authStore.isAdmin) {
    return "AdminDashboard";
  }

  // API金鑰使用者：根據許可權確定預設頁面
  if (authStore.authType === "apikey") {
    // 按優先順序檢查許可權
    if (authStore.hasTextManagePermission) {
      return "AdminTextManagement";
    }

    if (authStore.hasFileManagePermission) {
      return "AdminFileManagement";
    }

    if (authStore.hasMountPermission) {
      return "AdminMountManagement";
    }

    // 沒有任何功能許可權，預設到賬戶管理頁面
    return "AdminAccountManagement";
  }

  // 其他情況
  return null;
};

// 路由守衛 - 使用認證Store進行主動許可權驗證
router.beforeEach(async (to, from, next) => {
  // 啟動進度條
  NProgress.start();

  try {
    const authStore = useAuthStore();
    const siteConfigStore = useSiteConfigStore();

    // 確保初始化完成，避免重新整理時的認證閃爍
    if (!authStore.initialized) {
      await authStore.initialize();
    }

    // 確保站點配置已初始化：用於“前臺入口開關（隱藏入口 + 禁止訪問路由）”
    if (!siteConfigStore.isInitialized && typeof siteConfigStore.initialize === "function") {
      await siteConfigStore.initialize();
    }

    // 自動遊客會話：在首次未認證狀態下嘗試一次基於 Guest API Key 的登入
    // 統一在任意路由入口觸發一次（包括 /admin 相關路由），由 maybeAutoGuestLogin 自身透過 guestAutoTried 控制只嘗試一次
    if (!authStore.isAuthenticated && authStore.authType === "none") {
      if (typeof authStore.maybeAutoGuestLogin === "function") {
        await authStore.maybeAutoGuestLogin();
      }
    }

    // 如果需要認證且認證狀態需要重新驗證，則進行驗證
    if (to.meta.requiresAuth && authStore.needsRevalidation) {
      log.debug("路由守衛：需要重新驗證認證狀態");
      await authStore.validateAuth();
    }

    // ===== 公開頁面入口開關 =====
    const pageKey = to.meta?.originalPage;
    if (typeof pageKey === "string" && isPublicEntryDisabled(pageKey, siteConfigStore)) {
      log.debug("路由守衛：公開頁面入口已關閉，執行跳轉", { pageKey, to: to.fullPath });
      dispatchPublicEntryDisabledMessage();
      NProgress.done();
      next(getFallbackRoute(authStore, siteConfigStore));
      return;
    }

    // 登入頁面訪問控制
    if (to.name === "AdminLogin") {
      if (authStore.isAuthenticated) {
        log.debug("路由守衛：已認證使用者訪問登入頁面，重定向到合適的管理頁面");
        const defaultRoute = getDefaultRouteForUser(authStore);
        NProgress.done();
        if (defaultRoute) {
          next({ name: defaultRoute });
        } else {
          next({ name: "Home" });
        }
        return;
      }
      // 未認證使用者可以訪問登入頁面
      next();
      return;
    }

    // 管理頁面許可權檢查 - 檢查是否是admin路由或其子路由
    if (to.meta.requiresAuth && (to.path.startsWith("/admin") || to.matched.some((record) => record.path.startsWith("/admin")))) {
      if (!authStore.isAuthenticated) {
        log.debug("路由守衛：使用者未認證，重定向到登入頁面");
        NProgress.done();
        next({ name: "AdminLogin", query: { redirect: to.fullPath } });
        return;
      }

      // 檢查是否有管理許可權（管理員或任何已認證的API金鑰使用者）
      // API金鑰使用者需要能夠訪問管理面板進行登出操作，具體許可權在頁面級別控制
      const hasManagementAccess = authStore.isAdmin || authStore.authType === "apikey";

      if (!hasManagementAccess) {
        log.debug("路由守衛：使用者無管理許可權，重定向到首頁");
        NProgress.done();
        next({ name: "Home" });
        return;
      }

      // 處理 /admin 根路徑訪問，進行智慧重定向
      if (to.path === "/admin") {
        log.debug("路由守衛：訪問 /admin 根路徑，進行重定向");
        log.debug("路由守衛：使用者許可權詳情", {
          authType: authStore.authType,
          isAdmin: authStore.isAdmin,
          hasTextSharePermission: authStore.hasTextSharePermission,
          hasFileSharePermission: authStore.hasFileSharePermission,
          hasMountPermission: authStore.hasMountPermission,
          apiKeyPermissions: authStore.apiKeyPermissions,
        });
        const defaultRoute = getDefaultRouteForUser(authStore);
        NProgress.done();
        if (defaultRoute) {
          log.debug("路由守衛：重定向到預設頁面", defaultRoute);
          next({ name: defaultRoute });
        } else {
          log.debug("路由守衛：使用者無任何管理許可權，重定向到首頁");
          next({ name: "Home" });
        }
        return;
      }

      // 頁面級許可權檢查和智慧重定向
      if (to.name && to.name.startsWith("Admin")) {
        // 檢查使用者是否有訪問目標頁面的許可權
        if (!hasRoutePermission(to, authStore)) {
          log.debug("路由守衛：使用者無許可權訪問目標頁面，進行智慧重定向", {
            targetRoute: to.name,
            userPermissions: {
              isAdmin: authStore.isAdmin,
              hasTextManagePermission: authStore.hasTextManagePermission,
              hasFileManagePermission: authStore.hasFileManagePermission,
              hasMountPermission: authStore.hasMountPermission,
            },
          });

          // 獲取使用者預設路由
          const defaultRoute = getDefaultRouteForUser(authStore);
          NProgress.done();
          if (defaultRoute) {
            log.debug("路由守衛：重定向到預設頁面", defaultRoute);
            next({ name: defaultRoute });
          } else {
            log.debug("路由守衛：使用者無任何管理許可權，重定向到首頁");
            next({ name: "Home" });
          }
          return;
        }

        // 特殊處理：如果訪問 /admin 根路徑，重定向到合適的頁面
        if (to.name === "AdminDashboard" && !authStore.isAdmin) {
          log.debug("路由守衛：API金鑰使用者訪問儀表板，重定向到預設頁面");
          const defaultRoute = getDefaultRouteForUser(authStore);
          if (defaultRoute && defaultRoute !== "AdminDashboard") {
            NProgress.done();
            next({ name: defaultRoute });
            return;
          }
        }
      }

      log.debug("路由守衛：管理許可權驗證透過", {
        isAdmin: authStore.isAdmin,
        authType: authStore.authType,
        isGuest: authStore.isGuest,
        hasTextManagePermission: authStore.hasTextManagePermission,
        hasFileManagePermission: authStore.hasFileManagePermission,
        hasMountPermission: authStore.hasMountPermission,
      });
    }

    // 掛載瀏覽器頁面許可權檢查
    if (to.name === "MountExplorer" || to.name === "MountExplorerPath") {
      // 移除自動重定向邏輯，讓元件自己處理許可權顯示
      // 這樣使用者可以看到友好的"無許可權"提示而不是突然被重定向

      log.debug("路由守衛：掛載頁面訪問", {
        isAuthenticated: authStore.isAuthenticated,
        hasMountPermission: authStore.hasMountPermission,
        authType: authStore.authType,
      });

      // 只對有掛載許可權的API金鑰使用者進行路徑許可權檢查
      const isKeyLikeUser = authStore.isKeyUser;
      if (isKeyLikeUser && authStore.hasMountPermission && to.params.pathMatch) {
        const requestedPath = "/" + (Array.isArray(to.params.pathMatch) ? to.params.pathMatch.join("/") : to.params.pathMatch);
        if (!authStore.hasPathPermission(requestedPath)) {
          log.debug("路由守衛：使用者無此路徑許可權，重定向到基本路徑");
          const basePath = authStore.userInfo.basicPath || "/";
          const redirectPath = buildMountExplorerRoutePath(basePath);
          NProgress.done();
          next({ path: redirectPath });
          return;
        }
      }
    }

    next();
  } catch (error) {
    log.error("路由守衛錯誤:", error);
    NProgress.done();
    // 發生錯誤時允許繼續，避免阻塞路由
    next();
  }
});

// 路由錯誤處理
router.onError((error) => {
  log.error("路由錯誤:", error);

  NProgress.done();

  // 如果是離線狀態下的元件載入失敗，不需要額外處理
  // 因為 createOfflineAwareImport 已經處理了
  if (pwaState.isOffline) {
    log.debug("[離線模式] 路由錯誤已由離線回退機制處理");
    return;
  }

  // 線上狀態下的其他錯誤，可以新增額外的錯誤處理邏輯
  log.error("線上狀態下的路由錯誤:", error);
});

// 路由後置守衛 - 處理頁面標題和除錯資訊
router.afterEach(async (to, from) => {
  // 完成進度條
  NProgress.done();
  // 動態設定頁面標題，支援國際化和站點配置
  let title = "CloudHarbor";
  let siteTitle = "CloudHarbor";

  try {
    // 動態匯入站點配置Store
    const { useSiteConfigStore } = await import("../stores/siteConfigStore.js");
    const siteConfigStore = useSiteConfigStore();

    // 獲取站點標題（如果store已初始化）
    if (siteConfigStore.isInitialized) {
      siteTitle = siteConfigStore.siteTitle || "CloudHarbor";
    }

    // 動態匯入 i18n 例項
    const { default: i18n } = await import("../i18n/index.js");
    const { t } = i18n.global;

    // 根據路由名稱設定對應的國際化標題
    switch (to.name) {
      case "Home":
        title = `${siteTitle} - ${t("pageTitle.homeSubtitle")}`;
        break;
      case "Upload":
        title = `${t("pageTitle.uploadSubtitle")} - ${siteTitle}`;
        break;
      case "AdminDashboard":
        title = `${t("pageTitle.adminModules.dashboard")} - ${siteTitle}`;
        break;
      case "AdminTextManagement":
        title = `${t("pageTitle.adminModules.textManagement")} - ${siteTitle}`;
        break;
      case "AdminFileManagement":
        title = `${t("pageTitle.adminModules.fileManagement")} - ${siteTitle}`;
        break;
      case "AdminStorage":
        title = `${t("pageTitle.adminModules.storageConfig")} - ${siteTitle}`;
        break;
      case "AdminMountManagement":
        title = `${t("pageTitle.adminModules.mountManagement")} - ${siteTitle}`;
        break;
      case "AdminFsMetaManagement":
        title = `${t("pageTitle.adminModules.fsMetaManagement")} - ${siteTitle}`;
        break;
      case "AdminKeyManagement":
        title = `${t("pageTitle.adminModules.keyManagement")} - ${siteTitle}`;
        break;
      case "AdminGlobalSettings":
        title = `${t("pageTitle.adminModules.globalSettings")} - ${siteTitle}`;
        break;
      case "AdminPreviewSettings":
        title = `${t("pageTitle.adminModules.previewSettings")} - ${siteTitle}`;
        break;
      case "AdminAccountSettings":
        title = `${t("pageTitle.adminModules.accountSettings")} - ${siteTitle}`;
        break;
      case "AdminAccountManagement":
        title = `${t("pageTitle.adminModules.accountSettings")} - ${siteTitle}`;
        break;
      case "AdminWebDAVSettings":
        title = `${t("pageTitle.adminModules.webdavSettings")} - ${siteTitle}`;
        break;
      case "AdminSiteSettings":
        title = `${t("pageTitle.adminModules.siteSettings")} - ${siteTitle}`;
        break;
      case "AdminBackup":
        title = `${t("pageTitle.adminModules.backup")} - ${siteTitle}`;
        break;
      case "AdminTasks":
        title = `${t("pageTitle.adminModules.tasks")} - ${siteTitle}`;
        break;
      case "PasteView":
        title = `${t("pageTitle.pasteViewSubtitle")} - ${siteTitle}`;
        break;
      case "FileView":
        title = `${t("pageTitle.fileViewSubtitle")} - ${siteTitle}`;
        break;
      case "MountExplorer":
      case "MountExplorerPath":
        title = `${t("pageTitle.mountExplorerSubtitle")} - ${siteTitle}`;
        break;
      case "NotFound":
        title = `${t("pageTitle.notFoundSubtitle")} - ${siteTitle}`;
        break;
      default:
        title = to.meta?.title || siteTitle;
    }
  } catch (error) {
    log.warn("無法載入國際化標題或站點配置，使用預設標題:", error);
    title = to.meta?.title || "CloudHarbor";
  }

  document.title = title;

  const fromPage = from.meta?.originalPage || "unknown";
  const toPage = to.meta?.originalPage || "unknown";
  log.debug(`頁面從 ${fromPage} 切換到 ${toPage}`);

  try {
    const authStore = useAuthStore();
    log.debug(`頁面切換後許可權狀態: 認證型別=${authStore.authType}, 已認證=${authStore.isAuthenticated}, 管理員=${authStore.isAdmin}`);
  } catch (error) {
    log.warn("無法獲取認證狀態:", error);
  }

  // 保持原有的路徑日誌
  log.debug("路徑變化檢測:", to.path);
});

// 匯出路由例項
export default router;

// 匯出工具函式
export const routerUtils = {
  /**
   * 導航到指定頁面
   * @param {string} page - 頁面名稱 ('home', 'upload', 'admin', 'paste-view', 'file-view', 'mount-explorer')
   * @param {object} options - 可選引數 (如 slug, path, module)
   */
  navigateTo(page, options = {}) {
    const routeMap = {
      home: { name: "Home" },
      upload: { name: "Upload" },
      admin: { name: "Admin" },
      "paste-view": {
        name: "PasteView",
        params: { slug: options.slug || options.pasteSlug },
      },
      "file-view": {
        name: "FileView",
        params: { slug: options.slug || options.fileSlug },
      },
      "mount-explorer": { name: "MountExplorer" },
    };

    const route = routeMap[page];
    if (route) {
      // 特殊處理 admin 的模組引數
      if (page === "admin") {
        if (options.module && options.module !== "dashboard") {
          // 處理巢狀路由，如 settings/global
          if (options.module.includes("/")) {
            router.push(`/admin/${options.module}`);
          } else {
            router.push(`/admin/${options.module}`);
          }
        } else {
          router.push("/admin");
        }
        return;
      }

      // 特殊處理 mount-explorer 的路徑引數
      if (page === "mount-explorer") {
        const routePath = buildMountExplorerRoutePath(options.path || "/");
        router.push({ path: routePath });
        return;
      }

      router.push(route);
    } else {
      log.warn(`未知頁面: ${page}`);
      router.push({ name: "Home" });
    }
  },

  /**
   * 獲取當前頁面名稱
   */
  getCurrentPage() {
    return router.currentRoute.value.meta?.originalPage || "home";
  },

  /**
   * 檢查是否為指定頁面
   */
  isCurrentPage(page) {
    return this.getCurrentPage() === page;
  },

  /**
   * 獲取當前路由的 slug 引數
   */
  getCurrentSlug() {
    return router.currentRoute.value.params.slug || null;
  },
};
