/**
 * WebDAV鎖定工具函式
 * 提供鎖定相關的工具函式，包括令牌生成、XML解析和響應構建
 */

import { XMLParser } from "fast-xml-parser";
import { ApiStatus } from "../../constants/index.js";
import { ValidationError } from "../../http/errors.js";

/**
 * 生成WebDAV鎖令牌
 * @param {number} tokenId - 令牌ID
 * @returns {string} 鎖令牌
 */
export function generateLockToken(tokenId) {
  // 生成UUID風格的令牌
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2);
  const id = tokenId.toString(36);

  return `opaquelocktoken:${timestamp}-${random}-${id}`;
}

/**
 * 解析LOCK請求的XML內容
 * @param {string} xmlBody - XML請求體
 * @returns {Object} 解析後的鎖定資訊
 */
export function parseLockXML(xmlBody) {
  if (!xmlBody || typeof xmlBody !== "string") {
    throw new ValidationError("無效的LOCK請求格式");
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseAttributeValue: true,
      trimValues: true,
    });

    const parsed = parser.parse(xmlBody);
    console.log("LOCK XML解析結果:", JSON.stringify(parsed, null, 2));

    // 查詢lockinfo元素
    let lockinfo = null;

    // 遞迴查詢lockinfo元素，支援任意名稱空間字首
    function findElementByLocalName(obj, localName) {
      if (!obj || typeof obj !== "object") return null;

      for (const key in obj) {
        // 檢查是否是目標元素（支援帶名稱空間字首）
        if (key === localName || key.endsWith(":" + localName)) {
          return obj[key];
        }

        // 遞迴查詢
        if (typeof obj[key] === "object") {
          const found = findElementByLocalName(obj[key], localName);
          if (found) return found;
        }
      }
      return null;
    }

    lockinfo = findElementByLocalName(parsed, "lockinfo");

    if (!lockinfo) {
      throw new ValidationError("無效的LOCK請求：缺少lockinfo元素");
    }

    // 解析鎖定範圍
    let scope = "exclusive"; // 預設為exclusive
    const scopeElement = findElementByLocalName(lockinfo, "lockscope");
    if (scopeElement) {
      const sharedElement = findElementByLocalName(scopeElement, "shared");
      if (sharedElement) {
        scope = "shared";
      }
    }

    // 解析鎖定型別
    let type = "write"; // 預設為write
    const typeElement = findElementByLocalName(lockinfo, "locktype");
    if (typeElement) {
      const readElement = findElementByLocalName(typeElement, "read");
      if (readElement) {
        type = "read";
      }
    }

    // 解析所有者資訊
    let owner = "unknown";
    const ownerElement = findElementByLocalName(lockinfo, "owner");
    if (ownerElement) {
      if (typeof ownerElement === "string") {
        owner = ownerElement;
      } else if (ownerElement["#text"]) {
        owner = ownerElement["#text"];
      } else {
        const hrefElement = findElementByLocalName(ownerElement, "href");
        if (hrefElement) {
          owner = typeof hrefElement === "string" ? hrefElement : hrefElement["#text"] || "unknown";
        }
      }
    }

    return {
      scope,
      type,
      owner: String(owner).trim() || "unknown",
    };
  } catch (error) {
    console.error("LOCK XML解析錯誤:", error);
    throw new ValidationError("無效的LOCK請求格式");
  }
}

/**
 * 解析Timeout頭
 * @param {string} timeoutHeader - Timeout頭的值
 * @returns {number} 超時時間（秒）
 */
export function parseTimeoutHeader(timeoutHeader) {
  if (!timeoutHeader) {
    return 600; // 預設10分鐘
  }

  // 解析格式：Second-3600 或 Infinite
  if (timeoutHeader.toLowerCase() === "infinite") {
    return 7200; // 最大2小時
  }

  const match = timeoutHeader.match(/Second-(\d+)/i);
  if (match) {
    const seconds = parseInt(match[1], 10);
    // 限制最大超時時間為2小時
    return Math.min(seconds, 7200);
  }

  return 600; // 預設10分鐘
}

/**
 * 解析Depth頭
 * @param {string} depthHeader - Depth頭的值
 * @returns {string} 深度值
 */
