import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { normalizePath } from "../utils/PathResolver.js";
import { validateDirectoryPathSegments } from "../utils/FsInputValidator.js";
import { StorageQuotaGuard } from "../../usage/StorageQuotaGuard.js";

function clampPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function resolveTargetPath(path, filename) {
  const p = String(path || "");
  const name = filename == null ? "" : String(filename);
  if (name && p.endsWith("/")) {
    return `${p}${name}`;
  }
  return p;
}

function guessIncomingBytes(fileOrStream, options) {
  const fromOptions = clampPositiveInt(options?.contentLength);
  if (fromOptions) return fromOptions;

  // best-effort：當 body 是記憶體資料時直接取長度
  const maybeSize =
    (typeof fileOrStream === "string" ? fileOrStream.length : null) ??
    (typeof fileOrStream?.byteLength === "number" ? fileOrStream.byteLength : null) ??
    (typeof fileOrStream?.size === "number" ? fileOrStream.size : null) ??
    null;

  return clampPositiveInt(maybeSize);
}

export async function uploadFile(fs, path, fileOrStream, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  // 自定義容量限制（全域性入口兜底）
  // - 不能只靠路由層攔截：WebDAV PUT / 內部呼叫也會走到這裡
  // - best-effort：只有當我們能拿到 incomingBytes 時才攔截
  const storageConfigId = mount?.storage_config_id;
  const incomingBytes = guessIncomingBytes(fileOrStream, options);
  if (storageConfigId && incomingBytes) {
    const quota = new StorageQuotaGuard(fs.mountManager.db, fs.mountManager.encryptionSecret, fs.repositoryFactory, { env: fs.env });
    let oldBytes = null;
    try {
      const targetPath = resolveTargetPath(path, options?.filename);
      const existing = await fs.getFileInfo(targetPath, userIdOrInfo, userType);
      if (existing && existing.isDirectory !== true && typeof existing.size === "number" && existing.size >= 0) {
        oldBytes = existing.size;
      }
    } catch {
      oldBytes = null;
    }
    await quota.assertCanConsume({
      storageConfigId,
      incomingBytes,
      oldBytes,
      context: "fs-feature-uploadFile",
    });
  }

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (!driver.uploadFile) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援檔案上傳`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.uploadFile(subPath, fileOrStream, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    ...options,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-stream" });
  return result;
}

export async function uploadDirect(fs, path, body, userIdOrInfo, userType, options = {}) {
  const { filename, contentType, contentLength } = options;
  return await fs.uploadFile(path, /** @type {any} */ (body), userIdOrInfo, userType, {
    filename,
    contentType,
    contentLength,
  });
}

export async function createDirectory(fs, path, userIdOrInfo, userType) {
  // 目錄建立的路徑語義：目錄路徑必須以 / 結尾（root 除外）。統一在後端入口規範化，避免目錄被當成檔案路徑。
  const dirPath = normalizePath(path, true);
  if (typeof path === "string" && path !== dirPath) {
    console.warn("[fs.createDirectory] 輸入路徑未按目錄格式(缺少尾部/)，已自動規範化:", { path, dirPath });
  }

  // 目錄路徑按段校驗：每一段都必須是合法 name（禁止 / \\ ? < > * : | "，禁止 . / ..）
  // 允許多級目錄（例如 /a/b/c/），但每一段都要合法。
  const segmentsValidation = validateDirectoryPathSegments(dirPath);
  if (!segmentsValidation.valid) {
    throw new DriverError(segmentsValidation.message, {
      status: ApiStatus.BAD_REQUEST,
      code: "FS.MKDIR.INVALID_NAME",
      expose: true,
    });
  }

  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(dirPath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.createDirectory(subPath, {
    path: dirPath,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [dirPath], reason: "mkdir" });
  return result;
}

export async function updateFile(fs, path, content, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (!driver.updateFile) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援檔案更新`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.updateFile(subPath, content, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "update-file" });
  return result;
}
