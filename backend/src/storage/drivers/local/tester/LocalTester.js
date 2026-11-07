/**
 * LOCAL 驅動連線測試器
 * 測試專案：
 * 1. 路徑存在性檢查
 * 2. 路徑是否為目錄
 * 3. 讀許可權檢查
 * 4. 寫許可權檢查（非只讀模式）
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * 測試本地儲存連線
 * @param {object} config - 儲存配置
 * @param {string} config.root_path - 本地根目錄路徑
 * @param {boolean} [config.readonly] - 是否只讀模式
 * @returns {Promise<{success: boolean, message: string, result: object}>}
 */
export async function localTestConnection(config) {
  const steps = {
    pathExists: { success: false, error: null },
    isDirectory: { success: false, error: null },
    readPermission: { success: false, error: null },
    writePermission: { success: false, error: null, skipped: false, note: "" },
  };

  const info = {
    rootPath: config.root_path || "",
    readonly: config.readonly === true,
    normalizedPath: "",
  };

  const rootPath = config.root_path;

  // 驗證 root_path 配置
  if (!rootPath) {
    return {
      success: false,
      message: "root_path 配置缺失",
      result: {
        info,
        checks: [
          { key: "path", label: "路徑檢查", success: false, error: "root_path 配置缺失" },
          { key: "read", label: "讀許可權", success: false, error: "root_path 配置缺失" },
          { key: "write", label: "寫許可權", success: false, error: "root_path 配置缺失" },
        ],
      },
    };
  }

  // 規範化路徑
  const normalizedPath = path.resolve(rootPath);
  info.normalizedPath = normalizedPath;

  // 1. 路徑存在性檢查
  try {
    await fs.promises.access(normalizedPath, fs.constants.F_OK);
    steps.pathExists.success = true;
  } catch (err) {
    steps.pathExists.error = `路徑不存在: ${err.message}`;
    return {
      success: false,
      message: `路徑不存在: ${normalizedPath}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路徑檢查",
            success: false,
            error: steps.pathExists.error,
            items: [
              { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
              { key: "pathExists", label: "路徑存在", value: false },
            ],
          },
          { key: "read", label: "讀許可權", success: false, error: "路徑不存在" },
          { key: "write", label: "寫許可權", success: false, error: "路徑不存在" },
        ],
      },
    };
  }

  // 2. 路徑是否為目錄
  try {
    const stats = await fs.promises.stat(normalizedPath);
    if (stats.isDirectory()) {
      steps.isDirectory.success = true;
    } else {
      steps.isDirectory.error = "指定路徑不是目錄";
      return {
        success: false,
        message: `指定路徑不是目錄: ${normalizedPath}`,
        result: {
          info,
          checks: [
            {
              key: "path",
              label: "路徑檢查",
              success: false,
              error: steps.isDirectory.error,
              items: [
                { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
                { key: "pathExists", label: "路徑存在", value: true },
                { key: "isDirectory", label: "是目錄", value: false },
              ],
            },
            { key: "read", label: "讀許可權", success: false, error: "不是目錄" },
            { key: "write", label: "寫許可權", success: false, error: "不是目錄" },
          ],
        },
      };
    }
  } catch (err) {
    steps.isDirectory.error = `獲取路徑資訊失敗: ${err.message}`;
    return {
      success: false,
      message: `獲取路徑資訊失敗: ${err.message}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路徑檢查",
            success: false,
            error: steps.isDirectory.error,
            items: [
              { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
              { key: "pathExists", label: "路徑存在", value: true },
              { key: "isDirectory", label: "是目錄", value: false },
            ],
          },
          { key: "read", label: "讀許可權", success: false, error: "路徑資訊獲取失敗" },
          { key: "write", label: "寫許可權", success: false, error: "路徑資訊獲取失敗" },
        ],
      },
    };
  }

  // 3. 讀許可權檢查
  try {
    await fs.promises.access(normalizedPath, fs.constants.R_OK);
    // 嘗試實際讀取目錄內容
    await fs.promises.readdir(normalizedPath);
    steps.readPermission.success = true;
  } catch (err) {
    steps.readPermission.error = `讀取許可權不足: ${err.message}`;
    return {
      success: false,
      message: `讀取許可權不足: ${err.message}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路徑檢查",
            success: true,
            items: [
              { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
              { key: "pathExists", label: "路徑存在", value: true },
              { key: "isDirectory", label: "是目錄", value: true },
            ],
          },
          { key: "read", label: "讀許可權", success: false, error: steps.readPermission.error },
          { key: "write", label: "寫許可權", success: false, error: "讀許可權不足（未繼續寫測試）", skipped: true },
        ],
      },
    };
  }

  // 4. 寫許可權檢查（非只讀模式）
  if (config.readonly) {
    steps.writePermission.success = true;
    steps.writePermission.skipped = true;
    steps.writePermission.note = "只讀模式，跳過寫許可權測試";
  } else {
    const testFileName = `.cloudharbor_test_${randomUUID()}.tmp`;
    const testFilePath = path.join(normalizedPath, testFileName);

    try {
      // 檢查寫許可權
      await fs.promises.access(normalizedPath, fs.constants.W_OK);

      // 嘗試實際寫入測試檔案
      const testContent = `CloudHarbor connection test - ${new Date().toISOString()}`;
      await fs.promises.writeFile(testFilePath, testContent, "utf8");

      // 驗證檔案寫入成功
      const readBack = await fs.promises.readFile(testFilePath, "utf8");
      if (readBack !== testContent) {
        throw new Error("寫入驗證失敗：讀取內容與寫入內容不匹配");
      }

      // 清理測試檔案
      await fs.promises.unlink(testFilePath);

      steps.writePermission.success = true;
    } catch (err) {
      steps.writePermission.error = `寫入許可權不足: ${err.message}`;

      // 嘗試清理可能殘留的測試檔案
      try {
        await fs.promises.unlink(testFilePath);
      } catch {
        // 忽略清理錯誤
      }

      return {
        success: false,
        message: `寫入許可權不足: ${err.message}`,
        result: {
          info,
          checks: [
            {
              key: "path",
              label: "路徑檢查",
              success: true,
              items: [
                { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
                { key: "pathExists", label: "路徑存在", value: true },
                { key: "isDirectory", label: "是目錄", value: true },
              ],
            },
            { key: "read", label: "讀許可權", success: steps.readPermission.success === true },
            { key: "write", label: "寫許可權", success: false, error: steps.writePermission.error },
          ],
        },
      };
    }
  }

  // 所有測試透過
  const successMessage = config.readonly
    ? "本地儲存連線測試成功（只讀模式）"
    : "本地儲存連線測試成功";

  return {
    success: true,
    message: successMessage,
    result: {
      info,
      checks: [
        {
          key: "path",
          label: "路徑檢查",
          success: true,
          items: [
            { key: "normalizedPath", label: "規範化路徑", value: normalizedPath },
            { key: "pathExists", label: "路徑存在", value: true },
            { key: "isDirectory", label: "是目錄", value: true },
          ],
        },
        { key: "read", label: "讀許可權", success: steps.readPermission.success === true },
        {
          key: "write",
          label: "寫許可權",
          success: steps.writePermission.success === true,
          ...(steps.writePermission.skipped ? { skipped: true } : {}),
          ...(steps.writePermission.note ? { note: steps.writePermission.note } : {}),
        },
      ],
    },
  };
}
