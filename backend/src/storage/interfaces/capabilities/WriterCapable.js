/**
 * 寫入能力模組
 *
 * 定義儲存驅動的寫入操作能力檢測
 * 支援此能力的驅動可以進行檔案和目錄的建立、更新、刪除操作
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isWriterCapable() 檢測：
 *
 * - uploadFile(path, fileOrStream, options): Promise<Object>
 *   上傳檔案，返回 { success, storagePath, message? }
 *
 * - createDirectory(path, options): Promise<Object>
 *   建立目錄，返回 { success, path, alreadyExists? }
 *
 * - batchRemoveItems(paths, options): Promise<Object>
 *   批次刪除，返回 { success: number, failed: Array<{path, error}> }
 *
 * - renameItem(oldPath, newPath, options): Promise<Object>
 *   重新命名，返回 { success, source, target, message? }
 *
 * - copyItem(sourcePath, targetPath, options): Promise<Object>
 *   複製，返回 { status, source, target, message?, skipped?, reason? }
 */

/**
 * 檢查物件是否實現了 Writer 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備寫入能力
 */
export function isWriterCapable(obj) {
  return (
    obj &&
    typeof obj.uploadFile === "function" &&
    typeof obj.createDirectory === "function" &&
    typeof obj.batchRemoveItems === "function" &&
    typeof obj.renameItem === "function" &&
    typeof obj.copyItem === "function"
  );
}

/**
 * Writer 能力的識別符號
 */
export const WRITER_CAPABILITY = "WriterCapable";
