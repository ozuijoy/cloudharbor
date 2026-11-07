/**
 * 處理WebDAV GET請求
 * 用於獲取檔案內容
 *
 * Range/條件請求由 StorageStreaming 統一處理
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { addWebDAVHeaders, getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { getEffectiveMimeType } from "../../utils/fileUtils.js";
import { LinkService } from "../../storage/link/LinkService.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../../storage/streaming/index.js";
import { CAPABILITIES } from "../../storage/interfaces/capabilities/index.js";

// Windows MiniRedir 302自動降級：
// - 對同一路徑，第一次請求按掛載策略走 302
// - 如果客戶端再次透過 WebDAV GET 同一路徑，則視為 302 可能不可靠，後續該路徑強制走本地代理
const miniRedirTried302 = new Set();

/**
 * 從驅動返回結果中提取 URL
 * 當前 WebDAV 場景下，generateDownloadUrl 約定返回 { url, type, ... }
 * @param {*} result - 驅動返回的結果
 * @returns {string|null} 提取的 URL 或 null
 */
function extractUrlFromResult(result) {
  if (!result) return null;
  if (typeof result === "object") {
    return result.url || null;
  }
  return null;
}

/**
 * 透過 StorageStreaming 層下載檔案（native_proxy）
 *
 *
 * @param {MountManager} mountManager - 掛載管理器
 * @param {string} path - 檔案路徑
 * @param {Object} c - Hono 上下文
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別
 * @returns {Promise<Response>} WebDAV 響應
 */
async function downloadViaStreaming(mountManager, path, c, userId, userType) {
  console.log(`WebDAV GET - 使用 StorageStreaming 本地代理模式: ${path}`);

  const encryptionSecret = getEncryptionSecret(c);
  const streaming = new StorageStreaming({
    mountManager,
    storageFactory: null, // FS 路徑模式不需要 storageFactory
    encryptionSecret,
  });

  // 獲取 Range 頭
  const rangeHeader = c.req.header("Range") || null;

  // 透過 StorageStreaming 建立響應
  const response = await streaming.createResponse({
    path,
    channel: STREAMING_CHANNELS.WEBDAV,
    rangeHeader,
    request: c.req.raw,
    userIdOrInfo: userId,
    userType,
    db: c.env.DB,
  });

  return addWebDAVHeaders(response);
}


/**
 * 處理GET請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @param {D1Database} db - D1資料庫例項
 */
