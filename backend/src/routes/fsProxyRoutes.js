/**
 * 檔案系統代理路由
 * 處理/p/*路徑的檔案訪問請求
 * 專門用於web_proxy功能的檔案代理訪問
 * - Range/條件請求由 StorageStreaming 統一處理
 */

import { Hono } from "hono";
import crypto from "crypto";
import { AppError, AuthenticationError, DriverError } from "../http/errors.js";
import { ApiStatus } from "../constants/index.js";
import { MountManager } from "../storage/managers/MountManager.js";
import { findMountPointByPathForProxy } from "../storage/fs/utils/MountResolver.js";
import { PROXY_CONFIG, safeDecodeProxyPath } from "../constants/proxy.js";
import { ProxySignatureService } from "../services/ProxySignatureService.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { getQueryBool } from "../utils/common.js";
import { CAPABILITIES } from "../storage/interfaces/capabilities/index.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../storage/streaming/index.js";

// 簽名代理路徑不會走 RBAC，因此這裡用結構化日誌補充最少可觀測性。
const emitProxyAudit = (c, details) => {
  const payload = {
    type: "proxy.audit",
    reqId: c.get?.("reqId") ?? null,
    path: details.path,
    decision: details.decision,
    reason: details.reason ?? null,
    signatureRequired: details.signatureRequired ?? false,
    signatureProvided: details.signatureProvided ?? false,
    mountId: details.mountId ?? null,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload));
};

const rewriteHlsM3u8ForSignature = (playlistText, options) => {
  const rawText = String(playlistText || "");
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r?\n/);

  const decodeMulti = (value, maxTimes = 3) => {
    let out = String(value || "");
    for (let i = 0; i < maxTimes; i++) {
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };

  const normalizeFsPath = (p) => {
    const raw = String(p || "").trim();
    if (!raw) return "/";
    const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
    return withLeading.replace(/\/{2,}/g, "/");
  };

  const hasPathTraversal = (p) => String(p || "").split("/").includes("..");
  const hasExternalScheme = (u) => /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) || String(u || "").startsWith("//");
  const hasSignParam = (u) => /(?:[?&])sign=/.test(String(u || ""));

  const playlistFsPath = normalizeFsPath(options.playlistFsPath || "/");
  const baseDir = (() => {
    const idx = playlistFsPath.lastIndexOf("/");
    return idx >= 0 ? playlistFsPath.slice(0, idx + 1) : "/";
  })();

  const expireTimestamp = options.expireTimestamp;
  const ts = options.ts;
  const secret = options.secret;

  const signForPath = (fsPath) => {
    const signData = `${fsPath}:${expireTimestamp}`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(signData);
    const hash = hmac.digest("base64");
    return `${hash}:${expireTimestamp}`;
  };

  const appendSignQuery = (uri, signature) => {
    if (!uri || hasSignParam(uri)) return uri;
    const raw = String(uri);
    const hashIndex = raw.indexOf("#");
    const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    const qIndex = beforeHash.indexOf("?");
    const pathPart = qIndex >= 0 ? beforeHash.slice(0, qIndex) : beforeHash;
    const queryPart = qIndex >= 0 ? beforeHash.slice(qIndex + 1) : "";

    const extra =
      `${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(String(signature || ""))}` +
      (ts ? `&${PROXY_CONFIG.TIMESTAMP_PARAM}=${encodeURIComponent(String(ts))}` : "");

    return queryPart ? `${pathPart}?${queryPart}&${extra}${hash}` : `${pathPart}?${extra}${hash}`;
  };

  const resolveFsPath = (uriCore) => {
    const core = String(uriCore || "").trim();
    if (!core) return null;

    const noQh = core.split("#")[0].split("?")[0];

    // 支援 m3u8 裡直接寫 /api/p 或 /proxy/fs 的情況
    const apiPIdx = noQh.indexOf("/api/p/");
    if (apiPIdx >= 0) {
      return normalizeFsPath(decodeMulti(noQh.slice(apiPIdx + "/api/p".length)));
    }
    const proxyFsIdx = noQh.indexOf("/proxy/fs/");
    if (proxyFsIdx >= 0) {
      return normalizeFsPath(decodeMulti(noQh.slice(proxyFsIdx + "/proxy/fs".length)));
    }

    if (hasExternalScheme(noQh)) return null;

    const decodedPath = decodeMulti(noQh);
    const fsPath = decodedPath.startsWith("/") ? normalizeFsPath(decodedPath) : normalizeFsPath(`${baseDir}${decodedPath}`);
    if (hasPathTraversal(fsPath)) return null;
    return fsPath;
  };

  const rewriteSingleUri = (uri) => {
    const raw = String(uri || "");
    const leading = raw.match(/^\s*/)?.[0] || "";
    const trailing = raw.match(/\s*$/)?.[0] || "";
    const core = raw.trim();

    if (!core || core.startsWith("#") || hasSignParam(core)) return { uri: raw, changed: false };

    const fsPath = resolveFsPath(core);
    if (!fsPath) return { uri: raw, changed: false };

    const signed = appendSignQuery(core, signForPath(fsPath));
    return { uri: `${leading}${signed}${trailing}`, changed: signed !== core };
  };

  const rewriteTagLineUriAttributes = (line) => {
    const raw = String(line || "");
    const re = /\bURI\s*=\s*("[^"]*"|'[^']*'|[^,\s]+)/g;
    const matches = Array.from(raw.matchAll(re));
    if (!matches.length) return { line: raw, changed: false, signedCount: 0 };

    let out = "";
    let last = 0;
    let changed = false;
    let signedCount = 0;

    for (const m of matches) {
      const full = m[0];
      const token = m[1] || "";
      const start = m.index ?? 0;

      out += raw.slice(last, start);

      const quote = token.startsWith("\"") ? "\"" : token.startsWith("'") ? "'" : "";
      const inner = quote ? token.slice(1, -1) : token;
      const rewritten = rewriteSingleUri(inner);
      if (rewritten.changed) {
        changed = true;
        signedCount += 1;
      }
      out += `URI=${quote}${rewritten.uri.trim()}${quote}`;
      last = start + full.length;
    }

    out += raw.slice(last);
    return { line: out, changed, signedCount };
  };

  let changed = false;
  let signedCount = 0;
  const out = [];

  for (const line of lines) {
    const rawLine = String(line ?? "");
    if (!rawLine) {
      out.push(rawLine);
      continue;
    }

    if (rawLine.startsWith("#")) {
      const rewrittenTag = rewriteTagLineUriAttributes(rawLine);
      out.push(rewrittenTag.line);
      if (rewrittenTag.changed) changed = true;
      signedCount += rewrittenTag.signedCount;
      continue;
    }

    const rewritten = rewriteSingleUri(rawLine);
    out.push(rewritten.uri);
    if (rewritten.changed) {
      changed = true;
      signedCount += 1;
    }
  }

  return { text: out.join(newline), changed, signedCount };
};

