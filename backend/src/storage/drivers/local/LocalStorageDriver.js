/**
 * LocalStorageDriver
 *
 * 本地檔案系統儲存驅動：
 * - 僅在 Node/Docker 環境下可用（依賴 Node.js fs/path 能力）
 * - 透過 root_path 作為監獄根目錄，所有操作必須限制在該目錄內
 * - 嚴格遵守 storage-driver READER / WRITER / ATOMIC 契約與返回結構
 */

import fs from "fs";
import path from "path";

import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus, FILE_TYPES } from "../../../constants/index.js";
import { DriverError, AppError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment } from "../../../utils/environmentUtils.js";
import { getEffectiveMimeType } from "../../../utils/fileUtils.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createNodeStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";

export class LocalStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  儲存配置物件（應包含 root_path 等欄位）
   * @param {string} encryptionSecret 加密金鑰（為保持介面一致，LOCAL 當前不使用）
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "LOCAL";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
    ];

    /** @type {string|null} root_path 規範化後的監獄根目錄 */
    this.rootPath = null;

    // 是否啟用“磁碟配額讀取”
    this.enableDiskUsage = config?.enable_disk_usage === 1;
  }

  /**
   * 初始化 LocalStorageDriver
   * - 校驗執行環境（必須是 Node.js 且非 Cloudflare Worker）
   * - 校驗並規範化 root_path
   */
  async initialize() {
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();

    if (inWorker || !inNode) {
      throw new DriverError("LOCAL 驅動僅在 Node/Docker 環境可用", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_UNSUPPORTED_ENV",
        expose: false,
        details: {
          isCloudflareWorkerEnvironment: inWorker,
          isNodeJSEnvironment: inNode,
        },
      });
    }

    const rootPathRaw = this.config?.root_path;
    if (!rootPathRaw || typeof rootPathRaw !== "string") {
      throw new DriverError("LOCAL 驅動缺少必填配置 root_path", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_INVALID_CONFIG",
        expose: true,
      });
    }

    if (!path.isAbsolute(rootPathRaw)) {
      throw new DriverError("LOCAL 驅動 root_path 必須是絕對路徑", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_INVALID_ROOT_PATH",
        expose: true,
      });
    }

    const resolvedRoot = path.resolve(rootPathRaw);

    // 解析許可權配置（八進位制字串 -> 整數）
    // 僅使用單一配置 dir_permission，同時應用於目錄與檔案，預設 0777（主要面向單機自託管場景）
    const basePermission = this._parseOctalPermission(this.config?.dir_permission, 0o777);
    // 是否允許在根目錄不存在時自動建立（預設關閉，保持顯式運維語義）
    const autoCreateRoot =
      this.config && Object.prototype.hasOwnProperty.call(this.config, "auto_create_root")
        ? this.config.auto_create_root === 1
        : false;

    let stat;
    try {
      stat = await fs.promises.stat(resolvedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        // 根目錄不存在時，根據 auto_create_root 決定是否自動建立
        if (!autoCreateRoot) {
          throw new DriverError("LOCAL 驅動 root_path 不存在，請先在宿主機上手動建立該目錄", {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.LOCAL_ROOT_NOT_FOUND",
            expose: true,
            details: { path: resolvedRoot },
          });
        }

        try {
          await fs.promises.mkdir(resolvedRoot, { recursive: true, mode: basePermission });
          stat = await fs.promises.stat(resolvedRoot);
        } catch (createError) {
          throw new DriverError("LOCAL 驅動 root_path 不存在且自動建立失敗", {
            status: ApiStatus.INTERNAL_ERROR,
            code: "DRIVER_ERROR.LOCAL_ROOT_CREATE_FAILED",
            expose: true,
            details: { path: resolvedRoot, cause: createError?.message },
          });
        }
      } else {
        throw new DriverError("LOCAL 驅動 root_path 不存在或不可訪問", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.LOCAL_ROOT_NOT_ACCESSIBLE",
          expose: false,
          details: { path: resolvedRoot, cause: error?.message },
        });
      }
    }

    if (!stat.isDirectory()) {
      throw new DriverError("LOCAL 驅動 root_path 必須是目錄", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_ROOT_NOT_DIRECTORY",
        expose: true,
      });
    }

    // 可讀檢查
    try {
      await fs.promises.access(resolvedRoot, fs.constants.R_OK);
    } catch (error) {
      throw new DriverError("LOCAL 驅動 root_path 不可讀", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_ROOT_NOT_READABLE",
        expose: true,
        details: { path: resolvedRoot, cause: error?.message },
      });
    }

    // 寫入能力只在非只讀配置下強制檢查
    if (!this.config?.readonly) {
      try {
        await fs.promises.access(resolvedRoot, fs.constants.W_OK);
      } catch (error) {
        throw new DriverError("LOCAL 驅動 root_path 不可寫", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_ROOT_NOT_WRITABLE",
          expose: true,
          details: { path: resolvedRoot, cause: error?.message },
        });
      }
    }

    this.rootPath = resolvedRoot;

    // 將統一的許可權配置應用到目錄與檔案
    this.dirPermission = basePermission;
    this.filePermission = basePermission;

    // 解析回收站路徑配置
    this.trashPath = null;
    if (this.config?.trash_path) {
      const trashPathRaw = this.config.trash_path;
      // 支援相對路徑（相對於 root_path）和絕對路徑
      const resolvedTrash = path.isAbsolute(trashPathRaw)
        ? path.resolve(trashPathRaw)
        : path.resolve(resolvedRoot, trashPathRaw);
      this.trashPath = resolvedTrash;
    }

    this.initialized = true;
  }

  /**
   * 獲取儲存驅動統計資訊（可選實現）
   * - 對 LOCAL：這裡返回的是“宿主機磁碟/分割槽”的總量與可用量（類似 df），不是“目錄佔用”
   * - 目錄佔用（local_fs）屬於 computed_usage 的來源，由 StorageUsageService 掃 root_path 計算
   *
   * @returns {Promise<Object>}
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      rootPath: this.rootPath,
      timestamp: new Date().toISOString(),
      enableDiskUsage: this.enableDiskUsage,
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "LOCAL 磁碟佔用統計未啟用（enable_disk_usage = false）",
      };
    }

    // Node.js 18+ 支援 fs.promises.statfs；用於讀取檔案系統容量（Windows/Linux/macOS）
    if (typeof fs.promises.statfs !== "function") {
      return {
        ...base,
        supported: false,
        message: "當前 Node.js 版本不支援 statfs，無法讀取磁碟容量資訊",
      };
    }

    try {
      const st = await fs.promises.statfs(this.rootPath);
      const frsize = Number(st?.frsize || st?.bsize || 0);
      const blocks = Number(st?.blocks || 0);
      const bavail = Number(st?.bavail || 0);
      if (!Number.isFinite(frsize) || !Number.isFinite(blocks) || frsize <= 0 || blocks <= 0) {
        return {
          ...base,
          supported: false,
          message: "讀取磁碟容量資訊失敗（statfs 返回值無效）",
        };
      }

      const totalBytes = Math.max(0, Math.trunc(frsize * blocks));
      const remainingBytes = Math.max(0, Math.trunc(frsize * bavail));
      const usedBytes = totalBytes > 0 ? Math.max(0, totalBytes - remainingBytes) : null;

      let usagePercent = null;
      if (totalBytes > 0 && usedBytes != null) {
        usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
      }

      return {
        ...base,
        supported: true,
        quota: {
          raw: st,
          totalBytes,
          usedBytes,
          remainingBytes,
          usagePercent,
        },
      };
    } catch (error) {
      return {
        ...base,
        supported: false,
        message: error?.message || String(error),
      };
    }
  }

  /**
   * 解析八進位制許可權字串
   * @param {string|undefined} value - 許可權字串（如 "0755"）
   * @param {number} defaultValue - 預設值
   * @returns {number} 解析後的許可權整數
   */
  _parseOctalPermission(value, defaultValue) {
    if (!value) return defaultValue;
    const parsed = parseInt(String(value), 8);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * 確保當前配置允許寫操作（非只讀）
   * - 只讀模式下所有寫入/刪除類操作應立即失敗
   */
  _ensureWritable() {
    if (this.config?.readonly) {
      throw new DriverError("LOCAL 儲存當前為只讀模式，禁止寫入和刪除操作", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_READONLY",
        expose: true,
      });
    }
  }

  /**
   * 將檔案/目錄移動到回收站
   * @param {string} sourcePath - 原始檔/目錄的完整 OS 路徑
   * @param {boolean} isDirectory - 是否為目錄
   */
  async _moveToTrash(sourcePath, isDirectory) {
    this._ensureWritable();
    if (!this.trashPath) {
      throw new DriverError("回收站路徑未配置", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_TRASH_NOT_CONFIGURED",
        expose: false,
      });
    }

    // 確保回收站目錄存在
    try {
      await fs.promises.mkdir(this.trashPath, { recursive: true, mode: this.dirPermission });
    } catch (error) {
      throw new DriverError("建立回收站目錄失敗", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_TRASH_CREATE_FAILED",
        expose: false,
        details: { path: this.trashPath, cause: error?.message },
      });
    }

    // 生成回收站內的唯一檔名（原名 + 時間戳）
    const baseName = path.basename(sourcePath);
    const timestamp = Date.now();
    const trashName = `${baseName}.${timestamp}`;
    const trashTarget = path.join(this.trashPath, trashName);

    try {
      // 嘗試使用 rename（同一檔案系統內高效移動）
      await fs.promises.rename(sourcePath, trashTarget);
    } catch (renameError) {
      // 如果 rename 失敗（跨檔案系統），回退到複製+刪除
      if (renameError.code === "EXDEV") {
        if (isDirectory) {
          await this._copyDirectoryRecursive(sourcePath, trashTarget);
          await fs.promises.rm(sourcePath, { recursive: true, force: true });
        } else {
          await fs.promises.copyFile(sourcePath, trashTarget);
          await fs.promises.rm(sourcePath, { force: true });
        }
      } else {
        throw new DriverError("移動到回收站失敗", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.LOCAL_TRASH_MOVE_FAILED",
          expose: false,
          details: { source: sourcePath, target: trashTarget, cause: renameError?.message },
        });
      }
    }
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目錄內容
   * @param {string} subPath  掛載內子路徑（以 / 開頭，目錄以 / 結尾）
   * @param {Object} ctx      上下文（mount/path/subPath/db 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath, db } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: true });

    let entries;
    try {
      entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    } catch (error) {
      throw this._wrapFsError(error, "列出目錄失敗");
    }

    const basePath = fsPath;

    const items = await Promise.all(
      entries.map(async (dirent) => {
        const name = dirent.name;
        const sub = this._joinSubPath(effectiveSubPath, name, dirent.isDirectory());

        // 統一透過 _resolveLocalPath 做越界與 symlink 檢查
        const { fullPath: entryOsPath, stat } = await this._resolveLocalPath(sub || "/", {
          mustBeDirectory: dirent.isDirectory(),
        });

        const isDirectory = stat.isDirectory();
        const size = isDirectory ? null : stat.size || 0;
        const modified = stat.mtime ? new Date(stat.mtime) : null;

        const itemMountPath = this._joinMountPath(basePath, name, isDirectory);

        const info = await buildFileInfo({
          fsPath: itemMountPath,
          name,
          isDirectory,
          size,
          modified,
          mimetype: isDirectory ? "application/x-directory" : undefined,
          mount,
          storageType: mount?.storage_type,
          db,
        });

        return {
          ...info,
          isVirtual: false,
        };
      })
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: effectiveSubPath === "" || effectiveSubPath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  /**
   * 獲取檔案或目錄資訊
   * @param {string} subPath 掛載內子路徑（以 / 開頭）
   * @param {Object} ctx     上下文（mount/path/subPath/db 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath, db } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath, stat } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: false });

    const isDirectory = stat.isDirectory();
    const name = this._basename(fsPath);
    const size = isDirectory ? null : stat.size || 0;
    const modified = stat.mtime ? new Date(stat.mtime) : null;
    const mimetype = isDirectory ? "application/x-directory" : undefined;

    // fullPath 當前未直接暴露，僅用於除錯時可從 details 中取
    void fullPath;

    return await buildFileInfo({
      fsPath,
      name,
      isDirectory,
      size,
      modified,
      mimetype,
      mount,
      storageType: mount?.storage_type,
      db,
    });
  }

  /**
   * 下載檔案 - 返回 StorageStreamDescriptor
   * @param {string} subPath 掛載內子路徑
   * @param {Object} ctx     上下文（mount/path/subPath/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath, stat } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: false });

    if (stat.isDirectory()) {
      throw new DriverError("無法直接下載目錄", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_IS_DIRECTORY",
        expose: true,
      });
    }

    const fileName = this._basename(fsPath) || "file";
    const contentType = getEffectiveMimeType(null, fileName) || "application/octet-stream";
    const size = stat.size ?? 0;
    const lastModified = stat.mtime ? new Date(stat.mtime) : new Date();
    const etag = `"${lastModified.getTime()}-${size}"`;

    // 儲存 fullPath 供流工廠使用
    const filePath = fullPath;

    return createNodeStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      async openStream() {
        return fs.createReadStream(filePath);
      },
      async openRangeStream(range) {
        const { start, end } = range;
        return fs.createReadStream(filePath, {
          start,
          end: end !== undefined ? end : undefined,
        });
      },
    });
  }

  // ========== WRITER / ATOMIC 能力：uploadFile / createDirectory / updateFile / batchRemoveItems / renameItem / copyItem ==========

  /**
   * 統一上傳入口（檔案 / 流）
   * @param {string} subPath       目標子路徑（掛載內）
   * @param {any}    fileOrStream  資料來源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();

    const { mount, path: fsPath, filename } = ctx;
    const effectiveSubPath = subPath ?? "";
    const name = filename || this._basename(fsPath);

    const targetSubPath = this._resolveTargetSubPath(effectiveSubPath, name);
    const targetOsPath = await this._buildTargetPath(targetSubPath);

    try {
      await this._writeBodyToFile(targetOsPath, fileOrStream);
      // storagePath 語義對齊：
      // - FS（mount 檢視）：返回掛載路徑（/mount/.../file）
      // - storage-first（ObjectStore / ShareUpload）：返回物件 key（相對 root_path 的子路徑）
      const storagePath = mount ? this._buildMountPath(mount, targetSubPath) : targetSubPath;
      return { success: true, storagePath, message: undefined };
    } catch (error) {
      throw this._wrapFsError(error, "上傳檔案失敗");
    }
  }

  /**
   * 更新檔案內容（覆蓋寫入，語義與 uploadFile 一致）
   * @param {string} subPath  子路徑（subPath-only）
   * @param {string|Uint8Array|ArrayBuffer|ReadableStream|Blob|File} content 新內容
   * @param {Object} ctx      上下文（mount/path/subPath/db 等）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const fsPath = ctx?.path;
    if (typeof fsPath !== "string") {
      throw new ValidationError("LOCAL.updateFile: 缺少 ctx.path（FS 檢視路徑）", { status: ApiStatus.INTERNAL_ERROR });
    }

    const effectiveSubPath = subPath || "";
    const targetSubPath = this._resolveTargetSubPath(effectiveSubPath, this._basename(fsPath));
    const targetOsPath = await this._buildTargetPath(targetSubPath);

    try {
      await this._writeBodyToFile(targetOsPath, content);
      return {
        success: true,
        path: fsPath,
        message: "檔案更新成功",
      };
    } catch (error) {
      throw this._wrapFsError(error, "更新檔案失敗");
    }
  }

  /**
   * 建立目錄
   * @param {string} subPath  目錄子路徑（掛載內）
   * @param {Object} ctx      上下文（mount/path/subPath 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { path: fsPath } = ctx;

    const effectiveSubPath = subPath ?? "";
    const targetOsPath = await this._buildTargetPath(effectiveSubPath || "/");

    try {
      let alreadyExists = false;
      try {
        const stat = await fs.promises.stat(targetOsPath);
        if (stat.isDirectory()) {
          alreadyExists = true;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      if (!alreadyExists) {
        await fs.promises.mkdir(targetOsPath, { recursive: true, mode: this.dirPermission });
      }

      return { success: true, path: fsPath, alreadyExists };
    } catch (error) {
      throw this._wrapFsError(error, "建立目錄失敗");
    }
  }

  /**
   * 批次刪除檔案/目錄
   * @param {Array<string>} subPaths 子路徑陣列（掛載內）
   * @param {Object} ctx           上下文（mount/paths 等）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { paths } = ctx;

    const result = {
      success: 0,
      failed: [],
      results: [],
    };

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return result;
    }

    for (let i = 0; i < subPaths.length; i++) {
      const sub = subPaths[i];
      const p = Array.isArray(paths) ? paths[i] : null;
      try {
        const { fullPath, stat } = await this._resolveLocalPath(sub || "/", { mustBeDirectory: false });

        // 如果配置了回收站路徑，移動到回收站而非永久刪除
        if (this.trashPath) {
          await this._moveToTrash(fullPath, stat.isDirectory());
        } else {
          // 無回收站配置，直接永久刪除
          if (stat.isDirectory()) {
            await fs.promises.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.promises.rm(fullPath, { force: true });
          }
        }
        result.success += 1;
        result.results.push({ path: p || sub, success: true });
      } catch (error) {
        const wrapped =
          error instanceof AppError || error instanceof DriverError ? error : this._wrapFsError(error, "刪除失敗");
        result.failed.push({ path: p || sub, error: wrapped.message });
        result.results.push({ path: p || sub, success: false, error: wrapped.message });
      }
    }

    return result;
  }

  /**
   * 重新命名檔案或目錄（同掛載內）
   * @param {string} oldSubPath 原子路徑（掛載內）
   * @param {string} newSubPath 新子路徑（掛載內）
   * @param {Object} ctx 上下文（mount/oldPath/newPath 等）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { oldPath, newPath } = ctx;

    try {
      const { fullPath: sourceOsPath } = await this._resolveLocalPath(oldSubPath || "/", { mustBeDirectory: false });
      const targetOsPath = await this._buildTargetPath(newSubPath || "/");

      await fs.promises.mkdir(path.dirname(targetOsPath), { recursive: true });
      await fs.promises.rename(sourceOsPath, targetOsPath);

      return {
        success: true,
        source: oldPath,
        target: newPath,
        message: undefined,
      };
    } catch (error) {
      const wrapped = this._wrapFsError(error, "重新命名失敗");
      return {
        success: false,
        source: oldPath,
        target: newPath,
        message: wrapped.message,
      };
    }
  }

  /**
   * 複製單個檔案或目錄（同掛載內）
   * @param {string} sourceSubPath 源子路徑（掛載內）
   * @param {string} targetSubPath 目標子路徑（掛載內）
   * @param {Object} ctx           上下文（mount/sourcePath/targetPath/skipExisting 等）
   * @returns {Promise<{status:string, source:string, target:string, message?:string, skipped?:boolean, reason?:string}>}
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { sourcePath, targetPath, skipExisting = false } = ctx;

    try {
      const { fullPath: sourceOsPath, stat } = await this._resolveLocalPath(sourceSubPath || "/", {
        mustBeDirectory: false,
      });
      const targetOsPath = await this._buildTargetPath(targetSubPath || "/");

      let targetExists = false;
      try {
        const tStat = await fs.promises.stat(targetOsPath);
        if (tStat && (tStat.isFile() || tStat.isDirectory())) {
          targetExists = true;
        }
      } catch {
        targetExists = false;
      }

      if (targetExists && skipExisting) {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目標已存在且 skipExisting=true",
        };
      }

      if (stat.isDirectory()) {
        await this._copyDirectoryRecursive(sourceOsPath, targetOsPath);
      } else {
        await fs.promises.mkdir(path.dirname(targetOsPath), { recursive: true });
        await fs.promises.copyFile(sourceOsPath, targetOsPath);
      }

      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
        skipped: false,
      };
    } catch (error) {
      const wrapped = this._wrapFsError(error, "複製檔案或目錄失敗");
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        skipped: false,
        message: wrapped.message,
      };
    }
  }

  // ========== BaseDriver 必需方法：stat / exists ==========

  /**
   * 獲取檔案或目錄狀態資訊
   * @param {string} subPath  掛載內子路徑（subPath-only）
   * @param {Object} ctx      上下文選項（mount/path/subPath/...）
   */
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  /**
   * 檢查檔案或目錄是否存在
   * @param {string} subPath  掛載內子路徑（subPath-only）
   * @param {Object} ctx      上下文選項（mount/path/subPath/...）
   */
  async exists(subPath, ctx = {}) {
    try {
      await this.getFileInfo(subPath, ctx);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  // ========== PROXY 能力：generateProxyUrl / supportsProxyMode / getProxyConfig ==========

  /**
   * 生成本地 /api/p 代理 URL
   * @param {string} subPath  掛載內子路徑（subPath-only）
   * @param {Object} ctx      選項（path/request/download/channel/...）
   * @param {Request} [ctx.request] 當前請求物件（用於構建絕對 URL）
   * @param {boolean} [ctx.download=false] 是否為下載模式
   * @param {string} [ctx.channel=\"web\"] 呼叫場景標記
   * @returns {Promise<{url:string,type:string,channel:string}>}
   */
  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    // 對 LOCAL 來說，代理 URL 始終是本地 /api/p + 掛載檢視路徑
    const proxyUrl = buildFullProxyUrl(request || null, fsPath, download);
    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * LOCAL 驅動始終支援代理模式（透過本地 /api/p 閘道器）
   * @returns {boolean}
   */
  supportsProxyMode() {
    return true;
  }

  /**
   * 返回代理配置（當前僅暴露 enabled 欄位，與 S3/WebDAV 對齊）
   * @returns {{enabled:boolean}}
   */
  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  // ========== 內部工具方法 ==========

  /**
   * 規範化 FS 檢視子路徑為 posix 相對路徑
   * @param {string} subPath
   * @returns {string}
   */
  _normalizeSubPath(subPath) {
    if (!subPath) return "";
    let normalized = String(subPath).replace(/\\/g, "/");
    normalized = normalized.replace(/\/+/g, "/");
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }
    if (!normalized) return "";
    normalized = normalized === "." ? "" : normalized;
    return normalized;
  }

  /**
   * 寫入路徑安全校驗：
   * - 保證 lexical 上在 root_path 內
   * - 逐級檢查已存在路徑段上的符號連結是否逃逸出 root_path
   * @param {string} fullPath 目標 OS 路徑
   * @private
   */
  async _assertSafePathForWrite(fullPath) {
    const rel = path.relative(this.rootPath, fullPath);
    const segments = rel.split(path.sep).filter(Boolean);

    let current = this.rootPath;
    for (const segment of segments) {
      current = path.join(current, segment);

      let stat;
      try {
        stat = await fs.promises.lstat(current);
      } catch (error) {
        if (error?.code === "ENOENT") {
          // 從第一個不存在的路徑段開始，後續目錄/檔案將由驅動建立，不再存在已有符號連結可逃逸
          break;
        }
        throw this._wrapFsError(error, "訪問本地檔案系統失敗");
      }

      if (!stat.isSymbolicLink()) continue;

      let real;
      try {
        real = await fs.promises.realpath(current);
      } catch (error) {
        throw new DriverError("解析符號連結失敗", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_INVALID",
          expose: true,
          details: { path: current, cause: error?.message },
        });
      }

      const realRel = path.relative(this.rootPath, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new DriverError("符號連結指向 root_path 之外，已被禁止訪問", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_OUT_OF_ROOT",
          expose: true,
        });
      }
    }
  }

  /**
   * 構造寫入目標 OS 路徑（不要求路徑已存在），並做越界與符號連結逃逸檢查
   * @param {string} subPath FS 檢視子路徑
   * @returns {Promise<string>} OS 路徑
   */
  async _buildTargetPath(subPath = "") {
    this._ensureInitialized();
    const safeSubPath = this._normalizeSubPath(subPath);
    const fullPath = path.resolve(this.rootPath, safeSubPath || ".");
    const rel = path.relative(this.rootPath, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new DriverError("路徑越界，已超出 root_path 範圍", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_PATH_OUT_OF_ROOT",
        expose: true,
      });
    }
    await this._assertSafePathForWrite(fullPath);
    return fullPath;
  }

  /**
   * 解析並校驗本地路徑（包含符號連結越界檢查）
   * @param {string} subPath           FS 檢視子路徑
   * @param {Object} options
   * @param {boolean} options.mustBeDirectory 是否要求為目錄
   * @returns {Promise<{fullPath:string, stat:import('fs').Stats}>}
   */
  async _resolveLocalPath(subPath, { mustBeDirectory = false } = {}) {
    this._ensureInitialized();
    const safeSubPath = this._normalizeSubPath(subPath);
    let joined = path.resolve(this.rootPath, safeSubPath || ".");

    const rel = path.relative(this.rootPath, joined);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new DriverError("路徑越界，已超出 root_path 範圍", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_PATH_OUT_OF_ROOT",
        expose: true,
      });
    }

    let stat;
    try {
      stat = await fs.promises.lstat(joined);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw this._wrapFsError(error, "訪問本地檔案系統失敗");
      }
      throw new NotFoundError("檔案或目錄不存在");
    }

    // 符號連結：解析真實路徑並再次檢查是否仍在 root_path 內
    if (stat.isSymbolicLink()) {
      let real;
      try {
        real = await fs.promises.realpath(joined);
      } catch (error) {
        throw new DriverError("解析符號連結失敗", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_INVALID",
          expose: true,
          details: { path: joined, cause: error?.message },
        });
      }
      const realRel = path.relative(this.rootPath, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new DriverError("符號連結指向 root_path 之外，已被禁止訪問", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_OUT_OF_ROOT",
          expose: true,
        });
      }
      const realStat = await fs.promises.stat(real);
      if (mustBeDirectory && !realStat.isDirectory()) {
        throw new DriverError("目標路徑不是目錄", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.LOCAL_NOT_DIRECTORY",
          expose: true,
        });
      }
      return { fullPath: real, stat: realStat };
    }

    if (mustBeDirectory && !stat.isDirectory()) {
      throw new DriverError("目標路徑不是目錄", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_NOT_DIRECTORY",
        expose: true,
      });
    }

    return { fullPath: joined, stat };
  }

  /**
   * 解析寫入目標的子路徑：
   * - subPath 可能已經是完整檔案路徑（末段等於檔名）
   * - 也可能只是目錄路徑，此時需要再拼接檔名
   * 該方法用於 uploadFile / updateFile，避免出現「foo.txt/foo.txt」這類重複檔名路徑
   * @param {string} subPath 原始子路徑（可能為目錄或完整檔案路徑）
   * @param {string} name    檔名
   * @returns {string}       規範化後的目標子路徑（相對於 root_path）
   */
  _resolveTargetSubPath(subPath, name) {
    const safeName = String(name || "").trim();
    const normalized = this._normalizeSubPath(subPath || "");

    // 沒有檔名時，直接返回目錄語義（用於極少數特殊呼叫場景）
    if (!safeName) {
      return normalized || "";
    }

    // 如果 normalized 的最後一段已經等於檔名，說明上層已經給的是完整檔案路徑
    if (normalized) {
      const segments = normalized.split("/").filter(Boolean);
      const last = segments[segments.length - 1] || "";
      if (last === safeName) {
        return normalized;
      }
    }

    // 否則視為目錄路徑，在其後拼接檔名
    if (!normalized) {
      return safeName;
    }
    return `${normalized}/${safeName}`;
  }

  /**
   * 組合 FS 檢視子路徑與名稱
   * @param {string} subPath 當前子路徑
   * @param {string} name    項名稱
   * @param {boolean} isDirectory 是否目錄
   * @returns {string} 新子路徑
   */
  _joinSubPath(subPath, name, isDirectory) {
    const base = subPath && subPath !== "/" ? subPath : "";
    const prefix = base ? (base.startsWith("/") ? base : `/${base}`) : "";
    const full = `${prefix}/${name}`;
    return isDirectory ? `${full}/` : full;
  }

  /**
   * 構造掛載檢視下的目錄路徑
   * @param {Object} mount 掛載物件
   * @param {string} subPath 子路徑
   * @returns {string}
   */
  _buildMountPath(mount, subPath = "") {
    const mountRoot = mount?.mount_path || "/";
    const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const compact = normalized.replace(/\/+/g, "/");
    return mountRoot.endsWith("/")
      ? `${mountRoot.replace(/\/+$/, "")}${compact}`
      : `${mountRoot}${compact}`;
  }

  /**
   * 拼接掛載檢視下的完整路徑
   * @param {string} basePath 掛載根路徑（含子路徑）
   * @param {string} name     項名稱
   * @param {boolean} isDirectory 是否目錄
   */
  _joinMountPath(basePath, name, isDirectory) {
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    return `${normalizedBase}${name}${isDirectory ? "/" : ""}`;
  }

  /**
   * 檔案路徑 basename 輔助
   * @param {string} p
   * @returns {string}
   */
  _basename(p) {
    const parts = (p || "").split("/").filter(Boolean);
    return parts.pop() || "";
  }

  /**
   * 統一包裝 FS 異常為 DriverError
   * @param {Error} error
   * @param {string} message
   */
  _wrapFsError(error, message, status = ApiStatus.INTERNAL_ERROR) {
    if (error instanceof DriverError || error instanceof AppError) return error;
    return new DriverError(message, {
      status,
      expose: status < 500,
      details: { cause: error?.message },
    });
  }

  /**
   * 將上傳體寫入本地檔案
   * - 支援 Node Stream / Web ReadableStream / Buffer / Uint8Array / ArrayBuffer / Blob/File / string
   * @param {string} targetPath OS 目標路徑
   * @param {any} fileOrStream  上傳體
   */
  async _writeBodyToFile(targetPath, fileOrStream) {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true, mode: this.dirPermission });

    const isNodeStream = fileOrStream && (typeof fileOrStream.pipe === "function" || fileOrStream.readable);
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    if (isNodeStream) {
      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(targetPath);
        fileOrStream.on("error", (err) => {
          writeStream.destroy(err);
          reject(err);
        });
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);
        fileOrStream.pipe(writeStream);
      });
      // 應用檔案許可權
      await fs.promises.chmod(targetPath, this.filePermission);
      return;
    }

    // Web ReadableStream：優先使用「邊讀邊寫」的流式落盤
    // 說明：Node/Docker 環境下 /fs/upload 的流式上傳體就是 Web ReadableStream。
    // 如果先整體讀入記憶體再寫檔案，上傳大檔案時記憶體佔用會與檔案大小一致，
    // 容器記憶體較小（如 docker-compose 預設限制）時會被 OOM Kill，
    // 前端表現就是「上傳到一半連線中斷」。這裡改為流式寫入，記憶體佔用恆定。
    if (isWebStream) {
      const streamed = await this._pipeWebStreamToFile(fileOrStream, targetPath);
      if (streamed) {
        await fs.promises.chmod(targetPath, this.filePermission);
        return;
      }
    }

    let buffer;

    // 無法流式寫入時（極少數執行環境）退化為整體讀入 Buffer
    if (isWebStream) {
      buffer = await this._readWebStreamToBuffer(fileOrStream);
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(fileOrStream)) {
      buffer = fileOrStream;
    } else if (fileOrStream instanceof Uint8Array) {
      buffer = Buffer.from(fileOrStream);
    } else if (fileOrStream instanceof ArrayBuffer) {
      buffer = Buffer.from(fileOrStream);
    } else if (fileOrStream && typeof fileOrStream.arrayBuffer === "function") {
      const ab = await fileOrStream.arrayBuffer();
      buffer = Buffer.from(ab);
    } else if (typeof fileOrStream === "string") {
      buffer = Buffer.from(fileOrStream);
    } else {
      throw new DriverError("不支援的上傳體型別", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_UNSUPPORTED_BODY",
        expose: true,
      });
    }

    await fs.promises.writeFile(targetPath, buffer);
    // 應用檔案許可權
    await fs.promises.chmod(targetPath, this.filePermission);
  }

  /**
   * 將 Web ReadableStream 流式寫入目標檔案（邊讀邊寫，不整體駐留記憶體）
   * @param {ReadableStream} stream
   * @param {string} targetPath OS 目標路徑
   * @returns {Promise<boolean>} 是否成功以流式方式寫入；false 表示當前環境不支援，呼叫方需回退
   */
  async _pipeWebStreamToFile(stream, targetPath) {
    let Readable;
    try {
      // 動態匯入：Workers 環境不會走到本地儲存驅動，避免打包時引入 Node 內建模組
      ({ Readable } = await import("node:stream"));
    } catch {
      return false;
    }
    if (!Readable || typeof Readable.fromWeb !== "function") {
      return false;
    }

    let nodeStream;
    try {
      nodeStream = Readable.fromWeb(stream);
    } catch {
      return false;
    }

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(targetPath);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try {
          writeStream.destroy();
        } catch {}
        // 客戶端中途斷開 / 串流錯誤時刪除「寫了一半」的檔案，
        // 避免目錄裡留下損壞的半截檔案（舊版整體讀入記憶體不會產生這種殘留）。
        fs.promises.unlink(targetPath).catch(() => {});
        reject(error);
      };

      nodeStream.on("error", fail);
      writeStream.on("error", fail);
      writeStream.on("finish", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      // 連線中斷時由 'error' 分支清理控制代碼並丟擲錯誤，避免把「寫了一半的檔案」當成成功

      nodeStream.pipe(writeStream);
    });

    return true;
  }

  /**
   * 將 Web ReadableStream 讀入 Buffer
   * @param {ReadableStream} stream
   * @returns {Promise<Buffer|Uint8Array>}
   */
  async _readWebStreamToBuffer(stream) {
    const reader = stream.getReader();
    const chunks = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(typeof Buffer !== "undefined" ? Buffer.from(value) : value);
      }
    }

    if (typeof Buffer !== "undefined") {
      return Buffer.concat(chunks);
    }
    // 在極少數無 Buffer 環境下退化為 Uint8Array 連線
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  /**
   * 遞迴複製目錄內容
   * @param {string} sourceDir 源目錄 OS 路徑
   * @param {string} targetDir 目標目錄 OS 路徑
   */
  async _copyDirectoryRecursive(sourceDir, targetDir) {
    await fs.promises.mkdir(targetDir, { recursive: true });
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const src = path.join(sourceDir, entry.name);
      const dst = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await this._copyDirectoryRecursive(src, dst);
      } else if (entry.isSymbolicLink()) {
        // 為避免 symlink 逃逸，這裡不復制符號連結，直接跳過
        continue;
      } else {
        await fs.promises.copyFile(src, dst);
      }
    }
  }
}
