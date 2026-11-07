/**
 * 檔案檢視服務層
 * 負責檔案分享檢視、下載、預覽相關的業務邏輯
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";
import { verifyPassword } from "../utils/crypto.js";
import { getEffectiveMimeType, getContentTypeAndDisposition } from "../utils/fileUtils.js";
import { getFileBySlug, isFileAccessible } from "./fileService.js";
import { ObjectStore } from "../storage/object/ObjectStore.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../storage/streaming/index.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { FILE_TYPES, UserType } from "../constants/index.js";

/**
 * 檔案檢視服務類
 */
export class FileViewService {
  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(db, encryptionSecret, repositoryFactory = null) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
  }

  /**
   * 檢查並刪除過期檔案
   * @param {Object} file - 檔案物件
   */
  async checkAndDeleteExpiredFile(file) {
    try {
      console.log(`開始刪除過期檔案: ${file.id}`);

      // 透過 ObjectStore 按儲存路徑刪除物件
      //
      // 1) “上傳即分享”（share upload / storage-first）：file_path 通常為空，這類過期應刪除真實儲存物件
      // 2) “從檔案系統建立分享”（fs -> share）：file_path 有值，表示引用的是網盤裡的真實檔案
      //    這種場景下“分享過期”只應該刪除分享記錄，不應該刪除真實網盤檔案。
      const shouldDeleteStorageObject = !file.file_path;

      if (shouldDeleteStorageObject && file.storage_path && file.storage_config_id && file.storage_type) {
        try {
          const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
          await objectStore.deleteByStoragePath(file.storage_config_id, file.storage_path, { db: this.db });
          console.log(`已從儲存刪除檔案: ${file.storage_path}`);
        } catch (e) {
        console.warn("刪除儲存物件失敗（已忽略以完成記錄刪除）:", e?.message || e);
        }
      }

      // 從資料庫刪除檔案記錄
      const fileRepository = this.repositoryFactory.getFileRepository();
      await fileRepository.deleteFile(file.id);

      console.log(`已從資料庫刪除檔案記錄: ${file.id}`);
    } catch (error) {
      console.error(`刪除過期檔案失敗 (${file.id}):`, error);
      throw error;
    }
  }

  /**
   * 處理檔案下載請求
   * @param {string} slug - 檔案slug
   * @param {Request} request - 原始請求
   * @param {boolean} forceDownload - 是否強制下載
   * @returns {Promise<Response>} 響應物件
   */
  async handleFileDownload(slug, request, forceDownload = false, options = {}) {
    try {
      // 查詢檔案詳情
      const file = await getFileBySlug(this.db, slug, this.encryptionSecret);

      // 檢查檔案是否存在
      if (!file) {
        return new Response("檔案不存在", { status: 404 });
      }

      // 檢查檔案是否受密碼保護
      if (file.password) {
        // 如果有密碼，檢查URL中是否包含密碼引數
        const url = new URL(request.url);
        const passwordParam = url.searchParams.get("password");

        if (!passwordParam) {
          return new Response("需要密碼訪問此檔案", { status: 401 });
        }

        // 驗證密碼
        const passwordValid = await verifyPassword(passwordParam, file.password);
        if (!passwordValid) {
          return new Response("密碼錯誤", { status: 401 });
        }
      }

      // 檢查檔案是否可訪問
      const accessCheck = await isFileAccessible(this.db, file, this.encryptionSecret);
      if (!accessCheck.accessible) {
        if (accessCheck.reason === "expired") {
          return new Response("檔案已過期", { status: 410 });
        }
        return new Response("檔案不可訪問", { status: 403 });
      }

      // 檔案預覽和下載端點預設不增加訪問計數
      let result = { isExpired: false, file };

      // 如果檔案已到達最大訪問次數限制
      if (result.isExpired) {
        console.log(`檔案(${file.id})已達到最大檢視次數，準備刪除...`);
        try {
          // 使用 FileRepository 再次檢查檔案是否被成功刪除
          const fileRepository = this.repositoryFactory.getFileRepository();

          const fileStillExists = await fileRepository.findById(file.id);
          if (fileStillExists) {
            console.log(`檔案(${file.id})仍然存在，再次嘗試刪除...`);
            await this.checkAndDeleteExpiredFile(result.file);
          }
        } catch (error) {
          console.error(`嘗試再次刪除檔案(${file.id})時出錯:`, error);
        }
        return new Response("檔案已達到最大檢視次數", { status: 410 });
      }

      // 檢查檔案儲存資訊
      if (!result.file.storage_config_id || !result.file.storage_path || !result.file.storage_type) {
        return new Response("檔案儲存資訊不完整", { status: 404 });
      }

      const fileRecord = result.file;
      const useProxyFlag = fileRecord.use_proxy ?? 0;
      const forceProxy = options && options.forceProxy === true;

      // 文字類預覽優先走本地代理，以避免直鏈 CORS 與內容型別差異
      const isInline = !forceDownload;
      const isTextLike =
        fileRecord.type === FILE_TYPES.TEXT ||
        (fileRecord.mimetype && fileRecord.mimetype.startsWith("text/"));

      // 抽取本地代理下載邏輯，便於在直鏈失敗時複用
      // 使用 StorageStreaming 層統一處理
      const proxyDownload = async () => {
        const parseOwnerFromCreatedBy = (createdBy) => {
          const raw = typeof createdBy === "string" ? createdBy.trim() : "";
          if (!raw || raw === "anonymous") return null;
          if (raw.startsWith("apikey:")) {
            const id = raw.slice("apikey:".length).trim();
            if (!id) return null;
            return { ownerType: UserType.API_KEY, ownerId: id };
          }
          // 預設視為 admin 建立的分享
          return { ownerType: UserType.ADMIN, ownerId: raw };
        };

        const owner = parseOwnerFromCreatedBy(fileRecord.created_by);

        // 處理 Range 請求
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader) {
          console.log(`分享下載 - 代理 Range 請求: ${rangeHeader}`);
        }

        // 使用 StorageStreaming 層統一處理內容訪問
        const streaming = new StorageStreaming({
          mountManager: null, // 儲存路徑模式不需要 mountManager
          storageFactory: StorageFactory,
          encryptionSecret: this.encryptionSecret,
        });

        const response = await streaming.createResponse({
          path: fileRecord.storage_path,
          channel: STREAMING_CHANNELS.SHARE,
          storageConfigId: fileRecord.storage_config_id,
          rangeHeader,
          request,
          db: this.db,
          repositoryFactory: this.repositoryFactory,
          ...(owner ? owner : null),
        });

        // 基於檔案記錄重新計算 Content-Type / Content-Disposition，保持分享層一致性
        const { contentType: finalContentType, contentDisposition } = getContentTypeAndDisposition(
          fileRecord.filename,
          fileRecord.mimetype,
          { forceDownload }
        );

        // 更新響應頭
        response.headers.set("Content-Type", finalContentType);
        response.headers.set("Content-Disposition", contentDisposition);

        // 設定CORS頭部
        response.headers.set("Access-Control-Allow-Origin", "*");
        response.headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Range, Content-Type");
        response.headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

        return response;
      };

      // forceProxy=true 時，強制只走本地代理（share 的 /api/s 與 /api/share/content）
      if (forceProxy) {
        return await proxyDownload();
      }

      // 文字類 inline 預覽，無論 use_proxy 配置如何，都優先走本地代理訪問
      if (isInline && isTextLike) {
        return await proxyDownload();
      }

      // use_proxy = 1 時，走本地代理訪問
      if (useProxyFlag === 1) {
        return await proxyDownload();
      }

      // use_proxy != 1 時，優先嚐試直鏈：S3 custom_host 優先，其次驅動 DirectLink 能力（例如預簽名 URL）
      let directUrl = null;
      try {
        const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
        const links = await objectStore.generateLinksByStoragePath(fileRecord.storage_config_id, fileRecord.storage_path, {
          forceDownload,
        });
        directUrl = links?.download?.url || links?.preview?.url || null;
      } catch (e) {
        console.error("生成儲存直鏈失敗:", e);
      }

      if (directUrl) {
        const redirectHeaders = new Headers();
        redirectHeaders.set("Location", directUrl);

        return new Response(null, {
          status: 302,
          headers: redirectHeaders,
        });
      }

      // 直鏈不可用時回退為本地代理訪問，避免 501，保證“反代訪問”場景下始終可用
      return await proxyDownload();
    } catch (error) {
      console.error("代理檔案下載出錯:", error);
      return new Response("獲取檔案失敗: " + error.message, { status: 500 });
    }
  }
}

// 匯出便捷函式供路由使用
export async function handleFileDownload(
  slug,
  db,
  encryptionSecret,
  request,
  forceDownload = false,
  repositoryFactory = null,
  options = {},
) {
  const service = new FileViewService(db, encryptionSecret, repositoryFactory);
  return service.handleFileDownload(slug, request, forceDownload, options);
}

export async function checkAndDeleteExpiredFile(db, file, encryptionSecret, repositoryFactory = null) {
  const service = new FileViewService(db, encryptionSecret, repositoryFactory);
  return await service.checkAndDeleteExpiredFile(file);
}
