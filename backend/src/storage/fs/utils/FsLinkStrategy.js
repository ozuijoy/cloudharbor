import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

/**
 * FS 檢視下的統一檔案連結生成策略（掛載路徑）
 * - 根據驅動能力與掛載配置，在預簽名與代理之間做決策
 * - 作為 FileSystem.generateFileLink / features.read.getFileInfo 的唯一入口
 */
export async function generateFileLink(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  const db = fs.mountManager.db;
  const request = options.request || null;
  const forceDownload = options.forceDownload || false;
  const forceProxy = options.forceProxy || false;
  const channel = "web";

  // 三段式決策：
  // 1）強制代理掛載（web_proxy 等價 MustProxy）→ 一律走代理能力
  const mustProxy = !!mount?.web_proxy || forceProxy;

  if (mustProxy && typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(subPath, {
      path,
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      channel,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: null,
    };
  }

  // 2）非強制代理掛載：優先使用直鏈能力（custom_host / 預簽名等）
  if (!mustProxy && driver.hasCapability(CAPABILITIES.DIRECT_LINK)) {
    try {
      const result = await driver.generateDownloadUrl(subPath, {
        path,
        mount,
        subPath,
        db,
        userIdOrInfo,
        userType,
        request,
        expiresIn: options.expiresIn,
        forceDownload,
      });

      // 約定：驅動在 generateDownloadUrl 邊界統一輸出 canonical 欄位 result.url
      return {
        url: result?.url || null,
        type: result?.type || "native_direct",
        expiresIn: result?.expiresIn ?? options.expiresIn ?? null,
        proxyPolicy: null,
      };
    } catch (error) {
      // 直鏈能力失敗時，允許降級到 proxy（例如：GitHub 私有倉庫、某些上游臨時不可用）
      if (typeof driver.generateProxyUrl === "function") {
        const proxy = await driver.generateProxyUrl(subPath, {
          path,
          mount,
          subPath,
          request,
          download: forceDownload,
          db,
          channel,
        });

        return {
          url: proxy?.url || null,
          type: proxy?.type || "proxy",
          expiresIn: proxy?.expiresIn || null,
          proxyPolicy: null,
        };
      }
      throw error;
    }
  }

  // 3）無任何直鏈能力時：若驅動實現了 generateProxyUrl，則兜底走代理
  if (typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(subPath, {
      path,
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      channel,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: null,
    };
  }

  throw new DriverError(`儲存驅動 ${driver.getType()} 不支援生成可用檔案連結`, {
    status: ApiStatus.NOT_IMPLEMENTED,
    code: "DRIVER_ERROR.NOT_IMPLEMENTED",
    expose: true,
  });
}
