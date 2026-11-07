/**
 * Cloudflare Pages中介軟體
 * 用於在執行時動態替換配置檔案中的環境變數
 */
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 只處理對config.js的請求
  if (url.pathname === "/config.js") {
    // 獲取原始的配置檔案
    const response = await next();
    const originalText = await response.text();

    // 替換佔位符為實際的環境變數值
    // 如果環境變數不存在，則使用預設的開發環境URL
    const backendUrl = env.VITE_BACKEND_URL || "http://localhost:8787";
    const modifiedText = originalText.replace("__BACKEND_URL__", backendUrl);

    // 返回修改後的配置檔案
    return new Response(modifiedText, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }

  // 對於其他請求，正常處理
  return next();
}
