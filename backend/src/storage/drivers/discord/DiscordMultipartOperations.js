/**
 * DiscordMultipartOperations
 *
 * Discord 沒有“分片合併 API”，只能把“每個分片”當成“一條訊息的一個附件”；
 * 每片 PUT 到 CloudHarbor 的 /api/fs/multipart/upload-chunk；
 * 後端收到每片後，轉成 Discord Create Message（帶附件），並把進度寫入 upload_parts；
 * complete 時，把 upload_parts 聚合成 manifest，寫入 vfs_nodes.content_ref。
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
import { safeJsonParse, splitDirAndName, toPosixPath, stripTrailingSlash } from "./DiscordOperations.js";

const VFS_STORAGE_PATH_PREFIX = "vfs:";

export class DiscordMultipartOperations {
  /**
   * @param {import("./DiscordStorageDriver.js").DiscordStorageDriver} driver
   */
  constructor(driver) {
    this.driver = driver;
  }

  _normalizeBaseSubPath(subPath) {
    return typeof subPath === "string"
      ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
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
      throw new DriverError("DISCORD 分片上傳初始化失敗：缺少有效的 fileName 或 fileSize", { status: 400 });
    }
    if (!db || !mount?.storage_config_id || !mount?.id) {
      throw new DriverError("DISCORD 分片上傳初始化失敗：缺少 db 或 mount 資訊", { status: 500 });
    }

    // Discord 每條訊息附件的上限通常是 10MiB（不同伺服器可能更高，但我們先按保守策略）
    // 這裡的 partSize 必須 <= driver.directUploadMaxBytes，否則某一片也會上傳失敗。
    const MIN_PART_SIZE = 1 * 1024 * 1024;
    const MAX_PART_SIZE = Number.isFinite(driver.directUploadMaxBytes) && driver.directUploadMaxBytes > 0 ? driver.directUploadMaxBytes : 10 * 1024 * 1024;

    let effectivePartSize = Number.isFinite(partSize) && partSize > 0 ? Math.floor(partSize) : driver.partSizeBytes;
    effectivePartSize = Math.max(MIN_PART_SIZE, Math.min(MAX_PART_SIZE, effectivePartSize));

    const calculatedPartCount = partCount || Math.max(1, Math.ceil(fileSize / effectivePartSize));

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
      providerMeta: { channel_id: driver.channelId },
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
      throw new DriverError("DISCORD 完成分片上傳失敗：缺少必要引數", {
        status: 400,
        expose: true,
        code: "DRIVER_ERROR.DISCORD_MULTIPART_COMPLETE_INVALID_PARAMS",
      });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new DriverError("DISCORD 完成分片上傳失敗：未找到 upload_sessions 記錄", { status: 400 });
    }
    if (sessionRow.storage_type !== driver.type) {
      throw new DriverError("DISCORD 完成分片上傳失敗：會話儲存型別不匹配", { status: 400 });
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
          throw new DriverError(`DISCORD 完成分片上傳失敗：缺少分片 ${i}/${expected}，請先續傳`, {
            status: 400,
            expose: true,
            code: "DRIVER_ERROR.DISCORD_MISSING_PART",
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
        channel_id: meta.channel_id || driver.channelId,
        message_id: meta.message_id || r.provider_part_id || null,
        attachment_id: meta.attachment_id || null,
        url: meta.url || null,
        filename: meta.filename || null,
        content_type: meta.content_type || null,
      };
    });

    const manifest = {
      kind: "discord_chunks_v1",
      storage_type: driver.type,
      channel_id: driver.channelId,
      file_name: fileName,
      file_size: typeof fileSize === "number" && Number.isFinite(fileSize) ? fileSize : Number(sessionRow.file_size) || null,
      part_size: Number(sessionRow.part_size) || driver.partSizeBytes,
      total_parts: Number(sessionRow.total_parts) || manifestParts.length,
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
      console.warn("[DISCORD] 更新 upload_sessions 狀態失敗（可忽略）:", e?.message || e);
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
      console.warn("[DISCORD] abort 更新 upload_sessions 狀態失敗（可忽略）:", e?.message || e);
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

    // 進度展示：upload_parts 聚合統計
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
        etag: r.provider_part_id || `discord-part-${r.part_no}`,
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
   * 把“瀏覽器分片”轉成“Discord 訊息附件”，並寫入 upload_parts
   */
  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    const driver = this.driver;
    driver._ensureInitialized();

    const { db } = options || {};
    if (!db) throw new ValidationError("DISCORD.proxyFrontendMultipartChunk: 缺少 db");

    const contentRange = options?.contentRange || null;
    const { start, end } = this._parseContentRangeHeader(contentRange);
    const size = end - start + 1;

    const partSize = Number(sessionRow?.part_size) || driver.partSizeBytes;
    const partNo = Math.floor(start / partSize) + 1;

    const partsRepo = new UploadPartsRepository(db, null);

    // 伺服器端冪等：
    // 該分片在伺服器已“成功上傳”且 byte_range 一致，則直接跳過 Discord Create Message
    try {
      const existing = await partsRepo.getPart(sessionRow.id, partNo);
      const existingStatus = existing?.status || null;
      const existingProviderId = existing?.provider_part_id || null;
      const existingRangeMatches = existing?.byte_start === start && existing?.byte_end === end;

      if (existingStatus === "uploaded" && existingProviderId && existingRangeMatches) {
        return { status: 200, done: false, skipped: true };
      }

      // 併發/快速重試時：如果上一條請求已經“佔坑上傳中”，這裡無需再發一條 Discord。
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
          const latestRangeMatches = latest?.byte_start === start && latest?.byte_end === end;

          if (latestStatus === "uploaded" && latestProviderId && latestRangeMatches) {
            return { status: 200, done: false, skipped: true };
          }
          if (latestStatus === "error") {
            break;
          }
        }
      }
    } catch {
      // ignore
    }

    // 標記為 uploading，避免併發/重試時重複發訊息
    try {
      await partsRepo.upsertPart({
        uploadId: sessionRow.id,
        partNo,
        size,
        storageType: driver.type,
        providerPartId: null,
        providerMeta: {
          channel_id: driver.channelId,
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

    // 防呆：單片不能超過 Discord 的單條附件上限
    if (
      Number.isFinite(driver.directUploadMaxBytes) &&
      driver.directUploadMaxBytes > 0 &&
      Number.isFinite(blob.size) &&
      blob.size > driver.directUploadMaxBytes
    ) {
      const err = new DriverError(
        `DISCORD 分片過大：單片必須 ≤${Math.floor(driver.directUploadMaxBytes / (1024 * 1024))}MB，請調小 part_size_mb`,
        { status: 400, expose: true, code: "DRIVER_ERROR.DISCORD_MULTIPART_PART_TOO_LARGE" },
      );
      await partsRepo
        .upsertPart({
          uploadId: sessionRow.id,
          partNo,
          size: blob.size || size,
          storageType: driver.type,
          providerPartId: null,
          providerMeta: { channel_id: driver.channelId, byte_start: start, byte_end: end },
          byteStart: start,
          byteEnd: end,
          status: "error",
          errorCode: err?.code || null,
          errorMessage: err?.message || "分片過大",
        })
        .catch(() => {});
      throw err;
    }

    try {
      // 上傳這一片到 Discord
      const sendRes = await driver._createMessageWithAttachment(blob, { filename: chunkName, contentType: "application/octet-stream" });

      await partsRepo.upsertPart({
        uploadId: sessionRow.id,
        partNo,
        size: typeof sendRes.size === "number" ? sendRes.size : blob.size || size,
        storageType: driver.type,
        providerPartId: sendRes.messageId,
        providerMeta: {
          channel_id: driver.channelId,
          message_id: sendRes.messageId,
          attachment_id: sendRes.attachmentId,
          url: sendRes.url || null,
          filename: sendRes.filename || chunkName,
          content_type: sendRes.contentType || "application/octet-stream",
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
      await partsRepo
        .upsertPart({
          uploadId: sessionRow.id,
          partNo,
          size: blob.size || size,
          storageType: driver.type,
          providerPartId: null,
          providerMeta: {
            channel_id: driver.channelId,
            byte_start: start,
            byte_end: end,
          },
          byteStart: start,
          byteEnd: end,
          status: "error",
          errorCode: e?.code || null,
          errorMessage: e?.message || "分片上傳失敗",
        })
        .catch(() => {});
      throw e;
    }

    return { status: 200, done: false };
  }
}

export default DiscordMultipartOperations;
