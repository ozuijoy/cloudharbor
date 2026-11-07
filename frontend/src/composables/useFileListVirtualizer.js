/**
 * 檔案列表虛擬滾動 Composable
 * 
 * 使用 TanStack Virtual 實現高效能虛擬滾動
 * 支援大量檔案（1000+）的流暢渲染
 * 
 * @author Codex
 * @date 2024-12-07
 */

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/**
 * 檔案列表虛擬滾動 Hook
 * 
 * @param {Object} options - 配置選項
 * @param {Ref<Array>} options.items - 檔案列表資料
 * @param {Ref<HTMLElement>} options.containerRef - 滾動容器引用
 * @param {number} options.itemHeight - 每項高度（預設 48px）
 * @param {number} options.overscan - 緩衝區專案數（預設 10）
 * @param {boolean} options.enabled - 是否啟用虛擬滾動（預設 true）
 * @returns {Object} 虛擬滾動相關方法和狀態
 */
export function useFileListVirtualizer(options = {}) {
  const {
    items,
    containerRef,
    itemHeight = 48,
    overscan = 10,
    enabled = true,
  } = options

  // 虛擬滾動例項
  const virtualizerInstance = ref(null)

  // 是否啟用虛擬滾動（檔案數量超過閾值時啟用）
  const VIRTUAL_SCROLL_THRESHOLD = 100
  const shouldVirtualize = computed(() => {
    return enabled && items.value && items.value.length > VIRTUAL_SCROLL_THRESHOLD
  })

  // 建立虛擬滾動器
  const createVirtualizer = () => {
    if (!containerRef.value || !shouldVirtualize.value) {
      return null
    }

    return useVirtualizer({
      count: items.value.length,
      getScrollElement: () => containerRef.value,
      estimateSize: () => itemHeight,
      overscan: overscan,
      scrollMargin: 0,
    })
  }

  // 監聽 items 變化，更新虛擬滾動器
  watch(
    () => items.value?.length,
    () => {
      if (shouldVirtualize.value && virtualizerInstance.value) {
        // 通知虛擬滾動器資料已更新
        virtualizerInstance.value.measure()
      }
    }
  )

  // 初始化
  onMounted(() => {
    if (shouldVirtualize.value) {
      virtualizerInstance.value = createVirtualizer()
    }
  })

  // 獲取虛擬專案列表
  const virtualItems = computed(() => {
    if (!shouldVirtualize.value || !virtualizerInstance.value) {
      return null
    }
    return virtualizerInstance.value.getVirtualItems()
  })

  // 獲取總高度
  const totalSize = computed(() => {
    if (!shouldVirtualize.value || !virtualizerInstance.value) {
      return 0
    }
    return virtualizerInstance.value.getTotalSize()
  })

  // 滾動到指定索引
  const scrollToIndex = (index, options = {}) => {
    if (virtualizerInstance.value) {
      virtualizerInstance.value.scrollToIndex(index, {
        align: 'start',
        ...options,
      })
    }
  }

  // 滾動到頂部
  const scrollToTop = () => {
    scrollToIndex(0)
  }

  // 滾動到底部
  const scrollToBottom = () => {
    if (items.value?.length > 0) {
      scrollToIndex(items.value.length - 1)
    }
  }

  return {
    // 狀態
    shouldVirtualize,
    virtualItems,
    totalSize,
    virtualizerInstance,
    
    // 方法
    scrollToIndex,
    scrollToTop,
    scrollToBottom,
    
    // 常量
    VIRTUAL_SCROLL_THRESHOLD,
  }
}

export default useFileListVirtualizer
