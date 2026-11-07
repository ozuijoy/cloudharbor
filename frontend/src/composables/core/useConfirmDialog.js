/**
 * 確認對話方塊 Composable
 *
 */
import { ref, reactive } from "vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ConfirmDialog");

export function useConfirmDialog() {
  // 對話方塊狀態
  const dialogState = reactive({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "",
    cancelText: "",
    confirmType: "primary",
    loading: false,
    loadingText: "",
    allowBackdropClose: true,
    darkMode: false,
  });

  // Promise 解析器
  let resolvePromise = null;
  // 非同步確認回撥
  let onConfirmCallback = null;

  /**
   * 顯示確認對話方塊
   * @param {Object} options - 對話方塊選項
   * @param {string} options.title - 標題（必需）
   * @param {string} [options.message] - 訊息內容
   * @param {string} [options.confirmText] - 確認按鈕文字
   * @param {string} [options.cancelText] - 取消按鈕文字
   * @param {'primary'|'danger'|'warning'} [options.confirmType='primary'] - 確認按鈕型別
   * @param {string} [options.loadingText] - 載入中文字
   * @param {boolean} [options.allowBackdropClose=true] - 是否允許點選背景關閉
   * @param {boolean} [options.darkMode] - 暗色模式
   * @param {Function} [options.onConfirm] - 確認時執行的非同步回撥（會顯示載入狀態）
   * @returns {Promise<boolean>} - 使用者點選確認返回 true，取消返回 false
   */
  const confirm = (options) => {
    return new Promise((resolve) => {
      resolvePromise = resolve;
      onConfirmCallback = options.onConfirm || null;

      // 設定對話方塊狀態
      dialogState.isOpen = true;
      dialogState.title = options.title || "";
      dialogState.message = options.message || "";
      dialogState.confirmText = options.confirmText || "";
      dialogState.cancelText = options.cancelText || "";
      dialogState.confirmType = options.confirmType || "primary";
      dialogState.loading = false;
      dialogState.loadingText = options.loadingText || "";
      dialogState.allowBackdropClose = options.allowBackdropClose !== false;
      dialogState.darkMode = options.darkMode !== undefined ? options.darkMode : false;
    });
  };

  /**
   * 處理確認事件
   * 如果有 onConfirm 回撥，會自動執行並顯示載入狀態
   */
  const handleConfirm = async () => {
    if (onConfirmCallback) {
      // 有非同步回撥，顯示載入狀態
      dialogState.loading = true;
      dialogState.allowBackdropClose = false;

      try {
        await onConfirmCallback();
        closeDialog(true);
      } catch (error) {
        // 發生錯誤時關閉對話方塊並返回 false
        log.error("Confirm dialog callback error:", error);
        closeDialog(false);
        throw error; // 重新丟擲錯誤讓呼叫者處理
      }
    } else {
      // 無非同步回撥，直接確認
      closeDialog(true);
    }
  };

  /**
   * 處理取消事件
   */
  const handleCancel = () => {
    closeDialog(false);
  };

  /**
   * 關閉對話方塊
   * @param {boolean} result - 結果（true=確認，false=取消）
   */
  const closeDialog = (result) => {
    dialogState.isOpen = false;
    dialogState.loading = false;
    onConfirmCallback = null;

    if (resolvePromise) {
      resolvePromise(result);
      resolvePromise = null;
    }
  };

  /**
   * 設定暗色模式（全域性）
   * @param {boolean} isDark - 是否暗色模式
   */
  const setDarkMode = (isDark) => {
    dialogState.darkMode = isDark;
  };

  return {
    // 狀態（繫結到 ConfirmDialog 元件）
    dialogState,

    // 方法
    confirm,
    handleConfirm,
    handleCancel,
    setDarkMode,
  };
}

/**
 * “confirmFn 介面卡”，用於給各類管理 composable
 *
 *
 * @param {(options: any) => Promise<boolean>} confirm - useConfirmDialog() 返回的 confirm 方法
 * @param {Object} [options]
 * @param {any} [options.t] - i18n 的 t（可選）
 * @param {any} [options.darkMode] - ref 或 boolean（可選）
 * @param {(ctx: {confirmType?: string, title?: string, message?: string}) => string} [options.getConfirmText]
 * @returns {(payload: {title: string, message?: string, confirmType?: 'primary'|'danger'|'warning', confirmText?: string}) => Promise<boolean>}
 */
export function createConfirmFn(confirm, { t, darkMode, getConfirmText } = {}) {
  return async ({ title, message, confirmType, confirmText }) => {
    const resolvedDarkMode = typeof darkMode === "object" && darkMode ? !!darkMode.value : !!darkMode;
    const resolvedConfirmType = confirmType || "primary";

    const resolvedConfirmText =
      confirmText ||
      (typeof getConfirmText === "function" ? getConfirmText({ confirmType: resolvedConfirmType, title, message }) : "") ||
      (t && typeof t === "function"
        ? resolvedConfirmType === "danger"
          ? t("common.dialogs.deleteButton")
          : t("common.dialogs.confirmButton")
        : resolvedConfirmType === "danger"
          ? "刪除"
          : "確認");

    return await confirm({
      title,
      message,
      confirmType: resolvedConfirmType,
      confirmText: resolvedConfirmText,
      darkMode: resolvedDarkMode,
    });
  };
}

/**
 * 快捷方法：建立刪除確認對話方塊選項
 * @param {string} itemName - 要刪除的專案名稱
 * @param {Object} [options] - 額外選項
 * @returns {Object} 對話方塊選項
 */
export function createDeleteConfirmOptions(itemName, options = {}) {
  return {
    title: options.title || "確認刪除",
    message: options.message || `確定要刪除 "${itemName}" 嗎？此操作不可撤銷。`,
    confirmType: "danger",
    confirmText: options.confirmText || "刪除",
    ...options,
  };
}

/**
 * 快捷方法：建立批次刪除確認對話方塊選項
 * @param {number} count - 要刪除的專案數量
 * @param {Object} [options] - 額外選項
 * @returns {Object} 對話方塊選項
 */
export function createBatchDeleteConfirmOptions(count, options = {}) {
  return {
    title: options.title || "確認批次刪除",
    message: options.message || `確定要刪除選中的 ${count} 項嗎？此操作不可撤銷。`,
    confirmType: "danger",
    confirmText: options.confirmText || `刪除 (${count})`,
    ...options,
  };
}
