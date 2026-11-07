/**
 * multipart（簽名 + 傳輸）
 * - signPart：為某個分片獲取/重新整理預簽名 URL（含併發去重）
 * - uploadPartBytes：真正 PUT 分片（含跳過、暫停/恢復、過期重籤重試）
 *
 */

import * as fsApi from "@/api/services/fsService.js";
import { resolveAbsoluteApiUrl } from "./tools.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("MultipartTransfer");

/**
 * 簽名分片
 * @param {Object} file Uppy檔案物件
 * @param {Object} partData 分片資料 {uploadId, key, partNumber, body}
 * @returns {Promise<Object>} {url, headers}
 */
export async function signPart(file, partData) {
  try {
    const session = this.uploadSessions.get(file.id);
    if (!session) {
      throw new Error("找不到上傳會話資訊");
    }

    log.debug(`signPart被呼叫: 分片${partData.partNumber}`);

    // 不在signPart中處理已上傳分片，斷點續傳由 listParts + uploadPartBytes 內部處理

    if (session.strategy === "single_session") {
      // OneDrive/Graph uploadSession: 所有分片共用一個 uploadUrl，透過 Content-Range 標記區間
      // 這裡不使用 resumeOffset，而是始終按全域性 partNumber 計算 Range:
      // start = (partNumber - 1) * partSize
      // 已上傳的分片透過 listParts 返回的 PartNumber 列表由 HTTPCommunicationQueue 跳過。
      const totalSize = session.fileSize || file.size;
      const partSize = session.partSize || this.config.partSize || 5 * 1024 * 1024;

      const partNumber = partData.partNumber;
      if (typeof partNumber !== "number" || !Number.isFinite(partNumber) || partNumber <= 0) {
        throw new Error(`無效的單會話分片編號: ${partNumber}`);
      }

      const body = partData.body;
      const currentSize =
        (body && (body.size ?? body.byteLength)) != null
          ? body.size ?? body.byteLength
          : null;
      if (currentSize == null || !Number.isFinite(currentSize) || currentSize <= 0) {
        throw new Error("無法確定當前分片大小，用於計算 Content-Range");
      }

      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + currentSize, totalSize) - 1;

      if (start >= totalSize) {
        throw new Error(
          `分片區間超出檔案大小: start=${start}, totalSize=${totalSize}, partNumber=${partNumber}`,
        );
      }

      const urlRaw = session.session?.uploadUrl || session.uploadId;
      const url = resolveAbsoluteApiUrl(urlRaw);
      if (!url) {
        throw new Error("single_session 會話缺少有效的 uploadUrl");
      }

      // 對於 single_session（OneDrive / GoogleDrive 後端中轉），需要帶上認證頭，
      const authHeaders = this.authProvider.getAuthHeaders() || {};

      return {
        url,
        headers: {
          ...authHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        },
        strategy: "single_session",
        partNumber,
        fileId: file.id,
        key: session.key || null,
      };
    }

    // 預設 per_part_url 策略（S3 等）：從快取的預簽名URL列表中找到對應分片
    // LFS 去重/秒傳：物件已存在（skipUpload=true），不需要真實的 per-part URL。
    if (session?.skipUpload === true) {
      return {
        url: resolveAbsoluteApiUrl("/__uppy_skip_upload__"),
        headers: {
          "Content-Type": "application/octet-stream",
          "x-cloudharbor-skip-upload": "1",
        },
        strategy: "per_part_url",
        partNumber: partData.partNumber,
        fileId: file.id,
        key: session.key || null,
        skipUpload: true,
      };
    }

    const urls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
    let urlInfo = urls.find((url) => url.partNumber === partData.partNumber);

    if (!urlInfo && session.uploadId && session.key) {
      // 如果本地沒有該分片的 URL，向後端請求籤名（批次/按需）
      // - S3：批次拿一段 URL，避免每片都請求一次
      // - HF：可以按需取回指定 partNumber 的 URL
      try {
        const fullPath = this.buildFullPathFromKey(session.key);
        const policy = session?.policy || {};
        const signingModeRaw = policy?.signingMode || policy?.signing_mode || null;
        const signingMode = String(signingModeRaw || "on_demand");

        const maxPartsPerRequestRaw =
          policy?.maxPartsPerRequest ?? policy?.max_parts_per_request ?? null;
        const maxPartsPerRequestParsed = Number(maxPartsPerRequestRaw);
        const maxPartsPerRequest =
          Number.isFinite(maxPartsPerRequestParsed) && maxPartsPerRequestParsed > 0
            ? Math.floor(maxPartsPerRequestParsed)
            : 1;

        let partNumbersToSign = [partData.partNumber];

        if (signingMode === "batched" && maxPartsPerRequest > 1) {
          const totalPartsCandidate =
            session?.totalParts ?? session?.total_parts ?? null;
          const totalPartsFromSession = Number(totalPartsCandidate);
          const partSizeCandidate =
            session?.partSize ?? session?.part_size ?? this.config.partSize ?? 5 * 1024 * 1024;
          const effectivePartSize = Number(partSizeCandidate) || 5 * 1024 * 1024;
          const totalParts =
            Number.isFinite(totalPartsFromSession) && totalPartsFromSession > 0
              ? Math.floor(totalPartsFromSession)
              : Math.ceil(file.size / effectivePartSize);

          const startPn = Number(partData.partNumber);
          const endPn = Math.min(startPn + maxPartsPerRequest - 1, totalParts);
          partNumbersToSign = Array.from({ length: endPn - startPn + 1 }, (_, i) => startPn + i);
        }

        // 同一個 uploadId 在同一時刻只允許 1 個 sign-parts 請求，其它 signPart 等它完成後再複用結果。
        if (session._cloudharborSignPartsInFlight) {
          try {
            await session._cloudharborSignPartsInFlight;
          } catch {}
          const latestUrls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
          urlInfo = latestUrls.find((url) => url.partNumber === partData.partNumber);
        }

        // 如果等待後仍然沒有 URL，才真正發起簽名請求
        if (!urlInfo) {
          const p = fsApi.signMultipartParts(fullPath, session.uploadId, partNumbersToSign);
          session._cloudharborSignPartsInFlight = p;

          let signResponse;
          try {
            signResponse = await p;
          } finally {
            // 只清理自己設定的那個 Promise（避免併發覆蓋）
            if (session._cloudharborSignPartsInFlight === p) {
              session._cloudharborSignPartsInFlight = null;
            }
          }

          // 後端可能會返回新的 policy（例如 maxPartsPerRequest/urlTtlSeconds），合併到 session 裡
          if (signResponse?.success && signResponse?.data?.policy) {
            session.policy = signResponse.data.policy;
          }

          const refreshedUrls = signResponse?.success ? (signResponse?.data?.presignedUrls || []) : [];
          if (Array.isArray(refreshedUrls) && refreshedUrls.length > 0) {
            const latestUrls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
            const merged = [...latestUrls];
            for (const u of refreshedUrls) {
              const pn = Number(u?.partNumber);
              const existingIndex = merged.findIndex((x) => Number(x?.partNumber) === pn);
              if (existingIndex >= 0) merged[existingIndex] = u;
              else merged.push(u);
            }
            merged.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
            session.presignedUrls = merged;
            urlInfo = merged.find((url) => url.partNumber === partData.partNumber);
          }
        }
      } catch (e) {
        log.warn("[StorageAdapter] signPart 請求籤名URL失敗（可忽略）:", e?.message || e);
      }
    }

    if (!urlInfo) {
      const available = (Array.isArray(session.presignedUrls) ? session.presignedUrls : [])
        .map((u) => Number(u?.partNumber))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const hint =
        available.length > 0
          ? `當前會話僅有分片: [${available.join(", ")}]。很可能是“Uppy 切片大小”和“後端返回 partSize”不一致。`
          : "當前會話沒有任何 presignedUrls。";
      throw new Error(`找不到分片 ${partData.partNumber} 的預簽名URL。${hint}`);
    }

    return {
      url: resolveAbsoluteApiUrl(urlInfo.url),
      headers: {
        "Content-Type": "application/octet-stream",
        ...(session?.skipUpload === true ? { "x-cloudharbor-skip-upload": "1" } : {}),
      },
      strategy: "per_part_url",
      partNumber: partData.partNumber,
      fileId: file.id,
      uploadId: session.uploadId,
      key: session.key || null,
    };
  } catch (error) {
    log.error("[StorageAdapter] 簽名分片失敗:", error);
    throw error;
  }
}

