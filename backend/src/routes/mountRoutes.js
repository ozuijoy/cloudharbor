/**
 * 統一掛載點路由
 */
import { Hono } from "hono";
import { createMount, updateMount, deleteMount, getAllMounts } from "../services/storageMountService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk, jsonCreated } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getAccessibleMountsForUser } from "../security/helpers/access.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { getMountConfigSchema } from "../storage/factory/MountConfigSchema.js";

/**
 * 為掛載點列表附加能力資訊
 * @param {Array} mounts - 掛載點列表
 * @returns {Array} 附加了 capabilities 欄位的掛載點列表
 */
function enrichMountsWithCapabilities(mounts) {
  if (!Array.isArray(mounts)) return mounts;
  return mounts.map(mount => ({
    ...mount,
    capabilities: StorageFactory.getRegisteredCapabilities(mount.storage_type) || [],
  }));
}

const mountRoutes = new Hono();

/**
 * 獲取掛載點列表
 * 統一入口，根據使用者許可權返回不同資料：
 * - 管理員：返回所有掛載點（包括禁用的）
 * - API金鑰使用者：返回有許可權的活躍掛載點
 */
const requireAdmin = usePolicy("admin.all");
const requireMountView = usePolicy("fs.base");

mountRoutes.get("/api/mount/list", requireMountView, async (c) => {
  const db = c.env.DB;
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });

  if (identity.isAdmin) {
    const mounts = await getAllMounts(db, true);
    // 附加驅動能力資訊，供前端動態適配功能
    const enrichedMounts = enrichMountsWithCapabilities(mounts);
    return jsonOk(c, enrichedMounts, "獲取掛載點列表成功");
  }

  const mounts = await getAccessibleMountsForUser(db, identity.apiKeyInfo, UserType.API_KEY);
  // 附加驅動能力資訊，供前端動態適配功能
  const enrichedMounts = enrichMountsWithCapabilities(mounts);
  return jsonOk(c, enrichedMounts, "獲取掛載點列表成功");
});

/**
 * 建立掛載點（僅管理員）
 */
mountRoutes.post("/api/mount/create", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });

  const body = await c.req.json();
  const mount = await createMount(db, body, adminId);

  return jsonCreated(c, mount, "掛載點建立成功");
});

/**
 * 更新掛載點（僅管理員）
 */
mountRoutes.put("/api/mount/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();

  const body = await c.req.json();
  await updateMount(db, id, body, adminId, true);

  return jsonOk(c, undefined, "掛載點已更新");
});

/**
 * 刪除掛載點（僅管理員）
 */
mountRoutes.delete("/api/mount/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();

  await deleteMount(db, id, adminId, true);

  return jsonOk(c, undefined, "掛載點刪除成功");
});

/**
 * 獲取儲存型別的能力列表
 * GET /api/storage-types/:type/capabilities
 * 返回指定儲存型別支援的能力列表及後設資料
 */
mountRoutes.get("/api/storage-types/:type/capabilities", requireMountView, async (c) => {
  const { type } = c.req.param();

  if (!StorageFactory.isTypeSupported(type)) {
    return c.json({ success: false, message: `不支援的儲存型別: ${type}` }, ApiStatus.NOT_FOUND);
  }

  const meta = StorageFactory.getTypeMetadata(type);

  return jsonOk(
    c,
    {
      storageType: type,
      displayName: meta?.displayName || type,
      capabilities: meta?.capabilities || [],
      ui: meta?.ui || null,
      configSchema: meta?.configSchema || null,
      providerOptions: meta?.providerOptions || null,
    },
    "獲取儲存型別能力成功",
  );
});

/**
 * 獲取所有支援的儲存型別及其能力
 * GET /api/storage-types
 * 返回所有註冊的儲存型別及其能力與配置後設資料資訊
 */
mountRoutes.get("/api/storage-types", requireMountView, async (c) => {
  const result = StorageFactory.getAllTypeMetadata();
  return jsonOk(c, result, "獲取儲存型別列表成功");
});

/**
 * 獲取掛載點配置Schema
 * GET /api/mount-schema
 * 返回掛載點表單的Schema定義，供前端動態渲染表單
 */
mountRoutes.get("/api/mount-schema", requireAdmin, async (c) => {
  const schema = getMountConfigSchema();
  return jsonOk(c, schema, "獲取掛載點Schema成功");
});

export default mountRoutes;
