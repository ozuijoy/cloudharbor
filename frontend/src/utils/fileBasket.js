import { formatNowForFilename, formatLocalDateTimeWithSeconds } from "@/utils/timeUtils.js";

/**
 * 檔案籃工具函式
 * 提供檔案籃相關的純函式工具
 */

/**
 * 驗證檔案是否可以新增到籃子
 * @param {Object} file - 檔案物件
 * @returns {Object} 驗證結果
 */
export function validateFileForBasket(file) {
  if (!file) {
    return {
      valid: false,
      reason: "FILE_NOT_EXISTS",
    };
  }

  if (file.isDirectory) {
    return {
      valid: false,
      reason: "IS_DIRECTORY",
    };
  }

  if (!file.name || !file.path) {
    return {
      valid: false,
      reason: "MISSING_REQUIRED_FIELDS",
    };
  }

  return {
    valid: true,
    reason: null,
  };
}

/**
 * 批次驗證檔案列表
 * @param {Array} files - 檔案列表
 * @returns {Object} 驗證結果
 */
export function validateFilesForBasket(files) {
  if (!Array.isArray(files)) {
    return {
      validFiles: [],
      invalidFiles: [],
      totalCount: 0,
      validCount: 0,
    };
  }

  const validFiles = [];
  const invalidFiles = [];

  files.forEach((file) => {
    const validation = validateFileForBasket(file);
    if (validation.valid) {
      validFiles.push(file);
    } else {
      invalidFiles.push({
        file,
        reason: validation.reason,
      });
    }
  });

  return {
    validFiles,
    invalidFiles,
    totalCount: files.length,
    validCount: validFiles.length,
  };
}

/**
 * 生成檔案的唯一標識
 * @param {Object} file - 檔案物件
 * @param {string} sourceDirectory - 來源目錄
 * @returns {string} 唯一標識
 */
export function generateFileUniqueId(file, sourceDirectory) {
  return `${sourceDirectory}::${file.path}`;
}

/**
 * 計算檔案列表的總大小
 * @param {Array} files - 檔案列表
 * @returns {number} 總大小（位元組）
 */
export function calculateTotalSize(files) {
  if (!Array.isArray(files)) return 0;

  return files.reduce((total, file) => {
    return total + (file.size || 0);
  }, 0);
}

/**
 * 格式化檔案大小顯示
 * @param {number} bytes - 位元組數
 * @returns {string} 格式化後的大小
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 按目錄分組檔案
 * @param {Array} files - 檔案列表
 * @returns {Object} 按目錄分組的檔案
 */
export function groupFilesByDirectory(files) {
  if (!Array.isArray(files)) return {};

  const groups = {};

  files.forEach((file) => {
    const directory = file.sourceDirectory || "/";
    if (!groups[directory]) {
      groups[directory] = [];
    }
    groups[directory].push(file);
  });

  return groups;
}

/**
 * 生成ZIP檔名
 * @param {Object} options - 選項
 * @param {number} options.fileCount - 檔案數量
 * @param {number} options.directoryCount - 目錄數量
 * @param {string} options.prefix - 字首
 * @returns {string} ZIP檔名
 */
export function generateZipFileName(options = {}) {
  const { fileCount = 0, directoryCount = 0, prefix = "CloudHarbor" } = options;

  const timestamp = formatNowForFilename();

  if (directoryCount > 1) {
    return `${prefix}_CrossDirectory_${fileCount}files_${directoryCount}dirs_${timestamp}.zip`;
  } else {
    return `${prefix}_${fileCount}files_${timestamp}.zip`;
  }
}

/**
 * 檢查檔案大小是否需要警告
 * @param {number} totalSizeBytes - 總大小（位元組）
 * @returns {Object|null} 警告資訊
 */
export function checkSizeWarning(totalSizeBytes) {
  const sizeMB = totalSizeBytes / (1024 * 1024);

  if (sizeMB > 500) {
    return {
      level: "danger",
      sizeMB: Math.round(sizeMB * 100) / 100,
      message: `檔案總大小約 ${Math.round(sizeMB)}MB，打包可能需要較長時間且消耗較多記憶體`,
    };
  } else if (sizeMB > 100) {
    return {
      level: "warning",
      sizeMB: Math.round(sizeMB * 100) / 100,
      message: `檔案總大小約 ${Math.round(sizeMB)}MB，打包可能需要一些時間`,
    };
  }

  return null;
}

