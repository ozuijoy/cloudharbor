import { ApiStatus } from "../../../constants/index.js";
import { AppError, DriverError } from "../../../http/errors.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { findMountPointByPath } from "../utils/MountResolver.js";
import { isDirectoryPath, isSelfOrSubPath, normalizePath, resolveCopyTargetPath } from "../utils/PathResolver.js";
import { normalizeFsViewPath, validateRenameSameDirectory } from "../utils/FsInputValidator.js";

export async function renameItem(fs, oldPath, newPath, userIdOrInfo, userType) {
  // 分別解析舊路徑和新路徑，確保仍在同一掛載下
  const oldCtx = await fs.mountManager.getDriverByPath(oldPath, userIdOrInfo, userType);
  const newCtx = await fs.mountManager.getDriverByPath(newPath, userIdOrInfo, userType);

  const { driver, mount, subPath: oldSubPath } = oldCtx;
  const { mount: newMount, subPath: newSubPath } = newCtx;

  // 重新命名只支援同一掛載/同一驅動內的路徑
  if (mount.id !== newMount.id || driver.getType() !== newCtx.driver.getType()) {
    throw new DriverError("重新命名僅支援同一儲存掛載內的路徑", {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.CROSS_MOUNT_RENAME_NOT_SUPPORTED",
      expose: true,
    });
  }

  if (!driver.hasCapability(CAPABILITIES.ATOMIC)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援原子操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // ===== 重新命名語義校驗 =====
  // 這裡用 subPath 做校驗：只在掛載內部對比目錄層級，避免掛載字首影響判斷
  const oldForCheck = typeof oldSubPath === "string" ? oldSubPath : oldPath;
  const newForCheck = typeof newSubPath === "string" ? newSubPath : newPath;
  const oldNormalized = normalizeFsViewPath(oldForCheck);
  const newNormalized = normalizeFsViewPath(newForCheck);

  // 禁止重新命名掛載根
  if (oldNormalized === "/" || newNormalized === "/") {
    throw new DriverError("不支援重新命名掛載根目錄", {
      status: ApiStatus.BAD_REQUEST,
      code: "FS.RENAME.ROOT_NOT_SUPPORTED",
      expose: true,
    });
  }

  const renameValidation = validateRenameSameDirectory(oldNormalized, newNormalized);
  if (!renameValidation.valid) {
    throw new DriverError(renameValidation.message, {
      status: ApiStatus.BAD_REQUEST,
      code: "FS.RENAME.INVALID_NAME",
      expose: true,
    });
  }

  const result = await driver.renameItem(oldSubPath, newSubPath, {
    mount,
    oldSubPath,
    newSubPath,
    oldPath,
    newPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [oldPath, newPath], reason: "rename" });
  return result;
}

export async function copyItem(fs, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  // 目標是目錄且源為檔案時，自動拼接原始檔名
  targetPath = resolveCopyTargetPath(sourcePath, targetPath);

  // 先解析源與目標掛載與驅動，在 FS 層統一做跨儲存決策
  const sourceCtx = await fs.mountManager.getDriverByPath(sourcePath, userIdOrInfo, userType);
  const targetCtx = await fs.mountManager.getDriverByPath(targetPath, userIdOrInfo, userType);

  const { driver: sourceDriver, mount: sourceMount, subPath: sourceSubPath } = sourceCtx;
  const { driver: targetDriver, mount: targetMount, subPath: targetSubPath } = targetCtx;

  // 目錄判斷：用於決定是否走目錄級 orchestrator
  const sourceIsDirectory = isDirectoryPath(sourcePath);

  const sameMount = sourceMount.id === targetMount.id;

  // 統一目錄自複製防護：同一掛載內，禁止將目錄複製到自身或其子目錄
  if (sameMount && sourceIsDirectory) {
    const src = sourceSubPath ?? sourcePath;
    const dst = targetSubPath ?? targetPath;
    if (isSelfOrSubPath(src, dst)) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "無法將目錄複製到自身或其子目錄中",
      };
    }
  }

  // ========== 統一 skipExisting 檢查（單檔案級別） ==========
  // 對於單檔案複製，在入口層統一檢查目標是否存在，避免下游重複檢查
  // 對於目錄複製，每個子檔案需要單獨檢查，交由下游 orchestrator 處理
  const { skipExisting = false } = options;
  if (skipExisting && !sourceIsDirectory) {
    try {
      const targetExists = await targetDriver.exists(targetSubPath, {
        mount: targetMount,
        subPath: targetSubPath,
        db: fs.mountManager.db,
        userIdOrInfo,
        userType,
      });
      if (targetExists) {
        return {
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          source: sourcePath,
          target: targetPath,
          contentLength: 0,
        };
      }
    } catch (checkError) {
      // exists 檢查失敗時繼續複製（降級處理）
      console.warn(`[copyItem] skipExisting 檢查失敗 for ${targetPath}:`, checkError?.message || checkError);
    }
    // 標記已檢查，下游無需重複檢查
    options = { ...options, _skipExistingChecked: true };
  }

  // 1）同掛載：保持現有語義，完全交給單一驅動處理（可以是 S3 或 WebDAV 等）
  if (sameMount) {
    if (!sourceDriver.hasCapability(CAPABILITIES.ATOMIC)) {
      throw new DriverError(`儲存驅動 ${sourceDriver.getType()} 不支援原子操作`, {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.NOT_IMPLEMENTED",
        expose: true,
      });
    }

    const result = await sourceDriver.copyItem(sourceSubPath, targetSubPath, {
      mount: sourceMount,
      sourceSubPath,
      targetSubPath,
      sourcePath,
      targetPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      findMountPointByPath,
      encryptionSecret: fs.mountManager.encryptionSecret,
      ...options,
    });

    // copy 不會改變 sourcePath 所在目錄的列表內容；僅失效目標側目錄即可
    fs.emitCacheInvalidation({ mount: sourceMount, paths: [targetPath], reason: "copy" });
    return result;
  }

  // 2）跨掛載：走通用 orchestrator，支援檔案和目錄
  if (sourceIsDirectory) {
    // 目錄：使用目錄級 orchestrator，遞迴複製目錄下所有檔案
    return await copyDirectoryBetweenDrivers(
      fs,
      sourceCtx,
      targetCtx,
      sourcePath,
      targetPath,
      userIdOrInfo,
      userType,
      options,
    );
  }

  // 檔案：使用單檔案 orchestrator
  return await copyBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options);
}

