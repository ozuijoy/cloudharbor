// Paste URL 代理：為瀏覽器側資源拉取提供短期票據（Query Ticket）
// - 票據只用於“允許 useProxy 在無 Authorization Header 的場景工作”
// - 票據本身不攜帶許可權含義：簽發時必須走許可權校驗（見 protected routes）

export const PASTE_URL_PROXY_TICKET_PATH = "/paste/url/proxy";
export const PASTE_URL_PROXY_TICKET_EXPIRES_IN_SECONDS = 5 * 60;

