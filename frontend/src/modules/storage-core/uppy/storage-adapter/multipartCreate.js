/**
 * multipart（建立/恢復會話）
 * - 負責 createMultipartUpload 這條鏈路（包含：續傳恢復、init 新會話、寫入 uploadSessions）
 */

import * as fsApi from "@/api/services/fsService.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("MultipartCreate");

/**
 * 建立分片上傳
 * @param {Object} file Uppy檔案物件
 * @returns {Promise<Object>} {uploadId, key}
 */
export async function createMultipartUpload(file) {
  try {
    log.debug(`建立分片上傳: ${file.name}`);

    // 檢查是否為ServerResume標記的可恢復上傳
    if (file.meta.resumable && file.meta.existingUpload && file.meta.serverResume) {
      const existingUpload = file.meta.existingUpload;
      log.debug(`嘗試恢復現有上傳: uploadId=${existingUpload.uploadId}, key=${existingUpload.key}`);

      const existingStrategy = existingUpload.strategy || "per_part_url";

      try {
        // 1. 先驗證uploadId有效性 - 使用完整的掛載點路徑
        const fullPathForValidation = this.buildFullPathFromKey(existingUpload.key);
        log.debug(`驗證uploadId有效性: ${fullPathForValidation}`);
        const listPartsResponse = await fsApi.listMultipartParts(
          fullPathForValidation,
          existingUpload.uploadId,
          file.name,
        );

        if (!listPartsResponse.success) {
          throw new Error(`uploadId已失效: ${listPartsResponse.message}`);
        }
        if (listPartsResponse?.data?.uploadNotFound === true) {
          throw new Error("uploadId已失效：伺服器側多部分上傳已不存在（可能已完成/已中止/被清理）");
        }

        // ===== 斷點續傳：已上傳分片來源（ledger）=====
        // - server_can_list：服務端（驅動）可直接 ListParts（S3/R2 等）
        // - client_keeps：客戶端本地儲存（HuggingFace 等：只有 presignedUrl，沒有 S3 憑證，服務端無法 ListParts）
        // - server_records：服務端維護 upload_parts（single_session/Telegram 等）
        const effectivePolicy = listPartsResponse?.data?.policy || existingUpload?.policy || null;
        const ledgerPolicyRaw =
          effectivePolicy?.partsLedgerPolicy ?? effectivePolicy?.parts_ledger_policy ?? null;
        const ledgerPolicy = String(ledgerPolicyRaw || "");

        const serverParts = Array.isArray(listPartsResponse?.data?.parts) ? listPartsResponse.data.parts : [];
        const partsLedger = this._createPartsLedger(effectivePolicy, existingUpload.key);
        try {
          await partsLedger.load?.();
        } catch {}

        const uploadedParts =
          ledgerPolicy === "client_keeps"
            ? partsLedger
                .toAwsPartsArray()
                .map((p) => ({
                  partNumber: Number(p?.PartNumber),
                  etag: p?.ETag ?? null,
                  size: Number(p?.Size ?? 0),
                }))
                .filter((p) => Number.isFinite(p.partNumber) && p.partNumber > 0)
            : serverParts;

        // server_can_list / server_records：用服務端回源結果初始化記憶體賬本（用於跳過 + complete 合併）
        if (ledgerPolicy !== "client_keeps") {
          try {
            partsLedger.replaceAll(serverParts);
          } catch {}
        }

        const uploadedCount = Array.isArray(uploadedParts) ? uploadedParts.length : 0;
        const sourceLabel = ledgerPolicy === "client_keeps" ? "本地賬本" : "伺服器";
        log.debug(`${sourceLabel}返回: 找到${uploadedCount}個已上傳分片（按驅動語義解析）`);

        // per_part_url 策略（S3 等）：保持原有的預簽名URL重新整理與本地快取邏輯
        if (existingStrategy === "per_part_url") {
          // 恢復上傳時，優先使用“原會話的 partSize”
          const fullPath = this.buildFullPathFromKey(existingUpload.key);
          log.debug(`路徑轉換: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`);

          // ===== per_part_url 恢復：按需/批次獲取分片簽名 URL =====
          // 由後端 policy 驅動。
          const basePolicy = effectivePolicy || existingUpload?.policy || null;
          const refreshPolicyRaw =
            basePolicy?.refreshPolicy ?? basePolicy?.refresh_policy ?? null;
          const refreshPolicy = String(refreshPolicyRaw || "server_decides");
          const signingModeRaw = basePolicy?.signingMode || basePolicy?.signing_mode || null;
          const signingMode = String(signingModeRaw || "on_demand");

          const maxPartsPerRequestRaw =
            basePolicy?.maxPartsPerRequest ?? basePolicy?.max_parts_per_request ?? null;
          const maxPartsPerRequestParsed = Number(maxPartsPerRequestRaw);
          const maxPartsPerRequest =
            Number.isFinite(maxPartsPerRequestParsed) && maxPartsPerRequestParsed > 0
              ? Math.floor(maxPartsPerRequestParsed)
              : 1;

          const partSizeCandidate =
            existingUpload.partSize ??
            existingUpload.part_size ??
            this.config.partSize ??
            5 * 1024 * 1024;
          const effectivePartSize = Number(partSizeCandidate) || 5 * 1024 * 1024;

          const totalPartsCandidate =
            existingUpload.totalParts ??
            existingUpload.total_parts ??
            existingUpload.partCount ??
            existingUpload.part_count ??
            null;
          const totalPartsFromServer = Number(totalPartsCandidate);
          const totalParts =
            Number.isFinite(totalPartsFromServer) && totalPartsFromServer > 0
              ? Math.floor(totalPartsFromServer)
              : Math.ceil(file.size / effectivePartSize);

          // 選擇“下一片需要上傳的 partNumber”，並按策略取一批 URL
          const uploadedPartNumbers = (uploadedParts || [])
            .map((p) => Number(p?.partNumber ?? p?.PartNumber))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);
          const uploadedSet = new Set(uploadedPartNumbers);

          let nextNeededPartNumber = 1;
          while (nextNeededPartNumber <= totalParts && uploadedSet.has(nextNeededPartNumber)) {
            nextNeededPartNumber += 1;
          }

          const hasMoreParts = nextNeededPartNumber <= totalParts;
          let partNumbersToSign = [];

          if (hasMoreParts) {
            if (refreshPolicy === "server_decides") {
              // partNumbers=[] 表示“由後端決定返回哪些 URL”
              partNumbersToSign = [];
            } else {
              // client_part_numbers：由前端提供明確 partNumbers（可按 signingMode 做批次）
              if (signingMode === "batched" && maxPartsPerRequest > 1) {
                const endPn = Math.min(
                  nextNeededPartNumber + maxPartsPerRequest - 1,
                  totalParts,
                );
                partNumbersToSign = Array.from(
                  { length: endPn - nextNeededPartNumber + 1 },
                  (_, i) => nextNeededPartNumber + i,
                );
              } else {
                partNumbersToSign = [nextNeededPartNumber];
              }
            }
          }

          let signResponse = { success: true, data: { presignedUrls: [], policy: basePolicy } };
          if (hasMoreParts) {
            signResponse = await fsApi.signMultipartParts(
              fullPath,
              existingUpload.uploadId,
              partNumbersToSign,
            );
            if (!signResponse.success) {
              throw new Error(signResponse.message || "獲取分片簽名失敗");
            }
          }

          const refreshResponse = signResponse;

          const resetUploadedParts = refreshResponse?.data?.resetUploadedParts === true;
          if (resetUploadedParts) {
            try {
              partsLedger.clearInMemory?.();
              partsLedger.clearPersistent?.();
            } catch {}
          }
          // 如果後端提示“會話重置”，說明之前伺服器返回的 uploadedParts 已經不可信（通常是舊 provider uploadId 的記錄）
          // 這時必須把已上傳分片當作 0，避免跳過導致 complete 失敗。
          const effectiveUploadedParts = resetUploadedParts ? [] : uploadedParts;

          const standardParts = effectiveUploadedParts.map((part) => ({
            PartNumber: part.partNumber,
            Size: part.size,
            ETag: part.etag,
          }));

          const uploadedBytes = effectiveUploadedParts.reduce((sum, part) => sum + part.size, 0);
          const progressPercent = Math.round((uploadedBytes / file.size) * 100);

          if (standardParts.length > 0) {
            const partNums = standardParts
              .map((p) => p.PartNumber)
              .sort((a, b) => a - b);
            log.debug(`伺服器已上傳分片: [${partNums.join(", ")}] (${progressPercent}%)`);
          }

          this.uploadSessions.set(file.id, {
            strategy: "per_part_url",
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
            presignedUrls: refreshResponse?.data?.presignedUrls || [],
            policy: refreshResponse?.data?.policy || basePolicy || null,
            partsLedger,
            path: this.currentPath,
            fileName: file.name,
            fileSize: file.size,
            partSize: effectivePartSize,
            totalParts,
            resumed: true, // 標記為恢復的上傳
          });

          log.debug("per_part_url 模式斷點續傳恢復成功");
          return {
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
          };
        }

        // single_session 策略（OneDrive 等）：使用單一 uploadUrl + Content-Range
        if (existingStrategy === "single_session") {
          const fullPath = this.buildFullPathFromKey(existingUpload.key);
          log.debug(`single_session 恢復: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`);

          // 對於 single_session，後端的 signMultipartParts 返回最新的會話資訊
          const refreshResponse = await fsApi.signMultipartParts(
            fullPath,
            existingUpload.uploadId,
            [1], // 對於 single_session，partNumbers 僅為引數校驗佔位
          );

          if (!refreshResponse.success) {
            throw new Error(refreshResponse.message || "重新整理會話資訊失敗");
          }

          const data = refreshResponse.data || {};
          const session = data.session || {};
          const uploadUrl = session.uploadUrl || existingUpload.uploadId;
          const nextExpectedRanges = session.nextExpectedRanges || [];

          let resumeOffset = 0;
          if (Array.isArray(nextExpectedRanges) && nextExpectedRanges.length > 0) {
            const firstRange = String(nextExpectedRanges[0]);
            const startStr = firstRange.split("-")[0];
            const parsed = Number.parseInt(startStr, 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
              resumeOffset = parsed;
            }
          }

          const effectivePartSize =
            existingUpload.partSize || this.config.partSize || 5 * 1024 * 1024;

          // 結合伺服器返回的已上傳分片列表，推導已完成的分片數量
          // 從1開始連續編號，如果出現空洞則只取最大連續分片號
          let completedParts = 0;
          if (Array.isArray(uploadedParts) && uploadedParts.length > 0) {
            const partNumbers = uploadedParts
              .map((p) => p.partNumber ?? p.PartNumber)
              .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
              .sort((a, b) => a - b);

            let expected = 1;
            for (const n of partNumbers) {
              if (n === expected) {
                completedParts = n;
                expected += 1;
              } else {
                break;
              }
            }
          }

          this.uploadSessions.set(file.id, {
            strategy: "single_session",
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
            session: {
              uploadUrl,
              nextExpectedRanges,
            },
            path: this.currentPath,
            fileName: file.name,
            fileSize: file.size,
            partSize: effectivePartSize,
            resumed: true,
            resumeOffset,
            completedParts,
          });

          log.debug(`single_session 模式斷點續傳恢復成功，resumeOffset=${resumeOffset}，completedParts=${completedParts}`);

          return {
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
          };
        }

        log.warn(
          `[StorageAdapter] 未知的 existingUpload.strategy=${existingStrategy}，將回退為全新上傳`,
        );
      } catch (error) {
        log.warn(`[StorageAdapter] 斷點續傳失敗，建立新上傳: ${error.message}`);

        // 清除失效的上傳標記
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, {
            resumable: false,
            existingUpload: null,
            serverResume: false,
          });
        }

        // 繼續建立新的上傳（不要遞迴呼叫，直接繼續執行下面的程式碼）
      }
    }

    // 建立新的分片上傳（統一走 FS /fs/multipart/init，依據 strategy 分流）
    const partSize = this.config.partSize || 5 * 1024 * 1024; // 5MB
    const meta = file?.meta || {};
    // 如果預初始化已經拿到 init 結果，這裡直接複用，避免重複請求
    const preinit = meta?.cloudharborMultipartInit && typeof meta.cloudharborMultipartInit === "object" ? meta.cloudharborMultipartInit : null;
    const sha256 =
      typeof meta?.cloudharborSha256 === "string" && meta.cloudharborSha256
        ? meta.cloudharborSha256
        : typeof meta?.sha256 === "string" && meta.sha256
          ? meta.sha256
          : null;

    const response = preinit
      ? { success: true, data: preinit }
      : await fsApi.initMultipartUpload(
          this.currentPath,
          file.name,
          file.size,
          file.type,
          partSize,
          { sha256 },
        );

    if (!response?.success) {
      throw new Error(response?.message || "初始化分片上傳失敗");
    }

    const init = response?.data || {};
    const strategy = init.strategy || "per_part_url";
    const uploadId = init.uploadId;
    const initPartSize = Number(init.partSize || init.part_size || 0);
    // 統一：key 存“無前導 /”的 storageKey 格式（用於快取與續傳標識）
    const key = String(
      init?.key || `${this.currentPath}/${file.name}`.replace(/\/+/g, "/").replace(/^\/+/, ""),
    ).replace(/^\/+/, "");

    if (!uploadId) {
      throw new Error("初始化分片上傳失敗：缺少 uploadId");
    }

    // 確保 AwsS3.getChunkSize 能讀到後端返回的 partSize
    if (this.uppyInstance && Number.isFinite(initPartSize) && initPartSize > 0) {
      try {
        this.uppyInstance.setFileMeta(file.id, { [this._multipartChunkSizeKey]: Math.floor(initPartSize) });
      } catch {}
    }

    if (strategy === "per_part_url") {
      // S3 等 per-part 預簽名 URL 策略
      const presignedUrls = Array.isArray(init.presignedUrls) ? init.presignedUrls : [];
      const policy = init.policy || null;
      const signingModeRaw = policy?.signingMode || policy?.signing_mode || null;
      const signingMode = String(signingModeRaw || "eager");
      const partsLedger = this._createPartsLedger(policy, key);
      try {
        await partsLedger.load?.();
      } catch {}

      // 需要某個分片 URL 時，由 signPart 觸發 /fs/multipart/sign-parts 批次獲取
      if (presignedUrls.length === 0 && signingMode === "eager") {
        throw new Error("初始化分片上傳失敗：per_part_url 策略缺少 presignedUrls");
      }

      this.uploadSessions.set(file.id, {
        strategy,
        uploadId,
        key,
        presignedUrls,
        policy,
        partsLedger,
        path: this.currentPath,
        fileName: file.name,
        fileSize: file.size,
        partSize: init.partSize || partSize,
        totalParts: init.totalParts || init.partCount || null,
        skipUpload: init.skipUpload === true,
        resumed: false,
      });

      // 統一寫入：用於 UI 在上傳完成後統計“跳過上傳（秒傳/去重）”數量
      try {
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, { cloudharborSkipUpload: init.skipUpload === true });
        }
      } catch {}

      try {
        partsLedger.clearInMemory?.();
        partsLedger.clearPersistent?.();
      } catch {}
      log.debug(`新上傳初始化完成，已重置分片賬本: ${key}`);

      return {
        uploadId,
        key,
      };
    }

    if (strategy === "single_session") {
      // OneDrive 等使用單一 uploadUrl + Content-Range 的策略
      const session = init.session || {};
      if (!session.uploadUrl) {
        throw new Error("初始化分片上傳失敗：single_session 策略缺少 session.uploadUrl");
      }

      this.uploadSessions.set(file.id, {
        strategy,
        uploadId,
        key,
        session,
        path: this.currentPath,
        fileName: file.name,
        fileSize: file.size,
        partSize: init.partSize || partSize,
        resumed: false,
        resumeOffset: 0,
      });

      log.debug("新的 single_session 分片上傳會話已建立（OneDrive/Graph 模式）");

      return {
        uploadId,
        key,
      };
    }

    throw new Error(`不支援的分片上傳策略: ${String(strategy)}`);
  } catch (error) {
    log.error("[StorageAdapter] 建立分片上傳失敗:", error);
    throw error;
  }
}
