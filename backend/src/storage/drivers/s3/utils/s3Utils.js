/**
 * S3儲存操作相關工具函式
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfiguredRetryStrategy } from "@smithy/util-retry";
import { decryptValue } from "../../../../utils/crypto.js";
import { S3ProviderTypes } from "../../../../constants/index.js";
import { getEffectiveMimeType, getContentTypeAndDisposition } from "../../../../utils/fileUtils.js";
import { ValidationError, S3DriverError } from "../../../../http/errors.js";
/**
 * 建立S3客戶端
 * @param {Object} config - S3配置物件
 * @param {string} encryptionSecret - 用於解密憑證的金鑰
 * @returns {Promise<S3Client>} S3客戶端例項
 */
async function createS3Client(config, encryptionSecret) {
  // 解密敏感配置
  const accessKeyId = await decryptValue(config.access_key_id, encryptionSecret);
  const secretAccessKey = await decryptValue(config.secret_access_key, encryptionSecret);

  if (!accessKeyId || !secretAccessKey) {
    throw new ValidationError("S3憑據缺失：access_key_id 或 secret_access_key 為空或不可用");
  }

  // 建立S3客戶端配置
  const clientConfig = {
    endpoint: config.endpoint_url,
    region: config.region || "auto",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: config.path_style === 1, // 使用路徑樣式訪問
  };

  // 設定適當的超時時間
  clientConfig.requestTimeout = 30000; // 全域性預設超時30秒

  // 設定預設重試策略
  let maxRetries = 3; // 預設最大重試次數
  let retryBackoffStrategy = (attempt) => Math.min(Math.pow(2, attempt) * 500, 10000); // 預設指數退避策略

  // 為不同服務商設定特定配置
  switch (config.provider_type) {
    case S3ProviderTypes.B2:
      // Backblaze B2特定配置
      clientConfig.signatureVersion = "v4";
      clientConfig.customUserAgent = "CloudHarbor/1.0";
      clientConfig.requestTimeout = 60000;
      maxRetries = 4;
      // 禁用 B2 不支援的校驗和功能
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      break;

    case S3ProviderTypes.R2:
      // Cloudflare R2配置
      clientConfig.requestTimeout = 30000;
      // 禁用 R2 不支援的校驗和功能
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      break;

    case S3ProviderTypes.AWS:
      // AWS配置
      clientConfig.signatureVersion = "v4";
      clientConfig.requestTimeout = 30000;
      maxRetries = 3;
      // 禁用校驗和功能以保持一致性
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      break;

    case S3ProviderTypes.ALIYUN_OSS:
      // 阿里雲OSS配置
      clientConfig.signatureVersion = "v4";
      clientConfig.requestTimeout = 30000;
      maxRetries = 3;
      // 禁用校驗和功能以保持相容性
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      break;

    case S3ProviderTypes.OTHER:
      clientConfig.signatureVersion = "v4";
      // 禁用可能不相容的校驗和功能
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      break;
  }

  // 應用重試策略
  clientConfig.retryStrategy = new ConfiguredRetryStrategy(maxRetries, retryBackoffStrategy);

  // 日誌記錄所選服務商和配置
  const resolvedPathStyle = clientConfig.forcePathStyle === true;
  console.log(
    `正在建立S3客戶端 (${config.provider_type}), endpoint: ${config.endpoint_url}, region: ${config.region || "auto"}, pathStyle: ${
      resolvedPathStyle ? "是" : "否"
    }, maxRetries: ${maxRetries}, checksumMode: ${clientConfig.requestChecksumCalculation || "預設"}`
  );

  // 返回建立的S3客戶端
  return new S3Client(clientConfig);
}

/**
 * 構建S3檔案公共訪問URL
 * @param {Object} s3Config - S3配置
 * @param {string} storagePath - S3儲存路徑
 * @returns {string} 訪問URL
 */
function buildS3Url(s3Config, storagePath) {
  const bucketName = s3Config.bucket_name;
  const endpointUrl = s3Config.endpoint_url;

  // 去除endpoint_url末尾的斜槓(如果有)
  const endpoint = endpointUrl.endsWith("/") ? endpointUrl.slice(0, -1) : endpointUrl;

  // 確保storagePath不以斜槓開始
  const normalizedPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;

  // 根據配置選擇合適的URL格式(路徑樣式vs虛擬主機樣式)
  if (s3Config.path_style === 1) {
    // 路徑樣式: https://endpoint/bucket/key
    return `${endpoint}/${bucketName}/${normalizedPath}`;
  } else {
    // 虛擬主機樣式: https://bucket.endpoint/key

    // 提取endpoint的域名部分
    let domain = endpoint;
    try {
      const url = new URL(endpoint);
      domain = url.host;
    } catch (e) {
      // 處理無效URL，保持原樣
    }

    return `${endpoint.split("//")[0]}//${bucketName}.${domain}/${normalizedPath}`;
  }
}

