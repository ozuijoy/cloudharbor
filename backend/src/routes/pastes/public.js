import { ApiStatus, UserType } from "../../constants/index.js";
import { AppError, ValidationError, AuthenticationError, NotFoundError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { getPasteBySlug, verifyPastePassword, incrementAndCheckPasteViews, isPasteAccessible } from "../../services/pasteService.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { useRepositories } from "../../utils/repositories.js";
import { ProxySignatureService } from "../../services/ProxySignatureService.js";
import { PASTE_URL_PROXY_TICKET_PATH } from "./urlProxyConfig.js";

// 可選解析當前訪問者身份（管理員 / API Key 使用者），匿名時返回 null
const resolveOptionalPrincipal = (c) => {
  try {
    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY], allowGuest: true });
    return identity;
  } catch (e) {
    return null;
  }
};

// 檢查當前訪問者是否有權訪問指定文字（用於 is_public 控制）
const ensurePasteVisibility = (c, paste) => {
  if (!paste) return;

  // 公開文字：任何持有連結的人都可以訪問
  if (paste.is_public === 1 || paste.is_public === true || paste.is_public === null || paste.is_public === undefined) {
    return;
  }

  // 非公開文字：僅管理員和建立者可訪問
  const identity = resolveOptionalPrincipal(c);
  if (!identity) {
    // 匿名或無法識別身份時直接隱藏資源存在性
    throw new NotFoundError("文字分享不存在或已被刪除");
  }

  if (identity.isAdmin) {
    return;
  }

  const createdBy = paste.created_by;
  const userId = identity.userId;

  // 對於 API Key 使用者，created_by 形如 "apikey:<id>"
  const isApiKeyOwner = identity.type === UserType.API_KEY && typeof createdBy === "string" && createdBy === `apikey:${userId}`;

  if (!isApiKeyOwner) {
    throw new NotFoundError("文字分享不存在或已被刪除");
  }
};

export const registerPastesPublicRoutes = (router) => {
  // URL 內容代理（Query Ticket 版）
  // - 供 SnapDOM useProxy 使用：瀏覽器側資源請求無法攜帶 Authorization Header
  // - 透過 ticket 做短期校驗，避免把 /api/share/url/proxy 直接開放給匿名請求
  router.get("/api/paste/url/proxy", async (c) => {
    const db = c.env.DB;
    const url = c.req.query("url");
    const ticket = c.req.query("ticket");

    if (!url) {
      throw new ValidationError("缺少URL引數");
    }
    if (!ticket) {
      throw new AuthenticationError("缺少代理票據");
    }

    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = useRepositories(c);

    const signatureService = new ProxySignatureService(db, encryptionSecret, repositoryFactory);
    const verifyResult = signatureService.verifyStorageSignature(PASTE_URL_PROXY_TICKET_PATH, ticket);
    if (!verifyResult.valid) {
      throw new AuthenticationError(`代理票據無效: ${verifyResult.reason}`);
    }

    const { FileShareService } = await import("../../services/fileShareService.js");
    const shareService = new FileShareService(db, encryptionSecret);
    return await shareService.proxyUrlContent(url);
  });

  router.get("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");

    const paste = await getPasteBySlug(db, slug);

    // 先根據 is_public 與當前訪客身份控制訪問
    ensurePasteVisibility(c, paste);

    if (paste.has_password) {
      // 加密文字在驗證密碼前不應洩露標題、備註等敏感資訊
      return jsonOk(
        c,
        {
          slug: paste.slug,
          hasPassword: true,
          requiresPassword: true,
        },
        "需要密碼驗證"
      );
    }

    if (!isPasteAccessible(paste)) {
      throw new AppError("文字分享已過期或超過最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        title: paste.title,
        content: paste.content,
        remark: paste.remark,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        created_by: paste.created_by,
        is_public: paste.is_public,
        hasPassword: false,
        isLastView: true,
      }, "獲取文字內容成功");
    }

    if (result.isDeleted) {
      throw new AppError("文字分享已達到最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      title: paste.title,
      content: paste.content,
      remark: paste.remark,
      expires_at: paste.expires_at,
      max_views: paste.max_views,
      views: result.paste.views,
      created_at: paste.created_at,
      created_by: paste.created_by,
      is_public: paste.is_public,
      hasPassword: false,
      isLastView: result.isLastView,
    }, "獲取文字內容成功");
  });

  router.post("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const { password } = await c.req.json();

    if (!password) {
      throw new ValidationError("請提供密碼");
    }

    const paste = await verifyPastePassword(db, slug, password, false);

    // 再次根據 is_public 與當前訪客身份控制訪問
    ensurePasteVisibility(c, paste);
    const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

    if (result.isLastNormalAccess) {
      return jsonOk(c, {
        slug: paste.slug,
        title: paste.title,
        content: paste.content,
        remark: paste.remark,
        hasPassword: true,
        plain_password: paste.plain_password,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        updated_at: paste.updated_at,
        created_by: paste.created_by,
        is_public: paste.is_public,
        isLastView: true,
      }, "密碼驗證成功");
    }

    if (result.isDeleted) {
      throw new AppError("文字分享已達到最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
    }

    return jsonOk(c, {
      slug: paste.slug,
      title: paste.title,
      content: paste.content,
      remark: paste.remark,
      hasPassword: true,
      plain_password: paste.plain_password,
      expires_at: paste.expires_at,
      max_views: paste.max_views,
      views: result.paste.views,
      created_at: paste.created_at,
      updated_at: paste.updated_at,
      created_by: paste.created_by,
      is_public: paste.is_public,
      isLastView: result.isLastView,
    }, "獲取文字內容成功");
  });

  router.get("/api/raw/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const password = c.req.query("password");

    const run = async () => {
      const paste = await getPasteBySlug(db, slug);

      // 原始內容同樣受 is_public 控制
      ensurePasteVisibility(c, paste);

      if (paste.has_password) {
        if (!password) {
          throw new AuthenticationError("需要密碼才能訪問此內容");
        }

        await verifyPastePassword(db, slug, password, false).catch(() => {
          throw new AuthenticationError("密碼錯誤");
        });

        const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

        if (result.isDeleted && !result.isLastNormalAccess) {
          throw new AppError("文字分享已達到最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }
      } else {
        if (!isPasteAccessible(paste)) {
          throw new AppError("文字分享已過期或超過最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }

        const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

        if (result.isDeleted && !result.isLastNormalAccess) {
          throw new AppError("文字分享已達到最大檢視次數", { status: ApiStatus.GONE, code: "PASTE_GONE", expose: true });
        }
      }

      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", `inline; filename="${slug}.txt"`);
      return c.text(paste.content);
    };

    return run().catch((error) => {
      console.error("獲取原始文字內容失敗:", error);
      c.header("Content-Type", "text/plain; charset=utf-8");

      if (error instanceof AppError) {
        return c.text(error.message, error.status);
      }

      return c.text("獲取內容失敗", ApiStatus.INTERNAL_ERROR);
    });
  });
};
