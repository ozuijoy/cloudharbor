/**
 * Google Drive 驅動 tester
 *
 * 職責：
 * - 驗證當前配置下是否能成功獲取 access_token
 * - 驗證 root_id 目錄是否可以正常列舉（基本讀許可權）
 * - 透過建立/刪除臨時目錄驗證寫許可權（與 OneDrive/WebDAV tester 風格對齊）
 *
 * 注意：
 * - 寫測試僅建立一個臨時空目錄，隨後立即刪除，儘量減少對使用者盤的影響
 * - 不對配置做額外必填約束，後端校驗仍由 StorageFactory._validateGoogleDriveConfig 負責
 */

import { GoogleDriveAuthManager } from "../GoogleDriveAuthManager.js";
import { GoogleDriveApiClient } from "../GoogleDriveApiClient.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

/**
 * @param {Object} config 儲存配置
 * @param {string} encryptionSecret 加密金鑰（當前未使用，預留與其他 tester 一致的簽名）
 * @param {string|null} requestOrigin 請求來源 Origin（當前未使用）
 */
export async function googleDriveTestConnection(config, encryptionSecret, requestOrigin = null) {
  const startedAt = Date.now();
  const rootId = config.root_id || "root";
  const useOnlineApi = config?.use_online_api === 1;
  const enableDiskUsage = config?.enable_disk_usage === 1;

  // secret 欄位可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
  const clientSecretRaw = await decryptIfNeeded(config.client_secret, encryptionSecret);
  const refreshTokenRaw = await decryptIfNeeded(config.refresh_token, encryptionSecret);
  const clientSecret = typeof clientSecretRaw === "string" ? clientSecretRaw : config.client_secret;
  const refreshToken = typeof refreshTokenRaw === "string" ? refreshTokenRaw : config.refresh_token;

  const info = {
    rootId,
    region: "global",
    useOnlineApi,
    endpoint_url: useOnlineApi ? (config.endpoint_url || null) : "https://www.googleapis.com",
    quota: null,
    responseTimeMs: null,
  };
  const checks = [];

  // 1. 建立認證管理器並測試 access_token 獲取
  const authManager = new GoogleDriveAuthManager({
    useOnlineApi,
    apiAddress: config.endpoint_url,
    clientId: config.client_id,
    clientSecret,
    refreshToken,
    rootId,
    disableDiskUsage: !enableDiskUsage,
    logger: console,
  });

  try {
    await authManager.getAccessToken();
    checks.push({ key: "oauth", label: "OAuth 認證", success: true });
  } catch (error) {
    checks.push({ key: "oauth", label: "OAuth 認證", success: false, error: error?.message || String(error) });
    return {
      success: false,
      message: `OAuth 認證失敗: ${error.message}`,
      result: { info, checks },
    };
  }

  // 2. 使用 ApiClient 做一次根目錄 list 測試，驗證基本讀許可權
  const apiClient = new GoogleDriveApiClient({ authManager });

  const readState = { success: false, error: null, objectCount: 0, firstObjects: [] };
  try {
    const res = await apiClient.listFiles(rootId, { pageSize: 10 });
    const files = Array.isArray(res.files) ? res.files : [];
    readState.success = true;
    readState.objectCount = files.length;
    readState.firstObjects = files.slice(0, 3).map((item) => ({
      key: item.name || "",
      size: typeof item.size === "number" ? item.size : 0,
      lastModified: item.modifiedTime ? new Date(item.modifiedTime).toISOString() : new Date().toISOString(),
    }));
  } catch (error) {
    readState.success = false;
    readState.error = error?.message || String(error);
  }

  checks.push({
    key: "read",
    label: "讀許可權",
    success: readState.success === true,
    ...(readState.error ? { error: readState.error } : {}),
    items: [
      { key: "rootId", label: "Root ID", value: rootId },
      { key: "objectCount", label: "物件數量", value: readState.objectCount },
      ...(Array.isArray(readState.firstObjects) && readState.firstObjects.length
        ? [{ key: "sample", label: "示例物件", value: readState.firstObjects }]
        : []),
    ],
  });

  // 3. 寫測試：建立並刪除一個臨時資料夾，驗證寫許可權
  // 注意：使用資料夾測試是因為 GoogleDriveApiClient 沒有簡單的檔案上傳方法
  // 建立資料夾同樣需要寫許可權，效果等同於檔案上傳測試
  const writeState = {
    success: false,
    error: null,
    testFile: null,
    uploadTimeMs: 0,
    cleaned: false,
    cleanupError: null,
    note: "透過建立/刪除臨時資料夾進行寫許可權測試",
  };
  const testFolderName = `__gdrive_test_${Date.now()}`;
  writeState.testFile = testFolderName;
  try {
    const writeStart = Date.now();
    const folder = await apiClient.createFolder(rootId, testFolderName);
    writeState.uploadTimeMs = Date.now() - writeStart;
    
    if (folder && folder.id) {
      writeState.success = true;
      try {
        await apiClient.deleteFile(folder.id);
        writeState.cleaned = true;
      } catch (cleanupError) {
        writeState.cleaned = false;
        writeState.cleanupError = cleanupError?.message || String(cleanupError);
      }
    } else {
      writeState.success = false;
      writeState.error = "建立測試資料夾失敗：返回結果缺少 id";
    }
  } catch (error) {
    writeState.success = false;
    writeState.error = error?.message || String(error);
  }

  checks.push({
    key: "write",
    label: "寫許可權",
    success: writeState.success === true,
    ...(writeState.error ? { error: writeState.error } : {}),
    ...(writeState.note ? { note: writeState.note } : {}),
    items: [
      { key: "testFile", label: "測試檔案", value: writeState.testFile },
      { key: "uploadTimeMs", label: "上傳耗時(ms)", value: writeState.uploadTimeMs },
      { key: "cleaned", label: "已清理", value: writeState.cleaned === true },
      ...(writeState.cleanupError ? [{ key: "cleanupError", label: "清理錯誤", value: writeState.cleanupError }] : []),
    ],
  });

  // 4. 可選：獲取配額資訊，豐富 info（對齊 WebDAV 前端顯示欄位）
  try {
    const quota = await apiClient.getQuota();
    if (quota && typeof quota === "object") {
      info.quota = {
        total: quota.limit ?? null,
        used: quota.usage ?? null,
        available: quota.limit != null && quota.usage != null ? quota.limit - quota.usage : null, // 前端期望 available 欄位
      };
    }
  } catch {
    // 配額獲取失敗不影響整體測試結果，靜默忽略或按需記錄
  }

  // 5. 端點地址資訊（前端顯示需要）
  if (config.use_online_api && config.endpoint_url) info.endpoint_url = config.endpoint_url;
  else info.endpoint_url = "https://www.googleapis.com";

  // 6. 彙總整體狀態與訊息（對齊 OneDrive/WebDAV tester 的語義）
  info.responseTimeMs = Date.now() - startedAt;
  const basicConnectSuccess = readState.success === true;
  const writeSuccess = writeState.success === true;
  const overallSuccess = basicConnectSuccess && writeSuccess;

  let message = "Google Drive 配置測試";
  if (basicConnectSuccess) {
    if (writeSuccess) {
      message += "成功 (讀寫許可權均可用)";
    } else {
      message += "部分成功 (僅讀許可權可用)";
    }
  } else {
    message += "失敗 (讀取根目錄失敗)";
  }

  return {
    success: overallSuccess,
    message,
    result: { info, checks },
  };
}
