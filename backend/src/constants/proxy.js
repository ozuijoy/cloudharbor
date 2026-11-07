import { ValidationError } from "../http/errors.js";

/**
 * 代理功能相關常量配置
 * 統一管理代理功能的配置引數，避免硬編碼
 */

/**
 * 代理路由配置（CloudHarbor 本地 /api/p 代理）
 */
export const PROXY_CONFIG = {
  // 代理路由字首（本地簽名代理入口）
  ROUTE_PREFIX: "/api/p",

  // 代理使用者型別標識
  USER_TYPE: "proxy",

  // 預設WebDAV策略
  DEFAULT_WEBDAV_POLICY: "302_redirect",

  // 支援的WebDAV策略
  WEBDAV_POLICIES: {
    REDIRECT: "302_redirect", // 儲存直鏈重定向（僅對具備 DirectLink 能力的驅動生效，如 S3）
    USE_PROXY_URL: "use_proxy_url", // 基於 storage_config.url_proxy 的代理 URL 重定向
    NATIVE_PROXY: "native_proxy", // 本地伺服器代理
  },

  // 簽名相關配置
  SIGN_PARAM: "sign", // 簽名引數名
  TIMESTAMP_PARAM: "ts", // 時間戳引數名
};

/**
 * 對外反向代理/Proxy 入口字首（部署位置可以是 Worker、VPS、Vercel 等）
 * - FS 檢視：/proxy/fs/<path>
 * - 分享檢視：/proxy/share/<slug>
 */
export const WORKER_ENTRY = {
  FS_PREFIX: "/proxy/fs",
  SHARE_PREFIX: "/proxy/share",
};

/**
 * 代理安全配置
 */
export const PROXY_SECURITY = {
  // 最大路徑長度
  MAX_PATH_LENGTH: 2048,

  // 禁止的路徑模式
  FORBIDDEN_PATTERNS: [
    "..", // 路徑遍歷
    "\\", // 反斜槓
    "\0", // 空位元組
  ],

  // URL解碼錯誤訊息
  DECODE_ERROR_MESSAGE: "無效的路徑格式",
};

/**
 * 從反向代理/Cloudflare 的請求頭裡推斷“使用者訪問時的協議”
 *
 *
 * @param {Request|null} request
 * @returns {"http:"|"https:"|null}
 */
