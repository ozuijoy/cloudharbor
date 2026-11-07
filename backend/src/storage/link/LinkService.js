// LinkService: 統一封裝分享檢視與 FS 檢視下的儲存訪問連結生成
// - 對外只暴露 StorageLink（見 LinkTypes）
// - 直鏈/代理能力由底層驅動與現有策略提供，這裡只做歸一與對映

import { StorageFactory } from "../factory/StorageFactory.js";
import { ObjectStore } from "../object/ObjectStore.js";
import { resolveStorageLinks } from "../object/ObjectLinkStrategy.js";
import { MountManager } from "../managers/MountManager.js";
import { FileSystem } from "../fs/FileSystem.js";
import { createDirectLink, createProxyLink } from "./LinkTypes.js";
import { findMountPointByPathForProxy } from "../fs/utils/MountResolver.js";
import { ProxySignatureService } from "../../services/ProxySignatureService.js";
import { WORKER_ENTRY, buildSignedProxyUrl, buildSignedWorkerUrl } from "../../constants/proxy.js";
import { UserType } from "../../constants/index.js";

/**
 * 將檔名轉為 URL path segment 安全的形式（用於 /api/s/:slug/:filename）。
 * - 不能包含 / 或 \\（否則會被當作路徑分隔）
 * - 空值時回退為 "file"
 * @param {string} filename
 * @returns {string}
 */
function toUrlSafeFilename(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return "file";
  return raw.replace(/[\\/]+/g, "_");
}

/**
 * 構造分享內容的本地代理入口（帶 filename 以相容第三方預覽器按 URL 字尾識別型別）
 * - 例如：/api/s/AdhhLX/Samba%20Dancing.fbx
 * - 下載語義：追加 ?down=true
 * @param {string} slug
 * @param {string} filename
 * @param {{ download?: boolean }} [options]
 * @returns {string}
 */
function buildShareProxyPath(slug, filename, options = {}) {
  const safeName = toUrlSafeFilename(filename);
  const base = `/api/s/${encodeURIComponent(String(slug || ""))}/${encodeURIComponent(safeName)}`;
  return options.download ? `${base}?down=true` : base;
}

/**
 * 規範化驅動上游返回的 headers，統一為 Record<string,string[]> 結構
 * @param {any} rawHeaders
 * @returns {Record<string,string[]>|undefined}
 */
function normalizeUpstreamHeaders(rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== "object") {
    return undefined;
  }
  const result = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      result[key] = value.map((v) => String(v));
    } else if (value != null) {
      result[key] = [String(value)];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}


export class LinkService {
  /**
   * @param {D1Database} db
   * @param {string} encryptionSecret
   * @param {import('../..//utils/repositories.js').RepositoryFactory} repositoryFactory
   */
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  // ===== 分享檢視（slug → storage_config + storage_path） =====

  /**
   * 分享檢視：生成“外部訪問入口”連結（供瀏覽器/前端使用）
   * - 根據 use_proxy / 儲存直鏈能力 / url_proxy 等配置，生成最終可對外暴露的 URL
   * @param {Object} file
   * @param {{ type?: string, id?: string } | null} userInfo
   * @param {Object} [options]
   * @returns {Promise<import("./LinkTypes.js").StorageLink>}
   */
  async getShareExternalLink(file, userInfo = null, options = {}) {
    return this.getLinkForShare(file, userInfo, { ...options, mode: "client" });
  }

  /**
   * 分享檢視：生成“上游訪問目標”連結（供反向代理/Proxy 呼叫 CloudHarbor 時使用）
   * - 統一返回儲存直鏈或 CloudHarbor 自身的 /api/s/:slug 下載地址
   * @param {Object} file
   * @param {{ type?: string, id?: string } | null} userInfo
   * @param {Object} [options]
   * @returns {Promise<import("./LinkTypes.js").StorageLink>}
   */
  async getShareUpstreamLink(file, userInfo = null, options = {}) {
    return this.getLinkForShare(file, userInfo, { ...options, mode: "proxy" });
  }

