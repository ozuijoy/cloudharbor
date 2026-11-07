// 通用邊緣反向代理示例（Cloudflare Workers / Deno Deploy / Vercel Edge 等）
// 依賴標準 Fetch API 與 Web Crypto，不繫結具體平臺。
//
// 配置方式有兩種（二選一）：
// 1）直接修改下方常量（最適合在 Cloudflare Worker / Deno 線上編輯器裡複製即用）
// 2）在執行時透過 env.{ORIGIN,TOKEN,SIGN_SECRET,WORKER_BASE} 覆蓋這些常量
//
// 欄位說明：
// - ORIGIN：
//   CloudHarbor 後端地址，例如 https://cloudharbor.example.com 專案的後端地址

// - TOKEN：
//   反代呼叫 CloudHarbor /api/proxy/link 時使用的認證憑證，會被放在 Authorization 頭裡。
//   CloudHarbor 的 AuthService 會解析 Authorization 頭：
//     - 形如 "Bearer <adminToken>" 時按管理員令牌驗證（validateAdminToken）
//     - 形如 "ApiKey <apiKeyValue>" 時按 API 金鑰驗證
//   推薦做法：
//     1）在 CloudHarbor 後臺建立一個專用的 API 金鑰，並啟用它
//     2）將 TOKEN 設定為完整的認證頭串，例如：TOKEN = "ApiKey KS6PPQAKz8dRPhATdJ4wx3tA8rxsGKXx"
//   也可以使用管理員 Token：TOKEN = "Bearer <adminToken>"，但生產環境更推薦使用專用 API Key。

// - SIGN_SECRET：
//   FS 場景下 /proxy/fs 路由使用的 HMAC 簽名金鑰。
//   後端 .env 中 ENCRYPTION_SECRET 相同的值

// - WORKER_BASE：
//   本反代對外地址，例如 https://proxy.example.com，自己反代的域名地址，僅用於檢測上游重定向是否迴環到自身。
//   配錯最多會導致“迴環檢測”不生效，不會影響正常代理功能。

// ==== 全域性配置（可直接修改為你自己的值 / 在執行時透過 env 覆蓋） ====
let ORIGIN = "https://cloudharbor.example.com";
let TOKEN = "ApiKey xxx";
let SIGN_SECRET = "default-encryption-key";
let WORKER_BASE = "https://proxy.example.com";

// 從 env 覆蓋全域性配置（如 Cloudflare Worker 的 env、Deno.serve 傳入的物件等）
function initFromEnv(env) {
  if (!env) return;
  if (env.ORIGIN) ORIGIN = String(env.ORIGIN);
  if (env.TOKEN) TOKEN = String(env.TOKEN);
  if (env.SIGN_SECRET) SIGN_SECRET = String(env.SIGN_SECRET);
  if (env.WORKER_BASE) WORKER_BASE = String(env.WORKER_BASE);
}

const textEncoder = new TextEncoder();

function buildCorsHeaders(requestOrigin, allowHeaders = null) {
  const origin = requestOrigin || "*";
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Content-Type, X-Request-Id",
  };
  if (allowHeaders) {
    headers["Access-Control-Allow-Headers"] = allowHeaders;
  }
  return headers;
}

function withCors(response, requestOrigin) {
  const resp = new Response(response.body, response);
  const cors = buildCorsHeaders(requestOrigin);
  for (const [k, v] of Object.entries(cors)) {
    resp.headers.set(k, v);
  }
  resp.headers.append("Vary", "Origin");
  return resp;
}

function jsonWithCors(payload, { status = 200, requestOrigin = "*", extraHeaders = null } = {}) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    ...buildCorsHeaders(requestOrigin),
    ...(extraHeaders || {}),
  };
  return new Response(JSON.stringify(payload), { status, headers });
}

/** 將 HMAC-SHA256 結果編碼為標準 Base64 字串（與 Node.js crypto.digest("base64") 對齊） */
async function hmacSha256Base64(secret, data) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  // 標準 Base64，與 CloudHarbor ProxySignatureService 的 digest("base64") 完全一致
  return btoa(bin);
}

/**
 * 校驗 FS 場景下的簽名：
 * sign 形如 "<base64UrlHash>:<expire>"，其中 expire 為秒級時間戳，0 表示永不過期。
 */
