import { ref, onMounted, unref } from "vue";
import { useEventListener } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

/**
 * 通用"元素全屏"工具（Fullscreen API）
 *
 * @param {Ref|Function|HTMLElement} targetRef - 目標元素，支援：
 *   - Vue ref（如 ref(null)）
 *   - 返回元素的函式（如 () => props.fullscreenTarget）
 *   - 直接的 HTMLElement
 * @param {{ includeChildren?: boolean }} [options] - 額外選項：
 *   - includeChildren：是否把“子元素進入全屏”也視為目標元素全屏（預設 true）
 */
export function useElementFullscreen(targetRef, options = {}) {
  const log = createLogger("ElementFullscreen");
  const includeChildren = options?.includeChildren !== false;
  const isFullscreen = ref(false);

  const getTargetEl = () => {
    // 如果是函式，先呼叫獲取實際值
    const value = typeof targetRef === "function" ? targetRef() : unref(targetRef);
    // 再次 unref 以處理巢狀 ref 的情況
    return unref(value) || null;
  };

  const syncState = () => {
    const el = getTargetEl();
    const fullscreenEl = document.fullscreenElement;
    if (!el || !fullscreenEl) {
      isFullscreen.value = false;
      return;
    }
    // 相容：有些元件會對“目標元素內部的子元素”觸發全屏（例如影片播放器）
    isFullscreen.value = includeChildren ? fullscreenEl === el || el.contains(fullscreenEl) : fullscreenEl === el;
  };

  const requestFullscreen = async () => {
    const el = getTargetEl();
    if (!el) {
      log.warn("[useElementFullscreen] No target element found for fullscreen");
      return;
    }
    try {
      await el.requestFullscreen();
    } catch (err) {
      log.warn("[useElementFullscreen] Fullscreen request failed:", err);
    } finally {
      syncState();
    }
  };

  const exitFullscreen = async () => {
    const el = getTargetEl();
    const fullscreenEl = document.fullscreenElement;
    if (!el || !fullscreenEl) return;
    if (includeChildren) {
      if (fullscreenEl !== el && !el.contains(fullscreenEl)) return;
    } else {
      if (fullscreenEl !== el) return;
    }
    try {
      await document.exitFullscreen();
    } catch {
      // 靜默
    } finally {
      syncState();
    }
  };

  const toggleFullscreen = async () => {
    if (isFullscreen.value) {
      await exitFullscreen();
      return;
    }
    await requestFullscreen();
  };

  const handleFullscreenChange = () => {
    syncState();
  };

  useEventListener(document, "fullscreenchange", handleFullscreenChange);

  onMounted(() => {
    syncState();
  });

  return {
    isFullscreen,
    requestFullscreen,
    exitFullscreen,
    toggleFullscreen,
    syncState,
  };
}
