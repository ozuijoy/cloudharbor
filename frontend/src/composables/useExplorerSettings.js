/**
 * 檔案瀏覽器使用者配置 Composable
 * 
 * 管理使用者的檢視偏好設定，支援 localStorage 持久化
 * 配置變更時自動注入 CSS 變數
 */
import { ref, watch, computed } from 'vue'
import { useLocalStorage, useMutationObserver } from '@vueuse/core'
import { defineStore } from 'pinia'
import { semanticColors } from '@/styles/design-tokens'
import { createLogger } from '@/utils/logger.js'

const log = createLogger('ExplorerSettings')

const STORAGE_KEY = 'cloudharbor-explorer-settings'

// 預設配置
const defaultSettings = {
  viewMode: 'list',           // list | grid | gallery
  densityValue: 50,           // 預設舒適密度：圖示 ~22px，行高 ~51px
  animationsEnabled: true,
  showActionButtons: true,    // 是否顯示操作按鈕列
  spacingValue: 0,            // 預設無間距，檔案項緊密排列
  sortBy: 'name',             // name | size | modified | type
  sortOrder: 'asc',           // asc | desc
  foldersFirst: true,
  fileNameOverflow: 'ellipsis', // ellipsis | scroll | wrap
  showCheckboxes: true,       // 是否預設顯示勾選框
}

// 密度值範圍對映
const densityRanges = {
  itemHeight: { min: 28, max: 80 },      // px
  iconSize: { min: 12, max: 36 },        // px
  fontSize: { min: 11, max: 18 },        // px 
  padding: { min: 2, max: 24 },          // px
  gap: { min: 2, max: 24 },              // px
  gridMinWidth: { min: 80, max: 280 },   // px
}

// 間距值範圍對映
const spacingRanges = {
  itemSpacing: { min: 0, max: 16 },      // px
}

// 線性插值函式
function lerp(min, max, t) {
  return Math.round(min + (max - min) * t)
}

