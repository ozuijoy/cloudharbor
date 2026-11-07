/**
 * API 模組統一匯出
 * 重新整理後的API介面分類，按功能模組清晰劃分
 */

// 匯出API配置和客戶端
export * from "./config";
export * from "./client";

// 匯出服務模組
import * as authService from "./services/authService";
import * as pasteService from "./services/pasteService";
import * as fileService from "./services/fileService";
import * as storageService from "./services/storageService";
import * as mountService from "./services/mountService";
import * as systemService from "./services/systemService";
import * as urlUploadService from "./services/urlUploadService";
import * as fsService from "./services/fsService";
import * as fsIndexService from "./services/fsIndexService";

// 統一服務匯出 - 按功能模組重新組織
export const api = {
  // 認證相關
  auth: authService,

  // 文字分享相關
  paste: pasteService,

  // 檔案管理相關
  file: {
    ...fileService,
    // 統一介面
    getFiles: fileService.getFiles,
    getFile: fileService.getFile,
    updateFile: fileService.updateFile,
    batchDeleteFiles: fileService.batchDeleteFiles,
    getMaxUploadSize: systemService.getMaxUploadSize,
  },

  // 儲存配置相關
  storage: {
    ...storageService,
    getStorageConfigReveal: storageService.getStorageConfigReveal,
  },

  // 掛載點管理相關
  mount: mountService,

  // 系統管理相關（統一使用分組CRUD架構）
  system: {
    ...systemService,
    // 分組設定管理
    getSettingsByGroup: systemService.getSettingsByGroup,
    getAllSettingsByGroups: systemService.getAllSettingsByGroups,
    updateGroupSettings: systemService.updateGroupSettings,
    getGroupsInfo: systemService.getGroupsInfo,
    getSettingMetadata: systemService.getSettingMetadata,
  },

  // URL上傳相關
  urlUpload: urlUploadService,

  // 檔案系統相關 - 統一API，自動根據認證資訊處理使用者型別
  fs: {
    ...fsService,
  },

  // 相容性匯出 - 保持向後相容
  admin: {
    // 認證相關
    login: authService.adminLogin,
    logout: authService.adminLogout,
    checkLogin: authService.checkAdminLogin,
    changePassword: authService.changeAdminPassword,

    // API金鑰管理
    getAllApiKeys: authService.getAllApiKeys,
    createApiKey: authService.createApiKey,
    deleteApiKey: authService.deleteApiKey,
    updateApiKey: authService.updateApiKey,
    getApiKeyStorageAcl: authService.getApiKeyStorageAcl,
    updateApiKeyStorageAcl: authService.updateApiKeyStorageAcl,

    // 文字分享管理（統一介面）
    getPastes: pasteService.getPastes,
    getPasteById: pasteService.getPasteById,
    updatePaste: pasteService.updatePaste,
    batchDeletePastes: pasteService.batchDeletePastes,
    clearExpiredPastes: pasteService.clearExpiredPastes,

    // 儲存配置管理
    getStorageConfigs: storageService.getStorageConfigs,
    getStorageConfig: storageService.getStorageConfig,
    createStorageConfig: storageService.createStorageConfig,
    updateStorageConfig: storageService.updateStorageConfig,
    deleteStorageConfig: storageService.deleteStorageConfig,
    setDefaultStorageConfig: storageService.setDefaultStorageConfig,
    testStorageConfig: storageService.testStorageConfig,

    // 系統管理
    getDashboardStats: systemService.getDashboardStats,
    getStorageUsageReport: systemService.getStorageUsageReport,
    refreshStorageUsageSnapshots: systemService.refreshStorageUsageSnapshots,
    getCacheStats: systemService.getCacheStats,
    clearCache: systemService.clearCacheAdmin,

    // 檔案系統管理 - 使用統一API
    getDirectoryList: fsService.getDirectoryList,
    getFileInfo: fsService.getFileInfo,
    getFileLink: fsService.getFileLink,
    createDirectory: fsService.createDirectory,
    uploadFile: fsService.uploadFile,
    batchDeleteItems: fsService.batchDeleteItems,
    renameItem: fsService.renameItem,
    updateFile: fsService.updateFile,
    // 複製相關
    batchCopyItems: fsService.batchCopyItems,

    // 索引管理
    fsIndex: fsIndexService,
  },

  test: {
    // API金鑰驗證（已遷移到auth）
    verifyApiKey: authService.verifyApiKey,

    // 儲存連線測試
    testStorageConfig: storageService.testStorageConfig,
  },

  user: {
    // API金鑰使用者的文字服務（統一介面）
    paste: {
      getPastes: pasteService.getPastes,
      getPasteById: pasteService.getPasteById,
      updatePaste: pasteService.updatePaste,
      batchDeletePastes: pasteService.batchDeletePastes,
    },

    // API金鑰使用者的掛載服務（統一API，根據許可權自動過濾）
    mount: {
      getMounts: mountService.getMountsList,
    },

    // API金鑰使用者的檔案系統服務 - 使用統一API
    fs: {
      getDirectoryList: fsService.getDirectoryList,
      getFileInfo: fsService.getFileInfo,
      getFileLink: fsService.getFileLink,
      createDirectory: fsService.createDirectory,
      uploadFile: fsService.uploadFile,
      batchDeleteItems: fsService.batchDeleteItems,
      renameItem: fsService.renameItem,
      updateFile: fsService.updateFile,
      // 複製相關
      batchCopyItems: fsService.batchCopyItems,
      // 分享相關
      createShareFromFileSystem: fsService.createShareFromFileSystem,
    },

    // API金鑰使用者的URL上傳服務（僅負責URL元資訊和內容拉取）
    urlUpload: {
      validateUrlInfo: urlUploadService.validateUrlInfo,
      getProxyUrl: urlUploadService.getProxyUrl,
      fetchUrlContent: urlUploadService.fetchUrlContent,
    },

    // API金鑰使用者的系統服務
    system: {
      clearCache: systemService.clearCacheUser,
    },
  },
};

// 預設匯出API服務物件
export default api;
