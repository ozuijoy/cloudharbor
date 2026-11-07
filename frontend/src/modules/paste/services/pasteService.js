import { api } from "@/api";
import { useAuthStore } from "@/stores/authStore.js";

/** @typedef {import("@/types/paste").Paste} Paste */
/** @typedef {import("@/types/paste").PasteListResponse} PasteListResponse */
/** @typedef {import("@/types/paste").PasteUpdatePayload} PasteUpdatePayload */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * Paste 領域 service
 *
 * - 統一封裝文字分享相關 API
 * - 根據當前認證狀態選擇 admin / user / apikey 路徑
 *
 * 約定：
 * - 成功時返回乾淨的領域資料（Paste / { items, pagination } / true / string）
 * - 失敗時丟擲 Error(message)，上層由 toast / error block 處理
 */
export function usePasteService() {
  const authStore = useAuthStore();

  const isAdmin = () => authStore.isAdmin;
  const isApiKeyManager = () => authStore.authType === "apikey" && authStore.hasTextManagePermission;
  const isApiKeyCreator = () => authStore.isKeyUser && authStore.hasTextSharePermission;

  const ensureCanManage = () => {
    if (!isAdmin() && !isApiKeyManager()) {
      throw new Error("當前賬號無權管理文字資料");
    }
  };

  const ensureCanCreate = () => {
    if (!isAdmin() && !isApiKeyCreator()) {
      throw new Error("當前賬號無權建立文字分享");
    }
  };

  /**
   * 列表查詢（offset 模式）
   * @param {{limit?:number,offset?:number,search?:string}} [params]
   * @returns {Promise<PasteListResponse>}
   */
  const getPastes = async ({ limit = 20, offset = 0, search } = {}) => {
    ensureCanManage();

    const options = {};
    if (search && search.trim()) {
      options.search = search.trim();
    }

    // 當前 admin 與 API Key 文字使用者統一走 /api/pastes endpoint
    const resp = await api.paste.getPastes(null, limit, offset, options);
    if (!resp || typeof resp !== "object" || resp.success !== true) {
      const message = resp && typeof resp === "object" && "message" in resp ? resp.message : null;
      throw new Error(message || "獲取文字列表失敗");
    }

    const payload = resp.data || {};
    const items = Array.isArray(payload.results) ? payload.results : [];
    const pagination = payload.pagination || {};

    /** @type {PaginationInfo} */
    const finalPagination = {
      total: typeof pagination.total === "number" ? pagination.total : items.length,
      limit: typeof pagination.limit === "number" ? pagination.limit : limit,
      offset: typeof pagination.offset === "number" ? pagination.offset : offset,
      hasMore: typeof pagination.hasMore === "boolean" ? pagination.hasMore : undefined,
    };

    return /** @type {PasteListResponse} */ ({
      items,
      pagination: finalPagination,
    });
  };

  /**
   * 根據 ID 獲取單條文字（僅 admin / apikey）
   * @param {string|number} id
   * @returns {Promise<Paste>}
   */
  const getPasteById = async (id) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.getPasteById(id) : await api.user.paste.getPasteById(id);
    if (!resp) {
      throw new Error("獲取文字詳情失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取文字詳情失敗");
      }
      return /** @type {Paste} */ (resp.data ?? resp);
    }

    return /** @type {Paste} */ (resp);
  };

  /**
   * 更新文字（僅 admin / apikey）
   * @param {string} slug
   * @param {PasteUpdatePayload} data
   * @returns {Promise<Paste|true>}
   */
  const updatePaste = async (slug, data) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.updatePaste(slug, data) : await api.user.paste.updatePaste(slug, data);
    if (!resp) {
      throw new Error("更新文字失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新文字失敗");
      }
      return resp.data ?? true;
    }

    return resp;
  };

  /**
   * 刪除單條文字（內部透過批次刪除介面完成）
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteSinglePaste = async (id) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.batchDeletePastes([id]) : await api.user.paste.batchDeletePastes([id]);
    if (!resp) {
      throw new Error("刪除文字失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刪除文字失敗");
      }
    }

    return true;
  };

  /**
   * 批次刪除文字
   * @param {Array<string|number>} ids
   * @returns {Promise<true>}
   */
  const deletePastes = async (ids) => {
    ensureCanManage();
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("缺少待刪除文字 ID 列表");
    }
    const resp = isAdmin() ? await api.admin.batchDeletePastes(ids) : await api.user.paste.batchDeletePastes(ids);
    if (!resp) {
      throw new Error("批次刪除文字失敗");
    }
    if (typeof resp === "object" && "success" in resp && !resp.success) {
      throw new Error(resp.message || "批次刪除文字失敗");
    }
    return true;
  };

  /**
   * 清理已過期文字（僅 admin）
   * @returns {Promise<string>} 成功資訊
   */
  const clearExpiredPastes = async () => {
    if (!isAdmin()) {
      throw new Error("僅管理員可以清理過期文字");
    }
    const resp = await api.system.clearExpiredPastes();
    if (!resp) {
      throw new Error("清理過期文字失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "清理過期文字失敗");
      }
      return resp.message || "已清理過期文字";
    }
    return "已清理過期文字";
  };

  /**
   * 根據 slug 獲取文字詳情（公共訪問，支援密碼）
   * @param {string} slug
   * @param {string|null} [password]
   * @returns {Promise<Paste>}
   */
  const getPasteBySlug = async (slug, password = null) => {
    const resp = await api.paste.getPaste(slug, password);
    if (!resp) {
      throw new Error("獲取文字詳情失敗");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取文字詳情失敗");
      }
      return /** @type {Paste} */ (resp.data ?? resp);
    }

    return /** @type {Paste} */ (resp);
  };

  /**
   * 建立新的文字（Markdown 編輯頁使用）
   * @param {Partial<PasteUpdatePayload> & { title?: string | null; is_public?: boolean }} data
   * @returns {Promise<string>} 新建立的 slug
   */
  const createPaste = async (data) => {
    ensureCanCreate();
    const resp = await api.paste.createPaste(data);
    if (!resp) {
      throw new Error("建立文字失敗");
    }

    let slug = null;

    if (typeof resp === "object") {
      if ("success" in resp || "code" in resp) {
        if (resp.success && resp.data && resp.data.slug) {
          slug = resp.data.slug;
        } else {
          throw new Error(resp.message || "建立文字失敗");
        }
      } else if (resp.slug) {
        slug = resp.slug;
      } else {
        const candidates = ["id", "key", "identifier"];
        for (const field of candidates) {
          if (resp[field]) {
            slug = resp[field];
            break;
          }
        }
      }
    }

    if (!slug) {
      throw new Error("建立文字失敗：未能獲取到標識");
    }

    return slug;
  };

  /**
   * 獲取原始文字直鏈
   * @param {string} slug
   * @param {string|null} [password]
   * @returns {string}
   */
  const getRawPasteUrl = (slug, password = null) => {
    return api.paste.getRawPasteUrl(slug, password);
  };

  /**
   * 獲取 Markdown 渲染相關配置（系統設定組）
   * @returns {Promise<Array<{key:string,value:string}>>}
   */
  const getMarkdownSettings = async () => {
    const resp = await api.system.getSettingsByGroup(4, false);
    if (!resp) {
      throw new Error("獲取 Markdown 設定失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "獲取 Markdown 設定失敗");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }
    return Array.isArray(resp) ? resp : [];
  };

  return {
    getPastes,
    getPasteById,
    updatePaste,
    deleteSinglePaste,
    deletePastes,
    clearExpiredPastes,
    getPasteBySlug,
    createPaste,
    getRawPasteUrl,
    getMarkdownSettings,
  };
}