export const useExplorerSettings = defineStore('explorerSettings', () => {
  // 配置狀態
  const settings = useLocalStorage(STORAGE_KEY, { ...defaultSettings })
  
  // 是否已初始化
  const initialized = ref(false)

  // 計算屬性：當前密度配置（基於連續值計算）
  const currentDensity = computed(() => {
    const t = settings.value.densityValue / 100
    return {
      itemHeight: `${lerp(densityRanges.itemHeight.min, densityRanges.itemHeight.max, t)}px`,
      iconSize: `${lerp(densityRanges.iconSize.min, densityRanges.iconSize.max, t)}px`,
      fontSize: `${lerp(densityRanges.fontSize.min, densityRanges.fontSize.max, t)}px`,
      padding: `${lerp(densityRanges.padding.min, densityRanges.padding.max, t)}px`,
      gap: `${lerp(densityRanges.gap.min, densityRanges.gap.max, t)}px`,
      gridMinWidth: `${lerp(densityRanges.gridMinWidth.min, densityRanges.gridMinWidth.max, t)}px`,
    }
  })

  // 計算屬性：當前間距值（基於連續值計算）
  const currentSpacing = computed(() => {
    const t = settings.value.spacingValue / 100
    return `${lerp(spacingRanges.itemSpacing.min, spacingRanges.itemSpacing.max, t)}px`
  })

  // 從 localStorage 恢復配置
  function loadSettings() {
    try {
      const parsed = settings.value || {}
      // 合併配置，確保新增欄位有預設值
      settings.value = { ...defaultSettings, ...parsed }
      
      // 相容舊版配置：將舊的 density 字串轉換為數值
      if (typeof parsed.density === 'string') {
        const densityMap = { compact: 0, comfortable: 50, spacious: 100 }
        settings.value.densityValue = densityMap[parsed.density] ?? 50
      }
      // 相容舊版配置：將舊的 itemSpacing 字串轉換為數值
      if (typeof parsed.itemSpacing === 'string') {
        const spacingMap = { compact: 0, standard: 50, relaxed: 100 }
        settings.value.spacingValue = spacingMap[parsed.itemSpacing] ?? 50
      }
    } catch (e) {
      log.warn('[ExplorerSettings] 載入配置失敗，使用預設值:', e)
    }
    initialized.value = true
    injectCSSVariables()
  }

  // 儲存配置到 localStorage
  function saveSettings() {
  }

  // 注入 CSS 變數到 document root
  function injectCSSVariables() {
    const density = currentDensity.value
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    const colors = isDark ? semanticColors.dark : semanticColors.light

    // 密度相關變數
    root.style.setProperty('--explorer-item-height', density.itemHeight)
    root.style.setProperty('--explorer-icon-size', density.iconSize)
    root.style.setProperty('--explorer-font-size', density.fontSize)
    root.style.setProperty('--explorer-padding', density.padding)
    root.style.setProperty('--explorer-gap', density.gap)
    root.style.setProperty('--explorer-grid-min-width', density.gridMinWidth)

    // 顏色變數
    root.style.setProperty('--explorer-hover', colors.hover)
    root.style.setProperty('--explorer-selected', colors.selected)
    root.style.setProperty('--explorer-muted', colors.muted)
    root.style.setProperty('--explorer-border', colors.border)
    root.style.setProperty('--explorer-surface', colors.surface)
    root.style.setProperty('--explorer-surface-elevated', colors.surfaceElevated)

    // 動畫開關
    root.style.setProperty('--explorer-animation-duration', 
      settings.value.animationsEnabled ? '200ms' : '0ms')

    // 檔案間距
    root.style.setProperty('--explorer-item-spacing', currentSpacing.value)
  }

  // 更新單個配置項
  function updateSetting(key, value) {
    if (key in settings.value) {
      settings.value[key] = value
    }
  }

  // 重置為預設配置
  function resetSettings() {
    settings.value = { ...defaultSettings }
  }

  // 切換檢視模式
  function setViewMode(mode) {
    if (['list', 'grid', 'gallery'].includes(mode)) {
      settings.value.viewMode = mode
    }
  }

  // 設定密度值 (0-100)
  function setDensityValue(value) {
    settings.value.densityValue = Math.max(0, Math.min(100, value))
  }

  // 設定間距值 (0-100)
  function setSpacingValue(value) {
    settings.value.spacingValue = Math.max(0, Math.min(100, value))
  }

  // 切換排序
  function setSort(sortBy, sortOrder) {
    if (['name', 'size', 'modified', 'type'].includes(sortBy)) {
      settings.value.sortBy = sortBy
    }
    if (['asc', 'desc'].includes(sortOrder)) {
      settings.value.sortOrder = sortOrder
    }
  }

  // 切換排序順序
  function toggleSortOrder() {
    settings.value.sortOrder = settings.value.sortOrder === 'asc' ? 'desc' : 'asc'
  }

  // 切換勾選框顯示狀態
  function toggleShowCheckboxes() {
    settings.value.showCheckboxes = !settings.value.showCheckboxes
  }

  // 監聽配置變化，自動儲存和注入 CSS 變數
  watch(settings, () => {
    if (initialized.value) {
      injectCSSVariables()
    }
  }, { deep: true })

  // 暗色模式觀察器 stop（VueUse 管理）
  let stopDarkModeObserver = null

  // 監聽暗色模式變化
  function setupDarkModeObserver() {
    // 避免重複建立
    if (typeof stopDarkModeObserver === 'function') return stopDarkModeObserver

    const { stop } = useMutationObserver(
      document.documentElement,
      () => {
        injectCSSVariables()
      },
      { attributes: true, attributeFilter: ['class'] }
    )
    stopDarkModeObserver = stop
    return stopDarkModeObserver
  }

  // 清理暗色模式觀察器
  function cleanupDarkModeObserver() {
    if (typeof stopDarkModeObserver === 'function') {
      stopDarkModeObserver()
      stopDarkModeObserver = null
    }
  }

  // 自動初始化：在 store 建立時立即載入設定
  // 這確保了在任何元件使用設定之前，設定已經從 localStorage 恢復
  if (typeof window !== 'undefined' && !initialized.value) {
    loadSettings()
  }

  return {
    // 狀態
    settings,
    initialized,
    currentDensity,
    currentSpacing,
    
    // 方法
    loadSettings,
    saveSettings,
    injectCSSVariables,
    updateSetting,
    resetSettings,
    setViewMode,
    setDensityValue,
    setSpacingValue,
    setSort,
    toggleSortOrder,
    toggleShowCheckboxes,
    setupDarkModeObserver,
    cleanupDarkModeObserver,
  }
})

export default useExplorerSettings
