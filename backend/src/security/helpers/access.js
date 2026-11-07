import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { getAccessibleMountsByBasicPath } from "../../services/apiKeyService.js";
import { UserType } from "../../constants/index.js";

// 這裡封裝了“principal → 可訪問掛載列表 / 路徑範圍”相關邏輯，
// 供 FS、MountManager、WebDAV 等模組複用，避免各處重複 basicPath 判斷。

const normalizeUserType = (userType) => (userType === "apikey" ? UserType.API_KEY : userType);
const isAdminType = (userType) => normalizeUserType(userType) === UserType.ADMIN;

export const getAccessibleMountsForUser = async (db, userIdOrInfo, userType, repositoryFactory = null) => {
  const normalizedType = normalizeUserType(userType);

  // 管理員：直接返回所有活躍掛載點
  if (isAdminType(normalizedType)) {
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();
    return await mountRepository.findAll(false);
  }

  // API Key 使用者：使用 basicPath + 儲存 ACL 計算可訪問掛載
  if (normalizedType === UserType.API_KEY) {
    const basicPath =
      typeof userIdOrInfo === "string" ? "/" : userIdOrInfo?.basicPath ?? "/";

    const subjectId =
      typeof userIdOrInfo === "string" ? userIdOrInfo : userIdOrInfo?.id ?? null;

    return await getAccessibleMountsByBasicPath(db, basicPath, "API_KEY", subjectId, repositoryFactory);
  }

  // 其他使用者型別暫不支援掛載訪問
  return [];
};

export const getAccessibleMountsForPrincipal = async (db, principal, repositoryFactory = null) => {
  if (!principal) {
    return [];
  }

  const userType = principal.isAdmin ? UserType.ADMIN : normalizeUserType(principal.type);

  if (userType === UserType.ADMIN) {
    return getAccessibleMountsForUser(db, principal.id, userType, repositoryFactory);
  }

  // API Key：保留 basicPath，並傳入主體 ID，便於應用儲存 ACL
  const basicPath = principal.attributes?.basicPath ?? principal.attributes?.keyInfo?.basicPath ?? "/";
  const userIdOrInfo = {
    id: principal.id ?? principal.attributes?.keyInfo?.id ?? null,
    basicPath,
  };

  return getAccessibleMountsForUser(db, userIdOrInfo, userType, repositoryFactory);
};

export const canNavigatePath = (basicPath, requestPath) => {
  if (!basicPath || !requestPath) {
    return false;
  }

  const normalize = (value, isBase = false) => {
    if (!value) {
      return "/";
    }
    if (value === "/") {
      return "/";
    }
    const trimmed = value.replace(/\/+/g, "/");
    return isBase ? trimmed.replace(/\/$/, "") || "/" : trimmed || "/";
  };

  const base = normalize(basicPath, true);
  const target = normalize(requestPath);

  if (base === "/") {
    return true;
  }

  if (target === base || target.startsWith(`${base}/`)) {
    return true;
  }

  const baseParts = base.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);

  if (targetParts.length >= baseParts.length) {
    return false;
  }

  const targetPrefix = `/${targetParts.join("/")}`;
  const basePrefix = `/${baseParts.slice(0, targetParts.length).join("/")}`;
  return targetPrefix === basePrefix;
};
