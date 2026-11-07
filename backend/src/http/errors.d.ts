import { HTTPException } from 'hono/http-exception';

/**
 * 應用程式基礎錯誤類
 */
export class AppError extends Error {
  name: string;
  status: number;
  code: string;
  expose: boolean;
  details: any;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      expose?: boolean;
      details?: any;
    }
  );
}

/**
 * 請求引數驗證錯誤
 */
export class ValidationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 認證失敗錯誤
 */
export class AuthenticationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 許可權不足錯誤
 */
export class AuthorizationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 資源不存在錯誤
 */
export class NotFoundError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 資源衝突錯誤
 */
export class ConflictError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 倉儲/資料訪問層錯誤
 */
export class RepositoryError extends AppError {
  constructor(message?: string, details?: any);
}

export interface DriverErrorOptions {
  status?: number;
  code?: string;
  expose?: boolean;
  details?: any;
}

/**
 * 外部驅動/上游服務錯誤
 */
export class DriverError extends AppError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * S3 驅動錯誤
 */
export class S3DriverError extends DriverError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * 驅動契約錯誤：儲存驅動型別/能力/方法實現的契約不一致
 */
export class DriverContractError extends DriverError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * 掩碼敏感值
 */
export function maskSensitiveValue(value: string | null | undefined): string;

/**
 * 清理 headers 中的敏感資訊
 */
export function sanitizeHeaders(headers?: Record<string, any>): Record<string, any>;

export interface NormalizedError {
  status: number;
  code: string;
  publicMessage: string;
  expose: boolean;
  details?: any;
  originalError: Error;
  context: Record<string, any>;
}

/**
 * 標準化錯誤物件
 */
export function normalizeError(
  error: Error | HTTPException | AppError | any,
  context?: Record<string, any>
): NormalizedError;

/**
 * 斷言輔助：條件不滿足即丟擲給定 AppError 例項
 */
export function assert(condition: any, errorInstance: AppError): asserts condition;

/**
 * 包裝外部非同步呼叫為統一的 DriverError
 */
export function wrapAsync<T>(
  fn: () => Promise<T>,
  details?: Record<string, any>
): Promise<T>;
