/**
 * OneDriveTester
 *
 * OneDrive 儲存配置連線測試器
 * - 驗證 OAuth 憑據有效性
 * - 驗證 Graph API 訪問許可權
 * - 驗證根目錄可訪問性
 */

import { OneDriveAuthManager } from "../auth/OneDriveAuthManager.js";
import { OneDriveGraphClient } from "../client/OneDriveGraphClient.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

/**
 * 測試 OneDrive 儲存配置連線
 * @param {Object} config 儲存配置
 * @returns {Promise<{success: boolean, message: string, result: { read: Object, write: Object, info: Object }}>}
 */
export async function oneDriveTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const startedAt = Date.now();
  try {
    const region = config.region || "global";
    const rawDefaultFolder = config.default_folder || "";
    const defaultFolder = rawDefaultFolder.toString().replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    const basePrefix = defaultFolder ? `/${defaultFolder}` : "/";
    const remoteBase = defaultFolder ? defaultFolder : "";

    const info = {
      region,
      defaultFolder: defaultFolder || "(根目錄)",
      driveName: null,
      driveType: null,
      quota: null,
      responseTimeMs: null,
      useOnlineApi: config?.use_online_api === 1,
      tokenRenewEndpoint: config.token_renew_endpoint || null,
    };
    const checks = [];

    // secret 欄位可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
    const clientSecretRaw = await decryptIfNeeded(config.client_secret, encryptionSecret);
    const refreshTokenRaw = await decryptIfNeeded(config.refresh_token, encryptionSecret);
    const clientSecret = typeof clientSecretRaw === "string" ? clientSecretRaw : config.client_secret;
    const refreshToken = typeof refreshTokenRaw === "string" ? refreshTokenRaw : config.refresh_token;

    // 1) 配置檢查（保持與 OneDriveAuthManager / StorageFactory._validateOneDriveConfig 一致）
    if (!config.redirect_uri) {
      checks.push({ key: "config", label: "配置檢查", success: false, error: "配置缺少 redirect_uri" });
      return { success: false, message: "OneDrive 配置檢查失敗", result: { info, checks } };
    }
    if (!refreshToken) {
      checks.push({ key: "config", label: "配置檢查", success: false, error: "配置缺少 refresh_token" });
      return { success: false, message: "OneDrive 配置檢查失敗", result: { info, checks } };
    }
    if (config?.use_online_api === 1 && !config.token_renew_endpoint) {
      checks.push({
        key: "config",
        label: "配置檢查",
        success: false,
        error: "啟用 use_online_api 時必須配置 token_renew_endpoint",
      });
      return { success: false, message: "OneDrive 配置檢查失敗", result: { info, checks } };
    }
    if (config?.use_online_api !== 1 && !config.client_id) {
      checks.push({
        key: "config",
        label: "配置檢查",
        success: false,
        error: "配置缺少 client_id（未啟用 use_online_api 時必填）",
      });
      return { success: false, message: "OneDrive 配置檢查失敗", result: { info, checks } };
    }
    checks.push({ key: "config", label: "配置檢查", success: true });

    // 2) OAuth 認證
    const authManager = new OneDriveAuthManager({
      region,
      clientId: config.client_id,
      clientSecret,
      refreshToken,
      tokenRenewEndpoint: config.token_renew_endpoint,
      redirectUri: config.redirect_uri,
      useOnlineApi: config?.use_online_api === 1,
    });
    try {
      await authManager.getAccessToken();
      checks.push({ key: "oauth", label: "OAuth 認證", success: true });
    } catch (error) {
      checks.push({ key: "oauth", label: "OAuth 認證", success: false, error: error?.message || String(error) });
      return { success: false, message: `OAuth 認證失敗: ${error.message}`, result: { info, checks } };
    }

    // 3) Graph API 讀寫
    const graphClient = new OneDriveGraphClient({ region, authManager });

    const readState = { success: false, error: null, objectCount: 0, firstObjects: [] };
    try {
      const children = await graphClient.listChildren(remoteBase);
      const items = Array.isArray(children) ? children : [];
      readState.success = true;
      readState.objectCount = items.length;
      readState.firstObjects = items.slice(0, 3).map((item) => ({
        key: item.name || "",
        size: typeof item.size === "number" ? item.size : 0,
        lastModified: item.lastModifiedDateTime
          ? new Date(item.lastModifiedDateTime).toISOString()
          : new Date().toISOString(),
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
        { key: "prefix", label: "目錄字首", value: basePrefix },
        { key: "objectCount", label: "物件數量", value: readState.objectCount },
        ...(Array.isArray(readState.firstObjects) && readState.firstObjects.length
          ? [{ key: "sample", label: "示例物件", value: readState.firstObjects }]
          : []),
      ],
    });

    const writeState = { success: false, error: null, testFile: null, uploadTimeMs: 0, cleaned: false, cleanupError: null };
    const testFileName = `__onedrive_test_${Date.now()}.txt`;
    writeState.testFile = defaultFolder ? `${defaultFolder}/${testFileName}` : testFileName;
    try {
      const writeStart = Date.now();
      const remoteTestPath = remoteBase ? `${remoteBase}/${testFileName}` : testFileName;
      await graphClient.uploadSmall(remoteTestPath, "cloudharbor onedrive connectivity test", { contentType: "text/plain" });
      writeState.uploadTimeMs = Date.now() - writeStart;
      writeState.success = true;
      try {
        await graphClient.deleteItem(remoteTestPath);
        writeState.cleaned = true;
      } catch (cleanupError) {
        writeState.cleaned = false;
        writeState.cleanupError = cleanupError?.message || String(cleanupError);
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
      note: "透過 Graph API 進行小檔案寫入測試",
      items: [
        { key: "testFile", label: "測試檔案", value: writeState.testFile },
        { key: "uploadTimeMs", label: "上傳耗時(ms)", value: writeState.uploadTimeMs },
        { key: "cleaned", label: "已清理", value: writeState.cleaned === true },
        ...(writeState.cleanupError ? [{ key: "cleanupError", label: "清理錯誤", value: writeState.cleanupError }] : []),
      ],
    });

    // 4) 額外資訊：根驅動器/配額（失敗不影響主流程）
    if (config?.enable_disk_usage === 1) {
      try {
        // driveItem(root) 並不一定包含 quota；quota 屬於 Drive 資源（/me/drive）
        const drive = await graphClient.getDrive();
        if (drive) {
          info.driveName = drive.name || "OneDrive";
          info.driveType = drive.driveType || "personal";
          info.quota = drive.quota
            ? {
                total: drive.quota.total ?? null,
                used: drive.quota.used ?? null,
                remaining: drive.quota.remaining ?? null,
                deleted: drive.quota.deleted ?? null,
                state: drive.quota.state ?? null,
              }
            : null;
        }
      } catch (error) {
        info.error = error?.message || String(error);
      }
    } else {
      info.quota = null;
    }

    info.responseTimeMs = Date.now() - startedAt;

    const overallSuccess = readState.success === true && writeState.success === true;
    let message = "OneDrive 配置測試";
    if (readState.success === true) {
      message += writeState.success === true ? "成功 (讀寫許可權均可用)" : "部分成功 (僅讀許可權可用)";
    } else {
      message += "失敗 (讀取許可權不可用)";
    }

    return { success: overallSuccess, message, result: { info, checks } };
  } catch (error) {
    const msg = error?.message || String(error);
    return {
      success: false,
      message: `連線測試失敗: ${msg}`,
      result: { info: { error: msg, responseTimeMs: Date.now() - startedAt }, checks: [{ key: "error", label: "測試執行", success: false, error: msg }] },
    };
  }
}
