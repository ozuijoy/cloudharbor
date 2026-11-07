/**
 * useUppyPaste - Uppy貼上上傳Composable
 */
import { watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { createLogger } from '@/utils/logger.js';

/**
 * Uppy貼上上傳Composable
 * @param {Object} options - 配置選項
 * @param {import('vue').Ref} options.uppy - Uppy例項ref
 * @param {import('vue').Ref<boolean>} [options.enabled] - 是否啟用(如isOpen)
 * @param {Function} [options.onPaste] - 貼上回撥
 * @returns {Object} 貼上監聽功能
 */
export function useUppyPaste(options) {
  const log = createLogger('UppyPaste');
  let pasteHandler = null;
  let stopPasteListener = null;

  /**
   * 設定貼上監聽器
   */
  const setupPasteListener = () => {
    if (typeof stopPasteListener === 'function') {
      stopPasteListener();
      stopPasteListener = null;
    }

    pasteHandler = (event) => {
      // 檢查是否啟用
      if (options.enabled && !options.enabled.value) return;
      if (!options.uppy?.value) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (!file) continue;

          const ext = file.type.split('/')[1] || 'bin';
          const fileName = file.name || `pasted-${Date.now()}.${ext}`;

          try {
            options.uppy.value.addFile({
              name: fileName,
              type: file.type,
              data: file,
              source: 'clipboard',
            });

            options.onPaste?.(file);
            event.preventDefault();
          } catch (err) {
            log.error('[useUppyPaste] 新增檔案失敗:', err);
          }
        }
      }
    };

    stopPasteListener = useEventListener(document, 'paste', pasteHandler);

    // 儲存清理函式到uppy例項
    if (options.uppy?.value) {
      options.uppy.value._cleanupPaste = cleanupPasteListener;
    }
  };

  /**
   * 清理貼上監聽器
   */
  const cleanupPasteListener = () => {
    if (typeof stopPasteListener === 'function') {
      stopPasteListener();
      stopPasteListener = null;
    }
    pasteHandler = null;
  };

  // 監聽uppy例項變化
  watch(
    () => options.uppy?.value,
    (newUppy, oldUppy) => {
      if (oldUppy) cleanupPasteListener();
      if (newUppy) setupPasteListener();
    },
    { immediate: true }
  );

  return {
    setupPasteListener,
    cleanupPasteListener,
  };
}
