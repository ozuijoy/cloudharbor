/**
 * 直鏈能力模組
 *
 * 定義儲存驅動生成"可直接對外訪問 URL"的能力檢測
 * - 對於 S3 等物件儲存：通常表現為預簽名 URL
 * - 對於有 custom_host 的儲存：可以是 custom_host 直鏈
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isDirectLinkCapable() 檢測：
 *
 * - generateDownloadUrl(subPath, ctx): Promise<Object>
 *   生成下載直鏈，返回物件必須包含：
 *   - url: 最終可供瀏覽器/客戶端使用的直鏈
 *   - type: 直鏈型別標記（例如 "custom_host" | "native_direct"）
 *   其餘欄位（expiresIn/expiresAt 等）為可選擴充套件
 *
 * 可選擴充套件方法（由具體使用場景在呼叫前自行做 typeof 檢查）：
 * - generateUploadUrl(subPath, ctx): 生成預簽名上傳 URL（直傳）
 * - handleUploadComplete(subPath, ctx): 預簽名上傳完成後的後端對齊/登記（少數驅動需要）
 * - generatePresignedUrl(subPath, operation, ctx): 通用預簽名 URL 生成
 */

/**
 * 檢查物件是否實現了 DirectLink 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備直鏈能力
 */
export function isDirectLinkCapable(obj) {
  // 最小判斷標準：存在 generateDownloadUrl 方法即可
  // 上傳相關方法為可選擴充套件能力
  return obj && typeof obj.generateDownloadUrl === "function";
}

/**
 * DirectLink 能力的識別符號
 */
export const DIRECT_LINK_CAPABILITY = "DirectLinkCapable";
