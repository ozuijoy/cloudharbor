// FS 模組統一入口
// 僅匯出 service，檢視透過直接路徑引入以避免迴圈依賴

import { useFsService } from "./fsService.js";

export { useFsService };

export default {
  useFsService,
};
