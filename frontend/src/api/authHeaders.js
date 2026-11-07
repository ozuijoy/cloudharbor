/**
 * 統一的認證請求頭構造工具
 * 基於 authBridge 的快照生成 Authorization 頭
 */

import { getAuthSnapshot } from "@/stores/authBridge.js";

/**
 * 根據當前認證狀態構造帶 Authorization 的 headers
 * 如果 baseHeaders 已提供 Authorization，則不會覆蓋
 * @param {Object} baseHeaders
 * @returns {Object}
 */
export function buildAuthHeaders(baseHeaders = {}) {
  // 呼叫方已明確設定 Authorization，尊重呼叫方
  if (baseHeaders.Authorization) {
    return baseHeaders;
  }

  const headers = { ...baseHeaders };
  const authState = getAuthSnapshot();

  // 只要 bridge 中存在有效的認證憑據，就注入到請求頭中
  if (authState) {
    if (authState.authType === "admin" && authState.adminToken) {
      headers.Authorization = `Bearer ${authState.adminToken}`;
    } else if (authState.authType === "apikey" && authState.apiKey) {
      headers.Authorization = `ApiKey ${authState.apiKey}`;
    }
  }

  return headers;
}
