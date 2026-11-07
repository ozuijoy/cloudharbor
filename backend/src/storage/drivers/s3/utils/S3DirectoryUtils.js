/**
 * S3目錄操作工具
 * 提供S3特定的目錄操作功能，如父目錄時間更新、目錄存在檢查等
 */

import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * 更新目錄及其所有父目錄的修改時間
 * @param {S3Client} s3Client - S3客戶端例項
 * @param {string} bucketName - 儲存桶名稱
 * @param {string} filePath - 檔案或目錄路徑
 * @param {string} rootPrefix - 根字首
 * @param {boolean} skipMissingDirectories - 是否跳過不存在的目錄（用於刪除操作）
 */
export async function updateParentDirectoriesModifiedTime(s3Client, bucketName, filePath, rootPrefix = "", skipMissingDirectories = false) {
  try {
    const normalizePrefix = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      let p = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
      p = p.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!p) return "";
      return p.endsWith("/") ? p : `${p}/`;
    };

    const normalizeKey = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      let k = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
      k = k.replace(/^\/+/, "");
      return k;
    };

    const prefix = normalizePrefix(rootPrefix);
    const keyRaw = normalizeKey(filePath);
    if (!keyRaw) return;

    // 統一為“完整 S3 Key”（包含 root_prefix）
    let fullKey = keyRaw;
    if (prefix && !fullKey.startsWith(prefix)) {
      fullKey = `${prefix}${fullKey}`.replace(/\/+/g, "/");
    }

    const touchDirectoryKey = async (dirKey) => {
      const key = normalizeKey(dirKey);
      if (!key || key === "/") return false;

      // 檢查目錄是否存在（透過查詢目錄標記檔案）
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      let directoryExists = false;
      try {
        await s3Client.send(headCommand);
        directoryExists = true;
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) {
          throw error;
        }
      }

      // 如果目錄不存在且允許跳過缺失目錄：直接跳過（用於刪除/移動等場景，避免寫放大）
      if (!directoryExists && skipMissingDirectories) {
        return false;
      }

      const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: "",
        ContentType: "application/x-directory",
        Metadata: {
          "last-modified": new Date().toISOString(),
        },
      };

      const putCommand = new PutObjectCommand(putParams);
      await s3Client.send(putCommand);
      return true;
    };

    // 獲取檔案所在的父目錄 key（確保以 / 結尾）
    let currentDirKey = fullKey;
    if (!currentDirKey.endsWith("/")) {
      const lastSlashIndex = currentDirKey.lastIndexOf("/");
      if (lastSlashIndex > 0) {
        currentDirKey = currentDirKey.substring(0, lastSlashIndex + 1);
      } else {
        // 檔案位於根目錄（或 root_prefix 直接就是根），只需要嘗試更新 root_prefix
        if (prefix) {
          await touchDirectoryKey(prefix);
        }
        return;
      }
    }

    const updated = new Set();

    // 逐級向上更新父目錄，直到 root_prefix（含）為止
    while (currentDirKey && currentDirKey !== "/" && currentDirKey !== prefix) {
      if (updated.has(currentDirKey)) break;
      try {
        const touched = await touchDirectoryKey(currentDirKey);
        if (touched) {
          updated.add(currentDirKey);
          console.log(`已更新目錄修改時間: ${currentDirKey}`);
        } else if (skipMissingDirectories) {
          console.log(`跳過不存在的目錄: ${currentDirKey}`);
        }
      } catch (error) {
        console.warn(`更新目錄修改時間失敗 ${currentDirKey}:`, error);
      }

      const lastSlashIndex = currentDirKey.lastIndexOf("/", currentDirKey.length - 2);
      if (lastSlashIndex > 0) {
        currentDirKey = currentDirKey.substring(0, lastSlashIndex + 1);
      } else {
        break;
      }
    }

    // 把 root_prefix 自己也更新一下（當作“掛載根目錄”）
    if (prefix && !updated.has(prefix)) {
      try {
        const touched = await touchDirectoryKey(prefix);
        if (touched) {
          console.log(`已更新目錄修改時間: ${prefix}`);
        } else if (skipMissingDirectories) {
          console.log(`跳過不存在的目錄: ${prefix}`);
        }
      } catch (error) {
        console.warn(`更新目錄修改時間失敗 ${prefix}:`, error);
      }
    }
  } catch (error) {
    console.warn(`更新父目錄修改時間失敗:`, error);
  }
}

/**
 * 檢查S3目錄是否存在
 * 從webdavUtils.js遷移而來，提供S3目錄存在性檢查
 * @param {S3Client} s3Client - S3客戶端
 * @param {string} bucketName - 儲存桶名稱
 * @param {string} dirPath - 目錄路徑
 * @returns {Promise<boolean>} 目錄是否存在
 */
export async function checkDirectoryExists(s3Client, bucketName, dirPath) {
  // 確保目錄路徑以斜槓結尾
  const normalizedPath = dirPath.endsWith("/") ? dirPath : dirPath + "/";

  try {
    // 首先嚐試作為顯式目錄物件檢查
    try {
      const headParams = {
        Bucket: bucketName,
        Key: normalizedPath,
      };

      const headCommand = new HeadObjectCommand(headParams);
      await s3Client.send(headCommand);
      return true; // 如果存在顯式目錄物件，直接返回true
    } catch (headError) {
      // 顯式目錄物件不存在，繼續檢查隱式目錄
      if (headError.$metadata && headError.$metadata.httpStatusCode === 404) {
        // 嘗試列出以該路徑為字首的物件
        const listParams = {
          Bucket: bucketName,
          Prefix: normalizedPath,
          MaxKeys: 1, // 只需要一個物件即可確認目錄存在
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const listResponse = await s3Client.send(listCommand);

        // 如果有物件以該路徑為字首，則認為目錄存在
        return listResponse.Contents && listResponse.Contents.length > 0;
      } else {
        // 其他錯誤則丟擲
        throw headError;
      }
    }
  } catch (error) {
    // 如果是最終的404錯誤，表示目錄不存在
    if (error.$metadata && error.$metadata.httpStatusCode === 404) {
      return false;
    }
    // 其他錯誤則丟擲
    throw error;
  }
}
