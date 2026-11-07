/**
 * 環境檢測和配置工具
 * 用於根據部署環境（Cloudflare Worker vs Docker/Server）提供最優配置
 */

/**
 * 檢測當前是否執行在Cloudflare Worker環境
 * @returns {boolean} 是否為Worker環境
 */
export function isCloudflareWorkerEnvironment() {
  // Wrangler 開發環境檢測
  // 檢測 Wrangler 特徵：有 caches 和 Response，但仍有 process（wrangler dev --local）
  if (typeof caches !== "undefined" && typeof Response !== "undefined" && typeof window === "undefined" && typeof process !== "undefined") {
    // 進一步檢測是否為 Wrangler 環境
    const hasWorkerFeatures = typeof navigator !== "undefined" && typeof globalThis !== "undefined";
    if (hasWorkerFeatures) {
      return true;
    }
  }

  // 標準 Cloudflare Workers 檢測
  return typeof caches !== "undefined" && typeof Response !== "undefined" && typeof process === "undefined" && typeof window === "undefined";
}

/**
 * 獲取環境自適應的上傳配置
 * @returns {Object} 上傳配置物件
 */
export function getEnvironmentOptimizedUploadConfig() {
  const isWorker = isCloudflareWorkerEnvironment();

  return isWorker
    ? {
        partSize: 6 * 1024 * 1024, // 6MB - Worker環境記憶體限制
        queueSize: 1, // 1併發 - 避免CPU時間超限
        environment: "Cloudflare Worker",
        maxConcurrency: 1, // 最大併發數
        bufferSize: 6 * 1024 * 1024, // 緩衝區大小
      }
    : {
        partSize: 8 * 1024 * 1024, // 8MB - Docker環境更大分片
        queueSize: 4, // 4併發
        environment: "Docker/Server",
        maxConcurrency: 4, // 最大併發數
        bufferSize: 32 * 1024 * 1024, // 緩衝區大小
      };
}

/**
 * 獲取環境名稱
 * @returns {string} 環境名稱
 */
export function getEnvironmentName() {
  return isCloudflareWorkerEnvironment() ? "Cloudflare Worker" : "Docker/Server";
}

/**
 * 獲取推薦的分片大小
 * @returns {number} 分片大小（位元組）
 */
export function getRecommendedPartSize() {
  return isCloudflareWorkerEnvironment() ? 6 * 1024 * 1024 : 8 * 1024 * 1024;
}

/**
 * 獲取推薦的併發數
 * @returns {number} 併發數
 */
export function getRecommendedConcurrency() {
  return isCloudflareWorkerEnvironment() ? 1 : 4;
}

/**
 * 獲取加密金鑰（統一入口）
 * 優先讀取環境變數，回退到預設值
 * @param {import('hono').Context} c
 * @returns {string}
 */
export function getEncryptionSecret(c) {
  const secret = (c && c.env && c.env.ENCRYPTION_SECRET) || (typeof process !== "undefined" ? process.env?.ENCRYPTION_SECRET : null);
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET 未配置，請在環境變數中設定一個安全的隨機金鑰");
  }
  return secret;
}

/**
 * 把各種“真假值”統一轉成 boolean
 *
 * @param {any} value
 * @param {boolean} [defaultValue=false]
 */
export function toBool(value, defaultValue = false) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "yes" || lowered === "on") return true;
    if (lowered === "false" || lowered === "no" || lowered === "off") return false;
  }
  return defaultValue;
}

/**
 * 檢測當前是否執行在Node.js環境
 * @returns {boolean} 是否為Node.js環境
 */
export function isNodeJSEnvironment() {
  return typeof process !== "undefined" && process.versions && process.versions.node;
}
