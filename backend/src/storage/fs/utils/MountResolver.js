/**
 * 掛載點解析工具
 * 提供通用的掛載點查詢和路徑解析功能
 */

import { DbTables } from "../../../constants/index.js";
import { PROXY_CONFIG } from "../../../constants/proxy.js";
import { ensureRepositoryFactory } from "../../../utils/repositories.js";
import { normalizePath } from "./PathResolver.js";

/**
 * 規範化掛載路徑格式
 * @param {string} mountPath - 掛載路徑
 * @returns {string} 規範化的掛載路徑
 */
export function normalizeMountPath(mountPath) {
  return mountPath.startsWith("/") ? mountPath : "/" + mountPath;
}

/**
 * 計運算元路徑
 * @param {string} fullPath - 完整路徑
 * @param {string} mountPath - 掛載路徑
 * @returns {string} 子路徑（始終以 / 開頭，空子路徑時返回 "/"）
 */
export function calculateSubPath(fullPath, mountPath) {
  let subPath = fullPath.substring(mountPath.length);
  if (!subPath) {
    return "/";
  }
  if (!subPath.startsWith("/")) {
    subPath = "/" + subPath;
  }
  return subPath;
}

/**
 * 在記憶體掛載列表中解析路徑對應的掛載點
 * - 僅負責純路徑→掛載點匹配，不訪問資料庫
 * - 供 VirtualDirectory 等非 DB 場景複用
 * @param {string} path - 請求路徑（FS 檢視路徑）
 * @param {Array<{ mount_path: string }>} mounts - 掛載點列表
 * @returns {{ mount: any, subPath: string, mountPath: string } | null}
 */
export function resolveMountFromList(path, mounts) {
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return null;
  }

  // 使用與 findMountPointByPath 相同的規範化規則，保證行為一致
  const normalizedPath = normalizePath(path);

  // 根路徑不屬於任何具體掛載
  if (normalizedPath === "/" || normalizedPath === "//") {
    return null;
  }

  const sortedMounts = [...mounts].sort(
    (a, b) => b.mount_path.length - a.mount_path.length,
  );

  for (const mount of sortedMounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    if (
      normalizedPath === mountPath ||
      normalizedPath === mountPath + "/" ||
      normalizedPath.startsWith(mountPath + "/")
    ) {
      const subPath = calculateSubPath(normalizedPath, mountPath);
      return { mount, subPath, mountPath };
    }
  }

  return null;
}

/**
 * 根據請求路徑查詢對應的掛載點和子路徑
 * @param {D1Database} db - D1資料庫例項
 * @param {string} path - 請求路徑
 * @param {string|Object} userIdOrInfo - 使用者ID（管理員）或API金鑰資訊物件（API金鑰使用者）
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @returns {Promise<Object>} 包含掛載點、子路徑和錯誤資訊的物件
 */
export async function findMountPointByPath(db, path, userIdOrInfo, userType, repositoryFactory = null) {
  // 規範化路徑
  path = normalizePath(path);

  // 處理根路徑
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "無法操作根目錄",
      },
    };
  }

  // 對於代理訪問，使用特殊的處理邏輯
  if (userType === PROXY_CONFIG.USER_TYPE) {
    // 代理訪問直接使用findMountPointByPathForProxy
    return await findMountPointByPathForProxy(db, path);
  }

  // 獲取掛載點列表 - 不進行許可權過濾，許可權檢查在路由層完成
  let mounts;
  try {
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();
    mounts = await mountRepository.findAll(false); // false = 只獲取活躍的掛載點
  } catch (error) {
    return {
      error: {
        status: 500,
        message: "獲取掛載點失敗",
      },
    };
  }

  // 按照路徑長度降序排序，以便優先匹配最長的路徑
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查詢匹配的掛載點
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果請求路徑完全匹配掛載點或者是掛載點的子路徑
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {
      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的掛載點
  return {
    error: {
      status: 404,
      message: "掛載點不存在",
    },
  };
}

/**
 * 根據API金鑰資訊查詢對應的掛載點和子路徑
 * 注意：此函式不進行許可權檢查，許可權檢查應在路由層完成
 * @param {D1Database} db - D1資料庫例項
 * @param {string} path - 請求路徑
 * @param {Object} apiKeyInfo - API金鑰資訊物件
 * @returns {Promise<Object>} 包含掛載點、子路徑和錯誤資訊的物件
 */
export async function findMountPointByPathWithApiKey(db, path, apiKeyInfo, repositoryFactory = null) {
  // 規範化路徑
  path = normalizePath(path);

  // 處理根路徑
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "無法操作根目錄",
      },
    };
  }

  // 獲取所有活躍的掛載點 - 不進行許可權過濾
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const mountRepository = factory.getMountRepository();
  const mounts = await mountRepository.findAll(false); // false = 只獲取活躍的掛載點

  // 按照路徑長度降序排序，以便優先匹配最長的路徑
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查詢匹配的掛載點
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果請求路徑完全匹配掛載點或者是掛載點的子路徑
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {
      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的掛載點
  return {
    error: {
      status: 404,
      message: "掛載點不存在",
    },
  };
}

/**
 * 更新掛載點的最後使用時間
 * @param {D1Database} db - D1資料庫例項
 * @param {string} mountId - 掛載點ID
 */
export async function updateMountLastUsed(db, mountId, repositoryFactory = null) {
  try {
    // 使用 MountRepository
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();

    await mountRepository.updateLastUsed(mountId);
  } catch (error) {
    // 更新失敗不中斷主流程，但減少日誌詳細程度，避免冗餘
    console.warn(`掛載點最後使用時間更新失敗: ${mountId}`);
  }
}

/**
 * 根據路徑查詢掛載點（用於代理訪問，無需使用者認證）
 * @param {D1Database} db - D1資料庫例項
 * @param {string} path - 請求路徑
 * @returns {Promise<Object>} 包含掛載點、子路徑和錯誤資訊的物件
 */
export async function findMountPointByPathForProxy(db, path, repositoryFactory = null) {
  // 規範化路徑
  path = normalizePath(path);

  // 處理根路徑
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "無法操作根目錄",
      },
    };
  }

  // 獲取所有活躍的掛載點
  let mounts;
  try {
    // 使用 MountRepository
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();

    mounts = await mountRepository.findAll(false); // false = 只獲取活躍的掛載點
  } catch (error) {
    return {
      error: {
        status: 500,
        message: "獲取掛載點失敗",
      },
    };
  }

  // 按照路徑長度降序排序，以便優先匹配最長的路徑
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查詢匹配的掛載點
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果請求路徑完全匹配掛載點或者是掛載點的子路徑
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {

      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的掛載點
  return {
    error: {
      status: 404,
      message: "掛載點不存在",
    },
  };
}
