/**
 * 通用上傳會話表操作工具
 * - 面向各儲存驅動的前端分片/斷點續傳會話管理（S3 / OneDrive / 其他）
 * - 僅負責持久化與查詢，不承載業務邏輯，便於在不同驅動間複用
 * - 不直接操作雲端 Provider 的真實上傳會話生命週期（如 S3 UploadId / OneDrive uploadSession），
 *   僅維護應用側的控制面檢視，底層資源清理依賴各儲存自身的生命週期策略或專用任務
 */

import { DbTables, UserType } from "../constants/index.js";
import { generateUUID } from "./common.js";

/**
 * 將 userIdOrInfo 規範化為 upload_sessions.user_id 的儲存格式
 * - admin: 直接使用管理員ID
 * - apiKey: 統一加字首 apikey:
 * - 其他型別: 轉為字串
 *
 * @param {string|Object|null} userIdOrInfo
 * @param {string|null} userType
 * @returns {string}
 */
export function normalizeUploadSessionUserId(userIdOrInfo, userType) {
  if (!userType) {
    return String(userIdOrInfo ?? "");
  }

  if (userType === UserType.ADMIN) {
    if (typeof userIdOrInfo === "object" && userIdOrInfo !== null) {
      return String(userIdOrInfo.id ?? userIdOrInfo.sub ?? "");
    }
    return String(userIdOrInfo ?? "");
  }

  if (userType === UserType.API_KEY) {
    let identifier = userIdOrInfo;
    if (typeof userIdOrInfo === "object" && userIdOrInfo !== null) {
      identifier = userIdOrInfo.id ?? userIdOrInfo.key ?? "";
    }
    return `apikey:${String(identifier ?? "")}`;
  }

  return String(userIdOrInfo ?? "");
}

/**
 * 計算上傳會話的檔案指紋（meta-v1）
 * - 目標：在同一使用者/掛載/路徑/檔名/檔案大小下，指紋是穩定且可重複計算的
 * - 僅依賴業務層後設資料，不依賴 provider 的 UploadId / uploadUrl
 *
 * @param {Object} params
 * @param {string|Object|null} params.userIdOrInfo
 * @param {string|null} params.userType
 * @param {string} params.storageType
 * @param {string} params.storageConfigId
 * @param {string|null} params.mountId
 * @param {string} params.fsPath
 * @param {string} params.fileName
 * @param {number} params.fileSize
 * @returns {{ algo: string, value: string }}
 */
export function computeUploadSessionFingerprintMetaV1(params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
  } = params || {};

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const safe = {
    userId: String(userId ?? ""),
    userType: String(userType ?? ""),
    storageType: String(storageType ?? ""),
    storageConfigId: String(storageConfigId ?? ""),
    mountId: String(mountId ?? ""),
    fsPath: String(fsPath ?? ""),
    fileName: String(fileName ?? ""),
    fileSize: Number.isFinite(fileSize) ? String(fileSize) : "",
  };

  const algo = "meta-v1";
  const value = [
    algo,
    safe.userId,
    safe.userType,
    safe.storageType,
    safe.storageConfigId,
    safe.mountId,
    safe.fsPath,
    safe.fileName,
    safe.fileSize,
  ].join("|");

  return { algo, value };
}

/**
 * 建立上傳會話記錄
 *
 * @param {D1Database} db
 * @param {Object} payload
 * @returns {Promise<{id: string}>}
 */