/**
 * 建立錯誤報告內容
 * @param {Array} failedFiles - 失敗的檔案列表
 * @param {Object} options - 選項
 * @returns {string} 錯誤報告內容
 */
export function createErrorReport(failedFiles, options = {}) {
  const { title = "下載失敗檔案列表", includeTimestamp = true } = options;

  const lines = [title];

  if (includeTimestamp) {
    lines.push(`生成時間: ${formatLocalDateTimeWithSeconds(new Date())}`);
  }

  lines.push("");

  if (failedFiles.length === 0) {
    lines.push("所有檔案下載成功！");
  } else {
    lines.push(`共 ${failedFiles.length} 個檔案下載失敗:`);
    lines.push("");

    failedFiles.forEach(({ fileName, path, error }, index) => {
      lines.push(`${index + 1}. ${path} (${fileName})`);
      lines.push(`   錯誤: ${error}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}

/**
 * 處理檔名衝突
 * @param {string} originalPath - 原始路徑
 * @param {Set} existingPaths - 已存在的路徑集合
 * @returns {string} 處理後的路徑
 */
export function resolvePathConflict(originalPath, existingPaths) {
  if (!existingPaths.has(originalPath)) {
    return originalPath;
  }

  const lastDotIndex = originalPath.lastIndexOf(".");
  let baseName, extension;

  if (lastDotIndex > 0) {
    baseName = originalPath.substring(0, lastDotIndex);
    extension = originalPath.substring(lastDotIndex);
  } else {
    baseName = originalPath;
    extension = "";
  }

  let counter = 1;
  let newPath;

  do {
    newPath = `${baseName}_${counter}${extension}`;
    counter++;
  } while (existingPaths.has(newPath));

  return newPath;
}

/**
 * 清理目錄路徑用於ZIP
 * @param {string} directoryPath - 目錄路徑
 * @returns {string} 清理後的路徑
 */
export function sanitizeDirectoryForZip(directoryPath) {
  if (!directoryPath || directoryPath === "/") {
    return "root";
  }

  return directoryPath
    .replace(/^\/+/, "") // 移除開頭的斜槓
    .replace(/\/+$/, "") // 移除結尾的斜槓
    .replace(/\/+/g, "_") // 將斜槓替換為下劃線
    .replace(/[<>:"|?*]/g, "_"); // 替換Windows不支援的字元
}

/**
 * 驗證檔案籃狀態
 * @param {Object} basketState - 檔案籃狀態
 * @returns {Object} 驗證結果
 */
export function validateBasketState(basketState) {
  const errors = [];

  if (!basketState) {
    errors.push("檔案籃狀態為空");
    return { valid: false, errors };
  }

  if (!Array.isArray(basketState.collectedFiles)) {
    errors.push("收集的檔案列表格式錯誤");
  }

  if (Array.isArray(basketState.collectedFiles) && basketState.collectedFiles.length === 0) {
    errors.push("檔案籃為空");
  }

  // 檢查檔案物件的完整性
  if (Array.isArray(basketState.collectedFiles)) {
    basketState.collectedFiles.forEach((file, index) => {
      if (!file.path) {
        errors.push(`檔案 ${index + 1} 缺少路徑資訊`);
      }
      if (!file.name) {
        errors.push(`檔案 ${index + 1} 缺少名稱資訊`);
      }
      if (!file.sourceDirectory) {
        errors.push(`檔案 ${index + 1} 缺少來源目錄資訊`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 建立任務摘要
 * @param {Object} taskResult - 任務結果
 * @returns {string} 任務摘要
 */
export function createTaskSummary(taskResult) {
  const { totalFiles = 0, successCount = 0, failedCount = 0, zipFileName = "", startTime, endTime } = taskResult;

  const lines = [];

  lines.push("=== 跨目錄打包下載任務摘要 ===");
  lines.push("");
  lines.push(`總檔案數: ${totalFiles}`);
  lines.push(`成功下載: ${successCount}`);
  lines.push(`下載失敗: ${failedCount}`);
  lines.push(`成功率: ${totalFiles > 0 ? Math.round((successCount / totalFiles) * 100) : 0}%`);

  if (zipFileName) {
    lines.push(`生成檔案: ${zipFileName}`);
  }

  if (startTime && endTime) {
    const duration = Math.round((new Date(endTime) - new Date(startTime)) / 1000);
    lines.push(`耗時: ${duration} 秒`);
  }

  lines.push("");
  lines.push(`完成時間: ${formatLocalDateTimeWithSeconds(new Date())}`);

  return lines.join("\n");
}
