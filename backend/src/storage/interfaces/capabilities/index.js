/**
 * 儲存驅動能力介面統一匯出
 * 模組化能力介面
 */

import { ValidationError } from "../../../http/errors.js";

// 基礎驅動介面
export { BaseDriver } from "./BaseDriver.js";

// 能力介面（僅匯出檢測函式和識別符號，具體實現由各驅動提供）
export { isReaderCapable, READER_CAPABILITY } from "./ReaderCapable.js";
export { isWriterCapable, WRITER_CAPABILITY } from "./WriterCapable.js";
export { isDirectLinkCapable, DIRECT_LINK_CAPABILITY } from "./DirectLinkCapable.js";
export { isMultipartCapable, MULTIPART_CAPABILITY } from "./MultipartCapable.js";
export { isAtomicCapable, ATOMIC_CAPABILITY } from "./AtomicCapable.js";
export { isProxyCapable, PROXY_CAPABILITY } from "./ProxyCapable.js";
export { isPagedListCapable, PAGED_LIST_CAPABILITY } from "./PagedListCapable.js";

// 匯入檢查函式用於內部使用
import { isReaderCapable } from "./ReaderCapable.js";
import { isWriterCapable } from "./WriterCapable.js";
import { isDirectLinkCapable } from "./DirectLinkCapable.js";
import { isMultipartCapable } from "./MultipartCapable.js";
import { isAtomicCapable } from "./AtomicCapable.js";
import { isProxyCapable } from "./ProxyCapable.js";
import { isPagedListCapable } from "./PagedListCapable.js";

/**
 * 所有可用的能力識別符號
 */
export const CAPABILITIES = {
  READER: "ReaderCapable",
  WRITER: "WriterCapable",
  DIRECT_LINK: "DirectLinkCapable",
  MULTIPART: "MultipartCapable",
  ATOMIC: "AtomicCapable",
  PROXY: "ProxyCapable",
  PAGED_LIST: "PagedListCapable",
};

/**
 * 所有驅動必須實現的基礎契約
 * - StorageFactory 在例項化後會統一校驗
 */
export const BASE_REQUIRED_METHODS = ["stat", "exists"];


/**
 * 能力對應的最小方法契約對映表
 * - 該表用於在執行時對驅動進行契約校驗（例如 StorageFactory.validateDriverContract）
 * - 每個能力列出的方法名必須在驅動例項上存在且為 function，才視為滿足該能力的"最小實現"
 *
 * 約定說明：
 * - READER: 面向所有需要"讀取"能力的場景（FS Web / Share / WebDAV 等），必須能夠列目錄、獲取檔案資訊以及下載檔案。
 *   StreamHandle 結構：{ stream: NodeReadable | ReadableStream, close(): Promise<void> }
 * - WRITER: 面向"寫入/修改"能力，涵蓋上傳、建目錄、重新命名、批次刪除/複製等基本操作。
 * - DIRECT_LINK: 最小要求是能夠生成下載直鏈 generateDownloadUrl；
 *   - 對於 S3 等物件儲存，通常還會額外實現 generateUploadUrl / generatePresignedUrl，用於預簽名上傳；
 *   - 對於 WebDAV 等僅支援下載直鏈的驅動，可以只實現 generateDownloadUrl 即可，不強制要求上傳相關方法。
 * - PROXY: 要求實現 generateProxyUrl，返回可供應用層直接 302 或 fetch 的代理 URL。
 * - MULTIPART: 對應前端分片上傳生命週期的完整方法集合。
 */
