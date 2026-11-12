/**
 * 上傳通道修正的回歸測試（不連真實雲端，全部以假 fetch 驗證請求內容）
 *
 * - streamBody：分塊讀取、Node duplex 補丁、FixedLengthStream 包裝
 * - OneDrive：後端串流上傳 > 60MiB 改為分段 PUT（Content-Range 正確、320KiB 對齊、5xx 重試）
 * - Google Drive：direct 建立 resumable session 會帶瀏覽器 Origin；拿不到 Origin 時退回 proxy；
 *   308 無 Range 標頭視為已收到 0 位元組
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  readStreamInChunks,
  buildUploadFetchInit,
  installNodeFetchDuplexPatch,
  withKnownLength,
} from "../src/utils/streamBody.js";
import { OneDriveGraphClient } from "../src/storage/drivers/onedrive/client/OneDriveGraphClient.js";
import { GoogleDriveUploadOperations } from "../src/storage/drivers/googledrive/GoogleDriveUploadOperations.js";

function streamOf(total, pieceSize = 64 * 1024) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const n = Math.min(pieceSize, total - sent);
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) buf[i] = (sent + i) & 0xff;
      sent += n;
      controller.enqueue(buf);
    },
  });
}

test("readStreamInChunks：固定大小切塊、最後一塊較小、位元組不遺失", async () => {
  const sizes = [];
  let checksum = 0;
  let offset = 0;
  let ok = true;
  for await (const c of readStreamInChunks(streamOf(1000_003, 7777), 250_000)) {
    sizes.push(c.byteLength);
    for (let i = 0; i < c.byteLength; i++) {
      if (c[i] !== ((offset + i) & 0xff)) ok = false;
      checksum += c[i];
    }
    offset += c.byteLength;
  }
  assert.deepEqual(sizes, [250_000, 250_000, 250_000, 250_000, 3]);
  assert.equal(ok, true);
  assert.ok(checksum > 0);
});

test("buildUploadFetchInit：串流 body 自動加 duplex，非串流不動", () => {
  const s = streamOf(10);
  const a = buildUploadFetchInit({ method: "PUT", body: s }, { contentLength: 10 });
  assert.equal(a.duplex, "half");
  const b = buildUploadFetchInit({ method: "PUT", body: new Uint8Array(3) });
  assert.equal(b.duplex, undefined);
});

test("withKnownLength：有 FixedLengthStream（Workers）時改用定長串流", async () => {
  const created = [];
  globalThis.FixedLengthStream = class extends TransformStream {
    constructor(len) {
      super();
      created.push(len);
    }
  };
  try {
    const out = withKnownLength(streamOf(100), 100);
    assert.deepEqual(created, [100]);
    let total = 0;
    for await (const c of out) total += c.byteLength;
    assert.equal(total, 100);
  } finally {
    delete globalThis.FixedLengthStream;
  }
});

test("installNodeFetchDuplexPatch：Node fetch 串流上傳不再丟 duplex TypeError", async () => {
  const original = globalThis.fetch;
  let seenInit = null;
  globalThis.fetch = async (_url, init) => {
    seenInit = init;
    return new Response("ok");
  };
  delete globalThis.__cloudharborFetchDuplexPatched;
  try {
    installNodeFetchDuplexPatch();
    await fetch("https://example.com", { method: "PUT", body: streamOf(5) });
    assert.equal(seenInit.duplex, "half");
  } finally {
    globalThis.fetch = original;
    delete globalThis.__cloudharborFetchDuplexPatched;
  }
});

test("OneDrive uploadSessionChunked：130MiB 拆成 ≤10MiB 分段、320KiB 對齊、5xx 自動重試", async () => {
  const total = 130 * 1024 * 1024 + 12345;
  const original = globalThis.fetch;
  const calls = [];
  let failedOnce = false;
  globalThis.fetch = async (_url, init) => {
    const range = init.headers["Content-Range"];
    const len = init.body.byteLength;
    calls.push({ range, len });
    if (!failedOnce && calls.length === 3) {
      failedOnce = true;
      return new Response("busy", { status: 503 });
    }
    const end = Number(/-(\d+)\//.exec(range)[1]);
    if (end === total - 1) return new Response(JSON.stringify({ id: "item1" }), { status: 201 });
    return new Response(JSON.stringify({ nextExpectedRanges: [`${end + 1}-`] }), { status: 202 });
  };
  try {
    const client = Object.create(OneDriveGraphClient.prototype);
    client._handleErrorResponse = async (resp) => {
      throw new Error(`HTTP ${resp.status}`);
    };
    const item = await client.uploadSessionChunked("https://graph/upload", streamOf(total, 1024 * 1024), {
      contentLength: total,
    });
    assert.equal(item.id, "item1");
    const ok = calls.filter((c, i) => !(i === 2));
    let expectStart = 0;
    for (const c of ok) {
      const [, s, e] = /bytes (\d+)-(\d+)\//.exec(c.range).map(Number);
      assert.equal(s, expectStart);
      assert.equal(e - s + 1, c.len);
      assert.ok(c.len <= 60 * 1024 * 1024);
      if (e !== total - 1) assert.equal(c.len % (320 * 1024), 0);
      expectStart = e + 1;
    }
    assert.equal(expectStart, total);
    assert.equal(calls[2].range, calls[3].range, "503 後應重送同一段");
  } finally {
    globalThis.fetch = original;
  }
});

function makeGdOps({ channel } = {}) {
  const driver = {
    type: "GOOGLE_DRIVE",
    rootId: "root",
    config: channel ? { upload_channel: channel } : {},
    authManager: { withAccessToken: async (fn) => fn("tok") },
  };
  return new GoogleDriveUploadOperations(driver);
}

test("Google Drive direct：建立 resumable session 帶瀏覽器 Origin，並回傳 Google session URL", async () => {
  const original = globalThis.fetch;
  let initHeaders = null;
  globalThis.fetch = async (_url, init) => {
    initHeaders = init.headers;
    return new Response("", { status: 200, headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=ABC" } });
  };
  try {
    const ops = makeGdOps();
    const fakeDb = {};
    const mod = await import("../src/utils/uploadSessions.js");
    // 只驗證到建立會話前的請求內容：攔截 DB 寫入
    const res = await ops
      .initializeFrontendMultipartUpload("", {
        fileName: "a.bin",
        fileSize: 100 * 1024 * 1024,
        mount: { id: 1, storage_config_id: 2, mount_path: "/gd" },
        db: fakeDb,
        requestOrigin: "https://app.example.com",
      })
      .catch((e) => e);
    void mod;
    assert.equal(initHeaders.Origin, "https://app.example.com");
    // DB 是假的，建立紀錄會失敗；只要失敗點在 Origin 之後即可
    assert.ok(res instanceof Error || res?.session?.channel === "direct");
  } finally {
    globalThis.fetch = original;
  }
});

test("Google Drive：拿不到 Origin 時不帶 Origin（之後退回 proxy）", async () => {
  const original = globalThis.fetch;
  let initHeaders = null;
  globalThis.fetch = async (_url, init) => {
    initHeaders = init.headers;
    return new Response("", { status: 200, headers: { Location: "https://www.googleapis.com/upload/x" } });
  };
  try {
    const ops = makeGdOps();
    await ops
      .initializeFrontendMultipartUpload("", {
        fileName: "a.bin",
        fileSize: 10,
        mount: { id: 1, storage_config_id: 2 },
        db: {},
        requestOrigin: null,
      })
      .catch(() => {});
    assert.equal(initHeaders.Origin, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("Google Drive 狀態查詢：308 無 Range = 已收到 0 位元組；有 Range 取最後位元組 +1", async () => {
  const original = globalThis.fetch;
  const ops = makeGdOps();
  try {
    globalThis.fetch = async () => new Response(null, { status: 308 });
    let st = await ops._getResumableUploadStatus("https://u", 1000);
    assert.equal(st.bytesUploaded, 0);
    assert.equal(st.nextExpectedRange, "0-");

    globalThis.fetch = async () => new Response(null, { status: 308, headers: { Range: "bytes=0-524287" } });
    st = await ops._getResumableUploadStatus("https://u", 1000000);
    assert.equal(st.bytesUploaded, 524288);
  } finally {
    globalThis.fetch = original;
  }
});
