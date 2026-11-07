/**
 * CloudHarbor 後端基礎測試
 *
 * 只測純函式與錯誤型別（不啟動伺服器、不連資料庫），
 * 可在 CI 或任何機器上無依賴執行。
 *
 * 執行方式：npm test（node --test）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createSuccessResponse,
  createErrorResponse,
  formatFileSize,
  generateRandomString,
  generateUUID,
  processWeeklyData,
} from "../src/utils/common.js";
import {
  ValidationError,
  NotFoundError,
  RepositoryError,
  AppError,
} from "../src/http/errors.js";

test("createSuccessResponse 產生標準成功結構", () => {
  assert.deepEqual(createSuccessResponse({ a: 1 }), {
    success: true,
    code: "OK",
    message: "OK",
    data: { a: 1 },
  });
  assert.equal(createSuccessResponse({}, "完成", "CUSTOM").code, "CUSTOM");
});

test("createErrorResponse 產生標準失敗結構，並可附加欄位", () => {
  assert.deepEqual(createErrorResponse(400, "壞請求", "BAD_REQUEST"), {
    success: false,
    code: "BAD_REQUEST",
    message: "壞請求",
  });

  const withExtra = createErrorResponse(400, "壞請求", "BAD_REQUEST", { field: "name" });
  assert.equal(withExtra.field, "name");
  assert.equal(withExtra.success, false);
});

test("formatFileSize 依 1024 進位輸出兩位小數", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1024), "1.00 KB");
  assert.equal(formatFileSize(1536), "1.50 KB");
  assert.equal(formatFileSize(1024 * 1024), "1.00 MB");
  assert.equal(formatFileSize(1024 * 1024 * 1024), "1.00 GB");
});

test("generateRandomString 長度與字元集正確", () => {
  const s = generateRandomString(16);
  assert.equal(s.length, 16);
  assert.match(s, /^[A-Za-z0-9]+$/);
  assert.notEqual(generateRandomString(16), generateRandomString(16));
});

test("generateUUID 符合 RFC4122 v4 格式", () => {
  assert.match(generateUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("processWeeklyData 無資料時回傳 7 個 0", () => {
  assert.deepEqual(processWeeklyData([]), new Array(7).fill(0));
  assert.deepEqual(processWeeklyData(null), new Array(7).fill(0));
});

test("processWeeklyData 將今日資料對映到最後一格", () => {
  const today = new Date().toISOString().split("T")[0];
  const result = processWeeklyData([{ date: today, count: 5 }]);
  assert.equal(result.length, 7);
  assert.equal(result[6], 5);
});

test("錯誤型別的 status / code / expose 正確", () => {
  const v = new ValidationError("格式錯誤");
  assert.equal(v.status, 400);
  assert.equal(v.code, "VALIDATION_ERROR");
  assert.equal(v.expose, true);

  const nf = new NotFoundError();
  assert.equal(nf.status, 404);
  assert.equal(nf.code, "NOT_FOUND");

  const repo = new RepositoryError("DB 掛了");
  assert.equal(repo.status, 500);
  assert.equal(repo.code, "REPOSITORY_ERROR");
  assert.equal(repo.expose, false, "資料層錯誤不應外露細節");

  assert.ok(v instanceof AppError);
  assert.ok(repo instanceof Error);
});