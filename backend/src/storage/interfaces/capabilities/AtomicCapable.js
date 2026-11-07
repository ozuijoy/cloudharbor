/**
 * 原子操作能力模組
 *
 * 定義儲存驅動的原子操作能力檢測
 * 支援此能力的驅動可以進行檔案和目錄的重新命名、複製等原子操作
 * 確保操作的原子性和一致性
 *
 * ========== 契約要求 ==========
 * 驅動必須實現以下方法才能透過 isAtomicCapable() 檢測：
 *
 * - renameItem(oldPath, newPath, options): Promise<Object>
 *   重新命名檔案或目錄，返回 { success, source, target, message? }
 *
 * - copyItem(sourcePath, targetPath, options): Promise<Object>
 *   複製檔案或目錄，返回 { status, source, target, message?, skipped?, reason? }
 */

/**
 * 檢查物件是否實現了 Atomic 能力
 * @param {Object} obj - 要檢查的物件
 * @returns {boolean} 是否具備原子操作能力
 */
export function isAtomicCapable(obj) {
  return (
    obj &&
    typeof obj.renameItem === "function" &&
    typeof obj.copyItem === "function"
  );
}

/**
 * Atomic 能力的識別符號
 */
export const ATOMIC_CAPABILITY = "AtomicCapable";
