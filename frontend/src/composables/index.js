/**
 * Composables 統一聚合匯出
 */

// ===== 核心系統 =====
import { useGlobalMessage } from "./core/useGlobalMessage.js";
import { useThemeMode } from "./core/useThemeMode.js";

// ===== 檔案預覽功能 =====
import { usePreviewRenderers } from "./file-preview/usePreviewRenderers.js";
import { useFilePreviewExtensions } from "./file-preview/useFilePreviewExtensions.js";
import { resolvePreviewSelection, PREVIEW_KEYS, PREVIEW_KINDS } from "./file-preview/previewRegistry.js";

// ===== 壓縮檔案功能 =====
import { useArchivePreview } from "./archive/useArchivePreview.js";

// ===== 檔案系統功能 =====
import { useFileOperations } from "./file-system/useFileOperations.js";
import { useDirectorySort } from "./file-system/useDirectorySort.js";
import { useFileBasket } from "./file-system/useFileBasket.js";
import { useFileSave } from "./file-system/useFileSave.js";

// ===== UI互動功能 =====
import { useSelection } from "./ui-interaction/useSelection.js";
import { useUIState } from "./ui-interaction/useUIState.js";
import { useGalleryView } from "./ui-interaction/useGalleryView.js";
import { usePhotoSwipe } from "./ui-interaction/usePhotoSwipe.js";
import { useShareSettingsForm } from "./upload/useShareSettingsForm.js";

// 重新匯出所有功能
export {
  useGlobalMessage,
  useThemeMode,
  usePreviewRenderers,
  useFilePreviewExtensions,
  resolvePreviewSelection,
  PREVIEW_KEYS,
  PREVIEW_KINDS,
  useArchivePreview,
  useFileOperations,
  useDirectorySort,
  useFileBasket,
  useFileSave,
  useSelection,
  useUIState,
  useGalleryView,
  usePhotoSwipe,
  useShareSettingsForm,
};

// ===== 便捷的聚合匯出 =====

/**
 * 檔案預覽完整功能聚合
 * 匯出檔案預覽相關的所有功能
 */
export const FilePreviewComposables = {
  usePreviewRenderers,
  useFilePreviewExtensions,
  resolvePreviewSelection,
  PREVIEW_KEYS,
  PREVIEW_KINDS,
  useArchivePreview,
};

/**
 * 檔案系統完整功能聚合
 * 匯出檔案系統相關的所有功能
 */
export const FileSystemComposables = {
  useFileOperations,
  useDirectorySort,
  useFileBasket,
  useFileSave,
};

/**
 * UI互動完整功能聚合
 * 匯出UI互動相關的所有功能
 */
export const UIComposables = {
  useSelection,
  useUIState,
  useGalleryView,
  usePhotoSwipe,
};

// ===== 常量定義 =====

/**
 * 檔案操作型別
 */
export const FILE_ACTIONS = {
  VIEW: "view",
  EDIT: "edit",
  DELETE: "delete",
  DOWNLOAD: "download",
  COPY: "copy",
  MOVE: "move",
  RENAME: "rename",
  SHARE: "share",
};

/**
 * 預覽型別
 */
export const PREVIEW_TYPES = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  PDF: "pdf",
  OFFICE: "office",
  TEXT: "text",
  CODE: "code",
  MARKDOWN: "markdown",
  HTML: "html",
  UNKNOWN: "unknown",
};

/**
 * UI狀態型別
 */
export const UI_STATE_TYPES = {
  VIEW_MODES: {
    LIST: "list",
    GRID: "grid",
    DETAIL: "detail",
  },
  SELECTION_MODES: {
    SINGLE: "single",
    MULTIPLE: "multiple",
    NONE: "none",
  },
  LOADING_STATES: {
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    ERROR: "error",
  },
};

/**
 * 排序欄位和順序
 */
export const SORT_CONFIG = {
  FIELDS: {
    NAME: "name",
    SIZE: "size",
    MODIFIED: "modified",
  },
  ORDERS: {
    DEFAULT: "default",
    ASC: "asc",
    DESC: "desc",
  },
};

// ===== 預設匯出 =====
export default {
  // 單獨的組合函式
  useGlobalMessage,
  useThemeMode,
  usePreviewRenderers,
  useFilePreviewExtensions,
  resolvePreviewSelection,
  PREVIEW_KEYS,
  PREVIEW_KINDS,
  useFileOperations,
  useDirectorySort,
  useFileBasket,
  useSelection,
  useUIState,
  useGalleryView,
  usePhotoSwipe,
  useShareSettingsForm,

  // 聚合物件
  FilePreviewComposables,
  FileSystemComposables,
  UIComposables,

  // 常量
  FILE_ACTIONS,
  PREVIEW_TYPES,
  UI_STATE_TYPES,
  SORT_CONFIG,
};
