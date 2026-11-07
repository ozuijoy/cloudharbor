import { performAuth } from "../auth/authGateway.js";

/**
 * securityContext ：
 * 1. 透過 performAuth 解析 Authorization / X-Custom-Auth-Key。
 * 2. 將 authResult 對映為更輕量的 principal 並掛載到 context（供 authorize / 業務層讀取）。
 * 3. 不做任何許可權判斷或拒絕邏輯，讓後續的 authorize 按策略決定是否放行。
 */
import { PermissionGroup } from "../../constants/permissions.js";

const ADMIN_AUTHORITIES = PermissionGroup.ALL_PERMISSIONS ?? 0xffffffff;

export const createGuestPrincipal = () => ({
  type: "anonymous",
  id: null,
  authorities: 0,
  attributes: {},
  isAdmin: false,
  isAuthenticated: false,
});

const mapAuthResultToPrincipal = (authResult) => {
  if (!authResult || !authResult.isAuthenticated) {
    return createGuestPrincipal();
  }

  const isAdmin = Boolean(authResult.isAdmin?.() ?? authResult._isAdmin);
  if (isAdmin) {
    return {
      type: "admin",
      id: authResult.getUserId?.() ?? authResult.userId ?? null,
      authorities: ADMIN_AUTHORITIES,
      attributes: {
        basicPath: "/",
        role: "ADMIN",
      },
      isAdmin: true,
      isAuthenticated: true,
    };
  }

  const keyInfo = authResult.keyInfo ?? null;
  if (keyInfo) {
    return {
      type: "apiKey",
      id: authResult.getUserId?.() ?? keyInfo?.id ?? null,
      authorities: authResult.permissions ?? 0,
      attributes: {
        basicPath: keyInfo?.basicPath ?? authResult.basicPath ?? "/",
        role: keyInfo?.role ?? null,
        keyInfo: keyInfo ?? undefined,
      },
      isAdmin: false,
      isAuthenticated: true,
    };
  }

  // 非 admin 且無 apiKey，僅保留兩種已認證型別：admin/apiKey，其餘視為匿名
  return createGuestPrincipal();
};

export const securityContext = () => {
  return async (c, next) => {
    let principal = c.get("principal");
    if (!principal) {
      const authResult = await performAuth(c);
      principal = mapAuthResultToPrincipal(authResult);
      c.set("principal", principal);
    }

    await next();
  };
};

export const getPrincipal = (c) => c.get("principal") ?? createGuestPrincipal();
