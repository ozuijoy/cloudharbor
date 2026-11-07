/**
 * Google Drive sharedWithMe 虛擬目錄支援模組
 *
 */

import { DriverError } from "../../../http/errors.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import { GetFileType, getFileTypeName } from "../../../utils/fileTypeDetector.js";

// 虛擬目錄字首常量：用於 sharedWithMe 檢視內部路徑
export const SHARED_WITH_ME_SEGMENT = "__shared_with_me__";
// 相容別名：用於 WebDAV 等場景下使用者可能直接訪問的可讀名稱
const SHARED_WITH_ME_ALIAS = "Shared with me";

/**
 * 判定路徑片段是否落在 sharedWithMe 虛擬檢視下
 * @param {string[]} segments
 * @returns {boolean}
 */
export function isSharedWithMePath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const head = segments[0];
  return head === SHARED_WITH_ME_SEGMENT || head === SHARED_WITH_ME_ALIAS;
}

/**
 * 解析 sharedWithMe 路徑到 fileId/driveItem 資訊
 * 約定：
 * - 根：/mount/__shared_with_me__/ -> 無具體 fileId，僅表示虛擬目錄
 * - 其它：最後一段視為 fileId，直接呼叫 files.get
 *
 * @param {string[]} segments 有效子路徑片段
 * @param {import("./GoogleDriveApiClient.js").GoogleDriveApiClient} apiClient
 */
