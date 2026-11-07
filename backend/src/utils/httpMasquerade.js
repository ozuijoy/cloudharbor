/**
 * HTTP 偽裝工具
 *
 */

// ============================================================================
// 靜態 User-Agent 池
// ============================================================================

/** 桌面瀏覽器 UA（Chrome、Firefox、Safari、Edge） */
const DESKTOP_USER_AGENTS = [
  // Chrome - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome - Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Firefox - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Firefox - Linux
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Safari - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  // Edge - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // Edge - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
];

/** 移動瀏覽器 UA */
const MOBILE_USER_AGENTS = [
  // Chrome - Android
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
  // Safari - iOS
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];

/**
 * 獲取隨機 User-Agent
 * @param {string} deviceCategory - 'desktop' 或 'mobile'，預設 'desktop'
 */
export function getRandomUserAgent(deviceCategory = "desktop") {
  const pool = deviceCategory === "mobile" ? MOBILE_USER_AGENTS : DESKTOP_USER_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================================
// 隨機 IP 生成
// ============================================================================

/** IP 地址段（APNIC 亞太區域） */
const IP_RANGES = [
  { min: 1884815360, max: 1884890111 }, // 112.74.128.0 - 112.75.145.255
  { min: 1883242496, max: 1883308031 }, // 112.32.0.0 - 112.32.255.255
  { min: 1746927616, max: 1746993151 }, // 104.16.0.0 - 104.16.255.255
];

function long2ip(ip) {
  return `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`;
}

/** 生成隨機 IP 地址 */
export function randomIP() {
  const range = IP_RANGES[Math.floor(Math.random() * IP_RANGES.length)];
  const ip = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  return long2ip(ip);
}

// ============================================================================
// 瀏覽器型別檢測與 Client Hints
// ============================================================================

/**
 * 從 UA 檢測瀏覽器型別
 * @param {string} ua - User-Agent 字串
 * @returns {'chrome'|'edge'|'firefox'|'safari'|'unknown'}
 */
function detectBrowserType(ua) {
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "chrome";
  if (ua.includes("Firefox/")) return "firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari";
  return "unknown";
}

/**
 * 從 UA 提取 Chromium 版本號
 * @param {string} ua - User-Agent 字串
 * @returns {string} 版本號
 */
function extractChromiumVersion(ua) {
  const match = ua.match(/Chrome\/(\d+)\./);
  return match ? match[1] : "132";
}

/**
 * 從 UA 檢測作業系統平臺
 * @param {string} ua - User-Agent 字串
 * @returns {string} 平臺名稱
 */
function detectPlatform(ua) {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Linux") && !ua.includes("Android")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "Windows";
}

/**
 * 根據 UA 生成動態 Client Hints
 * 僅 Chromium 系瀏覽器 (Chrome/Edge) 傳送 Client Hints
 * Firefox/Safari 不支援 Client Hints
 * @param {string} ua - User-Agent 字串
 * @returns {Object} Client Hints 頭部物件
 */
function getClientHints(ua) {
  const browserType = detectBrowserType(ua);

  // Firefox/Safari 不傳送 Client Hints
  if (browserType !== "chrome" && browserType !== "edge") {
    return {};
  }

  const version = extractChromiumVersion(ua);
  const platform = detectPlatform(ua);
  const isMobile = ua.includes("Mobile");
  const brandName = browserType === "edge" ? "Microsoft Edge" : "Google Chrome";

  return {
    "Sec-CH-UA": `"Chromium";v="${version}", "Not_A Brand";v="24", "${brandName}";v="${version}"`,
    "Sec-CH-UA-Mobile": isMobile ? "?1" : "?0",
    "Sec-CH-UA-Platform": `"${platform}"`,
  };
}

// ============================================================================
// 瀏覽器請求頭
// ============================================================================

/** 基礎瀏覽器請求頭 */
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8,en-US;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  DNT: "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

// ============================================================================
// 偽裝客戶端類
// ============================================================================

/**
 * HTTP 偽裝客戶端
 *
 *
 * @example
 * const client = new MasqueradeClient();
 * const response = await client.fetch('https://mirrors.tuna.tsinghua.edu.cn/');
 */
export class MasqueradeClient {
  /**
   * @param {Object} options - 配置選項
   * @param {string} options.deviceCategory - 'desktop' 或 'mobile'，預設 'desktop'
   * @param {boolean} options.rotateIP - 每次請求是否更換 IP，預設 true
   * @param {boolean} options.rotateUA - 每次請求是否更換 UA，預設 false
   */
  constructor(options = {}) {
    this.options = {
      deviceCategory: "desktop",
      rotateIP: true,
      rotateUA: false,
      ...options,
    };

    if (!this.options.rotateUA) {
      this._cachedUA = getRandomUserAgent(this.options.deviceCategory);
    }
  }

  getUserAgent() {
    if (this.options.rotateUA) {
      return getRandomUserAgent(this.options.deviceCategory);
    }
    return this._cachedUA;
  }

  /**
   * 構建偽裝請求頭
   * @param {Object} extra - 額外的請求頭
   * @param {string} targetUrl - 目標 URL，用於生成 Referer
   */
  buildHeaders(extra = {}, targetUrl = null) {
    const fakeIP = this.options.rotateIP ? randomIP() : this._cachedIP || (this._cachedIP = randomIP());
    const userAgent = this.getUserAgent();
    const clientHints = getClientHints(userAgent);

    const headers = {
      "User-Agent": userAgent,
      "X-Real-IP": fakeIP,
      "X-Forwarded-For": fakeIP,
      ...BROWSER_HEADERS,
      ...clientHints,
      ...extra,
    };

    // 新增 Referer 頭
    if (targetUrl) {
      try {
        headers["Referer"] = new URL(targetUrl).origin + "/";
      } catch {
        // URL 解析失敗時忽略 Referer
      }
    }

    return headers;
  }

  /** 發起偽裝請求 */
  async fetch(url, options = {}) {
    const headers = this.buildHeaders(options.headers, url);
    return fetch(url, { ...options, headers });
  }

  async head(url, options = {}) {
    return this.fetch(url, { ...options, method: "HEAD" });
  }

  async get(url, options = {}) {
    return this.fetch(url, { ...options, method: "GET" });
  }
}

// ============================================================================
// 便捷函式
// ============================================================================

/**
 * 構建偽裝請求頭（便捷函式）
 * @param {Object} extra - 額外的請求頭
 * @param {string} deviceCategory - 'desktop' 或 'mobile'，預設 'desktop'
 * @param {string} targetUrl - 目標 URL，用於生成 Referer
 */
export function buildMasqueradeHeaders(extra = {}, deviceCategory = "desktop", targetUrl = null) {
  const fakeIP = randomIP();
  const userAgent = getRandomUserAgent(deviceCategory);
  const clientHints = getClientHints(userAgent);

  const headers = {
    "User-Agent": userAgent,
    "X-Real-IP": fakeIP,
    "X-Forwarded-For": fakeIP,
    ...BROWSER_HEADERS,
    ...clientHints,
    ...extra,
  };

  // 新增 Referer 頭
  if (targetUrl) {
    try {
      headers["Referer"] = new URL(targetUrl).origin + "/";
    } catch {
      // URL 解析失敗時忽略 Referer
    }
  }

  return headers;
}

/** 發起偽裝請求 */
export async function masqueradeFetch(url, options = {}) {
  const headers = buildMasqueradeHeaders(options.headers, "desktop", url);
  return fetch(url, { ...options, headers });
}

export { DESKTOP_USER_AGENTS, MOBILE_USER_AGENTS };
