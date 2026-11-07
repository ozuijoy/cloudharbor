import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";

const SENSITIVE_KEYS = [
  "authorization",
  "x-api-key",
  "x-api-key-id",
  "access_key",
  "secret_key",
  "access_key_id",
  "secret_access_key",
  "token",
  "signature",
  "password",
];

const MAX_CLIENT_DEBUG_MESSAGE_LENGTH = 220;

// 將錯誤資訊做最小必要的脫敏（給前端展示用）
export const sanitizeErrorMessageForClient = (message) => {
  let text = String(message ?? "").trim();
  if (!text) return null;

  // 統一為單行
  text = text.replace(/\s+/g, " ").trim();

  // 常見 query token
  text = text.replace(/access_token=([^&\s]+)/gi, "access_token=***");
  text = text.replace(/refresh_token=([^&\s]+)/gi, "refresh_token=***");
  text = text.replace(/token=([^&\s]+)/gi, "token=***");
  text = text.replace(/signature=([^&\s]+)/gi, "signature=***");

  // Authorization / ApiKey
  text = text.replace(/\b(Bearer|ApiKey)\s+([A-Za-z0-9._-]+)\b/gi, "$1 ***");

  // AWS / S3 常見欄位（輕量遮蓋）
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA****************");

  if (text.length > MAX_CLIENT_DEBUG_MESSAGE_LENGTH) {
    text = `${text.slice(0, MAX_CLIENT_DEBUG_MESSAGE_LENGTH - 1)}…`;
  }

  return text;
};

//  AppError 用於處理應用程式錯誤
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, expose?: boolean, details?: any}} options
   */
  constructor(message, { status = ApiStatus.INTERNAL_ERROR, code = "APP_ERROR", expose = true, details = null } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "請求引數無效", details = null) {
    super(message, { status: ApiStatus.BAD_REQUEST, code: "VALIDATION_ERROR", expose: true, details });
    this.name = "ValidationError";
  }
}

// 認證失敗
export class AuthenticationError extends AppError {
  constructor(message = "未授權", details = null) {
    super(message, { status: ApiStatus.UNAUTHORIZED, code: "UNAUTHORIZED", expose: true, details });
    this.name = "AuthenticationError";
  }
}

// 許可權不足
export class AuthorizationError extends AppError {
  constructor(message = "許可權不足", details = null) {
    super(message, { status: ApiStatus.FORBIDDEN, code: "FORBIDDEN", expose: true, details });
    this.name = "AuthorizationError";
  }
}

// 資源不存在
export class NotFoundError extends AppError {
  constructor(message = "資源不存在", details = null) {
    super(message, { status: ApiStatus.NOT_FOUND, code: "NOT_FOUND", expose: true, details });
    this.name = "NotFoundError";
  }
}

// 資源衝突
export class ConflictError extends AppError {
  constructor(message = "資源衝突", details = null) {
    super(message, { status: ApiStatus.CONFLICT, code: "CONFLICT", expose: true, details });
    this.name = "ConflictError";
  }
}

// 倉儲/資料訪問層錯誤
export class RepositoryError extends AppError {
  constructor(message = "資料訪問錯誤", details = null) {
    super(message, { status: ApiStatus.INTERNAL_ERROR, code: "REPOSITORY_ERROR", expose: false, details });
    this.name = "RepositoryError";
  }
}

// 外部驅動/上游服務錯誤
export class DriverError extends AppError {
  /**
   * @param {string} message
   * @param {object|any} optionsOrDetails - 可傳 { status?, code?, expose?, details? } 或直接 details 物件
   */
  constructor(message = "外部服務錯誤", optionsOrDetails = null) {
    let status = ApiStatus.INTERNAL_ERROR;
    let code = "DRIVER_ERROR";
    let expose = false;
    let details = null;
    if (optionsOrDetails && typeof optionsOrDetails === "object" && ("status" in optionsOrDetails || "code" in optionsOrDetails || "expose" in optionsOrDetails || "details" in optionsOrDetails)) {
      status = optionsOrDetails.status ?? status;
      code = optionsOrDetails.code ?? code;
      expose = optionsOrDetails.expose ?? expose;
      details = optionsOrDetails.details ?? null;
    } else {
      details = optionsOrDetails;
    }
    super(message, { status, code, expose, details });
    this.name = "DriverError";
  }
}

export class S3DriverError extends DriverError {
  /**
   * @param {string} message
   * @param {object|any} optionsOrDetails - 同 DriverError，可覆蓋 code/status 等
   */
  constructor(message = "外部服務錯誤", optionsOrDetails = null) {
    const opts = (optionsOrDetails && typeof optionsOrDetails === "object" && ("status" in optionsOrDetails || "code" in optionsOrDetails || "expose" in optionsOrDetails || "details" in optionsOrDetails))
      ? { ...optionsOrDetails, code: optionsOrDetails.code ?? "DRIVER_ERROR.S3" }
      : { details: optionsOrDetails, code: "DRIVER_ERROR.S3" };
    super(message, opts);
    this.name = "S3DriverError";
  }
}

// 驅動契約錯誤：用於標記儲存驅動在型別/能力/方法實現上的契約不一致
export class DriverContractError extends DriverError {
  /**
   * @param {string} message
   * @param {object|any} optionsOrDetails - 同 DriverError，可覆蓋 status/code/expose/details
   */
  constructor(message = "儲存驅動契約不符合規範", optionsOrDetails = null) {
    const base = {
      status: ApiStatus.INTERNAL_ERROR,
      code: "DRIVER_ERROR.INVALID_CONTRACT",
      expose: false,
    };
    const opts =
      optionsOrDetails && typeof optionsOrDetails === "object" && ("status" in optionsOrDetails || "code" in optionsOrDetails || "expose" in optionsOrDetails || "details" in optionsOrDetails)
        ? { ...base, ...optionsOrDetails }
        : { ...base, details: optionsOrDetails };
    super(message, opts);
    this.name = "DriverContractError";
  }
}

//  maskSensitiveValue 用於 mask 敏感資訊
export const maskSensitiveValue = (value) => {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

//  sanitizeHeaders 用於 sanitize headers 中的敏感資訊
export const sanitizeHeaders = (headers = {}) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = maskSensitiveValue(String(value ?? ""));
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

export const normalizeError = (error, context = {}) => {
  if (error instanceof HTTPException) {
    return {
      status: error.status ?? ApiStatus.INTERNAL_ERROR,
      code: "HTTP_EXCEPTION",
      publicMessage: error.message ?? "伺服器內部錯誤",
      expose: true,
      originalError: error,
      context,
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      publicMessage: error.message,
      expose: error.expose,
      details: error.details,
      originalError: error,
      context,
    };
  }

  const status = error?.status ?? ApiStatus.INTERNAL_ERROR;
  return {
    status,
    code: error?.code ?? "UNHANDLED_ERROR",
    publicMessage: status >= 500 ? "伺服器內部錯誤" : error?.message ?? "請求失敗",
    expose: status < 500,
    originalError: error,
    context,
  };
};

// 斷言輔助：條件不滿足即丟擲給定 AppError 例項
export const assert = (condition, errorInstance) => {
  if (!condition) throw errorInstance;
};

// 包裝外部非同步呼叫為統一的 DriverError（或其子類）
export const wrapAsync = async (fn, details = {}) => {
  try {
    return await fn();
  } catch (e) {
    throw new DriverError("外部服務呼叫失敗", { cause: e?.message, ...details });
  }
};
