/**
 * @vitest-environment node
 * 分片上傳重試／續傳邏輯單元測試
 *
 * 覆蓋：frontend/src/modules/storage-core/uppy/storage-adapter/multipartTransfer.js 的 uploadPartBytes
 * - Google Drive 直連：308 Resume Incomplete 視為成功
 * - OneDrive / Google Drive 直連：連線被重置後先查上游已收到多少，只補傳缺少的部分
 * - 上游其實已收到整片：不再重送，直接視為成功
 * - 中轉（本站 /upload-chunk）：5xx / 網路錯誤整片重送
 * - S3/HF per_part_url：網路錯誤重新簽名後重試、503 同一 URL 退避重試
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const signMultipartParts = vi.fn();
vi.mock("@/api/services/fsService.js", () => ({ signMultipartParts: (...args) => signMultipartParts(...args) }));
vi.mock("@/utils/logger.js", () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock("@/modules/storage-core/uppy/storage-adapter/tools.js", () => ({
  resolveAbsoluteApiUrl: (u) => u,
}));

const { uploadPartBytes, parseContentRange, parseNextExpectedStart } = await import(
  "@/modules/storage-core/uppy/storage-adapter/multipartTransfer.js"
);

/** 依序回應的假 XHR：script 每個元素 = { status } 或 { network: true } */
let script = [];
let sent = [];

class FakeXHR {
  constructor() {
    this.headers = {};
    this.listeners = {};
    this.upload = { addEventListener() {} };
    this.status = 0;
    this.statusText = "";
    this.responseText = "";
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  getResponseHeader(name) {
    return name.toLowerCase() === "etag" ? this._etag ?? null : null;
  }
  abort() {}
  send(body) {
    sent.push({ url: this.url, headers: { ...this.headers }, size: body?.size ?? body?.byteLength ?? 0 });
    const step = script.shift() || { status: 200 };
    queueMicrotask(() => {
      if (step.network) {
        this.listeners.error?.({ target: this });
        return;
      }
      this.status = step.status;
      this.responseText = step.text || "";
      this._etag = step.etag ?? null;
      this.listeners.load?.({ target: this });
    });
  }
}

function makeAdapter(session) {
  const sessions = new Map([["f1", session]]);
  return {
    uploadSessions: sessions,
    config: { maxRetries: 3 },
    buildFullPathFromKey: (k) => `/${k}`,
    getFileIdFromUrl: () => "f1",
    isFilePaused: () => false,
    _createPartsLedger: () => ({ load() {}, hasPart: () => false, recordPart() {} }),
  };
}

function blobOf(size) {
  return new Blob([new Uint8Array(size)]);
}

const MB = 1024 * 1024;
const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  script = [];
  sent = [];
  signMultipartParts.mockReset();
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.window = { location: { href: "https://app.example.com/", origin: "https://app.example.com" } };
  // 讓退避等待立即完成
  globalThis.setTimeout = (fn) => originalSetTimeout(fn, 0);
});

afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
  delete globalThis.XMLHttpRequest;
  delete globalThis.window;
});

describe("工具函式", () => {
  it("parseContentRange", () => {
    expect(parseContentRange({ "Content-Range": "bytes 10-19/100" })).toEqual({ start: 10, end: 19, total: 100 });
    expect(parseContentRange({})).toBeNull();
  });
  it("parseNextExpectedStart", () => {
    expect(parseNextExpectedStart(["5242880-"])).toBe(5242880);
    expect(parseNextExpectedStart(["300-400", "100-"])).toBe(100);
    expect(parseNextExpectedStart([])).toBeNull();
  });
});

