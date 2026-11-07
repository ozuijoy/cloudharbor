/**
 * useUppyEvents - Uppy事件監聽Composable
 */
import { ref, watch } from 'vue';
import { createLogger } from "@/utils/logger.js";

/**
 * Uppy事件監聽Composable
 * @param {Object} options - 配置選項
 * @param {import('vue').Ref} options.uppy - Uppy例項ref
 * @param {Function} [options.onFileAdded] - 檔案新增回撥
 * @param {Function} [options.onFileRemoved] - 檔案移除回撥
 * @param {Function} [options.onRestrictionFailed] - 限制失敗回撥
 * @param {Function} [options.onUploadError] - 上傳錯誤回撥
 * @param {Function} [options.onError] - 系統錯誤回撥
 * @param {Function} [options.onFileEditComplete] - Dashboard檔案編輯完成回撥
 * @returns {Object} 事件監聽功能
 */
export function useUppyEvents(options) {
  const fileCount = ref(0);
  let eventHandlers = {};
  const log = createLogger("useUppyEvents");

  /**
   * 設定事件監聽器
   */
  const setupEvents = () => {
    if (!options.uppy?.value) return;

    const uppy = options.uppy.value;

    // 檔案新增
    const onFileAdded = (file) => {
      fileCount.value = uppy.getFiles().length;
      options.onFileAdded?.(file);
    };

    // 檔案移除
    const onFileRemoved = (file) => {
      fileCount.value = uppy.getFiles().length;
      options.onFileRemoved?.(file);
    };

    // 限制失敗
    const onRestrictionFailed = (file, error) => {
      options.onRestrictionFailed?.(file, error);
    };

    // 上傳錯誤
    const onUploadError = (file, error) => {
      options.onUploadError?.(file, error);
    };

    // 系統錯誤
    const onError = (error) => {
      options.onError?.(error);
    };

    // Dashboard檔案編輯完成
    const onFileEditComplete = (file) => {
      // 關鍵修復：當使用者在Dashboard中編輯檔案後設資料後，將meta.name同步到file.name
      // 這樣XHRUpload等外掛才能使用編輯後的檔名
      if (file?.meta?.name && file.meta.name !== file.name) {
        log.debug('同步編輯後的檔名:', file.name, '->', file.meta.name);
        uppy.setFileState(file.id, { name: file.meta.name });
      }
      options.onFileEditComplete?.(file);
    };

    uppy.on('file-added', onFileAdded);
    uppy.on('file-removed', onFileRemoved);
    if (options.onRestrictionFailed) {
      uppy.on('restriction-failed', onRestrictionFailed);
    }
    if (options.onUploadError) {
      uppy.on('upload-error', onUploadError);
    }
    if (options.onError) {
      uppy.on('error', onError);
    }
    // 始終監聽檔案編輯完成事件，確保檔名修改能夠生效
    uppy.on('dashboard:file-edit-complete', onFileEditComplete);

    eventHandlers = {
      'file-added': onFileAdded,
      'file-removed': onFileRemoved,
      'restriction-failed': onRestrictionFailed,
      'upload-error': onUploadError,
      'error': onError,
      'dashboard:file-edit-complete': onFileEditComplete,
    };
  };

  /**
   * 清理事件監聽器
   */
  const cleanupEvents = () => {
    if (!options.uppy?.value) return;
    const uppy = options.uppy.value;
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      if (handler) uppy.off(event, handler);
    });
    eventHandlers = {};
  };

  // 監聽uppy例項變化,自動重新設定事件
  watch(
    () => options.uppy?.value,
    (newUppy, oldUppy) => {
      if (oldUppy) cleanupEvents();
      if (newUppy) setupEvents();
    },
    { immediate: true }
  );

  return {
    setupEvents,
    cleanupEvents,
    fileCount,
  };
}
