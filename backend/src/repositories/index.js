/**
 * Repository層統一匯出檔案
 * 提供所有Repository類的統一入口
 */

export { BaseRepository } from "./BaseRepository.js";
export { FileRepository } from "./FileRepository.js";
export { MountRepository } from "./MountRepository.js";
export { StorageConfigRepository } from "./StorageConfigRepository.js";
export { AdminRepository } from "./AdminRepository.js";
export { ApiKeyRepository } from "./ApiKeyRepository.js";
export { PasteRepository } from "./PasteRepository.js";
export { SystemRepository } from "./SystemRepository.js";
export { PrincipalStorageAclRepository } from "./PrincipalStorageAclRepository.js";
export { FsMetaRepository } from "./FsMetaRepository.js";
export { UploadPartsRepository } from "./UploadPartsRepository.js";
export { VfsNodesRepository } from "./VfsNodesRepository.js";
export { MetricsCacheRepository } from "./MetricsCacheRepository.js";

// 匯入所有Repository類用於工廠類
import { BaseRepository } from "./BaseRepository.js";
import { FileRepository } from "./FileRepository.js";
import { MountRepository } from "./MountRepository.js";
import { StorageConfigRepository } from "./StorageConfigRepository.js";
import { AdminRepository } from "./AdminRepository.js";
import { ApiKeyRepository } from "./ApiKeyRepository.js";
import { PasteRepository } from "./PasteRepository.js";
import { SystemRepository } from "./SystemRepository.js";
import { PrincipalStorageAclRepository } from "./PrincipalStorageAclRepository.js";
import { FsMetaRepository } from "./FsMetaRepository.js";
import { UploadPartsRepository } from "./UploadPartsRepository.js";
import { VfsNodesRepository } from "./VfsNodesRepository.js";
import { MetricsCacheRepository } from "./MetricsCacheRepository.js";
import { createDbRuntime } from "../db/runtime.js";

/**
 * Repository工廠類
 * 用於建立和管理Repository例項
 */
export class RepositoryFactory {
  /**
   * 建構函式
   * @param {D1Database} db - 資料庫例項
   * @param {{ env?: any, providerName?: string }} [options]
   */
  constructor(db, options = {}) {
    const { env = {}, providerName = null } = options || {};
    const runtime = createDbRuntime({ db, env, providerName });
    this.db = runtime.db;
    this.dialect = runtime.dialect;
    this.providerName = runtime.providerName;
    this._repositories = new Map();
  }

  /**
   * 獲取FileRepository例項
   * @returns {FileRepository} FileRepository例項
   */
  getFileRepository() {
    if (!this._repositories.has("file")) {
      this._repositories.set("file", new FileRepository(this.db, this.dialect));
    }
    return this._repositories.get("file");
  }

  /**
   * 獲取MountRepository例項
   * @returns {MountRepository} MountRepository例項
   */
  getMountRepository() {
    if (!this._repositories.has("mount")) {
      this._repositories.set("mount", new MountRepository(this.db, this.dialect));
    }
    return this._repositories.get("mount");
  }

  /**
   * 獲取StorageConfigRepository例項（通用）
   * @returns {StorageConfigRepository}
   */
  getStorageConfigRepository() {
    if (!this._repositories.has("storageconfig")) {
      this._repositories.set("storageconfig", new StorageConfigRepository(this.db, this.dialect));
    }
    return this._repositories.get("storageconfig");
  }

  /**
   * 獲取AdminRepository例項
   * @returns {AdminRepository} AdminRepository例項
   */
  getAdminRepository() {
    if (!this._repositories.has("admin")) {
      this._repositories.set("admin", new AdminRepository(this.db, this.dialect));
    }
    return this._repositories.get("admin");
  }

  /**
   * 獲取ApiKeyRepository例項
   * @returns {ApiKeyRepository} ApiKeyRepository例項
   */
  getApiKeyRepository() {
    if (!this._repositories.has("apikey")) {
      this._repositories.set("apikey", new ApiKeyRepository(this.db, this.dialect));
    }
    return this._repositories.get("apikey");
  }

  /**
   * 獲取PasteRepository例項
   * @returns {PasteRepository} PasteRepository例項
   */
  getPasteRepository() {
    if (!this._repositories.has("paste")) {
      this._repositories.set("paste", new PasteRepository(this.db, this.dialect));
    }
    return this._repositories.get("paste");
  }

  /**
   * 獲取SystemRepository例項
   * @returns {SystemRepository} SystemRepository例項
   */
  getSystemRepository() {
    if (!this._repositories.has("system")) {
      this._repositories.set("system", new SystemRepository(this.db, this.dialect));
    }
    return this._repositories.get("system");
  }

  /**
   * 獲取 PrincipalStorageAclRepository 例項
   * @returns {PrincipalStorageAclRepository} PrincipalStorageAclRepository 例項
   */
  getPrincipalStorageAclRepository() {
    if (!this._repositories.has("principalStorageAcl")) {
      this._repositories.set("principalStorageAcl", new PrincipalStorageAclRepository(this.db, this.dialect));
    }
    return this._repositories.get("principalStorageAcl");
  }

  /**
   * 獲取 UploadPartsRepository 例項
   * @returns {UploadPartsRepository}
   */
  getUploadPartsRepository() {
    if (!this._repositories.has("uploadParts")) {
      this._repositories.set("uploadParts", new UploadPartsRepository(this.db, this.dialect));
    }
    return this._repositories.get("uploadParts");
  }

  /**
   * 獲取 VfsNodesRepository 例項
   * @returns {VfsNodesRepository}
   */
  getVfsNodesRepository() {
    if (!this._repositories.has("vfsNodes")) {
      this._repositories.set("vfsNodes", new VfsNodesRepository(this.db, this.dialect));
    }
    return this._repositories.get("vfsNodes");
  }

  /**
   * 獲取 MetricsCacheRepository 例項
   * @returns {MetricsCacheRepository}
   */
  getMetricsCacheRepository() {
    if (!this._repositories.has("metricsCache")) {
      this._repositories.set("metricsCache", new MetricsCacheRepository(this.db, this.dialect));
    }
    return this._repositories.get("metricsCache");
  }

  /**
   * 清理所有Repository例項快取
   */
  clearCache() {
    this._repositories.clear();
  }

  /**
   * 獲取所有Repository例項
   * @returns {Object} 包含所有Repository例項的物件
   */
  getAllRepositories() {
    return {
      file: this.getFileRepository(),
      mount: this.getMountRepository(),
      storageConfig: this.getStorageConfigRepository(),
      admin: this.getAdminRepository(),
      apiKey: this.getApiKeyRepository(),
      paste: this.getPasteRepository(),
      system: this.getSystemRepository(),
      principalStorageAcl: this.getPrincipalStorageAclRepository(),
      fsMeta: this.getFsMetaRepository(),
      uploadParts: this.getUploadPartsRepository(),
      vfsNodes: this.getVfsNodesRepository(),
      metricsCache: this.getMetricsCacheRepository(),
    };
  }

  /**
   * 獲取 FsMetaRepository 例項
   * @returns {FsMetaRepository}
   */
  getFsMetaRepository() {
    if (!this._repositories.has("fsMeta")) {
      this._repositories.set("fsMeta", new FsMetaRepository(this.db, this.dialect));
    }
    return this._repositories.get("fsMeta");
  }
}