async function verifyFsSign(path, sign, secret) {
  // 未提供 sign 時，反代層不做校驗，完全交由 CloudHarbor 按掛載/全域性策略決定是否需要簽名。
  // - 當掛載/全域性未啟用簽名時，LinkService 生成的 url_proxy 入口本身就不會帶 sign。
  // - 當掛載啟用簽名時，CloudHarbor 仍會在 /api/p 鏈路上強制驗證簽名，保證安全性。
  if (!sign) return "";
  const parts = String(sign).split(":");
  if (!parts.length) return "expire missing";
  const expireStr = parts[parts.length - 1];
  if (!expireStr) return "expire missing";

  const expire = parseInt(expireStr, 10);
  if (Number.isNaN(expire)) return "expire invalid";
  if (expire > 0 && Math.floor(Date.now() / 1000) > expire) {
    return "expire expired";
  }

  const base = await hmacSha256Base64(secret, `${path}:${expireStr}`);
  const expected = `${base}:${expireStr}`;
  if (expected !== sign) return "sign mismatch";
  return "";
}

/**
 * 組裝“發往上游”的請求
 */
function applyUpstreamHeaders(request, headerMap) {
  const headers = new Headers();
  // Range/條件請求
  const keepFromClient = ["range", "if-range", "if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "accept"];
  for (const name of keepFromClient) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }

  const skip = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "content-length"]);

  if (headerMap && typeof headerMap === "object") {
    for (const [k, values] of Object.entries(headerMap)) {
      if (!Array.isArray(values)) continue;
      const lower = String(k || "").toLowerCase();
      if (!lower) continue;
      if (skip.has(lower)) continue;
      if (lower.startsWith("cf-")) continue;
      for (const v of values) {
        headers.set(k, String(v));
      }
    }
  }

  // 保留客戶端的 Range
  const originalRange = request.headers.get("Range") || request.headers.get("range") || "";
  if (originalRange) {
    headers.set("Range", originalRange);
    headers.set("Accept-Encoding", "identity");
  }

  // 返回一個“同方法的新請求”
  return new Request(request.url, { method: request.method, headers });
}

/** 判斷重定向是否指向當前反代自身（用於避免無限迴圈） */
function isSelfRedirect(targetUrl, currentHost) {
  if (!targetUrl) return false;
  let targetHost = "";
  try {
    const u = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl));
    targetHost = u.host;
  } catch {
    return false;
  }

  // 1) 顯式配置的 WORKER_BASE
  if (WORKER_BASE) {
    try {
      const base = new URL(WORKER_BASE);
      if (targetHost === base.host) return true;
    } catch {
      // ignore
    }
  }

  // 2) 回落到當前請求 Host
  if (currentHost && targetHost === currentHost) {
    return true;
  }

  return false;
}

