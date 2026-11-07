import { Permission } from "../../constants/permissions.js";
import { authorize } from "../middleware/authorize.js";
import { processWebDAVPath } from "../../webdav/utils/webdavUtils.js";
import { ValidationError } from "../../http/errors.js";

// 所有策略都集中在這裡，方便審計和擴充套件：
//  - key 採用 “域.操作” 命名（fs.read、webdav.manage 等）。
//  - 每條策略只描述許可權需求，不嵌入業務細節。
//  - 路由層只需要 usePolicy("xxx")，即可獲得一致的 authorize 中介軟體。

const getFsPathFromQuery = (c) => c.req.query("path") ?? "/";
const getWebDAVPath = (c) => {
  const cached = c.get?.("webdavPath");
  if (cached) {
    return cached;
  }
  const url = new URL(c.req?.url ?? "http://localhost/", "http://localhost");
  return processWebDAVPath(url.pathname, false) || "/";
};

const Policies = {
  "fs.base": {
    permissions: [Permission.MOUNT_VIEW],
    message: "缺少檔案系統訪問許可權",
  },
  "fs.list": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathMode: "navigation",
    pathResolver: getFsPathFromQuery,
    message: "缺少目錄瀏覽許可權",
  },
  "fs.read": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathResolver: getFsPathFromQuery,
    message: "缺少檔案讀取許可權",
  },
  "fs.share-link": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathResolver: getFsPathFromQuery,
    message: "缺少檔案直鏈許可權",
  },
  "fs.upload": {
    permissions: [Permission.MOUNT_UPLOAD],
    pathCheck: true,
    message: "缺少檔案上傳許可權",
  },
  "fs.rename": {
    permissions: [Permission.MOUNT_RENAME],
    pathCheck: true,
    message: "缺少檔案重新命名許可權",
  },
  "fs.delete": {
    permissions: [Permission.MOUNT_DELETE],
    pathCheck: true,
    message: "缺少檔案刪除許可權",
  },
  "fs.copy": {
    permissions: [Permission.MOUNT_COPY],
    pathCheck: true,
    message: "缺少檔案複製許可權",
  },
  "fs.share.create": {
    permissions: [Permission.FILE_SHARE],
    pathCheck: true,
    message: "缺少分享建立許可權",
  },
  "fs.search": {
    permissions: [Permission.MOUNT_VIEW],
    message: "缺少檔案搜尋許可權",
  },
  "files.manage": {
    permissions: [Permission.FILE_MANAGE],
    message: "缺少檔案分享管理許可權",
  },
  "files.create": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少檔案分享建立許可權",
  },
  //目前作為佔位符無用
  // URL 上傳：只要具備“建立檔案分享”或“掛載上傳”能力之一即可。
  "urlupload.manage": {
    permissions: [Permission.FILE_SHARE, Permission.MOUNT_UPLOAD],
    message: "缺少URL上傳許可權",
  },
  // 通用“上傳即分享”能力（直傳到任意儲存再建立檔案分享記錄）。目前無用
  // 目前僅在 shareUploadRoutes 中透過 files.create 控制，因此暫保留佔位，
  // 後續若需要單獨抽出“直傳 share 許可權”，可以將相關路由從 files.create 切換為 storage.upload。
  "storage.upload": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少儲存上傳許可權",
  },
  // 儲存配置讀取（多儲存通用）：
  // - 檔案分享：需要 FILE_SHARE（用於 /upload 頁、URL 上傳等）
  // - 掛載上傳：需要 MOUNT_UPLOAD（用於掛載瀏覽頁 FS 上傳）
  // - WebDAV：需要 WEBDAV_READ（用於 WebDAV 只讀場景下也能解析驅動能力）
  // 任意具備其中之一即可讀取「自己可見」的儲存配置（仍受 ACL / is_public 過濾）
  "storage.config.read": {
    permissions: [Permission.FILE_SHARE, Permission.MOUNT_UPLOAD],
    message: "缺少儲存配置訪問許可權",
  },
  "webdav.read": {
    permissions: [Permission.WEBDAV_READ],
    pathCheck: true,
    pathResolver: getWebDAVPath,
    message: "缺少 WebDAV 讀取許可權",
  },
  "webdav.manage": {
    permissions: [Permission.WEBDAV_MANAGE],
    pathCheck: true,
    pathResolver: getWebDAVPath,
    message: "缺少 WebDAV 管理許可權",
  },
  "pastes.manage": {
    permissions: [Permission.TEXT_MANAGE],
    message: "缺少文字分享管理許可權",
  },
  "pastes.create": {
    permissions: [Permission.TEXT_SHARE],
    message: "缺少文字分享建立許可權",
  },
  "pastes.admin": {
    permissions: [],
    adminBypass: false,
    custom: (principal) => Boolean(principal?.isAdmin),
    message: "需要管理員許可權",
  },
  "admin.all": {
    permissions: [],
    adminBypass: false,
    custom: (principal) => Boolean(principal?.isAdmin),
    message: "需要管理員許可權",
  },
  "auth.authenticated": {
    permissions: [],
    message: "需要認證",
  },
};

export const getPolicy = (name) => {
  const policy = Policies[name];
  if (!policy) {
    return null;
  }
  return { ...policy };
};

export const usePolicy = (name, overrides = {}) => {
  const policy = getPolicy(name);
  if (!policy) {
    throw new ValidationError(`Policy '${name}' 未定義`);
  }

  const merged = { ...policy, ...overrides };
  const policyMessage = overrides.message ?? policy.message;

  return authorize({ ...merged, policyName: name, policyMessage });
};

export { Policies };