function resolveForwardedProtocol(request) {
  if (!request || !request.headers) return null;

  // 1) Nginx / NPM / Caddy 常見：X-Forwarded-Proto: https
  const xfp = request.headers.get("x-forwarded-proto");
  if (xfp) {
    const first = String(xfp).split(",")[0].trim().toLowerCase();
    if (first === "https") return "https:";
    if (first === "http") return "http:";
  }

  // 2) RFC 7239 Forwarded: proto=https;host=...
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const first = String(forwarded).split(",")[0];
    const protoMatch = first.match(/(?:^|;)\s*proto=([^;]+)/i);
    if (protoMatch && protoMatch[1]) {
      const proto = protoMatch[1].trim().replace(/^\"|\"$/g, "").toLowerCase();
      if (proto === "https") return "https:";
      if (proto === "http") return "http:";
    }
  }

  // 3) Cloudflare：CF-Visitor: {"scheme":"https"}
  const cfVisitor = request.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(String(cfVisitor));
      const scheme = String(parsed?.scheme || "").toLowerCase();
      if (scheme === "https") return "https:";
      if (scheme === "http") return "http:";
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * 基於 request.url 構建 base URL。
 * - host 仍使用 request.url 中的 host
 * - protocol 允許被 X-Forwarded-Proto / Forwarded / CF-Visitor 覆蓋為 https
 *
 * @param {Request} request
 * @returns {URL}
 */
function buildPublicBaseUrl(request) {
  const url = new URL(request.url);
  const forwardedProtocol = resolveForwardedProtocol(request);
  if (forwardedProtocol) {
    url.protocol = forwardedProtocol;
  }
  return url;
}

/**
 * 把相對路徑 URL（以 / 開頭）轉換為“對外可訪問”的絕對 URL。
 *
 * @param {Request} request
 * @param {string} maybeUrl
 * @returns {string}
 */
export function toAbsoluteUrlIfRelative(request, maybeUrl) {
  if (typeof maybeUrl !== "string" || maybeUrl.length === 0) {
    return maybeUrl;
  }
  if (!maybeUrl.startsWith("/")) {
    return maybeUrl;
  }

  try {
    const base = buildPublicBaseUrl(request);
    return new URL(maybeUrl, base).toString();
  } catch {
    return maybeUrl;
  }
}

/**
 * 構建本地 /api/p 代理URL（僅用於 CloudHarbor 內部）
 * @param {string} path - 檔案路徑（掛載檢視路徑）
 * @param {boolean} download - 是否為下載模式
 * @returns {string} 代理URL
 */
export function buildProxyPath(path, download = false) {
  const basePath = `${PROXY_CONFIG.ROUTE_PREFIX}${path}`;
  return download ? `${basePath}?download=true` : basePath;
}

/**
 * 構建完整的本地 /api/p 代理URL
 * @param {Request} request - 請求物件
 * @param {string} path - 檔案路徑
 * @param {boolean} download - 是否為下載模式
 * @returns {string} 完整的代理URL
 */
export function buildFullProxyUrl(request, path, download = false) {
  if (!request) {
    return buildProxyPath(path, download);
  }

  try {
    const url = buildPublicBaseUrl(request);
    const proxyPath = buildProxyPath(path, download);
    return `${url.protocol}//${url.host}${proxyPath}`;
  } catch (error) {
    console.warn("構建完整代理URL失敗:", error);
    return buildProxyPath(path, download);
  }
}

/**
 * 構建帶簽名的本地 /api/p 代理URL
 * @param {Request} request - 請求物件
 * @param {string} path - 檔案路徑
 * @param {Object} options - 選項
 * @returns {string} 帶簽名的代理URL
 */
export function buildSignedProxyUrl(request, path, options = {}) {
  const { download = false, signature, requestTimestamp, needsSignature = true } = options;

  // 如果不需要簽名，返回普通URL
  if (!needsSignature || !signature) {
    return buildFullProxyUrl(request, path, download);
  }

  // 構建基礎路徑（可能是相對路徑）
  const proxyPath = buildProxyPath(path, download);

  // 嘗試在 request 的上下文中構建絕對URL；失敗時回退到相對路徑並直接拼接查詢串
  try {
    const base = request ? buildPublicBaseUrl(request) : null;
    const url = base ? new URL(proxyPath, base) : new URL(proxyPath, "http://localhost");

    // 新增簽名引數
    url.searchParams.set(PROXY_CONFIG.SIGN_PARAM, signature);

    // 預覽時新增時間戳引數
    if (!download && requestTimestamp) {
      url.searchParams.set(PROXY_CONFIG.TIMESTAMP_PARAM, requestTimestamp);
    }

    return url.toString();
  } catch (error) {
    // 保底：構建相對URL並拼接查詢引數，避免丟擲異常影響上游流程
    const hasQuery = proxyPath.includes("?");
    let result = proxyPath + (hasQuery ? "&" : "?") + `${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
    if (!download && requestTimestamp) {
      result += `&${PROXY_CONFIG.TIMESTAMP_PARAM}=${encodeURIComponent(requestTimestamp)}`;
    }
    return result;
  }
}

/**
 * 基於 storage_config.url_proxy 構建 Worker / 反代入口 URL
 * - 不關心業務語義，僅負責 host 拼接與簽名引數追加
 * @param {string|null} baseOrigin - 代理 / Worker 根地址（例如 https://proxy.example.com）
 * @param {string} entryPath - 入口路徑（例如 /proxy/fs/xxx 或 /proxy/share/slug）
 * @param {{ signature?: string }} [options]
 * @returns {string} 完整可訪問 URL
 */
export function buildSignedWorkerUrl(baseOrigin, entryPath, options = {}) {
  const { signature } = options;

  // 未配置 baseOrigin 時，回退為相對路徑 + 可選簽名引數
  if (!baseOrigin) {
    const hasQuery = entryPath.includes("?");
    let result = entryPath;
    if (signature) {
      result += `${hasQuery ? "&" : "?"}${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
    }
    return result;
  }

  try {
    const base = baseOrigin.endsWith("/") ? baseOrigin : `${baseOrigin}/`;
    const relative = entryPath.startsWith("/") ? entryPath.slice(1) : entryPath;
    const url = new URL(relative, base);

    if (signature) {
      url.searchParams.set(PROXY_CONFIG.SIGN_PARAM, signature);
    }

    return url.toString();
  } catch (error) {
    // 構建失敗時使用簡單拼接作為兜底
    const cleanBase = baseOrigin.endsWith("/") ? baseOrigin.slice(0, -1) : baseOrigin;
    let result = `${cleanBase}${entryPath}`;
    if (signature) {
      const hasQuery = result.includes("?");
      result += `${hasQuery ? "&" : "?"}${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
    }
    return result;
  }
}

/**
 * 安全解碼URL路徑（僅用於本地 /api/p 代理入口）
 * @param {string} encodedPath - 編碼的路徑
 * @returns {string} 解碼後的路徑
 * @throws {Error} 路徑格式無效或包含危險字元
 */
export function safeDecodeProxyPath(encodedPath) {
  try {
    const decoded = decodeURIComponent(encodedPath);

    // 檢查危險字元
    for (const pattern of PROXY_SECURITY.FORBIDDEN_PATTERNS) {
      if (decoded.includes(pattern)) {
        throw new ValidationError("路徑包含禁止的字元");
      }
    }

    // 檢查路徑長度
    if (decoded.length > PROXY_SECURITY.MAX_PATH_LENGTH) {
      throw new ValidationError("路徑長度超出限制");
    }

    return decoded;
  } catch (error) {
    throw new ValidationError(PROXY_SECURITY.DECODE_ERROR_MESSAGE);
  }
}
