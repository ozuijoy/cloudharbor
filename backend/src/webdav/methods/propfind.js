/**
 * WebDAV PROPFIND方法實現
 * 符合RFC 4918標準，支援propname、allprop、prop請求型別
 * 在單個檔案內修復所有標準違反問題
 */

import { withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { UserType } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getAccessibleMountsForUser, canNavigatePath } from "../../security/helpers/access.js";
import { getMimeTypeFromFilename } from "../../utils/fileUtils.js";
import { lockManager } from "../utils/LockManager.js";
import { buildLockDiscoveryXML } from "../utils/lockUtils.js";
import { WEBDAV_BASE_PATH } from "../auth/config/WebDAVConfig.js";
import { getWebDAVMultiStatusHeaders } from "../utils/headerUtils.js";

// 匯入虛擬目錄處理函式
import { isVirtualPath, getVirtualDirectoryListing } from "../../storage/fs/utils/VirtualDirectory.js";

// ===== RFC 4918標準實現：請求型別列舉 =====
const PropfindRequestType = {
  PROPNAME: "propname",
  ALLPROP: "allprop",
  PROP: "prop",
};

// ===== RFC 4918標準實現：屬性狀態列舉 =====
const PropertyStatus = {
  OK: 200,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

// ===== RFC 4918標準實現：請求體解析函式 =====

/**
 * 解析PROPFIND請求體
 * 符合RFC 4918標準，支援propname、allprop、prop三種請求型別
 * @param {string} requestBody - XML請求體
 * @returns {Object} 解析結果
 */
function parsePropfindRequest(requestBody) {
  // 如果請求體為空，按照RFC 4918標準應該當作allprop處理
  if (!requestBody || requestBody.trim() === "") {
    return {
      type: PropfindRequestType.ALLPROP,
      properties: [],
      include: [],
    };
  }

  try {
    const cleanBody = requestBody.trim();

    // 檢查是否為propname請求
    if (cleanBody.includes("<D:propname") || cleanBody.includes("<propname")) {
      return {
        type: PropfindRequestType.PROPNAME,
        properties: [],
        include: [],
      };
    }

    // 檢查是否為allprop請求
    if (cleanBody.includes("<D:allprop") || cleanBody.includes("<allprop")) {
      return {
        type: PropfindRequestType.ALLPROP,
        properties: [],
        include: [],
      };
    }

    // 檢查是否為prop請求（指定屬性）
    if (cleanBody.includes("<D:prop") || cleanBody.includes("<prop")) {
      const properties = parseRequestedProperties(cleanBody);
      return {
        type: PropfindRequestType.PROP,
        properties: properties,
        include: [],
      };
    }

    // 如果無法識別，預設當作allprop處理
    return {
      type: PropfindRequestType.ALLPROP,
      properties: [],
      include: [],
    };
  } catch (error) {
    console.error("解析PROPFIND請求體失敗:", error);
    return {
      type: PropfindRequestType.ALLPROP,
      properties: [],
      include: [],
    };
  }
}

/**
 * 解析prop元素中請求的屬性
 * @param {string} xmlBody - XML請求體
 * @returns {Array} 請求的屬性列表
 */
function parseRequestedProperties(xmlBody) {
  const properties = [];

  try {
    // 查詢prop元素
    const propMatch = xmlBody.match(/<D:prop[^>]*>(.*?)<\/D:prop>/s) || xmlBody.match(/<prop[^>]*>(.*?)<\/prop>/s);

    if (propMatch) {
      const propContent = propMatch[1];
      // 提取屬性名稱
      const propertyMatches = propContent.match(/<[^\/][^>]*>/g) || [];

      for (const match of propertyMatches) {
        const propertyName = extractPropertyName(match);
        if (propertyName) {
          properties.push(propertyName);
        }
      }
    }
  } catch (error) {
    console.error("解析請求屬性失敗:", error);
  }

  return properties;
}

/**
 * 從XML標籤中提取屬性名稱
 * @param {string} xmlTag - XML標籤
 * @returns {string|null} 屬性名稱
 */
function extractPropertyName(xmlTag) {
  try {
    const tagContent = xmlTag.replace(/[<>]/g, "");
    const cleanTag = tagContent.replace(/\/$/, "");
    const tagName = cleanTag.split(/\s+/)[0];
    const localName = tagName.includes(":") ? tagName.split(":")[1] : tagName;
    return localName || null;
  } catch (error) {
    console.error("提取屬性名稱失敗:", error, xmlTag);
    return null;
  }
}

// ===== RFC 4918標準實現：屬性管理函式 =====

/**
 * 獲取所有標準DAV屬性
 * 符合RFC 4918標準
 * @param {Object} item - 檔案/目錄項
 * @param {string} path - 資源路徑
 * @returns {Object} 屬性對映
 */
function getAllProperties(item, path) {
  const isDirectory = item.isDirectory || false;

  return {
    resourcetype: {
      value: isDirectory ? "<D:collection/>" : "",
      status: PropertyStatus.OK,
    },
    displayname: {
      value: escapeXmlChars(item.name || ""),
      status: PropertyStatus.OK,
    },
    getlastmodified: {
      value: item.modified ? new Date(item.modified).toUTCString() : null,
      status: item.modified ? PropertyStatus.OK : PropertyStatus.NOT_FOUND,
    },
    creationdate: {
      value: item.created ? new Date(item.created).toISOString() : null,
      status: item.created ? PropertyStatus.OK : PropertyStatus.NOT_FOUND,
    },
    getetag: {
      value: generateETag(item, path),
      status: PropertyStatus.OK,
    },
    getcontentlength: {
      value: !isDirectory ? (item.size || 0).toString() : null,
      status: !isDirectory ? PropertyStatus.OK : PropertyStatus.NOT_FOUND,
    },
    getcontenttype: {
      value: !isDirectory ? getMimeTypeFromFilename(item.name || "") : null,
      status: !isDirectory ? PropertyStatus.OK : PropertyStatus.NOT_FOUND,
    },
    getcontentlanguage: {
      value: null,
      status: PropertyStatus.NOT_FOUND,
    },
    lockdiscovery: {
      value: (() => {
        // 獲取當前路徑的鎖定資訊
        const lockInfo = lockManager.getLockByPath(item.path || path);
        return buildLockDiscoveryXML(lockInfo);
      })(),
      status: PropertyStatus.OK,
    },
    supportedlock: {
      value: `<D:lockentry>
        <D:lockscope><D:exclusive/></D:lockscope>
        <D:locktype><D:write/></D:locktype>
      </D:lockentry>`,
      status: PropertyStatus.OK,
    },
    source: {
      value: null,
      status: PropertyStatus.NOT_FOUND,
    },
  };
}

/**
 * 獲取指定的屬性
 * @param {Object} item - 檔案/目錄項
 * @param {string} path - 資源路徑
 * @param {Array} requestedProperties - 請求的屬性列表
 * @returns {Object} 屬性對映
 */
function getRequestedProperties(item, path, requestedProperties) {
  const allProperties = getAllProperties(item, path);
  const result = {};

  for (const propertyName of requestedProperties) {
    if (allProperties[propertyName]) {
      result[propertyName] = allProperties[propertyName];
    } else {
      // 未知屬性返回404
      result[propertyName] = {
        value: null,
        status: PropertyStatus.NOT_FOUND,
      };
    }
  }

  return result;
}

/**
 * 獲取屬性名稱列表（用於propname請求）
 * @param {Object} item - 檔案/目錄項
 * @param {string} path - 資源路徑
 * @returns {Object} 屬性名稱對映
 */
function getPropertyNames(item, path) {
  const allProperties = getAllProperties(item, path);
  const result = {};

  for (const [propertyName, propertyInfo] of Object.entries(allProperties)) {
    // 只返回存在的屬性名稱
    if (propertyInfo.status === PropertyStatus.OK) {
      result[propertyName] = {
        value: "", // propname請求不返回值，只返回名稱
        status: PropertyStatus.OK,
      };
    }
  }

  return result;
}

// ===== RFC 4918標準實現：工具函式 =====

/**
 * 生成ETag
 * @param {Object} item - 檔案/目錄項
 * @param {string} path - 資源路徑
 * @returns {string} ETag值
 */
function generateETag(item, path) {
  // 基於路徑、修改時間和大小生成穩定的ETag
  const pathHash = simpleHash(path);
  const timeHash = item.modified ? new Date(item.modified).getTime().toString(16) : "0";
  const sizeHash = (item.size || 0).toString(16);

  return `"${pathHash}-${timeHash}-${sizeHash}"`;
}

/**
 * 簡單雜湊函式
 * @param {string} str - 輸入字串
 * @returns {string} 雜湊值
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // 轉換為32位整數
  }
  return Math.abs(hash).toString(16);
}

/**
 * 轉義XML特殊字元
 * @param {string} text - 需要轉義的文字
 * @returns {string} 轉義後的文字
 */
function escapeXmlChars(text) {
  if (typeof text !== "string") return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * 編碼URI路徑
 * @param {string} path - 路徑
 * @returns {string} 編碼後的路徑
 */
function encodeUriPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * 規範化路徑（確保目錄以/結尾，檔案不以/結尾）
 * @param {string} path - 原始路徑
 * @param {boolean} isDirectory - 是否為目錄
 * @returns {string} 規範化後的路徑
 */
function normalizePath(path, isDirectory) {
  if (isDirectory && !path.endsWith("/")) {
    return path + "/";
  } else if (!isDirectory && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * 根據請求型別獲取屬性
 * @param {Object} item - 檔案/目錄項
 * @param {string} path - 路徑
 * @param {Object} requestInfo - 請求資訊
 * @returns {Object} 屬性對映
 */
function getPropertiesForRequest(item, path, requestInfo) {
  switch (requestInfo.type) {
    case PropfindRequestType.PROPNAME:
      return getPropertyNames(item, path);

    case PropfindRequestType.PROP:
      return getRequestedProperties(item, path, requestInfo.properties);

    case PropfindRequestType.ALLPROP:
    default:
      const allProperties = getAllProperties(item, path);

      // 如果有include屬性，新增額外的屬性
      if (requestInfo.include && requestInfo.include.length > 0) {
        const includeProperties = getRequestedProperties(item, path, requestInfo.include);
        return { ...allProperties, ...includeProperties };
      }

      return allProperties;
  }
}

// ===== RFC 4918標準實現：Multi-Status響應構建 =====

/**
 * 構建Multi-Status XML響應
 * 符合RFC 4918標準，支援屬性級錯誤處理
 * @param {Array} responses - 響應陣列
 * @returns {string} Multi-Status XML
 */
function buildMultiStatusXML(responses) {
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">`;

  for (const response of responses) {
    xml += buildResponseXML(response);
  }

  xml += `\n</D:multistatus>`;

  return xml;
}

/**
 * 構建單個響應的XML
 * @param {Object} response - 響應物件
 * @returns {string} 響應XML
 */
function buildResponseXML(response) {
  let xml = `
  <D:response>
    <D:href>${encodeUriPath(response.href)}</D:href>`;

  if (response.status) {
    // 資源級別的錯誤
    xml += `
    <D:status>HTTP/1.1 ${response.status} ${getStatusText(response.status)}</D:status>`;
  } else if (response.properties) {
    // 屬性級別的響應
    const propstatGroups = groupPropertiesByStatus(response.properties);

    for (const propstat of propstatGroups) {
      xml += buildPropstatXML(propstat);
    }
  }

  xml += `
  </D:response>`;

  return xml;
}

/**
 * 按狀態碼分組屬性
 * @param {Object} properties - 屬性對映
 * @returns {Array} propstat組列表
 */
function groupPropertiesByStatus(properties) {
  const statusGroups = {};

  // 按狀態碼分組
  for (const [propertyName, propertyInfo] of Object.entries(properties)) {
    const status = propertyInfo.status;

    if (!statusGroups[status]) {
      statusGroups[status] = [];
    }

    statusGroups[status].push({
      name: propertyName,
      value: propertyInfo.value,
    });
  }

  // 轉換為propstat陣列
  const propstats = [];
  for (const [status, props] of Object.entries(statusGroups)) {
    propstats.push({
      properties: props,
      status: parseInt(status),
    });
  }

  return propstats;
}

/**
 * 構建propstat的XML
 * @param {Object} propstat - propstat物件
 * @returns {string} propstat XML
 */
function buildPropstatXML(propstat) {
  let xml = `
    <D:propstat>
      <D:prop>`;

  for (const property of propstat.properties) {
    if (property.value !== null && property.value !== undefined) {
      xml += `
        <D:${property.name}>${property.value}</D:${property.name}>`;
    } else {
      // 空屬性（用於propname或不存在的屬性）
      xml += `
        <D:${property.name}/>`;
    }
  }

  xml += `
      </D:prop>
      <D:status>HTTP/1.1 ${propstat.status} ${getStatusText(propstat.status)}</D:status>
    </D:propstat>`;

  return xml;
}

/**
 * 獲取HTTP狀態碼對應的文字
 * @param {number} status - HTTP狀態碼
 * @returns {string} 狀態文字
 */
function getStatusText(status) {
  const statusTexts = {
    200: "OK",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    423: "Locked",
    424: "Failed Dependency",
    507: "Insufficient Storage",
  };

  return statusTexts[status] || "Unknown";
}

/**
 * 建立標準錯誤響應
 * @param {string} href - 資源URI
 * @param {number} status - HTTP狀態碼
 * @param {string} message - 錯誤訊息
 * @returns {Response} HTTP響應物件
 */
function createErrorResponse(href, status, message) {
  // 404等錯誤，直接返回對應的狀態碼
  // 客戶端才能正確理解資源不存在後繼續後續操作（如PUT上傳）
  if (status === 404) {
    return new Response(message, {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        DAV: "1, 2",
      },
    });
  }

  // 對於其他錯誤，使用Multi-Status格式
  const xml = buildMultiStatusXML([
    {
      href: href,
      status: status,
      description: message,
    },
  ]);

  return new Response(xml, {
    status: status >= 400 ? status : 207,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      DAV: "1, 2",
    },
  });
}

// ===== RFC 4918標準實現：主要處理函式 =====

/**
 * 主要的PROPFIND處理函式
 * 符合RFC 4918標準，修復所有標準違反問題
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑（由WebDAV中介軟體解析）
 * @param {string|Object} userId - 使用者ID或資訊
 * @param {string} userType - 使用者型別
 * @param {D1Database} db - 資料庫例項
 * @returns {Response} HTTP響應
 */
export async function handlePropfind(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("PROPFIND", async () => {
    // 修復：Depth預設值應該是"infinity"（符合RFC 4918標準）
    const depth = c.req.header("Depth") || "infinity";

    // 驗證depth值
    if (!["0", "1", "infinity"].includes(depth)) {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 400, "Invalid Depth header value");
    }

    console.log(`WebDAV PROPFIND - 路徑: ${path}, 深度: ${depth}`);

    // 修復：解析請求體（支援propname、allprop、prop三種型別）
    let requestBody = "";
    try {
      requestBody = await c.req.text();
    } catch (error) {
      console.log("PROPFIND請求體解析失敗，當作allprop處理");
    }

    const requestInfo = parsePropfindRequest(requestBody);
    requestInfo.depth = depth;

    console.log("PROPFIND請求解析結果:", requestInfo);

    // 獲取使用者資訊（適配WebDAV中介軟體的格式）
    let userIdOrInfo, actualUserType;
    if (userType === UserType.ADMIN) {
      userIdOrInfo = userId;
      actualUserType = UserType.ADMIN;
    } else if (userType === UserType.API_KEY) {
      // 對於API金鑰使用者，userId應該是完整的資訊物件
      if (typeof userId === "object" && userId !== null) {
        userIdOrInfo = {
          id: userId.id,
          name: userId.name,
          basicPath: userId.basicPath,
          permissions: userId.permissions || {},
        };
      } else {
        return createErrorResponse("/dav" + path, 401, "API金鑰資訊格式錯誤");
      }
      actualUserType = UserType.API_KEY;
    } else {
      return createErrorResponse("/dav" + path, 401, "未知使用者型別");
    }

    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    return await processPropfindRequest(path, requestInfo, userIdOrInfo, actualUserType, db, encryptionSecret, repositoryFactory, c.env);
  }, { includeDetails: false });
}

/**
 * 處理PROPFIND請求的核心邏輯
 * @param {string} path - 請求路徑
 * @param {Object} requestInfo - 解析後的請求資訊
 * @param {string|Object} userIdOrInfo - 使用者ID或資訊
 * @param {string} actualUserType - 實際使用者型別
 * @param {D1Database} db - 資料庫例項
 * @param {string} encryptionSecret - 加密金鑰
 * @param {RepositoryFactory} repositoryFactory - 倉儲工廠例項
 * @param {Object} env - Worker/Hono 環境
 * @returns {Response} HTTP響應
 */
async function processPropfindRequest(path, requestInfo, userIdOrInfo, actualUserType, db, encryptionSecret, repositoryFactory, env) {
  try {
    // 檢查API金鑰使用者的路徑許可權
    if (actualUserType === UserType.API_KEY) {
      if (!canNavigatePath(userIdOrInfo.basicPath, path)) {
        return createErrorResponse(WEBDAV_BASE_PATH + path, 403, "沒有許可權訪問此路徑");
      }
    }

    // 獲取使用者可訪問的掛載點列表
    const mounts = await getAccessibleMountsForUser(db, userIdOrInfo, actualUserType);

    // 檢查是否為虛擬路徑
    if (isVirtualPath(path, mounts)) {
      // 處理虛擬目錄
      const basicPath = actualUserType === UserType.API_KEY ? userIdOrInfo.basicPath : null;
      return await handleVirtualDirectoryPropfind(mounts, path, basicPath, requestInfo);
    }

    // 處理實際儲存路徑
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env });
    const fileSystem = new FileSystem(mountManager);

    return await handleStoragePropfind(fileSystem, path, requestInfo, userIdOrInfo, actualUserType);
  } catch (error) {
    console.error("處理PROPFIND請求失敗:", error);

    if (error.message && error.message.includes("許可權")) {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 403, "許可權不足");
    } else if (error.message && error.message.includes("不存在")) {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 404, "資源不存在");
    } else {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 500, "內部伺服器錯誤");
    }
  }
}

