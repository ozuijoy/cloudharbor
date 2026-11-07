/**
 * 上下文選單指令
 * 統一處理移動端長按和桌面端右鍵選單
 */

import { createLogger } from "@/utils/logger.js";

const log = createLogger("ContextMenu");

/**
 * 檢測裝置型別（快取結果避免重複計算）
 * @returns {boolean} 是否為移動裝置
 */
const isMobileDevice = (() => {
  let cached = null;
  return () => {
    if (cached === null) {
      cached = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || "ontouchstart" in window || navigator.maxTouchPoints > 0;
    }
    return cached;
  };
})();

/**
 * 上下文選單指令實現
 */
export const contextMenuDirective = {
  mounted(el, binding) {
    // 儲存定時器和狀態
    let longPressTimer = null;
    let isLongPress = false;
    let startX = 0;
    let startY = 0;
    const isMobile = isMobileDevice();

    // 長按閾值配置
    const LONG_PRESS_DURATION = 500; // 500ms觸發長按
    const MOVE_THRESHOLD = 10; // 移動超過10px取消長按

    /**
     * 開始長按檢測（移動端）
     * @param {TouchEvent} e 觸控事件
     */
    const handleTouchStart = (e) => {
      if (!isMobile) return;

      // 安全檢查：確保touches存在且不為空
      if (!e.touches || e.touches.length === 0) {
        log.warn("⚠️ TouchStart事件缺少touches資料");
        return;
      }

      // 記錄起始位置
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      isLongPress = false;

      // 清除之前的定時器
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      // 設定長按定時器
      longPressTimer = setTimeout(() => {
        // 雙重檢查：確保定時器沒有被清除
        if (longPressTimer) {
          isLongPress = true;
          // 觸發上下文選單
          showContextMenu(startX, startY);
        }
      }, LONG_PRESS_DURATION);
    };

    /**
     * 處理觸控移動（移動端）
     * @param {TouchEvent} e 觸控事件
     */
    const handleTouchMove = (e) => {
      if (!isMobile || !longPressTimer) return;

      // 安全檢查：確保touches存在且不為空
      if (!e.touches || e.touches.length === 0) {
        // 如果touches為空，取消長按
        clearTimeout(longPressTimer);
        longPressTimer = null;
        return;
      }

      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);

      // 如果移動距離超過閾值，取消長按
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    /**
     * 結束觸控（移動端）
     */
    const handleTouchEnd = () => {
      if (!isMobile) return;

      // 清除長按定時器
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    /**
     * 處理右鍵選單（桌面端）
     * @param {MouseEvent} e 滑鼠事件
     */
    const handleContextMenu = (e) => {
      if (isMobile) return;

      // 阻止預設右鍵選單
      e.preventDefault();
      e.stopPropagation();

      // 顯示自定義上下文選單
      showContextMenu(e.clientX, e.clientY);
    };

    /**
     * 處理點選事件
     * @param {MouseEvent|TouchEvent} e 事件物件
     */
    const handleClick = (e) => {
      // 如果是長按觸發的，阻止點選事件但不阻止冒泡（避免與PhotoSwipe衝突）
      if (isLongPress) {
        e.preventDefault();
        // 注意：不呼叫stopPropagation()，避免與PhotoSwipe等元件衝突
        isLongPress = false;
        return;
      }

      // 正常點選邏輯由父元件處理
    };

    /**
     * 顯示上下文選單（帶異常處理）
     * @param {number} x X座標
     * @param {number} y Y座標
     */
    const showContextMenu = (x, y) => {
      try {
        // 呼叫繫結的處理函式
        if (typeof binding.value === "function") {
          binding.value({ x, y, isMobile });
        } else if (binding.value && typeof binding.value.handler === "function") {
          binding.value.handler({ x, y, isMobile });
        } else {
          log.warn("⚠️ 上下文選單指令：未找到有效的處理函式");
        }
      } catch (error) {
        log.error("❌ 上下文選單處理函式執行失敗:", error);
      }
    };

    // 繫結事件監聽器
    if (isMobile) {
      // 移動端：長按觸發
      el.addEventListener("touchstart", handleTouchStart, { passive: false });
      el.addEventListener("touchmove", handleTouchMove, { passive: false });
      el.addEventListener("touchend", handleTouchEnd, { passive: false });
      el.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    } else {
      // 桌面端：右鍵觸發
      el.addEventListener("contextmenu", handleContextMenu);
    }

    // 通用點選事件處理
    el.addEventListener("click", handleClick);

    // 儲存清理函式到元素上，供unmounted時使用
    el._contextMenuCleanup = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }

      if (isMobile) {
        el.removeEventListener("touchstart", handleTouchStart);
        el.removeEventListener("touchmove", handleTouchMove);
        el.removeEventListener("touchend", handleTouchEnd);
        el.removeEventListener("touchcancel", handleTouchEnd);
      } else {
        el.removeEventListener("contextmenu", handleContextMenu);
      }

      el.removeEventListener("click", handleClick);
    };
  },

  unmounted(el) {
    // 清理事件監聽器
    if (el._contextMenuCleanup) {
      el._contextMenuCleanup();
      delete el._contextMenuCleanup;
    }
  },
};

/**
 * 預設匯出指令物件
 */
export default contextMenuDirective;
