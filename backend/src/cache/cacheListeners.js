import cacheBus, { CACHE_EVENTS } from "./cacheBus.js";
import { directoryCacheManager } from "./DirectoryCache.js";
import { fsFolderSummaryCacheManager } from "./FsFolderSummaryCache.js";
import { clearUrlCache } from "./UrlCache.js";
import { clearSearchCache } from "./SearchCache.js";
import { previewSettingsCache } from "./PreviewSettingsCache.js";
import { bumpMountsVersion } from "./cacheState.js";
import { clearTelegramFileInfoCache } from "../storage/drivers/telegram/TelegramFileInfoCache.js";

const logEvent = (message, payload) => {
  try {
    const safePayload = JSON.stringify(payload ?? {});
    console.log(`[cacheBus] ${message} -> ${safePayload}`);
  } catch (error) {
    console.log(`[cacheBus] ${message}`);
  }
};

const invalidateDirectoryCache = ({ mountId, paths = [], dirPaths = [] }) => {
  if (!mountId) {
    return;
  }

  if (!paths.length) {
    directoryCacheManager.invalidateMount(mountId);
    fsFolderSummaryCacheManager.invalidateMount(mountId);
    return;
  }

  // 目錄級變更（例如刪除目錄/移動目錄/重新命名目錄）需要清理子樹快取，避免“已刪除目錄”仍命中舊快取。
  for (const dirPath of dirPaths) {
    if (typeof dirPath === "string" && dirPath.length > 0) {
      directoryCacheManager.invalidatePathTree(mountId, dirPath);
      fsFolderSummaryCacheManager.invalidatePathTree(mountId, dirPath);
    }
  }

  for (const path of paths) {
    if (typeof path === "string" && path.length > 0) {
      directoryCacheManager.invalidatePathAndAncestors(mountId, path);
      fsFolderSummaryCacheManager.invalidatePathAndAncestors(mountId, path);
    }
  }
};

const resolveMountsByStorageConfig = async (db, storageConfigId) => {
  if (!db || !storageConfigId) {
    return [];
  }

  try {
    const result = await db
      .prepare(
        `SELECT id FROM storage_mounts
         WHERE storage_type = 'S3' AND storage_config_id = ?`
      )
      .bind(storageConfigId)
      .all();
    return result?.results?.map((row) => row.id).filter(Boolean) ?? [];
  } catch (error) {
    console.warn("resolveMountsByS3Config failed", error);
    return [];
  }
};

cacheBus.on(CACHE_EVENTS.INVALIDATE, async (payload = {}) => {
  try {
    const {
      target = "fs",
      mountId = null,
      paths = [],
      dirPaths = [],
      storageConfigId = null,
      userType = null,
      userId = null,
      reason = "unknown",
      invalidateAll = false,
      bumpMountsVersion: shouldBumpVersion = false,
      db = null,
    } = payload;

    if (shouldBumpVersion) {
      bumpMountsVersion();
    }

    if (invalidateAll) {
      directoryCacheManager.invalidateAll();
      fsFolderSummaryCacheManager.invalidateAll();
      await clearUrlCache();
      clearSearchCache();
      clearTelegramFileInfoCache();
      logEvent(`快取全量失效(原因:${reason})`, payload);
      return;
    }

    if (target === "fs") {
      invalidateDirectoryCache({ mountId, paths, dirPaths });
      if (mountId) {
        clearSearchCache({ mountId });
      }
    }

    if (payload.storageConfigId) {
      const relatedMounts = await resolveMountsByStorageConfig(db, payload.storageConfigId);
      for (const relatedMountId of relatedMounts) {
        invalidateDirectoryCache({ mountId: relatedMountId });
        clearSearchCache({ mountId: relatedMountId });
      }
      await clearUrlCache({ storageConfigId: payload.storageConfigId });
    }

    if (target === "preview") {
      try {
        await previewSettingsCache.refresh(payload.db ?? null);
      } catch (error) {
        console.warn("重新整理預覽設定快取失敗", error);
      }
    }

    logEvent(`快取事件已處理(原因:${reason})`, payload);
  } catch (error) {
    console.error("處理快取事件失敗", error);
  }
});