/**
 * 上傳分片位元組
 * 控制實際的分片上傳過程，在這裡處理已上傳分片的跳過邏輯
 * @param {Object} options {signature, body, onComplete, size, onProgress, signal}
 * @returns {Promise<Object>} {ETag}
 */
export async function uploadPartBytes({ signature, body, onComplete, size, onProgress, signal }) {
  try {
    const { url, headers } = signature;

    // 統一跳過邏輯（用於“物件已存在/秒傳”或某些驅動明確要求跳過網路直傳）
    const sigHeaders = headers || {};
    const shouldSkip =
      signature?.skipUpload === true ||
      sigHeaders?.["x-cloudharbor-skip-upload"] === "1" ||
      sigHeaders?.["X-CloudHarbor-Skip-Upload"] === "1";

    if (shouldSkip) {
      log.debug("skipUpload=true，跳過分片 PUT，直接進入 complete 階段");
      // 單檔案預簽名：把“本次上傳沒有 ETag”記回會話，供 commit 階段兜底使用
      try {
        const fileId = signature && typeof signature.fileId === "string" ? signature.fileId : null;
        if (fileId) {
          const session = this.uploadSessions.get(fileId);
          if (session) session.etag = null;
        }
      } catch {}
      try {
        onProgress?.({ loaded: size, total: size, lengthComputable: true });
      } catch {}
      try {
        onComplete?.(null);
      } catch {}
      return { ETag: null };
    }

    if (!url) {
      throw new Error("Cannot upload to an undefined URL");
    }

    log.debug(`uploadPartBytes被呼叫: ${url}`);

    const isSingleSession = signature && signature.strategy === "single_session";
    const signatureKey =
      signature && typeof signature.key === "string" && signature.key ? String(signature.key) : null;
    const storageKey = signatureKey ? signatureKey.replace(/^\/+/, "") : null;

    // 初始從簽名中獲取分片編號和檔案ID
    let partNumber = signature && typeof signature.partNumber === "number"
      ? signature.partNumber
      : null;
    let fileId = signature && typeof signature.fileId === "string" ? signature.fileId : null;

    // 僅做 partNumber 的兜底解析（某些實現可能沒把 partNumber 放進 signature）
    if (partNumber == null) {
      try {
        const urlObject = new URL(url);
        const partNumberRaw = urlObject.searchParams.get("partNumber");
        partNumber =
          partNumberRaw != null && partNumberRaw !== ""
            ? parseInt(partNumberRaw, 10)
            : null;
      } catch {
        // ignore
      }
    }

    if (partNumber != null) {
      log.debug(`處理分片${partNumber}上傳...`);
    }

    // 兜底：如果 signature 沒帶 fileId，就嘗試從 url 反查
    if (!fileId) {
      fileId = this.getFileIdFromUrl(url);
    }

    // per_part_url 的“跳過已上傳分片”統一走 PartsLedger
    const sessionForPolicy = fileId ? this.uploadSessions.get(fileId) : null;
    let partsLedger = sessionForPolicy?.partsLedger || null;
    if (!isSingleSession && storageKey) {
      if (!partsLedger) {
        partsLedger = this._createPartsLedger(sessionForPolicy?.policy || null, storageKey);
        try {
          await partsLedger.load?.();
        } catch {}
        if (sessionForPolicy) sessionForPolicy.partsLedger = partsLedger;
      }

      if (partNumber != null && partsLedger?.hasPart?.(partNumber)) {
        const existingPart = partsLedger.getPart(partNumber);
        if (existingPart?.ETag) {
          log.debug(`分片${partNumber}已存在（賬本命中），跳過上傳 (ETag: ${existingPart.ETag})`);

          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                onProgress(size);
              } catch {}
              try {
                onComplete(existingPart.ETag);
              } catch {}
              resolve({ ETag: existingPart.ETag });
            }, 0);
          });
        }
      }
    }

    // 針對 single_session（OneDrive 等）執行基於會話狀態的跳過邏輯
    if (isSingleSession) {
      const session = fileId ? this.uploadSessions.get(fileId) : null;
      if (
        session &&
        typeof session.completedParts === "number" &&
        session.completedParts > 0 &&
        partNumber != null &&
        partNumber <= session.completedParts
      ) {
        log.debug(`single_session 分片${partNumber}已完成，跳過上傳（邏輯跳過，不發HTTP請求）`);

        // 模擬一個瞬間完成的上傳過程，保持與實際上傳一致的回撥行為
        return new Promise((resolve) => {
          setTimeout(() => {
            try {
              onProgress(size);
            } catch {}
            const etag = `onedrive-part-${partNumber}`;
            try {
              onComplete(etag);
            } catch {}
            resolve({ ETag: etag });
          }, 0);
        });
      }
    }

    // 針對 per_part_url（S3 等）執行“暫停/恢復”邏輯；single_session 模式不會進入該分支
    if (!isSingleSession && storageKey && partNumber != null) {
      // 檢查檔案是否被自定義暫停（同樣僅在 per_part_url 模式下有效）
      const pauseFileId = fileId || this.getFileIdFromUrl(url);
      if (pauseFileId && this.isFilePaused(pauseFileId)) {
        log.debug(`分片${partNumber}被暫停，等待恢復...`);

        // 返回一個等待恢復的Promise
        return new Promise((resolve, reject) => {
          let resumeTimer = null;
          const checkResume = () => {
            if (!this.isFilePaused(pauseFileId)) {
              if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
              }
              log.debug(`分片${partNumber}恢復上傳`);
              this.uploadPartBytes({
                signature,
                body,
                onComplete,
                size,
                onProgress,
                signal,
              })
                .then(resolve)
                .catch(reject);
              return;
            }
            resumeTimer = setTimeout(checkResume, 100);
          };
          resumeTimer = setTimeout(checkResume, 100);

          if (signal) {
            signal.addEventListener("abort", () => {
              if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
              }
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
        });
      }
    }

    const uploadOnce = (uploadUrl) =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);

        if (headers) {
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
        }

        xhr.responseType = "text";

        // 處理取消訊號
        function onabort() {
          xhr.abort();
        }
        function cleanup() {
          if (signal) {
            signal.removeEventListener("abort", onabort);
          }
        }
        if (signal) {
          signal.addEventListener("abort", onabort);
        }

        xhr.onabort = () => {
          cleanup();
          const err = new DOMException("The operation was aborted", "AbortError");
          reject(err);
        };

        const progressHandler = (evt) => {
          try {
            const loaded = evt?.loaded ?? 0;
            const total = evt?.total ?? size;
            onProgress?.({ loaded, total, lengthComputable: true });
          } catch {}
        };
        xhr.upload.addEventListener("progress", progressHandler);

        xhr.addEventListener("load", (ev) => {
          cleanup();
          const target = ev.target;

          if (target.status < 200 || target.status >= 300) {
            try {
              log.error("[StorageAdapter] uploadPartBytes HTTP error", {
                status: target.status,
                statusText: target.statusText,
                responseText: target.responseText,
              });
            } catch {}

            const error = new Error(`HTTP ${target.status}: ${target.statusText}`);
            error.source = target;
            reject(error);
            return;
          }

          try { onProgress?.({ loaded: size, total: size, lengthComputable: true }); } catch {}

          // 獲取 ETag
          let etag = target.getResponseHeader("ETag");

          // 對於 single_session 策略（OneDrive 等），伺服器不會返回 ETag 頭部，
          // 這裡只需要為 Uppy 提供一個佔位值即可，後端不會依賴該 ETag 完成合並。
          if (etag === null && isSingleSession) {
            etag = `onedrive-part-${Date.now()}`;
          }

          if (etag === null) {
            reject(
              new Error(
                "Could not read the ETag header. This likely means CORS is not configured correctly.",
              ),
            );
            return;
          }

          // 單檔案預簽名：把 ETag 寫回 uploadSessions，commit 階段優先取這裡
          if (partNumber == null && fileId) {
            try {
              const session = this.uploadSessions.get(fileId);
              if (session) session.etag = etag;
            } catch {}
          }

          // 將成功上傳的分片寫入 PartsLedger（用於：跳過重複 PUT、complete 時提交完整 parts）
          // - client_keeps：會落盤到 localStorage（帶 debounce）
          // - server_can_list：只寫記憶體（避免 S3 雙真相源）
          if (!isSingleSession && storageKey && partNumber != null) {
            try {
              partsLedger?.recordPart?.({
                ETag: etag,
                PartNumber: partNumber,
                Size: size,
              });
            } catch {}

            log.debug(`分片${partNumber}上傳成功，已寫入分片賬本 (ETag: ${etag})`);
          }

          try { onComplete(etag); } catch {}
          resolve({ ETag: etag });
        });

        xhr.addEventListener("error", (ev) => {
          cleanup();
          const error = new Error("Upload failed");
          error.source = ev.target;
          reject(error);
        });

        xhr.send(body);
      });

    // 失敗策略預設無感重試
    // - 對 per_part_url：遇到“簽名過期/403”時，嘗試重新簽名當前分片並重傳
    // - 超過最大重試次數仍失敗，則丟擲錯誤交給 Uppy/UI
    const retryMaxAttemptsCandidate =
      sessionForPolicy?.policy?.retryPolicy?.maxAttempts ??
      sessionForPolicy?.policy?.retry_policy?.maxAttempts ??
      null;
    const retryMaxAttemptsParsed = Number(retryMaxAttemptsCandidate);
    const maxAttempts =
      Number.isFinite(retryMaxAttemptsParsed) && retryMaxAttemptsParsed > 0
        ? Math.floor(retryMaxAttemptsParsed)
        : Number(this.config.maxRetries) || 3;

    let lastError = null;
    let currentUrl = url;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) {
          log.warn(
            `[StorageAdapter] ⚠️ 分片${partNumber ?? "?"}重試上傳 attempt=${attempt}/${maxAttempts}`,
          );
        }
        return await uploadOnce(currentUrl);
      } catch (err) {
        lastError = err;

        // AbortError 直接退出，不重試
        if (err?.name === "AbortError") {
          throw err;
        }

        const status = err?.source?.status ?? null;
        const responseText = String(err?.source?.responseText || "");

        // single_session（OneDrive/GoogleDrive/Telegram）：
        if (
          isSingleSession &&
          status === 404 &&
          /upload session was not found|itemNotFound/i.test(responseText)
        ) {
          throw new Error("上傳會話已過期（OneDrive 上游返回 404），請重新開始上傳");
        }

        const mayBeExpiredSignature =
          !isSingleSession &&
          (status === 401 ||
            status === 403 ||
            (status === 400 && /expired|signature|token|Request has expired/i.test(responseText)));

        // 只有“可能是預簽名過期”才嘗試重新簽名
        if (!mayBeExpiredSignature || attempt >= maxAttempts) {
          throw err;
        }

        // 重新簽名當前 partNumber（只對 per_part_url 有意義）
        if (!storageKey || partNumber == null) {
          throw err;
        }

        const uploadIdForSign =
          sessionForPolicy?.uploadId || signature?.uploadId || signature?.upload_id || null;
        if (!uploadIdForSign) {
          throw err;
        }

        try {
          const fsPath = this.buildFullPathFromKey(storageKey);
          const signResp = await fsApi.signMultipartParts(fsPath, uploadIdForSign, [partNumber]);
          const resetUploadedParts = signResp?.success && signResp?.data?.resetUploadedParts === true;
          if (resetUploadedParts) {
            // 服務端明確提示“會話已重置”，說明舊的已上傳分片/ETag 已經不可信。
            // 為了避免“無感從頭重傳導致使用者懵”，這裡選擇：
            // 1) 清空本地快取（避免誤跳過分片導致 complete 失敗）
            // 2) 丟擲明確錯誤，交給 UI 提示使用者手動重新開始上傳
            try {
              partsLedger?.clearInMemory?.();
              partsLedger?.clearPersistent?.();
            } catch {}
            try {
              if (sessionForPolicy) {
                sessionForPolicy.presignedUrls = [];
              }
            } catch {}
            throw new Error("上傳連結已過期：伺服器已重置上傳會話，請重新開始上傳");
          }
          const refreshed = signResp?.success ? (signResp?.data?.presignedUrls || []) : [];
          const picked =
            refreshed.find((u) => Number(u?.partNumber) === Number(partNumber)) || refreshed[0] || null;
          const nextUrl = picked?.url ? resolveAbsoluteApiUrl(picked.url) : null;

          if (!nextUrl) {
            throw new Error("重新簽名失敗：後端未返回新的 presignedUrl");
          }

          // 更新 session 的 presignedUrls 快取（便於後續分片複用）
          try {
            if (sessionForPolicy && Array.isArray(sessionForPolicy.presignedUrls)) {
              const merged = [...sessionForPolicy.presignedUrls];
              const existingIndex = merged.findIndex((x) => Number(x?.partNumber) === Number(partNumber));
              if (existingIndex >= 0) merged[existingIndex] = picked;
              else merged.push(picked);
              merged.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
              sessionForPolicy.presignedUrls = merged;
            }
            if (signResp?.data?.policy && sessionForPolicy) {
              sessionForPolicy.policy = signResp.data.policy;
            }
          } catch {}

          currentUrl = nextUrl;
          // 繼續下一輪迴圈重試
          continue;
        } catch (signError) {
          log.warn("[StorageAdapter] 重新簽名失敗，將丟擲原始上傳錯誤:", signError?.message || signError);
          const signMsg = String(signError?.message || "");
          if (signMsg.includes("重置上傳會話") || signMsg.includes("重置") || signMsg.includes("重新開始上傳")) {
            throw signError;
          }
          throw err;
        }
      }
    }

    // 理論上不會到這裡，兜底
    throw lastError || new Error("uploadPartBytes failed");
  } catch (error) {
    if (error?.name === "AbortError") {
      log.warn("[StorageAdapter] uploadPartBytes已中斷(AbortError):", error);
    } else {
      log.error("[StorageAdapter] uploadPartBytes失敗:", error);
    }
    throw error;
  }
}
