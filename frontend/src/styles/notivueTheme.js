/**
 * CloudHarbor Notivue 主題配置
 * 基於 pastelTheme，僅自定義顏色
 */

import { pastelTheme, darkTheme } from "notivue";

/**
 * 亮色主題 - 基於 pastel
 */
export const CloudHarborLightTheme = {
  ...pastelTheme,

  // ===== Success - 綠色系 =====
  "--nv-success-accent": "#10b981",
  "--nv-success-border": "#d1fae5",

  // ===== Error - 紅色系 =====
  "--nv-error-accent": "#dc2626",
  "--nv-error-border": "#fecaca",

  // ===== Warning - 黃色系 =====
  "--nv-warning-accent": "#f59e0b",
  "--nv-warning-border": "#fde68a",

  // ===== Info - 藍色系 =====
  "--nv-info-accent": "#3b82f6",
  "--nv-info-border": "#bfdbfe",

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#8b5cf6",
  "--nv-promise-border": "#ddd6fe",
};

/**
 * 暗色主題 - 僅顏色自定義
 */
export const CloudHarborDarkTheme = {
  ...darkTheme,

  // ===== 暗色背景適配 =====
  "--nv-global-bg": "#1f2937",
  "--nv-global-fg": "#f3f4f6",
  "--nv-global-border": "#374151",

  // ===== Success - 綠色系 =====
  "--nv-success-accent": "#34d399",
  "--nv-success-bg": "#1f2937",
  "--nv-success-fg": "#f3f4f6",
  "--nv-success-border": "#065f46",

  // ===== Error - 紅色系 =====
  "--nv-error-accent": "#f87171",
  "--nv-error-bg": "#1f2937",
  "--nv-error-fg": "#f3f4f6",
  "--nv-error-border": "#991b1b",

  // ===== Warning - 黃色系 =====
  "--nv-warning-accent": "#fbbf24",
  "--nv-warning-bg": "#1f2937",
  "--nv-warning-fg": "#f3f4f6",
  "--nv-warning-border": "#92400e",

  // ===== Info - 藍色系 =====
  "--nv-info-accent": "#60a5fa",
  "--nv-info-bg": "#1f2937",
  "--nv-info-fg": "#f3f4f6",
  "--nv-info-border": "#1e40af",

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#a78bfa",
  "--nv-promise-bg": "#1f2937",
  "--nv-promise-fg": "#f3f4f6",
  "--nv-promise-border": "#5b21b6",
};
