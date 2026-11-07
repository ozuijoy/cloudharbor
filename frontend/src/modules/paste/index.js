// Paste 模組對外統一入口
// 僅匯出 service/composable，檢視元件透過具體路徑按需引入，避免迴圈依賴

import { usePasteService } from "./services/pasteService.js";
import { usePasteManagement } from "./admin/usePasteManagement.js";

export {
  // service
  usePasteService,

  // admin composables
  usePasteManagement,
};

// 預設匯出方便解構
export default {
  usePasteService,
  usePasteManagement,
};
