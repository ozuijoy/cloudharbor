/**
 * 目錄排序管理 Composable
 * 處理檔案列表的排序邏輯和狀態管理
 * 
 * 排序設定現在由 useExplorerSettings 統一管理
 */

import { computed } from "vue";
import { useExplorerSettings } from "@/composables/useExplorerSettings";
import { createLogger } from "@/utils/logger.js";

export function useDirectorySort() {
  const log = createLogger("DirectorySort");
  // 獲取全域性設定
  const explorerSettings = useExplorerSettings();

  // ===== 排序狀態（從 explorerSettings 獲取）=====
  const sortField = computed(() => explorerSettings.settings.sortBy);
  const sortOrder = computed(() => explorerSettings.settings.sortOrder);
  const foldersFirst = computed(() => explorerSettings.settings.foldersFirst);

  // ===== 計算屬性 =====

  /**
   * 當前排序狀態的描述
   */
  const sortDescription = computed(() => {
    const fieldNames = {
      name: "名稱",
      size: "大小", 
      modified: "修改時間",
      type: "型別"
    };
    
    const orderNames = {
      asc: "升序",
      desc: "降序"
    };
    
    return `按${fieldNames[sortField.value]}${orderNames[sortOrder.value]}`;
  });

  /**
   * 是否為預設排序
   */
  const isDefaultSort = computed(() => 
    sortField.value === 'name' && sortOrder.value === 'asc' && foldersFirst.value
  );

  /**
   * 是否為自定義排序
   */
  const isCustomSort = computed(() => !isDefaultSort.value);

  // ===== 持久化方法 =====

  /**
   * 初始化排序狀態（從 useExplorerSettings 載入）
   */
  const initializeSortState = () => {
    // 排序狀態已由 useExplorerSettings.loadSettings() 自動載入
    log.debug("排序狀態已初始化:", {
      field: sortField.value,
      order: sortOrder.value,
      foldersFirst: foldersFirst.value,
    });
  };

  /**
   * 重置排序狀態為預設值
   */
  const resetSortState = () => {
    explorerSettings.updateSetting('sortBy', 'name');
    explorerSettings.updateSetting('sortOrder', 'asc');
    explorerSettings.updateSetting('foldersFirst', true);
  };

  // ===== 排序控制方法 =====

  /**
   * 點選表頭排序
   * @param {string} field - 排序欄位
   */
  const handleSort = (field) => {
    if (!["name", "size", "modified", "type"].includes(field)) {
      log.warn("無效的排序欄位:", field);
      return;
    }

    if (sortField.value === field) {
      // 同一欄位，切換排序順序
      explorerSettings.toggleSortOrder();
    } else {
      // 不同欄位，設定為該欄位升序
      explorerSettings.updateSetting('sortBy', field);
      explorerSettings.updateSetting('sortOrder', 'asc');
    }
  };

  /**
   * 設定特定的排序狀態
   * @param {string} field - 排序欄位
   * @param {string} order - 排序順序
   */
  const setSortState = (field, order) => {
    if (!["name", "size", "modified", "type"].includes(field)) {
      log.warn("無效的排序欄位:", field);
      return;
    }

    if (!["asc", "desc"].includes(order)) {
      log.warn("無效的排序順序:", order);
      return;
    }

    explorerSettings.updateSetting('sortBy', field);
    explorerSettings.updateSetting('sortOrder', order);
  };

  // ===== UI輔助方法 =====

  /**
   * 獲取排序圖示
   * @param {string} field - 欄位名
   * @returns {string} 排序圖示
   */
  const getSortIcon = (field) => {
    if (sortField.value !== field) {
      return ""; // 非當前排序欄位不顯示圖示
    }
    return sortOrder.value === "asc" ? "↑" : "↓";
  };

  /**
   * 獲取排序圖示類名（用於CSS圖示）
   * @param {string} field - 欄位名
   * @returns {string} CSS類名
   */
  const getSortIconClass = (field) => {
    if (sortField.value !== field) {
      return "";
    }
    return sortOrder.value === "asc" ? "sort-asc" : "sort-desc";
  };

  /**
   * 檢查欄位是否為當前排序欄位
   * @param {string} field - 欄位名
   * @returns {boolean} 是否為當前排序欄位
   */
  const isCurrentSortField = (field) => {
    return sortField.value === field;
  };

  /**
   * 獲取欄位的排序狀態
   * @param {string} field - 欄位名
   * @returns {Object} 排序狀態資訊
   */
  const getFieldSortState = (field) => {
    return {
      isActive: sortField.value === field,
      order: sortField.value === field ? sortOrder.value : null,
      icon: getSortIcon(field),
      iconClass: getSortIconClass(field),
    };
  };

  // ===== 排序演算法 =====

  /**
   * 對專案列表進行排序
   * @param {Array} items - 原始專案列表
   * @returns {Array} 排序後的專案列表
   */
  const sortItems = (items) => {
    if (!items || !Array.isArray(items)) {
      return [];
    }

    let sortedItems = [...items];

    return sortedItems.sort((a, b) => {
      // 資料夾優先（如果啟用）
      if (foldersFirst.value) {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
      }

      let comparison = 0;

      switch (sortField.value) {
        case "name":
          comparison = a.name.localeCompare(b.name, undefined, { 
            numeric: true, 
            sensitivity: "base" 
          });
          break;
        case "size":
          // 虛擬目錄的大小視為0
          const aSize = a.isDirectory && a.isVirtual ? 0 : a.size || 0;
          const bSize = b.isDirectory && b.isVirtual ? 0 : b.size || 0;
          comparison = aSize - bSize;
          break;
        case "modified":
          // 虛擬目錄沒有修改時間，視為最早
          const aTime = a.isDirectory && a.isVirtual ? 0 : new Date(a.modified || 0).getTime();
          const bTime = b.isDirectory && b.isVirtual ? 0 : new Date(b.modified || 0).getTime();
          comparison = aTime - bTime;
          break;
        case "type":
          // 按副檔名排序
          const aExt = a.isDirectory ? '' : (a.name.split('.').pop() || '').toLowerCase();
          const bExt = b.isDirectory ? '' : (b.name.split('.').pop() || '').toLowerCase();
          comparison = aExt.localeCompare(bExt);
          break;
        default:
          comparison = a.name.localeCompare(b.name, undefined, { 
            numeric: true, 
            sensitivity: "base" 
          });
      }

      return sortOrder.value === "asc" ? comparison : -comparison;
    });
  };

  /**
   * 建立排序後的計算屬性
   * @param {Ref} itemsRef - 專案列表的響應式引用
   * @returns {ComputedRef} 排序後的專案列表
   */
  const createSortedItems = (itemsRef) => {
    return computed(() => sortItems(itemsRef.value));
  };

  /**
   * 獲取排序配置物件（用於API呼叫或其他用途）
   * @returns {Object} 排序配置
   */
  const getSortConfig = () => {
    return {
      field: sortField.value,
      order: sortOrder.value,
      foldersFirst: foldersFirst.value,
      isDefault: isDefaultSort.value,
      description: sortDescription.value,
    };
  };

  return {
    // 狀態
    sortField,
    sortOrder,
    foldersFirst,

    // 計算屬性
    sortDescription,
    isDefaultSort,
    isCustomSort,

    // 持久化方法
    initializeSortState,
    resetSortState,

    // 排序控制方法
    handleSort,
    setSortState,

    // UI輔助方法
    getSortIcon,
    getSortIconClass,
    isCurrentSortField,
    getFieldSortState,

    // 排序演算法
    sortItems,
    createSortedItems,

    // 工具方法
    getSortConfig,
  };
}
