import { ValidationError } from "../../http/errors.js";

export class TargetResolver {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  async getMountAndSubPath(path, userIdOrInfo, userType) {
    const { MountManager } = await import("../../storage/managers/MountManager.js");
    const mountManager = new MountManager(this.db, this.encryptionSecret, this.repositoryFactory);
    const { mount, subPath } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);
    return { mount, subPath, mountManager };
  }

  async resolveForPresign({ path, storage_config_id }, userIdOrInfo, userType) {
    if (path) {
      const { mount } = await this.getMountAndSubPath(path, userIdOrInfo, userType);
      if (!mount) throw new ValidationError("目標路徑未繫結掛載");
      return { mount, resolvedPath: path };
    }
    if (storage_config_id) {
      const mountRepo = this.repositoryFactory.getMountRepository();
      const sRepo = this.repositoryFactory.getStorageConfigRepository?.();
      const scfg = await sRepo.findById(storage_config_id);
      if (!scfg?.storage_type) {
        throw new ValidationError("儲存配置缺少 storage_type");
      }
      const mounts = await mountRepo.findByStorageConfig(storage_config_id, scfg.storage_type);
      if (Array.isArray(mounts) && mounts.length > 0) {
        const chosen = mounts[0];
        return { mount: chosen, resolvedPath: chosen.mount_path };
      }
    }
    throw new ValidationError("該儲存未配置掛載，不支援預簽名上傳，請提供 path 或配置掛載");
  }

  async resolveForDirect({ path, storage_config_id }, userIdOrInfo, userType) {
    // 複用現有倉庫，簡化：若傳 path 則返回 mount + path；未傳 path 則嘗試按 storage_config_id 選預設配置，標記 fallback
    const s3ConfigRepo = this.repositoryFactory.getStorageConfigRepository?.();
    if (path) {
      const { mount } = await this.getMountAndSubPath(path, userIdOrInfo, userType);
      return { mount, resolvedPath: path, usedFallback: false, storageConfig: null };
    }
    if (storage_config_id) {
      const storageConfig = await s3ConfigRepo.findById(storage_config_id);
      return { mount: null, resolvedPath: null, usedFallback: true, storageConfig };
    }
    // 未提供則嘗試查預設
    let storageConfig = await s3ConfigRepo.findDefault({ requirePublic: true }).catch(() => null);
    if (!storageConfig) {
      const publicConfigs = await s3ConfigRepo.findPublic().catch(() => []);
      storageConfig = Array.isArray(publicConfigs) && publicConfigs.length > 0 ? publicConfigs[0] : null;
    }
    return { mount: null, resolvedPath: null, usedFallback: true, storageConfig };
  }
}
