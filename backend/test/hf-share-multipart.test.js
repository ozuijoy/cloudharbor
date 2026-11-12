/**
 * HuggingFace 分享上傳（無掛載）分片：
 * - generateMultipartUploadUrls：HF 回 multipart 時給每片 URL；回 basic 時退化為單片
 * - completeMultipartUploadUrls：只接受 HF 網域的 completionUrl，並把 parts 送到 completionUrl
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HuggingFaceDatasetsStorageDriver } from "../src/storage/drivers/huggingface-datasets/HuggingFaceDatasetsStorageDriver.js";

const OID = "a".repeat(64);

function makeDriver() {
  const d = Object.create(HuggingFaceDatasetsStorageDriver.prototype);
  d._ensureInitialized = () => {};
  d._requireWriteEnabled = () => {};
  d._endpointBase = "https://huggingface.co";
  d._token = "hf_x";
  d._revision = "main";
  d._getHubRepoDesignation = () => "datasets/u/r";
  return d;
}

function lfsResponse(upload) {
  return new Response(JSON.stringify({ objects: [{ oid: OID, size: 1, actions: { upload } }] }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.git-lfs+json" },
  });
}

test("HF 回 multipart：回傳每片 URL、partSize、completionUrl", async () => {
  const original = globalThis.fetch;
  const size = 50 * 1024 * 1024;
  let sentPayload = null;
  globalThis.fetch = async (_url, init) => {
    sentPayload = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        objects: [
          {
            oid: OID,
            size,
            actions: {
              upload: {
                href: "https://huggingface.co/api/complete_multipart?uploadId=U&sig=1",
                header: {
                  chunk_size: String(20 * 1024 * 1024),
                  "00001": "https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/x?partNumber=1&X-Amz-Expires=86400",
                  "00002": "https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/x?partNumber=2&X-Amz-Expires=86400",
                  "00003": "https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/x?partNumber=3&X-Amz-Expires=86400",
                },
              },
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const r = await makeDriver().generateMultipartUploadUrls("share/a.mp4", { fileSize: size, sha256: OID });
    assert.deepEqual(sentPayload.transfers, ["basic", "multipart"]);
    assert.equal(r.mode, "multipart");
    assert.equal(r.presignedUrls.length, 3);
    assert.equal(r.partSize, 20 * 1024 * 1024);
    assert.ok(r.completionUrl.includes("complete_multipart"));
  } finally {
    globalThis.fetch = original;
  }
});

test("HF 回 basic：退化為單片", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => lfsResponse({ href: "https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/x?X-Amz-Expires=900" });
  try {
    const r = await makeDriver().generateMultipartUploadUrls("share/a.bin", { fileSize: 1, sha256: OID });
    assert.equal(r.mode, "basic");
    assert.equal(r.presignedUrls.length, 1);
    assert.equal(r.completionUrl, null);
    assert.equal(r.partSize, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("completionUrl 只接受 HF 網域", async () => {
  const d = makeDriver();
  await assert.rejects(
    d.completeMultipartUploadUrls("k", { sha256: OID, completionUrl: "https://evil.example.com/x", parts: [{ partNumber: 1, etag: "e" }] }),
    /不是 HuggingFace 網域/,
  );
  const original = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, init) => {
    posted = { url, body: JSON.parse(init.body) };
    return new Response("{}", { status: 200 });
  };
  try {
    await d.completeMultipartUploadUrls("k", {
      sha256: OID,
      completionUrl: "https://huggingface.co/api/complete_multipart?uploadId=U",
      parts: [{ PartNumber: 2, ETag: '"b"' }, { partNumber: 1, etag: '"a"' }],
    });
    assert.equal(posted.body.oid, OID);
    assert.deepEqual(posted.body.parts.map((p) => p.partNumber), [1, 2]);
  } finally {
    globalThis.fetch = original;
  }
});
