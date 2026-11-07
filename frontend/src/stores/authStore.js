/**
 * 統一認證狀態管理Store
 * 使用Pinia管理所有認證相關狀態，實現主動許可權驗證
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { api } from "@/api";
import { Permission, PermissionChecker } from "@/constants/permissions.js";
import { registerAuthBridge } from "./authBridge.js";
import { createLogger } from "@/utils/logger.js";

// 配置常量
const REVALIDATION_INTERVAL = 5 * 60 * 1000; // 5分鐘
const STORAGE_KEYS = {
  ADMIN_TOKEN: "admin_token",
  API_KEY: "api_key",
  API_KEY_PERMISSIONS: "api_key_permissions",
  API_KEY_INFO: "api_key_info",
};

export const useAuthStore = defineStore("auth", () => {
  const log = createLogger("AuthStore");
  // ===== 狀態定義 =====

  // 認證狀態
  const isAuthenticated = ref(false);
  const authType = ref("none"); // 'none' | 'admin' | 'apikey'
  const isLoading = ref(false);
  const guestAutoTried = ref(false);
  const lastValidated = ref(null);
  const initialized = ref(false);

  // 管理員相關狀態
  const adminToken = ref(null);

  // API金鑰相關狀態
  const apiKey = ref(null);
  const apiKeyInfo = ref(null);
  // 使用位標誌許可權系統
  const apiKeyPermissions = ref(0); // 位標誌許可權值
  const apiKeyPermissionDetails = ref({
    text_share: false,
    text_manage: false,
    file_share: false,
    file_manage: false,
    mount_view: false,
    mount_upload: false,
    mount_copy: false,
    mount_rename: false,
    mount_delete: false,
    webdav_read: false,
    webdav_manage: false,
  });

  // 使用者資訊
  const userInfo = ref({
    id: null,
    name: null,
    basicPath: "/",
  });

  // ===== 計算屬性 =====

  // 是否為管理員 / Key 使用者（從 authType 推導，消除冗餘狀態）
  const isAdmin = computed(() => authType.value === "admin");
  const isKeyUser = computed(() => authType.value === "apikey");
  const isGuest = computed(() => {
    if (!isKeyUser.value) return false;
    const role = apiKeyInfo.value?.role || apiKeyInfo.value?.Role;
    return role === "GUEST";
  });

  // 文字/檔案分享許可權（建立 vs 管理）
  const hasTextSharePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.TEXT_SHARE);
  });

  const hasTextManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.TEXT_MANAGE);
  });

  const hasFileSharePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.FILE_SHARE);
  });

  const hasFileManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.FILE_MANAGE);
  });

  // 是否有掛載許可權（任一掛載許可權）
  const hasMountPermission = computed(() => {
    return (
      isAdmin.value ||
      PermissionChecker.hasAnyPermission(apiKeyPermissions.value, [
        Permission.MOUNT_VIEW,
        Permission.MOUNT_UPLOAD,
        Permission.MOUNT_COPY,
        Permission.MOUNT_RENAME,
        Permission.MOUNT_DELETE,
      ])
    );
  });

  // 詳細的掛載許可權檢查
  const hasMountViewPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_VIEW);
  });

  const hasMountUploadPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_UPLOAD);
  });

  const hasMountCopyPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_COPY);
  });

  const hasMountRenamePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_RENAME);
  });

  const hasMountDeletePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_DELETE);
  });

  // WebDAV許可權檢查
  const hasWebDAVReadPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.WEBDAV_READ);
  });

  const hasWebDAVManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.WEBDAV_MANAGE);
  });

  // 是否需要重新驗證（使用配置常量）
  const needsRevalidation = computed(() => {
    if (!lastValidated.value) return true;
    return Date.now() - lastValidated.value > REVALIDATION_INTERVAL;
  });

  const convertPermissionsToBitFlag = (permissions) => {
    if (typeof permissions === "number") {
      return permissions;
    }

    if (permissions && typeof permissions === "object") {
      let bitFlag = 0;
      // 相容新舊欄位命名（text/text_share, file/file_share 等）
      const textShare = permissions.text_share ?? permissions.text ?? false;
      const textManage = permissions.text_manage ?? false;
      const fileShare = permissions.file_share ?? permissions.file ?? false;
      const fileManage = permissions.file_manage ?? false;

      if (textShare) bitFlag |= Permission.TEXT_SHARE;
      if (textManage) bitFlag |= Permission.TEXT_MANAGE;
      if (fileShare) bitFlag |= Permission.FILE_SHARE;
      if (fileManage) bitFlag |= Permission.FILE_MANAGE;
      if (permissions.mount_view) bitFlag |= Permission.MOUNT_VIEW;
      if (permissions.mount_upload) bitFlag |= Permission.MOUNT_UPLOAD;
      if (permissions.mount_copy) bitFlag |= Permission.MOUNT_COPY;
      if (permissions.mount_rename) bitFlag |= Permission.MOUNT_RENAME;
      if (permissions.mount_delete) bitFlag |= Permission.MOUNT_DELETE;
      if (permissions.webdav_read) bitFlag |= Permission.WEBDAV_READ;
      if (permissions.webdav_manage) bitFlag |= Permission.WEBDAV_MANAGE;
      return bitFlag;
    }

    return 0;
  };

  // ===== 私有方法 =====

  // 用 VueUse 統一管理本地持久化（減少手寫 localStorage get/set/remove）
  const storedAdminToken = useLocalStorage(STORAGE_KEYS.ADMIN_TOKEN, null);
  const storedApiKey = useLocalStorage(STORAGE_KEYS.API_KEY, null);
  const storedApiKeyPermissions = useLocalStorage(STORAGE_KEYS.API_KEY_PERMISSIONS, 0);
  const storedApiKeyInfo = useLocalStorage(STORAGE_KEYS.API_KEY_INFO, null);

  /**
   * 從localStorage載入認證狀態
   */
  const loadFromStorage = () => {
    // 管理員 token
    try {
      if (storedAdminToken.value) {
        adminToken.value = storedAdminToken.value;
        authType.value = "admin";
        isAuthenticated.value = true;
        userInfo.value = {
          id: "admin",
          name: "Administrator",
          basicPath: "/",
        };
        return;
      }
    } catch (error) {
      log.warn("載入管理員token失敗:", error);
      storedAdminToken.value = null;
    }

    // API Key
    try {
      if (storedApiKey.value) {
        apiKey.value = storedApiKey.value;
        authType.value = "apikey";
        isAuthenticated.value = true;

        // 許可權：統一按 bitFlag number 讀取
        try {
          apiKeyPermissions.value = convertPermissionsToBitFlag(storedApiKeyPermissions.value);
        } catch (permError) {
          log.warn("載入API金鑰許可權失敗:", permError);
          storedApiKeyPermissions.value = 0;
        }

        // Key info
        try {
          if (storedApiKeyInfo.value && typeof storedApiKeyInfo.value === "object") {
            apiKeyInfo.value = storedApiKeyInfo.value;
            userInfo.value = {
              id: storedApiKeyInfo.value.id,
              name: storedApiKeyInfo.value.name,
              basicPath: storedApiKeyInfo.value.basic_path || "/",
            };
          }
        } catch (infoError) {
          log.warn("載入API金鑰資訊失敗:", infoError);
          storedApiKeyInfo.value = null;
        }
      }
    } catch (error) {
      log.warn("載入API金鑰失敗:", error);
      storedApiKey.value = null;
    }
  };

  /**
   * 清除所有認證狀態
   */
  const clearAuthState = () => {
    isAuthenticated.value = false;
    authType.value = "none";
    adminToken.value = null;
    apiKey.value = null;
    apiKeyInfo.value = null;
    apiKeyPermissions.value = 0; // 重置為無許可權
    userInfo.value = {
      id: null,
      name: null,
      basicPath: "/",
    };
    lastValidated.value = null;
  };

  /**
   * 儲存認證狀態到localStorage
   */
  const saveToStorage = () => {
    try {
      if (authType.value === "admin" && adminToken.value) {
        storedAdminToken.value = adminToken.value;
        storedApiKey.value = null;
        storedApiKeyPermissions.value = 0;
        storedApiKeyInfo.value = null;
      } else if (authType.value === "apikey" && apiKey.value) {
        storedAdminToken.value = null;
        storedApiKey.value = apiKey.value;
        storedApiKeyPermissions.value = apiKeyPermissions.value || 0;
        storedApiKeyInfo.value = apiKeyInfo.value || null;
      }
    } catch (error) {
      log.error("儲存認證狀態到localStorage失敗:", error);
    }
  };

  /**
   * 清除localStorage中的認證資料
   */
  const clearStorage = () => {
    storedAdminToken.value = null;
    storedApiKey.value = null;
    storedApiKeyPermissions.value = 0;
    storedApiKeyInfo.value = null;
  };

  // ===== 公共方法 =====

  /**
   * 初始化認證狀態
   */
  const initialize = async () => {
    if (initialized.value) {
      return;
    }

    log.debug("初始化認證狀態...");
    loadFromStorage();

    // 管理員會話：啟動時校驗一次 token
    if (isAuthenticated.value && authType.value === "admin") {
      await validateAuth();
    }

    // API Key 會話（包括 GUEST）：從本地恢復時視為“最近已驗證”，避免重新整理後立刻強制重新驗證
    if (isAuthenticated.value && authType.value === "apikey") {
      lastValidated.value = Date.now();
    }

    initialized.value = true;
  };

  /**
   * 驗證當前認證狀態
   */
  const validateAuth = async () => {
    if (!isAuthenticated.value) return false;

    isLoading.value = true;

    try {
      if (authType.value === "admin" && adminToken.value) {
        // 驗證管理員token
        const adminResult = await api.admin.checkLogin();
        if (adminResult) {
          lastValidated.value = Date.now();
          return true;
        } else {
          throw new Error("管理員token驗證失敗");
        }
      } else if (authType.value === "apikey" && apiKey.value) {
        // 驗證API金鑰
        const response = await api.test.verifyApiKey();
        if (response.success && response.data) {
          // 更新許可權資訊
        if (response.data.permissions) {
          apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
        }

          // 更新API金鑰資訊（包括基礎路徑）
          if (response.data.key_info) {
            apiKeyInfo.value = response.data.key_info;
            userInfo.value = {
              id: response.data.key_info.id,
              name: response.data.key_info.name,
              basicPath: response.data.key_info.basic_path || "/",
            };
          }

          saveToStorage();
          lastValidated.value = Date.now();
          return true;
        } else {
          throw new Error("API金鑰驗證失敗");
        }
      }

      // 驗證失敗，清除狀態
      await logout();
      return false;
    } catch (error) {
      log.error("認證驗證失敗:", error);
      await logout();
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 管理員登入
   */
  const adminLogin = async (username, password) => {
    isLoading.value = true;

    try {
      const result = await api.admin.login(username, password);
      const token = result.data?.token;

      if (!token) {
        throw new Error("登入響應中缺少token");
      }

      // 設定認證狀態
      adminToken.value = token;
      authType.value = "admin";
      isAuthenticated.value = true;
      userInfo.value = {
        id: "admin",
        name: "Administrator",
        basicPath: "/",
      };
      lastValidated.value = Date.now();

      // 儲存到localStorage
      saveToStorage();

      // 簡化事件觸發：只觸發必要的認證狀態變化事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "admin-login", isAuthenticated: true },
          })
        );
      } catch (eventError) {
        log.warn("觸發認證狀態變化事件失敗:", eventError);
      }

      return { success: true, data: { token } };
    } catch (error) {
      log.error("管理員登入失敗:", error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * API金鑰登入
   */
  const apiKeyLogin = async (key) => {
    isLoading.value = true;

    try {
      // 臨時設定API金鑰和認證型別進行驗證
      const originalApiKey = apiKey.value;
      const originalAuthType = authType.value;

      apiKey.value = key;
      authType.value = "apikey";

      const response = await api.test.verifyApiKey();

      if (!response.success || !response.data) {
        apiKey.value = originalApiKey;
        authType.value = originalAuthType;
        throw new Error("API金鑰驗證失敗");
      }

      // 設定認證狀態
      authType.value = "apikey";
      isAuthenticated.value = true;

      // 設定許可權
      if (response.data.permissions) {
        apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
      }

      // 設定金鑰資訊
      if (response.data.key_info) {
        apiKeyInfo.value = response.data.key_info;
        userInfo.value = {
          id: response.data.key_info.id,
          name: response.data.key_info.name,
          basicPath: response.data.key_info.basic_path || "/",
        };
      }

      lastValidated.value = Date.now();

      // 儲存到localStorage
      saveToStorage();

      // 簡化事件觸發：只觸發必要的認證狀態變化事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "apikey-login", isAuthenticated: true },
          })
        );
      } catch (eventError) {
        log.warn("觸發認證狀態變化事件失敗:", eventError);
      }

      return { success: true, data: response.data };
    } catch (error) {
      log.error("API金鑰登入失敗:", error);
      // 恢復原始狀態
      await logout();
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 遊客登入（基於 Guest API Key）
   */
  const guestLogin = async () => {
    isLoading.value = true;

    try {
      // 記錄原始狀態，方便失敗時恢復
      const originalApiKey = apiKey.value;
      const originalAuthType = authType.value;

      const guestConfigResp = await api.system.getGuestConfig?.();
      const guestData = guestConfigResp?.data ?? guestConfigResp;

      if (!guestData || !guestData.enabled || !guestData.key) {
        throw new Error("遊客模式未啟用或未正確配置");
      }

      apiKey.value = guestData.key;
      authType.value = "apikey";

      const response = await api.test.verifyApiKey();
      if (!response.success || !response.data) {
        apiKey.value = originalApiKey;
        authType.value = originalAuthType;
        throw new Error("遊客 API 金鑰驗證失敗");
      }

      isAuthenticated.value = true;

      if (response.data.permissions) {
        apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
      }

      if (response.data.key_info) {
        apiKeyInfo.value = response.data.key_info;
        userInfo.value = {
          id: response.data.key_info.id,
          name: response.data.key_info.name,
          basicPath: response.data.key_info.basic_path || "/",
        };
      }

      lastValidated.value = Date.now();

      // 遊客會話與普通 API Key 一樣持久化，支援重新整理後自動恢復
      saveToStorage();

      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "guest-login", isAuthenticated: true },
          })
        );
      } catch {
        // 忽略事件觸發異常
      }

      return { success: true, data: response.data };
    } catch (error) {
      log.error("遊客登入失敗:", error);
      await logout();
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 自動嘗試遊客登入（僅在匿名且未嘗試過時呼叫）
   */
  const maybeAutoGuestLogin = async () => {
    if (guestAutoTried.value) return;
    if (isAuthenticated.value || authType.value !== "none") {
      guestAutoTried.value = true;
      return;
    }

    guestAutoTried.value = true;

    try {
      await guestLogin();
    } catch (error) {
      log.warn("自動遊客登入失敗，將保持匿名狀態:", error);
    }
  };

  /**
   * 登出
   */
  const logout = async () => {
    try {
      // 如果是管理員，呼叫登出API
      if (authType.value === "admin") {
        try {
          await api.admin.logout();
        } catch (error) {
          log.warn("管理員登出API呼叫失敗:", error);
        }
      }

      // 儲存當前認證型別用於事件觸發
      const currentAuthType = authType.value;

      // 清除狀態和儲存
      clearAuthState();
      clearStorage();

      // 簡化事件觸發：只觸發必要的事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "logout", isAuthenticated: false },
          })
        );

        // 觸發特定的登出事件
        const wasGuest = currentAuthType === "apikey" && isGuest.value;
        if (currentAuthType === "admin") {
          window.dispatchEvent(new CustomEvent("admin-token-expired"));
        } else if (currentAuthType === "apikey") {
          window.dispatchEvent(new CustomEvent("api-key-invalid"));
          if (wasGuest) {
            window.dispatchEvent(new CustomEvent("guest-session-ended"));
          }
        }
      } catch (eventError) {
        log.warn("觸發登出事件失敗:", eventError);
      }
    } catch (error) {
      log.error("登出過程中出錯:", error);
    }
  };

  /**
   * 檢查特定許可權
   */
  const hasPermission = (permissionType) => {
    if (!isAuthenticated.value) return false;

    switch (permissionType) {
      case "text":
        // 文字許可權語義：用於“建立文字分享”，對應 TEXT_SHARE
        return hasTextSharePermission.value;
      case "file":
        // 檔案許可權語義：用於“建立檔案分享/上傳”，對應 FILE_SHARE
        return hasFileSharePermission.value;
      case "mount":
        return hasMountPermission.value;
      case "admin":
        return isAdmin.value;
      default:
        return false;
    }
  };

  /**
   * 檢查路徑許可權（針對API金鑰使用者）
   */
  const hasPathPermission = (path) => {
    if (isAdmin.value) return true;
    if (!isAuthenticated.value || authType.value !== "apikey") return false;

    const basicPath = userInfo.value.basicPath || "/";
    const normalizedBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
    const normalizedPath = path.replace(/\/+$/, "") || "/";

    // 如果基本路徑是根路徑，允許訪問所有路徑
    if (normalizedBasicPath === "/") return true;

    // 檢查路徑是否在基本路徑範圍內
    return normalizedPath === normalizedBasicPath || normalizedPath.startsWith(normalizedBasicPath + "/");
  };

  /**
   * 檢查當前使用者是否是指定檔案的建立者
   * @param {Object} fileInfo - 檔案資訊物件
   * @returns {boolean} 是否為建立者
   */
  const isFileCreator = (fileInfo) => {
    // 如果沒有檔案或建立者資訊，無法判斷
    if (!fileInfo || !fileInfo.created_by) {
      return false;
    }

    // 如果是管理員，總是返回true
    if (isAdmin.value) {
      return true;
    }

    // 如果不是API金鑰使用者（包括遊客API Key），返回false
    if (!isKeyUser.value || !apiKeyInfo.value || !apiKeyInfo.value.id) {
      return false;
    }

    // 處理created_by欄位，後端返回的格式是"apikey:金鑰ID"
    const createdBy = fileInfo.created_by;

    // 如果created_by以"apikey:"開頭，提取實際的ID部分
    if (typeof createdBy === "string" && createdBy.startsWith("apikey:")) {
      const actualKeyId = createdBy.substring(7); // 移除"apikey:"字首
      return apiKeyInfo.value.id === actualKeyId;
    }

    // 否則直接比較完整的ID
    return apiKeyInfo.value.id === createdBy;
  };

  registerAuthBridge({
    getSnapshot: () => ({
      authType: authType.value,
      adminToken: adminToken.value,
      apiKey: apiKey.value,
      isAuthenticated: isAuthenticated.value,
    }),
    logout,
  });

  // 返回store的狀態和方法
  return {
    // 狀態
    isAuthenticated,
    authType,
    isLoading,
    isAdmin,
    isGuest,
    isKeyUser,
    adminToken,
    apiKey,
    apiKeyInfo,
    apiKeyPermissions,
    userInfo,
    lastValidated,
    initialized,

    // 計算屬性
    hasTextSharePermission,
    hasTextManagePermission,
    hasFileSharePermission,
    hasFileManagePermission,
    hasMountPermission,
    hasMountViewPermission,
    hasMountUploadPermission,
    hasMountCopyPermission,
    hasMountRenamePermission,
    hasMountDeletePermission,
    hasWebDAVReadPermission,
    hasWebDAVManagePermission,
    needsRevalidation,

    // 方法
    initialize,
    validateAuth,
    adminLogin,
    apiKeyLogin,
    guestLogin,
    maybeAutoGuestLogin,
    logout,
    hasPermission,
    hasPathPermission,
    isFileCreator,
  };
});
