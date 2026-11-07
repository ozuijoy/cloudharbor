/**
 * 通用儲存配置路由（現階段對應 S3 配置的通用外觀）
 */
import { Hono } from "hono";
import {
  getStorageConfigsByAdmin,
  getPublicStorageConfigs,
  getStorageConfigByIdForAdmin,
  getPublicStorageConfigById,
  createStorageConfig,
  updateStorageConfig,
  deleteStorageConfig,
  setDefaultStorageConfig,
  testStorageConnection,
} from "../services/storageConfigService.js";
import { UserType } from "../constants/index.js";
import { getPagination, jsonOk, jsonCreated } from "../utils/common.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { useRepositories } from "../utils/repositories.js";
import { NotFoundError } from "../http/errors.js";

const storageConfigRoutes = new Hono();
const requireRead = usePolicy("storage.config.read");
const requireAdmin = usePolicy("admin.all");

// 獲取儲存配置列表（管理員或公開）
storageConfigRoutes.get("/api/storage", requireRead, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = useRepositories(c);
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const isAdmin = identity.isAdmin;
  const adminId = identity.userId;

  if (isAdmin) {
    const hasPageParam = c.req.query("page") !== undefined;
    const hasLimitParam = c.req.query("limit") !== undefined;

    if (hasPageParam || hasLimitParam) {
      const { limit, page } = getPagination(c, { limit: 10, page: 1 });
      const result = await getStorageConfigsByAdmin(db, adminId, { page, limit }, repositoryFactory);
      return jsonOk(c, { items: result.configs, total: result.total }, "獲取儲存配置列表成功");
    }

    const result = await getStorageConfigsByAdmin(db, adminId, {}, repositoryFactory);
    return jsonOk(c, { items: result.configs, total: result.total }, "獲取儲存配置列表成功");
  }

  // API 金鑰使用者：僅能看到“公開 + ACL 白名單”內的儲存配置
  const configs = await getPublicStorageConfigs(db, repositoryFactory);

  const repoFactory = repositoryFactory;
  const aclRepo = repoFactory.getPrincipalStorageAclRepository
    ? repoFactory.getPrincipalStorageAclRepository()
    : null;

  let filteredConfigs = configs;
  if (aclRepo && identity.userId) {
    try {
      const allowedIds = await aclRepo.findConfigIdsBySubject("API_KEY", identity.userId);
      if (Array.isArray(allowedIds) && allowedIds.length > 0) {
        const allowedSet = new Set(allowedIds);
        filteredConfigs = configs.filter((cfg) => allowedSet.has(cfg.id));
      }
    } catch (error) {
      console.warn("載入儲存 ACL 失敗，將回退到僅基於 is_public 的儲存配置列表：", error);
    }
  }

  return jsonOk(c, { items: filteredConfigs, total: filteredConfigs.length }, "獲取儲存配置列表成功");
});

// 獲取單個儲存配置詳情
storageConfigRoutes.get("/api/storage/:id", requireRead, async (c) => {
  const db = c.env.DB;
  const { id } = c.req.param();
  const repositoryFactory = useRepositories(c);
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const isAdmin = identity.isAdmin;
  const adminId = identity.userId;

  // reveal=plain|masked（僅管理員）
  const reveal = c.req.query("reveal"); // 'plain' | 'masked'
  let config;
  if (isAdmin) {
    if (reveal === "plain" || reveal === "masked") {
      const encryptionSecret = getEncryptionSecret(c);
      const { getStorageConfigByIdForAdminReveal } = await import("../services/storageConfigService.js");
      config = await getStorageConfigByIdForAdminReveal(db, id, adminId, encryptionSecret, reveal, repositoryFactory);
      // 簡要審計日誌（不列印明文）
      console.log(JSON.stringify({ type: "secrets.reveal", id, adminId, mode: reveal, timestamp: new Date().toISOString() }));
    } else {
      config = await getStorageConfigByIdForAdmin(db, id, adminId, repositoryFactory);
    }
  } else {
    // API 金鑰使用者：僅允許訪問“公開 + ACL 白名單”內的儲存配置
    const repoFactory = repositoryFactory;
    const aclRepo = repoFactory.getPrincipalStorageAclRepository
      ? repoFactory.getPrincipalStorageAclRepository()
      : null;

    const cfg = await getPublicStorageConfigById(db, id, repositoryFactory);

    if (aclRepo && identity.userId) {
      try {
        const allowedIds = await aclRepo.findConfigIdsBySubject("API_KEY", identity.userId);
        if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(cfg.id)) {
          throw new NotFoundError("儲存配置不存在");
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        console.warn("載入儲存 ACL 失敗，將回退到僅基於 is_public 的訪問控制：", error);
      }
    }

    config = cfg;
  }

  return jsonOk(c, config, "獲取儲存配置成功");
});

// 建立儲存配置（管理員）
storageConfigRoutes.post("/api/storage", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const encryptionSecret = getEncryptionSecret(c);
  const body = await c.req.json();
  const repositoryFactory = useRepositories(c);
  const config = await createStorageConfig(db, body, adminId, encryptionSecret, repositoryFactory);
  return jsonCreated(c, config, "儲存配置建立成功");
});

// 更新儲存配置（管理員）
storageConfigRoutes.put("/api/storage/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const body = await c.req.json();
  await updateStorageConfig(db, id, body, adminId, encryptionSecret, repositoryFactory);

  const updated = await getStorageConfigByIdForAdmin(db, id, adminId, repositoryFactory);
  return jsonOk(c, updated, "儲存配置已更新");
});

// 刪除儲存配置（管理員）
storageConfigRoutes.delete("/api/storage/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const repositoryFactory = useRepositories(c);

  await deleteStorageConfig(db, id, adminId, repositoryFactory);
  return jsonOk(c, undefined, "儲存配置刪除成功");
});

// 設定預設儲存配置（管理員）
storageConfigRoutes.put("/api/storage/:id/set-default", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const repositoryFactory = useRepositories(c);
  await setDefaultStorageConfig(db, id, adminId, repositoryFactory);
  return jsonOk(c, undefined, "預設儲存配置設定成功");
});

// 測試儲存配置連線（管理員）
storageConfigRoutes.post("/api/storage/:id/test", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const requestOrigin = c.req.header("origin");
  const repositoryFactory = useRepositories(c);
  const testData = await testStorageConnection(db, id, adminId, encryptionSecret, requestOrigin, repositoryFactory);

  // 外層 success 只表示“請求是否被處理成功”
  // 測試透過/失敗由 data.success 表示
  return jsonOk(c, testData, "OK");
});

export default storageConfigRoutes;
