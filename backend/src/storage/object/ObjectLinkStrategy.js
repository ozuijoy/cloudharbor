/**
 * ObjectLinkStrategy: 統一生成“儲存檢視”下的直鏈（preview/download），封裝驅動差異
 * 場景：ObjectStore / 分享模組，以 storage_config_id + storage_path 為入口。
 *
 * 設計要點：
 * - 僅負責“直鏈”能力（storage_config.custom_host 或驅動 DirectLink 能力），不參與應用層代理決策
 *   - 分享層的代理由 share 內容路由 (/api/s/:slug) 或 url_proxy 自行處理
 * - 不再按 storage_type 硬編碼 WebDAV 等型別，統一透過驅動能力 + storageConfig 決策
 */

import { CAPABILITIES } from "../interfaces/capabilities/index.js";

// 提取驅動返回的 URL（統一基於 canonical 欄位 url）
function pickUrl(result) {
  if (!result) return "";
  if (typeof result === "object") {
    return result.url || "";
  }
  return "";
}

function hasDirectLinkCapability(driver) {
  try {
    return typeof driver?.hasCapability === "function" && driver.hasCapability(CAPABILITIES.DIRECT_LINK);
  } catch {
    return false;
  }
}

/**
 * 生成“儲存檢視”下的直鏈
 * @param {Object} params
 * @param {Object} params.driver              已初始化的儲存驅動
 * @param {Object|null} params.mount          掛載點資訊（可選，目前儲存檢視通常為 null）
 * @param {Object|null} params.storageConfig  儲存配置（用於 custom_host 等）
 * @param {string} params.path                儲存路徑（storage_path / key）
 * @param {Request|null} params.request       HTTP 請求（預留，不在此層使用）
 * @param {boolean} params.forceDownload      是否強制下載（預留，當前固定 false/true 傳給驅動）
 * @param {string|null} params.userType       使用者型別（可選）
 * @param {string|null} params.userId         使用者標識（可選）
 * @returns {Promise<Object>} { preview: {url,type} | null, download:{url,type} | null, proxyPolicy }
 */
export async function resolveStorageLinks({
  driver,
  mount = null,
  storageConfig = null,
  path,
  request = null, // eslint-disable-line no-unused-vars
  forceDownload = false, // eslint-disable-line no-unused-vars
  userType = null,
  userId = null,
} = {}) {
  if (!driver || !path) {
    return { preview: null, download: null, proxyPolicy: null };
  }

  const customHost = storageConfig?.custom_host || null;
  const proxyPolicy = mount?.webdav_policy || null;

  // 構建 custom_host 直鏈
  const buildCustomHostUrl = () => {
    if (!customHost) return "";
    const base = customHost.endsWith("/") ? customHost.slice(0, -1) : customHost;
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `${base}/${normalized}`;
  };

  // 1) custom_host 優先：所有儲存型別統一按 custom_host 直出
  if (customHost) {
    const directUrl = buildCustomHostUrl();
    return {
      preview: { url: directUrl, type: "custom_host" },
      download: { url: directUrl, type: "custom_host" },
      proxyPolicy,
    };
  }

  // 2) 無 custom_host：若驅動具備直鏈能力，則使用直鏈（通常為預簽名URL）
  if (hasDirectLinkCapability(driver)) {
    try {
      const previewRes = await driver.generateDownloadUrl(path, {
        path,
        subPath: path,
        forceDownload: false,
        expiresIn: null,
        userType,
        userId,
        mount,
      });
      const downloadRes = await driver.generateDownloadUrl(path, {
        path,
        subPath: path,
        forceDownload: true,
        expiresIn: null,
        userType,
        userId,
        mount,
      });

      return {
        preview: { url: pickUrl(previewRes), type: previewRes?.type || "native_direct" },
        download: { url: pickUrl(downloadRes), type: downloadRes?.type || "native_direct" },
        proxyPolicy,
      };
    } catch {
      // storage-first 場景下不強制提供代理連結：失敗時返回 null，由上層（分享路由 / Proxy）決定如何訪問
      return { preview: null, download: null, proxyPolicy };
    }
  }

  // 3) 無 custom_host 且不具備預簽名能力：儲存檢視下不提供直鏈
  // 分享層可透過自身的 /api/s/:slug 代理鏈路訪問
  return { preview: null, download: null, proxyPolicy };
}
