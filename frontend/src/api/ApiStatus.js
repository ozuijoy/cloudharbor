/**
 * API狀態碼常量
 * 與後端保持一致
 */
export const ApiStatus = {
  SUCCESS: 200,
  CREATED: 201,
  ACCEPTED: 202, // 部分成功，用於批次操作中有部分失敗的情況
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  INTERNAL_ERROR: 500,
};
