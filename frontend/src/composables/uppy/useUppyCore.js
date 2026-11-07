/**
 * useUppyCore - Uppy例項建立與配置Composable
 */
import { shallowRef } from 'vue';
import Uppy from '@uppy/core';
// 使用 @uppy/locales 內建的 zh_TW（正體中文）語系檔。
import ChineseTraditionalLocale from '@uppy/locales/lib/zh_TW';
import EnglishLocale from '@uppy/locales/lib/en_US';
import { createLogger } from '@/utils/logger.js';

/**
 * 根據語言程式碼獲取Uppy locale
 */
const getUppyLocale = (locale) => {
  const normalized = String(locale || '').toLowerCase();
  return normalized.startsWith('zh') ? ChineseTraditionalLocale : EnglishLocale;
};

/**
 * Uppy核心Composable
 * @returns {Object} Uppy核心功能
 */
export function useUppyCore() {
  const log = createLogger('UppyCore');
  const uppyInstance = shallowRef(null);

  /**
   * 初始化Uppy例項
   * @param {Object} options - 配置選項
   * @param {string} options.id - Uppy例項ID
   * @param {string} [options.locale='zh-TW'] - 語言程式碼
   * @param {number|null} [options.maxFileSize=null] - 最大檔案大小(bytes)
   * @param {boolean} [options.autoProceed=false] - 是否自動開始上傳
   * @param {boolean} [options.allowMultipleUploadBatches=true] - 允許多批次上傳
   * @param {Function} [options.onStateChanged] - 狀態變化回撥
   */
  const initializeUppy = async (options) => {
    if (uppyInstance.value) {
      destroyUppy();
    }

    uppyInstance.value = new Uppy({
      id: options.id,
      autoProceed: options.autoProceed ?? false,
      allowMultipleUploadBatches: options.allowMultipleUploadBatches ?? true,
      debug: import.meta.env.DEV,
      locale: getUppyLocale(options.locale || 'zh-TW'),
      restrictions: {
        maxFileSize: options.maxFileSize || null,
      },
    });

    if (options.onStateChanged) {
      uppyInstance.value.on('state-update', options.onStateChanged);
    }
  };

  /**
   * 銷燬Uppy例項
   */
  const destroyUppy = () => {
    if (uppyInstance.value) {
      // 清理貼上監聽器
      if (uppyInstance.value._cleanupPaste) {
        uppyInstance.value._cleanupPaste();
      }
      uppyInstance.value.destroy();
      uppyInstance.value = null;
    }
  };

  /**
   * 重新初始化Uppy例項
   * @param {Object} options - 配置選項
   */
  const reinitializeUppy = async (options) => {
    destroyUppy();
    await initializeUppy(options);
  };

  /**
   * 獲取檔案快照(用於重新初始化時保留檔案)
   */
  const snapshotFiles = () => {
    if (!uppyInstance.value) return [];
    return uppyInstance.value.getFiles().map((file) => ({
      data: file.data || file,
      name: file.name,
      type: file.type,
      meta: { ...file.meta },
      source: file.source || 'local',
    }));
  };

  /**
   * 恢復檔案到Uppy例項
   * @param {Array} files - 檔案快照陣列
   */
  const restoreFiles = (files = []) => {
    if (!uppyInstance.value || !files.length) return;
    files.forEach((file) => {
      try {
        uppyInstance.value.addFile({
          name: file.name,
          type: file.type,
          data: file.data,
          source: file.source,
          meta: file.meta || {},
        });
      } catch (error) {
        log.warn('[useUppyCore] 恢復檔案失敗', error);
      }
    });
  };

  return {
    uppyInstance,
    initializeUppy,
    destroyUppy,
    reinitializeUppy,
    snapshotFiles,
    restoreFiles,
  };
}
