/**
 * listDirectoryPaging
 *
 * “完整遍歷目錄”的內部邏輯（例如索引重建/dirty 子樹重建）提供一個統一的“按頁拉取”迭代器。
 *
 *
 * - fileSystem.listDirectory(path, ..., { paged, cursor, limit }) 返回結果中如果包含：
 *   - hasMore: boolean
 *   - nextCursor: string|null
 *   那麼表示還有下一頁（cursor 為不透明字串，交給驅動自己解釋）。
 */

/**
 * 按頁遍歷某個目錄的所有子項（不會把所有頁一次性堆到記憶體裡）。
 *
 * @param {any} fileSystem FileSystem 例項（需要實現 listDirectory）
 * @param {string} dirPath 目錄路徑（約定應以 / 結尾）
 * @param {any} userIdOrInfo 使用者身份資訊
 * @param {any} userType 使用者型別
 * @param {{ refresh?: boolean, pageLimit?: number }} options
 */
export async function* iterateListDirectoryItems(fileSystem, dirPath, userIdOrInfo, userType, options = {}) {
  const refresh = options?.refresh === true;
  const limitRaw = options?.pageLimit != null && options.pageLimit !== "" ? Number(options.pageLimit) : null;
  // pageLimit 不提供時，不強行覆蓋驅動預設值（例如 HF tree 的 limit 有自己的預設/上限策略）。
  const pageLimit =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.floor(limitRaw)) : null;

  let cursor = null;
  let pages = 0;

  while (true) {
    pages += 1;
    // 兜底：避免驅動返回錯誤的 nextCursor 導致死迴圈
    if (pages > 20000) {
      throw new Error("listDirectory 分頁迴圈異常：超過 20000 頁仍未結束（可能是驅動 nextCursor 邏輯有問題）");
    }

    const listResult = await fileSystem.listDirectory(dirPath, userIdOrInfo, userType, {
      refresh,
      paged: true,
      cursor,
      ...(pageLimit != null ? { limit: pageLimit } : {}),
    });

    const items = Array.isArray(listResult?.items) ? listResult.items : [];
    for (const item of items) {
      yield item;
    }

    const nextCursorRaw =
      listResult?.nextCursor != null && String(listResult.nextCursor).trim() ? String(listResult.nextCursor).trim() : null;
    const hasMoreFlag = listResult?.hasMore === true;
    const shouldContinue = hasMoreFlag || !!nextCursorRaw;

    if (!shouldContinue || !nextCursorRaw) {
      break;
    }

    if (nextCursorRaw === cursor) {
      break;
    }

    cursor = nextCursorRaw;
  }
}
