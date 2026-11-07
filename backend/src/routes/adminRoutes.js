import { Hono } from "hono";
import { login, logout, changePassword, testAdminToken } from "../services/adminService.js";
import { UserType } from "../constants/index.js";
import { jsonOk } from "../utils/common.js";
import { directoryCacheManager, urlCacheManager, searchCacheManager } from "../cache/index.js";
import { invalidateFsCache, invalidateAllCaches } from "../cache/invalidation.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const adminRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");
const requireMountView = usePolicy("fs.base");

const readCacheStats = async (label, reader) => {
  if (typeof reader !== "function") {
    return { error: `${label}模組未啟用` };
  }

  return Promise.resolve()
    .then(() => reader())
    .catch((error) => {
      console.warn(`獲取${label}統計失敗:`, error);
      return { error: `${label}模組未啟用` };
    });
};

// 管理員登入
adminRoutes.post("/api/admin/login", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const { username, password } = await c.req.json();
  const loginResult = await login(db, username, password, repositoryFactory, c.env);

  return jsonOk(c, loginResult, "登入成功");
});

// 管理員登出 - 不需要認證檢查，因為可能令牌已過期
adminRoutes.post("/api/admin/logout", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const authHeader = c.req.header("Authorization");

  // 如果沒有認證頭，直接返回成功（前端清理狀態）
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonOk(c, undefined, "登出成功");
  }

  const token = authHeader.substring(7);

  await logout(db, token, repositoryFactory).catch((error) => {
    console.log("登出時清理令牌失敗（可能已過期）:", error.message);
  });

  return jsonOk(c, undefined, "登出成功");
});

// 更改管理員密碼（需要認證）
adminRoutes.post("/api/admin/change-password", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { currentPassword, newPassword, newUsername } = await c.req.json();

  await changePassword(db, adminId, currentPassword, newPassword, newUsername, repositoryFactory);

  return jsonOk(c, undefined, "資訊更新成功，請重新登入");
});

// 測試管理員令牌路由
adminRoutes.get("/api/test/admin-token", requireAdmin, async (c) => {
  // 使用新的統一認證系統，管理員許可權已在中介軟體中驗證
  return jsonOk(c, undefined, "令牌有效");
});

// 獲取系統監控資訊（包括快取統計和系統記憶體）
adminRoutes.get("/api/admin/cache/stats", requireAdmin, async (c) => {
  const dirStats = directoryCacheManager.getStats();
  const urlStats = await readCacheStats("URL快取模組", () => urlCacheManager.getStats());
  const searchStats = await readCacheStats("搜尋快取模組", () => searchCacheManager.getStats());

  const memUsage = process.memoryUsage();
  const systemMemory = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
    arrayBuffers: memUsage.arrayBuffers ? Math.round(memUsage.arrayBuffers / 1024 / 1024) : 0,
    heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
  };

  return jsonOk(c, {
      cache: {
        directory: dirStats,
        url: urlStats,
        search: searchStats,
      },
      system: {
        memory: systemMemory,
        uptime: Math.round(process.uptime()),
      },
      timestamp: new Date().toISOString(),
    }, "獲取系統監控資訊成功");
});

// 清理目錄快取（管理員）
adminRoutes.post("/api/admin/cache/clear", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { mountId, storageConfigId } = await c.req.json().catch(() => ({}));
  let clearedScope = null;

  if (mountId) {
    invalidateFsCache({ mountId, reason: "admin-manual", db });
    clearedScope = `mount:${mountId}`;
    console.log(`管理員手動清理掛載點快取 - 掛載點ID: ${mountId}`);
  } else if (storageConfigId) {
    invalidateFsCache({ storageConfigId, reason: "admin-manual", db });
    clearedScope = `storageConfig:${storageConfigId}`;
    console.log(`管理員手動清理儲存配置快取 - 儲存配置ID: ${storageConfigId}`);
  } else {
    invalidateAllCaches({ reason: "admin-manual-all" });
    clearedScope = "all";
    console.log(`管理員手動清理所有快取`);
  }

  return jsonOk(c, { scope: clearedScope, timestamp: new Date().toISOString() }, "快取清理操作已觸發");
});

// 清理目錄快取（API金鑰使用者）
adminRoutes.post("/api/user/cache/clear", requireMountView, async (c) => {
  const db = c.env.DB;
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const apiKeyInfo = identity.apiKeyInfo;

  const { mountId, storageConfigId } = await c.req.json().catch(() => ({}));
  let clearedScope = null;

  if (mountId) {
    invalidateFsCache({ mountId, reason: "user-manual", db });
    clearedScope = `mount:${mountId}`;
    console.log(`API金鑰使用者手動清理掛載點快取 - 使用者: ${apiKeyInfo?.name || identity.type}, 掛載點ID: ${mountId}`);
  } else if (storageConfigId) {
    invalidateFsCache({ storageConfigId, reason: "user-manual", db });
    clearedScope = `storageConfig:${storageConfigId}`;
    console.log(`API金鑰使用者手動清理儲存配置快取 - 使用者: ${apiKeyInfo?.name || identity.type}, 儲存配置ID: ${storageConfigId}`);
  } else {
    invalidateAllCaches({ reason: "user-manual-all" });
    clearedScope = "all";
    console.log(`API金鑰使用者手動清理所有快取 - 使用者: ${apiKeyInfo?.name || identity.type}`);
  }

  return jsonOk(c, { scope: clearedScope, timestamp: new Date().toISOString() }, "快取清理操作已觸發");
});

export default adminRoutes;
