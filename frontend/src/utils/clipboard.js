/**
 * 通用複製文字到剪貼簿函式
 *
 * @param {string} text - 要複製的文字
 * @returns {Promise<boolean>} 是否複製成功
 */
import { useClipboard } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const clipboard = useClipboard({
  // legacy=true：在 Clipboard API 不可用/被限制時，自動回退到 execCommand
  legacy: true,
});
const log = createLogger("Clipboard");

export const copyToClipboard = async (text) => {
  try {
    const payload = String(text ?? "");
    if (!payload) return false;
    await clipboard.copy(payload);
    return true;
  } catch (err) {
    log.error("複製到剪貼簿失敗:", err);
    return false;
  }
};
