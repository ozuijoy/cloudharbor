/**
 * 設計令牌 Composable
 * 
 * 提供設計令牌的訪問和 CSS 變數注入功能
 */
import { computed } from 'vue'
import tokens, { 
  spacing, 
  radius, 
  duration, 
  easing, 
  elevation, 
  elevationDark,
  explorerDensity,
  explorerAnimation,
  semanticColors 
} from '@/styles/design-tokens'
import { useThemeMode } from '@/composables/core/useThemeMode'

/**
 * 設計令牌 Composable
 * @returns {Object} 設計令牌和工具函式
 */
export function useDesignTokens() {
  // 使用全域性主題模式（由 VueUse useColorMode 驅動）
  const { isDarkMode } = useThemeMode()

  // 獲取當前主題的陰影
  const currentElevation = computed(() => {
    return isDarkMode.value ? elevationDark : elevation
  })

  // 獲取當前主題的語義化顏色
  const currentColors = computed(() => {
    return isDarkMode.value ? semanticColors.dark : semanticColors.light
  })

  /**
   * 注入基礎 CSS 變數到 document root
   */
  function injectBaseVariables() {
    const root = document.documentElement
    const colors = currentColors.value
    const shadows = currentElevation.value

    // 間距變數
    Object.entries(spacing).forEach(([key, value]) => {
      root.style.setProperty(`--spacing-${key}`, value)
    })

    // 圓角變數
    Object.entries(radius).forEach(([key, value]) => {
      root.style.setProperty(`--radius-${key}`, value)
    })

    // 動畫時長變數
    Object.entries(duration).forEach(([key, value]) => {
      root.style.setProperty(`--duration-${key}`, value)
    })

    // 緩動函式變數
    Object.entries(easing).forEach(([key, value]) => {
      root.style.setProperty(`--easing-${key}`, value)
    })

    // 陰影變數
    Object.entries(shadows).forEach(([key, value]) => {
      root.style.setProperty(`--elevation-${key}`, value)
    })

    // 語義化顏色變數
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value)
    })
  }

  /**
   * 獲取間距值
   * @param {string} key - 間距鍵名
   * @returns {string} 間距值
   */
  function getSpacing(key) {
    return spacing[key] || spacing['4']
  }

  /**
   * 獲取圓角值
   * @param {string} key - 圓角鍵名
   * @returns {string} 圓角值
   */
  function getRadius(key) {
    return radius[key] || radius.md
  }

  /**
   * 獲取動畫時長
   * @param {string} key - 時長鍵名
   * @returns {string} 時長值
   */
  function getDuration(key) {
    return duration[key] || duration.normal
  }

  /**
   * 獲取陰影值
   * @param {number} level - 陰影層級 (0-4)
   * @returns {string} 陰影值
   */
  function getElevation(level) {
    return currentElevation.value[level] || currentElevation.value[0]
  }

  /**
   * 獲取密度配置
   * @param {string} density - 密度名稱
   * @returns {Object} 密度配置物件
   */
  function getDensityConfig(density) {
    return explorerDensity[density] || explorerDensity.comfortable
  }

  /**
   * 生成 CSS 變數字串（用於內聯樣式）
   * @param {Object} vars - 變數物件 { name: value }
   * @returns {string} CSS 變數字串
   */
  function toCSSVars(vars) {
    return Object.entries(vars)
      .map(([key, value]) => `--${key}: ${value}`)
      .join('; ')
  }

  return {
    // 令牌資料
    tokens,
    spacing,
    radius,
    duration,
    easing,
    elevation: currentElevation,
    colors: currentColors,
    explorerDensity,
    explorerAnimation,
    
    // 狀態
    isDarkMode,
    
    // 方法
    injectBaseVariables,
    getSpacing,
    getRadius,
    getDuration,
    getElevation,
    getDensityConfig,
    toCSSVars,
  }
}

export default useDesignTokens