  // 內部方法：根據分享檔案記錄生成 StorageLink，mode 僅用於區分“外部入口”和“上游目標”
  /**
   * @param {Object} file
   * @param {{ type?: string, id?: string } | null} userInfo
   * @param {{ mode?: "client" | "proxy", request?: Request }} [options]
   * @returns {Promise<import('./LinkTypes.js').StorageLink>}
   */
  async getLinkForShare(file, userInfo = null, options = {}) {
    const mode = options.mode === "proxy" ? "proxy" : "client";
    const request = options.request || null;
    const forceDownload = !!options.forceDownload;

    // 本地代理開關（share 檢視使用 use_proxy 與 FS 的 web_proxy 語義一致）
    const useProxyFlag = file?.use_proxy ?? 0;
    const slug = file?.slug || null;

    // 分享記錄缺少儲存資訊時，只能走應用層代理鏈路
    if (!file || !file.storage_config_id || !file.storage_path || !file.storage_type || !slug) {
      if (mode === "proxy") {
        // 兜底：直接返回 /api/s 下載路徑，交由上層處理
        const shareDownloadPath = `/api/s/${slug || ""}?down=true`;
        let finalUrl = shareDownloadPath;
        if (request) {
          try {
            const base = new URL(request.url);
            const origin = `${base.protocol}//${base.host}`;
            finalUrl = new URL(shareDownloadPath, origin).toString();
          } catch (e) {
            console.warn("構建分享下載絕對 URL 失敗，將返回相對路徑：", e?.message || e);
          }
        }
        return createProxyLink(finalUrl);
      }
      // client 模式下沒有儲存資訊和 slug 時，不提供任何 URL
      return createProxyLink("");
    }

    const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
    const storageConfig = await objectStore._getStorageConfig(file.storage_config_id);
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    let previewDirectUrl = "";
    let downloadDirectUrl = "";

    try {
      const links = await resolveStorageLinks({
        driver,
        storageConfig,
        path: file.storage_path,
        request: null,
        forceDownload: true,
        userType: userInfo?.type || null,
        userId: userInfo?.id || null,
      });

      const preview = links?.preview || null;
      const download = links?.download || null;

      if (preview && (preview.type === "custom_host" || preview.type === "native_direct") && preview.url) {
        previewDirectUrl = preview.url;
      }
      if (download && (download.type === "custom_host" || download.type === "native_direct") && download.url) {
        downloadDirectUrl = download.url;
      }
    } catch (e) {
      console.warn("解析分享儲存直鏈失敗，將退回代理鏈路：", e?.message || e);
    }

    const urlProxy = storageConfig?.url_proxy || null;

    // mode=client：生成對外入口 URL
    if (mode === "client") {
      // 1) use_proxy = 1：本地 share 內容路由，忽略 url_proxy 與直鏈能力
      if (useProxyFlag) {
        const sharePath = buildShareProxyPath(slug, file?.filename || "file", { download: !!forceDownload });
        console.log(`[LinkService][share][local-proxy] 檔案(${file.id || slug}) 使用本地 /api/s 內容路由: ${sharePath}`);
        return createProxyLink(sharePath);
      }

      // 2) use_proxy = 0 且配置了 url_proxy：使用 Worker / 反代入口
      if (urlProxy) {
        try {
          const entryPath = `${WORKER_ENTRY.SHARE_PREFIX}/${encodeURIComponent(slug)}${forceDownload ? "?down=true" : ""}`;
          const workerUrl = buildSignedWorkerUrl(urlProxy, entryPath, {});
          console.log(
            `[LinkService][share][url_proxy] 檔案(${file.id || slug}) 使用 url_proxy=${urlProxy} 生成入口: ${workerUrl}`,
          );
          return createProxyLink(workerUrl);
        } catch (e) {
          console.warn("構建分享 Worker 入口連結失敗，將退回為本地 share 內容路由：", e?.message || e);
          const fallbackPath = buildShareProxyPath(slug, file?.filename || "file", { download: !!forceDownload });
          return createProxyLink(fallbackPath);
        }
      }

      // 3) 無 url_proxy：有直鏈則使用直鏈，否則不提供 URL
      if (previewDirectUrl || (forceDownload && downloadDirectUrl)) {
        const directUrl = forceDownload ? (downloadDirectUrl || previewDirectUrl) : previewDirectUrl;
        if (directUrl) {
          console.log(
            `[LinkService][share][direct] 檔案(${file.id || slug}) 使用儲存直鏈作為${forceDownload ? "下載" : "預覽"}入口: ${directUrl}`,
          );
          return createDirectLink(directUrl);
        }
      }

      // 沒有直鏈能力且未配置 url_proxy 時，不再兜底本地 /api/s
      // 這會強制要求：要麼開啟 use_proxy，要麼配置 url_proxy，否則分享檢視不暴露任何外部入口
      return createProxyLink("");
    }

    // mode=proxy：為 /api/proxy/link(type=share) 等生成“上游訪問目標”

    // 1) use_proxy = 1：統一走本地 share 內容路由（下載語義）
    if (useProxyFlag) {
      const shareDownloadPath = buildShareProxyPath(slug, file?.filename || "file", { download: true });
      let finalUrl = shareDownloadPath;
      if (request) {
        try {
          const base = new URL(request.url);
          const origin = `${base.protocol}//${base.host}`;
          finalUrl = new URL(shareDownloadPath, origin).toString();
        } catch (e) {
          console.warn("構建分享下載絕對 URL 失敗，將返回相對路徑：", e?.message || e);
        }
      }
      console.log(
        `[LinkService][share][local-proxy] 檔案(${file.id || slug}) 上游使用本地 /api/s 下載鏈路: ${finalUrl}`,
      );
      return createProxyLink(finalUrl);
    }

    // 2) use_proxy = 0 且驅動具備上游 HTTP 能力時，優先交給驅動返回 {url, headers}，由反代直連儲存
    try {
      if (typeof driver.generateUpstreamRequest === "function") {
        const upstream = await driver.generateUpstreamRequest(file.storage_path, {
          subPath: file.storage_path,
          request,
          userType: userInfo?.type || null,
          userId: userInfo?.id || null,
        });
        if (upstream && upstream.url) {
          const headers = normalizeUpstreamHeaders(upstream.headers);
          console.log(
            `[LinkService][share][upstream-http] 檔案(${file.id || slug}) 上游使用驅動 UPSTREAM_HTTP 能力: ${upstream.url}`,
          );
          return createProxyLink(upstream.url, { headers });
        }
      }
    } catch (e) {
      console.warn(
        "[LinkService][share][upstream-http] 構建上游請求失敗，將回退直鏈/本地代理鏈路：",
        e?.message || e,
      );
    }

    // 3) use_proxy = 0：有直鏈能力時直接返回儲存直鏈，否則退回本地 /api/s/:slug?down=true
    if (downloadDirectUrl) {
      console.log(
        `[LinkService][share][direct] 檔案(${file.id || slug}) 上游使用儲存直鏈下載: ${downloadDirectUrl}`,
      );
      return createDirectLink(downloadDirectUrl);
    }

    const shareDownloadPath = buildShareProxyPath(slug, file?.filename || "file", { download: true });
    let finalUrl = shareDownloadPath;
    if (request) {
      try {
        const base = new URL(request.url);
        const origin = `${base.protocol}//${base.host}`;
        finalUrl = new URL(shareDownloadPath, origin).toString();
      } catch (e) {
        console.warn("構建分享下載絕對 URL 失敗，將返回相對路徑：", e?.message || e);
      }
    }
    console.log(
      `[LinkService][share][fallback] 檔案(${file.id || slug}) 無直鏈能力，上游退回本地 /api/s 下載鏈路: ${finalUrl}`,
    );
    return createProxyLink(finalUrl);
  }

