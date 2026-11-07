import {
  listSharedFiles,
  getSharedFileById,
  getSharedFileBySlug,
  buildDownloadUrl as gatewayBuildDownloadUrl,
  buildPreviewUrl as gatewayBuildPreviewUrl,
  buildContentUrl as gatewayBuildContentUrl,
  getOfficePreviewUrl as gatewayGetOfficePreviewUrl,
} from "@/api/services/fileGateway.js";
import {
  updateFile as apiUpdateFile,
  batchDeleteFiles as apiBatchDeleteFiles,
  verifyFilePassword as apiVerifyFilePassword,
} from "@/api/services/fileService.js";

/** @typedef {import("@/types/fileshare").FileshareItem} FileshareItem */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * Fileshare 服務
 *
 * - 基於 fileGateway / fileService 提供的 API 做統一封裝
 * - 統一列表、詳情、URL 構建、刪除、密碼驗證等能力
 */
export function useFileshareService() {
  /**
   * 獲取檔案分享列表
   *
   * @param {{limit?:number,offset?:number,search?:string}} [options]
   * @returns {Promise<{files: FileshareItem[], pagination: PaginationInfo}>}
   */
  const fetchList = async ({ limit, offset, search } = {}) => {
    const listOptions = {};
    if (search && search.trim().length > 0) {
      listOptions.search = search.trim();
    }
    const result = await listSharedFiles(limit, offset, listOptions);
    return /** @type {{files: FileshareItem[], pagination: PaginationInfo}} */ (result);
  };

  /**
   * 根據 id 獲取檔案分享詳情
   * @param {number|string} id
   * @returns {Promise<FileshareItem>}
   */
  const fetchById = async (id, options = {}) => {
    if (!id) {
      throw new Error("缺少檔案 ID");
    }
    return /** @type {FileshareItem} */ (await getSharedFileById(id, options));
  };

  /**
   * 根據 slug 獲取檔案分享詳情
   * @param {string} slug
   * @returns {Promise<FileshareItem>}
   */
  const fetchBySlug = async (slug) => {
    if (!slug) {
      throw new Error("缺少檔案 slug");
    }
    return /** @type {FileshareItem} */ (await getSharedFileBySlug(slug));
  };

  /**
   * 獲取永久下載 URL
   * @param {FileshareItem} file
   * @returns {string}
   */
  const getPermanentDownloadUrl = (file) => {
    if (!file || !file.slug) return "";
    return gatewayBuildDownloadUrl(file);
  };

  /**
   * 獲取永久預覽 URL
   * @param {FileshareItem} file
   * @returns {string}
   */
  const getPermanentPreviewUrl = (file) => {
    if (!file || !file.slug) return "";
    return gatewayBuildPreviewUrl(file);
  };

  /**
   * 獲取用於“內容訪問”的 URL（文字類預覽使用）
   * - 始終透過 share 內容路由 /api/share/content/:slug 訪問
   * @param {FileshareItem} file
   * @returns {string}
   */
  const getPermanentContentUrl = (file) => {
    if (!file || !file.slug) return "";
    return gatewayBuildContentUrl(file);
  };

  /**
   * 獲取 Office 預覽 URL
   * @param {FileshareItem} file
   * @param {{provider?: "microsoft"|"google", returnAll?: boolean}} [options]
   * @returns {Promise<any>}
   */
  const getOfficePreviewUrl = async (file, options = {}) => {
    return gatewayGetOfficePreviewUrl(file, {
      provider: options.provider || "microsoft",
      returnAll: options.returnAll || false,
    });
  };

  /**
   * 構建前端訪問的分享頁 URL（/file/:slug）
   *
   * @param {FileshareItem} file
   * @param {string} [origin]
   * @returns {string}
   */
  const buildShareUrl = (file, origin) => {
    if (!file || !file.slug) return "";
    const base =
      typeof origin === "string" && origin.length
        ? origin
        : typeof window !== "undefined"
        ? window.location.origin
        : "";
    if (!base) return `/file/${file.slug}`;
    const normalized = base.replace(/\/+$/, "");
    return `${normalized}/file/${file.slug}`;
  };

  /**
   * 更新檔案後設資料（備註、最大訪問次數、過期時間等）
   * @param {number|string} fileId
   * @param {Partial<FileshareItem>} metadata
   * @returns {Promise<true|FileshareItem>}
   */
  const updateFileMetadata = async (fileId, metadata) => {
    if (!fileId) {
      throw new Error("缺少檔案 ID");
    }
    const resp = await apiUpdateFile(fileId, metadata);
    if (resp && typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新檔案資訊失敗");
      }
      return resp.data ?? true;
    }
    return true;
  };

  /**
   * 批次刪除檔案（admin/public 共用）
   * @param {Array<number|string>} ids
   * @param {string} deleteMode
   * @returns {Promise<any>}
   */
  const deleteFiles = async (ids, deleteMode) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("缺少要刪除的檔案 ID 列表");
    }
    const resp = await apiBatchDeleteFiles(ids, deleteMode);
    if (!resp) {
      throw new Error("刪除檔案失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刪除檔案失敗");
      }
    }
    return resp;
  };

  /**
   * 驗證受密碼保護的檔案分享
   * @param {string} slug
   * @param {string} password
   * @returns {Promise<boolean|any>}
   */
  const verifyFilePassword = async (slug, password) => {
    if (!slug || !password) {
      throw new Error("缺少檔案標識或密碼");
    }
    const resp = await apiVerifyFilePassword(slug, password);
    if (!resp) {
      throw new Error("驗證檔案密碼失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "驗證檔案密碼失敗");
      }
      return resp.data ?? true;
    }
    return resp;
  };

  return {
    fetchList,
    fetchById,
    fetchBySlug,
    getPermanentDownloadUrl,
    getPermanentPreviewUrl,
    getPermanentContentUrl,
    getOfficePreviewUrl,
    buildShareUrl,
    updateFileMetadata,
    deleteFiles,
    verifyFilePassword,
  };
}
