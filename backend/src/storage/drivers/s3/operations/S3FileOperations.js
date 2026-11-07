/**
 * S3檔案操作模組
 * 負責單個檔案的基礎操作：獲取資訊、下載、上傳、刪除等
 */

import { AppError, NotFoundError, ConflictError, ValidationError, S3DriverError } from "../../../../http/errors.js";
import { generateDownloadUrl, createS3Client } from "../utils/s3Utils.js";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getMimeTypeFromFilename } from "../../../../utils/fileUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { applyS3RootPrefix } from "../utils/S3PathUtils.js";
import { CAPABILITIES } from "../../../interfaces/capabilities/index.js";
import { buildFileInfo } from "../../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../../streaming/StreamDescriptorUtils.js";

export class S3FileOperations {
  /**
   * 建構函式
   * @param {S3Client} s3Client - S3客戶端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密金鑰
   * @param {Object} driver - 儲存驅動例項（用於代理能力）
   */
  constructor(s3Client, config, encryptionSecret, driver = null) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
    this.driver = driver;
  }

  /**
   * 從S3獲取檔案內容（返回 StorageStreamDescriptor）
   * @param {Object} s3Config - S3配置物件
   * @param {string} s3SubPath - S3子路徑
   * @param {string} fileName - 檔名
   * @param {boolean} forceDownload - 是否強制下載（已廢棄，由上層處理）
   * @param {string} encryptionSecret - 加密金鑰
   * @param {Request} request - 請求物件（已廢棄，Range 由上層處理）
   * @returns {Promise<import('../../../streaming/types.js').StorageStreamDescriptor>} 流描述物件
   */
  async getFileFromS3(s3Config, s3SubPath, fileName, forceDownload = false, encryptionSecret, request = null) {
    // 注意：S3StorageDriver.initialize 已經建立並初始化了 this.s3Client。
    // 這裡優先複用，避免每次下載都重複解密/建立 client（Worker 冷啟動時更容易抖動）。
    const s3Client = this.s3Client || (await createS3Client(s3Config, encryptionSecret));
    const fullKey = applyS3RootPrefix(s3Config, s3SubPath);
    const key = fullKey.startsWith("/") ? fullKey.slice(1) : fullKey;

    // 使用統一的 HTTP 流描述構造器（Web ReadableStream）：
    const expiresIn = 300;
    const getUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: s3Config.bucket_name,
        Key: key,
      }),
      { expiresIn },
    );

    // 可選：用於 size 缺失/異常時探測 size（StorageStreaming 的 probeSize 會用到）
    const headUrl = await getSignedUrl(
      s3Client,
      new HeadObjectCommand({
        Bucket: s3Config.bucket_name,
        Key: key,
      }),
      { expiresIn },
    );

    const contentType = getMimeTypeFromFilename(fileName);
    const size = null;
    const etag = null;
    const lastModified = null;

    return createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      fetchResponse: async (signal) => {
        return await fetch(getUrl, {
          method: "GET",
          signal,
          redirect: "follow",
        });
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        return await fetch(getUrl, {
          method: "GET",
          headers: { Range: rangeHeader },
          signal,
          redirect: "follow",
        });
      },
      fetchHeadResponse: async (signal) => {
        return await fetch(headUrl, {
          method: "HEAD",
          signal,
          redirect: "follow",
        });
      },
    });
  }

  /**
   * 獲取檔案資訊
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 檔案資訊
   */
  async getFileInfo(s3SubPath, options = {}) {
    const { mount, path, userType, userId, request, db } = options;

    return handleFsError(
      async () => {
        const fullKey = applyS3RootPrefix(this.config, s3SubPath);

        // 使用 ListObjectsV2Command 獲取檔案資訊
        console.log(`getFileInfo - 使用 ListObjects 查詢檔案: ${fullKey}`);

        const listParams = {
          Bucket: this.config.bucket_name,
          Prefix: fullKey,
          MaxKeys: 1,
        };

        try {
          const listCommand = new ListObjectsV2Command(listParams);
          const listResponse = await this.s3Client.send(listCommand);

          // 檢查是否找到精確匹配的檔案
          const exactMatch = listResponse.Contents?.find((item) => item.Key === fullKey);

          if (!exactMatch) {
            throw new NotFoundError("檔案不存在");
          }

          // 構建檔案資訊物件
          const fileName = path.split("/").filter(Boolean).pop() || "/";

          // 檢查是否為目錄：基於Key是否以'/'結尾判斷
          const isDirectory = exactMatch.Key.endsWith("/");

          const info = await buildFileInfo({
            fsPath: path,
            name: fileName,
            isDirectory,
            size: isDirectory ? null : exactMatch.Size || 0,
            modified: exactMatch.LastModified ? exactMatch.LastModified : null,
            mimetype: isDirectory ? "application/x-directory" : getMimeTypeFromFilename(fileName),
            mount,
            storageType: mount.storage_type,
            db,
          });

          const result = {
            ...info,
            etag: exactMatch.ETag ? exactMatch.ETag.replace(/"/g, "") : undefined,
          };

          console.log(`getFileInfo - ListObjects 成功獲取檔案資訊: ${result.name}`);
          return result;
        } catch (listError) {
          // 如果 ListObjects 失敗，fallback 到 GET 方法
          console.log(`getFileInfo - ListObjects 失敗，fallback 到 GET 方法: ${listError.message}`);

          try {
            const getParams = {
              Bucket: this.config.bucket_name,
              Key: fullKey,
              Range: "bytes=0-0", // 只獲取第一個位元組來檢查檔案存在性
            };

            const getCommand = new GetObjectCommand(getParams);
            const getResponse = await this.s3Client.send(getCommand);

            const fileName = path.split("/").filter(Boolean).pop() || "/";

            // 檢查是否為目錄：基於ContentType判斷
            const isDirectory = getResponse.ContentType === "application/x-directory";

            const info = await buildFileInfo({
              fsPath: path,
              name: fileName,
              isDirectory,
              size: isDirectory ? null : getResponse.ContentLength || 0,
              modified: getResponse.LastModified ? getResponse.LastModified : null,
              mimetype: getResponse.ContentType || "application/octet-stream",
              mount,
              storageType: mount.storage_type,
              db,
            });

            const result = {
              ...info,
              etag: getResponse.ETag ? getResponse.ETag.replace(/"/g, "") : undefined,
            };

            console.log(`getFileInfo(GET) - 檔案[${result.name}], S3 ContentType[${getResponse.ContentType}]`);
            return result;
          } catch (getError) {
            // 檢查是否是NotFound錯誤，轉換為AppError
            if (getError.$metadata?.httpStatusCode === 404 || getError.name === "NotFound") {
              throw new NotFoundError("檔案不存在");
            }

            throw getError;
          }
        }
      },
      "獲取檔案資訊",
      "獲取檔案資訊失敗"
    );
  }

  /**
   * 下載檔案
   * @param {string} s3SubPath - S3子路徑
   * @param {string} fileName - 檔名
   * @param {Request} request - 請求物件（已廢棄，Range 由上層處理）
   * @returns {Promise<import('../../../streaming/types.js').StorageStreamDescriptor>} 流描述物件
   */
  async downloadFile(s3SubPath, fileName, request = null) {
    return handleFsError(
      async () => {
        // 使用現有的getFileFromS3函式
        return await this.getFileFromS3(this.config, s3SubPath, fileName, false, this.encryptionSecret, request);
      },
      "下載檔案",
      "下載檔案失敗"
    );
  }

  /**
   * 生成檔案預簽名下載URL
   * @param {string} s3SubPath - S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 預簽名URL資訊
   */
  async generateDownloadUrl(s3SubPath, options = {}) {
    const { expiresIn = 604800, forceDownload = false, userType, userId, mount } = options;

    return handleFsError(
      async () => {
        const fullKey = applyS3RootPrefix(this.config, s3SubPath);

        const rawPath = typeof s3SubPath === "string" ? s3SubPath : "";
        const trimmedPath = rawPath.trim();
        if (!trimmedPath || trimmedPath.endsWith("/")) {
          throw new ValidationError("目錄不支援生成下載連結");
        }

        const cacheOptions = {
          userType,
          userId,
          enableCache: mount?.cache_ttl > 0,
        };

        const presignedUrl = await generateDownloadUrl(
          this.config,
          fullKey,
          this.encryptionSecret,
          expiresIn,
          forceDownload,
          null,
          cacheOptions,
        );

        // 提取檔名
        const fileName = s3SubPath.split("/").filter(Boolean).pop() || "file";

        // 統一在驅動層使用 canonical 欄位 url，供上層 LinkStrategy/LinkService 消費
        const url = presignedUrl;
        const type = this.config.custom_host ? "custom_host" : "native_direct";

        return {
          success: true,
          url,
          type,
          name: fileName,
          expiresIn: expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          forceDownload: forceDownload,
        };
      },
      "獲取檔案下載預簽名URL",
      "獲取檔案下載預簽名URL失敗"
    );
  }

  /**
   * 檢查檔案是否存在
   * @param {string} s3SubPath - S3子路徑
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(s3SubPath) {
    const key = applyS3RootPrefix(this.config, s3SubPath);
    const isDirectory = key === "" || key.endsWith("/");

    // 檔案優先使用 HEAD，避免 List 字首誤判
    if (!isDirectory) {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: this.config.bucket_name,
          Key: key,
        });
        await this.s3Client.send(headCommand);
        return true;
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        const code = error?.name || error?.Code;
        const notFound = status === 404 || code === "NotFound" || code === "NoSuchKey";
        if (!notFound) {
          // 非 404 級錯誤時降級為字首檢查，避免硬失敗
          console.warn("[S3FileOperations.exists] headObject fallback", error?.message || error);
        }
      }
    }

    // 目錄或 Head 未命中的情況下，使用字首列舉兜底
    try {
      const prefix = isDirectory ? key : `${key}/`;
      const listParams = {
        Bucket: this.config.bucket_name,
        Prefix: prefix,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      const hasObject = (listResponse.Contents?.length || 0) > 0;
      const hasPrefix = (listResponse.CommonPrefixes?.length || 0) > 0;
      return hasObject || hasPrefix;
    } catch (error) {
      console.warn("[S3FileOperations.exists] listObjects fallback failed", error?.message || error);
      return false;
    }
  }

  /**
   * 更新檔案內容
   * @param {string} s3SubPath - S3子路徑
   * @param {string|ArrayBuffer} content - 新內容
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 更新結果
   */
  async updateFile(s3SubPath, content, options = {}) {
    const { fileName } = options;

    return handleFsError(
      async () => {
        const fullKey = applyS3RootPrefix(this.config, s3SubPath);

        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

        // 檢查內容大小
        if (typeof content === "string" && content.length > MAX_FILE_SIZE) {
          throw new ValidationError("檔案內容過大，超過最大限制(10MB)");
        } else if (content instanceof ArrayBuffer && content.byteLength > MAX_FILE_SIZE) {
          throw new ValidationError("檔案內容過大，超過最大限制(10MB)");
        }

        // 推斷MIME型別
        const contentType = getMimeTypeFromFilename(fileName || s3SubPath);

        // 首先檢查檔案是否存在，獲取原始後設資料
        let originalMetadata = null;
        try {
          const listParams = {
            Bucket: this.config.bucket_name,
            Prefix: fullKey,
            MaxKeys: 1,
          };
          const listCommand = new ListObjectsV2Command(listParams);
          const listResponse = await this.s3Client.send(listCommand);

          // 檢查是否找到精確匹配的檔案
          const exactMatch = listResponse.Contents?.find((item) => item.Key === fullKey);
          if (exactMatch) {
            originalMetadata = {
              LastModified: exactMatch.LastModified,
              ETag: exactMatch.ETag,
              Size: exactMatch.Size,
            };
          }
        } catch (error) {
          console.warn(`獲取原始檔案後設資料失敗: ${error.message}`);
          // 錯誤表示無法獲取後設資料，這是正常的（建立新檔案）
        }

        const putParams = {
          Bucket: this.config.bucket_name,
          Key: fullKey,
          Body: content,
          ContentType: contentType,
        };

        console.log(`準備更新S3物件: ${fullKey}, 內容型別: ${contentType}`);
        const putCommand = new PutObjectCommand(putParams);
        const result = await this.s3Client.send(putCommand);

        // 更新父目錄的修改時間
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix);

        return {
          success: true,
          path: s3SubPath,
          etag: result.ETag ? result.ETag.replace(/"/g, "") : undefined,
          mimetype: contentType,
          message: "檔案更新成功",
          isNewFile: !originalMetadata,
        };
      },
      "更新檔案",
      "更新檔案失敗"
    );
  }

  /**
   * 重新命名檔案
   * @param {string} oldS3SubPath - 原S3子路徑
   * @param {string} newS3SubPath - 新S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 重新命名結果
   */
  async renameFile(oldS3SubPath, newS3SubPath, options = {}) {
    return handleFsError(
      async () => {
        const oldKey = applyS3RootPrefix(this.config, oldS3SubPath);
        const newKey = applyS3RootPrefix(this.config, newS3SubPath);

        // 檢查原始檔是否存在
        const sourceExists = await this.exists(oldS3SubPath);
        if (!sourceExists) {
          throw new NotFoundError("原始檔不存在");
        }

        // 檢查目標檔案是否已存在
        const targetExists = await this.exists(newS3SubPath);
        if (targetExists) {
          throw new ConflictError("目標檔案已存在");
        }

        // 複製檔案到新位置
        const copyParams = {
          Bucket: this.config.bucket_name,
          CopySource: encodeURIComponent(this.config.bucket_name + "/" + oldKey),
          Key: newKey,
        };

        const copyCommand = new CopyObjectCommand(copyParams);
        await this.s3Client.send(copyCommand);

        // 刪除原檔案
        const deleteParams = {
          Bucket: this.config.bucket_name,
          Key: oldKey,
        };

        const deleteCommand = new DeleteObjectCommand(deleteParams);
        await this.s3Client.send(deleteCommand);

        return {
          success: true,
          oldPath: oldS3SubPath,
          newPath: newS3SubPath,
          message: "檔案重新命名成功",
        };
      },
      "重新命名檔案",
      "重新命名檔案失敗"
    );
  }

  /**
   * 複製單個檔案
   * @param {string} sourceS3SubPath - 源S3子路徑
   * @param {string} targetS3SubPath - 目標S3子路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 複製結果
   */
  async copyFile(sourceS3SubPath, targetS3SubPath, options = {}) {
    const { skipExisting = true } = options;

    try {
      const sourceKey = applyS3RootPrefix(this.config, sourceS3SubPath);
      const targetKey = applyS3RootPrefix(this.config, targetS3SubPath);

      // 檢查原始檔是否存在
      const sourceExists = await this.exists(sourceS3SubPath);
      if (!sourceExists) {
        throw new NotFoundError("原始檔不存在");
      }

      // 檢查目標檔案是否已存在
      if (skipExisting) {
        const targetExists = await this.exists(targetS3SubPath);
        if (targetExists) {
          // 檔案已存在，跳過
          return {
            success: true,
            skipped: true,
            source: sourceS3SubPath,
            target: targetS3SubPath,
            message: "檔案已存在，跳過複製",
          };
        }
      }

      // 執行復制
      const copyParams = {
        Bucket: this.config.bucket_name,
        CopySource: encodeURIComponent(this.config.bucket_name + "/" + sourceKey),
        Key: targetKey,
        MetadataDirective: "COPY", // 保持原有後設資料
      };

      const copyCommand = new CopyObjectCommand(copyParams);
      await this.s3Client.send(copyCommand);

      // 更新父目錄的修改時間
      await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, targetKey, this.config.root_prefix);

      return {
        success: true,
        skipped: false,
        source: sourceS3SubPath,
        target: targetS3SubPath,
        message: "檔案複製成功",
      };
    } catch (error) {
      console.error("複製檔案失敗:", error);

      if (error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundError("原始檔不存在");
      }

      throw new S3DriverError("複製檔案失敗", { details: { cause: error?.message, source: sourceS3SubPath, target: targetS3SubPath } });
    }
  }
}
