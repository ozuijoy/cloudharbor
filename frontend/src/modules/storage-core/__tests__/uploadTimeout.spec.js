/**
 * @vitest-environment node
 * CloudHarbor 上傳逾時設定單元測試
 *
 * 覆蓋：frontend/src/modules/storage-core/uppy/xhrUploadDefaults.js
 *      frontend/src/api/client.js 內的一般／上傳逾時決策（以等價邏輯驗證）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getUploadTimeoutMs, withUploadTimeout } from "@/modules/storage-core/uppy/xhrUploadDefaults.js";

describe("xhrUploadDefaults", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  it("未設定時回退 10 分鐘預設值", () => {
    delete globalThis.window;
    expect(getUploadTimeoutMs()).toBe(10 * 60 * 1000);
  });

  it("uploadTimeoutMs = 0 表示完全停用進度逾時", () => {
    globalThis.window = { appConfig: { uploadTimeoutMs: 0 } };
    expect(getUploadTimeoutMs()).toBe(0);
  });

  it("接受字串形式的數字設定", () => {
    globalThis.window = { appConfig: { uploadTimeoutMs: "120000" } };
    expect(getUploadTimeoutMs()).toBe(120000);
  });

  it("非法值（負數/非數字）回退預設值", () => {
    globalThis.window = { appConfig: { uploadTimeoutMs: -1 } };
    expect(getUploadTimeoutMs()).toBe(600000);
    globalThis.window = { appConfig: { uploadTimeoutMs: "abc" } };
    expect(getUploadTimeoutMs()).toBe(600000);
  });

  it("withUploadTimeout 只在呼叫端未指定時注入", () => {
    globalThis.window = { appConfig: { uploadTimeoutMs: 900000 } };
    const injected = withUploadTimeout({ endpoint: "/fs/upload" });
    expect(injected.timeout).toBe(900000);
    expect(injected.endpoint).toBe("/fs/upload");

    const explicit = withUploadTimeout({ timeout: 30000 });
    expect(explicit.timeout).toBe(30000);

    const zero = withUploadTimeout({ timeout: 0 });
    expect(zero.timeout).toBe(0);
  });
});

/**
 * 等價驗證 client.js 的逾時決策：
 *   timeoutMs = 明確傳入 ? 傳入值 : (上傳請求 ? uploadTimeoutMs(預設 0) : apiTimeoutMs(預設 30000))
 */
describe("client 逾時決策（等價邏輯）", () => {
  const readConfiguredTimeout = (appConfig, key, fallback) => {
    const raw = appConfig ? appConfig[key] : undefined;
    if (raw === undefined || raw === null || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const decide = (opts, isUploadRequest, appConfig) => {
    const hasExplicit = Object.prototype.hasOwnProperty.call(opts, "timeout");
    return hasExplicit
      ? Number(opts.timeout) || 0
      : isUploadRequest
        ? readConfiguredTimeout(appConfig, "uploadTimeoutMs", 0)
        : readConfiguredTimeout(appConfig, "apiTimeoutMs", 30000);
  };

  it("一般 API 請求預設 30 秒", () => {
    expect(decide({}, false, undefined)).toBe(30000);
  });

  it("上傳請求預設不設逾時（0）", () => {
    expect(decide({}, true, undefined)).toBe(0);
  });

  it("呼叫端明確指定 timeout 時以其為準（含 0）", () => {
    expect(decide({ timeout: 5000 }, false, undefined)).toBe(5000);
    expect(decide({ timeout: 0 }, false, undefined)).toBe(0);
  });

  it("可用 window.appConfig 覆寫兩者", () => {
    const cfg = { apiTimeoutMs: 60000, uploadTimeoutMs: 1200000 };
    expect(decide({}, false, cfg)).toBe(60000);
    expect(decide({}, true, cfg)).toBe(1200000);
  });

  it("0 是合法設定值（表示不限制），不會被當成 falsy 回退", () => {
    expect(decide({}, true, { uploadTimeoutMs: 0 })).toBe(0);
  });
});