/**
 * 生成S3檔案的上傳預簽名URL（PUT）
 * @param {Object} s3Config - S3配置
 * @param {string} storagePath - S3儲存路徑
 * @param {string} mimetype - 檔案的MIME型別
 * @param {string} encryptionSecret - 用於解密憑證的金鑰
 * @param {number} expiresIn - URL過期時間（秒），如果為null則使用S3配置的預設值
 * @returns {Promise<string>} 預簽名URL
 */
async function generateUploadUrl(s3Config, storagePath, mimetype, encryptionSecret, expiresIn = null) {
  // 如果沒有指定過期時間，使用S3配置中的預設值
  const finalExpiresIn = expiresIn || s3Config.signature_expires_in || 3600;
  // 確保storagePath不以斜槓開始（在 try/catch 外部計算，便於錯誤資訊引用）
  const normalizedPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  try {
    // 建立S3客戶端
    const s3Client = await createS3Client(s3Config, encryptionSecret);

    // 建立PutObjectCommand
    // 在預簽名URL中指定ContentType，確保MIME型別正確傳遞
    const command = new PutObjectCommand({
      Bucket: s3Config.bucket_name,
      Key: normalizedPath,
      ContentType: mimetype,
    });

    // 針對不同服務商新增特定頭部或引數
    const commandOptions = { expiresIn: finalExpiresIn };

    // 某些服務商可能對預簽名URL有不同處理
    switch (s3Config.provider_type) {
      case S3ProviderTypes.B2:
        // B2特殊處理 - 某些情況可能需要新增特定頭部
        // 例如Content-SHA1處理，但一般在前端上傳時新增
        break;

      case S3ProviderTypes.ALIYUN_OSS:
        // 阿里雲OSS特殊處理 - 預簽名上傳URL通常不需要特殊處理
        break;

      case S3ProviderTypes.OTHER:
        break;
    }

    // 生成預簽名URL，應用服務商特定選項
    const url = await getSignedUrl(s3Client, command, commandOptions);

    // 保留關鍵除錯日誌：確認預簽名URL包含ContentType引數
    console.log(`生成上傳預簽名URL(PUT) - 檔案[${normalizedPath}], ContentType[${mimetype}]`);

    return url;
  } catch (error) {
    console.error("生成上傳預簽名URL出錯:", error);
    throw new S3DriverError("無法生成檔案上傳連結", {
      details: {
        op: "presignPut",
        provider: s3Config?.provider_type,
        bucket: s3Config?.bucket_name,
        key: normalizedPath,
        region: s3Config?.region,
        endpoint: s3Config?.endpoint_url,
        expiresIn: finalExpiresIn,
        cause: error?.message,
      },
    });
  }
}

/**
 * 生成自定義域名的直鏈URL（無簽名）
 * @param {Object} s3Config - S3配置
 * @param {string} storagePath - S3儲存路徑
 * @returns {string} 自定義域名直鏈URL
 */
export function generateCustomHostDirectUrl(s3Config, storagePath) {
  const normalizedPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  const customHost = s3Config.custom_host.endsWith("/") ? s3Config.custom_host.slice(0, -1) : s3Config.custom_host;

  // 根據path_style配置決定是否包含bucket名稱
  if (s3Config.path_style) {
    return `${customHost}/${s3Config.bucket_name}/${normalizedPath}`;
  } else {
    return `${customHost}/${normalizedPath}`;
  }
}

/**
 * 生成原始 S3 下載預簽名 URL（內部函式，基於 GetObject）
 * @param {Object} s3Config - S3配置
 * @param {string} storagePath - S3儲存路徑
 * @param {string} encryptionSecret - 用於解密憑證的金鑰
 * @param {number} expiresIn - URL過期時間（秒）
 * @param {boolean} forceDownload - 是否強制下載（而非預覽）
 * @param {string} mimetype - 檔案的MIME型別（可選）
 * @returns {Promise<string>} 原始 S3 預簽名下載 URL
 */