/**
 * 處理虛擬目錄的PROPFIND請求
 * @param {Object} mounts - 掛載點列表
 * @param {string} path - 請求路徑
 * @param {string} basicPath - 基礎路徑（API金鑰使用者）
 * @param {Object} requestInfo - 請求資訊
 * @returns {Response} HTTP響應
 */
async function handleVirtualDirectoryPropfind(mounts, path, basicPath, requestInfo) {
  try {
    const result = await getVirtualDirectoryListing(mounts, path, basicPath);

    const responses = [];

    // 處理當前虛擬目錄
    const webdavPath = "/dav" + normalizePath(path, true);
    const properties = getPropertiesForRequest(result, path, requestInfo);
    responses.push({
      href: webdavPath,
      properties: properties,
    });

    // 如果depth=1，新增子項
    if (requestInfo.depth === "1" && result.items) {
      for (const item of result.items) {
        const itemPath = WEBDAV_BASE_PATH + normalizePath(item.path, item.isDirectory);
        const itemProperties = getPropertiesForRequest(item, item.path, requestInfo);
        responses.push({
          href: itemPath,
          properties: itemProperties,
        });
      }
    }

    const xml = buildMultiStatusXML(responses);

    return new Response(xml, {
      status: 207, // Multi-Status
      headers: getWebDAVMultiStatusHeaders(),
    });
  } catch (error) {
    console.error("處理虛擬目錄PROPFIND失敗:", error);
    return createErrorResponse(WEBDAV_BASE_PATH + path, 500, "內部伺服器錯誤");
  }
}

