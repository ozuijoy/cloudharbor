/**
 * 右鍵選單 Composable
 * 
 * 封裝 @imengyu/vue3-context-menu，提供檔案瀏覽器右鍵選單功能
 */
import { ref, h } from 'vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'
import {
  IconDownload,
  IconLink,
  IconCopy,
  IconShoppingCart,
  IconCheckbox,
  IconRename,
  IconDelete
} from '@/components/icons'

// 圖示渲染函式
const icons = {
  download: () => h(IconDownload, { size: 'sm' }),
  link: () => h(IconLink, { size: 'sm' }),
  copy: () => h(IconCopy, { size: 'sm' }),
  basket: () => h(IconShoppingCart, { size: 'sm' }),
  checkbox: () => h(IconCheckbox, { size: 'sm' }),
  edit: () => h(IconRename, { size: 'sm' }),
  delete: () => h(IconDelete, { size: 'sm', class: 'text-red-500' }),
}

/**
 * 右鍵選單 Composable
 * @param {Object} options - 配置選項
 * @param {Function} options.onDownload - 下載回撥
 * @param {Function} options.onGetLink - 獲取連結回撥
 * @param {Function} options.onRename - 重新命名回撥
 * @param {Function} options.onDelete - 刪除回撥
 * @param {Function} options.onCopy - 複製回撥
 * @param {Function} options.onAddToBasket - 新增到檔案籃回撥
 * @param {Function} options.onToggleCheckboxes - 切換勾選框顯示回撥
 * @param {Function} options.t - i18n 翻譯函式
 * @returns {Object} 右鍵選單方法
 */
export function useContextMenu(options = {}) {
  const { onDownload, onGetLink, onRename, onDelete, onCopy, onAddToBasket, onToggleCheckboxes, t } = options
  
  // 當前選中的專案
  const contextItem = ref(null)

  /**
   * 生成單個檔案的選單項
   * @param {Object} item - 檔案項
   * @returns {Array} 選單項陣列
   */
  function generateFileMenuItems(item) {
    const items = []
    
    // 下載（僅檔案）
    if (!item.isDirectory) {
      items.push({
        label: t?.('mount.fileItem.download') || '下載',
        icon: icons.download,
        onClick: () => onDownload?.(item),
      })
      
      // 獲取連結（僅檔案）
      items.push({
        label: t?.('mount.fileItem.getLink') || '獲取連結',
        icon: icons.link,
        onClick: () => onGetLink?.(item),
        divided: 'down',
      })
    }
    
    // 複製
    items.push({
      label: t?.('mount.fileItem.copy') || '複製',
      icon: icons.copy,
      onClick: () => onCopy?.(item),
    })
    
    // 新增到檔案籃
    items.push({
      label: t?.('mount.contextMenu.addToBasket') || '新增到檔案籃',
      icon: icons.basket,
      onClick: () => onAddToBasket?.(item),
      divided: 'down',
    })
    
    // 重新命名（僅檔案）
    if (!item.isDirectory) {
      items.push({
        label: t?.('mount.fileItem.rename') || '重新命名',
        icon: icons.edit,
        onClick: () => onRename?.(item),
      })
    }
    
    // 刪除
    items.push({
      label: t?.('mount.fileItem.delete') || '刪除',
      icon: icons.delete,
      customClass: 'context-menu-danger',
      onClick: () => onDelete?.(item),
    })
    
    return items
  }


  /**
   * 生成多選時的選單項
   * @param {Array} selectedItems - 選中的專案陣列
   * @returns {Array} 選單項陣列
   */
  function generateBatchMenuItems(selectedItems) {
    const hasFiles = selectedItems.some(item => !item.isDirectory)
    const items = []
    
    // 批次下載（僅當有檔案時）
    if (hasFiles) {
      items.push({
        label: t?.('mount.contextMenu.batchDownload') || '批次下載',
        icon: icons.download,
        onClick: () => selectedItems.filter(i => !i.isDirectory).forEach(i => onDownload?.(i)),
      })
    }
    
    // 批次複製
    items.push({
      label: t?.('mount.contextMenu.batchCopy') || '批次複製',
      icon: icons.copy,
      onClick: () => onCopy?.(selectedItems),
    })
    
    // 批次新增到檔案籃
    items.push({
      label: t?.('mount.contextMenu.batchAddToBasket') || '批次新增到檔案籃',
      icon: icons.basket,
      onClick: () => onAddToBasket?.(selectedItems),
      divided: 'down', // 在此項下方新增分隔線
    })
    
    // 批次刪除
    items.push({
      label: t?.('mount.contextMenu.batchDelete') || '批次刪除',
      icon: icons.delete,
      customClass: 'context-menu-danger',
      onClick: () => onDelete?.(selectedItems),
    })
    
    return items
  }

  /**
   * 顯示右鍵選單
   * @param {MouseEvent} event - 滑鼠事件
   * @param {Object} item - 當前專案
   * @param {Array} selectedItems - 選中的專案陣列
   * @param {boolean} darkMode - 暗色模式
   * @param {boolean} showCheckboxes - 當前勾選框顯示狀態
   */
  function showContextMenu(event, item, selectedItems = [], darkMode = false, showCheckboxes = false) {
    event.preventDefault()
    contextItem.value = item
    
    // 判斷是否為多選模式
    const isMultiSelect = selectedItems.length > 1
    
    // 生成選單項
    const menuItems = isMultiSelect 
      ? generateBatchMenuItems(selectedItems)
      : generateFileMenuItems(item)
    
    // 新增勾選框切換選項（在選單頂部，帶分隔線）
    if (onToggleCheckboxes) {
      menuItems.unshift({
        label: showCheckboxes 
          ? (t?.('mount.contextMenu.hideCheckboxes') || '隱藏勾選框')
          : (t?.('mount.contextMenu.showCheckboxes') || '顯示勾選框'),
        icon: icons.checkbox,
        onClick: () => onToggleCheckboxes?.(),
        divided: 'down', // 在此項下方新增分隔線
      })
    }
    
    // 顯示選單
    ContextMenu.showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: menuItems,
      theme: darkMode ? 'mac dark' : 'mac',
      zIndex: 1000,
    })
  }

  /**
   * 隱藏右鍵選單
   */
  function hideContextMenu() {
    ContextMenu.closeContextMenu()
    contextItem.value = null
  }

  return {
    contextItem,
    showContextMenu,
    hideContextMenu,
    generateFileMenuItems,
    generateBatchMenuItems,
  }
}

export default useContextMenu
