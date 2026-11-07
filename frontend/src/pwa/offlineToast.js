export function showOfflineToast(message = "當前頁面暫時無法訪問，請檢查網路狀態") {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;

  window.dispatchEvent(
    new CustomEvent("global-message", {
      detail: {
        type: "warning",
        content: message,
        // 離線場景預設採用持久警告，直到使用者手動關閉或狀態恢復
        duration: 0,
      },
    })
  );
}

export function hideOfflineToast() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;

  window.dispatchEvent(new CustomEvent("global-message-clear"));
}

export function showPageUnavailableToast(pageName = "當前頁面") {
  showOfflineToast(`${pageName}暫時無法訪問，請檢查網路狀態`);
}

export function clearAllToasts() {
  hideOfflineToast();
}