async function generateOriginalDownloadUrl(s3Config, storagePath, encryptionSecret, expiresIn, forceDownload = false, mimetype = null) {
  const finalExpiresIn = expiresIn || s3Config.signature_expires_in || 3600;
  const rawPath = typeof storagePath === "string" ? storagePath : "";
  const normalizedPath = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;

  if (!normalizedPath) {
    throw new S3DriverError("無法生成檔案下載連結：物件路徑為空", {
      details: {
        op: "presignGet",
        provider: s3Config?.provider_type,
        bucket: s3Config?.bucket_name,
        key: normalizedPath || null,
        region: s3Config?.region,
        endpoint: s3Config?.endpoint_url,
        expiresIn: finalExpiresIn,
        forceDownload: !!forceDownload,
        contentType: mimetype || null,
        cause: "EMPTY_OBJECT_KEY",
      },
    });
  }

  try {
    // 建立S3客戶端
    const s3Client = await createS3Client(s3Config, encryptionSecret);

    // 提取檔名，用於Content-Disposition頭
    const fileName = normalizedPath.split("/").pop();

    // 統一從檔名推斷MIME型別，不依賴傳入的mimetype引數
    const effectiveMimetype = getEffectiveMimeType(null, fileName);
    const urlType = forceDownload ? "下載" : "預覽";
    console.log(`S3${urlType}URL：檔案[${fileName}], MIME[${effectiveMimetype}]`);

    // 建立GetObjectCommand
    const commandParams = {
      Bucket: s3Config.bucket_name,
      Key: normalizedPath,
    };

    // 使用統一的函式獲取內容型別和處置方式
    const { contentType, contentDisposition } = getContentTypeAndDisposition(fileName, effectiveMimetype, { forceDownload: forceDownload });

    // 針對特定服務商設定響應頭引數
    switch (s3Config.provider_type) {
      case S3ProviderTypes.ALIYUN_OSS:
        // 阿里雲OSS不支援response-content-type引數，只設定content-disposition
        // 參考：https://help.aliyun.com/zh/oss/support/0017-00000902
        commandParams.ResponseContentDisposition = contentDisposition;
        console.log(`阿里雲OSS預簽名URL：跳過ResponseContentType設定，僅設定ContentDisposition`);
        break;
      case S3ProviderTypes.B2:
        // B2支援標準S3響應頭
        commandParams.ResponseContentType = contentType;
        commandParams.ResponseContentDisposition = contentDisposition;
        break;
      default:
        // 標準S3相容服務設定完整響應頭
        commandParams.ResponseContentType = contentType;
        commandParams.ResponseContentDisposition = contentDisposition;
        break;
    }

    const command = new GetObjectCommand(commandParams);

    // 生成預簽名URL
    const url = await getSignedUrl(s3Client, command, { expiresIn: finalExpiresIn });

    return url;
  } catch (error) {
    console.error("生成預簽名URL出錯:", error);
    // 注意：此函式內變數名存在：s3Client/command/expiresIn/mimetype/forceDownload 等
    throw new S3DriverError("無法生成檔案下載連結", {
      details: {
        op: "presignGet",
        provider: s3Config?.provider_type,
        bucket: s3Config?.bucket_name,
        key: normalizedPath,
        region: s3Config?.region,
        endpoint: s3Config?.endpoint_url,
        expiresIn: finalExpiresIn,
        forceDownload: !!forceDownload,
        contentType: mimetype || null,
        cause: error?.message,
      },
    });
  }
}

/**
 * 生成S3檔案的下載預簽名URL（支援自定義域名和快取）
 * @param {Object} s3Config - S3配置
 * @param {string} storagePath - S3儲存路徑
 * @param {string} encryptionSecret - 用於解密憑證的金鑰
 * @param {number} expiresIn - URL過期時間（秒），如果為null則使用S3配置的預設值
 * @param {boolean} forceDownload - 是否強制下載（而非預覽）
 * @param {string} mimetype - 檔案的MIME型別（可選）
 * @param {Object} cacheOptions - 快取選項 {userType, userId, enableCache}
 * @returns {Promise<string>} 預簽名URL或自定義域名URL
 */
