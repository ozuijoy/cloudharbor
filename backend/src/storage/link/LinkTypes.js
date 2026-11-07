// 通用 StorageLink 型別定義與輔助工具
// kind 僅區分 direct/proxy；custom_host / 直鏈（如預簽名）透過附加標記表達

/**
 * @typedef {Object} StorageLink
 * @property {string} url              // 直鏈或可代理的底層 URL
 * @property {"direct"|"proxy"} kind   // 路由決策依據
 * @property {Record<string,string[]>|undefined} headers // 可選上游 Header 對映（用於 /api/proxy/link → Worker）
 */

/**
 * 建立一個 direct 型別的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createDirectLink(url, options = {}) {
  return {
    url,
    kind: "direct",
    headers: options.headers || undefined,
  };
}

/**
 * 建立一個 proxy 型別的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createProxyLink(url, options = {}) {
  return {
    url,
    kind: "proxy",
    headers: options.headers || undefined,
  };
}