export async function batchRemoveItems(fs, paths, userIdOrInfo, userType) {
  if (!paths || paths.length === 0) {
    return { success: 0, failed: [] };
  }

  const firstCtx = await fs.mountManager.getDriverByPath(paths[0], userIdOrInfo, userType);
  const { driver, mount } = firstCtx;

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${driver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const okPaths = [];
  const okSubPaths = [];
  const crossMountFailed = [];

  for (const p of paths) {
    const ctx = await fs.mountManager.getDriverByPath(p, userIdOrInfo, userType);
    if (ctx?.mount?.id !== mount?.id || ctx?.driver?.getType?.() !== driver.getType()) {
      crossMountFailed.push({ path: p, error: "跨掛載批次刪除不支援" });
      continue;
    }
    okPaths.push(p);
    okSubPaths.push(ctx.subPath);
  }

  const result = await driver.batchRemoveItems(okSubPaths, {
    mount,
    paths: okPaths,
    subPaths: okSubPaths,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    findMountPointByPath,
  });

  const resultFailed = Array.isArray(result?.failed) ? result.failed : [];
  const mergedFailed = [...resultFailed, ...crossMountFailed];

  const merged = {
    ...result,
    failed: mergedFailed,
  };

  fs.emitCacheInvalidation({ mount, paths: okPaths, reason: "batch-remove" });
  return merged;
}

/**
 * 建立位元組計數 TransformStream（用於跨儲存複製進度監控）
 *
 * @param {function} onProgress - 進度回撥 (bytesTransferred: number) => void
 * @returns {TransformStream} 透傳流，同時統計位元組數
 */
function createProgressStream(onProgress) {
  let bytesTransferred = 0;

  return new TransformStream({
    transform(chunk, controller) {
      bytesTransferred += chunk.byteLength || chunk.length || 0;
      controller.enqueue(chunk);

      // 呼叫進度回撥
      if (typeof onProgress === "function") {
        onProgress(bytesTransferred);
      }
    },
  });
}

/**
 * 通用跨儲存複製 orchestrator（單檔案粒度）
 * - 僅依賴 READER/WRITER 能力與 downloadFile/uploadFile 方法
 * - 後端流式複製: downloadFile → uploadFile
 * - 支援位元組級進度監控 (options.onProgress 回撥)
 *
 * @param {object} options.onProgress - 可選進度回撥 (bytesTransferred: number) => void
 */
async function copyBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  const { driver: sourceDriver, mount: sourceMount, subPath: sourceSubPath } = sourceCtx;
  const { driver: targetDriver, mount: targetMount, subPath: targetSubPath } = targetCtx;
  const { skipExisting = true, _skipExistingChecked = false } = options;

  if (!sourceDriver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`儲存驅動 ${sourceDriver.getType()} 不支援讀取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (!targetDriver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`儲存驅動 ${targetDriver.getType()} 不支援寫入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // skipExisting 檢查：在下載前檢查目標檔案是否已存在
  // 如果入口層已檢查（_skipExistingChecked=true），跳過重複檢查
  if (skipExisting && !_skipExistingChecked) {
    try {
      const targetExists = await targetDriver.exists(targetSubPath, {
        mount: targetMount,
        subPath: targetSubPath,
        db: fs.mountManager.db,
        userIdOrInfo,
        userType,
      });
      if (targetExists) {
        return {
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          source: sourcePath,
          target: targetPath,
          contentLength: 0,
        };
      }
    } catch (checkError) {
      // exists 檢查失敗時繼續複製（降級處理）
      console.warn(`[copyBetweenDrivers] skipExisting 檢查失敗 for ${targetPath}:`, checkError?.message || checkError);
    }
  }

  // 用於在 finally 中關閉流
  let streamHandle = null;

  try {
    // 1. 從源驅動以流方式下載
    // downloadFile 返回 StorageStreamDescriptor
    const downloadResult = await sourceDriver.downloadFile(sourceSubPath, {
      path: sourcePath,
      mount: sourceMount,
      subPath: sourceSubPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      request: null,
    });

    // 所有驅動現在都返回 StorageStreamDescriptor
    if (typeof downloadResult?.getStream !== "function") {
      throw new DriverError("源儲存驅動返回了無效的 StorageStreamDescriptor 結構", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.INVALID_STREAM_DESCRIPTOR",
        expose: false,
      });
    }

    streamHandle = await downloadResult.getStream();
    const body = streamHandle.stream;
    const contentType = downloadResult.contentType;
    const contentLength = downloadResult.size;

    if (!body) {
      throw new DriverError("源儲存驅動未返回可用的資料流", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.CROSS_STORAGE_NO_BODY",
        expose: false,
      });
    }

    // 推導檔名：
    // - FS 檢視約定：以 "/" 結尾的是目錄，其餘視為檔案路徑
    // - 若 targetPath 為目錄路徑，則自動複用原始檔名；否則使用 targetPath 最後一段作為目標檔名
    const targetSegments = targetPath.split("/").filter(Boolean);
    const sourceSegments = sourcePath.split("/").filter(Boolean);
    const sourceFileName =
      sourceSegments[sourceSegments.length - 1] || "file";
    const targetLeaf = targetSegments[targetSegments.length - 1] || "";
    const targetIsDirectory = isDirectoryPath(targetPath);

    const filename = targetIsDirectory ? sourceFileName : (targetLeaf || sourceFileName);

    // 2. 如果提供了進度回撥，包裝流以監控位元組傳輸
    let streamToUpload = body;
    if (typeof options.onProgress === "function" && body && typeof body.pipeThrough === "function") {
      const progressStream = createProgressStream(options.onProgress);
      streamToUpload = body.pipeThrough(progressStream);
    }

    // 3. 將流寫入目標驅動
    const uploadResult = await targetDriver.uploadFile(targetSubPath, streamToUpload, {
      path: targetPath,
      mount: targetMount,
      subPath: targetSubPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      filename,
      contentType: options.contentType || contentType || undefined,
      contentLength: options.contentLength || contentLength || undefined,
    });

    // 4. 只對目標掛載做快取失效即可（源掛載未發生寫操作）
    fs.emitCacheInvalidation({ mount: targetMount, paths: [targetPath], reason: "cross-storage-copy" });

    return {
      status: "success",
      source: sourcePath,
      target: targetPath,
      uploadResult,
      contentLength: contentLength || 0,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new DriverError("跨儲存複製失敗", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "DRIVER_ERROR.CROSS_STORAGE_FAILED",
      expose: false,
      details: {
        cause: error?.message,
        sourcePath,
        targetPath,
        sourceDriverType: sourceDriver.getType?.() ?? sourceDriver.type,
        targetDriverType: targetDriver.getType?.() ?? targetDriver.type,
      },
    });
  } finally {
    // 確保關閉流控制代碼
    if (streamHandle && typeof streamHandle.close === "function") {
      try {
        await streamHandle.close();
      } catch (closeError) {
        console.warn(`[copyBetweenDrivers] 關閉流控制代碼失敗:`, closeError?.message || closeError);
      }
    }
  }
}

