import { useI18n } from "vue-i18n";
import { createLogger } from "@/utils/logger.js";

/**
 * Share 上傳領域服務
 *
 * - 基於表單資料構造上傳 payload
 * - 解析/歸類上傳錯誤
 * - 根據整體結果生成統一的提示資訊
 *
 * 不直接依賴具體 UI，只返回結構化結果或已翻譯好的文案。
 */
export function useShareUploadDomain() {
  const { t } = useI18n();
  const log = createLogger("ShareUploadDomain");

  const buildPayloadForFile = (formData, slugOverride = "") => ({
    storage_config_id: formData.storage_config_id,
    slug: slugOverride || formData.slug || "",
    path: formData.path || "",
    remark: formData.remark || "",
    password: formData.password || "",
    expires_in: formData.expires_in || "0",
    max_views: Math.max(0, Number(formData.max_views) || 0),
  });

  const processInsufficientStorageError = (errorMessage) => {
    const isInsufficientStorage =
      errorMessage.includes("儲存空間不足") ||
      errorMessage.includes("insufficient storage") ||
      errorMessage.includes("超過剩餘空間") ||
      errorMessage.includes("exceeds") ||
      (errorMessage.includes("storage") &&
        (errorMessage.includes("limit") || errorMessage.includes("full") || errorMessage.includes("quota")));

    if (!isInsufficientStorage) {
      return errorMessage;
    }

    try {
      const fileSizeMatch = errorMessage.match(/檔案大小\((.*?)\)|file size\((.*?)\)/i);
      const remainingSpaceMatch = errorMessage.match(/剩餘空間\((.*?)\)|remaining space\((.*?)\)/i);
      const totalCapacityMatch = errorMessage.match(/容量上限為(.*?)。|capacity limit is(.*?)\./i);

      const fileSize = fileSizeMatch ? fileSizeMatch[1] || fileSizeMatch[2] : "";
      const remainingSpace = remainingSpaceMatch ? remainingSpaceMatch[1] || remainingSpaceMatch[2] : "";
      const totalCapacity = totalCapacityMatch ? totalCapacityMatch[1] || totalCapacityMatch[2] : "";

      if (fileSize && remainingSpace && totalCapacity) {
        return t("file.insufficientStorageDetailed", {
          fileSize,
          remainingSpace,
          totalCapacity,
        });
      }
    } catch (error) {
      log.error("處理儲存空間不足錯誤資訊失敗", error);
    }

    return errorMessage;
  };

  const buildErrorDescriptor = (error) => {
    const raw = error?.message || t("common.unknownError");
    const isSlugConflict =
      (raw.includes("slug") &&
        (raw.includes("already exists") ||
          raw.includes("already taken") ||
          raw.includes("duplicate") ||
          raw.includes("conflict"))) ||
      raw.includes("連結字尾已被佔用") ||
      raw.includes("已存在");

    const isInsufficientStorage =
      raw.includes("儲存空間不足") ||
      raw.includes("insufficient storage") ||
      raw.includes("超過剩餘空間") ||
      raw.includes("exceeds") ||
      (raw.includes("storage") && (raw.includes("limit") || raw.includes("full") || raw.includes("quota")));

    const isPermissionError =
      raw.includes("沒有許可權使用此儲存配置") ||
      raw.includes("沒有許可權") ||
      raw.includes("許可權不足") ||
      raw.includes("permission denied") ||
      raw.includes("forbidden") ||
      raw.includes("unauthorized");

    let messageText = raw;
    if (isSlugConflict) {
      messageText = t("file.messages.slugConflict");
    } else if (isInsufficientStorage) {
      messageText = processInsufficientStorageError(raw);
    } else if (isPermissionError) {
      messageText = t("file.messages.permissionError");
    }

    return { message: messageText, raw, isSlugConflict, isInsufficientStorage, isPermissionError };
  };

  /**
   * 彙總上傳結果，生成統一的提示資訊
   *
   * @param {Object[]} errors - 由 buildErrorDescriptor 生成的錯誤描述陣列
   * @param {Object[]} uploadResults - 成功上傳結果列表
   * @param {number} totalFiles - 本次嘗試上傳的檔案總數
   *
   * @returns {Object|null} summary
   *  - kind: 'error' | 'success'
   *  - severity: 'error' | 'warning'（僅 error 時使用）
   *  - message: string
   */
  const summarizeUploadResults = ({ errors, uploadResults, totalFiles }) => {
    if (errors.length) {
      const allSlugConflicts = errors.every((err) => err.isSlugConflict);
      const hasSlugConflict = errors.some((err) => err.isSlugConflict);
      const allInsufficient = errors.every((err) => err.isInsufficientStorage);
      const allPermission = errors.every((err) => err.isPermissionError);
      const firstStorageError = errors.find((err) => err.isInsufficientStorage);

      if (errors.length === totalFiles) {
        if (allSlugConflicts) {
          return { kind: "error", severity: "error", message: t("file.allSlugConflicts") };
        }
        if (allInsufficient && firstStorageError) {
          return {
            kind: "error",
            severity: "error",
            message: processInsufficientStorageError(firstStorageError.raw),
          };
        }
        if (allPermission) {
          return { kind: "error", severity: "error", message: t("file.allPermissionErrors") };
        }
        return { kind: "error", severity: "error", message: t("file.allUploadsFailed") };
      }

      // 部分失敗
      if (hasSlugConflict) {
        const slugCount = errors.filter((err) => err.isSlugConflict).length;
        return {
          kind: "error",
          severity: "warning",
          message:
            slugCount === errors.length
              ? t("file.someSlugConflicts", { count: slugCount })
              : t("file.someUploadsFailed", { count: errors.length }),
        };
      }

      return {
        kind: "error",
        severity: "warning",
        message: t("file.someUploadsFailed", { count: errors.length }),
      };
    }

    if (uploadResults.length > 0) {
      return {
        kind: "success",
        message:
          uploadResults.length > 1
            ? t("file.multipleUploadsSuccessful", { count: uploadResults.length })
            : t("file.uploadSuccessful"),
      };
    }

    return null;
  };

  return {
    buildPayloadForFile,
    buildErrorDescriptor,
    summarizeUploadResults,
  };
}
