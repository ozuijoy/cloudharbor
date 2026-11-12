/**
 * Google Drive 上傳操作模組
 * - 負責前端分片上傳（single_session + 後端中轉）的具體實現
 */

import { DriverError } from "../../../http/errors.js";
import {
  createUploadSessionRecord,
  updateUploadSessionStatusByFingerprint,
  listActiveUploadSessions,
  findUploadSessionById,
} from "../../../utils/uploadSessions.js";

export class GoogleDriveUploadOperations {
  /**
   * @param {import("./GoogleDriveStorageDriver.js").GoogleDriveStorageDriver} driver
   */
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * 初始化前端分片上傳
   * - 建立 Google Drive resumable 會話
   * - 在本地 upload_sessions 表中記錄會話資訊
   * - 返回 single_session 策略，供前端透過 AwsS3 + StorageAdapter 進行分片上傳
   *
   * @param {string} subPath 掛載檢視下的子路徑（目錄或完整相對路徑）
   * @param {Object} options 選項引數
   * @returns {Promise<Object>} 初始化結果（InitResult）
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    const {
      fileName,
      fileSize,
      partSize = this.driver.chunkSizeMb
        ? this.driver.chunkSizeMb * 1024 * 1024
        : 5 * 1024 * 1024,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DriverError("Google Drive 分片上傳初始化失敗：缺少有效的 fileName 或 fileSize", {
        status: 400,
      });
    }

    if (!db || !mount?.storage_config_id) {
      throw new DriverError(
        "Google Drive 分片上傳初始化失敗：缺少資料庫或儲存配置（storage_config_id）",
        {
          status: 500,
        },
      );
    }

    // Google Drive 要求分片大小為 256KB 的整數倍，除最後一片外
    const unit = 256 * 1024;
    const rawPartSize = partSize || 5 * 1024 * 1024;
    const effectivePartSize =
      Math.max(unit, Math.round(rawPartSize / unit) * unit) || 5 * 1024 * 1024;
    const calculatedPartCount =
      partCount || Math.max(1, Math.ceil(fileSize / effectivePartSize));