const fsProxyRoutes = new Hono();

/**
 * 處理OPTIONS預檢請求 - 代理路由
 */
fsProxyRoutes.options(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, (c) => {
  // CORS頭部將由全域性CORS中介軟體自動處理
  return c.text("", 204); // No Content
});

/**
 * 處理檔案代理訪問
 * 路徑格式：/p/mount/path/file.ext?download=true
 *
 */
fsProxyRoutes.get(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, async (c) => {
  const run = async () => {
    const url = new URL(c.req.url);
    const fullPath = url.pathname;
    const rawPath = fullPath.replace(new RegExp(`^${PROXY_CONFIG.ROUTE_PREFIX}`), "") || "/";
    const path = safeDecodeProxyPath(rawPath);
    const download = getQueryBool(c, "download", false);
    const db = c.env.DB;
    const encryptionSecret = getEncryptionSecret(c);

    console.log(`[fsProxy] 代理訪問: ${path}`);

    // 查詢掛載點（已在MountResolver中驗證web_proxy配置）
    const mountResult = await findMountPointByPathForProxy(db, path);

    if (mountResult.error) {
      console.warn(`代理訪問失敗 - 掛載點查詢失敗: ${mountResult.error.message}`);
      emitProxyAudit(c, {
        path,
        decision: "deny",
        reason: "mount_lookup_failed",
        signatureRequired: false,
        signatureProvided: Boolean(c.req.query(PROXY_CONFIG.SIGN_PARAM)),
      });
      const status = mountResult.error.status;
      const code = status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "PROXY_ERROR";
      throw new AppError(mountResult.error.message, { status, code, expose: true });
    }

    // 掛載點驗證成功，mountResult包含mount和subPath資訊

    // 檢查是否需要簽名驗證
    const repositoryFactory = c.get("repos");
    const signatureService = new ProxySignatureService(db, encryptionSecret, repositoryFactory);
    const signatureNeed = await signatureService.needsSignature(mountResult.mount);

    const signature = c.req.query(PROXY_CONFIG.SIGN_PARAM) || null;
    const signatureProvided = !!signature;

    // 1) 若掛載要求籤名：必須提供簽名
    // 2) 若“主動提供了簽名”：即使掛載不要求，也驗證一下（避免誤用/髒資料）

    if (signatureNeed.required && !signatureProvided) {
      console.warn(`代理訪問失敗 - 缺少簽名: ${path} (${signatureNeed.reason})`);
      emitProxyAudit(c, {
        path,
        decision: "deny",
        reason: "missing_signature",
        signatureRequired: true,
        signatureProvided: false,
        mountId: mountResult.mount.id,
      });
      throw new AuthenticationError(`此檔案需要簽名訪問 (${signatureNeed.description})`);
    }

    if (signatureProvided) {
      const verifyResult = signatureService.verifyStorageSignature(path, signature);
      if (!verifyResult.valid) {
        console.warn(`代理訪問失敗 - 簽名驗證失敗: ${path} (${verifyResult.reason})`);
        emitProxyAudit(c, {
          path,
          decision: "deny",
          reason: "invalid_signature",
          signatureRequired: signatureNeed.required,
          signatureProvided: true,
          mountId: mountResult.mount.id,
        });
        throw new AuthenticationError(`簽名驗證失敗: ${verifyResult.reason}`);
      }
      console.log(`[fsProxy] 簽名驗證成功: ${path}`);
    }

    // 建立 MountManager 並驗證驅動能力
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const driver = await mountManager.getDriver(mountResult.mount);
    if (!driver.hasCapability(CAPABILITIES.PROXY)) {
      throw new AppError("當前儲存驅動不支援代理訪問", { status: ApiStatus.NOT_IMPLEMENTED, code: "PROXY_NOT_SUPPORTED", expose: true });
    }

    // 獲取檔名用於下載
    const fileName = path.split("/").filter(Boolean).pop() || "file";

    // 使用 StorageStreaming 層統一處理內容訪問
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    // 獲取 Range 頭
    const rangeHeader = c.req.header("Range") || null;

    // 透過 StorageStreaming 建立響應
    let response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.PROXY,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo: PROXY_CONFIG.USER_TYPE,
      userType: PROXY_CONFIG.USER_TYPE,
      db,
    });

    // HLS 特殊處理：當啟用簽名訪問時，m3u8 內的分片/子播放列表/key 等資源如果不帶 sign，會導致後續請求 401。
    // 因此：在返回 m3u8 內容時，給所有可識別的 URI 追加 ?sign=...&ts=...
    // 僅在以下條件下重寫：
    // - 當前響應為 200
    // - 非 Range 請求（Range 下重寫會導致內容不完整）
    // - 非 download 模式（download 語義下無需保證播放器可播放）
    // - 當前路徑看起來是 .m3u8
    if (
      signatureNeed.required &&
      !download &&
      !rangeHeader &&
      response &&
      response.status === 200 &&
      typeof path === "string" &&
      path.toLowerCase().endsWith(".m3u8")
    ) {
      try {
        const originalText = await response.clone().text();
        const requestTs = c.req.query(PROXY_CONFIG.TIMESTAMP_PARAM) || Date.now();
        const expireTimestampStr = String(signature || "").split(":")[1];
        const expireTimestamp = parseInt(expireTimestampStr, 10);
        if (Number.isNaN(expireTimestamp)) {
          throw new Error("malformed_signature");
        }

        const rewriteResult = rewriteHlsM3u8ForSignature(originalText, {
          playlistFsPath: path,
          expireTimestamp,
          ts: requestTs,
          secret: encryptionSecret,
        });

        if (rewriteResult.changed) {
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          headers.delete("etag");
          headers.delete("last-modified");
          headers.set("cache-control", "no-store");
          if (!headers.get("content-type")) {
            headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
          }

          response = new Response(rewriteResult.text, { status: response.status, headers });
          console.log(`[fsProxy][hls] 已重寫 m3u8 URI: ${path} (+${rewriteResult.signedCount})`);
        }
      } catch (e) {
        console.warn("[fsProxy][hls] 重寫 m3u8 失敗，將返回原始內容：", e?.message || e);
      }
    }

    // 如果是下載模式，覆蓋 Content-Disposition 頭
    if (download) {
      const downloadDisposition = `attachment; filename="${encodeURIComponent(fileName)}"`;
      response.headers.set("Content-Disposition", downloadDisposition);
      c.header("Content-Disposition", downloadDisposition);
    }

    // 複製響應頭到 Hono context（用於 CORS 中介軟體）
    for (const [key, value] of response.headers.entries()) {
      if (!["access-control-allow-origin", "access-control-allow-credentials", "access-control-expose-headers"].includes(key.toLowerCase())) {
        c.header(key, value);
      }
    }

    // 僅在非200狀態碼時記錄詳細資訊
    if (response.status !== 200 && response.status !== 206) {
      console.log(`[fsProxy] 響應狀態: ${response.status} -> ${path}`);
    }

    emitProxyAudit(c, {
      path,
      decision: "allow",
      reason: signatureNeed.required ? "signature_valid" : "signature_not_required",
      signatureRequired: signatureNeed.required,
      signatureProvided: signatureNeed.required ? Boolean(c.req.query(PROXY_CONFIG.SIGN_PARAM)) : false,
      mountId: mountResult.mount.id,
    });

    return response;
  };

  return run().catch((error) => {
    console.error("檔案系統代理訪問錯誤:", error);

    if (!(error instanceof AppError)) {
      const signatureParam = typeof c.req?.query === "function" ? c.req.query(PROXY_CONFIG.SIGN_PARAM) : null;
      emitProxyAudit(c, {
        path: c.req?.path ?? null,
        decision: "deny",
        reason: "internal_error",
        signatureRequired: false,
        signatureProvided: Boolean(signatureParam),
      });
      throw new DriverError("代理訪問失敗", { details: { cause: error?.message } });
    }

    throw error;
  });
});

export { fsProxyRoutes };
