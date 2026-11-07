import Uppy from "@uppy/core";
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";
import { createLogger } from "@/utils/logger.js";

const DEFAULT_TYPE = "application/octet-stream";
const log = createLogger("UploaderClient");

const generateUploadId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

// 限制進度百分比範圍
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function normalizeProgress(file, progress = {}) {
  const bytesUploaded = progress.bytesUploaded ?? 0;
  const bytesTotal = progress.bytesTotal ?? file?.size ?? file?.data?.size ?? 0;
  const percent = bytesTotal > 0 ? clamp(Math.round((bytesUploaded / bytesTotal) * 100)) : 0;
  return { file, fileId: file?.id, bytesUploaded, bytesTotal, percent };
}

// 附加Uppy生命週期事件
function attachLifecycle(uppy, callbacks = {}) {
  const handlers = [];

  if (callbacks.onFileAdded) {
    const handler = (file) => callbacks.onFileAdded?.(file);
    uppy.on("file-added", handler);
    handlers.push(["file-added", handler]);
  }
  if (callbacks.onProgress) {
    const handler = (file, progress) => callbacks.onProgress?.(normalizeProgress(file, progress));
    uppy.on("upload-progress", handler);
    handlers.push(["upload-progress", handler]);
  }
  if (callbacks.onSuccess) {
    const handler = (file, response) => callbacks.onSuccess?.({ file, response });
    uppy.on("upload-success", handler);
    handlers.push(["upload-success", handler]);
  }
  if (callbacks.onError) {
    const handler = (file, error, response) => callbacks.onError?.({ file, error, response });
    uppy.on("upload-error", handler);
    handlers.push(["upload-error", handler]);
  }
  if (callbacks.onComplete) {
    const handler = (result) => callbacks.onComplete?.(result);
    uppy.on("complete", handler);
    handlers.push(["complete", handler]);
  }
  if (callbacks.onShareRecord) {
    log.debug("register share-record listener");
    const handler = (payload) => callbacks.onShareRecord?.(payload);
    uppy.on("share-record", handler);
    handlers.push(["share-record", handler]);
  }

  return () => {
    handlers.forEach(([event, handler]) => {
      try {
        uppy.off?.(event, handler);
      } catch {}
    });
  };
}

// 推斷檔名
function inferName(file) {
  if (!file) return "upload-file";
  if (typeof file.name === "string" && file.name.length) return file.name;
  if (file.data && typeof file.data.name === "string" && file.data.name.length) return file.data.name;
  return "upload-file";
}

// 推斷檔案型別
function inferType(file) {
  if (file?.type) return file.type;
  if (file?.data?.type) return file.data.type;
  return DEFAULT_TYPE;
}

// 移除Uppy例項中的上傳外掛（避免重複註冊）
function removeUploadPlugins(uppy) {
  if (!uppy) return;

  // 獲取所有外掛ID
  const pluginIds = Object.keys(uppy.getState().plugins || {});

  // 移除所有上傳相關的外掛（避免ID衝突）
  pluginIds.forEach((pluginId) => {
    // 跳過Dashboard等UI外掛，只移除上傳外掛
    if (
      pluginId.includes('AwsS3') ||
      pluginId.includes('S3') ||
      pluginId.includes('ShareUpload') ||
      pluginId.includes('FsUpload') ||
      pluginId.includes('UrlUpload') ||
      pluginId.includes('XHRUpload') ||
      pluginId.includes('Tus')
    ) {
      try {
        uppy.removePlugin(uppy.getPlugin(pluginId));
      } catch (error) {
        log.debug("移除外掛失敗:", pluginId, error);
      }
    }
  });
}

