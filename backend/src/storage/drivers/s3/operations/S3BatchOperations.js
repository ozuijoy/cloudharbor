/**
 * S3批次操作模組
 * 負責批次操作：批次刪除、批次複製、批次移動等
 */

import { ApiStatus } from "../../../../constants/index.js";
/**
 * 模組說明：
 * - 作用域：單一 S3 掛載內的批次刪除、複製、偽原子重新命名，以及目錄層級後設資料維護。
 * - 輸入：僅接受 FS 檢視路徑，內部統一規範化為 S3 Key；跨掛載/跨儲存 orchestrator 由 FS 層處理。
 * - 錯誤：統一經 S3DriverError / handleFsError 封裝，儘量不直接丟擲底層 SDK 原始錯誤。
 */
import { AppError, ValidationError, NotFoundError, ConflictError, AuthenticationError, AuthorizationError, S3DriverError } from "../../../../http/errors.js";
import { S3Client, DeleteObjectCommand, CopyObjectCommand, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { applyS3RootPrefix, normalizeS3SubPath } from "../utils/S3PathUtils.js";
import { updateMountLastUsed } from "../../../fs/utils/MountResolver.js";
import { checkDirectoryExists, updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { isDirectoryPath } from "../../../fs/utils/PathResolver.js";

export class S3BatchOperations {
  /**
   * 建構函式
   * @param {S3Client} s3Client - S3客戶端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密金鑰
   * @param {D1Database} db - 資料庫例項（用於讀取系統設定）
   */
  constructor(s3Client, config, encryptionSecret, db = null) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
    this.db = db;
  }

  _errorFromStatus(status, message) {
    switch (status) {
      case ApiStatus.BAD_REQUEST:
        return new ValidationError(message);
      case ApiStatus.UNAUTHORIZED:
        return new AuthenticationError(message);
      case ApiStatus.FORBIDDEN:
        return new AuthorizationError(message);
      case ApiStatus.NOT_FOUND:
        return new NotFoundError(message);
      case ApiStatus.CONFLICT:
        return new ConflictError(message);
      default:
        return new S3DriverError(message);
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
   * 批次刪除檔案或目錄
   * @param {Array<string>} subPaths - 需要刪除的子路徑陣列（subPath-only）
   * @param {Object} ctx - 上下文（paths/subPaths/mount/db/...）
   * @returns {Promise<Object>} 刪除結果
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    const { db, mount } = ctx;

    const result = { success: 0, failed: [] };
    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return result;
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new ValidationError("S3 batchRemoveItems 需要 ctx.paths 與 subPaths 一一對應");
    }

    const fsPaths = ctx.paths;

    for (let i = 0; i < subPaths.length; i += 1) {
      const fsPath = fsPaths[i];
      const itemSubPath = subPaths[i];

      try {
        const isDir = isDirectoryPath(fsPath);
        const s3SubPath = normalizeS3SubPath(itemSubPath, isDir);
        const fullKey = applyS3RootPrefix(this.config, s3SubPath);

        if (isDir) {
          await this.deleteDirectoryRecursive(this.s3Client, this.config.bucket_name, fullKey, mount?.storage_config_id || null);
        } else {
          try {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: this.config.bucket_name,
              Key: fullKey,
            });
            await this.s3Client.send(deleteCommand);
          } catch (error) {
            if (error?.$metadata?.httpStatusCode === 404) {
              result.failed.push({ path: fsPath, error: "檔案不存在" });
              continue;
            }
            throw error;
          }
        }

        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix, true);
        result.success += 1;
      } catch (error) {
        console.error(`[S3BatchOps] 刪除失敗: ${fsPath}`, error);
        result.failed.push({ path: fsPath, error: error?.message || "刪除失敗" });
      }
    }

    if (db && mount?.id) {
      await updateMountLastUsed(db, mount.id);
    }

    return result;
  }

  /**
   * 複製單個檔案或目錄
   * @param {string} sourceSubPath - 源子路徑（subPath-only）
   * @param {string} targetSubPath - 目標子路徑（subPath-only）
   * @param {Object} ctx - 上下文（sourcePath/targetPath/mount/db/skipExisting/...）
   * @returns {Promise<Object>} 複製結果
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    const { mount, db } = ctx;
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;
    const { skipExisting = false, _skipExistingChecked = false } = ctx;

    return handleFsError(
      async () => {
        if (typeof sourcePath !== "string" || typeof targetPath !== "string") {
          throw new ValidationError("S3 copyItem 需要 ctx.sourcePath/ctx.targetPath（FS 檢視路徑，不做相容）");
        }

        const sourceIsDirectory = isDirectoryPath(sourcePath);
        const targetIsDirectory = isDirectoryPath(targetPath);
        if (sourceIsDirectory !== targetIsDirectory) {
          throw new ValidationError("複製操作源/目標路徑型別必須一致（檔案或目錄）");
        }

        const result = await this._handleSameStorageCopy(sourcePath, targetPath, sourceSubPath, targetSubPath, {
          skipExisting,
          _skipExistingChecked,
        });

        if (db && mount?.id) {
          await updateMountLastUsed(db, mount.id);
        }

        return result;
      },
      "複製專案",
      "複製專案失敗"
    );
  }

  /**
   * 處理同儲存複製
   * @private
   * @param {Object} copyOptions - 複製選項
   * @param {boolean} [copyOptions.skipExisting=false] - 是否跳過已存在的檔案
   * @param {boolean} [copyOptions._skipExistingChecked=false] - 入口層是否已檢查
   */
  async _handleSameStorageCopy(sourcePath, targetPath, sourceSubPath, targetSubPath, copyOptions = {}) {
    const { skipExisting = false, _skipExistingChecked = false } = copyOptions;

    // subPath-only：同一個 driver 內的複製只使用當前例項的配置（不再從 DB 重新解析掛載點/配置）
    const s3Config = this.config;

    const isDirectory = isDirectoryPath(sourcePath);
    const s3SourcePath = normalizeS3SubPath(sourceSubPath, isDirectory);
    const s3TargetPath = normalizeS3SubPath(targetSubPath, isDirectory);
    const fullS3SourcePath = applyS3RootPrefix(s3Config, s3SourcePath);
    const fullS3TargetPath = applyS3RootPrefix(s3Config, s3TargetPath);

    // 檢查源路徑是否存在
    try {
      const sourceExists = await this._checkS3ObjectExists(s3Config.bucket_name, fullS3SourcePath);
      if (!sourceExists) {
        // 如果是目錄，嘗試列出目錄內容確認存在性
        if (isDirectory) {
          const listResponse = await this._listS3Directory(s3Config.bucket_name, fullS3SourcePath);

          // 如果沒有內容，說明目錄不存在或為空
          if (!listResponse.Contents || listResponse.Contents.length === 0) {
            throw new NotFoundError("源路徑不存在或為空目錄");
          }
        } else {
          throw new NotFoundError("原始檔不存在");
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new S3DriverError("檢查源路徑存在性失敗", { details: { cause: error?.message } });
    }

    if (isDirectory) {
      // 目錄複製（目錄中每個檔案需要單獨檢查，不傳遞 _skipExistingChecked）
      return await this._copyDirectory(s3Config, fullS3SourcePath, fullS3TargetPath, sourcePath, targetPath, null, { skipExisting });
    } else {
      // 檔案複製（傳遞 _skipExistingChecked 避免重複檢查）
      return await this._copyFile(s3Config, fullS3SourcePath, fullS3TargetPath, sourcePath, targetPath, null, { skipExisting, _skipExistingChecked });
    }
  }

  /**
   * 複製單個檔案
   * @private
   * @param {Object} copyOptions - 複製選項
   * @param {boolean} [copyOptions.skipExisting=false] - 是否跳過已存在的檔案
   * @param {boolean} [copyOptions._skipExistingChecked=false] - 入口層是否已檢查
   */
  async _copyFile(s3Config, s3SourcePath, s3TargetPath, sourcePath, targetPath, db = null, copyOptions = {}) {
    const { skipExisting = false, _skipExistingChecked = false } = copyOptions;

    // 根據 skipExisting 引數決定是否檢查目標檔案存在
    // 如果入口層已檢查（_skipExistingChecked=true），跳過重複檢查
    if (skipExisting && !_skipExistingChecked && await this._checkItemExists(s3Config.bucket_name, s3TargetPath)) {
      console.log(`[S3BatchOps] 同儲存複製目標檔案已存在，跳過: ${sourcePath} -> ${targetPath}`);
      return {
        source: sourcePath,
        target: targetPath,
        status: "skipped",
        skipped: true,
        reason: "target_exists",
        message: "檔案已存在，跳過複製",
        contentLength: 0,
      };
    }

    // 檢查目標父目錄是否存在（對於檔案複製）
    if (s3TargetPath.includes("/")) {
      // 對於檔案，獲取其所在目錄
      const parentPath = s3TargetPath.substring(0, s3TargetPath.lastIndexOf("/") + 1);

      // 新增驗證：確保parentPath不為空
      if (parentPath && parentPath.trim() !== "") {
        const parentExists = await checkDirectoryExists(this.s3Client, s3Config.bucket_name, parentPath);

        if (!parentExists) {
          // 自動建立父目錄而不是丟擲錯誤
          console.log(`複製操作: 正在建立目標父目錄 "${parentPath}"`);

          try {
            // 建立一個空物件作為目錄標記
            const createDirParams = {
              Bucket: s3Config.bucket_name,
              Key: parentPath,
              Body: Buffer.from("", "utf-8"),
              ContentType: "application/x-directory", // 目錄內容型別
            };

            const createDirCommand = new PutObjectCommand(createDirParams);
            await this.s3Client.send(createDirCommand);
          } catch (dirError) {
            console.error(`複製操作: 建立目標父目錄 "${parentPath}" 失敗:`, dirError);
            // 如果建立目錄失敗，才丟擲錯誤
          throw new ConflictError(`無法建立目標父目錄: ${dirError.message}`);
          }
        }
      }
    }

    // 執行復制
    const copyParams = {
      Bucket: s3Config.bucket_name,
      CopySource: encodeURIComponent(s3Config.bucket_name + "/" + s3SourcePath),
      Key: s3TargetPath,
    };

    const copyCommand = new CopyObjectCommand(copyParams);
    await this.s3Client.send(copyCommand);

    // 更新父目錄的修改時間
    const rootPrefix = s3Config.root_prefix ? (s3Config.root_prefix.endsWith("/") ? s3Config.root_prefix : s3Config.root_prefix + "/") : "";
    await updateParentDirectoriesModifiedTime(this.s3Client, s3Config.bucket_name, s3TargetPath, rootPrefix);

    return {
      status: "success",
      source: sourcePath,
      target: targetPath,
      message: "檔案複製成功",
    };
  }

  /**
   * 遞迴複製S3目錄
   * @param {S3Client} s3Client - S3客戶端例項
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} sourcePrefix - 源目錄字首
   * @param {string} targetPrefix - 目標目錄字首
   * @param {boolean} skipExisting - 是否跳過已存在的檔案
   * @returns {Promise<Object>} 複製結果
   */
  async copyDirectoryRecursive(s3Client, bucketName, sourcePrefix, targetPrefix, skipExisting = true) {
    let continuationToken = undefined;
    const result = {
      success: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      do {
        const listParams = {
          Bucket: bucketName,
          Prefix: sourcePrefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(listCommand);

        if (response.Contents && response.Contents.length > 0) {
          for (const item of response.Contents) {
            try {
              const sourceKey = item.Key;
              const relativePath = sourceKey.substring(sourcePrefix.length);
              const targetKey = targetPrefix + relativePath;

              // 檢查目標檔案是否已存在
              if (skipExisting) {
                try {
                  const listParams = {
                    Bucket: bucketName,
                    Prefix: targetKey,
                    MaxKeys: 1,
                  };
                  const listCommand = new ListObjectsV2Command(listParams);
                  const listResponse = await s3Client.send(listCommand);

                  // 檢查是否找到精確匹配的物件
                  const exactMatch = listResponse.Contents?.find((item) => item.Key === targetKey);
                  if (exactMatch) {
                    // 檔案已存在，跳過
                    result.skipped++;
                    console.log(`[S3BatchOps] 檔案已存在，跳過複製: ${sourceKey} -> ${targetKey}`);
                    continue;
                  }
                } catch (error) {
                  // ListObjects失敗，繼續複製
                }
              }

              // 執行復制
              const copyParams = {
                Bucket: bucketName,
                CopySource: encodeURIComponent(bucketName + "/" + sourceKey),
                Key: targetKey,
              };

              const copyCommand = new CopyObjectCommand(copyParams);
              await s3Client.send(copyCommand);

              result.success++;
            } catch (error) {
              console.error(`複製檔案失敗 ${item.Key}:`, error);
              result.failed++;
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return result;
    } catch (error) {
      console.error(`複製目錄失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 複製目錄
   * @private
   */
  async _copyDirectory(s3Config, s3SourcePath, s3TargetPath, sourcePath, targetPath, db = null, copyOptions = {}) {
    void db;
    const { skipExisting = false } = copyOptions;

    // 目錄複製：統一用 “以 / 結尾的 prefix” 進行 S3 操作（返回值仍保持 FS 傳入的 sourcePath/targetPath）
    const normalizedS3SourcePath = s3SourcePath.endsWith("/") ? s3SourcePath : s3SourcePath + "/";
    const normalizedS3TargetPath = s3TargetPath.endsWith("/") ? s3TargetPath : s3TargetPath + "/";

    // 嚴格契約：source/target 必須等於輸入引數；不做“自動重新命名目標目錄”的魔法行為
    if (normalizedS3SourcePath === normalizedS3TargetPath) {
      return {
        source: sourcePath,
        target: targetPath,
        status: "skipped",
        skipped: true,
        reason: "same_path",
        message: "源目錄與目標目錄相同，跳過複製",
        contentLength: 0,
      };
    }

    // skipExisting：如果目標目錄（prefix）已存在，則整個目錄複製直接跳過
    if (skipExisting) {
      const targetExists = await checkDirectoryExists(this.s3Client, s3Config.bucket_name, normalizedS3TargetPath);
      if (targetExists) {
        return {
          source: sourcePath,
          target: targetPath,
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          message: "目標目錄已存在，跳過複製",
          contentLength: 0,
        };
      }
    }

    const details = await this.copyDirectoryRecursive(
      this.s3Client,
      s3Config.bucket_name,
      normalizedS3SourcePath,
      normalizedS3TargetPath,
      false,
    );

    return {
      source: sourcePath,
      target: targetPath,
      status: "success",
      message: "目錄複製成功",
      details,
    };
  }


  /**
   * 單個專案重新命名（檔案或目錄）
   * @param {string} oldSubPath - 舊子路徑（subPath-only）
   * @param {string} newSubPath - 新子路徑（subPath-only）
   * @param {Object} ctx - 上下文（oldPath/newPath/mount/db/...）
   * @returns {Promise<Object>} 重新命名結果
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    const { db, mount } = ctx;
    const oldPath = ctx?.oldPath;
    const newPath = ctx?.newPath;

    return handleFsError(
      async () => {
        if (typeof oldPath !== "string" || typeof newPath !== "string") {
          throw new ValidationError("S3 renameItem 需要 ctx.oldPath/ctx.newPath（FS 檢視路徑，不做相容）");
        }

        const oldIsDirectory = isDirectoryPath(oldPath);
        const newIsDirectory = isDirectoryPath(newPath);
        if (oldIsDirectory !== newIsDirectory) {
          throw new ValidationError("源路徑和目標路徑型別必須一致（檔案或目錄）");
        }

        const oldS3SubPath = normalizeS3SubPath(oldSubPath, oldIsDirectory);
        const newS3SubPath = normalizeS3SubPath(newSubPath, newIsDirectory);
        const fullOldS3Path = applyS3RootPrefix(this.config, oldS3SubPath);
        const fullNewS3Path = applyS3RootPrefix(this.config, newS3SubPath);

        const bucketName = this.config.bucket_name;

        const sourceExists = oldIsDirectory
          ? await checkDirectoryExists(this.s3Client, bucketName, fullOldS3Path)
          : await this._checkItemExists(bucketName, fullOldS3Path);

        if (!sourceExists) {
          throw new NotFoundError("原始檔或目錄不存在");
        }

        const targetExists = newIsDirectory
          ? await checkDirectoryExists(this.s3Client, bucketName, fullNewS3Path)
          : await this._checkItemExists(bucketName, fullNewS3Path);

        if (targetExists) {
          throw new ConflictError("目標路徑已存在");
        }

        if (oldIsDirectory) {
          await this.copyDirectoryRecursive(this.s3Client, bucketName, fullOldS3Path, fullNewS3Path, false);
          await this.deleteDirectoryRecursive(this.s3Client, bucketName, fullOldS3Path, mount?.storage_config_id || null);
        } else {
          const copyCommand = new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: encodeURIComponent(bucketName + "/" + fullOldS3Path),
            Key: fullNewS3Path,
            MetadataDirective: "COPY",
          });
          await this.s3Client.send(copyCommand);

          const deleteCommand = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: fullOldS3Path,
          });
          await this.s3Client.send(deleteCommand);
        }

        await updateParentDirectoriesModifiedTime(this.s3Client, bucketName, fullOldS3Path, this.config.root_prefix);

        if (db && mount?.id) {
          await updateMountLastUsed(db, mount.id);
        }

        return {
          success: true,
          source: oldPath,
          target: newPath,
          message: oldIsDirectory ? "目錄重新命名成功" : "檔案重新命名成功",
        };
      },
      "重新命名檔案或目錄",
      "重新命名失敗"
    );
  }

  /**
   * 檢查S3物件是否存在
   * @private
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} key - 物件鍵
   * @returns {Promise<boolean>} 是否存在
   */
  async _checkS3ObjectExists(bucketName, key) {
    try {
      const listParams = {
        Bucket: bucketName,
        Prefix: key,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      // 檢查是否找到精確匹配的物件
      const exactMatch = listResponse.Contents?.find((item) => item.Key === key);
      return !!exactMatch;
    } catch (error) {
      return false;
    }
  }

  /**
   * 列出S3目錄內容
   * @private
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} prefix - 目錄字首
   * @returns {Promise<Object>} 列表響應
   */
  async _listS3Directory(bucketName, prefix) {
    const listParams = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1, // 只需要檢查是否有內容，不需要全部列出
    };

    const listCommand = new ListObjectsV2Command(listParams);
    return await this.s3Client.send(listCommand);
  }

  /**
   * 檢查檔案是否存在
   * @private
   * @param {string} bucketName - 儲存桶名稱
   * @param {string} key - 檔案路徑
   * @returns {Promise<boolean>} 是否存在
   */
  async _checkItemExists(bucketName, key) {
    try {
      const listParams = {
        Bucket: bucketName,
        Prefix: key,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      // 檢查是否找到精確匹配的物件
      const exactMatch = listResponse.Contents?.find((item) => item.Key === key);
      return !!exactMatch;
    } catch (error) {
      return false;
    }
  }

  /**
   * 解析檔名，提取基礎名稱、副檔名和目錄路徑
   * @private
   * @param {string} filePath - 檔案路徑
   * @returns {Object} 包含 baseName, extension, directory 的物件
   */
  _parseFileName(filePath) {
    // 處理空路徑的邊界情況
    if (!filePath || filePath.trim() === "") {
      return { baseName: "", extension: "", directory: "" };
    }

    const pathParts = filePath.split("/");
    const fileName = pathParts.pop() || "";
    const directory = pathParts.length > 0 ? pathParts.join("/") + "/" : "";

    // 處理空檔名的邊界情況
    if (!fileName) {
      return { baseName: "", extension: "", directory };
    }

    const lastDotIndex = fileName.lastIndexOf(".");
    let baseName, extension;

    // 修復只有副檔名的檔案處理（如 ".txt"）
    if (lastDotIndex > 0) {
      // 正常情況：檔名.副檔名
      baseName = fileName.substring(0, lastDotIndex);
      extension = fileName.substring(lastDotIndex);
    } else if (lastDotIndex === 0) {
      // 只有副檔名的情況：.txt
      baseName = "";
      extension = fileName;
    } else {
      // 沒有副檔名的情況
      baseName = fileName;
      extension = "";
    }

    // 移除已有的數字字尾 (如果存在) - 支援多層巢狀的數字字尾
    // 例如：folder(1)(1) → folder, document(2)(3) → document
    // 新增迴圈保護，防止無限迴圈
    let loopCount = 0;
    const maxLoops = 10; // 最多處理10層巢狀

    while (loopCount < maxLoops && baseName) {
      const numberMatch = baseName.match(/^(.+)\((\d+)\)$/);
      if (numberMatch && numberMatch[1]) {
        baseName = numberMatch[1];
        loopCount++;
      } else {
        break;
      }
    }

    // 確保 baseName 不為空（為空時使用預設值）
    if (!baseName && !extension) {
      baseName = "unnamed";
    }

    return { baseName, extension, directory };
  }



}
