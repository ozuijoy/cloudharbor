import { withWebDAVErrorHandling } from "../utils/errorUtils.js";
/**
 * 處理 WebDAV PROPPATCH 請求
 * "允許所有屬性"的簡單響應，客戶端相容性
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string|Object} userId - 使用者ID或資訊
 * @param {string} userType - 使用者型別
 * @param {D1Database} db - 資料庫例項
 * @returns {Response} HTTP響應
 */
export async function handleProppatch(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("PROPPATCH", async () => {
    console.log(`WebDAV PROPPATCH 請求 - 路徑: ${path} (相容性實現)`);

    // 獲取請求體
    const requestBody = await c.req.text();
    console.log(`PROPPATCH 請求體:`, requestBody);

    // 解析請求體中的屬性
    let properties = [];
    try {
      // 簡單的XML解析，提取所有要設定的屬性
      const setMatches = requestBody.match(/<D:set[^>]*>(.*?)<\/D:set>/gs);
      if (setMatches) {
        for (const setMatch of setMatches) {
          const propMatches = setMatch.match(/<D:prop[^>]*>(.*?)<\/D:prop>/gs);
          if (propMatches) {
            for (const propMatch of propMatches) {
              // 提取屬性元素
              const propertyMatches = propMatch.match(/<([^>\/\s]+)[^>]*>/g);
              if (propertyMatches) {
                for (const propertyMatch of propertyMatches) {
                  if (!propertyMatch.includes("D:prop")) {
                    const propertyName = propertyMatch.match(/<([^>\s\/]+)/)[1];
                    properties.push(propertyName);
                  }
                }
              }
            }
          }
        }
      }
    } catch (parseError) {
      console.warn(`PROPPATCH XML解析警告:`, parseError.message);
    }

    console.log(`PROPPATCH 提取的屬性:`, properties);

    // 構建成功的207 Multi-Status響應
    const href = `/dav${path}`;

    let responseXml;
    if (properties.length > 0) {
      // 為每個屬性構建成功的propstat
      const propstatElements = properties
        .map((prop) => {
          return `      <D:propstat>
        <D:prop><${prop}/></D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>`;
        })
        .join("\n");

      responseXml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
${propstatElements}
  </D:response>
</D:multistatus>`;
    } else {
      // 沒有屬性時的簡單成功響應
      responseXml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    }
    return new Response(responseXml, {
      status: 207, // Multi-Status
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Length": responseXml.length.toString(),
      },
    });
  }, { includeDetails: false });
}
