/**
 * 全域性訊息管理系統
 * 基於 Notivue 實現，保留向後相容的 API
 */

import { ref, computed } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { push } from "notivue";

// 全域性訊息狀態 - 使用單例模式
let globalMessageState = null;

export function useGlobalMessage() {
  // 確保全域性只有一個訊息管理例項
  if (!globalMessageState) {
    globalMessageState = createMessageState();
  }

  return globalMessageState;
}

/**
 * 建立訊息狀態管理 
 */
function createMessageState() {
  // ===== 核心狀態 =====
  const message = ref(null);

  // ===== 計算屬性 =====
  const hasMessage = computed(() => !!message.value);
  const messageType = computed(() => message.value?.type || null);
  const messageContent = computed(() => message.value?.content || null);

  // ===== 核心方法 =====
  const autoClearDelayMs = ref(0);
  const { start: startAutoClear, stop: stopAutoClear } = useTimeoutFn(
    () => {
      message.value = null;
    },
    autoClearDelayMs,
    { immediate: false }
  );

  /**
   * 根據訊息型別和自定義 duration 計算最終展示時長
   * - 不傳 duration 時使用推薦預設值
   * - 傳入 duration 時優先使用呼叫方指定值
   */
  const resolveDurationByType = (type, duration) => {
    if (typeof duration === "number") {
      return duration;
    }

    switch (type) {
      case "success":
      case "info":
        return 4000; // 成功 / 資訊 提示較短
      case "warning":
        return 5500; // 警告略長
      case "error":
        return 6000; // 錯誤提示再長一些，便於閱讀
      default:
        return 5000;
    }
  };

  /**
   * 顯示訊息
   * @param {string} type - 訊息型別 ('success', 'error', 'warning', 'info')
   * @param {string} content - 訊息內容
   * @param {number} [duration] - 顯示時長（毫秒），不傳則按型別使用推薦預設值
   */
  const showMessage = (type, content, duration) => {
    const finalDuration = resolveDurationByType(type, duration);

    // 清除之前的定時器，確保新訊息優先展示
    stopAutoClear();

    // 相容性：保留舊的“單條訊息”狀態（有些頁面可能還在讀 hasMessage/messageContent）
    message.value = {
      type,
      content,
      timestamp: Date.now(),
    };

    // Notivue 渲染（全域性提示）
    const notivueOptions = {
      message: content,
      duration: finalDuration > 0 ? finalDuration : Infinity,
    };

    switch (type) {
      case "success":
        push.success(notivueOptions);
        break;
      case "error":
        push.error(notivueOptions);
        break;
      case "warning":
        push.warning(notivueOptions);
        break;
      case "info":
      default:
        push.info(notivueOptions);
        break;
    }

    // 自動清除"相容狀態"（Notivue 自己會自動關閉提示，這裡只清理 message.value）
    if (finalDuration > 0) {
      autoClearDelayMs.value = finalDuration;
      startAutoClear();
    }
  };

  /**
   * 清除當前訊息
   */
  const clearMessage = () => {
    stopAutoClear();
    message.value = null;
    push.clearAll();
  };

  // ===== 便捷方法 =====

  /**
   * 顯示成功訊息
   */
  const showSuccess = (content, duration) => {
    showMessage("success", content, duration);
  };

  /**
   * 顯示錯誤訊息
   */
  const showError = (content, duration) => {
    showMessage("error", content, duration);
  };

  /**
   * 顯示警告訊息
   */
  const showWarning = (content, duration) => {
    showMessage("warning", content, duration);
  };

  /**
   * 顯示資訊訊息
   */
  const showInfo = (content, duration) => {
    showMessage("info", content, duration);
  };

  return {
    // 狀態 - 匹配現有元件期望的結構
    message,

    // 計算屬性
    hasMessage,
    messageType,
    messageContent,

    // 核心方法
    showMessage,
    clearMessage,

    // 便捷方法
    showSuccess,
    showError,
    showWarning,
    showInfo,

    // 相容性別名
    clearCurrentMessage: clearMessage,
  };
}