  // ===== FS 檢視（掛載路徑） =====

  /**
   * FS 檢視：生成“外部訪問入口”連結（供瀏覽器/前端使用）
   * - 根據 web_proxy/url_proxy/直鏈能力，生成最終可對外暴露的 URL
   * @param {string} path
   * @param {any} userIdOrInfo
   * @param {string} userType
   * @param {Object} [options]
   * @returns {Promise<import("./LinkTypes.js").StorageLink>}
   */
  async getFsExternalLink(path, userIdOrInfo, userType, options = {}) {
    return this.getLinkForFs(path, userIdOrInfo, userType, { ...options, mode: "client" });
  }

  /**
   * FS 檢視：生成“上游訪問目標”連結（供反向代理/Proxy 呼叫 CloudHarbor 時使用）
   * - 統一返回儲存直鏈或 CloudHarbor 自身的 /api/p 代理地址
   * @param {string} path
   * @param {any} userIdOrInfo
   * @param {string} userType
   * @param {Object} [options]
   * @returns {Promise<import("./LinkTypes.js").StorageLink>}
   */
  async getFsUpstreamLink(path, userIdOrInfo, userType, options = {}) {
    return this.getLinkForFs(path, userIdOrInfo, userType, { ...options, mode: "proxy" });
  }

  // 內部方法：為 FS 路徑生成 StorageLink，mode 僅用於區分“外部入口”和“上游目標”
  /**
   * @param {string} path
   * @param {any} userIdOrInfo
   * @param {string} userType
   * @param {{ mode?: "client" | "proxy", request?: Request }} [options]
   * @returns {Promise<import('./LinkTypes.js').StorageLink>}
   */
  async getLinkForFs(path, userIdOrInfo, userType, options = {}) {
    // mode 決定輸出語義（僅在 LinkService 內部使用）：
    // - client: 返回給前端/瀏覽器使用的最終 URL（優先 url_proxy / 本地代理 / 直鏈）
    // - proxy:  返回給反向代理/Proxy 使用的上游 URL（S3 直鏈或本地 /api/p 簽名代理）
    const mode = options.mode === "proxy" ? "proxy" : "client";

    // 解析掛載與儲存配置，用於 web_proxy/url_proxy 決策
    let mountResult = null;
    let mount = null;
    let subPath = null;
    let storageConfig = null;
    let urlProxy = null;
    try {
      mountResult = await findMountPointByPathForProxy(this.db, path, this.repositoryFactory);
      if (!mountResult.error) {
        mount = mountResult.mount;
        subPath = mountResult.subPath || null;
        const storageConfigRepo = this.repositoryFactory?.getStorageConfigRepository?.();
        if (storageConfigRepo && mount.storage_config_id) {
          storageConfig = await storageConfigRepo.findById(mount.storage_config_id);
          urlProxy = storageConfig?.url_proxy || null;
        }
      }
    } catch (e) {
      console.warn("解析掛載或儲存配置失敗，將退回 FS 預設連結策略：", e?.message || e);
    }

    // 僅在掛載未開啟 web_proxy 時才允許 url_proxy 生效：
    // - web_proxy = 1 → 強制由 CloudHarbor 本地代理處理，不下放到外部反向代理
    // - allowUrlProxyOverride = true（例如 WebDAV use_proxy_url 場景）時忽略 web_proxy 限制
    const allowUrlProxyOverride = options.allowUrlProxyOverride === true;
    const hasUrlProxy = !!urlProxy && (!mount?.web_proxy || allowUrlProxyOverride);

    // mode=proxy 且驅動具備上游 HTTP 能力（例如 WebDAV）：優先交給驅動返回 {url, headers}，由反代直連儲存
    if (mode === "proxy" && mount && mount.storage_config_id) {
      try {
        const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
        const upstreamStorageConfig = await objectStore._getStorageConfig(mount.storage_config_id);
        const driver = await StorageFactory.createDriver(
          upstreamStorageConfig.storage_type,
          upstreamStorageConfig,
          this.encryptionSecret,
        );

        if (typeof driver.generateUpstreamRequest === "function") {
          const upstream = await driver.generateUpstreamRequest(path, {
            subPath,
            request: options.request || null,
            userType,
            userId: userType === "ADMIN" ? userIdOrInfo : userIdOrInfo?.id || null,
            mount,
          });
          if (upstream && upstream.url) {
            const headers = normalizeUpstreamHeaders(upstream.headers);
            console.log(
              `[LinkService][fs][upstream-http] 路徑(${path}) 上游使用驅動 UPSTREAM_HTTP 能力: ${upstream.url}`,
            );
            return createProxyLink(upstream.url, { headers });
          }
        }
      } catch (e) {
        console.warn(
          "[LinkService][fs][upstream-http] 構建上游請求失敗，將回退 FS 預設連結策略：",
          e?.message || e,
        );
      }
    }

    const mountManager = new MountManager(this.db, this.encryptionSecret, this.repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    // 統一委託 FileSystem.generateFileLink（FsLinkStrategy）：
    // - 未配置 url_proxy 時：按 web_proxy + DirectLink 能力決策
    // - 配置了 url_proxy 時：強制走代理模式（forceProxy=true），再由 url_proxy 覆蓋域名，實現“CloudHarbor 負責簽名，反代通吃流量”
    const linkResult = await fileSystem.generateFileLink(path, userIdOrInfo, userType, {
      ...options,
      userType,
      userId: userType === UserType.ADMIN ? userIdOrInfo : userIdOrInfo?.id,
      // client 模式下：配置了 url_proxy 時強制走代理路徑（FsLinkStrategy 內部只會走 generateProxyUrl）
      // proxy 模式下：不受 url_proxy 影響，僅根據掛載策略與驅動能力決定是否代理
      forceProxy: options.forceProxy || (mode === "client" && hasUrlProxy),
    });

    const url = linkResult?.url || "";
    const type = linkResult?.type || null;

    // 直鏈：直接返回 direct link（S3 custom_host / native_direct）
    if (url && (type === "custom_host" || type === "native_direct")) {
      console.log(
        `[LinkService][fs][direct] 路徑(${path}) 使用儲存直鏈: ${url} (type=${type || "unknown"})`,
      );
      return createDirectLink(url);
    }

    // 代理連結：如掛載要求籤名，則在此生成帶簽名的 /api/p 連結
    let finalUrl = url || "";
    let signatureForPath = null;
    try {
      const proxyMountResult =
        mountResult && !mountResult.error ? mountResult : await findMountPointByPathForProxy(this.db, path, this.repositoryFactory);
      if (!proxyMountResult.error) {
        const signatureService = new ProxySignatureService(this.db, this.encryptionSecret, this.repositoryFactory);
        const signatureNeed = await signatureService.needsSignature(proxyMountResult.mount);
        if (signatureNeed.required) {
          const signInfo = await signatureService.generateStorageSignature(path, proxyMountResult.mount, {
            expiresIn: options.expiresIn,
          });
          signatureForPath = signInfo.signature;

          finalUrl = buildSignedProxyUrl(options.request || null, path, {
            download: options.forceDownload || false,
            signature: signInfo.signature,
            requestTimestamp: signInfo.requestTimestamp,
            needsSignature: true,
          });
        }
      }
    } catch (e) {
      // 簽名失敗時不阻斷流程，只記錄一條警告日誌並返回未簽名的代理 URL
      console.warn("生成 FS 代理簽名連結失敗，將返回未簽名連結：", e?.message || e);
    }

    // mode=proxy：返回給反向代理/Proxy 使用的“上游 URL”（僅關心直鏈 vs 本地 /api/p）
    if (mode === "proxy") {
      console.log(
        `[LinkService][fs][upstream] 路徑(${path}) 上游使用本地 /api/p 代理鏈路: ${finalUrl || ""}`,
      );
      return createProxyLink(finalUrl || "");
    }

    // mode=client：
    // - 未配置 url_proxy：返回本地 /api/p 代理 URL
    // - 配置了 url_proxy：使用 url_proxy 作為 Worker / 反代入口域名，路徑改為 /proxy/fs/<path>
    let proxiedUrl = finalUrl;
    if (hasUrlProxy) {
      try {
        const entryPath = `${WORKER_ENTRY.FS_PREFIX}${path}${options.forceDownload ? "?download=true" : ""}`;

        // - /proxy/fs 對外入口：sign 只覆蓋 fsPath + expire（不包含 owner）
        // - Telegram 需要的 owner 上下文：由外部代理用 TOKEN 調 /api/proxy/link 後在“上游 URL”裡解決，
        //   瀏覽器永遠不需要知道 ot/oid。

        let workerSignature = null;
        try {
          const proxyMountResult =
            mountResult && !mountResult.error ? mountResult : await findMountPointByPathForProxy(this.db, path, this.repositoryFactory);
          if (!proxyMountResult.error) {
            const signatureService = new ProxySignatureService(this.db, this.encryptionSecret, this.repositoryFactory);
            const signatureNeed = await signatureService.needsSignature(proxyMountResult.mount);
            const forceWorkerSignature =
              proxyMountResult?.mount?.storage_type === StorageFactory.SUPPORTED_TYPES.TELEGRAM;
            if (signatureNeed.required || forceWorkerSignature) {
              const signInfo = await signatureService.generateStorageSignature(path, proxyMountResult.mount, {
                expiresIn: options.expiresIn,
                // 不傳 ownerType/ownerId：保持外部代理相容的簽名格式（path:expire）
              });
              workerSignature = signInfo.signature;
            }
          }
        } catch (e) {
          console.warn("生成 FS Worker 入口簽名失敗，將返回未簽名的入口連結：", e?.message || e);
          workerSignature = null;
        }

        // 外部入口：不攜帶 ot/oid，避免外部代理與快取體系被迫升級
        proxiedUrl = buildSignedWorkerUrl(urlProxy, entryPath, {
          signature: workerSignature || undefined,
        });
        console.log(
          `[LinkService][fs][url_proxy] 路徑(${path}) 使用 url_proxy=${urlProxy} 生成 Worker 入口: ${proxiedUrl}`,
        );
      } catch (e) {
        // 構建失敗時保底使用原始 CloudHarbor 代理連結，避免中斷現有行為
        console.warn("構建 FS Worker 入口連結失敗，將回退為原始代理連結：", e?.message || e);
        proxiedUrl = finalUrl;
      }
    }

    // 其餘情況一律視為代理鏈路（包括本地 /api/p 代理 或 Worker 入口）
    console.log(
      `[LinkService][fs][proxy] 路徑(${path}) 使用代理連結: ${proxiedUrl || ""}`,
    );
    return createProxyLink(proxiedUrl || "");
  }
}