/**
 * 通用跨儲存目錄複製 orchestrator
 * - 基於 FileSystem.listDirectory 遞迴列出源目錄下的所有檔案
 * - 透過 copyBetweenDrivers 按檔案級別執行復制
 */
async function copyDirectoryBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  const sourceBase = normalizePath(sourcePath, true);
  const targetBase = normalizePath(targetPath, true);

  let successCount = 0;
  let skippedCount = 0;
  const failedDetails = [];

  // 確保目標根目錄存在（忽略“已存在”等非致命錯誤）
  try {
    await fs.createDirectory(targetBase, userIdOrInfo, userType);
  } catch (e) {
    // 目錄已存在或不支援建立目錄時忽略，由後續檔案寫入自行處理
    console.warn(`跨儲存目錄複製：建立目標根目錄失敗 ${targetBase}，錯誤: ${e?.message || e}`);
  }

  // 使用棧進行深度優先遍歷目錄
  const stack = [sourceBase];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    try {
      const dirResult = await fs.listDirectory(currentDir, userIdOrInfo, userType, { refresh: true });
      const items = Array.isArray(dirResult.items) ? dirResult.items : [];

      for (const item of items) {
        if (!item || !item.path) {
          continue;
        }

        if (item.isDirectory) {
          // 目錄：繼續遞迴
          const dirPath = normalizePath(item.path, true);
          if (!dirPath.startsWith(sourceBase)) {
            continue;
          }

          // 計算對應的目標目錄路徑，並嘗試建立
          const relativeDirPath = dirPath.slice(sourceBase.length);
          const dirTargetPath = `${targetBase}${relativeDirPath}`;
          try {
            await fs.createDirectory(dirTargetPath, userIdOrInfo, userType);
          } catch (e) {
            // 建立失敗時記錄錯誤並跳過該子目錄
            failedDetails.push({
              source: dirPath,
              target: dirTargetPath,
              status: "failed",
              message: e?.message || "建立目標目錄失敗",
            });
            continue;
          }

          stack.push(dirPath);
        } else {
          // 檔案：計算相對路徑並複製
          const fileSourcePath = item.path;
          if (!fileSourcePath.startsWith(sourceBase)) {
            // 理論上不應出現，作為安全防護
            continue;
          }
          const relativePath = fileSourcePath.slice(sourceBase.length);
          const fileTargetPath = `${targetBase}${relativePath}`;

          try {
            // 對每一個檔案重新解析掛載與子路徑，避免沿用目錄級上下文導致子路徑錯誤
            const fileSourceCtx = await fs.mountManager.getDriverByPath(fileSourcePath, userIdOrInfo, userType);
            const fileTargetCtx = await fs.mountManager.getDriverByPath(fileTargetPath, userIdOrInfo, userType);

            const fileResult = await copyBetweenDrivers(
              fs,
              fileSourceCtx,
              fileTargetCtx,
              fileSourcePath,
              fileTargetPath,
              userIdOrInfo,
              userType,
              options
            );

            // 處理複製結果：成功、跳過、失敗
            if (fileResult?.status === "skipped" || fileResult?.skipped === true) {
              // 檔案已存在，被跳過
              skippedCount++;
            } else if (fileResult?.status === "success") {
              // 複製成功
              successCount++;
            } else {
              // 複製失敗
              failedDetails.push({
                source: fileSourcePath,
                target: fileTargetPath,
                status: fileResult?.status || "failed",
                message: fileResult?.message || "複製失敗",
              });
            }
          } catch (err) {
            failedDetails.push({
              source: fileSourcePath,
              target: fileTargetPath,
              status: "failed",
              message: err?.message || "複製失敗",
            });
          }
        }
      }
    } catch (err) {
      failedDetails.push({
        source: currentDir,
        target: targetBase,
        status: "failed",
        message: err?.message || "列出目錄失敗",
      });
    }
  }

  const failedCount = failedDetails.length;
  const totalProcessed = successCount + skippedCount + failedCount;

  // 狀態判定：
  // - 全部成功（含跳過）：success
  // - 部分成功：partial
  // - 全部失敗：failed
  let status = "success";
  if (failedCount > 0) {
    status = successCount > 0 || skippedCount > 0 ? "partial" : "failed";
  }

  return {
    status,
    stats: {
      success: successCount,
      skipped: skippedCount,
      failed: failedCount,
    },
    details: failedDetails,
    source: sourcePath,
    target: targetPath,
  };
}
