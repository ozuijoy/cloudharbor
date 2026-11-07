import { ApiStatus, UserType } from "../../constants/index.js";
import {
  getAdminFileList,
  getAdminFileDetail,
  getUserFileList,
  getUserFileDetail,
  updateFile,
} from "../../services/fileService.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { useRepositories } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { getPagination, jsonOk } from "../../utils/common.js";
import { usePolicy } from "../../security/policies/policies.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";

const requireFilesAccess = usePolicy("files.manage");

const getFilesPrincipal = (c) => resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });

export const registerFilesProtectedRoutes = (router) => {
  router.get("/api/files", requireFilesAccess, async (c) => {
    const db = c.env.DB;
    const { type: userType, userId, apiKeyInfo } = getFilesPrincipal(c);

    let result;

    if (userType === UserType.ADMIN) {
      const { limit, offset } = getPagination(c, { limit: 30 });
      const search = c.req.query("search");
      const createdBy = c.req.query("created_by");

      const options = { limit, offset };
      if (search) options.search = search;
      if (createdBy) options.createdBy = createdBy;

      result = await getAdminFileList(db, options);
    } else {
      const { limit, offset } = getPagination(c, { limit: 30 });
      const search = c.req.query("search");

      const options = { limit, offset };
      if (search) options.search = search;

      result = await getUserFileList(db, userId, options);
    }

    const data = userType === UserType.API_KEY ? { ...result, key_info: apiKeyInfo } : result;
    return jsonOk(c, data, "獲取檔案列表成功");
  });

  router.get("/api/files/:id", requireFilesAccess, async (c) => {
    const db = c.env.DB;
    const { type: userType, userId } = getFilesPrincipal(c);
    const { id } = c.req.param();
    const encryptionSecret = getEncryptionSecret(c);
    const include = c.req.query("include");
    const linksFlag = c.req.query("links");
    const includeLinks = include === "links" || linksFlag === "true";
    const detailOptions = includeLinks ? { includeLinks: true } : {};

    let result;
    if (userType === UserType.ADMIN) {
      result = await getAdminFileDetail(db, id, encryptionSecret, c.req.raw, detailOptions);
    } else {
      result = await getUserFileDetail(db, id, userId, encryptionSecret, c.req.raw, detailOptions);
    }

    return jsonOk(c, result, "獲取檔案成功");
  });

  router.delete("/api/files/batch-delete", requireFilesAccess, async (c) => {
    const db = c.env.DB;
    const { type: userType, userId } = getFilesPrincipal(c);
    const body = await c.req.json();
    const ids = body.ids;
    const deleteMode = body.delete_mode || "both";

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError("請提供有效的檔案ID陣列");
    }

    if (!["record_only", "both"].includes(deleteMode)) {
      throw new ValidationError("刪除模式必須是 'record_only' 或 'both'");
    }

    const result = { success: 0, failed: [] };
    const storageConfigIds = new Set();
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = useRepositories(c);
    const fileRepository = repositoryFactory.getFileRepository();

    for (const id of ids) {
    await (async () => {
      let file;

      if (userType === UserType.ADMIN) {
        file = await fileRepository.findByIdWithStorageConfig(id);
        if (!file) {
          result.failed.push({ id, error: "檔案不存在" });
          return;
        }
      } else {
        file = await fileRepository.findByIdAndCreator(id, `apikey:${userId}`);
        if (!file) {
          result.failed.push({ id, error: "檔案不存在或無權刪除" });
          return;
        }
      }

      if (file.storage_config_id) {
        storageConfigIds.add(file.storage_config_id);
      }

      await (async () => {
        if (deleteMode === "both" && file.file_path) {
          const { MountManager } = await import("../../storage/managers/MountManager.js");
          const { FileSystem } = await import("../../storage/fs/FileSystem.js");

          const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
          const fileSystem = new FileSystem(mountManager);

          await fileSystem
            .batchRemoveItems([file.file_path], userType === UserType.ADMIN ? userId : `apikey:${userId}`, userType)
            .catch((fsError) => {
              console.error(`刪除檔案系統檔案失敗 (ID: ${id}):`, fsError);
            });
        }

        // storage-first 或無 file_path 時，直接按儲存配置刪除物件（透過 ObjectStore 統一封裝）
        if (deleteMode === "both" && file.storage_path && file.storage_config_id) {
          try {
            const { ObjectStore } = await import("../../storage/object/ObjectStore.js");
            const objectStore = new ObjectStore(db, encryptionSecret, repositoryFactory);
            await objectStore.deleteByStoragePath(file.storage_config_id, file.storage_path, { db });
          } catch (deleteError) {
            console.error(`刪除儲存檔案失敗 (ID: ${id}):`, deleteError);
          }
        }
      })().catch((deleteError) => {
        console.error(`刪除檔案儲存失敗 (ID: ${id}):`, deleteError);
      });

      if (userType === UserType.ADMIN) {
        await fileRepository.deleteFilePasswordRecord(id);
      }
      await fileRepository.deleteFile(id);

      result.success++;
    })().catch((error) => {
      console.error(`刪除檔案失敗 (ID: ${id}):`, error);
      result.failed.push({ id, error: error.message || "刪除失敗" });
    });
  }

  for (const storageConfigId of storageConfigIds) {
    invalidateFsCache({ storageConfigId, reason: "files-batch-delete", db });
  }

  return jsonOk(c, result, `批次刪除完成，成功: ${result.success}，失敗: ${result.failed.length}`);
});

  router.put("/api/files/:id", requireFilesAccess, async (c) => {
    const db = c.env.DB;
    const { type: userType, userId } = getFilesPrincipal(c);
    const { id } = c.req.param();
    const body = await c.req.json();

    const result = await updateFile(db, id, body, { userType, userId });
    return jsonOk(c, result, result.message);
  });
};