export async function resolveSharedWithMePath(segments, apiClient) {
  if (!isSharedWithMePath(segments)) return null;

  // 去掉字首後的路徑片段，例如:
  // - ["__shared_with_me__"]                -> []
  // - ["__shared_with_me__", "foo.md"]      -> ["foo.md"]
  // - ["__shared_with_me__", "dir", "bar"]  -> ["dir", "bar"]
  const innerSegments = segments.slice(1);

  // 根：沒有具體 fileId，僅表示一個虛擬目錄
  if (innerSegments.length === 0) {
    return {
      fileId: null,
      isDirectory: true,
      name: SHARED_WITH_ME_SEGMENT,
      driveItem: null,
    };
  }

  // 規範：sharedWithMe 檢視下，路徑片段一律按「名稱」解析，不再嘗試猜測 fileId，
  // 避免冗餘邏輯和模糊行為。名稱衝突場景下，採用第一條匹配記錄。
  let currentItem = null;
  let currentId = null;

  for (let index = 0; index < innerSegments.length; index++) {
    const segment = innerSegments[index];
    const escapedName = segment.replace(/'/g, "\\'");

    // 第一個片段：在 sharedWithMe 根下按名稱查詢
    const q =
      index === 0
        ? `sharedWithMe = true and name = '${escapedName}' and trashed = false`
        : `'${currentId}' in parents and name = '${escapedName}' and trashed = false`;

    const res = await apiClient.listFiles(index === 0 ? null : currentId, {
      q,
      pageSize: 2,
    });

    const files = Array.isArray(res.files) ? res.files : [];
    if (files.length === 0) {
      throw new DriverError(`指定路徑不存在: ${segment}`, {
        status: 404,
        code: "DRIVER_ERROR.GDRIVE.SHARED_NOT_FOUND",
      });
    }

    currentItem = files[0];
    currentId = currentItem.id;
  }

  const isDirectory = currentItem.mimeType === "application/vnd.google-apps.folder";

  return {
    fileId: currentId,
    isDirectory,
    name: currentItem.name,
    driveItem: currentItem,
  };
}

/**
 * sharedWithMe 虛擬目錄列表實現
 * 路徑約定：
 * - /<mount>/__shared_with_me__/              -> 列出 sharedWithMe = true 的所有條目
 * - /<mount>/__shared_with_me__/<dirId>/...  -> 以 dirId 作為父目錄列出其子項
 *
 * @param {object} params
 * @param {string} params.path  FS 檢視路徑（包含掛載字首）
 * @param {string[]} params.segments 有效子路徑片段
 * @param {import("./GoogleDriveApiClient.js").GoogleDriveApiClient} params.apiClient
 * @param {any} params.mount 掛載資訊
 * @param {D1Database} params.db D1 資料庫例項
 */
export async function listSharedWithMeDirectory({ path, segments, apiClient, mount, db, options = {} }) {
  const cursorRaw = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
  const limitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
  const limit =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : null;
  const paged = options?.paged === true || !!cursorRaw || limit != null;

  let res;
  let nextCursor = null;

  // 根：使用 sharedWithMe = true 過濾
  if (segments.length === 1) {
    if (paged) {
      res = await apiClient.listFiles(null, {
        q: "sharedWithMe = true and trashed = false",
        pageSize: limit ?? 1000,
        pageToken: cursorRaw || undefined,
      });
      nextCursor = res?.nextPageToken ? String(res.nextPageToken) : null;
    } else {
      /** @type {any[]} */
      const all = [];
      let pageToken = undefined;
      while (true) {
        const page = await apiClient.listFiles(null, {
          q: "sharedWithMe = true and trashed = false",
          pageSize: limit ?? 1000,
          pageToken,
        });
        all.push(...(Array.isArray(page?.files) ? page.files : []));
        pageToken = page?.nextPageToken ? String(page.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      res = { files: all };
    }
  } else {
    // 非根：最後一段視為父目錄 fileId
    const parentId = segments[segments.length - 1];

    // 先確認父項是目錄
    const parent = await apiClient.getFile(parentId, {});
    const isDir = parent.mimeType === "application/vnd.google-apps.folder";
    if (!isDir) {
      throw new DriverError("目標路徑不是目錄", { status: 400 });
    }

    if (paged) {
      res = await apiClient.listFiles(parentId, {
        pageSize: limit ?? 1000,
        pageToken: cursorRaw || undefined,
      });
      nextCursor = res?.nextPageToken ? String(res.nextPageToken) : null;
    } else {
      /** @type {any[]} */
      const all = [];
      let pageToken = undefined;
      while (true) {
        const page = await apiClient.listFiles(parentId, { pageSize: limit ?? 1000, pageToken });
        all.push(...(Array.isArray(page?.files) ? page.files : []));
        pageToken = page?.nextPageToken ? String(page.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      res = { files: all };
    }
  }

  const files = Array.isArray(res.files) ? res.files : [];

  const parentPath =
    typeof path === "string" && path.length > 0 ? path.replace(/\/+$/, "") : "";

  const formattedItems = await Promise.all(
    files.map(async (item) => {
      const isDir = item.mimeType === "application/vnd.google-apps.folder";
      const name = item.name;

      // sharedWithMe 檢視下，路徑使用名稱作為最後一段，保持與 FS 其它驅動一致的行為；
      // resolveSharedWithMePath 會同時支援名稱與 fileId。
      let childPath = `${parentPath}/${name}`.replace(/[\\/]+/g, "/");
      if (isDir && typeof childPath === "string" && !childPath.endsWith("/")) {
        childPath = `${childPath}/`;
      }

      const type = isDir ? FILE_TYPES.FOLDER : await GetFileType(name, db);
      const typeName = isDir ? FILE_TYPE_NAMES.FOLDER : await getFileTypeName(name, db);
      const size = isDir ? null : Number(item.size || 0);
      const modified = item.modifiedTime ? new Date(item.modifiedTime) : null;
      const mimetype = isDir ? "application/x-directory" : item.mimeType || null;

      return {
        path: childPath,
        name,
        isDirectory: isDir,
        size,
        modified,
        mimetype,
        type,
        typeName,
        mount_id: mount?.id,
        storage_type: mount?.storage_type || "GOOGLE_DRIVE",
      };
    }),
  );

  return {
    path,
    type: "directory",
    isRoot: segments.length === 1,
    isVirtual: true,
    mount_id: mount?.id,
    storage_type: mount?.storage_type || "GOOGLE_DRIVE",
    items: formattedItems,
    ...(paged ? { hasMore: !!nextCursor, nextCursor } : {}),
  };
}

/**
 * 在掛載根目錄下為 items 注入一個 sharedWithMe 虛擬入口
 * @param {object} params
 * @param {string} params.path 當前目錄路徑
 * @param {any} params.mount 掛載資訊
 * @param {Array} params.items 目錄項陣列（原位修改）
 */
export function injectSharedWithMeEntry({ path, mount, items }) {
  const parentPath =
    typeof path === "string" && path.length > 0 ? path.replace(/\/+$/, "") : "";
  let sharedPath = `${parentPath}/${SHARED_WITH_ME_SEGMENT}`.replace(/[\\/]+/g, "/");
  if (!sharedPath.endsWith("/")) {
    sharedPath = `${sharedPath}/`;
  }

  items.unshift({
    path: sharedPath,
    name: "Shared with me",
    isDirectory: true,
    // 虛擬目錄：大小未知就保持 null（前端顯示 “-”）
    size: null,
    modified: null,
    mimetype: "application/x-directory",
    type: FILE_TYPES.FOLDER,
    typeName: FILE_TYPE_NAMES.FOLDER,
    mount_id: mount?.id,
    storage_type: mount?.storage_type || "GOOGLE_DRIVE",
    isVirtual: true,
  });
}