export async function handleGet(c, path, userId, userType, db) {
    const isHead = c.req.method === "HEAD";
    return withWebDAVErrorHandling("GET", async () => {
    const userAgent = c.req.header("User-Agent") || "";
    const isWindowsMiniRedirector =
      userAgent.includes("Microsoft-WebDAV") || userAgent.includes("WebDAV-MiniRedir");

    // 建立FileSystem例項
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    // 獲取檔名並統一從檔名推斷MIME型別
    const fileName = path.split("/").pop();
    const contentType = getEffectiveMimeType(null, fileName);
    console.log(`WebDAV GET - 從檔名[${fileName}]推斷MIME型別: ${contentType}`);

    // 處理條件請求頭
    const ifNoneMatch = c.req.header("If-None-Match");
    const ifModifiedSince = c.req.header("If-Modified-Since");
    const ifMatch = c.req.header("If-Match");
    const ifUnmodifiedSince = c.req.header("If-Unmodified-Since");

    // 首先獲取檔案資訊以檢查條件請求
    let fileInfo;
    try {
      fileInfo = await fileSystem.getFileInfo(path, userId, userType);
    } catch (error) {
      if (error.status === 404) {
        return createWebDAVErrorResponse("檔案不存在", 404);
      }
      throw error;
    }

    // 從檔案資訊中提取後設資料
    const etag = fileInfo.etag ? `"${fileInfo.etag}"` : "";
    const lastModified = fileInfo.modified ? new Date(fileInfo.modified) : new Date();
    const lastModifiedStr = lastModified.toUTCString();
    const contentLength = fileInfo.size || 0;

    // 檢查ETag匹配（如果提供了If-None-Match頭）
    if (ifNoneMatch && etag) {
      // 移除引號以進行比較
      const clientEtag = ifNoneMatch.replace(/^"(.*)"$/, "$1");
      const serverEtag = etag.replace(/^"(.*)"$/, "$1");

      if (clientEtag === serverEtag || clientEtag === "*") {
        console.log(`GET請求: ETag匹配 ${etag}，返回304 Not Modified`);
        return new Response(null, {
          status: 304, // Not Modified
          headers: {
            ETag: etag,
            "Last-Modified": lastModifiedStr,
            "Cache-Control": "max-age=3600",
          },
        });
      }
    }

    // 檢查修改時間（如果提供了If-Modified-Since頭且沒有If-None-Match頭或ETag不匹配）
    if (ifModifiedSince && !ifNoneMatch) {
      try {
        const modifiedSinceDate = new Date(ifModifiedSince);

        // 將時間戳向下取整到秒，因為HTTP日期不包含毫秒
        const modifiedSinceTime = Math.floor(modifiedSinceDate.getTime() / 1000) * 1000;
        const lastModifiedTime = Math.floor(lastModified.getTime() / 1000) * 1000;

        if (lastModifiedTime <= modifiedSinceTime) {
          console.log(`GET請求: 檔案未修改，返回304 Not Modified`);
          return new Response(null, {
            status: 304, // Not Modified
            headers: {
              ETag: etag,
              "Last-Modified": lastModifiedStr,
              "Cache-Control": "max-age=3600",
            },
          });
        }
      } catch (dateError) {
        console.warn(`GET請求: If-Modified-Since頭格式無效: ${ifModifiedSince}`);
        // 如果日期格式無效，忽略此頭，繼續處理請求
      }
    }

    // 處理If-Match頭（確保資源匹配）
    if (ifMatch && etag) {
      const clientEtag = ifMatch.replace(/^"(.*)"$/, "$1");
      const serverEtag = etag.replace(/^"(.*)"$/, "$1");

      if (clientEtag !== "*" && clientEtag !== serverEtag) {
        console.log(`GET請求: If-Match條件不滿足 ${ifMatch} != ${etag}`);
        return createWebDAVErrorResponse("資源已被修改", 412); // Precondition Failed
      }
    }

    // 處理If-Unmodified-Since頭
    if (ifUnmodifiedSince) {
      try {
        const unmodifiedSinceDate = new Date(ifUnmodifiedSince);

        // 將時間戳向下取整到秒
        const unmodifiedSinceTime = Math.floor(unmodifiedSinceDate.getTime() / 1000) * 1000;
        const lastModifiedTime = Math.floor(lastModified.getTime() / 1000) * 1000;

        if (lastModifiedTime > unmodifiedSinceTime) {
          console.log(`GET請求: If-Unmodified-Since條件不滿足`);
          return createWebDAVErrorResponse("資源已被修改", 412); // Precondition Failed
        }
      } catch (dateError) {
        console.warn(`GET請求: If-Unmodified-Since頭格式無效: ${ifUnmodifiedSince}`);
        // 如果日期格式無效，忽略此頭，繼續處理請求
      }
    }

    // 根據掛載點的 webdav_policy 配置決定處理方式
    const { driver, mount, subPath } = await mountManager.getDriverByPath(path, userId, userType);

    // Windows MiniRedir：同一路徑第一次走 302，之後強制走本地代理
    const miniKey = path;
    let policy = mount.webdav_policy || "native_proxy";
    if (isWindowsMiniRedirector && miniRedirTried302.has(miniKey)) {
      policy = "native_proxy";
    }

    switch (policy) {
      case "302_redirect": {
        // 策略 1：儲存直鏈重定向（透過驅動自己的 generateDownloadUrl 能力）
        if (typeof driver?.hasCapability === "function" && driver.hasCapability(CAPABILITIES.DIRECT_LINK)) {
          try {
            console.log(`WebDAV GET - 嘗試生成儲存直鏈: ${path}`);
            const result = await driver.generateDownloadUrl(subPath, {
              path,
              mount,
              subPath,
              db,
              userId,
              userType,
              forceDownload: false,
              channel: "webdav",
            });

            const url = extractUrlFromResult(result);
            if (url) {
              console.log(`WebDAV GET - 302 重定向到儲存直鏈: ${url}`);

              // 對 MiniRedir，記錄該路徑已嘗試過 302，下次訪問走本地代理
              if (isWindowsMiniRedirector) {
                miniRedirTried302.add(miniKey);
              }

              return new Response(null, {
                status: 302,
                headers: getStandardWebDAVHeaders({
                  customHeaders: {
                    Location: url,
                    "Cache-Control": "no-cache",
                  },
                }),
              });
            }
          } catch (error) {
            console.warn(`WebDAV GET - 生成儲存直鏈失敗，降級到本地代理:`, error?.message || error);
          }
        }

        console.log(`WebDAV GET - 驅動不支援直鏈生成或未返回 URL，降級到本地代理`);
        return downloadViaStreaming(mountManager, path, c, userId, userType);
      }

      case "use_proxy_url": {
        // 策略 2：基於 storage_config.url_proxy 的代理 URL 重定向
        // 新協議：優先複用 FS 鏈路的 url_proxy/Worker 入口生成邏輯，保持與 /api/fs/download 一致
        try {
          const repositoryFactory = c.get("repos");
          const encryptionSecret = getEncryptionSecret(c);
          const linkService = new LinkService(db, encryptionSecret, repositoryFactory);

          // WebDAV 掛載基於 FS 檢視路徑，複用 FS External 鏈路
          const storageLink = await linkService.getFsExternalLink(path, userId, userType, {
            forceDownload: false,
            request: c.req.raw,
          });

          const url = storageLink?.url || null;
          if (url) {
            console.log(`WebDAV GET - URL 代理 use_proxy_url 透過 FS 鏈路生成入口: ${url}`);
            return new Response(null, {
              status: 302,
              headers: getStandardWebDAVHeaders({
                customHeaders: {
                  Location: url,
                  "Cache-Control": "no-cache",
                },
              }),
            });
          }
        } catch (error) {
          console.warn(
            `WebDAV GET - 透過 FS 鏈路生成 url_proxy 入口失敗，將降級到本地代理:`,
            error?.message || error,
          );
        }

        console.warn(`WebDAV GET - use_proxy_url 策略下未生成 url_proxy 入口，降級到本地代理`);
        return downloadViaStreaming(mountManager, path, c, userId, userType);
      }

      case "native_proxy":
      default: {
        // 策略 3：本地伺服器代理（預設兜底）
        // StorageStreaming 層統一處理
        if (isHead) {
          // HEAD 請求下只返回頭資訊，不傳輸主體內容
          const headHeaders = {
            "Content-Length": String(contentLength),
            "Content-Type": contentType,
            "Last-Modified": lastModifiedStr,
            ETag: etag,
            "Accept-Ranges": "bytes",
            "Cache-Control": "max-age=3600",
          };
          const response = new Response(null, {
            status: 200,
            headers: headHeaders,
          });
          return addWebDAVHeaders(response);
        }

        return downloadViaStreaming(mountManager, path, c, userId, userType);
      }
    }
  });
}