describe("single_session 直連（OneDrive / Google Drive）", () => {
  const session = { strategy: "single_session", uploadId: "upl_1", key: "mnt/a.bin" };
  const sig = (start, end, total) => ({
    url: "https://www.googleapis.com/upload/drive/v3/files?upload_id=xyz",
    headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${total}` },
    strategy: "single_session",
    partNumber: 1,
    fileId: "f1",
    key: "mnt/a.bin",
  });

  it("Google Drive 中間分片回 308 視為成功", async () => {
    script = [{ status: 308 }];
    const ctx = makeAdapter(session);
    const res = await uploadPartBytes.call(ctx, {
      signature: sig(0, 5 * MB - 1, 20 * MB),
      body: blobOf(5 * MB),
      size: 5 * MB,
      onProgress() {},
      onComplete() {},
    });
    expect(res.ETag).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it("連線被重置：查詢上游後只補傳缺少的後半段", async () => {
    script = [{ network: true }, { status: 308 }];
    signMultipartParts.mockResolvedValue({
      success: true,
      data: { session: { nextExpectedRanges: [`${2 * MB}-`] } },
    });
    const ctx = makeAdapter(session);
    await uploadPartBytes.call(ctx, {
      signature: sig(0, 5 * MB - 1, 20 * MB),
      body: blobOf(5 * MB),
      size: 5 * MB,
      onProgress() {},
      onComplete() {},
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].headers["Content-Range"]).toBe(`bytes ${2 * MB}-${5 * MB - 1}/${20 * MB}`);
    expect(sent[1].size).toBe(3 * MB);
  });

  it("上游其實已收到整片：不再重送", async () => {
    script = [{ network: true }];
    signMultipartParts.mockResolvedValue({
      success: true,
      data: { session: { nextExpectedRanges: [`${5 * MB}-`] } },
    });
    const ctx = makeAdapter(session);
    const res = await uploadPartBytes.call(ctx, {
      signature: sig(0, 5 * MB - 1, 20 * MB),
      body: blobOf(5 * MB),
      size: 5 * MB,
      onProgress() {},
      onComplete() {},
    });
    expect(res.ETag).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it("4xx（非 408/416/429）不重試", async () => {
    script = [{ status: 400, text: "bad" }];
    const ctx = makeAdapter(session);
    await expect(
      uploadPartBytes.call(ctx, {
        signature: sig(0, 99, 100),
        body: blobOf(100),
        size: 100,
        onProgress() {},
        onComplete() {},
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(sent).toHaveLength(1);
  });
});

describe("single_session 中轉（Telegram / Discord / GD proxy）", () => {
  it("502 與網路錯誤後整片重送", async () => {
    script = [{ status: 502 }, { network: true }, { status: 200, etag: null }];
    const ctx = makeAdapter({ strategy: "single_session", uploadId: "upl_2", key: "tg/a.bin" });
    const res = await uploadPartBytes.call(ctx, {
      signature: {
        url: "https://app.example.com/api/fs/multipart/upload-chunk?upload_id=upl_2",
        headers: { "Content-Range": "bytes 0-99/100" },
        strategy: "single_session",
        partNumber: 1,
        fileId: "f1",
        key: "tg/a.bin",
      },
      body: blobOf(100),
      size: 100,
      onProgress() {},
      onComplete() {},
    });
    expect(res.ETag).toBeTruthy();
    expect(sent).toHaveLength(3);
    expect(signMultipartParts).not.toHaveBeenCalled();
    expect(sent.every((r) => r.headers["Content-Range"] === "bytes 0-99/100")).toBe(true);
  });
});

describe("per_part_url（S3 / HuggingFace）", () => {
  const session = { strategy: "per_part_url", uploadId: "u1", key: "s3/a.bin", presignedUrls: [] };
  const sig = { url: "https://bucket.s3.amazonaws.com/a?partNumber=3", headers: {}, partNumber: 3, fileId: "f1", key: "s3/a.bin", uploadId: "u1" };

  it("網路錯誤 → 重新簽名 → 用新 URL 成功", async () => {
    script = [{ network: true }, { status: 200, etag: '"abc"' }];
    signMultipartParts.mockResolvedValue({
      success: true,
      data: { presignedUrls: [{ partNumber: 3, url: "https://bucket.s3.amazonaws.com/a?partNumber=3&new=1" }] },
    });
    const ctx = makeAdapter(session);
    const res = await uploadPartBytes.call(ctx, { signature: sig, body: blobOf(10), size: 10, onProgress() {}, onComplete() {} });
    expect(res.ETag).toBe('"abc"');
    expect(sent[1].url).toContain("new=1");
  });

  it("503 SlowDown：同一 URL 退避後重試", async () => {
    script = [{ status: 503 }, { status: 503 }, { status: 200, etag: '"ok"' }];
    const ctx = makeAdapter(session);
    const res = await uploadPartBytes.call(ctx, { signature: sig, body: blobOf(10), size: 10, onProgress() {}, onComplete() {} });
    expect(res.ETag).toBe('"ok"');
    expect(sent).toHaveLength(3);
    expect(signMultipartParts).not.toHaveBeenCalled();
  });
});