async function generateDownloadUrl(s3Config, storagePath, encryptionSecret, expiresIn = null, forceDownload = false, mimetype = null, cacheOptions = {}) {
  // 如果沒有指定過期時間，使用S3配置中的預設值
  const finalExpiresIn = expiresIn || s3Config.signature_expires_in || 3600;

  // 快取功能：檢查是否啟用快取且提供了必要的快取引數
  const { userType, userId, enableCache = true } = cacheOptions;

  if (enableCache && userType && userId) {
    // 動態匯入快取管理器，避免迴圈依賴
    const { urlCacheManager } = await import("../../../../cache/UrlCache.js");

    // 嘗試從快取獲取
    const cachedUrl = urlCacheManager.get(s3Config.id, storagePath, forceDownload, userType, userId);
    if (cachedUrl) {
      console.log(`🎯 URL快取命中: ${storagePath}`);
      return cachedUrl;
    }
  }

  let generatedUrl;

  // 如果配置了自定義域名
  if (s3Config.custom_host) {
    // 自定義域名情況下的處理
    if (forceDownload) {
      // 強制下載時：使用自定義域名 + response-content-disposition引數
      // 這樣既能使用CDN加速，又能確保瀏覽器觸發下載行為
      console.log(`自定義域名強制下載：新增response-content-disposition引數`);

      // 先生成預簽名URL（包含response-content-disposition引數）
      const presignedUrl = await generateOriginalDownloadUrl(s3Config, storagePath, encryptionSecret, finalExpiresIn, forceDownload, mimetype);

      // 然後將域名替換為自定義域名，保留查詢引數
      const presignedUrlObj = new URL(presignedUrl);
      const customHostUrl = generateCustomHostDirectUrl(s3Config, storagePath);
      const customHostUrlObj = new URL(customHostUrl);

      // 將預簽名URL的查詢引數（包含response-content-disposition）新增到自定義域名URL
      customHostUrlObj.search = presignedUrlObj.search;
      generatedUrl = customHostUrlObj.toString();
    } else {
      // 預覽時：使用自定義域名直鏈
      generatedUrl = generateCustomHostDirectUrl(s3Config, storagePath);
    }
  } else {
    // 沒有自定義域名：使用原始S3預簽名URL
    generatedUrl = await generateOriginalDownloadUrl(s3Config, storagePath, encryptionSecret, finalExpiresIn, forceDownload, mimetype);
  }

  // 快取生成的URL
  if (enableCache && userType && userId && generatedUrl) {
    const { urlCacheManager } = await import("../../../../cache/UrlCache.js");
    urlCacheManager.set(s3Config.id, storagePath, forceDownload, userType, userId, generatedUrl, s3Config);
    console.log(`💾 URL已快取: ${storagePath}`);
  }

  return generatedUrl;
}

/**
 * 從S3儲存中刪除檔案
 * @param {Object} s3Config - S3配置資訊
 * @param {string} storagePath - 儲存路徑
 * @param {string} encryptionSecret - 加密金鑰
 * @returns {Promise<boolean>} 是否成功刪除
 */
async function deleteFileFromS3(s3Config, storagePath, encryptionSecret) {
  try {
    const s3Client = await createS3Client(s3Config, encryptionSecret);

    const deleteParams = {
      Bucket: s3Config.bucket_name,
      Key: storagePath,
    };

    await s3Client.send(new DeleteObjectCommand(deleteParams));
    console.log(`成功從S3儲存中刪除檔案: ${storagePath}`);
    return true;
  } catch (error) {
    console.error(`從S3刪除檔案錯誤: ${error.message || error}`);
    return false;
  }
}

/**
 * 檢查S3物件是否存在
 * @param {S3Client} s3Client - S3客戶端例項
 * @param {string} bucketName - 儲存桶名稱
 * @param {string} key - 物件鍵名
 * @returns {Promise<boolean>} 物件是否存在
 */
