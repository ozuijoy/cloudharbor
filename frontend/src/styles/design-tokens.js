/**
 * CloudHarbor 設計令牌系統
 * 
 * 集中管理所有樣式變數，實現全面可配置的使用者介面
 * 基於 4px 網格系統
 */

// 間距系統（基於 4px 網格）
export const spacing = {
  '0': '0',
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '8': '32px',
  '10': '40px',
  '12': '48px',
}

// 圓角
export const radius = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  full: '9999px',
}

// 動畫時長
export const duration = {
  instant: '0ms',
  fast: '150ms',
  normal: '250ms',
  slow: '400ms',
}

// 緩動函式
export const easing = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
}

// 陰影層級
export const elevation = {
  0: 'none',
  1: '0 1px 3px rgba(0,0,0,0.08)',
  2: '0 4px 12px rgba(0,0,0,0.1)',
  3: '0 8px 24px rgba(0,0,0,0.12)',
  4: '0 16px 48px rgba(0,0,0,0.16)',
}

// 暗色模式陰影
export const elevationDark = {
  0: 'none',
  1: '0 1px 3px rgba(0,0,0,0.24)',
  2: '0 4px 12px rgba(0,0,0,0.32)',
  3: '0 8px 24px rgba(0,0,0,0.4)',
  4: '0 16px 48px rgba(0,0,0,0.48)',
}

// 檔案瀏覽器密度配置
export const explorerDensity = {
  compact: {
    itemHeight: '36px',
    iconSize: '16px',
    fontSize: '13px',
    padding: '8px',
    gap: '8px',
    gridMinWidth: '120px',
  },
  comfortable: {
    itemHeight: '48px',
    iconSize: '20px',
    fontSize: '14px',
    padding: '12px',
    gap: '12px',
    gridMinWidth: '160px',
  },
  spacious: {
    itemHeight: '56px',
    iconSize: '24px',
    fontSize: '15px',
    padding: '16px',
    gap: '16px',
    gridMinWidth: '200px',
  },
}

// 檔案瀏覽器動畫配置
export const explorerAnimation = {
  enterScale: 0.95,
  hoverScale: 1.01,
  enterDuration: '200ms',
  hoverDuration: '150ms',
}

// 顏色語義化（用於 CSS 變數）
export const semanticColors = {
  light: {
    hover: 'rgba(0, 0, 0, 0.04)',
    selected: 'rgba(59, 130, 246, 0.1)',
    muted: 'rgb(107, 114, 128)',
    border: 'rgb(229, 231, 235)',
    surface: 'rgb(255, 255, 255)',
    surfaceElevated: 'rgb(249, 250, 251)',
  },
  dark: {
    hover: 'rgba(255, 255, 255, 0.06)',
    selected: 'rgba(59, 130, 246, 0.2)',
    muted: 'rgb(156, 163, 175)',
    border: 'rgb(55, 65, 81)',
    surface: 'rgb(31, 41, 55)',
    surfaceElevated: 'rgb(55, 65, 81)',
  },
}

// 匯出完整令牌物件
export const tokens = {
  spacing,
  radius,
  duration,
  easing,
  elevation,
  elevationDark,
  explorer: {
    density: explorerDensity,
    animation: explorerAnimation,
  },
  colors: semanticColors,
}

export default tokens
