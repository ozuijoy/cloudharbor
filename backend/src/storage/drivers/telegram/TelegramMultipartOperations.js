/**
 * TelegramMultipartOperations
 *
 * - 分片上傳時，一片一行寫入 upload_parts，避免併發寫進度時互相覆蓋
 */

import { ValidationError, DriverError } from "../../../http/errors.js";
import { UploadPartsRepository } from "../../../repositories/UploadPartsRepository.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";
import { getEffectiveMimeType } from "../../../utils/fileUtils.js";
import {
  createUploadSessionRecord,
  updateUploadSessionStatusByFingerprint,
  listActiveUploadSessions,
  findUploadSessionById,
} from "../../../utils/uploadSessions.js";
import { safeJsonParse, splitDirAndName, toPosixPath, stripTrailingSlash } from "./TelegramOperations.js";

const VFS_STORAGE_PATH_PREFIX = "vfs:";

export class TelegramMultipartOperations {
  /**
   * @param {import("./TelegramStorageDriver.js").TelegramStorageDriver} driver
   */
  constructor(driver) {
    this.driver = driver;
  }

  _normalizeBaseSubPath(subPath) {
    return typeof subPath === "string"
      ? subPath.replace(/^[/\\\\]+|[/\\\\]+$/g, "").replace(/[\\\\/]+/g, "/")
      : "";
  }