export function parseDepthHeader(depthHeader) {
  if (!depthHeader) {
    return "0"; // 預設深度為0
  }

  const depth = depthHeader.toLowerCase();
  if (depth === "infinity") {
    return "infinity";
  }

  return "0"; // 只支援0和infinity
}

/**
 * 構建LOCK響應XML
 * @param {string} path - 資源路徑
 * @param {Object} lockInfo - 鎖定資訊
 * @returns {string} XML響應
 */
export function buildLockResponseXML(path, lockInfo) {
  const href = escapeXmlChars(path);
  const token = escapeXmlChars(lockInfo.token);
  const owner = escapeXmlChars(lockInfo.owner);
  const timeout = `Second-${lockInfo.timeoutSeconds}`;

  return `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:${lockInfo.type}/></D:locktype>
      <D:lockscope><D:${lockInfo.scope}/></D:lockscope>
      <D:depth>${lockInfo.depth}</D:depth>
      <D:owner>${owner}</D:owner>
      <D:timeout>${timeout}</D:timeout>
      <D:locktoken>
        <D:href>${token}</D:href>
      </D:locktoken>
      <D:lockroot>
        <D:href>${href}</D:href>
      </D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
}

/**
 * 構建lockdiscovery屬性XML（用於PROPFIND）
 * 注意：只返回內容，不包含外層<D:lockdiscovery>標籤，因為會被PROPFIND自動包裝
 * @param {Object} lockInfo - 鎖定資訊
 * @returns {string} lockdiscovery內容XML
 */
export function buildLockDiscoveryXML(lockInfo) {
  if (!lockInfo) {
    return ""; // 返回空內容，外層會生成<D:lockdiscovery/>
  }

  const token = escapeXmlChars(lockInfo.token);
  const owner = escapeXmlChars(lockInfo.owner);
  const timeout = `Second-${lockInfo.timeoutSeconds}`;

  return `
  <D:activelock>
    <D:locktype><D:${lockInfo.type}/></D:locktype>
    <D:lockscope><D:${lockInfo.scope}/></D:lockscope>
    <D:depth>${lockInfo.depth}</D:depth>
    <D:owner>${owner}</D:owner>
    <D:timeout>${timeout}</D:timeout>
    <D:locktoken>
      <D:href>${token}</D:href>
    </D:locktoken>
  </D:activelock>
`;
}

/**
 * 解析Lock-Token頭
 * @param {string} lockTokenHeader - Lock-Token頭的值
 * @returns {string|null} 鎖令牌
 */
export function parseLockTokenHeader(lockTokenHeader) {
  if (!lockTokenHeader) {
    return null;
  }

  // 格式：<opaquelocktoken:token>
  const match = lockTokenHeader.match(/<([^>]+)>/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * 轉義XML特殊字元
 * @param {string} str - 要轉義的字串
 * @returns {string} 轉義後的字串
 */
function escapeXmlChars(str) {
  if (typeof str !== "string") {
    return String(str);
  }

  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 驗證鎖定衝突
 * @param {Object} existingLock - 現有鎖定
 * @param {string} requestedScope - 請求的鎖定範圍
 * @returns {boolean} 是否有衝突
 */
export function hasLockConflict(existingLock, requestedScope) {
  if (!existingLock) {
    return false;
  }

  // exclusive鎖與任何鎖都衝突
  if (existingLock.scope === "exclusive" || requestedScope === "exclusive") {
    return true;
  }

  // shared鎖之間不衝突
  return false;
}

/**
 * 格式化鎖定資訊用於日誌
 * @param {Object} lockInfo - 鎖定資訊
 * @returns {string} 格式化的字串
 */
export function formatLockInfo(lockInfo) {
  if (!lockInfo) {
    return "無鎖定";
  }

  const remainingTime = Math.max(0, Math.floor((lockInfo.expiresAt - Date.now()) / 1000));
  return `${lockInfo.scope} ${lockInfo.type} lock by ${lockInfo.owner} (${remainingTime}s remaining)`;
}

/**
 * 解析RFC 4918標準的If頭
 * 支援格式：If: </path> (<locktoken>) (["etag"]) 或 If: (<locktoken>)
 * @param {string} ifHeader - If頭的值
 * @returns {Object} 解析結果
 */
export function parseIfHeaderRFC4918(ifHeader) {
  if (!ifHeader || typeof ifHeader !== "string") {
    return { conditions: [] };
  }

  const conditions = [];

  try {
    // 移除多餘的空格
    const cleanHeader = ifHeader.trim();

    // 簡化的解析：主要提取鎖令牌
    // 支援格式：If: (<locktoken>) 或 If: </path> (<locktoken>)
    const tokenRegex = /<(opaquelocktoken:[^>]+)>/g;
    const pathRegex = /<(\/[^>]*)>/g;

    let match;
    const tokens = [];
    const paths = [];

    // 提取所有鎖令牌
    while ((match = tokenRegex.exec(cleanHeader)) !== null) {
      tokens.push(match[1]);
    }

    // 提取所有路徑
    tokenRegex.lastIndex = 0; // 重置正則
    while ((match = pathRegex.exec(cleanHeader)) !== null) {
      const value = match[1];
      // 如果不是鎖令牌，則認為是路徑
      if (!value.startsWith("opaquelocktoken:")) {
        paths.push(value);
      }
    }

    // 構建條件物件
    if (tokens.length > 0) {
      conditions.push({
        path: paths.length > 0 ? paths[0] : null,
        tokens: tokens,
        etags: [], // 暫不支援ETag解析
      });
    }

    return { conditions };
  } catch (error) {
    console.error("If頭解析錯誤:", error);
    throw new ValidationError("If 頭解析失敗");
  }
}

/**
 * 檢查If頭條件是否滿足
 * @param {Object} parsedIf - 解析後的If頭
 * @param {string} resourcePath - 資源路徑
 * @param {string} lockToken - 當前資源的鎖令牌
 * @returns {boolean} 條件是否滿足
 */
export function checkIfConditions(parsedIf, resourcePath, lockToken) {
  if (!parsedIf || !parsedIf.conditions || parsedIf.conditions.length === 0) {
    return true; // 沒有條件，允許操作
  }

  for (const condition of parsedIf.conditions) {
    // 檢查路徑匹配（如果指定了路徑）
    if (condition.path && condition.path !== resourcePath) {
      continue; // 路徑不匹配，檢查下一個條件
    }

    // 檢查鎖令牌匹配
    if (condition.tokens && condition.tokens.length > 0) {
      if (condition.tokens.includes(lockToken)) {
        return true; // 找到匹配的令牌
      }
    }
  }

  return false; // 沒有滿足的條件
}

/**
 * 檢查路徑的鎖定狀態並驗證許可權
 * 用於在WebDAV寫操作前進行鎖定檢查
 * @param {Object} lockManager - 鎖定管理器例項
 * @param {string} path - 資源路徑
 * @param {string} ifHeader - If頭的值（可選）
 * @param {string} operation - 操作名稱（用於日誌）
 * @returns {Object|null} 如果有鎖定衝突返回錯誤資訊，否則返回null
 */
export function checkLockPermission(lockManager, path, ifHeader = null, operation = "操作") {
  const lockInfo = lockManager.checkLock(path, ifHeader);
  if (lockInfo) {
    console.log(`${operation}被鎖定阻止 - 路徑: ${path}, 鎖定資訊: ${formatLockInfo(lockInfo)}`);
    return {
      status: 423,
      message: `資源被鎖定: ${formatLockInfo(lockInfo)}`,
      lockToken: lockInfo.token,
      multiStatus: createLockConflictMultiStatus(path, lockInfo),
    };
  }

  return null;
}

/**
 * 建立鎖定衝突的多狀態響應
 * @param {string} path - 資源路徑
 * @param {Object} lockInfo - 鎖定資訊
 * @returns {string} 多狀態XML響應
 */
export function createLockConflictMultiStatus(path, lockInfo) {
  const href = escapeXmlChars(path);
  const lockToken = escapeXmlChars(lockInfo.token);
  const owner = escapeXmlChars(lockInfo.owner);

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:status>HTTP/1.1 423 Locked</D:status>
    <D:error>
      <D:lock-token-submitted>
        <D:href>${lockToken}</D:href>
      </D:lock-token-submitted>
    </D:error>
    <D:responsedescription>Resource is locked by ${owner}</D:responsedescription>
  </D:response>
</D:multistatus>`;
}
