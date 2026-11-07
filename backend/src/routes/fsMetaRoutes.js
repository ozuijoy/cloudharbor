/**
 * FS Meta 管理路由
 * 提供目錄元資訊的 CRUD 操作介面
 */
import { Hono } from "hono";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk, jsonCreated } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { ValidationError } from "../http/errors.js";

const fsMetaRoutes = new Hono();

// 只有管理員可以管理元資訊
const requireAdmin = usePolicy("admin.all");

/**
 * 獲取所有元資訊記錄
 * GET /api/fs-meta/list
 */
fsMetaRoutes.get("/api/fs-meta/list", requireAdmin, async (c) => {
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const records = await fsMetaRepository.findAll();

  // 轉換為前端友好格式（隱藏密碼雜湊）
  const sanitized = records.map((record) => ({
    id: record.id,
    path: record.path,
    headerMarkdown: record.header_markdown,
    headerInherit: Boolean(record.header_inherit),
    footerMarkdown: record.footer_markdown,
    footerInherit: Boolean(record.footer_inherit),
    hidePatterns: record.hide_patterns ? JSON.parse(record.hide_patterns) : [],
    hideInherit: Boolean(record.hide_inherit),
    // 明文密碼僅用於管理端檢視/複製
    password: record.password,
    hasPassword: Boolean(record.password),
    passwordInherit: Boolean(record.password_inherit),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }));

  return jsonOk(c, sanitized, "獲取元資訊列表成功");
});

/**
 * 獲取單個元資訊記錄
 * GET /api/fs-meta/:id
 */
fsMetaRoutes.get("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const record = await fsMetaRepository.findById(Number(id));

  if (!record) {
    throw new ValidationError("元資訊記錄不存在");
  }

  const sanitized = {
    id: record.id,
    path: record.path,
    headerMarkdown: record.header_markdown,
    headerInherit: Boolean(record.header_inherit),
    footerMarkdown: record.footer_markdown,
    footerInherit: Boolean(record.footer_inherit),
    hidePatterns: record.hide_patterns ? JSON.parse(record.hide_patterns) : [],
    hideInherit: Boolean(record.hide_inherit),
    password: record.password,
    hasPassword: Boolean(record.password),
    passwordInherit: Boolean(record.password_inherit),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };

  return jsonOk(c, sanitized, "獲取元資訊成功");
});

/**
 * 建立元資訊記錄
 * POST /api/fs-meta/create
 */
fsMetaRoutes.post("/api/fs-meta/create", requireAdmin, async (c) => {
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();
  const body = await c.req.json();

  // 驗證必填欄位
  if (!body.path || typeof body.path !== "string") {
    throw new ValidationError("路徑不能為空");
  }

  // 檢查路徑是否已存在
  const existing = await fsMetaRepository.findByPath(body.path);
  if (existing) {
    throw new ValidationError("該路徑的元資訊已存在");
  }

  // 準備資料
  const data = {
    path: body.path,
    header_markdown: body.headerMarkdown || null,
    header_inherit: body.headerInherit || false,
    footer_markdown: body.footerMarkdown || null,
    footer_inherit: body.footerInherit || false,
    hide_patterns: body.hidePatterns && Array.isArray(body.hidePatterns) ? JSON.stringify(body.hidePatterns) : null,
    hide_inherit: body.hideInherit || false,
    password: null,
    password_inherit: body.passwordInherit || false,
  };

  // 處理密碼（如果提供，直接以明文儲存）
  if (body.password && typeof body.password === "string" && body.password.trim().length > 0) {
    data.password = body.password.trim();
  }

  const created = await fsMetaRepository.create(data);

  return jsonCreated(c, { id: created.id }, "元資訊建立成功");
});

/**
 * 更新元資訊記錄
 * PUT /api/fs-meta/:id
 */
fsMetaRoutes.put("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();
  const body = await c.req.json();

  // 驗證記錄是否存在
  const existing = await fsMetaRepository.findById(Number(id));
  if (!existing) {
    throw new ValidationError("元資訊記錄不存在");
  }

  // 如果修改了路徑，檢查新路徑是否衝突
  if (body.path && body.path !== existing.path) {
    const conflict = await fsMetaRepository.findByPath(body.path);
    if (conflict) {
      throw new ValidationError("該路徑的元資訊已存在");
    }
  }

  // 準備更新資料
  const updates = {};

  if (body.path !== undefined) updates.path = body.path;
  if (body.headerMarkdown !== undefined) updates.header_markdown = body.headerMarkdown;
  if (body.headerInherit !== undefined) updates.header_inherit = body.headerInherit;
  if (body.footerMarkdown !== undefined) updates.footer_markdown = body.footerMarkdown;
  if (body.footerInherit !== undefined) updates.footer_inherit = body.footerInherit;
  if (body.hidePatterns !== undefined) {
    updates.hide_patterns = Array.isArray(body.hidePatterns) ? JSON.stringify(body.hidePatterns) : null;
  }
  if (body.hideInherit !== undefined) updates.hide_inherit = body.hideInherit;
  if (body.passwordInherit !== undefined) updates.password_inherit = body.passwordInherit;

  // 處理密碼更新（僅當顯式提供時）
  if (body.password !== undefined) {
    if (body.password && typeof body.password === "string" && body.password.trim().length > 0) {
      updates.password = body.password.trim();
    } else {
      // 空字串表示清除密碼
      updates.password = null;
    }
  }

  await fsMetaRepository.update(Number(id), updates);

  return jsonOk(c, undefined, "元資訊更新成功");
});

/**
 * 刪除元資訊記錄
 * DELETE /api/fs-meta/:id
 */
fsMetaRoutes.delete("/api/fs-meta/:id", requireAdmin, async (c) => {
  const { id } = c.req.param();
  const repositoryFactory = c.get("repos");
  const fsMetaRepository = repositoryFactory.getFsMetaRepository();

  const existing = await fsMetaRepository.findById(Number(id));
  if (!existing) {
    throw new ValidationError("元資訊記錄不存在");
  }

  await fsMetaRepository.delete(Number(id));

  return jsonOk(c, undefined, "元資訊刪除成功");
});

export default fsMetaRoutes;