  _buildFsPathFromSubPathAndFileName(subPath, fileName, mount) {
    const base = this._normalizeBaseSubPath(subPath);

    let remotePath;
    if (fileName) {
      if (!base) {
        remotePath = fileName;
      } else {
        const segments = base.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";
        remotePath = lastSegment.toLowerCase() === String(fileName).toLowerCase() ? base : `${base}/${fileName}`;
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
    return fsPath;
  }

  _parseContentRangeHeader(contentRange) {
    const raw = String(contentRange || "");
    const m = raw.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    if (!m) {
      throw new ValidationError("Content-Range 格式無效");
    }
    const start = Number.parseInt(m[1], 10);
    const end = Number.parseInt(m[2], 10);
    const total = m[3] === "*" ? null : Number.parseInt(m[3], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new ValidationError("Content-Range 數值無效");
    }
    return { start, end, total };
  }

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();

    const {
      fileName,
      fileSize,
      partSize = driver.partSizeBytes,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DriverError("TELEGRAM 分片上傳初始化失敗：缺少有效的 fileName 或 fileSize", { status: 400 });
    }
    if (!db || !mount?.storage_config_id || !mount?.id) {
      throw new DriverError("TELEGRAM 分片上傳初始化失敗：缺少 db 或 mount 資訊", { status: 500 });
    }

    // 最小分片5MB,最大100MB
    const MIN_PART_SIZE = 5 * 1024 * 1024;
    const MAX_PART_SIZE = 100 * 1024 * 1024;
    let effectivePartSize = Number.isFinite(partSize) && partSize > 0 ? Math.floor(partSize) : driver.partSizeBytes;
    // 官方 Bot API：sendDocument 上傳上限 50MB，且 getFile 只能下載 ≤20MB 的檔案，
    // 分片超過 20MB 會「能傳不能下」；自建 Bot API 才放寬到 100MB
    const maxForMode = driver.botApiMode === "self_hosted" ? MAX_PART_SIZE : 20 * 1024 * 1024;
    effectivePartSize = Math.max(MIN_PART_SIZE, Math.min(maxForMode, effectivePartSize));
    // partCount 一律依實際 partSize 重算，避免前端傳入值與 clamp 後的 partSize 不一致
    const calculatedPartCount = Math.max(1, Math.ceil(fileSize / effectivePartSize));
    void partCount;

    // upload_sessions.fs_path 必須是“完整 FS 檔案路徑”，供 /upload-chunk 反查 mount/driver
    const fsPath = this._buildFsPathFromSubPathAndFileName(subPath, fileName, mount);

    const mimeType = getEffectiveMimeType(null, fileName) || "application/octet-stream";
    const { id: uploadId } = await createUploadSessionRecord(db, {
      userIdOrInfo,
      userType: userType || null,
      storageType: driver.type,
      storageConfigId: mount.storage_config_id,
      mountId: mount.id ?? null,
      fsPath,
      source: "FS",
      fileName,
      fileSize,
      mimeType,
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
      providerUploadUrl: null,
      providerMeta: null,
      status: "initiated",
      expiresAt: null,
    });

    const sessionUploadUrl = `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`;

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
        providerUploadUrl: null,
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
      mount_id: mount?.id ?? null,
      path: fsPath,
      storage_type: driver.type,
      userType: userType || null,
      userIdOrInfo: userIdOrInfo || null,
    };
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    if (!db || !mount?.storage_config_id || !mount?.id || !uploadId || !fileName) {
      throw new DriverError("TELEGRAM 完成分片上傳失敗：缺少必要引數", {
        status: 400,
        expose: true,
        code: "DRIVER_ERROR.TELEGRAM_MULTIPART_COMPLETE_INVALID_PARAMS",
        details: {
          hasDb: !!db,
          hasMount: !!mount,
          hasMountId: !!mount?.id,
          hasStorageConfigId: !!mount?.storage_config_id,
          hasUploadId: !!uploadId,
          hasFileName: !!fileName,
        },
      });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new DriverError("TELEGRAM 完成分片上傳失敗：未找到 upload_sessions 記錄", { status: 400 });
    }
    if (sessionRow.storage_type !== driver.type) {
      throw new DriverError("TELEGRAM 完成分片上傳失敗：會話儲存型別不匹配", { status: 400 });
    }

    const partsRepo = new UploadPartsRepository(db, null);
    const partRows = await partsRepo.listParts(uploadId);
    const uploaded = partRows.filter((r) => (r?.status || "uploaded") === "uploaded");
    uploaded.sort((a, b) => Number(a.part_no) - Number(b.part_no));

    const expected = Number(sessionRow.total_parts) || 0;
    if (expected > 0) {
      const seen = new Set(uploaded.map((r) => Number(r.part_no)));
      for (let i = 1; i <= expected; i += 1) {
        if (!seen.has(i)) {
          throw new DriverError(`TELEGRAM 完成分片上傳失敗：缺少分片 ${i}/${expected}，請先續傳`, {
            status: 400,
            expose: true,
            code: "DRIVER_ERROR.TELEGRAM_MISSING_PART",
          });
        }
      }
    }

    const manifestParts = uploaded.map((r) => {
      const meta = safeJsonParse(r?.provider_meta) || {};
      return {
        partNo: Number(r.part_no),
        size: Number(r.size) || 0,
        byte_start: r.byte_start ?? null,
        byte_end: r.byte_end ?? null,
        file_id: meta.file_id || r.provider_part_id || null,
        file_unique_id: meta.file_unique_id || null,
        message_id: meta.message_id || null,
        chat_id: meta.chat_id || driver.targetChatId,
      };
    });

    const manifest = {
      kind: "telegram_manifest_v1",
      storage_type: driver.type,
      target_chat_id: driver.targetChatId,
      parts: manifestParts,
    };

    // 寫入 vfs_nodes 最終檔案節點（scope=storage_config）
    const { ownerType, ownerId } = driver._getOwnerFromOptions({ userIdOrInfo, userType });
    const { scopeType, scopeId } = driver._getScopeFromOptions({ mount, db, userIdOrInfo, userType });
    const vfsRepo = new VfsNodesRepository(db, null);

    const fsPath = this._buildFsPathFromSubPathAndFileName(subPath, fileName, mount);
    const effectiveSubPath = toPosixPath(`${stripTrailingSlash(subPath || "/")}/${fileName}`.replace(/\/+/g, "/"));
    const { dirPath } = splitDirAndName(effectiveSubPath);
    const ensured = await vfsRepo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: dirPath });

    const mimeType = getEffectiveMimeType(null, fileName) || "application/octet-stream";
    const node = await vfsRepo.createOrUpdateFileNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: ensured?.parentId ?? VFS_ROOT_PARENT_ID,
      name: fileName,
      mimeType,
      size: typeof fileSize === "number" && Number.isFinite(fileSize) ? fileSize : Number(sessionRow.file_size) || null,
      storageType: driver.type,
      contentRef: manifest,
    });

    // 標記會話完成 + 清理臨時 parts
    try {
      await updateUploadSessionStatusByFingerprint(db, {
        userIdOrInfo,
        userType,
        storageType: driver.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        fileName,
        fileSize: typeof fileSize === "number" ? fileSize : Number(sessionRow.file_size) || 0,
        status: "completed",
        bytesUploaded: typeof fileSize === "number" ? fileSize : Number(sessionRow.file_size) || null,
        uploadedParts: uploaded.length,
        nextExpectedRange: null,
        errorCode: null,
        errorMessage: null,
      });
    } catch (e) {
      console.warn("[TELEGRAM] 更新 upload_sessions 狀態失敗（可忽略）:", e?.message || e);
    }

    await partsRepo.deletePartsByUploadId(uploadId).catch(() => {});

    return {
      success: true,
      storagePath: `${VFS_STORAGE_PATH_PREFIX}${node.id}`,
      vfsNodeId: node.id,
    };
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;
    if (!db || !mount?.storage_config_id || !mount?.id || !uploadId || !fileName) {
      return { success: true };
    }

    const fsPath = this._buildFsPathFromSubPathAndFileName(subPath, fileName, mount);

    try {
      await updateUploadSessionStatusByFingerprint(db, {
        userIdOrInfo,
        userType,
        storageType: driver.type,
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
    } catch (e) {
      console.warn("[TELEGRAM] abort 更新 upload_sessions 狀態失敗（可忽略）:", e?.message || e);
    }

    const partsRepo = new UploadPartsRepository(db, null);
    await partsRepo.deletePartsByUploadId(uploadId).catch(() => {});
    return { success: true };
  }

  async listMultipartUploads(subPath = "", options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();
    const { mount, db, userIdOrInfo, userType } = options;
    if (!db || !mount?.id) {
      return { success: true, uploads: [] };
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
      storageType: driver.type,
      mountId: mount.id ?? null,
      fsPathPrefix,
      limit: 100,
    });

    // 進度展示：upload_parts 聚合統計。
    const partsRepo = new UploadPartsRepository(db, null);
    const statsMap = await partsRepo.getUploadedStatsByUploadIds((sessions || []).map((r) => r?.id).filter(Boolean));

    const uploads = sessions.map((row) => {
      const stats = row?.id ? statsMap.get(String(row.id)) : null;
      const bytesUploaded =
        stats && Number.isFinite(stats.bytesUploaded)
          ? Number(stats.bytesUploaded)
          : typeof row.bytes_uploaded === "number"
            ? Number(row.bytes_uploaded)
            : 0;

      return {
        key: (row.fs_path || "/").replace(/^\/+/, ""),
        uploadId: row.id,
        initiated: row.created_at,
        fileName: row.file_name,
        fileSize: row.file_size,
        partSize: row.part_size,
        strategy: row.strategy || "single_session",
        storageType: row.storage_type,
        sessionId: row.id,
        bytesUploaded,
        policy: {
          refreshPolicy: "server_decides",
          partsLedgerPolicy: "server_records",
          retryPolicy: { maxAttempts: 3 },
        },
      };
    });

    return { success: true, uploads };
  }

  async listMultipartParts(_subPath, uploadId, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();
    const { mount, db } = options || {};
    if (!db || !mount?.storage_config_id || !uploadId) {
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        errors: [],
        policy: {
          refreshPolicy: "server_decides",
          partsLedgerPolicy: "server_records",
          retryPolicy: { maxAttempts: 3 },
        },
      };
    }

    const partsRepo = new UploadPartsRepository(db, null);
    const rows = await partsRepo.listParts(uploadId);
    const uploaded = (rows || []).filter((r) => (r?.status || "uploaded") === "uploaded");
    const errored = (rows || []).filter((r) => (r?.status || "") === "error");

    const parts = uploaded
      .sort((a, b) => Number(a.part_no) - Number(b.part_no))
      .map((r) => ({
        partNumber: Number(r.part_no),
        size: Number(r.size) || 0,
        etag: r.provider_part_id || `tg-part-${r.part_no}`,
      }));

    const errors = errored
      .sort((a, b) => Number(a.part_no) - Number(b.part_no))
      .map((r) => ({
        partNumber: Number(r.part_no),
        size: Number(r.size) || 0,
        errorCode: r.error_code || null,
        errorMessage: r.error_message || null,
      }));

    return {
      success: true,
      uploadId: uploadId || null,
      parts,
      errors,
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    };
  }

  async signMultipartParts(_subPath, uploadId, _partNumbers, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();
    const { db } = options || {};
    void db;
    return {
      success: true,
      uploadId: String(uploadId),
      strategy: "single_session",
      session: {
        uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
        nextExpectedRanges: [],
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    };
  }

  /**
   * 被 /api/fs/multipart/upload-chunk 呼叫：
   * 把“瀏覽器分片”轉成“Telegram 分片訊息”，並寫入 upload_parts
   */
  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();

    const { db } = options || {};
    if (!db) throw new ValidationError("TELEGRAM.proxyFrontendMultipartChunk: 缺少 db");

    const contentRange = options?.contentRange || null;
    const { start, end } = this._parseContentRangeHeader(contentRange);
    const size = end - start + 1;

    const partSize = Number(sessionRow?.part_size) || driver.partSizeBytes;
    const partNo = Math.floor(start / partSize) + 1;

    const partsRepo = new UploadPartsRepository(db, null);

    // 伺服器端冪等：
    // 該分片在伺服器已“成功上傳”且 byte_range 一致，則直接跳過 Telegram sendDocument
    try {
      const existing = await partsRepo.getPart(sessionRow.id, partNo);
      const existingStatus = existing?.status || null;
      const existingProviderId = existing?.provider_part_id || null;
      const existingRangeMatches =
        existing?.byte_start === start &&
        existing?.byte_end === end;

      if (existingStatus === "uploaded" && existingProviderId && existingRangeMatches) {
        return { status: 200, done: false, skipped: true };
      }

      // 併發/快速重試時：如果上一條請求已經“佔坑上傳中”，這裡無需再發一條 TG。
      // 短時間輪詢等待（最多幾秒），等它變成 uploaded 就直接跳過。
      if (existingStatus === "uploading" && existingRangeMatches) {
        const startMs = Date.now();
        const maxWaitMs = 12_000;
        while (Date.now() - startMs < maxWaitMs) {
          try {
            await driver._sleep(300);
          } catch {
            break;
          }
          const latest = await partsRepo.getPart(sessionRow.id, partNo);
          const latestStatus = latest?.status || null;
          const latestProviderId = latest?.provider_part_id || null;
          const latestRangeMatches =
            latest?.byte_start === start &&
            latest?.byte_end === end;

          if (latestStatus === "uploaded" && latestProviderId && latestRangeMatches) {
            return { status: 200, done: false, skipped: true };
          }
          if (latestStatus === "error") {
            break;
          }
        }
      }
    } catch {
    }

    // 標記為 uploading，避免併發/重試時重複 sendDocument
    try {
      await partsRepo.upsertPart({
        uploadId: sessionRow.id,
        partNo,
        size,
        storageType: driver.type,
        providerPartId: null,
        providerMeta: {
          chat_id: driver.targetChatId,
          byte_start: start,
          byte_end: end,
        },
        byteStart: start,
        byteEnd: end,
        status: "uploading",
        errorCode: null,
        errorMessage: null,
      });
    } catch {
      // 佔坑失敗不阻斷上傳（保持魯棒）
    }

    const chunkName = `${sessionRow?.file_name || "upload.bin"}.part${partNo}`;
    const blob = await driver._toBlob(body, { contentType: "application/octet-stream", filename: chunkName });

    try {
      // 上傳這一片到 Telegram
      const sendRes = await driver._sendDocument(blob, { filename: chunkName, contentType: "application/octet-stream" });

      await partsRepo.upsertPart({
        uploadId: sessionRow.id,
        partNo,
        size: blob.size || size,
        storageType: driver.type,
        providerPartId: sendRes.fileId,
        providerMeta: {
          chat_id: driver.targetChatId,
          message_id: sendRes.messageId,
          file_id: sendRes.fileId,
          file_unique_id: sendRes.fileUniqueId || null,
          byte_start: start,
          byte_end: end,
        },
        byteStart: start,
        byteEnd: end,
        status: "uploaded",
        errorCode: null,
        errorMessage: null,
      });
    } catch (e) {
      // 失敗也要落庫
      await partsRepo.upsertPart({
        uploadId: sessionRow.id,
        partNo,
        size: blob.size || size,
        storageType: driver.type,
        providerPartId: null,
        providerMeta: {
          chat_id: driver.targetChatId,
          byte_start: start,
          byte_end: end,
        },
        byteStart: start,
        byteEnd: end,
        status: "error",
        errorCode: e?.code || null,
        errorMessage: e?.message || "分片上傳失敗",
      }).catch(() => {});
      throw e;
    }

    return { status: 200, done: false };
  }
}

export default TelegramMultipartOperations;
