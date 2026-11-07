/**
 * 虛擬目錄處理工具
 * 提供虛擬目錄的判斷、列表生成等功能
 */

import { normalizePath } from "./PathResolver.js";
import { resolveMountFromList } from "./MountResolver.js";

/**
 * 檢查路徑是否為虛擬路徑
 * @param {string} path - 請求路徑（FS 檢視路徑）
 * @param {Array} mounts - 掛載點列表
 * @returns {boolean} 是否為虛擬路徑
 */
export function isVirtualPath(path, mounts) {
  // 使用與 MountResolver 相同的規範化規則，保證行為一致
  const normalizedPath = normalizePath(path);

  // 根路徑總是虛擬路徑
  if (normalizedPath === "/" || normalizedPath === "//") {
    return true;
  }

  // 只要能解析到掛載點，就不是虛擬路徑
  const resolved = resolveMountFromList(normalizedPath, mounts);
  return !resolved;
}

/**
 * 獲取虛擬目錄列表
 * 用於處理根路徑和虛擬目錄，返回掛載點列表作為虛擬目錄結構
 * @param {Array} mounts - 掛載點列表
 * @param {string} path - 當前路徑
 * @param {string|null} basicPath - API金鑰的基本路徑（用於過濾顯示內容）
 * @returns {Promise<Object>} 虛擬目錄內容
 */
export async function getVirtualDirectoryListing(mounts, path, basicPath = null) {
  // 確保路徑格式正確
  path = normalizePath(path, true);

  // 檢查當前路徑是否在基本路徑許可權範圍內
  let hasPermissionForCurrentPath = true;
  if (basicPath && basicPath !== "/") {
    const normalizedBasicPath = basicPath.replace(/\/+$/, "");
    const normalizedCurrentPath = path.replace(/\/+$/, "") || "/";

    // 只有當前路徑是基本路徑或其子路徑時才有許可權
    hasPermissionForCurrentPath = normalizedCurrentPath === normalizedBasicPath || normalizedCurrentPath.startsWith(normalizedBasicPath + "/");
  }

  const result = {
    path: path,
    isDirectory: true,
    isVirtual: true,
    items: [],
  };

  // 如果當前路徑沒有許可權，返回空列表
  if (!hasPermissionForCurrentPath) {
    return result;
  }

  const directories = new Set();
  const mountEntries = [];

  // 處理掛載點
  for (const mount of mounts) {
    const mountPath = mount.mount_path.startsWith("/") ? mount.mount_path : "/" + mount.mount_path;
    const normalizedMountPath = normalizePath(mountPath, false);

    // 檢查掛載點是否在當前路徑下
    if (normalizedMountPath.startsWith(path)) {
      const relativePath = normalizedMountPath.substring(path.length);

      // 如果相對路徑為空，說明當前路徑就是掛載點
      if (relativePath === "" || relativePath === "/") {
        // 檢查基本路徑許可權
        if (basicPath && basicPath !== "/") {
          const normalizedBasicPath = basicPath.replace(/\/+$/, "");
          const normalizedMountPath = normalizedMountPath.replace(/\/+$/, "") || "/";

          // 只有掛載點在基本路徑範圍內才顯示
          if (normalizedMountPath === normalizedBasicPath || normalizedMountPath.startsWith(normalizedBasicPath + "/")) {
            mountEntries.push({
              name: mount.name,
              path: normalizedMountPath,
              isDirectory: true,
              isMount: true,
              mountId: mount.id,
              storageType: mount.storage_type,
            });
          }
        } else {
          // 沒有基本路徑限制，顯示所有掛載點
          mountEntries.push({
            name: mount.name,
            path: normalizedMountPath,
            isDirectory: true,
            isMount: true,
            mountId: mount.id,
            storageType: mount.storage_type,
          });
        }
      } else {
        // 掛載點在更深的層級，需要建立中間虛擬目錄
        const pathSegments = relativePath.split("/").filter((segment) => segment.length > 0);
        if (pathSegments.length > 0) {
          const firstDir = pathSegments[0];

          // 檢查基本路徑許可權
          if (basicPath && basicPath !== "/") {
            const normalizedBasicPath = basicPath.replace(/\/+$/, "");
            const normalizedDirPath = (path + firstDir).replace(/\/+$/, "");

            // 檢查目錄路徑是否在基本路徑範圍內
            if (normalizedDirPath === normalizedBasicPath || normalizedDirPath.startsWith(normalizedBasicPath + "/")) {
              directories.add(firstDir);
            }
            // 檢查基本路徑是否在目錄路徑範圍內
            else if (normalizedBasicPath.startsWith(normalizedDirPath + "/")) {
              directories.add(firstDir);
            }
          } else {
            // 沒有基本路徑限制，顯示所有目錄
            directories.add(firstDir);
          }
        }
      }
    }
  }

  // 將目錄新增到結果中
  for (const dir of directories) {
    result.items.push({
      name: dir,
      path: path + dir + "/",
      isDirectory: true,
      isVirtual: true,
      // 虛擬目錄不設定modified欄位，前端會顯示"-"
    });
  }

  // 將掛載點新增到結果中
  for (const mountEntry of mountEntries) {
    result.items.push(mountEntry);
  }

  return result;
}