    // 規範化掛載內目錄路徑，用於計算父目錄 ID 和 FS 檢視路徑
    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    // 解析父目錄 fileId
    let parentId = this.driver.rootId || "root";
    if (base) {
      const parentPath = `/${base}`;
      const { fileId, isDirectory } = await this.driver._resolvePathToFileId(parentPath, {
        subPath: parentPath,
        mount,
      });
      if (!isDirectory) {
        throw new DriverError("Google Drive 分片上傳初始化失敗：目標父路徑不是目錄", {
          status: 400,
        });
      }
      parentId = fileId;
    }

    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType: "application/octet-stream",
    };

    // 初始化 Google Drive resumable 會話
    const initUrl = new URL("files", "https://www.googleapis.com/upload/drive/v3/");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("supportsAllDrives", "true");
    initUrl.searchParams.set("includeItemsFromAllDrives", "true");

    const uploadUrl = await this.driver.authManager.withAccessToken(async (token) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": metadata.mimeType,
      };
      if (Number.isFinite(fileSize) && fileSize > 0) {
        headers["X-Upload-Content-Length"] = String(fileSize);
      }

      const res = await fetch(initUrl.toString(), {
        method: "POST",
        redirect: "follow",
        headers,
        body: JSON.stringify(metadata),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("初始化 Google Drive 分片上傳會話失敗", {
          status: res.status,
          details: { response: text },
        });
      }

      const location = res.headers.get("location") || res.headers.get("Location");
      if (!location) {
        throw new DriverError("Google Drive 分片上傳會話未返回 Location", { status: 500 });
      }
      return location;
    });

    // 規範化掛載檢視路徑：mount_path + remotePath
    let remotePath;
    if (!base) {
      remotePath = fileName;
    } else {
      const segments = base.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";
      remotePath =
        lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    // 建立 upload_sessions 記錄
    let uploadId;
    try {
      const { id } = await createUploadSessionRecord(db, {
        userIdOrInfo,
        userType: userType || null,
        storageType: this.driver.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        source: "FS",
        fileName,
        fileSize,
        mimeType: metadata.mimeType || null,
        checksum: null,
        fingerprintAlgo: null,
        fingerprintValue: null,
        strategy: "single_session",
        partSize: effectivePartSize,
        totalParts: calculatedPartCount,
        bytesUploaded: 0,
        uploadedParts: 0,
        nextExpectedRange: "0-",
        providerUploadId: null,
        providerUploadUrl: uploadUrl,
        providerMeta: null,
        status: "initiated",
        expiresAt: null,
      });
      uploadId = id;
    } catch (error) {
      throw new DriverError("建立 Google Drive 分片上傳會話記錄失敗", {
        status: 500,
        cause: error,
      });
    }

    // 上傳通道：預設 direct（瀏覽器直連 Google 的 resumable session URL，不經後端）
    // 只有 storage config 明確設定 upload_channel="proxy" 時才走後端中轉
    const uploadChannel = String(
      this.driver?.config?.upload_channel || process.env.GD_UPLOAD_CHANNEL || "direct",
    ).toLowerCase();
    const isDirectUpload = uploadChannel !== "proxy";

    // proxy 模式：把分片送給後端，由後端轉發到 Google Drive
    const proxyUploadUrl = `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(
      uploadId,
    )}`;
    const sessionUploadUrl = isDirectUpload ? uploadUrl : proxyUploadUrl;

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-${isDirectUpload ? "direct" : "proxy"} status=初始化完成 路徑=${fsPath} 檔案=${fileName} 大小=${fileSize} uploadId=${uploadId}`,
    );

    return {
      success: true,
      uploadId,
      strategy: "single_session",
      fileName,
      fileSize,
      partSize: effectivePartSize,
      partCount: calculatedPartCount,
      totalParts: calculatedPartCount,
      key: fsPath.replace(/^\/+/, ""),
      session: {
        uploadUrl: sessionUploadUrl,
        providerUploadUrl: uploadUrl,
        channel: isDirectUpload ? "direct" : "proxy",
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
      mount_id: mount?.id ?? null,
      path: fsPath,
      storage_type: this.driver.type,
      userType: userType || null,
      userIdOrInfo: userIdOrInfo || null,
    };
  }

  /**
   * 完成前端分片上傳
   * - 對 Google Drive 而言，最後一個分片 PUT 成功即視為完成
   * - 這裡主要用於對齊 FS 層行為並返回統一結果結構
   *
   * @param {string} subPath 掛載檢視下的子路徑
   * @param {Object} options 選項引數
   * @returns {Promise<Object>} 完成結果（CompleteResult）
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType, parts } = options;

    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    let remotePath;
    if (fileName) {
      if (!base) {
        remotePath = fileName;
      } else {
        const segments = base.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";
        remotePath =
          lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
      }
    } else {
      remotePath = base;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    if (db && mount?.storage_config_id && uploadId && fileName && typeof fileSize === "number") {
      try {
        await updateUploadSessionStatusByFingerprint(db, {
          userIdOrInfo,
          userType,
          storageType: this.driver.type,
          storageConfigId: mount.storage_config_id,
          mountId: mount.id ?? null,
          fsPath,
          fileName,
          fileSize,
          status: "completed",
          bytesUploaded: fileSize,
          uploadedParts: Array.isArray(parts) ? parts.length : null,
          nextExpectedRange: null,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        console.warn(
          "[GoogleDriveUploadOperations] 更新 upload_sessions 狀態為 completed 失敗:",
          error,
        );
      }
    }

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=完成 路徑=${fsPath} 檔案=${fileName} 大小=${fileSize} uploadId=${uploadId}`,
    );

    return {
      success: true,
      fileName: fileName || (remotePath ? remotePath.split("/").pop() : null),
      size: fileSize ?? null,
      contentType: null,
      storagePath: remotePath || "",
      publicUrl: null,
      uploadId: uploadId || null,
      message: "Google Drive 分片上傳完成",
    };
  }

  /**
   * 中止前端分片上傳
   * - 當前實現僅更新 upload_sessions 狀態，依賴 Google Drive 會話過期機制
   */
  async abortFrontendMultipartUpload(subPath, options = {}) {
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    if (!db || !mount?.storage_config_id || !uploadId || !fileName) {
      return { success: true };
    }

    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    let remotePath;
    if (fileName) {
      if (!base) {
        remotePath = fileName;
      } else {
        const segments = base.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";
        remotePath =
          lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
      }
    } else {
      remotePath = base;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    try {
      await updateUploadSessionStatusByFingerprint(db, {
        userIdOrInfo,
        userType,
        storageType: this.driver.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        fileName,
        fileSize: typeof fileSize === "number" ? fileSize : 0,
        status: "aborted",
        bytesUploaded: null,
        uploadedParts: null,
        nextExpectedRange: null,
        errorCode: null,
        errorMessage: null,
      });
    } catch (error) {
      console.warn(
        "[GoogleDriveUploadOperations] 更新 upload_sessions 狀態為 aborted 失敗:",
        error,
      );
    }

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=中止 路徑=${fsPath} 檔案=${fileName} uploadId=${uploadId}`,
    );

    return { success: true };
  }

  /**
   * 列出進行中的分片上傳
   * - 基於 upload_sessions 表，返回的結構與 ServerResumePlugin 使用的欄位相相容
   *
   * @param {string} subPath 掛載內路徑字首
   * @param {Object} options 選項引數
   * @returns {Promise<Object>} { uploads: Array }
   */
  async listMultipartUploads(subPath = "", options = {}) {
    const { mount, db, userIdOrInfo, userType } = options;

    if (!db || !mount?.id) {
      return {
        success: true,
        uploads: [],
      };
    }

    let fsPathPrefix = subPath || "";
    if (mount.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (subPath || "").replace(/^\/+/g, "");
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: this.driver.type,
      mountId: mount.id ?? null,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = sessions.map((row) => ({
      key: (row.fs_path || "/").replace(/^\/+/, ""),
      uploadId: row.id,
      initiated: row.created_at,
      storageClass: null,
      owner: null,
      fileName: row.file_name,
      fileSize: row.file_size,
      partSize: row.part_size,
      strategy: row.strategy || "single_session",
      storageType: row.storage_type,
      sessionId: row.id,
      bytesUploaded: row.bytes_uploaded ?? 0,
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    }));

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=列出會話 count=${uploads.length} 路徑字首=${fsPathPrefix}`,
    );

    return {
      success: true,
      uploads,
    };
  }

  /**
   * 列出指定上傳任務的已上傳分片
   * - 對於 Google Drive single_session 模式，由於 Drive 不提供 per-part 列表，
   *   預設基於 upload_sessions.bytes_uploaded 與 partSize 估算“已完成的完整分片”數量。
   * - 為了與 OneDrive 行為對齊，優先嚐試向 Google Drive 查詢遠端會話狀態（Range），
   *   若查詢成功則以後端返回的 bytesUploaded 為準，同步回本地 upload_sessions；
   *   查詢失敗時再回退到本地記錄。
   * - 用於配合 ServerResumePlugin / StorageAdapter 的服務端斷點續傳邏輯：
   *   返回從 1 開始、連續的已完成分片編號列表，最後一塊未對齊的資料將由前端重新上傳。
   */
  async listMultipartParts(_subPath, uploadId, options = {}) {
    const { mount, db, userIdOrInfo, userType } = options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId || !db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }

    try {
      // Google Drive 場景下，uploadId 即 upload_sessions.id
      const sessionRow = await findUploadSessionById(db, { id: uploadId });
      if (!sessionRow) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const totalSize = Number(sessionRow.file_size) || null;
      const partSize = Number(sessionRow.part_size) || 5 * 1024 * 1024;

      if (!totalSize || !Number.isFinite(totalSize) || !Number.isFinite(partSize) || partSize <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      let bytesUploaded = null;

      // 優先嚐試向 Google Drive 查詢遠端會話狀態，以雲端為準
      if (sessionRow.provider_upload_url) {
        try {
          const statusInfo = await this._getResumableUploadStatus(
            sessionRow.provider_upload_url,
            totalSize,
          );

          if (
            statusInfo &&
            typeof statusInfo.bytesUploaded === "number" &&
            Number.isFinite(statusInfo.bytesUploaded) &&
            statusInfo.bytesUploaded > 0
          ) {
            bytesUploaded = statusInfo.bytesUploaded;

            // 嘗試同步更新本地 upload_sessions 狀態（非關鍵路徑）
            if (db && mount?.storage_config_id) {
              try {
                await updateUploadSessionStatusByFingerprint(db, {
                  userIdOrInfo,
                  userType,
                  storageType: this.driver.type,
                  storageConfigId: sessionRow.storage_config_id,
                  mountId: sessionRow.mount_id ?? mount.id ?? null,
                  fsPath: sessionRow.fs_path,
                  fileName: sessionRow.file_name,
                  fileSize: totalSize,
                  status: statusInfo.done ? "completed" : "uploading",
                  bytesUploaded,
                  nextExpectedRange: statusInfo.nextExpectedRange ?? null,
                });
              } catch (syncError) {
                console.warn(
                  "[GoogleDriveUploadOperations] 同步遠端會話狀態到 upload_sessions 失敗(listMultipartParts):",
                  syncError,
                );
              }
            }
          }
        } catch (statusError) {
          console.warn(
            "[GoogleDriveUploadOperations] 查詢 Google Drive 會話狀態失敗(listMultipartParts)，回退使用本地記錄:",
            statusError,
          );
        }
      }

      // 若遠端查詢不可用或結果無效，則回退到本地記錄的 bytes_uploaded
      if (!Number.isFinite(bytesUploaded) || bytesUploaded == null || bytesUploaded <= 0) {
        const localBytes =
          typeof sessionRow.bytes_uploaded === "number"
            ? Number(sessionRow.bytes_uploaded)
            : null;

        if (!Number.isFinite(localBytes) || localBytes <= 0) {
          return {
            success: true,
            uploadId: uploadId || null,
            parts: [],
            policy,
          };
        }
        bytesUploaded = localBytes;
      }

      // 取整計算“已完成的完整分片”數量，最後一塊未對齊的資料將由前端重新上傳
      const completedParts = Math.floor(bytesUploaded / partSize);
      if (completedParts <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const parts = [];
      for (let partNumber = 1; partNumber <= completedParts; partNumber += 1) {
        parts.push({
          partNumber,
          size: partSize,
          // Google Drive 不暴露 per-part etag，這裡使用偽造的 etag 僅用於本地快取與跳過邏輯
          etag: `gdrive-part-${partNumber}`,
        });
      }

      const result = {
        success: true,
        uploadId: uploadId || null,
        parts,
        policy,
      };
      console.log(
        `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=列出分片 uploadId=${uploadId} 完整分片數=${parts.length}`,
      );
      return result;
    } catch (error) {
      console.warn(
        "[GoogleDriveUploadOperations] listMultipartParts 異常，回退為空分片列表:",
        error,
      );
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }
  }

  /**
   * 重新整理現有上傳會話的 URL/狀態
   * - 對於 Google Drive single_session 模式，uploadUrl 不會變化
   * - 為了與 OneDrive 行為對齊，會優先嚐試向雲端查詢最新進度並同步回本地，再返回會話資訊
   *
   * @param {string} subPath
   * @param {string} uploadId
   * @param {Array<number>} _partNumbers
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async signMultipartParts(subPath, uploadId, _partNumbers, options = {}) {
    const { mount, db, userIdOrInfo, userType } = options;
    if (!uploadId) {
      throw new DriverError("Google Drive 重新整理分片會話失敗：缺少 uploadId", {
        status: 400,
        expose: true,
      });
    }

    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    // 即使缺少 db/mount，也必須返回嚴格的最小欄位結構（被 DriverContractEnforcer 強制校驗）
    if (!db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: String(uploadId),
        strategy: "single_session",
        session: {
          uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
          nextExpectedRanges: [],
        },
        policy,
        message: "缺少 db/mount，上游會話狀態無法重新整理，已回退為最小可用返回結構",
      };
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      return {
        success: true,
        uploadId: String(uploadId),
        strategy: "single_session",
        session: {
          uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
          nextExpectedRanges: [],
        },
        policy,
        message: "未找到 upload_sessions 記錄，已回退為最小可用返回結構",
      };
    }

    const totalSize = Number(sessionRow.file_size) || null;
    let nextExpectedRange = sessionRow.next_expected_range || null;
    let bytesUploaded =
      typeof sessionRow.bytes_uploaded === "number"
        ? Number(sessionRow.bytes_uploaded)
        : null;

    // 優先嚐試向 Google Drive 查詢遠端會話狀態，以雲端為準
    if (totalSize && sessionRow.provider_upload_url) {
      try {
        const statusInfo = await this._getResumableUploadStatus(
          sessionRow.provider_upload_url,
          totalSize,
        );

        if (
          statusInfo &&
          typeof statusInfo.bytesUploaded === "number" &&
          Number.isFinite(statusInfo.bytesUploaded)
        ) {
          bytesUploaded = statusInfo.bytesUploaded;
          nextExpectedRange = statusInfo.nextExpectedRange ?? null;
        }

        // 同步遠端狀態到本地 upload_sessions（非關鍵路徑）
        if (db && mount?.storage_config_id) {
          try {
            await updateUploadSessionStatusByFingerprint(db, {
              userIdOrInfo,
              userType,
              storageType: this.driver.type,
              storageConfigId: sessionRow.storage_config_id,
              mountId: sessionRow.mount_id ?? mount.id ?? null,
              fsPath: sessionRow.fs_path,
              fileName: sessionRow.file_name,
              fileSize: totalSize,
              status: statusInfo.done ? "completed" : "uploading",
              bytesUploaded,
              nextExpectedRange,
            });
          } catch (syncError) {
            console.warn(
              "[GoogleDriveUploadOperations] 同步遠端會話狀態到 upload_sessions 失敗(signMultipartParts):",
              syncError,
            );
          }
        }
      } catch (statusError) {
        const status = statusError?.status;
        const code = statusError?.code;

        // 當遠端會話不存在或已過期時，標記本地會話為失效並向上丟擲明確錯誤，
        // 讓前端放棄斷點續傳並重新建立上傳（對齊 OneDrive 行為）。
        if (status === 404 || code === "UPLOAD_SESSION_NOT_FOUND") {
          if (db && mount?.storage_config_id && sessionRow) {
            try {
              await updateUploadSessionStatusByFingerprint(db, {
                userIdOrInfo,
                userType,
                storageType: this.driver.type,
                storageConfigId: sessionRow.storage_config_id,
                mountId: sessionRow.mount_id ?? mount.id ?? null,
                fsPath: sessionRow.fs_path,
                fileName: sessionRow.file_name,
                fileSize: sessionRow.file_size,
                status: "error",
                errorCode: "UPLOAD_SESSION_NOT_FOUND",
                errorMessage: "Google Drive upload session not found or expired",
              });
            } catch (markError) {
              console.warn(
                "[GoogleDriveUploadOperations] 標記 upload_sessions 會話為失效失敗(signMultipartParts):",
                markError,
              );
            }
          }

          throw new DriverError("Google Drive 上傳會話不存在或已過期，無法繼續斷點續傳", {
            status: 404,
            code: "UPLOAD_SESSION_NOT_FOUND",
            expose: true,
          });
        }

        console.warn(
          "[GoogleDriveUploadOperations] 查詢 Google Drive 會話狀態失敗(signMultipartParts)，回退使用本地記錄:",
          statusError,
        );
      }
    }

    const nextRanges = nextExpectedRange ? [String(nextExpectedRange)] : [];

    // 續傳時保持與初始化一致的通道：預設直連（Google resumable URL），proxy 模式才走後端
    const refreshChannel = String(
      this.driver?.config?.upload_channel || process.env.GD_UPLOAD_CHANNEL || "direct",
    ).toLowerCase();
    const refreshDirectUrl = sessionRow?.provider_upload_url
      ? String(sessionRow.provider_upload_url)
      : null;
    const refreshUploadUrl =
      refreshChannel !== "proxy" && refreshDirectUrl
        ? refreshDirectUrl
        : `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`;

    const result = {
      success: true,
      uploadId: String(uploadId),
      strategy: "single_session",
      session: {
        uploadUrl: refreshUploadUrl,
        providerUploadUrl: refreshDirectUrl,
        channel: refreshChannel !== "proxy" && refreshDirectUrl ? "direct" : "proxy",
        nextExpectedRanges: nextRanges,
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    };
    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=重新整理會話 uploadId=${uploadId} nextExpectedRange=${nextExpectedRange ?? "null"}`,
    );
    return result;
  }

  /**
   * 後端中轉前端分片到 Google Drive resumable 會話
   * - 被 /api/fs/multipart/upload-chunk 呼叫
   *
   * @param {Object} sessionRow upload_sessions 表中的會話記錄
   * @param {any} body 分片資料（ReadableStream 或 Buffer）
   * @param {Object} options 選項引數
   * @returns {Promise<{ status: number, done: boolean }>}
   */
  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    const { contentRange, contentLength } = options;

    const uploadUrl = sessionRow.provider_upload_url;
    if (!uploadUrl) {
      throw new DriverError("Google Drive 上傳會話缺少 provider_upload_url", { status: 500 });
    }

    const res = await this.driver.authManager.withAccessToken(async (token) => {
      /** @type {Record<string,string>} */
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Range": contentRange,
      };
      if (Number.isFinite(contentLength) && contentLength > 0) {
        headers["Content-Length"] = String(contentLength);
      }

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body,
        redirect: "follow",
      });
      return response;
    });

    const status = res.status;
    let done = false;

    if (status >= 200 && status < 300) {
      done = true;
    } else if (status === 308) {
      done = false;
    } else {
      const text = await res.text();
      throw new DriverError("Google Drive 分片上傳失敗", {
        status,
        details: { response: text },
      });
    }

    return { status, done };
  }

  /**
   * 查詢 Google Drive resumable upload 會話狀態
   * - 透過傳送 Content-Length: 0 + Content-Range: bytes * / totalSize 的空 PUT 請求
   * - 根據返回的 HTTP 狀態碼與 Range 頭推導已上傳位元組數
   * @param {string} uploadUrl
   * @param {number|null} totalSize
   * @returns {Promise<{ bytesUploaded: number|null, nextExpectedRange: string|null, done: boolean }>}
   * @private
   */
  async _getResumableUploadStatus(uploadUrl, totalSize) {
    if (!uploadUrl) {
      return { bytesUploaded: null, nextExpectedRange: null, done: false };
    }

    const res = await this.driver.authManager.withAccessToken(async (token) => {
      /** @type {Record<string, string>} */
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Length": "0",
        // 按官方文件要求，使用 bytes */totalSize 查詢會話狀態
        "Content-Range":
          typeof totalSize === "number" && Number.isFinite(totalSize) && totalSize > 0
            ? `bytes */${totalSize}`
            : "bytes */*",
      };

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        redirect: "follow",
      });
      return response;
    });

    const status = res.status;

    // 308 Resume Incomplete: 會話仍在進行中，Range 頭包含已接收的最後一個位元組位置
    if (status === 308) {
      const rangeHeader = res.headers.get("Range") || res.headers.get("range") || null;
      let bytesUploaded = null;

      if (rangeHeader && /^bytes=\d+-\d+$/i.test(rangeHeader)) {
        const lastStr = rangeHeader.split("-")[1];
        const last = Number.parseInt(lastStr, 10);
        if (Number.isFinite(last) && last >= 0) {
          bytesUploaded = last + 1;
        }
      }

      const nextExpectedRange =
        typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded)
          ? `${bytesUploaded}-`
          : null;

      return {
        bytesUploaded,
        nextExpectedRange,
        done: false,
      };
    }

    // 2xx: 說明會話已完成或直接返回了最終資源
    if (status >= 200 && status < 300) {
      return {
        bytesUploaded:
          typeof totalSize === "number" && Number.isFinite(totalSize) ? totalSize : null,
        nextExpectedRange: null,
        done: true,
      };
    }

    // 404: 會話不存在或已過期
    if (status === 404) {
      throw new DriverError("Google Drive 上傳會話不存在或已過期，無法繼續斷點續傳", {
        status: 404,
        code: "UPLOAD_SESSION_NOT_FOUND",
        expose: true,
      });
    }

    const text = await res.text();
    throw new DriverError("查詢 Google Drive 上傳會話狀態失敗", {
      status,
      details: { response: text },
    });
  }
}
