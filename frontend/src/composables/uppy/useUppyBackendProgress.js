/**
 * useUppyBackendProgress - 基於後端進度的 Uppy 進度修正 Composable
 *
 * 封裝以下通用能力：
 * - 為每個 Uppy 檔案生成並維護 upload_id（寫入 file.meta.upload_id）
 * - 跨前端/後端融合進度：結合瀏覽器上報與 /api/upload/progress 返回值
 * - 直接更新 Uppy 檔案狀態，驅動 Dashboard 進度條重新整理
 *
 * 呼叫方需要提供：
 * - uppy: Ref<Uppy | null>
 * - isDirectMode: () => boolean，用於判斷當前是否啟用直傳模式
 */
import { getUploadProgress } from "@/api/services/systemService.js";
import { createLogger } from "@/utils/logger.js";

export function useUppyBackendProgress(options) {
  const log = createLogger("UppyBackendProgress");
  const { uppy, isDirectMode } = options;

  // 後端進度狀態與輪詢定時器
  const backendProgressState = new Map();
  const backendProgressTimers = new Map();

  const generateUploadId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  /**
   * 確保檔案擁有 upload_id，並回傳最終的 upload_id
   */
  const ensureUploadIdForFile = (file) => {
    if (!uppy?.value || !file?.id) return null;
    const meta = file.meta || {};
    if (meta.upload_id) {
      return meta.upload_id;
    }
    const uploadId = generateUploadId();
    try {
      uppy.value.setFileMeta(file.id, {
        ...meta,
        upload_id: uploadId,
      });
    } catch (error) {
      log.warn("[useUppyBackendProgress] 設定 upload_id 失敗", error);
    }
    return uploadId;
  };

  /**
   * 重置後端進度相關狀態
   */
  const resetBackendProgressTracking = () => {
    backendProgressTimers.forEach((timer) => clearInterval(timer));
    backendProgressTimers.clear();
    backendProgressState.clear();
  };

  /**
   * 更新瀏覽器本地的進度快照，用於與後端進度融合
   * 後端尚未記錄任何進度時（例如返回「未找到上傳進度記錄」的預設結構），不視為有效的遠端進度，保持 hasRemote=false，持續抑制本地進度條。
   */
  const updateBrowserProgressState = ({ file, fileId, bytesUploaded, bytesTotal }) => {
    if (!fileId) return;
    const id = fileId;
    const prev = backendProgressState.get(id) || {};
    const next = {
      ...prev,
      file: file || prev.file,
      browserBytesUploaded: typeof bytesUploaded === "number" ? bytesUploaded : prev.browserBytesUploaded || 0,
      browserBytesTotal: typeof bytesTotal === "number" ? bytesTotal : prev.browserBytesTotal || file?.size || 0,
      remoteBytesLoaded: prev.remoteBytesLoaded || 0,
      remoteBytesTotal: prev.remoteBytesTotal || 0,
      currentBytes: prev.currentBytes || 0,
      hasRemote: prev.hasRemote || false,
    };

    if (next.browserBytesUploaded > (next.currentBytes || 0)) {
      next.currentBytes = next.browserBytesUploaded;
    }

    backendProgressState.set(id, next);
  };

  /**
   * 啟動後端進度輪詢並修正 Uppy 進度
   * 當前版本不再依賴後端進度驅動 Uppy 進度條，
   * 僅保留 upload_id 生成能力，UI 進度完全交由 XHRUpload 等外掛管理。
   */
  const startBackendProgressPolling = () => {
    // no-op：保留函式簽名以相容現有呼叫，但不再啟動任何後端進度輪詢。
    return;
  };

  return {
    ensureUploadIdForFile,
    resetBackendProgressTracking,
    updateBrowserProgressState,
    startBackendProgressPolling,
  };
}
