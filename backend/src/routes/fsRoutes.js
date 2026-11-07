import { Hono } from "hono";
import { ApiStatus, UserType } from "../constants/index.js";
import { AuthenticationError, AuthorizationError, ValidationError } from "../http/errors.js";
import { usePolicy } from "../security/policies/policies.js";
import { getStorageConfigByIdForAdmin, getPublicStorageConfigById } from "../services/storageConfigService.js";
import { getAccessibleMountsForUser } from "../security/helpers/access.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { registerBrowseRoutes } from "./fs/browse.js";
import { registerWriteRoutes } from "./fs/write.js";
import { registerMultipartRoutes } from "./fs/multipart.js";
import { registerOpsRoutes } from "./fs/ops.js";
import { registerSearchShareRoutes } from "./fs/search_share.js";
import { FsMetaService } from "../services/fsMetaService.js";
import { encryptValue, decryptValue } from "../utils/crypto.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { createErrorResponse, jsonOk } from "../utils/common.js";

const fsRoutes = new Hono();

// 路徑規範化
const normalizeFsPath = (path) => {
  if (!path || path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "") || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

/**
 * 解析指定路徑的有效 Meta 與密碼域資訊
 * @param {D1Database} db
 * @param {string} rawPath
 */
const resolveEffectiveMetaForPath = async (db, rawPath) => {
  const metaService = new FsMetaService(db);
  const normalizedPath = normalizeFsPath(rawPath || "/");
  const meta = await metaService.resolveMetaForPath(normalizedPath);
  const requiresPassword = Boolean(meta.password);
  const passwordOwnerPath = meta.password ? meta.passwordOwnerPath || normalizedPath : null;
  return { meta, normalizedPath, requiresPassword, passwordOwnerPath };
};

/**
 * 為指定路徑和明文密碼生成驗證結果與 token
 * - 不負責身份判斷，僅基於 fs_meta 的 password 欄位工作
 * @param {D1Database} db
 * @param {string} rawPath
 * @param {string} plainPassword
 * @param {string} encryptionSecret
 */
const buildPathPasswordVerification = async (db, rawPath, plainPassword, encryptionSecret) => {
  const { meta, normalizedPath, requiresPassword, passwordOwnerPath } = await resolveEffectiveMetaForPath(db, rawPath);

  // 未配置密碼：直接視為不需要路徑密碼
  if (!requiresPassword) {
    return {
      requiresPassword: false,
      verified: true,
      token: null,
      path: normalizedPath,
    };
  }

  if (!plainPassword || typeof plainPassword !== "string" || !plainPassword.trim()) {
    return {
      requiresPassword: true,
      verified: false,
      error: "EMPTY_PASSWORD",
      path: normalizedPath,
    };
  }

  if (plainPassword !== meta.password) {
    return {
      requiresPassword: true,
      verified: false,
      error: "INVALID_PASSWORD",
      path: normalizedPath,
    };
  }

  // 為後續中介軟體校驗準備的 token 載荷：
  // - ownerPath: 密碼所屬路徑（密碼域）
  // - passwordVersion: 當前聚合後的密碼值（當密碼修改時會改變）
  // - verifiedAt: 簽發時間（僅用於除錯）
  const payload = JSON.stringify({
    ownerPath: passwordOwnerPath || normalizedPath,
    passwordVersion: meta.password,
    verifiedAt: new Date().toISOString(),
  });
  const token = await encryptValue(payload, encryptionSecret);

  return {
    requiresPassword: true,
    verified: true,
    token,
    path: passwordOwnerPath || normalizedPath,
  };
};

/**
 * 校驗路徑密碼 token 是否對當前路徑仍然有效
 * - 用於 FS 瀏覽路由的前置訪問控制
 * @param {D1Database} db
 * @param {string} rawPath
 * @param {string|null} token
 * @param {string} encryptionSecret
 */
const verifyPathPasswordToken = async (db, rawPath, token, encryptionSecret) => {
  const { meta, normalizedPath, requiresPassword, passwordOwnerPath } = await resolveEffectiveMetaForPath(db, rawPath);

  // 當前路徑未配置密碼：無需 token，直接放行
  if (!requiresPassword) {
    return {
      requiresPassword: false,
      verified: true,
    };
  }

  if (!token || typeof token !== "string") {
    return {
      requiresPassword: true,
      verified: false,
      error: "MISSING_TOKEN",
    };
  }

  let payloadText;
  try {
    payloadText = await decryptValue(token, encryptionSecret);
  } catch {
    return {
      requiresPassword: true,
      verified: false,
      error: "INVALID_TOKEN",
    };
  }

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return {
      requiresPassword: true,
      verified: false,
      error: "INVALID_TOKEN",
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      requiresPassword: true,
      verified: false,
      error: "INVALID_TOKEN",
    };
  }

  // 密碼域 ownerPath 必須匹配當前路徑的密碼 owner
  if (!payload.ownerPath || normalizeFsPath(payload.ownerPath) !== normalizeFsPath(passwordOwnerPath || normalizedPath)) {
    return {
      requiresPassword: true,
      verified: false,
      error: "PATH_MISMATCH",
    };
  }

  // 當管理員修改了密碼時，這裡的 passwordVersion 將與當前 meta.password 不一致
  if (!payload.passwordVersion || payload.passwordVersion !== meta.password) {
    return {
      requiresPassword: true,
      verified: false,
      error: "PASSWORD_CHANGED",
    };
  }

  return {
    requiresPassword: true,
    verified: true,
  };
};

