/**
 * 統一儲存連結解析介面
 * POST /api/proxy/link
 *
 * - Origin（CloudHarbor）只負責許可權與“如何訪問源”的決策
 * - 反向代理/Proxy 服務只呼叫此介面獲取 { url, header }，然後直接向 url 發起請求
 * - FS / Share / WebDAV 最終都透過該介面解析，不在 Proxy 中分業務
 */

import { Hono } from "hono";
import { ApiStatus, UserType } from "../constants/index.js";
import { ValidationError, NotFoundError, AuthorizationError } from "../http/errors.js";
import { LinkService } from "../storage/link/LinkService.js";
import { FileService } from "../services/fileService.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { getPrincipal } from "../security/middleware/securityContext.js";

const proxyLinkRoutes = new Hono();

/**
 * 解析請求體
 * 約定：
 * - type = "fs"    → 使用 path 解析掛載檢視（包含 WebDAV 在內）
 * - type = "share" → 使用 slug 解析分享檢視
 * 目前不單獨暴露 webdav 型別，WebDAV 在 FileSystem 層按掛載檢視處理
 */
async function parseLinkBody(c) {
  let body = {};
  try {
    body = (await c.req.json()) || {};
  } catch {
    body = {};
  }

  const type = body.type || "fs";
  const path = body.path || null;
  const slug = body.slug || null;

  if (!["fs", "share"].includes(type)) {
    throw new ValidationError("Invalid type, expected fs|share");
  }

  if (type === "fs" && !path) {
    throw new ValidationError("Missing path for fs type");
  }
  if (type === "share" && !slug) {
    throw new ValidationError("Missing slug for share type");
  }

  return { type, path, slug };
}

/**
 * 統一響應格式
 * {
 *   code: 200,
 *   data: {
 *     url: string,
 *     header: Record<string, string[]>
 *   }
 * }
 */
function normalizeHeaders(rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== "object") {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      result[key] = value.map((v) => String(v));
    } else if (value != null) {
      result[key] = [String(value)];
    }
  }
  return result;
}

function buildLinkResponse({ url, header }) {
  return {
    code: 200,
    data: {
      url,
      header: header || {},
    },
  };
}

proxyLinkRoutes.post("/api/proxy/link", async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = c.get("repos");

  const { type, path, slug } = await parseLinkBody(c);

  const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
  const fileService = new FileService(db, encryptionSecret, repositoryFactory);

  // 使用 principal，支援 ADMIN / API_KEY / 匿名三種身份
  const principal = getPrincipal(c);
  let userType;
  let userIdOrInfo;

  if (principal && principal.isAdmin) {
    userType = UserType.ADMIN;
    userIdOrInfo = principal.id;
  } else if (principal && principal.type === "apiKey") {
    const apiKeyInfo = principal.attributes?.keyInfo ?? {
      id: principal.id,
      basicPath: principal.attributes?.basicPath ?? "/",
      permissions: principal.authorities,
    };
    userType = UserType.API_KEY;
    userIdOrInfo = apiKeyInfo;
  } else {
    userType = UserType.ANONYMOUS;
    userIdOrInfo = null;
  }

  switch (type) {
    case "fs": {
      const storageLink = await linkService.getFsUpstreamLink(path, userIdOrInfo, userType, {
        forceDownload: true,
        request: c.req.raw,
      });

      if (!storageLink || !storageLink.url) {
        throw new NotFoundError("FS path does not have a resolvable link");
      }

      return c.json(
        buildLinkResponse({
          url: storageLink.url,
          header: normalizeHeaders(storageLink.headers || {}),
        }),
        ApiStatus.OK,
      );
    }

    case "share": {
      const file = await fileService.getFileBySlug(slug);
      const access = fileService.isFileAccessible(file);
      if (!access.accessible) {
        if (access.reason === "expired") {
          throw new AuthorizationError("File is expired");
        }
        throw new NotFoundError("File is not accessible");
      }

      const storageLink = await linkService.getShareUpstreamLink(
        file,
        // 分享檢視只需要 user 型別與 id（目前僅用於後續擴充套件）
        { type: userType, id: userType === UserType.ADMIN ? userIdOrInfo : userIdOrInfo?.id ?? null },
        {
          request: c.req.raw,
        },
      );
      if (!storageLink || !storageLink.url) {
        throw new NotFoundError("Share file does not have a resolvable link");
      }

      return c.json(
        buildLinkResponse({
          url: storageLink.url,
          header: normalizeHeaders(storageLink.headers || {}),
        }),
        ApiStatus.OK,
      );
    }

    default:
      throw new ValidationError("Unsupported link type");
  }
});

export { proxyLinkRoutes };