// 建立驅動會話
function createDriverSession({ payload = {}, storageConfigId, installPlugin, events = {}, uppyOptions = {}, uppy: existingUppy }) {
  const configId = storageConfigId ?? payload?.storage_config_id;
  if (!configId) {
    throw new Error("缺少 storage_config_id，無法初始化上傳會話");
  }

  const driver = resolveDriverByConfigId(configId);
  const ownsUppy = !existingUppy;
  const uppy = existingUppy || new Uppy({ autoProceed: false, ...uppyOptions });
  const detachLifecycle = attachLifecycle(uppy, events);

  // 使用外部 Uppy 例項且需要重新安裝上傳外掛時，先清理舊的上傳外掛
  if (existingUppy && typeof installPlugin === "function") {
    removeUploadPlugins(uppy);
  }

  if (typeof installPlugin === "function") {
    installPlugin(driver, uppy, payload, events || {});
  }

  const addFile = (file, meta = {}) => {
    const uploadId = meta.upload_id || generateUploadId();
    const descriptor = {
      data: file?.data ?? file,
      name: inferName(file),
      type: inferType(file),
      meta: { ...meta, upload_id: uploadId },
    };
    const added = uppy.addFile(descriptor);
    return added?.id ?? (Array.isArray(added) ? added[0]?.id : null) ?? uppy.getFiles().slice(-1).pop()?.id ?? null;
  };

  const addFiles = (files = [], buildMeta) => {
    return files.map((file, index) => addFile(file, buildMeta ? buildMeta(file, index) || {} : {}));
  };

  const start = async () => {
    return await uppy.upload();
  };

  const cancel = () => {
    try {
      uppy.cancelAll?.();
    } catch (error) {
      log.warn("UploaderClient: cancelAll 失敗", error);
    }
  };

  const destroy = () => {
    detachLifecycle?.();
    if (ownsUppy) {
      try {
        uppy.close?.();
      } catch {}
      try {
        uppy.destroy?.();
      } catch {}
    }
  };

  return { uppy, addFile, addFiles, start, cancel, destroy };
}

// 建立上傳客戶端
export function useUploaderClient() {
  const createShareUploadSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    return createDriverSession({
      payload,
      storageConfigId: payload?.storage_config_id,
      events,
      uppyOptions,
      uppy,
      installPlugin: (driver, uppyInstance, payloadRef, lifecycleEvents = {}) => {
        driver.share.applyShareUploader(uppyInstance, {
          payload: payloadRef,
          onShareRecord: lifecycleEvents.onShareRecord,
        });
      },
    });
  };

  const createDirectShareUploadSession = ({ payload, events, uppyOptions, uppy, shareMode } = {}) => {
    return createDriverSession({
      payload,
      storageConfigId: payload?.storage_config_id,
      events,
      uppyOptions,
      uppy,
      installPlugin: (driver, uppyInstance, payloadRef, lifecycleEvents = {}) => {
        const impl =
          typeof driver.share.applyDirectShareUploader === "function"
            ? driver.share.applyDirectShareUploader.bind(driver)
            : driver.share.applyShareUploader.bind(driver);
        impl(uppyInstance, {
          payload: payloadRef,
          onShareRecord: lifecycleEvents.onShareRecord,
          shareMode,
        });
      },
    });
  };

  const createUrlUploadSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    return createDriverSession({
      payload,
      storageConfigId: payload?.storage_config_id,
      events,
      uppyOptions,
      uppy,
      installPlugin: (driver, uppyInstance, payloadRef, lifecycleEvents = {}) => {
        driver.share.applyUrlUploader(uppyInstance, {
          payload: payloadRef,
          onShareRecord: lifecycleEvents.onShareRecord,
        });
      },
    });
  };

  const createFsUploadSession = ({ storageConfigId, fsOptions = {}, events, uppyOptions, uppy } = {}) => {
    return createDriverSession({
      storageConfigId,
      payload: fsOptions,
      events,
      uppyOptions,
      uppy,
      // 對於外部傳入的 Uppy 例項（掛載頁場景），外掛安裝由呼叫方負責（例如 UppyUploadModal.configureUploadMethod）
      // 僅在內部建立 Uppy 例項時才自動安裝 FS 上傳外掛
      installPlugin: uppy
        ? null
        : (driver, uppyInstance, options) => {
            driver.fs.applyFsUploader(uppyInstance, options || {});
          },
    });
  };

  return {
    createShareUploadSession,
    createDirectShareUploadSession,
    createUrlUploadSession,
    createFsUploadSession,
  };
}
