import { UserType } from "../../../constants/index.js";
import { ValidationError } from "../../../http/errors.js";

// - 這裡的“owner”是給 vfs_nodes 用的“所有者隔離欄位”
// - 把“（admin / apiKey）”統一對映成 { ownerType, ownerId }

const normalizeUserType = (userType) => {
  if (!userType) return null;
  // 相容歷史寫法：apikey -> apiKey
  return userType === "apikey" ? UserType.API_KEY : userType;
};

const pickUserId = (userIdOrInfo) => {
  if (!userIdOrInfo) return null;
  if (typeof userIdOrInfo === "string") return userIdOrInfo;
  if (typeof userIdOrInfo?.id === "string") return userIdOrInfo.id;
  if (userIdOrInfo?.id !== null && userIdOrInfo?.id !== undefined) return String(userIdOrInfo.id);
  return null;
};

/**
 * 將 (userIdOrInfo, userType) 對映為 VFS owner
 * @param {string|{id?: string}|any} userIdOrInfo
 * @param {string} userType - 期望值：admin / apiKey（或歷史 apikey）
 * @returns {{ ownerType: string, ownerId: string }}
 */
export function resolveOwner(userIdOrInfo, userType) {
  const normalizedType = normalizeUserType(userType);
  const userId = pickUserId(userIdOrInfo);

  if (!normalizedType) {
    throw new ValidationError("resolveOwner: 缺少 userType");
  }
  if (!userId) {
    throw new ValidationError("resolveOwner: 缺少 userId");
  }

  // 按專案既有常量（UserType）保持一致
  if (normalizedType === UserType.ADMIN) {
    return { ownerType: UserType.ADMIN, ownerId: String(userId) };
  }
  if (normalizedType === UserType.API_KEY) {
    return { ownerType: UserType.API_KEY, ownerId: String(userId) };
  }

  // todo:未來 user 體系：先允許傳入，但當前專案其他地方可能尚未支援
  return { ownerType: String(normalizedType), ownerId: String(userId) };
}

/**
 * 從請求上下文 principal 對映 owner
 * @param {any} principal
 * @returns {{ ownerType: string, ownerId: string }}
 */
export function resolveOwnerFromPrincipal(principal) {
  if (!principal || principal.type === UserType.ANONYMOUS) {
    throw new ValidationError("resolveOwnerFromPrincipal: 需要已認證身份");
  }

  const userType = principal.isAdmin ? UserType.ADMIN : normalizeUserType(principal.type);
  return resolveOwner(principal.id ?? null, userType);
}

