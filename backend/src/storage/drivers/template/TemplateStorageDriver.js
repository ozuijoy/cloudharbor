/**
 * TemplateStorageDriver
 *
 * 官方儲存驅動模板：
 * - 僅作為"如何實現 storage-driver 契約"的示例與腳手架
 * - 不會被 StorageFactory 註冊或在生產環境中直接使用
 *
 * 使用方式：
 * - 新增驅動時建議複製本檔案，替換類名與 type，並按註釋逐個實現方法；
 * - 根據目標後端實際能力調整 this.capabilities（例如是否支援 DIRECT_LINK / PROXY / MULTIPART）；
 *
 * ========== 返回值契約規範（所有驅動必須遵循）==========
 *
 * renameItem: 返回 { success: boolean, source: string, target: string, message?: string }
 * copyItem:   返回 { status: "success"|"skipped"|"failed", source: string, target: string, message?: string, skipped?: boolean, reason?: string }
 * batchRemoveItems: 返回 { success: number, failed: Array<{path, error}>, results?: Array<{path, success, error?}> }
 * uploadFile: 返回 { success: boolean, storagePath: string, message?: string }
 * createDirectory: 返回 { success: boolean, path: string, alreadyExists?: boolean }
 * listDirectory: 返回 { path, type: "directory", isRoot, isVirtual, mount_id?, storage_type?, items: Array<FileInfo> }
 * getFileInfo: 返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName, mount_id?, storage_type? }
 * downloadFile: 返回 StorageStreamDescriptor 物件
 * StreamHandle 結構：
 * - stream: NodeReadable | ReadableStream  - 可讀流（Node 環境用 NodeReadable，Worker 用 ReadableStream）
 * - close(): Promise<void>                 - 顯式關閉方法
 * - Node 環境下優先使用 NodeReadable（避免 WebStreams 橋接問題）
 * - getRange 為可選實現，未實現時 StorageStreaming 層會降級處理
 *
 * ========== 統一抽象==========
 *
 * 1）FileInfo 構造統一規範（backend/src/storage/utils/FileInfoBuilder.js）
 *   - listDirectory / getFileInfo / search 等場景應透過 buildFileInfo 構造 FileInfo：
 *     - 傳入：fsPath、name、isDirectory、size、modified、mimetype、mount、storageType、db
 *     - 禁止在驅動內部手動拼裝 { path/name/isDirectory/size/modified/mimetype/type/typeName/mount_id/storage_type }，
 *       所有型別與顯示名稱推斷統一交給 FileInfoBuilder 處理。
 *
 * 2）下載流 StorageStreamDescriptor 統一規範（backend/src/storage/streaming/StreamDescriptorUtils.js）
 *   - 本地檔案（Node）：使用 createNodeStreamDescriptor({ openStream, openRangeStream?, size, contentType, etag, lastModified })
 *   - HTTP/WebDAV：使用 createHttpStreamDescriptor({ fetchResponse, size?, contentType?, etag?, lastModified?, supportsRange? })
 *   - Provider SDK 返回 Web ReadableStream（如 S3 / OneDrive / GoogleDrive）：
 *     - 優先使用 createWebStreamDescriptor({ openStream, size?, contentType?, etag?, lastModified? })
 *     - 或按需使用 createGenericStreamDescriptor({ stream, size?, contentType?, etag?, lastModified? })
 *   - downloadFile 只負責呼叫後端 SDK / HTTP 介面，返回上述工廠函式構造的 StorageStreamDescriptor，
 *     Range / 條件請求 / 軟切片等細節統一由 StorageStreaming 層處理。
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export class TemplateStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  儲存配置物件
   * @param {string} encryptionSecret 加密金鑰
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "TEMPLATE";
    this.encryptionSecret = encryptionSecret;
    // 預設模板給出 READER + WRITER 能力示例，開發者可根據需要追加 DIRECT_LINK / PROXY / MULTIPART / ATOMIC 等
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.WRITER];
  }

  /**
   * 初始化儲存驅動（示例）
   * - 在真實驅動中應在此建立底層 client / 連線，並設定 this.initialized = true
   */
  async initialize() {
    // TODO: 在此初始化底層 client/連線（例如 S3Client/WebDAV client 等）
    this.initialized = true;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目錄內容
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/userType 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 listDirectory 邏輯（參考 S3/WebDAV 驅動的目錄列表實現）");
  }

  /**
   * 獲取檔案或目錄資訊
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 getFileInfo 邏輯（參考 S3/WebDAV 驅動的檔案資訊實現）");
  }

  /**
   * 下載檔案，返回 StorageStreamDescriptor
   * Node 環境下優先使用 NodeReadable（fs.createReadStream 等）
   * Worker 環境下使用 Web ReadableStream
   *
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 downloadFile 邏輯，返回 StorageStreamDescriptor（參考 LocalStorageDriver 的實現）");
  }

  // ========== WRITER 能力：uploadFile / createDirectory / rename / copy / remove ==========

  /**
   * 統一上傳入口（檔案 / 流）
   * @param {string} subPath       掛載內子路徑（subPath-only）
   * @param {any} fileOrStream     資料來源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文選項（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 uploadFile 邏輯（可區分流式上傳與表單上傳）");
  }

  /**
   * 建立目錄
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（mount/path/subPath/db 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 createDirectory 邏輯");
  }

  /**
   * 重新命名檔案或目錄
   * @param {string} oldSubPath 原子路徑（subPath-only）
   * @param {string} newSubPath 新子路徑（subPath-only）
   * @param {Object} ctx        上下文選項（oldPath/newPath/oldSubPath/newSubPath/...）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 renameItem 邏輯");
  }

  /**
   * 批次刪除檔案/目錄
   * @param {Array<string>} subPaths 子路徑陣列（subPath-only）
   * @param {Object} ctx            上下文選項（paths/subPaths/mount/...）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 batchRemoveItems 邏輯");
  }

  /**
   * 複製單個檔案或目錄
   * @param {string} sourceSubPath 源子路徑（subPath-only）
   * @param {string} targetSubPath 目標子路徑（subPath-only）
   * @param {Object} ctx            上下文選項（sourcePath/targetPath/sourceSubPath/targetSubPath/...）
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此實現 copyItem 邏輯");
  }

  // ========== 可選方法：search / getStats ==========

  /**
   * 獲取儲存驅動統計資訊（可選實現）
   * @returns {Promise<Object>} 統計資訊
   */
  async getStats() {
    this._ensureInitialized();
    return {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 基礎存在性檢查（必需契約）
   * - 建議：物件儲存用 HeadObject/Stat，WebDAV 用 PROPFIND/exists
   * - 返回 boolean；異常時可選擇返回 false 或丟擲 DriverError 交由上層處理
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請實現 exists 邏輯（HEAD/STAT/PROPFIND 等）並返回 boolean");
  }

  // ========== DIRECT_LINK 能力（可選）：generateDownloadUrl ==========

  /**
   * 生成下載直鏈（DIRECT_LINK 能力）
   * - 最小要求：返回 { url, type }，其中 type 為 "custom_host" 或 "native_direct"
   * - 其餘欄位（expiresIn/expiresAt 等）視需要擴充套件
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/request/forceDownload/...）
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 如需支援直鏈能力，請在此實現 generateDownloadUrl，並返回 { url, type }");
  }

  // ========== PROXY 能力（可選）：generateProxyUrl ==========

  /**
   * 生成代理 URL（PROXY 能力）
   * - 返回 { url, type: \"proxy\", channel? }
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/request/download/channel/...）
   */
  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 如需支援代理能力，請在此實現 generateProxyUrl，並返回 { url, type: 'proxy' }");
  }

  // ========== MULTIPART 能力（可選）：前端分片上傳生命週期 ==========

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 initializeFrontendMultipartUpload（參考 MultipartCapable 契約文件）");
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 completeFrontendMultipartUpload（參考 MultipartCapable 契約文件）");
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 abortFrontendMultipartUpload（參考 MultipartCapable 契約文件）");
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 listMultipartUploads（用於斷點續傳場景）");
  }

  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 listMultipartParts（用於恢復已上傳分片）");
  }

  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 請在此根據目標後端實現 signMultipartParts（獲取/重新整理上傳引數或會話資訊）");
  }
}
