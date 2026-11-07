/**
 * 讀取能力模組
 *
 * 定義儲存驅動的讀取操作能力檢測
 * 支援此能力的驅動可以進行檔案和目錄的讀取操作
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isReaderCapable() 檢測：
 *
 * - listDirectory(path, options): Promise<Object>
 *   列出目錄內容，返回 { path, type, isRoot, isVirtual, items: Array<FileInfo> }
 *
 * - downloadFile(path, options): Promise<StorageStreamDescriptor>
 *   下載檔案，返回 StorageStreamDescriptor 物件
 *   StorageStreamDescriptor 結構：
 *   {
 *     size: number | null,           // 檔案大小（位元組）
 *     contentType: string | null,    // MIME 型別
 *     etag?: string | null,          // ETag
 *     lastModified?: Date | null,    // 最後修改時間
 *     getStream(options?): Promise<StreamHandle>,  // 獲取完整流
 *     getRange?(range, options?): Promise<StreamHandle>  // 獲取範圍流（可選）
 *   }
 *   StreamHandle 結構：{ stream: NodeReadable | ReadableStream, close(): Promise<void> }
 *
 * - getFileInfo(path, options): Promise<Object>
 *   獲取檔案資訊，返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName }
 *
 */

/**
 * 檢查物件是否實現了 Reader 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備讀取能力
 */
export function isReaderCapable(obj) {
  return (
    obj &&
    typeof obj.listDirectory === "function" &&
    typeof obj.downloadFile === "function" &&
    typeof obj.getFileInfo === "function"
  );
}

/**
 * Reader 能力的識別符號
 */
export const READER_CAPABILITY = "ReaderCapable";
