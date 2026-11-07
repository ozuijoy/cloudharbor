// Admin 模組統一入口
// - 為外部呼叫方提供統一的 admin service / 管理類 composable 入口
// - 避免在檢視層到處引用深層路徑，保持依賴清晰

// 系統與設定相關服務
import { useAdminSystemService } from "./services/systemService.js";
import { useAdminStorageConfigService } from "./services/storageConfigService.js";
import { useAdminMountService } from "./services/mountService.js";

// 備份與儀表盤
import { useAdminBackupService } from "./services/backupService.js";
import { useDashboardService } from "./services/dashboardService.js";

// 賬戶與 API Key
import { useAdminAccountService } from "./services/accountService.js";
import { useAdminApiKeyService } from "./services/apiKeyService.js";

// 掛載 / 儲存配置管理 composable
import { useMountManagement } from "./storage/useMountManagement.js";
import { useStorageConfigManagement } from "./storage/useStorageConfigManagement.js";

// FS Meta 元資訊管理 composable
import { useFsMetaManagement } from "./composables/useFsMetaManagement.js";

// 基礎 admin 通用邏輯（仍位於通用 composables 下）
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";

export {
  // system / settings
  useAdminSystemService,
  useAdminStorageConfigService,
  useAdminMountService,

  // backup / dashboard
  useAdminBackupService,
  useDashboardService,

  // account / api key
  useAdminAccountService,
  useAdminApiKeyService,

  // storage / mount management composables
  useMountManagement,
  useStorageConfigManagement,

  // fs meta
  useFsMetaManagement,

  // shared admin base
  useAdminBase,
};

export default {
  useAdminSystemService,
  useAdminStorageConfigService,
  useAdminMountService,
  useAdminBackupService,
  useDashboardService,
  useAdminAccountService,
  useAdminApiKeyService,
  useMountManagement,
  useStorageConfigManagement,
  useFsMetaManagement,
  useAdminBase,
};
