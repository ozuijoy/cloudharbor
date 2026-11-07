/**
 * S3 驅動側 tester：統一承載 S3/R2/B2/AWS 等 S3 相容儲存的連通性與前端可用性測試
 * - 讀許可權（ListObjectsV2）
 * - 寫許可權（PutObject + DeleteObject，可按提供商跳過）
 * - CORS 預檢（OPTIONS 到預簽名 PUT）
 * - 前端模擬直傳（預簽名 PUT → HEAD 驗證 → 清理）
 */
import { createS3Client } from "../utils/s3Utils.js";
import {
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3ProviderTypes } from "../../../../constants/index.js";
import { formatFileSize } from "../../../../utils/common.js";

const buildPrefix = (defaultFolder) => {
  const df = defaultFolder || "";
  if (!df) return "";
  return df.endsWith("/") ? df : df + "/";
};

const getCorsHeaders = (provider, origin) => {
  const baseHeaders = ["content-type", "x-amz-content-sha256", "x-amz-date", "authorization"];
  if (provider === S3ProviderTypes.B2) {
    baseHeaders.push("x-bz-content-sha1", "x-requested-with");
  }
  const headers = {
    Origin: origin || "https://example.com",
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": baseHeaders.join(","),
  };
  return headers;
};

const getUploadHeaders = (provider, origin, contentType) => {
  const headers = { "Content-Type": contentType || "text/plain" };
  if (origin) headers["Origin"] = origin;
  if (provider === S3ProviderTypes.B2) {
    headers["X-Bz-Content-Sha1"] = "do_not_verify";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  return headers;
};

const shouldSkipWriteTest = (provider) => provider === S3ProviderTypes.B2;

async function collectLifecycleInfo(client, bucket) {
  try {
    const resp = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    const rules = resp?.Rules || [];
    if (!rules.length) {
      return { supported: true, hasRules: false };
    }
    const summary = rules.map((rule) => ({
      id: rule.ID || null,
      status: rule.Status || "UNKNOWN",
      filter: rule.Filter || null,
      transitions: rule.Transitions || [],
      expiration: rule.Expiration || null,
    }));
    return { supported: true, hasRules: true, rules: summary };
  } catch (error) {
    const code = error?.name || error?.Code;
    if (code === "NoSuchLifecycleConfiguration") {
      return { supported: true, hasRules: false };
    }
    return { supported: false, error: error?.message || String(error) };
  }
}

export async function s3TestConnection(config, encryptionSecret, requestOrigin = null) {
  const client = await createS3Client(config, encryptionSecret);
  const prefix = buildPrefix(config.default_folder);
  const provider = config.provider_type;
  const expiresIn = config.signature_expires_in || 300;

  const result = {
    read: { success: false, error: null, note: "後端直接測試，不代表前端訪問" },
    write: { success: false, error: null, note: "後端直接測試，不代表前端上傳" },
    cors: { success: false, error: null, note: "CORS 預檢僅作診斷，仍以前端實際結果為準" },
    frontendSim: { success: false, error: null, note: "預簽名 PUT 鏈路測試（由後端模擬）" },
    connectionInfo: {
      bucket: config.bucket_name,
      endpoint_url: config.endpoint_url || "預設",
      region: config.region || "預設",
      pathStyle: config.path_style ? "是" : "否",
      provider: provider,
      defaultFolder: config.default_folder || "",
      customHost: config.custom_host || "未配置",
      signatureExpiresIn: `${expiresIn}秒`,
    },
    diagnostics: {
      lifecycle: null,
    },
  };

  // 1) 讀許可權（ListObjectsV2）
  try {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket_name, MaxKeys: 10, Prefix: prefix || undefined })
    );
    result.read.success = true;
    result.read.prefix = prefix || "";
    result.read.objectCount = list.Contents?.length || 0;
    if (list.Contents && list.Contents.length > 0) {
      result.read.firstObjects = list.Contents.slice(0, 3).map((o) => ({
        key: o.Key,
        size: formatFileSize(o.Size),
        lastModified: new Date(o.LastModified).toISOString(),
      }));
    }
  } catch (e) {
    result.read.success = false;
    result.read.error = e?.message || String(e);
  }

  // 2) 寫許可權（可選：B2 預設跳過）
  const writeKey = `${prefix}__write_test_${Date.now()}.txt`;
  const writeBody = new TextEncoder().encode("cloudharbor write test");
  if (shouldSkipWriteTest(provider)) {
    result.write = {
      success: true,
      note: "根據提供商特性（B2），跳過後端寫入測試（不代表無法上傳）",
      uploadTime: 0,
      testFile: "(skipped)",
    };
  } else {
    try {
      const t0 = performance.now();
      await client.send(new PutObjectCommand({ Bucket: config.bucket_name, Key: writeKey, Body: writeBody, ContentType: "text/plain" }));
      const t1 = performance.now();
      result.write.success = true;
      result.write.uploadTime = Math.round(t1 - t0);
      result.write.testFile = writeKey;
      // 清理
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket_name, Key: writeKey }));
        result.write.cleaned = true;
      } catch (cleanupErr) {
        result.write.cleaned = false;
        result.write.cleanupError = cleanupErr?.message || String(cleanupErr);
      }
    } catch (e) {
      result.write.success = false;
      result.write.error = e?.message || String(e);
    }
  }

  // 3) CORS 預檢（OPTIONS 到預簽名 PUT）
  try {
    const probeKey = `${prefix}__cors_probe_${Date.now()}.txt`;
    const presigned = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: config.bucket_name, Key: probeKey, ContentType: "text/plain" }),
      { expiresIn }
    );
    const corsHeaders = getCorsHeaders(provider, requestOrigin);
    const resp = await fetch(presigned, { method: "OPTIONS", headers: corsHeaders }).catch(() => null);
    if (resp && (resp.ok || resp.status === 204 || resp.status === 200)) {
      const allowOrigin = resp.headers.get("Access-Control-Allow-Origin") || resp.headers.get("access-control-allow-origin");
      const allowMethods = resp.headers.get("Access-Control-Allow-Methods") || resp.headers.get("access-control-allow-methods");
      const allowHeaders = resp.headers.get("Access-Control-Allow-Headers") || resp.headers.get("access-control-allow-headers");
      const maxAge = resp.headers.get("Access-Control-Max-Age") || resp.headers.get("access-control-max-age");
      result.cors.success = Boolean(allowOrigin);
      result.cors.allowOrigin = allowOrigin || "";
      result.cors.allowMethods = allowMethods || "";
      result.cors.allowHeaders = allowHeaders || "";
      result.cors.maxAge = maxAge || "";
      result.cors.statusCode = resp.status;
      const allowedMethodsList = (allowMethods || "")
        .split(",")
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean);
      const supportsPut = allowedMethodsList.includes("PUT") || allowedMethodsList.includes("*");
      const supportsOrigin = !requestOrigin || allowOrigin === "*" || allowOrigin === requestOrigin;
      result.cors.uploadSupported = !!(supportsPut && supportsOrigin);
      result.cors.supportedNotes = result.cors.uploadSupported ? "" : "允許的方法或來源未覆蓋當前請求";
    } else {
      result.cors.success = false;
      result.cors.statusCode = resp?.status || 0;
      result.cors.error = "未返回有效的 CORS 預檢響應";
    }
  } catch (e) {
    result.cors.success = false;
    result.cors.error = `CORS 預檢失敗: ${e?.message || String(e)}`;
  }

  // 4) 前端模擬：簽名 PUT 上傳 + HEAD 驗證 + 清理
  try {
    const ts = Date.now();
    const simKey = `${prefix}frontend_test_${ts}.txt`;
    const contentType = "text/plain";
    const step = {
      step1: { name: "獲取預簽名URL", success: false, duration: 0 },
      step2: { name: "模擬檔案上傳", success: false, duration: 0 },
      step3: { name: "驗證上傳結果", success: false, duration: 0 },
    };
    result.frontendSim.steps = step;

    // step1
    const t1s = performance.now();
    const put = new PutObjectCommand({ Bucket: config.bucket_name, Key: simKey, ContentType: contentType, Metadata: { "test-provider": provider, "test-purpose": "cloudharbor-frontend-simulation", "test-timestamp": `${ts}` } });
    const presigned = await getSignedUrl(client, put, { expiresIn });
    const t1e = performance.now();
    step.step1.success = true;
    step.step1.duration = Math.round(t1e - t1s);
    step.step1.presignedUrl = presigned.substring(0, 80) + "...";

    // step2
    const t2s = performance.now();
    const uploadHeaders = getUploadHeaders(provider, requestOrigin, contentType);
    const body = new TextEncoder().encode(`CloudHarbor 前端模擬上傳 @ ${new Date().toISOString()}`);
    const uploadResp = await fetch(presigned, { method: "PUT", headers: uploadHeaders, body });
    const t2e = performance.now();
    if (uploadResp.ok) {
      step.step2.success = true;
      step.step2.duration = Math.round(t2e - t2s);
      step.step2.statusCode = uploadResp.status;
      step.step2.etag = (uploadResp.headers.get("ETag") || "").replace(/"/g, "") || null;
      step.step2.bytesUploaded = body.byteLength;
      const exposeHeaders =
        uploadResp.headers.get("Access-Control-Expose-Headers") ||
        uploadResp.headers.get("access-control-expose-headers");
      if (exposeHeaders) {
        result.cors.exposeHeaders = exposeHeaders;
      }
      if (step.step2.duration > 0) {
        const seconds = step.step2.duration / 1000;
        const bytesPerSecond = seconds > 0 ? body.byteLength / seconds : body.byteLength;
        step.step2.uploadSpeed = `${formatFileSize(bytesPerSecond)}/s`;
      } else {
        step.step2.uploadSpeed = `${formatFileSize(body.byteLength)}/s`;
      }
    } else {
      step.step2.success = false;
      step.step2.duration = Math.round(t2e - t2s);
      step.step2.statusCode = uploadResp.status;
      step.step2.statusText = uploadResp.statusText;
      throw new DriverError(`HTTP ${uploadResp.status}: ${uploadResp.statusText}`);
    }

    // step3
    const t3s = performance.now();
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket_name, Key: simKey }));
    const t3e = performance.now();
    step.step3.success = true;
    step.step3.duration = Math.round(t3e - t3s);
    step.step3.headResult = {
      contentLength: head?.ContentLength || 0,
      contentType: head?.ContentType || "",
      etag: head?.ETag || "",
    };
    step.step3.fileSize = head?.ContentLength || 0;
    step.step3.contentType = head?.ContentType || "";

    // 清理
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket_name, Key: simKey }));
      step.step3.fileCleaned = true;
    } catch (cleanupErr) {
      step.step3.fileCleaned = false;
      step.step3.cleanupError = cleanupErr?.message || String(cleanupErr);
    }

    result.frontendSim.success = true;
    result.frontendSim.totalDuration = step.step1.duration + step.step2.duration + step.step3.duration;
    result.frontendSim.testFile = simKey;
  } catch (e) {
    result.frontendSim.success = false;
    result.frontendSim.error = e?.message || String(e);
  }

  result.diagnostics.lifecycle = await collectLifecycleInfo(client, config.bucket_name);

  // 彙總訊息
  const basicConnectSuccess = result.read.success;
  const frontendUsable = result.cors.success && result.frontendSim.success;
  let overallSuccess = basicConnectSuccess && frontendUsable;
  let message = "S3配置測試";
  if (basicConnectSuccess) {
    if (result.write.success) {
      if (frontendUsable) {
        message += "成功 (讀寫許可權均可用，前端上傳測試透過)";
      } else if (result.cors.success) {
        message += "部分成功 (讀寫許可權可用，CORS配置正確，但前端上傳模擬失敗)";
      } else {
        message += "部分成功 (讀寫許可權可用，但CORS配置有問題)";
      }
    } else {
      if (result.cors.success) {
        message += "部分成功 (僅讀許可權可用，CORS配置正確)";
      } else {
        message += "部分成功 (僅讀許可權可用，CORS配置有問題)";
      }
    }
  } else {
    message += "失敗 (讀取許可權不可用)";
  }

  const info = {
    ...(result.connectionInfo || {}),
  };

  const checks = [
    {
      key: "read",
      label: "讀許可權",
      success: result.read.success === true,
      ...(result.read.error ? { error: result.read.error } : {}),
      ...(result.read.note ? { note: result.read.note } : {}),
      items: [
        { key: "prefix", label: "目錄字首", value: result.read.prefix || "" },
        { key: "objectCount", label: "物件數量", value: result.read.objectCount ?? 0 },
        ...(Array.isArray(result.read.firstObjects) && result.read.firstObjects.length
          ? [{ key: "sample", label: "示例物件", value: result.read.firstObjects }]
          : []),
      ],
    },
    {
      key: "write",
      label: "寫許可權",
      success: result.write.success === true,
      ...(result.write.error ? { error: result.write.error } : {}),
      ...(result.write.note ? { note: result.write.note } : {}),
      items: [
        ...(result.write.testFile ? [{ key: "testFile", label: "測試檔案", value: result.write.testFile }] : []),
        ...(typeof result.write.uploadTime === "number"
          ? [{ key: "uploadTimeMs", label: "上傳耗時(ms)", value: result.write.uploadTime }]
          : []),
        ...(typeof result.write.cleaned === "boolean"
          ? [{ key: "cleaned", label: "已清理", value: result.write.cleaned }]
          : []),
        ...(result.write.cleanupError ? [{ key: "cleanupError", label: "清理錯誤", value: result.write.cleanupError }] : []),
      ],
    },
    {
      key: "cors",
      label: "CORS 預檢",
      success: result.cors.success === true,
      ...(result.cors.error ? { error: result.cors.error } : {}),
      ...(result.cors.note ? { note: result.cors.note } : {}),
      items: [
        ...(result.cors.statusCode ? [{ key: "statusCode", label: "狀態碼", value: result.cors.statusCode }] : []),
        ...(result.cors.allowOrigin ? [{ key: "allowOrigin", label: "允許來源", value: result.cors.allowOrigin }] : []),
        ...(result.cors.allowMethods ? [{ key: "allowMethods", label: "允許方法", value: result.cors.allowMethods }] : []),
        ...(result.cors.allowHeaders ? [{ key: "allowHeaders", label: "允許頭部", value: result.cors.allowHeaders }] : []),
        ...(result.cors.maxAge ? [{ key: "maxAge", label: "快取時間", value: result.cors.maxAge }] : []),
        ...(Object.prototype.hasOwnProperty.call(result.cors, "uploadSupported")
          ? [{ key: "uploadSupported", label: "支援上傳", value: result.cors.uploadSupported === true }]
          : []),
        ...(result.cors.supportedNotes ? [{ key: "supportedNotes", label: "備註", value: result.cors.supportedNotes }] : []),
        ...(result.cors.exposeHeaders ? [{ key: "exposeHeaders", label: "暴露頭部", value: result.cors.exposeHeaders }] : []),
      ],
    },
    {
      key: "frontend_upload",
      label: "前端上傳模擬",
      success: result.frontendSim.success === true,
      ...(result.frontendSim.error ? { error: result.frontendSim.error } : {}),
      ...(result.frontendSim.note ? { note: result.frontendSim.note } : {}),
      items: [
        ...(result.frontendSim.testFile ? [{ key: "testFile", label: "測試檔案", value: result.frontendSim.testFile }] : []),
        ...(typeof result.frontendSim.totalDuration === "number"
          ? [{ key: "totalDurationMs", label: "總耗時(ms)", value: result.frontendSim.totalDuration }]
          : []),
      ],
      ...(result.frontendSim.steps ? { details: { steps: result.frontendSim.steps } } : {}),
    },
  ];

  return { success: overallSuccess, message, result: { info, checks, diagnostics: result.diagnostics || null } };
}
import { DriverError } from "../../../../http/errors.js";