// 負責把 principal 對映為 legacy FS 服務層仍在使用的 userInfo 結構。
const unifiedFsAuthMiddleware = async (c, next) => {
  const principal = c.get("principal");

  if (!principal || principal.type === "anonymous") {
    throw new AuthenticationError("需要認證訪問");
  }

  if (principal.isAdmin) {
    c.set("userInfo", {
      type: UserType.ADMIN,
      id: principal.id,
      hasFullAccess: true,
    });
  } else if (principal.type === UserType.API_KEY) {
    const apiKeyInfo = principal.attributes?.keyInfo ?? {
      id: principal.id,
      basicPath: principal.attributes?.basicPath ?? "/",
      permissions: principal.authorities,
    };

    c.set("userInfo", {
      type: UserType.API_KEY,
      info: apiKeyInfo,
      hasFullAccess: false,
    });
  } else {
    throw new AuthorizationError("不支援的身份型別");
  }

  await next();
};

const FS_BASE_PATH = "/api/fs";

const baseFsPolicy = usePolicy("fs.base");
fsRoutes.use(`${FS_BASE_PATH}/*`, baseFsPolicy, unifiedFsAuthMiddleware);

fsRoutes.use(`${FS_BASE_PATH}/list`, usePolicy("fs.list"));
fsRoutes.use(`${FS_BASE_PATH}/get`, usePolicy("fs.read"));
fsRoutes.use(`${FS_BASE_PATH}/download`, usePolicy("fs.read"));
fsRoutes.use(`${FS_BASE_PATH}/content`, usePolicy("fs.read"));
fsRoutes.use(`${FS_BASE_PATH}/file-link`, usePolicy("fs.share-link"));

// 目錄路徑密碼校驗介面
fsRoutes.post(`${FS_BASE_PATH}/meta/password/verify`, async (c) => {
  const db = c.env.DB;

  let body;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }

  const rawPath = body?.path ?? "/";
  const plainPassword = body?.password ?? "";

  if (!rawPath || typeof rawPath !== "string") {
    throw new ValidationError("請提供有效的路徑");
  }

  const encryptionSecret = getEncryptionSecret(c);
  const result = await buildPathPasswordVerification(db, rawPath, plainPassword, encryptionSecret);

  // 未配置密碼：直接返回“無需密碼”的成功結果
  if (!result.requiresPassword) {
    return jsonOk(
      c,
      {
        verified: true,
        requiresPassword: false,
        token: null,
        path: result.path,
      },
      "該路徑不需要密碼",
    );
  }

  if (!result.verified) {
    const message = result.error === "EMPTY_PASSWORD" ? "密碼不能為空" : "密碼錯誤";
    return c.json(
      {
        ...createErrorResponse(ApiStatus.FORBIDDEN, message, "FS_PATH_PASSWORD_INVALID"),
        data: {
          path: result.path,
          requiresPassword: true,
        },
      },
      ApiStatus.FORBIDDEN,
    );
  }

  return jsonOk(
    c,
    {
      verified: true,
      requiresPassword: true,
      token: result.token,
      path: result.path,
    },
    "路徑密碼驗證成功",
  );
});


const getServiceParams = (userInfo) => {
  if (userInfo.type === UserType.ADMIN) {
    return { userIdOrInfo: userInfo.id, userType: UserType.ADMIN };
  }
  return { userIdOrInfo: userInfo.info, userType: UserType.API_KEY };
};

// 統一命名：根據使用者型別獲取“儲存配置”
const getStorageConfigByUserType = async (db, configId, userIdOrInfo, userType, encryptionSecret) => {
  if (userType === UserType.ADMIN) {
    return await getStorageConfigByIdForAdmin(db, configId, userIdOrInfo);
  }

  // 當前僅支援 API Key 使用者訪問公共儲存配置
  if (userType === UserType.API_KEY) {
    const factory = ensureRepositoryFactory(db);
    const principalStorageAclRepository = factory.getPrincipalStorageAclRepository();

    // 解析主體資訊用於儲存 ACL：subjectType + subjectId
    const subjectType = "API_KEY";
    const subjectId = typeof userIdOrInfo === "string" ? userIdOrInfo : userIdOrInfo?.id ?? null;

    let allowed = true;

    if (principalStorageAclRepository && subjectId) {
      try {
        const allowedConfigIds = await principalStorageAclRepository.findConfigIdsBySubject(subjectType, subjectId);
        if (Array.isArray(allowedConfigIds) && allowedConfigIds.length > 0) {
          // 當存在顯式 ACL 記錄時，啟用白名單模式
          allowed = allowedConfigIds.includes(configId);
        }
      } catch (error) {
        console.warn("載入儲存 ACL 失敗，將回退到僅基於 is_public 的訪問控制：", error);
      }
    }

    if (!allowed) {
      return null;
    }

    return await getPublicStorageConfigById(db, configId);
  }

  // 其他使用者型別目前不允許直接訪問儲存配置
  return null;
};

const sharedContext = {
  // FS 子路由只需要這三個 helper 即可完成鑑權相關操作。
  getAccessibleMounts: getAccessibleMountsForUser,
  getServiceParams,
  getStorageConfigByUserType,
  verifyPathPasswordToken,
};

registerBrowseRoutes(fsRoutes, sharedContext);
registerWriteRoutes(fsRoutes, sharedContext);
registerMultipartRoutes(fsRoutes, sharedContext);
registerOpsRoutes(fsRoutes, sharedContext);
registerSearchShareRoutes(fsRoutes, sharedContext);


export default fsRoutes;