export async function createUploadSessionRecord(db, payload) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId = null,
    fsPath,
    source,
    fileName,
    fileSize,
    mimeType = null,
    checksum = null,
    fingerprintAlgo = null,
    fingerprintValue = null,
    strategy,
    partSize,
    totalParts,
    bytesUploaded = 0,
    uploadedParts = 0,
    nextExpectedRange = null,
    providerUploadId = null,
    providerUploadUrl = null,
    providerMeta = null,
    status = "initiated",
    expiresAt = null,
    id: customId = null,
  } = payload;

  const now = new Date().toISOString();
  const id = customId || `upl_${generateUUID()}`;
  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  // D1 bind 只支援基礎型別，這裡把 providerMeta 統一落庫為 JSON 字串
  let providerMetaText = null;
  if (providerMeta !== null && providerMeta !== undefined) {
    if (typeof providerMeta === "string") {
      providerMetaText = providerMeta;
    } else if (typeof providerMeta === "object") {
      try {
        providerMetaText = JSON.stringify(providerMeta);
      } catch {
        providerMetaText = null;
      }
    } else {
      providerMetaText = String(providerMeta);
    }
  }

  // 自動補全 fingerprint（如果呼叫方未顯式提供）
  let finalFingerprintAlgo = fingerprintAlgo;
  let finalFingerprintValue = fingerprintValue;
  if (!finalFingerprintAlgo || !finalFingerprintValue) {
    const fp = computeUploadSessionFingerprintMetaV1({
      userIdOrInfo,
      userType,
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      fileName,
      fileSize,
    });
    finalFingerprintAlgo = fp.algo;
    finalFingerprintValue = fp.value;
  }

  await db
    .prepare(
      `
      INSERT INTO ${DbTables.UPLOAD_SESSIONS} (
        id,
        user_id,
        user_type,
        storage_type,
        storage_config_id,
        mount_id,
        fs_path,
        source,
        file_name,
        file_size,
        mime_type,
        checksum,
        fingerprint_algo,
        fingerprint_value,
        strategy,
        part_size,
        total_parts,
        bytes_uploaded,
        uploaded_parts,
        next_expected_range,
        provider_upload_id,
        provider_upload_url,
        provider_meta,
        status,
        created_at,
        updated_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .bind(
      id,
      userId,
      userType || "",
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      source,
      fileName,
      fileSize,
      mimeType,
      checksum,
      finalFingerprintAlgo,
      finalFingerprintValue,
      strategy,
      partSize,
      totalParts,
      bytesUploaded,
      uploadedParts,
      nextExpectedRange,
      providerUploadId,
      providerUploadUrl,
      providerMetaText,
      status,
      now,
      now,
      expiresAt,
    )
    .run();

  console.log("[uploadSessions] 會話建立完成", {
    storageType,
    status,
  });

  return { id };
}

/**
 * 按檔案指紋更新上傳會話狀態（完成/中止等）
 * - 用於你要求的“同一使用者 + 同一掛載 + 同一路徑 + 同一檔案”統一判斷
 *
 * @param {D1Database} db
 * @param {Object} params
 */
export async function updateUploadSessionStatusByFingerprint(db, params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
    status,
    bytesUploaded,
    uploadedParts,
    nextExpectedRange,
    errorCode,
    errorMessage,
  } = params || {};

  if (
    !storageType ||
    !storageConfigId ||
    !mountId ||
    !fsPath ||
    !fileName ||
    !Number.isFinite(fileSize)
  ) {
    console.warn("[uploadSessions] updateUploadSessionStatusByFingerprint 缺少必要引數", {
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      fileName,
      fileSize,
    });
    return;
  }

  const fingerprint = computeUploadSessionFingerprintMetaV1({
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
  });
  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const sets = [];
  const bindings = [];

  if (typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded)) {
    sets.push("bytes_uploaded = ?");
    bindings.push(bytesUploaded);
  }

  if (typeof uploadedParts === "number" && Number.isFinite(uploadedParts)) {
    sets.push("uploaded_parts = ?");
    bindings.push(uploadedParts);
  }

  if (typeof nextExpectedRange === "string" || nextExpectedRange === null) {
    sets.push("next_expected_range = ?");
    bindings.push(nextExpectedRange);
  }

  if (status) {
    sets.push("status = ?");
    bindings.push(status);
  }

  if (errorCode !== undefined) {
    sets.push("error_code = ?");
    bindings.push(errorCode);
  }

  if (errorMessage !== undefined) {
    sets.push("error_message = ?");
    bindings.push(errorMessage);
  }

  if (sets.length === 0) {
    console.log(
      "[uploadSessions] updateUploadSessionStatusByFingerprint 無需更新（未提供任何可更新欄位）",
      { storageType, fingerprintAlgo: fingerprint.algo, fingerprintValue: fingerprint.value, userId },
    );
    return;
  }

  // 始終更新 updated_at
  sets.push("updated_at = ?");
  bindings.push(new Date().toISOString());

  const sql = `
    UPDATE ${DbTables.UPLOAD_SESSIONS}
    SET ${sets.join(", ")}
    WHERE storage_type = ?
      AND fingerprint_algo = ?
      AND fingerprint_value = ?
      AND user_id = ?
  `;
  const values = [
    ...bindings,
    storageType,
    fingerprint.algo,
    fingerprint.value,
    userId,
  ];

  const stmt = db.prepare(sql);
  const result = await stmt.bind(...values).run();

  console.log("[uploadSessions] 會話狀態更新完成", {
    storageType,
    status,
    changes: result?.meta?.changes ?? result?.changes ?? 0,
  });
}

/**
 * 按會話 ID 更新 upload_sessions（通用工具）
 *
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<{changes:number}>}
 */
export async function updateUploadSessionById(db, params) {
  const {
    id,
    storageType = null,
    expectedStatus = null,
    status,
    bytesUploaded,
    uploadedParts,
    nextExpectedRange,
    errorCode,
    errorMessage,
    providerUploadUrl,
    providerUploadId,
    providerMeta,
    partSize,
    totalParts,
    expiresAt,
  } = params || {};

  if (!db || !id) {
    return { changes: 0 };
  }

  const sets = [];
  const bindings = [];

  if (status !== undefined) {
    sets.push("status = ?");
    bindings.push(status);
  }
  if (typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded)) {
    sets.push("bytes_uploaded = ?");
    bindings.push(bytesUploaded);
  }
  if (typeof uploadedParts === "number" && Number.isFinite(uploadedParts)) {
    sets.push("uploaded_parts = ?");
    bindings.push(uploadedParts);
  }
  if (typeof nextExpectedRange === "string" || nextExpectedRange === null) {
    sets.push("next_expected_range = ?");
    bindings.push(nextExpectedRange);
  }
  if (errorCode !== undefined) {
    sets.push("error_code = ?");
    bindings.push(errorCode);
  }
  if (errorMessage !== undefined) {
    sets.push("error_message = ?");
    bindings.push(errorMessage);
  }
  if (providerUploadUrl !== undefined) {
    sets.push("provider_upload_url = ?");
    bindings.push(providerUploadUrl);
  }
  if (providerUploadId !== undefined) {
    sets.push("provider_upload_id = ?");
    bindings.push(providerUploadId);
  }
  if (providerMeta !== undefined) {
    const finalMeta =
      providerMeta && typeof providerMeta === "object"
        ? JSON.stringify(providerMeta)
        : providerMeta;
    sets.push("provider_meta = ?");
    bindings.push(finalMeta);
  }
  if (typeof partSize === "number" && Number.isFinite(partSize)) {
    sets.push("part_size = ?");
    bindings.push(partSize);
  }
  if (typeof totalParts === "number" && Number.isFinite(totalParts)) {
    sets.push("total_parts = ?");
    bindings.push(totalParts);
  }
  if (typeof expiresAt === "string" || expiresAt === null) {
    sets.push("expires_at = ?");
    bindings.push(expiresAt);
  }

  if (sets.length === 0) {
    return { changes: 0 };
  }

  // 始終更新 updated_at
  sets.push("updated_at = ?");
  bindings.push(new Date().toISOString());

  const whereParts = ["id = ?"];
  const whereBindings = [String(id)];

  if (storageType) {
    whereParts.push("storage_type = ?");
    whereBindings.push(String(storageType));
  }
  if (expectedStatus) {
    whereParts.push("status = ?");
    whereBindings.push(String(expectedStatus));
  }

  const sql = `
    UPDATE ${DbTables.UPLOAD_SESSIONS}
    SET ${sets.join(", ")}
    WHERE ${whereParts.join(" AND ")}
  `;

  const result = await db
    .prepare(sql)
    .bind(...bindings, ...whereBindings)
    .run();

  return {
    changes: result?.meta?.changes ?? result?.changes ?? 0,
  };
}

/**
 * 列出指定使用者/掛載/路徑字首下的活動上傳會話
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<Array<Object>>}
 */
export async function listActiveUploadSessions(db, params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    mountId = null,
    fsPathPrefix = null,
    limit = 100,
  } = params;

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);
  const now = new Date().toISOString();

  // 基礎條件：按儲存型別、使用者與狀態過濾
  // - 返回“仍可能繼續”的會話：initiated/uploading
  // - initiated 是否要在前端展示為“可恢復”
  const sqlParts = [
    `SELECT * FROM ${DbTables.UPLOAD_SESSIONS} WHERE storage_type = ? AND user_id = ? AND status IN (?, ?)`,
  ];
  const values = [storageType, userId, "initiated", "uploading"];

  // 可選掛載過濾
  if (mountId) {
    sqlParts.push("AND mount_id = ?");
    values.push(mountId);
  }

  // 可選路徑字首過濾
  if (fsPathPrefix && fsPathPrefix !== "/") {
    // 移除末尾的斜槓和反斜槓，避免複雜正則在打包階段被錯誤轉譯
    let normalized = fsPathPrefix;
    while (normalized.endsWith("/") || normalized.endsWith("\\")) {
      normalized = normalized.slice(0, -1);
    }
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }
    // 轉義 LIKE 萬用字元，避免路徑中出現 %/_ 時擴大匹配範圍
    const escaped = normalized.replace(/[%_]/g, "\\$&");
    const likePrefix = `${escaped}%`;
    // 使用單字元轉義符（反斜槓），符合 SQLite/D1 對 ESCAPE 的約束
    sqlParts.push("AND fs_path LIKE ? ESCAPE '\\'");
    values.push(likePrefix);
  }

  // 過濾掉已過期的會話（如果 expires_at 有值）
  sqlParts.push("AND (expires_at IS NULL OR expires_at > ?)");
  values.push(now);

  // 排序與限制
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  sqlParts.push("ORDER BY created_at DESC");
  sqlParts.push("LIMIT ?");
  values.push(safeLimit);

  const sql = sqlParts.join(" ");

  const result = await db.prepare(sql).bind(...values).all();
  return result?.results || [];
}

/**
 * 按會話ID查詢單個上傳會話記錄
 *
 * @param {D1Database} db
 * @param {{ id: string }} params
 * @returns {Promise<Object|null>}
 */
export async function findUploadSessionById(db, params) {
  const { id } = params || {};
  if (!id) {
    return null;
  }

  const sql = `
    SELECT *
    FROM ${DbTables.UPLOAD_SESSIONS}
    WHERE id = ?
    LIMIT 1
  `;

  const result = await db.prepare(sql).bind(id).all();
  const rows = result?.results || [];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 按 uploadUrl 查詢單個上傳會話記錄
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export async function findUploadSessionByUploadUrl(db, params) {
  const { uploadUrl, storageType, userIdOrInfo, userType } = params;

  if (!uploadUrl || !storageType) {
    return null;
  }

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const sql = `
    SELECT *
    FROM ${DbTables.UPLOAD_SESSIONS}
    WHERE storage_type = ?
      AND provider_upload_url = ?
      AND user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await db.prepare(sql).bind(storageType, uploadUrl, userId).all();
  const rows = result?.results || [];
  return rows.length > 0 ? rows[0] : null;
}
