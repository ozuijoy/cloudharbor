/**
 * 代理能力模組
 *
 * 定義儲存驅動的代理訪問能力檢測
 * 支援此能力的驅動可以生成代理 URL，提供無認證的公開訪問
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isProxyCapable() 檢測：
 *
 * - generateProxyUrl(subPath, ctx): Promise<Object>
 *   生成代理 URL，返回物件必須包含：
 *   - url: 可供瀏覽器/客戶端或應用層 302 使用的完整代理 URL（通常為 /api/p 字首）
 *   - type: 固定為 "proxy"（由上層對映為 StorageLink.kind = "proxy"）
 *   - channel: 可選，用於標記呼叫場景，例如 "web" | "webdav" | "share"
 *
 * - supportsProxyMode(): boolean
 *   檢查是否支援代理模式（只描述能力本身，不依賴掛載策略）
 */

/**
 * 檢查物件是否實現了 Proxy 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備代理能力
 */
export function isProxyCapable(obj) {
  return (
    obj &&
    typeof obj.generateProxyUrl === "function" &&
    typeof obj.supportsProxyMode === "function"
  );
}

/**
 * Proxy 能力的識別符號
 */
export const PROXY_CAPABILITY = "ProxyCapable";
