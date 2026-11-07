/**
 * S3目錄操作模組
 * 負責目錄相關操作：列出內容、建立目錄、刪除目錄等
 */

import { NotFoundError } from "../../../../http/errors.js";
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { checkDirectoryExists, updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { applyS3RootPrefix, isMountRootPath, normalizeS3SubPath } from "../utils/S3PathUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { buildFileInfo } from "../../../utils/FileInfoBuilder.js";

export class S3DirectoryOperations {
  /**
   * 建構函式
   * @param {S3Client} s3Client - S3客戶端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密金鑰
   */
  constructor(s3Client, config, encryptionSecret) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 獲取S3目錄的修改時間（僅從目錄標記物件獲取）
   *
   * @param {S3Client} s3Client - S3客戶端例項
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} prefix - 目錄字首
   * @returns {Promise<string|null>} 目錄修改時間的ISO字串；未知返回 null
   */
  async getS3DirectoryModifiedTime(s3Client, bucketName, prefix) {
    try {
      // 檢查是否存在目錄標記物件
      const headParams = {
        Bucket: bucketName,
        Key: prefix, // prefix 應該已經以 '/' 結尾
      };

      const headCommand = new HeadObjectCommand(headParams);
      const headResponse = await s3Client.send(headCommand);

      // 如果目錄標記物件存在，使用其修改時間
      if (headResponse.LastModified) {
        return headResponse.LastModified.toISOString();
      }
    } catch (error) {
      // 如果目錄標記物件不存在：目錄時間未知
      if (error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }

    return null;
  }

  /**
   * S3 專用：一次掃描當前目錄 prefix 下的所有物件，批次得到“當前目錄的直接子目錄”的摘要（size / modified）
   * - 目標：避免對每個子目錄分別遞迴 list，導致 N 倍放大（S3 大目錄會非常慢/貴）
   * - 只統計“子目錄內的檔案物件”（忽略以 / 結尾的目錄標記物件），更貼近“內容大小/內容更新時間”的語義
   * - modified 取該子目錄下所有檔案的 LastModified 最大值；如果子目錄完全沒有檔案，則 modified=null
   *
   * @param {string} relativeSubPath - 當前目錄在掛載內的相對路徑（例如 / 或 /a/b/）
   * @param {Map<string, string>} childDirNameToFsPath - 直接子目錄名 => FS 路徑（/mount/child/）
   * @param {{refresh?: boolean}} options - 選項
   * @returns {Promise<{results: Map<string, {size:number, modified:(string|null), completed:boolean, calculatedAt:string}>, completed:boolean, visited:number}>}
   */
  async computeDirectChildDirSummaries(relativeSubPath, childDirNameToFsPath, options = {}) {
    const maxItems = 20000;
    const maxMs = 5000;
    const startedAt = Date.now();

    const childNames = Array.from(childDirNameToFsPath?.keys?.() ?? []);
    const totals = new Map();
    for (const name of childNames) {
      const dirPath = childDirNameToFsPath.get(name);
      if (!dirPath) continue;
      totals.set(dirPath, { size: 0, latestModifiedMs: 0 });
    }

    let visited = 0;
    let completed = true;
    let continuationToken = undefined;

    const s3SubPath = normalizeS3SubPath(relativeSubPath, true);
    let fullPrefix = applyS3RootPrefix(this.config, s3SubPath);
    if (fullPrefix && !fullPrefix.endsWith("/")) fullPrefix += "/";
    const effectivePrefix = fullPrefix ? String(fullPrefix) : "";

    while (true) {
      if (Date.now() - startedAt > maxMs || visited >= maxItems) {
        completed = false;
        break;
      }

      const cmd = new ListObjectsV2Command({
        Bucket: this.config.bucket_name,
        Prefix: effectivePrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });
      const resp = await this.s3Client.send(cmd);
      const objects = Array.isArray(resp?.Contents) ? resp.Contents : [];

      for (const obj of objects) {
        visited += 1;
        if (visited >= maxItems) {
          completed = false;
          break;
        }

        const key = typeof obj?.Key === "string" ? obj.Key : "";
        if (!key) continue;

        // 忽略目錄標記物件（key 以 / 結尾）
        if (key.endsWith("/")) {
          continue;
        }

        // 取出當前目錄 prefix 之後的相對路徑
        const relative = effectivePrefix ? key.slice(effectivePrefix.length) : key;
        if (!relative) continue;

        // 只關心屬於“直接子目錄”的物件：relative 形如 "child/xxx"
        const slashIdx = relative.indexOf("/");
        if (slashIdx <= 0) {
          // 檔案直接在當前目錄下，不屬於任何子目錄
          continue;
        }

        const childName = relative.slice(0, slashIdx);
        const childDirPath = childDirNameToFsPath.get(childName) || null;
        if (!childDirPath) continue;

        const entry = totals.get(childDirPath);
        if (!entry) continue;

        const size = typeof obj?.Size === "number" && Number.isFinite(obj.Size) && obj.Size >= 0 ? obj.Size : 0;
        entry.size += size;

        const lm = obj?.LastModified instanceof Date ? obj.LastModified : obj?.LastModified ? new Date(obj.LastModified) : null;
        const ms = lm ? lm.getTime() : 0;
        if (Number.isFinite(ms) && ms > entry.latestModifiedMs) {
          entry.latestModifiedMs = ms;
        }
      }

      if (!resp?.IsTruncated) {
        break;
      }
      if (!resp?.NextContinuationToken) {
        break;
      }
      continuationToken = resp.NextContinuationToken;
    }

    const results = new Map();
    for (const [dirPath, entry] of totals.entries()) {
      results.set(dirPath, {
        size: entry.size,
        modified: entry.latestModifiedMs > 0 ? new Date(entry.latestModifiedMs).toISOString() : null,
        completed,
        calculatedAt: new Date().toISOString(),
      });
    }

    return { results, completed, visited };
  }

  /**
   * 列出目錄內容
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @param {boolean} options.refresh - 是否強制重新整理，跳過快取
   * @returns {Promise<Object>} 目錄內容
   */
  async listDirectory(s3SubPath, options = {}) {
    const { mount, subPath, db, refresh = false, path } = options;

    return handleFsError(
      async () => {
        // 目錄分頁（可選）
        // - cursor：ContinuationToken（不透明字串）
        // - limit：單頁最多數量（S3 上限 1000）
        const cursorRaw = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
        const limitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
        const limit =
          limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : null;
        const paged = options?.paged === true || !!cursorRaw || limit != null;

        // 構造返回結果結構
        const result = {
          path,
          type: "directory",
          isRoot: false,
          isVirtual: false,
          mount_id: mount.id,
          storage_type: mount.storage_type,
          items: [],
        };

        let fullPrefix = applyS3RootPrefix(this.config, s3SubPath);
        if (fullPrefix && !fullPrefix.endsWith("/")) fullPrefix += "/";

        const prefixLength = fullPrefix.length;
        const separator = subPath.endsWith("/") ? "" : "/";

        // 去重：ContinuationToken 分頁下理論上不重複，但穩妥起見做一次去重
        const seenPaths = new Set();

        const appendFromResponse = async (response) => {
          // 處理公共字首（目錄）
          if (response?.CommonPrefixes) {
            for (const prefix of response.CommonPrefixes) {
              const prefixKey = prefix?.Prefix;
              if (!prefixKey || typeof prefixKey !== "string") continue;
              const relativePath = prefixKey.substring(prefixLength);
              const dirName = relativePath.replace(/\/$/, "");
              if (!dirName) continue;

              // S3 沒有“目錄”的原生後設資料（CommonPrefixes 不包含 LastModified/Size）。
              // 這裡不做遞迴計算/額外 HEAD，把目錄 size/modified 交給上層兜底：
              // storage(本驅動返回 null) > compute(可選) > index > -
              const directoryModified = null;
              const directorySize = null;

              const dirPath = mount.mount_path + subPath + separator + dirName + "/";
              if (seenPaths.has(dirPath)) continue;
              seenPaths.add(dirPath);

              const dirInfo = await buildFileInfo({
                fsPath: dirPath,
                name: dirName,
                isDirectory: true,
                size: directorySize,
                modified: directoryModified,
                mimetype: "application/x-directory",
                mount,
                storageType: mount.storage_type,
                db,
              });

              result.items.push({ ...dirInfo, isVirtual: false });
            }
          }

          // 處理內容（檔案）
          if (response?.Contents) {
            for (const content of response.Contents) {
              const key = content?.Key;
              if (!key || typeof key !== "string") continue;

              // 跳過作為目錄標記的物件
              if (key === fullPrefix || key === fullPrefix + "/") continue;

              // 從S3 key中提取相對路徑和名稱
              const relativePath = key.substring(prefixLength);
              if (!relativePath) continue;

              // 跳過巢狀在子目錄中的檔案
              if (relativePath.includes("/")) continue;

              const itemPath = mount.mount_path + subPath + separator + relativePath;
              if (seenPaths.has(itemPath)) continue;
              seenPaths.add(itemPath);

              const info = await buildFileInfo({
                fsPath: itemPath,
                name: relativePath,
                isDirectory: false,
                size: content.Size,
                modified: content.LastModified ? content.LastModified : null,
                mimetype: null,
                mount,
                storageType: mount.storage_type,
                db,
              });

              result.items.push({
                ...info,
                etag: content.ETag ? content.ETag.replace(/"/g, "") : undefined,
              });
            }
          }
        };

        const fetchPage = async (continuationToken) => {
          const listParams = {
            Bucket: this.config.bucket_name,
            Prefix: fullPrefix,
            Delimiter: "/",
            MaxKeys: limit ?? 1000,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          };
          const listCommand = new ListObjectsV2Command(listParams);
          return await this.s3Client.send(listCommand);
        };

        let continuationToken = cursorRaw;
        let nextCursor = null;
        let hasMore = false;

        if (paged) {
          const response = await fetchPage(continuationToken);
          await appendFromResponse(response);
          nextCursor = response?.NextContinuationToken ? String(response.NextContinuationToken) : null;
          hasMore = !!(response?.IsTruncated && nextCursor);
        } else {
          while (true) {
            const response = await fetchPage(continuationToken);
            await appendFromResponse(response);

            nextCursor = response?.NextContinuationToken ? String(response.NextContinuationToken) : null;
            if (!response?.IsTruncated || !nextCursor) break;
            if (nextCursor === continuationToken) break;
            continuationToken = nextCursor;
          }
        }

        // 按名稱排序
        result.items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          ...result,
          ...(paged ? { hasMore, nextCursor: hasMore ? nextCursor : null } : {}),
        };
      },
      "列出目錄",
      "列出目錄失敗"
    );
  }

  /**
   * 建立目錄
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 建立結果
   */
  async createDirectory(s3SubPath, options = {}) {
    const { mount, subPath, path, db } = options;

    return handleFsError(
      async () => {
        // 特殊處理：如果s3SubPath為掛載點根目錄，直接返回成功
        // 因為掛載點根目錄在邏輯上總是存在的，不需要在S3中建立
        if (isMountRootPath(s3SubPath)) {
          console.log(`跳過建立掛載點根目錄（邏輯上總是存在）: "${s3SubPath}"`);
          return {
            success: true,
            path: path,
            message: "掛載點根目錄總是存在",
          };
        }

        // nginx風格的遞迴建立功能：自動建立所有需要的中間目錄
        // 參考nginx WebDAV模組的create_full_put_path功能
        console.log(`開始遞迴建立目錄: ${s3SubPath}`);
        await this._ensureParentDirectoriesExist(s3SubPath);


        return {
          success: true,
          path: path,
          message: "目錄建立成功",
        };
      },
      "建立目錄",
      "建立目錄失敗"
    );
  }

  /**
   * 確保父目錄存在，如果不存在則遞迴建立
   * @param {string} s3SubPath - S3子路徑
   * @private
   */
  async _ensureParentDirectoriesExist(s3SubPath) {
    const pathParts = s3SubPath.split("/").filter(Boolean);

    // 如果是根目錄或只有一級目錄，不需要檢查父目錄
    if (pathParts.length <= 1) {
      return await this._createSingleDirectory(s3SubPath);
    }

    // 遞迴建立所有父目錄
    let currentPath = "";
    for (let i = 0; i < pathParts.length; i++) {
      currentPath += pathParts[i] + "/";

      // 檢查當前目錄是否存在
      const currentKey = applyS3RootPrefix(this.config, currentPath);
      const exists = await checkDirectoryExists(this.s3Client, this.config.bucket_name, currentKey);

      if (!exists) {
        console.log(`遞迴建立目錄 - 建立中間目錄: ${currentKey}`);
        await this._createSingleDirectory(currentPath);
      }
    }
  }

  /**
   * 建立單個目錄（不檢查父目錄）
   * @param {string} s3SubPath - S3子路徑
   * @private
   */
  async _createSingleDirectory(s3SubPath) {
    // 特殊處理：如果s3SubPath為掛載點根目錄，直接返回成功
    // 因為S3中不能建立空Key的物件，而掛載點根目錄在邏輯上總是存在的
    if (isMountRootPath(s3SubPath)) {
      console.log(`跳過建立掛載點根目錄（S3不支援空Key）: "${s3SubPath}"`);
      return {
        success: true,
        message: "掛載點根目錄總是存在",
      };
    }

    const fullKey = applyS3RootPrefix(this.config, s3SubPath);

    // 檢查目錄是否已存在
    try {
      const headParams = {
        Bucket: this.config.bucket_name,
        Key: fullKey,
      };

      const headCommand = new HeadObjectCommand(headParams);
      await this.s3Client.send(headCommand);

      // 如果沒有丟擲異常，說明目錄已存在，直接返回成功
      console.log(`目錄已存在，跳過建立: ${fullKey}`);
      return {
        success: true,
        message: "目錄已存在",
      };
    } catch (error) {
      if (error.$metadata && error.$metadata.httpStatusCode === 404) {
        // 目錄不存在，可以建立
        const putParams = {
          Bucket: this.config.bucket_name,
          Key: fullKey,
          Body: Buffer.from("", "utf-8"),
          ContentType: "application/x-directory",
        };

      const putCommand = new PutObjectCommand(putParams);
      await this.s3Client.send(putCommand);

      // 更新父目錄的修改時間
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix);

        console.log(`成功建立目錄: ${fullKey}`);
        return {
          success: true,
          message: "目錄建立成功",
        };
      }

      // 其他錯誤則丟擲
      throw error;
    }
  }

  /**
   * 遞迴刪除S3目錄
   * @param {S3Client} s3Client - S3客戶端例項
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} prefix - 目錄字首
   * @param {string} storageConfigId - 儲存配置ID
   * @returns {Promise<void>}
   */
  async deleteDirectoryRecursive(s3Client, bucketName, prefix, storageConfigId) {
    let continuationToken = undefined;

    try {
      do {
        const listParams = {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(listCommand);

        if (response.Contents && response.Contents.length > 0) {
          // 批次刪除物件
          const deletePromises = response.Contents.map(async (item) => {
            const deleteParams = {
              Bucket: bucketName,
              Key: item.Key,
            };

            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const deleteCommand = new DeleteObjectCommand(deleteParams);
            await s3Client.send(deleteCommand);

            // 檔案刪除完成，無需資料庫操作
          });

          await Promise.all(deletePromises);
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      console.log(`成功刪除目錄: ${prefix}`);
    } catch (error) {
      console.error(`刪除目錄失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 檢查目錄是否存在
   * @param {string} s3SubPath - S3子路徑
   * @returns {Promise<boolean>} 是否存在
   */
  async directoryExists(s3SubPath) {
    const key = applyS3RootPrefix(this.config, s3SubPath);
    return await checkDirectoryExists(this.s3Client, this.config.bucket_name, key);
  }

  /**
   * 獲取目錄資訊（作為目錄處理）
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 目錄資訊
   */
  async getDirectoryInfo(s3SubPath, options = {}) {
    const { mount, path } = options;

    // 特殊處理：掛載點根目錄（空路徑）總是存在
    if (s3SubPath === "" || s3SubPath === "/") {
      console.log(`getDirectoryInfo - 掛載點根目錄總是存在: ${path}`);
      const info = await buildFileInfo({
        fsPath: path,
        name: path.split("/").filter(Boolean).pop() || "/",
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount.storage_type,
        db: null,
      });
      return info;
    }

    // 嘗試作為目錄處理
    const dirPath = s3SubPath.endsWith("/") ? s3SubPath : s3SubPath + "/";
    const fullDirPath = applyS3RootPrefix(this.config, dirPath);

    const listParams = {
      Bucket: this.config.bucket_name,
      Prefix: fullDirPath,
      MaxKeys: 1,
    };

    const listCommand = new ListObjectsV2Command(listParams);
    const listResponse = await this.s3Client.send(listCommand);

    // 如果有內容，說明是目錄
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // 獲取目錄的真實修改時間
      let directoryModified = null;
      try {
        directoryModified = await this.getS3DirectoryModifiedTime(this.s3Client, this.config.bucket_name, fullDirPath);
      } catch (error) {
        console.warn(`獲取目錄修改時間失敗:`, error);
      }

      const info = await buildFileInfo({
        fsPath: path,
        name: path.split("/").filter(Boolean).pop() || "/",
        isDirectory: true,
        size: null,
        modified: directoryModified ? new Date(directoryModified) : null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount.storage_type,
        db: null,
      });
      return info;
    }

    throw new NotFoundError("目錄不存在");
  }
}