export const REQUIRED_METHODS_BY_CAPABILITY = {
  [CAPABILITIES.READER]: ["listDirectory", "getFileInfo", "downloadFile"],
  [CAPABILITIES.WRITER]: [
    "uploadFile",
    "createDirectory",
    "renameItem",
    "batchRemoveItems",
    "copyItem",
  ],
  /**
   * DIRECT_LINK 能力：
   * - 最小要求：generateDownloadUrl
   * - 擴充套件能力（可選）：generateUploadUrl / generatePresignedUrl
   *   這些方法通常只在支援預簽名上傳的驅動（如 S3/R2）上實現；
   *   WebDAV 之類只實現下載直鏈的驅動，只要提供 generateDownloadUrl 即可透過契約校驗。
   */
  [CAPABILITIES.DIRECT_LINK]: ["generateDownloadUrl"],
  [CAPABILITIES.PROXY]: ["generateProxyUrl"],
  [CAPABILITIES.MULTIPART]: [
    "initializeFrontendMultipartUpload",
    "completeFrontendMultipartUpload",
    "abortFrontendMultipartUpload",
    "listMultipartUploads",
    "listMultipartParts",
    "signMultipartParts",
  ],
  /**
   * ATOMIC 能力：
   * - 最小要求：renameItem / copyItem
   * - 這些方法保證原子性操作（重新命名、複製）
   */
  [CAPABILITIES.ATOMIC]: ["renameItem", "copyItem"],
  /**
   * PAGED_LIST 能力：
   * - 最小要求：supportsDirectoryPagination()
   * - listDirectory 的分頁引數約定由各驅動自行實現（通常透過 options.paged/cursor/limit）
   */
  [CAPABILITIES.PAGED_LIST]: ["supportsDirectoryPagination"],
};


/**
 * 能力檢查函式對映
 */
export const CAPABILITY_CHECKERS = {
  [CAPABILITIES.READER]: isReaderCapable,
  [CAPABILITIES.WRITER]: isWriterCapable,
  [CAPABILITIES.DIRECT_LINK]: isDirectLinkCapable,
  [CAPABILITIES.MULTIPART]: isMultipartCapable,
  [CAPABILITIES.ATOMIC]: isAtomicCapable,
  [CAPABILITIES.PROXY]: isProxyCapable,
  [CAPABILITIES.PAGED_LIST]: isPagedListCapable,
};

/**
 * 檢查物件是否支援指定能力
 * @param {Object} obj - 要檢查的物件
 * @param {string} capability - 能力名稱
 * @returns {boolean} 是否支援該能力
 */
export function hasCapability(obj, capability) {
  const checker = CAPABILITY_CHECKERS[capability];
  if (!checker) {
    throw new ValidationError(`未知的能力型別: ${capability}`);
  }
  return checker(obj);
}

/**
 * 獲取物件支援的所有能力
 * @param {Object} obj - 要檢查的物件
 * @returns {Array<string>} 支援的能力列表
 */
export function getObjectCapabilities(obj) {
  const capabilities = [];

  for (const [capability, checker] of Object.entries(CAPABILITY_CHECKERS)) {
    if (checker(obj)) {
      capabilities.push(capability);
    }
  }

  return capabilities;
}

/**
 * 驗證物件是否實現了所需的能力
 * @param {Object} obj - 要驗證的物件
 * @param {Array<string>} requiredCapabilities - 所需的能力列表
 * @returns {Object} 驗證結果
 */
export function validateCapabilities(obj, requiredCapabilities) {
  const supportedCapabilities = getObjectCapabilities(obj);
  const missingCapabilities = requiredCapabilities.filter((capability) => !supportedCapabilities.includes(capability));

  return {
    isValid: missingCapabilities.length === 0,
    supportedCapabilities,
    missingCapabilities,
    requiredCapabilities,
  };
}

/**
 * 能力介面的混入工具
 * 用於將多個能力介面混入到一個類中
 * @param {Function} BaseClass - 基礎類
 * @param {...Function} capabilities - 能力介面類
 * @returns {Function} 混入後的類
 */
export function mixinCapabilities(BaseClass, ...capabilities) {
  class MixedClass extends BaseClass {}

  // 混入所有能力介面的方法
  for (const Capability of capabilities) {
    const proto = Capability.prototype;
    const propertyNames = Object.getOwnPropertyNames(proto);

    for (const name of propertyNames) {
      if (name !== "constructor") {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor) {
          Object.defineProperty(MixedClass.prototype, name, descriptor);
        }
      }
    }
  }

  return MixedClass;
}