/** 處理 /proxy/fs 與 /proxy/share 的統一入口（平臺無關核心邏輯） */
export async function handleProxyRequest(request, env) {
  // 優先使用傳入 env 覆蓋全域性配置，方便在不同平臺注入
  initFromEnv(env);

  if (!ORIGIN || !TOKEN || !SIGN_SECRET) {
    const requestOrigin = request.headers.get("Origin") || "*";
    return jsonWithCors({ code: 500, message: "proxy env not configured" }, { status: 500, requestOrigin });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const requestOrigin = request.headers.get("Origin") || "*";

  // 統一處理 CORS 預檢請求，避免將 OPTIONS 透傳到上游
  if (request.method === "OPTIONS" && path.startsWith("/proxy/")) {
    const allowHeaders = request.headers.get("Access-Control-Request-Headers") || "Range, Content-Type";

    return new Response(null, {
      status: 204,
      headers: {
        ...buildCorsHeaders(requestOrigin, allowHeaders),
      },
    });
  }

  // 僅處理 /proxy 路徑，其餘直接 404
  if (!path.startsWith("/proxy/")) {
    return new Response("Not Found", { status: 404 });
  }

  // FS 檢視：/proxy/fs<fsPath>?sign=...
  if (path.startsWith("/proxy/fs")) {
    const fsPath = decodeURIComponent(path.slice("/proxy/fs".length) || "/");
    const sign = url.searchParams.get("sign") ?? "";

    // 簽名校驗
    const verifyMsg = await verifyFsSign(fsPath, sign, SIGN_SECRET);
    if (verifyMsg) {
      return jsonWithCors({ code: 401, message: verifyMsg }, { status: 401, requestOrigin });
    }

    // 呼叫 CloudHarbor /api/proxy/link 獲取上游 URL
    const controlUrl = new URL(ORIGIN);
    controlUrl.pathname = "/api/proxy/link";

    const linkResp = await fetch(controlUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        Authorization: TOKEN,
      },
      body: JSON.stringify({ type: "fs", path: fsPath }),
    });

    // 日誌
    let rawBody = null;
    let linkJson = null;
    try {
      rawBody = await linkResp.text();
      linkJson = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      linkJson = null;
    }

    const httpStatus = linkResp.status;
    const data = linkJson?.data ?? null;
    const ok = httpStatus === 200 && linkJson && linkJson.code === 200 && data?.url;

    if (!ok) {
      console.error(
          JSON.stringify({
            type: "proxy.debug",
            scope: "fs",
            reason: "link-resolve-failed",
            requestPath: fsPath,
            origin: ORIGIN,
            controlUrl: controlUrl.toString(),
            httpStatus: linkResp.status,
            responseCode: linkJson?.code ?? null,
            // 為防止日誌過大，截斷響應體
            rawBody: rawBody && rawBody.length > 2048 ? rawBody.slice(0, 2048) + "...truncated" : rawBody,
          })
      );

      const payload = linkJson && typeof linkJson === "object" ? linkJson : { code: httpStatus || 502, message: "proxy link resolve failed" };
      return jsonWithCors(payload, { status: httpStatus || 502, requestOrigin });
    }

    // 轉發到上游
    let upstreamReq = applyUpstreamHeaders(request, data.header);
    upstreamReq = new Request(data.url, upstreamReq);

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamReq, { redirect: "manual" });
    } catch (e) {
      console.error(
          JSON.stringify({
            type: "proxy.debug",
            scope: "fs",
            reason: "upstream-fetch-failed",
            requestPath: fsPath,
            upstreamUrl: data.url,
            error: e?.message || String(e),
          })
      );
      return jsonWithCors({ code: 502, message: "upstream fetch failed" }, { status: 502, requestOrigin });
    }
    const currentHost = url.host;

    // Range 觀測日誌
    const incomingRange = request.headers.get("Range") || request.headers.get("range") || "";

    // 跟隨重定向，避免自遞迴
    for (let i = 0; i < 5 && upstreamRes.status >= 300 && upstreamRes.status < 400; i++) {
      const location = upstreamRes.headers.get("Location");
      if (!location) break;
      let nextUrl;
      try {
        nextUrl = new URL(location, upstreamReq.url);
      } catch {
        break;
      }

      if (isSelfRedirect(nextUrl, currentHost)) {
        // 自身重定向：遞迴交給 handleProxyRequest 處理
        const nextReq = new Request(nextUrl.toString(), request);
        return handleProxyRequest(nextReq, env);
      }

      upstreamReq = new Request(nextUrl.toString(), upstreamReq);
      try {
        upstreamRes = await fetch(upstreamReq, { redirect: "manual" });
      } catch (e) {
        console.error(
            JSON.stringify({
              type: "proxy.debug",
              scope: "fs",
              reason: "upstream-redirect-fetch-failed",
              requestPath: fsPath,
              upstreamUrl: upstreamReq.url || nextUrl.toString(),
              error: e?.message || String(e),
            })
        );
        return jsonWithCors({ code: 502, message: "upstream fetch failed" }, { status: 502, requestOrigin });
      }
    }

    if (incomingRange) {
      const hasContentRange = !!(upstreamRes.headers.get("Content-Range") || upstreamRes.headers.get("content-range"));
      if (upstreamRes.status !== 206 && !hasContentRange) {
        console.warn(
            JSON.stringify({
              type: "proxy.range",
              scope: "fs",
              requestPath: fsPath,
              range: incomingRange,
              upstreamStatus: upstreamRes.status,
              contentRange: upstreamRes.headers.get("Content-Range") || upstreamRes.headers.get("content-range") || "",
              note: "client sent Range but upstream did not return 206/Content-Range (may not support seek)",
            })
        );
      }
    }

    const resp = new Response(upstreamRes.body, upstreamRes);
    resp.headers.delete("set-cookie");
    return withCors(resp, requestOrigin);
  }

  // 分享檢視：/proxy/share/:slug
  if (path.startsWith("/proxy/share/")) {
    const slug = decodeURIComponent(path.slice("/proxy/share/".length));
    if (!slug) {
      return jsonWithCors({ code: 400, message: "missing share slug" }, { status: 400, requestOrigin });
    }

    const controlUrl = new URL(ORIGIN);
    controlUrl.pathname = "/api/proxy/link";

    const linkResp = await fetch(controlUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        Authorization: TOKEN,
      },
      body: JSON.stringify({ type: "share", slug }),
    });

    // 分享檢視同樣增加詳細除錯日誌，方便排查 502
    let rawBody = null;
    let linkJson = null;
    try {
      rawBody = await linkResp.text();
      linkJson = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      linkJson = null;
    }

    const httpStatus = linkResp.status;
    const data = linkJson?.data ?? null;
    const ok = httpStatus === 200 && linkJson && linkJson.code === 200 && data?.url;
    if (!ok) {
      console.error(
          JSON.stringify({
            type: "proxy.debug",
            scope: "share",
            reason: "link-resolve-failed",
            slug,
            origin: ORIGIN,
            controlUrl: controlUrl.toString(),
            httpStatus: linkResp.status,
            responseCode: linkJson?.code ?? null,
            rawBody: rawBody && rawBody.length > 2048 ? rawBody.slice(0, 2048) + "...truncated" : rawBody,
          })
      );

      const payload = linkJson && typeof linkJson === "object" ? linkJson : { code: httpStatus || 502, message: "proxy link resolve failed" };
      return jsonWithCors(payload, { status: httpStatus || 502, requestOrigin });
    }

    let upstreamReq = applyUpstreamHeaders(request, data.header);
    upstreamReq = new Request(data.url, upstreamReq);

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamReq, { redirect: "manual" });
    } catch (e) {
      console.error(
          JSON.stringify({
            type: "proxy.debug",
            scope: "share",
            reason: "upstream-fetch-failed",
            slug,
            upstreamUrl: data.url,
            error: e?.message || String(e),
          })
      );
      return jsonWithCors({ code: 502, message: "upstream fetch failed" }, { status: 502, requestOrigin });
    }
    const currentHost = url.host;

    // Range 觀測日誌
    const incomingRange = request.headers.get("Range") || request.headers.get("range") || "";

    // 跟隨重定向（這裡必須用 upstreamReq.url 解析相對 Location）
    for (let i = 0; i < 5 && upstreamRes.status >= 300 && upstreamRes.status < 400; i++) {
      const location = upstreamRes.headers.get("Location");
      if (!location) break;
      let nextUrl;
      try {
        nextUrl = new URL(location, upstreamReq.url);
      } catch {
        break;
      }

      if (isSelfRedirect(nextUrl, currentHost)) {
        const nextReq = new Request(nextUrl.toString(), request);
        return handleProxyRequest(nextReq, env);
      }

      upstreamReq = new Request(nextUrl.toString(), upstreamReq);
      try {
        upstreamRes = await fetch(upstreamReq, { redirect: "manual" });
      } catch (e) {
        console.error(
            JSON.stringify({
              type: "proxy.debug",
              scope: "share",
              reason: "upstream-redirect-fetch-failed",
              slug,
              upstreamUrl: upstreamReq.url || nextUrl.toString(),
              error: e?.message || String(e),
            })
        );
        return jsonWithCors({ code: 502, message: "upstream fetch failed" }, { status: 502, requestOrigin });
      }
    }

    if (incomingRange) {
      const hasContentRange = !!(upstreamRes.headers.get("Content-Range") || upstreamRes.headers.get("content-range"));
      if (upstreamRes.status !== 206 && !hasContentRange) {
        console.warn(
            JSON.stringify({
              type: "proxy.range",
              scope: "share",
              slug,
              range: incomingRange,
              upstreamStatus: upstreamRes.status,
              contentRange: upstreamRes.headers.get("Content-Range") || upstreamRes.headers.get("content-range") || "",
              note: "client sent Range but upstream did not return 206/Content-Range (may not support seek)",
            })
        );
      }
    }

    const resp = new Response(upstreamRes.body, upstreamRes);
    resp.headers.delete("set-cookie");
    return withCors(resp, requestOrigin);
  }

  return new Response("Not Found", { status: 404 });
}

