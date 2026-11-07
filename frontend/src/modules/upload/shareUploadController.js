import { ref } from "vue";
import { useUploaderClient } from "@/modules/storage-core/index.js";

/**
 * Share 上傳領域控制器
 *
 * 統一管理基於 Uppy 的分享上傳會話（Share / URL），
 * 將對 useUploaderClient / driver 的直接依賴集中在 modules 層。
 *
 * - 建立 / 記錄當前活躍的上傳會話
 * - 提供統一的銷燬 / 取消入口
 *
 * 不負責：
 * - UI 提示與文案（交給元件）
 * - 佇列狀態與錯誤彙總（交給呼叫方或上層 service）
 */
export function useShareUploadController() {
  const uploaderClient = useUploaderClient();

  const activeShareSession = ref(null);
  const activeUrlSession = ref(null);

  const disposeGenericSession = (sessionRef, { cancel = false } = {}) => {
    const session = sessionRef.value;
    if (!session) return;

    if (cancel) {
      try {
        session.cancel?.();
      } catch {
        // ignore cancel error
      }
    }

    try {
      session.destroy?.();
    } catch {
      // ignore destroy error
    }

    sessionRef.value = null;
  };

  const disposeShareSession = (options = {}) => {
    disposeGenericSession(activeShareSession, options);
  };

  const disposeUrlSession = (options = {}) => {
    disposeGenericSession(activeUrlSession, options);
  };

  /**
   * 建立分享上傳會話（Share Upload）。
   *
   * 呼叫方負責：
   * - session.addFiles(...)
   * - await session.start()
   * - 使用 events 處理進度與結果
   */
  const createShareSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeShareSession();

    const session = uploaderClient.createShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
    });

    activeShareSession.value = session;
    return session;
  };

  /**
   * 建立基於 /share/upload 的直傳分享會話（多儲存通用）。
   * shareMode: 'stream' | 'form' | 'multipart'（前端內部使用）
   */
  const createDirectShareSession = ({ payload, events, uppyOptions, uppy, shareMode } = {}) => {
    disposeShareSession();

    const session = uploaderClient.createDirectShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
      shareMode,
    });

    activeShareSession.value = session;
    return session;
  };

  /**
   * 建立 URL 上傳會話（Url Upload）。
   *
   * 與 Share 類似，呼叫方負責 addFiles / start。
   */
  const createUrlSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeUrlSession();

    const session = uploaderClient.createUrlUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
    });

    activeUrlSession.value = session;
    return session;
  };

  /**
   * 建立基於 /share/upload 的 URL 直傳分享會話（與檔案直傳共享同一底層實現）。
   * URL 上傳僅使用流式模式，shareMode 固定為 'stream'。
   */
  const createUrlDirectSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeUrlSession();

    const session = uploaderClient.createDirectShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
      shareMode: "stream",
    });

    activeUrlSession.value = session;
    return session;
  };

  /**
   * 建立 FS 上傳會話（用於掛載瀏覽器上傳彈窗）
   *
   * 這是對 useUploaderClient.createFsUploadSession 的領域包裝，
   * 目的是讓 UI 不再直接依賴 uploaderClient 與 driver。
   */
  const createFsUploadSession = ({ storageConfigId, fsOptions = {}, events, uppyOptions, uppy } = {}) => {
    return uploaderClient.createFsUploadSession({
      storageConfigId,
      fsOptions,
      events,
      uppyOptions,
      uppy,
    });
  };

  /**
   * 便捷方法：基於 payload 與 meta 批次啟動分享上傳。
   *
   * 約定：
   * - files: 原始 File 列表
   * - buildMeta(file, index): 為每個檔案生成 meta（如 slug/path 等）
   * - events / uppyOptions: 直接傳給底層 createShareSession
   * - uppy: 可選的外部 Uppy 例項
   *
   * 返回：
   * - session: Uppy 會話物件
   * - ids: addFiles 返回的檔案 id 列表
   */
  const startShareUpload = ({ files = [], payload, buildMeta, events, uppyOptions, uppy } = {}) => {
    const session = createShareSession({ payload, events, uppyOptions, uppy });
    const ids = Array.isArray(files) && files.length
      ? session.addFiles(files, buildMeta)
      : [];
    return { session, ids };
  };

  /**
   * 基於 /share/upload 的直傳分享上傳（S3/WebDAV 等多儲存通用）。
   */
  const startDirectShareUpload = ({ files = [], payload, buildMeta, events, uppyOptions, uppy, shareMode } = {}) => {
    const session = createDirectShareSession({ payload, events, uppyOptions, uppy, shareMode });
    const ids = Array.isArray(files) && files.length ? session.addFiles(files, buildMeta) : [];
    return { session, ids };
  };

  /**
   * 便捷方法：啟動單次 URL 上傳（呼叫方負責構造檔案描述）。
   * 保持與 startShareUpload 一致的呼叫方式。
   */
  const startUrlUpload = ({ files = [], payload, buildMeta, events, uppyOptions } = {}) => {
    const session = createUrlSession({ payload, events, uppyOptions });
    const ids = Array.isArray(files) && files.length
      ? session.addFiles(files, buildMeta)
      : [];
    return { session, ids };
  };

  return {
    activeShareSession,
    activeUrlSession,
    createShareSession,
    createDirectShareSession,
    createUrlSession,
    createUrlDirectSession,
    createFsUploadSession,
    startShareUpload,
    startDirectShareUpload,
    startUrlUpload,
    disposeShareSession,
    disposeUrlSession,
  };
}
