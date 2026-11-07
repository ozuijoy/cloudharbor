import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";

/**
 * 將底層儲存錯誤標準化為 HTTPException
 * 保持最小對映，避免洩漏敏感資訊
 */
export function asHTTPException(error, fallbackMessage = "儲存操作失敗") {
  if (error instanceof HTTPException) {
    return error;
  }

  try {
    // AWS SDK 風格
    if (error?.name === "NoSuchKey" || error?.Code === "NoSuchKey") {
      return new HTTPException(ApiStatus.NOT_FOUND, { message: "物件不存在" });
    }
    if (error?.name === "AccessDenied" || error?.Code === "AccessDenied") {
      return new HTTPException(ApiStatus.FORBIDDEN, { message: "儲存訪問被拒絕" });
    }
    if (typeof error?.$metadata?.httpStatusCode === "number") {
      const status = error.$metadata.httpStatusCode;
      const mapped = status >= 500 ? ApiStatus.INTERNAL_ERROR : status;
      return new HTTPException(mapped, { message: fallbackMessage });
    }

    // 常見 Node 錯誤碼
    if (error?.code === "ENOENT") {
      return new HTTPException(ApiStatus.NOT_FOUND, { message: "目標不存在" });
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      return new HTTPException(ApiStatus.FORBIDDEN, { message: "許可權不足" });
    }
  } catch (_) {
    // 兜底
  }

  return new HTTPException(ApiStatus.INTERNAL_ERROR, { message: fallbackMessage, cause: error });
}

export default asHTTPException;
