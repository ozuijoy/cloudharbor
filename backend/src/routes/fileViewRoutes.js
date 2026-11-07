/**
 * 檔案檢視路由
 * 處理檔案分享的檢視、下載、預覽功能
 */
import { Hono } from "hono";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { handleFileDownload, checkAndDeleteExpiredFile } from "../services/fileViewService.js";
import { getFileBySlug, isFileAccessible } from "../services/fileService.js";
import { useRepositories } from "../utils/repositories.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, AuthorizationError, NotFoundError } from "../http/errors.js";
import { verifyPassword } from "../utils/crypto.js";

const app = new Hono();

// ==========================================
// 路由處理器
// ==========================================

/**
 * Share 內容交付統一入口
 * - 負責密碼/過期/可訪問性校驗
 * - 最終委託 FileViewService 進行直鏈/代理決策與資料流輸出
 */
async function handleShareDelivery(c, { forceDownload, forceProxy }) {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  // 統一從檔案記錄出發做密碼與過期校驗，避免直鏈路徑繞過密碼保護
  const file = await getFileBySlug(db, slug, encryptionSecret);
  if (!file) {
    throw new NotFoundError("檔案不存在");
  }

  const url = new URL(c.req.url);
  const passwordParam = url.searchParams.get("password");

  if (file.password) {
    if (!passwordParam) {
      throw new AuthorizationError("需要密碼訪問此檔案");
    }
    const valid = await verifyPassword(passwordParam, file.password);
    if (!valid) {
      throw new AuthorizationError("密碼不正確");
    }
  }

  const accessCheck = await isFileAccessible(db, file, encryptionSecret);
  if (!accessCheck.accessible) {
    if (accessCheck.reason === "expired") {
      await checkAndDeleteExpiredFile(db, file, encryptionSecret, repositoryFactory);
      throw new AppError("檔案已過期", { status: ApiStatus.GONE, code: "GONE", expose: true });
    }
    throw new AuthorizationError("檔案不可訪問");
  }

  return handleFileDownload(slug, db, encryptionSecret, c.req.raw, forceDownload, repositoryFactory, {
    forceProxy: !!forceProxy,
  });
}

// Share 本地代理入口 /api/s/:slug（等價 FS 的 /api/p）
// - 永遠同源本地流式 200，不做直鏈/Worker 決策
// - down=true/1 表示下載語義，否則為預覽語義
app.get("/api/s/:slug", async (c) => {
  const url = new URL(c.req.url);
  const down = url.searchParams.get("down");
  const legacyMode = url.searchParams.get("mode");
  const forceDownload =
    (down && down !== "0" && down !== "false") ||
    legacyMode === "attachment" ||
    legacyMode === "download";
  return handleShareDelivery(c, { forceDownload, forceProxy: true });
});

// Share 本地代理入口
// - 例如：/api/s/:slug/:filename
// - filename 僅用於展示/識別型別，不參與檔案定位
app.get("/api/s/:slug/:filename", async (c) => {
  const url = new URL(c.req.url);
  const down = url.searchParams.get("down");
  const legacyMode = url.searchParams.get("mode");
  const forceDownload =
    (down && down !== "0" && down !== "false") ||
    legacyMode === "attachment" ||
    legacyMode === "download";
  return handleShareDelivery(c, { forceDownload, forceProxy: true });
});

// Share 文字/編碼檢測專用同源內容口（共用）
app.get("/api/share/content/:slug", async (c) => {
  return handleShareDelivery(c, { forceDownload: false, forceProxy: true });
});

// Share 文字/編碼檢測專用同源內容口
app.get("/api/share/content/:slug/:filename", async (c) => {
  return handleShareDelivery(c, { forceDownload: false, forceProxy: true });
});

export default app;