async function checkS3ObjectExists(s3Client, bucketName, key) {
  try {
    const headParams = {
      Bucket: bucketName,
      Key: key,
    };

    const headCommand = new HeadObjectCommand(headParams);
    await s3Client.send(headCommand);
    return true;
  } catch (error) {
    if (error.$metadata && error.$metadata.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * 獲取S3物件後設資料
 * @param {S3Client} s3Client - S3客戶端例項
 * @param {string} bucketName - 儲存桶名稱
 * @param {string} key - 物件鍵名
 * @returns {Promise<Object|null>} 物件後設資料，不存在時返回null
 */
async function getS3ObjectMetadata(s3Client, bucketName, key) {
  try {
    const headParams = {
      Bucket: bucketName,
      Key: key,
    };

    const headCommand = new HeadObjectCommand(headParams);
    return await s3Client.send(headCommand);
  } catch (error) {
    if (error.$metadata && error.$metadata.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * 列出S3目錄內容
 * @param {S3Client} s3Client - S3客戶端例項
 * @param {string} bucketName - 儲存桶名稱
 * @param {string} prefix - 目錄字首
 * @param {string} delimiter - 分隔符，預設為'/'
 * @param {string} continuationToken - 分頁令牌
 * @returns {Promise<Object>} 目錄內容
 */
async function listS3Directory(s3Client, bucketName, prefix, delimiter = "/", continuationToken = undefined) {
  const listParams = {
    Bucket: bucketName,
    Prefix: prefix,
    Delimiter: delimiter,
    ContinuationToken: continuationToken,
  };

  const command = new ListObjectsV2Command(listParams);
  return await s3Client.send(command);
}

/**
 * 遞迴獲取目錄中所有檔案的預簽名URL
 * @param {S3Client} s3Client - 源S3客戶端
 * @param {Object} sourceS3Config - 源S3配置
 * @param {Object} targetS3Config - 目標S3配置
 * @param {string} sourcePath - 源目錄路徑
 * @param {string} targetPath - 目標目錄路徑
 * @param {string} encryptionSecret - 加密金鑰
 * @param {number} expiresIn - URL過期時間（秒）
 * @returns {Promise<Array>} 包含檔案預簽名URL的陣列
 */
async function getDirectoryPresignedUrls(s3Client, sourceS3Config, targetS3Config, sourcePath, targetPath, encryptionSecret, expiresIn = 3600) {
  // 確保目錄路徑以斜槓結尾
  const sourcePrefix = sourcePath.endsWith("/") ? sourcePath : sourcePath + "/";
  const targetPrefix = targetPath.endsWith("/") ? targetPath : targetPath + "/";

  // 儲存結果
  const items = [];

  // 遞迴列出目錄中的所有檔案
  let continuationToken = undefined;

  do {
    // 列出源目錄內容（遞迴遍歷）
    const listParams = {
      Bucket: sourceS3Config.bucket_name,
      Prefix: sourcePrefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    };

    const command = new ListObjectsV2Command(listParams);
    const listResponse = await s3Client.send(command);

    // 檢查是否有內容
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // 處理每個物件
      for (const item of listResponse.Contents) {
        const sourceKey = item.Key;

        // 跳過目錄標記（與字首完全匹配的物件）
        if (sourceKey === sourcePrefix) {
          continue;
        }

        // 計算相對路徑和目標路徑
        const relativePath = sourceKey.substring(sourcePrefix.length);
        const targetKey = targetPrefix + relativePath;

        // 為每個檔案生成下載和上傳的預簽名URL
        const rawUrl = await generateDownloadUrl(sourceS3Config, sourceKey, encryptionSecret, expiresIn);

        // 獲取檔案的content-type
        let contentType = "application/octet-stream";
        try {
          const headResponse = await getS3ObjectMetadata(s3Client, sourceS3Config.bucket_name, sourceKey);
          if (headResponse) {
            contentType = headResponse.ContentType || contentType;
          }
        } catch (error) {
          console.warn(`獲取檔案後設資料失敗，使用預設content-type: ${error.message}`);
        }

        // 計算相對路徑資訊（用於前端構建目錄結構）
        const pathParts = relativePath.split("/");
        const fileName = pathParts.pop();

        // 統一從檔名推斷MIME型別，不依賴原始檔的MIME型別
        const { getEffectiveMimeType } = await import("../../../../utils/fileUtils.js");
        contentType = getEffectiveMimeType(null, fileName);
        console.log(`目錄複製：從檔名[${fileName}]推斷MIME型別: ${contentType}`);

        // 生成上傳預簽名URL
        const uploadUrl = await generateUploadUrl(targetS3Config, targetKey, contentType, encryptionSecret, expiresIn);

        // 計算相對目錄路徑
        const relativeDir = pathParts.join("/");

        // 新增到結果集：僅提供統一的 rawUrl 欄位
        items.push({
          sourceKey,
          targetKey,
          fileName,
          relativeDir,
          contentType,
          size: item.Size,
          rawUrl,
          uploadUrl,
        });
      }
    }

    // 更新令牌用於下一次迴圈
    continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

// ========== Exports ==========

export {
  createS3Client,
  buildS3Url,
  generateUploadUrl,
  generateDownloadUrl,
  deleteFileFromS3,
  checkS3ObjectExists,
  getS3ObjectMetadata,
  listS3Directory,
  getDirectoryPresignedUrls,
};
