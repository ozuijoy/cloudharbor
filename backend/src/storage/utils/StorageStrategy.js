/**
 * StorageStrategy: 統一生成檔案訪問連結（直鏈/代理），封裝驅動差異
 * 輸入：driver、storageConfig/mount、路徑等
 * 輸出：preview/download 連結及型別資訊
 */

// 提取驅動返回的 URL
function pickUrl(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    return result.url || result.presignedUrl || result.downloadUrl || result.previewUrl || "";
  }
  return "";
}

/**
 * 生成可用連結
 * @param {Object} params
 * @param {Object} params.driver              已初始化的儲存驅動
 * @param {Object|null} params.mount          掛載點資訊（可選）
 * @param {Object|null} params.storageConfig  儲存配置（可選，主要用於上下文欄位透傳）
 * @param {string} params.path                儲存路徑或 mount 下的路徑
 * @param {Request|null} params.request       HTTP 請求（用於代理 URL 拼裝）
 * @param {boolean} params.forceDownload      是否強制下載
 * @param {string|null} params.userType       使用者型別
 * @param {string|null} params.userId         使用者標識
 * @returns {Promise<Object>} { preview: {url,type}, download:{url,type}, proxyPolicy }
 */
export async function resolveStorageLinks({
  driver,
  mount = null,
  storageConfig = null,
  path,
  request = null,
  forceDownload = false,
  userType = null,
  userId = null,
} = {}) {
  if (!driver || !path) {
    return { preview: null, download: null, proxyPolicy: null };
  }

  const type = driver?.type || storageConfig?.storage_type || mount?.storage_type || "";
  const customHost = storageConfig?.custom_host || null;
  const webProxyEnabled = !!mount?.web_proxy;
  const proxyPolicy = mount?.webdav_policy || null;

  // 構建 custom_host 直鏈
  const buildCustomHostUrl = () => {
    if (!customHost) return "";
    const base = customHost.endsWith("/") ? customHost.slice(0, -1) : customHost;
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `${base}/${normalized}`;
  };

  // 優先考慮掛載的代理模式
  const preferProxy = webProxyEnabled && typeof driver.generateProxyUrl === "function";
  if (preferProxy) {
    const previewProxy = await driver.generateProxyUrl(path, { mount, request, download: false });
    const downloadProxy = await driver.generateProxyUrl(path, { mount, request, download: true });
    return {
      preview: { url: previewProxy?.url || null, type: "proxy" },
      download: { url: downloadProxy?.url || null, type: "proxy" },
      proxyPolicy: mount?.webdav_policy || null,
    };
  }

  // 根據儲存型別與 custom_host 決策
  const isWebDav = type?.toLowerCase?.() === "webdav";

  // 如果有 custom_host 且未強制代理：直鏈使用 custom_host
  if (customHost) {
    const directUrl = buildCustomHostUrl();
    return {
      preview: { url: directUrl, type: "custom_host" },
      download: { url: directUrl, type: "custom_host" },
      proxyPolicy,
    };
  }

  // 無 custom_host
  if (!isWebDav && typeof driver.generatePresignedUrl === "function") {
    // S3類：預簽名
    const previewRes = await driver.generatePresignedUrl(path, {
      subPath: path,
      forceDownload: false,
      expiresIn: null,
      userType,
      userId,
      mount,
    });
    const downloadRes = await driver.generatePresignedUrl(path, {
      subPath: path,
      forceDownload: true,
      expiresIn: null,
      userType,
      userId,
      mount,
    });
    return {
      preview: { url: pickUrl(previewRes), type: "presigned" },
      download: { url: pickUrl(downloadRes), type: "presigned" },
      proxyPolicy,
    };
  }

  // WebDAV 或無預簽名能力：走代理（如果 driver 支援代理）
  if (typeof driver.generateProxyUrl === "function") {
    const previewProxy = await driver.generateProxyUrl(path, { mount, request, download: false });
    const downloadProxy = await driver.generateProxyUrl(path, { mount, request, download: true });
    return {
      preview: { url: previewProxy?.url || null, type: "proxy" },
      download: { url: downloadProxy?.url || null, type: "proxy" },
      proxyPolicy,
    };
  }

  // 無法生成
  return { preview: null, download: null, proxyPolicy };
}
