// Upload 模組對外統一入口
// 僅匯出給其它模組複用的領域能力，避免與檢視產生迴圈依賴

import { useShareUploadController } from "./shareUploadController.js";
import { useShareUploadDomain } from "./shareUploadDomain.js";
import { useUploadService } from "./services/uploadService.js";

export {
  // controllers & domain
  useShareUploadController,
  useShareUploadDomain,

  // services
  useUploadService,
};

export default {
  useShareUploadController,
  useShareUploadDomain,
  useUploadService,
};
