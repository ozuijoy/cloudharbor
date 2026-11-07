import QRCode from "qrcode";

/**
 * 統一的二維碼生成工具
 * @param {string} url
 * @param {{ darkMode?: boolean, width?: number, margin?: number }} options
 * @returns {Promise<string>}
 */
export async function generateQRCode(url, { darkMode = false, width = 300, margin = 2 } = {}) {
  if (!url) {
    throw new Error("無法生成二維碼：URL為空");
  }

  return QRCode.toDataURL(url, {
    width,
    margin,
    color: {
      dark: darkMode ? "#ffffff" : "#000000",
      light: darkMode ? "#000000" : "#ffffff",
    },
  });
}
