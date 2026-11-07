import { ValidationError } from "../../../http/errors.js";
import { decryptValue } from "../../../utils/crypto.js";
import { createClient } from "webdav";
import https from "https";

function normalizeEndpointUrlForClient(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("endpoint_url 不是合法的 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("endpoint_url 格式無效，必須以 http:// 或 https:// 開頭");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

const normalize = (p) => {
  const cleaned = (p || "").toString().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const parts = cleaned.split("/").filter(Boolean);
  for (const seg of parts) {
    if (seg === "..") {
      throw new ValidationError("default_folder 不允許包含 ..");
    }
  }
  return parts.join("/");
};

const buildPath = (base, sub = "") => {
  const prefix = normalize(base);
  const rel = normalize(sub);
  let combined = prefix;
  if (rel) {
    combined = combined ? `${combined}/${rel}` : rel;
  }
  return combined ? `/${combined}` : "/";
};

export async function webDavTestConnection(config, encryptionSecret) {
  const endpoint = normalizeEndpointUrlForClient(config.endpoint_url);
  if (!endpoint) {
    throw new ValidationError("缺少 endpoint_url");
  }
  const username = config.username;
  const encryptedPassword = config.password;
  const defaultFolder = config.default_folder || "";
  if (!username || !encryptedPassword) {
    throw new ValidationError("缺少 WebDAV 使用者名稱或密碼");
  }

  const password = await decryptValue(encryptedPassword, encryptionSecret);
  if (!password) {
    throw new ValidationError("無法解密 WebDAV 密碼");
  }

  const agent =
    endpoint.startsWith("https://") && config?.tls_insecure_skip_verify === 1
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
  const clientOptions = agent ? { httpsAgent: agent } : {};
  const client = createClient(endpoint, {
    username,
    password,
    ...clientOptions,
  });

  const state = {
    read: { success: false, error: null, prefix: null, objectCount: 0, firstObjects: [] },
    write: { success: false, error: null, testFile: null, uploadTime: 0, cleaned: false, cleanupError: null },
    info: {
      endpoint_url: endpoint,
      defaultFolder,
      tlsSkipVerify: config?.tls_insecure_skip_verify === 1,
      urlProxy: config.url_proxy || null,
      davCompliance: null,
      quota: null,
      davError: null,
      quotaError: null,
    },
  };

  const basePath = buildPath(defaultFolder);

  // 協議能力測試：DAV 合規資訊
  try {
    // 使用預設目錄路徑探測 DAV 能力（大部分服務對任意路徑返回一致的 DAV 頭）
    const dav = await client.getDAVCompliance(basePath);
    state.info.davCompliance = dav || null;
  } catch (error) {
    state.info.davError = error?.message || String(error);
  }

  // 配額資訊測試（部分服務可能不支援）
  if (config?.enable_disk_usage === 1) {
    try {
      // RFC 4331 的 quota 一般是對“collection（目錄）”返回；這裡優先對 defaultFolder 對應的 basePath 取
      // webdav 庫不同版本的 getQuota 簽名可能不同：有的支援傳 path，有的不支援；所以做一次相容嘗試
      let quotaRes;
      try {
        quotaRes = client.getQuota.length >= 1 ? await client.getQuota(basePath) : await client.getQuota();
      } catch {
        quotaRes = await client.getQuota();
      }
      const quotaData = quotaRes && typeof quotaRes === "object" && "data" in quotaRes ? quotaRes.data : quotaRes;
      if (!quotaData || typeof quotaData !== "object") {
        state.info.quota = null;
        state.info.quotaError = "WebDAV 伺服器未返回配額資訊（可能不支援 RFC 4331 quota 屬性）";
      } else {
        const used = typeof quotaData.used === "number" ? quotaData.used : null;
        const available = typeof quotaData.available === "number" ? quotaData.available : null;
        if (used == null && available == null) {
          state.info.quota = null;
          state.info.quotaError = "WebDAV 伺服器未提供 quota-used-bytes / quota-available-bytes（可能未實現配額）";
        } else {
          state.info.quota = { used, available };
        }
      }
    } catch (error) {
      state.info.quotaError = error?.message || String(error);
    }
  } else {
    state.info.quota = null;
    state.info.quotaError = "磁碟佔用統計未啟用（enable_disk_usage = false）";
  }

  // 讀測試：列根目錄
  try {
    const dirRes = await client.getDirectoryContents(basePath, { deep: false, glob: "*" });
    const entries =
      Array.isArray(dirRes) && dirRes
        ? dirRes
        : dirRes && typeof dirRes === "object" && "data" in dirRes
        ? dirRes.data
        : [];

    state.read.success = true;
    state.read.prefix = basePath;
    state.read.objectCount = entries.length;

    if (entries.length > 0) {
      state.read.firstObjects = entries.slice(0, 3).map((item) => {
        const name = item.basename || item.filename || "";
        const size = typeof item.size === "number" ? item.size : 0;
        const lastModified = item.lastmod ? new Date(item.lastmod).toISOString() : null;
        return {
          key: name,
          size,
          lastModified,
        };
      });
    }
  } catch (error) {
    state.read.success = false;
    state.read.error = error?.message || String(error);
  }

  // 寫測試：上傳/刪除臨時小檔案
  const testFile = `${basePath.endsWith("/") ? basePath : basePath + "/"}__webdav_test_${Date.now()}.txt`;
  state.write.testFile = testFile;
  try {
    const startTime = Date.now();
    await client.putFileContents(testFile, "cloudharbor webdav connectivity test", { overwrite: true });
    state.write.success = true;
    state.write.uploadTime = Date.now() - startTime;
    // 清理
    try {
      await client.deleteFile(testFile);
      state.write.cleaned = true;
    } catch (cleanupError) {
      state.write.cleaned = false;
      state.write.cleanupError = cleanupError?.message || String(cleanupError);
    }
  } catch (error) {
    state.write.success = false;
    state.write.error = error?.message || String(error);
  }

  // 彙總整體狀態與訊息（與 S3Tester 結構對齊）
  const basicConnectSuccess = state.read.success;
  const writeSuccess = state.write.success;

  const overallSuccess = basicConnectSuccess && writeSuccess;
  let message = "WebDAV 配置測試";

  if (basicConnectSuccess) {
    if (writeSuccess) {
      message += "成功 (讀寫許可權均可用)";
    } else {
      message += "部分成功 (僅讀許可權可用)";
    }
  } else {
    message += "失敗 (讀取許可權不可用)";
  }

  const checks = [
    {
      key: "read",
      label: "讀許可權",
      success: basicConnectSuccess === true,
      ...(state.read.error ? { error: state.read.error } : {}),
      items: [
        { key: "prefix", label: "目錄字首", value: state.read.prefix || basePath },
        { key: "objectCount", label: "物件數量", value: state.read.objectCount },
        ...(Array.isArray(state.read.firstObjects) && state.read.firstObjects.length
          ? [{ key: "sample", label: "示例物件", value: state.read.firstObjects }]
          : []),
      ],
    },
    {
      key: "write",
      label: "寫許可權",
      success: writeSuccess === true,
      ...(state.write.error ? { error: state.write.error } : {}),
      items: [
        { key: "testFile", label: "測試檔案", value: state.write.testFile },
        { key: "uploadTime", label: "上傳耗時(ms)", value: state.write.uploadTime },
        { key: "cleaned", label: "已清理", value: state.write.cleaned === true },
        ...(state.write.cleanupError ? [{ key: "cleanupError", label: "清理錯誤", value: state.write.cleanupError }] : []),
      ],
    },
  ];

  return { success: overallSuccess, message, result: { info: state.info, checks } };
}