/**
 * 處理實際儲存的PROPFIND請求
 * @param {Object} fileSystem - 檔案系統例項
 * @param {string} path - 請求路徑
 * @param {Object} requestInfo - 請求資訊
 * @param {string|Object} userIdOrInfo - 使用者ID或資訊
 * @param {string} actualUserType - 實際使用者型別
 * @returns {Response} HTTP響應
 */
async function handleStoragePropfind(fileSystem, path, requestInfo, userIdOrInfo, actualUserType) {
  try {
    let result;

    if (requestInfo.depth === "0") {
      // 只獲取當前資源資訊
      try {
        const fileInfo = await fileSystem.getFileInfo(path, userIdOrInfo, actualUserType);
        result = {
          path: path,
          isDirectory: fileInfo.isDirectory,
          name: fileInfo.name,
          size: fileInfo.size,
          modified: fileInfo.modified,
          created: fileInfo.created,
          items: [], // depth=0時不包含子項
        };
      } catch (error) {
        throw error;
      }
    } else if (requestInfo.depth === "1") {
      // 獲取當前資源和直接子項
      try {
        result = await fileSystem.listDirectory(path, userIdOrInfo, actualUserType);
      } catch (error) {
        throw error;
      }
    } else {
      // infinity深度 - 大多數伺服器會拒絕此請求
      return createErrorResponse("/dav" + path, 403, "Depth infinity is not supported for performance reasons");
    }

    const responses = [];

    // 處理當前資源
    // 修復：根據返回的資料結構判斷是否為目錄
    const isCurrentDirectory = result.type === "directory" || result.isDirectory === true;
    const webdavPath = "/dav" + normalizePath(path, isCurrentDirectory);

    // 修復：為當前資源構建正確的屬性物件
    const currentResource = {
      ...result,
      isDirectory: isCurrentDirectory,
      name: result.name || path.split("/").filter(Boolean).pop() || "",
    };

    const properties = getPropertiesForRequest(currentResource, path, requestInfo);
    responses.push({
      href: webdavPath,
      properties: properties,
    });

    // 如果depth=1且是目錄，處理子項
    if (requestInfo.depth === "1" && isCurrentDirectory && result.items) {
      for (const item of result.items) {
        // 修復：確保子項有正確的isDirectory屬性
        const itemIsDirectory = item.isDirectory === true;
        const itemPath = "/dav" + normalizePath(item.path, itemIsDirectory);

        const itemProperties = getPropertiesForRequest(item, item.path, requestInfo);
        responses.push({
          href: itemPath,
          properties: itemProperties,
        });
      }
    }

    const xml = buildMultiStatusXML(responses);

    // // 除錯：輸出完整的XML內容（僅在depth=0時，避免過多日誌）
    // if (requestInfo.depth === "0") {
    //   console.log(`WebDAV PROPFIND 完整XML響應:\n${xml}`);
    // } else {
    //   console.log(`WebDAV PROPFIND XML響應預覽: ${xml.substring(0, 200)}...`);
    // }

    return new Response(xml, {
      status: 207, // Multi-Status
      headers: getWebDAVMultiStatusHeaders(),
    });
  } catch (error) {
    console.error("處理儲存PROPFIND失敗:", error);

    if (error.message && error.message.includes("許可權")) {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 403, "許可權不足");
    } else if (error.message && error.message.includes("不存在")) {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 404, "資源不存在");
    } else {
      return createErrorResponse(WEBDAV_BASE_PATH + path, 500, "內部伺服器錯誤");
    }
  }
}
