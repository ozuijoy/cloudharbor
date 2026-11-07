import { getAuthSnapshot, logoutViaBridge } from "@/stores/authBridge.js";
import { buildAuthHeaders } from "@/api/authHeaders.js";

/**
 * Security 模組入口
 *
 * - 提供統一的認證快照訪問（基於 authBridge）
 * - 暴露構造 Authorization 頭的工具，供 driver / API client 使用
 */

export { getAuthSnapshot, logoutViaBridge, buildAuthHeaders };

/**
 * 基於當前認證狀態構造帶 Authorization 的請求頭
 * - 如果 baseHeaders 已包含 Authorization，則不會覆蓋
 */
export function buildAuthHeadersForRequest(baseHeaders = {}) {
  return buildAuthHeaders(baseHeaders);
}

