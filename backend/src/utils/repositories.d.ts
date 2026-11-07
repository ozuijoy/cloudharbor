/**
 * repositories.js 的 TypeScript 型別宣告
 */

export interface MountRepositoryLike {
  /**
   * 獲取掛載點列表
   * @param includeDisabled 是否包含禁用的掛載點
   */
  findAll(includeDisabled?: boolean): Promise<any[]>;
}

export interface UploadPartsRepositoryLike {
  upsertPart(params: any): Promise<any>;
  markPartError?(params: any): Promise<any>;
  listParts(uploadId: string): Promise<any[]>;
  listPartNumbers(uploadId: string): Promise<number[]>;
  deletePartsByUploadId(uploadId: string): Promise<any>;
  deletePartsByUploadIds(uploadIds: string[], options?: any): Promise<any>;
}

export interface VfsNodesRepositoryLike {
  listChildrenByParentId(params: any): Promise<any[]>;
  resolveNodeByPath(params: any): Promise<any>;
  ensureDirectoryPath(params: any): Promise<any>;
  createDirectory(params: any): Promise<any>;
  createFileNode(params: any): Promise<any>;
  renameNode(params: any): Promise<any>;
  moveNode(params: any): Promise<any>;
  deleteNode(params: any): Promise<any>;
  getNodeById(params: any): Promise<any>;
}

export interface MetricsCacheRepositoryLike {
  getEntry(scopeType: string, scopeId: string, metricKey: string): Promise<any>;
  upsertEntry(params: any): Promise<any>;
  deleteEntry(scopeType: string, scopeId: string, metricKey: string): Promise<any>;
}

export interface RepositoryFactoryLike {
  getMountRepository(): MountRepositoryLike;
  getUploadPartsRepository(): UploadPartsRepositoryLike;
  getVfsNodesRepository(): VfsNodesRepositoryLike;
  getMetricsCacheRepository(): MetricsCacheRepositoryLike;
}

/**
 * 從請求上下文裡拿/快取 RepositoryFactory
 */
export function useRepositories(c: any): RepositoryFactoryLike;

/**
 * 保證拿到 RepositoryFactory：
 * - 傳了 repositoryFactory 就直接用
 * - 否則用 db + env 建立一個新的
 */
export function ensureRepositoryFactory(
  db: any,
  repositoryFactory?: RepositoryFactoryLike | null,
  env?: any,
): RepositoryFactoryLike;

/**
 * 可選中介軟體：確保每次請求都有 RepositoryFactory
 */
export function withRepositories(): (c: any, next: () => Promise<void>) => Promise<void>;
