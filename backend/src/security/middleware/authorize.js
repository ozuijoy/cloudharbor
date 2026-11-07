import { ApiStatus } from "../../constants/index.js";
import { AppError, AuthenticationError, AuthorizationError } from "../../http/errors.js";
import { PermissionChecker } from "../../constants/permissions.js";
import { createGuestPrincipal } from "./securityContext.js";

/**
 * authorize 是計劃裡“統一授權層”的落地：
 * - 讀取 securityContext 注入的 principal。
 * - 基於策略配置（Permissions / pathCheck / custom / adminBypass）做判定。
 * - 輸出結構化審計，便於外部觀測允許/拒絕原因。
 * 這裡不關心業務，只關心“誰在做什麼操作是否被允許”。
 */

const defaultPathResolver = (c) => c.req.query("path") ?? "/";

const normalizePath = (value) => {
  if (!value) {
    return "/";
  }
  if (value === "/") {
    return "/";
  }
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  return prefixed.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
};

const isNavigationAllowed = (basicPath, requestPath) => {
  if (!basicPath || !requestPath) {
    return false;
  }

  const base = normalizePath(basicPath);
  const target = normalizePath(requestPath);

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

const toArray = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const resolvePaths = async (resolver, c, principal) => {
  if (!resolver) {
    return toArray(defaultPathResolver(c));
  }
  return toArray(await resolver(c, principal));
};

const emitAuditEvent = (c, principal, { decision, policyName, reason = null, status = null }) => {
  const payload = {
    type: "auth.audit",
    reqId: c.get?.("reqId") ?? null,
    method: c.req?.method ?? null,
    path: c.req?.path ?? null,
    policy: policyName ?? "inline",
    principalType: principal?.type ?? "anonymous",
    principalId: principal?.id ?? null,
    decision,
    reason,
    status,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
};

const statusToCode = (status) => {
  switch (status) {
    case ApiStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case ApiStatus.FORBIDDEN:
      return "FORBIDDEN";
    case ApiStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    default:
      return "AUTH_ERROR";
  }
};

const raiseAuthError = (c, principal, { status, message, reason, policyName }) => {
  emitAuditEvent(c, principal, {
    decision: "deny",
    policyName,
    reason,
    status,
  });
  if (status === ApiStatus.UNAUTHORIZED) {
    throw new AuthenticationError(message);
  }
  if (status === ApiStatus.FORBIDDEN) {
    throw new AuthorizationError(message);
  }
  throw new AppError(message, { status, code: statusToCode(status), expose: true });
};

const checkPermissions = (principal, permissions, mode) => {
  if (!permissions || permissions.length === 0) {
    return true;
  }

  const authorities = principal.authorities ?? 0;
  if (mode === "all") {
    return PermissionChecker.hasAllPermissions(authorities, permissions);
  }
  return PermissionChecker.hasAnyPermission(authorities, permissions);
};

const guardPaths = async (options, c, principal) => {
  const { pathResolver, pathMode = "operation" } = options;
  const authService = c.get("authService");
  if (!authService) {
    return { success: true };
  }

  const basicPath = principal.attributes?.basicPath ?? "/";
  const paths = await resolvePaths(pathResolver, c, principal);
  const targets = paths.length > 0 ? paths : [basicPath];

  for (const raw of targets) {
    const candidate = raw ?? "/";
    const allowed = pathMode === "navigation" ? isNavigationAllowed(basicPath, candidate) : authService.checkBasicPathPermission(basicPath, candidate);

    if (!allowed) {
      return { success: false, path: candidate };
    }
  }

  return { success: true };
};

export const authorize = (options = {}) => {
  const {
    requireAuth = true,
    permissions = [],
    mode = "any",
    adminBypass = true,
    pathCheck = false,
    pathResolver,
    pathMode = "operation",
    custom,
    policyName,
    policyMessage,
  } = options;

  return async (c, next) => {
    const principal = c.get("principal") ?? createGuestPrincipal();

    if (requireAuth && (!principal || principal.type === "anonymous")) {
      raiseAuthError(c, principal, {
        status: ApiStatus.UNAUTHORIZED,
        message: "需要認證訪問",
        reason: "unauthenticated",
        policyName,
      });
    }

    const isAdmin = Boolean(principal?.isAdmin);
    const skipChecks = adminBypass && isAdmin;

    if (!skipChecks) {
      const permitted = checkPermissions(principal, permissions, mode);
      if (!permitted) {
        raiseAuthError(c, principal, {
          status: ApiStatus.FORBIDDEN,
          message: policyMessage || "缺少必要許可權",
          reason: "missing_permission",
          policyName,
        });
      }

      if (pathCheck) {
        const pathResult = await guardPaths({ pathResolver, pathMode }, c, principal);
        if (!pathResult.success) {
          raiseAuthError(c, principal, {
            status: ApiStatus.FORBIDDEN,
            message: "路徑越權，拒絕訪問",
            reason: "path_scope",
            policyName,
          });
        }
      }

      if (custom) {
        const customResult = await custom(principal, c);
        if (!customResult) {
          raiseAuthError(c, principal, {
            status: ApiStatus.FORBIDDEN,
            message: "自定義校驗未透過",
            reason: "custom_check",
            policyName,
          });
        }
      }
    }

    emitAuditEvent(c, principal, {
      decision: "allow",
      policyName,
      reason: skipChecks ? "admin_bypass" : null,
      status: ApiStatus.SUCCESS,
    });

    await next();
  };
};
