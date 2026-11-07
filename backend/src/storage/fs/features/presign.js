import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as fsGenerateFileLink } from "../utils/FsLinkStrategy.js";
import { DriverError } from "../../../http/errors.js";

/**
 * 嚴格的預簽名上傳URL生成功能：
 * - 僅在驅動具備直鏈能力（DIRECT_LINK，通常包含預簽名能力）時可用
 * - 不再回退到代理邏輯
 * - 主要用於 S3 等具備預簽名能力的儲存
 */
export async function generateUploadUrl(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.DIRECT_LINK)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援預簽名URL`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.generateUploadUrl(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    ...options,
  });

  // 對於上傳場景，直接返回驅動的結果結構（通常包含 uploadUrl / storagePath 等欄位）
  return result;
}

/**
 * 通用檔案連結生成（下載用）：
 * - 掛載檢視下的 Link Resolver 薄包裝，實際策略位於 FsLinkStrategy
 */
export async function generateFileLink(fs, path, userIdOrInfo, userType, options = {}) {
  return await fsGenerateFileLink(fs, path, userIdOrInfo, userType, options);
}

export async function commitPresignedUpload(fs, path, filename, userIdOrInfo, userType, options = {}) {
  const { fileSize, etag, contentType } = options;
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (typeof driver.handleUploadComplete === "function") {
    const result = await driver.handleUploadComplete(subPath, {
      path,
      mount,
      subPath,
      db: fs.mountManager.db,
      fileName: filename,
      fileSize,
      contentType,
      etag,
      userIdOrInfo,
      userType,
      ...options,
    });

    fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
    return result;
  }

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
  return { success: true, message: "上傳完成" };
}