// ==== 平臺自適配入口 ====
// 說明：
// - Cloudflare Workers：直接使用預設匯出（workerd 風格）
// - Deno Deploy       ：如果檢測到 Deno.serve，則自動註冊 HTTP 服務
// - 其他 Fetch 相容執行時：匯入 handleProxyRequest 自行呼叫

// Cloudflare Workers / workerd 風格：預設匯出 fetch 處理器
export default {
  async fetch(request, env, ctx) {
    return handleProxyRequest(request, env);
  },
};

// Deno Deploy：若存在 Deno.serve，則自動啟動服務
if (typeof globalThis.Deno !== "undefined" && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve((req) =>
      handleProxyRequest(req, {
        ORIGIN: globalThis.Deno.env?.get?.("ORIGIN") ?? ORIGIN,
        TOKEN: globalThis.Deno.env?.get?.("TOKEN") ?? TOKEN,
        SIGN_SECRET: globalThis.Deno.env?.get?.("SIGN_SECRET") ?? SIGN_SECRET,
        WORKER_BASE: globalThis.Deno.env?.get?.("WORKER_BASE") ?? WORKER_BASE,
      })
  );
}

// 對於 Vercel Edge / 其他 Edge Runtime：
//   import { handleProxyRequest } from "./cloudharbor-proxy.js";
//   export const config = { runtime: "edge" };
//   export default (req) => handleProxyRequest(req, {
//     ORIGIN: process.env.ORIGIN,
//     TOKEN: process.env.TOKEN,
//     SIGN_SECRET: process.env.SIGN_SECRET,
//     WORKER_BASE: process.env.WORKER_BASE,
//   });
// - 這樣可以繼續複用本檔案的所有邏輯。
