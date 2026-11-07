/**
 * 分片上傳能力模組
 *
 * 定義儲存驅動的「前端驅動分片上傳」能力檢測，用於大檔案上傳與斷點續傳。
 *
 * ========== 契約要求==========
 *
 * 驅動只要實現以下方法，即視為具備 MULTIPART 能力：
 *
 * - initializeFrontendMultipartUpload(subPath, options): Promise<InitResult>
 *
 * - completeFrontendMultipartUpload(subPath, options): Promise<CompleteResult>
 *   完成前端分片上傳（合併分片或確認最終物件就緒），至少返回：
 *   {
 *     success: boolean,
 *     storagePath?: string,
 *     message?: string,
 *     // 可附帶 etag/publicUrl/driver 原始響應等除錯欄位
 *   }
 *
 * - abortFrontendMultipartUpload(subPath, options): Promise<Object>
 *   取消前端分片上傳，清理已上傳的分片或關閉後端會話。
 *
 * - listMultipartUploads(subPath, options): Promise<Object>
 *   列出進行中的分片上傳任務（用於斷點續傳 UI），返回結構由驅動自定義。
 *
 * - listMultipartParts(subPath, uploadId, options): Promise<Object>
 *   列出指定上傳任務的已上傳分片，用於恢復進度與前端校驗。
 *
 * - signMultipartParts(subPath, uploadId, partNumbers, options): Promise<Object>
 *   根據策略獲取/重新整理“上傳所需引數”（統一入口）：
 *   - 對於 per_part_url 策略：通常返回新的預簽名 URL 列表；
 *   - 對於 single_session 策略：可以返回新的 session 資訊，或作為 no-op（前端不呼叫）。
 *
 * - per_part_url 場景下，瀏覽器直傳到上游，後端通常拿不到每片上傳響應（例如 ETag）。
 *   “分片賬本（parts ledger）”的來源由 policy 決定：
 *   - server_can_list：後端可以回源列出已上傳分片（S3/R2 等，有上游憑證）
 *   - client_keeps：後端無法回源列出分片，客戶端必須在本地儲存 parts 賬本，並在 complete 時一次性提交（HuggingFace）
 *   - server_records：後端自己維護 parts/進度資訊（通常是 single_session 或後端中轉場景）
 * 
 * - 本模組只約束「方法集合」與 InitResult/CompleteResult 的基本欄位約定；
 *   具體協議（S3 多分片 / OneDrive uploadSession / 其他雲端儲存）由各驅動自行實現。
 * - FileSystem 與前端只應依賴這些公共欄位和 strategy
 */

/**
 * 檢查物件是否實現了 Multipart 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備前端分片上傳能力
 */
export function isMultipartCapable(obj) {
  return (
    obj &&
    typeof obj.initializeFrontendMultipartUpload === "function" &&
    typeof obj.completeFrontendMultipartUpload === "function" &&
    typeof obj.abortFrontendMultipartUpload === "function" &&
    typeof obj.listMultipartUploads === "function" &&
    typeof obj.listMultipartParts === "function" &&
    typeof obj.signMultipartParts === "function"
  );
}

/**
 * Multipart 能力的識別符號
 */
export const MULTIPART_CAPABILITY = "MultipartCapable";
