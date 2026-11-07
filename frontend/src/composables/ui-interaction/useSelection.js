/**
 * 選擇狀態管理組合式函式
 * 管理檔案列表的選擇狀態和批次操作
 */

import { ref, computed } from "vue";
import { formatFileSize } from "@/utils/fileUtils.js";

export function useSelection() {
  // ===== 狀態管理 =====
  const isCheckboxMode = ref(false);
  const selectedItems = ref([]);
  const availableItems = ref([]);

  // ===== 計算屬性 =====
  const selectedCount = computed(() => selectedItems.value.length);

  const hasSelection = computed(() => selectedCount.value > 0);

  const isAllSelected = computed(() => {
    return selectedItems.value.length > 0 && selectedItems.value.length === availableItems.value.length;
  });

  const isPartiallySelected = computed(() => {
    return selectedItems.value.length > 0 && selectedItems.value.length < availableItems.value.length;
  });

  // ===== 專案管理方法 =====

  /**
   * 設定可選擇的專案列表
   * @param {Array} items - 專案列表
   */
  const setAvailableItems = (items) => {
    availableItems.value = items || [];
    // 清理已選擇但不在當前列表中的專案
    selectedItems.value = selectedItems.value.filter((selectedItem) =>
      items.some((item) => item.path === selectedItem.path)
    );
  };

  /**
   * 獲取可選擇的專案列表
   * @returns {Array} 可選擇的專案列表
   */
  const getAvailableItems = () => {
    return [...availableItems.value];
  };

  // ===== 選擇模式管理 =====

  /**
   * 切換選擇模式
   * @param {boolean} enabled - 是否啟用選擇模式
   */
  const toggleCheckboxMode = (enabled = null) => {
    if (enabled === null) {
      isCheckboxMode.value = !isCheckboxMode.value;
    } else {
      isCheckboxMode.value = enabled;
    }

    // 退出選擇模式時清空選擇
    if (!isCheckboxMode.value) {
      clearSelection();
    }
  };

  /**
   * 啟用選擇模式
   */
  const enableCheckboxMode = () => {
    toggleCheckboxMode(true);
  };

  /**
   * 禁用選擇模式
   */
  const disableCheckboxMode = () => {
    toggleCheckboxMode(false);
  };

  // ===== 單項選擇方法 =====

  /**
   * 選擇或取消選擇專案
   * @param {Object} item - 專案物件
   * @param {boolean} selected - 是否選擇
   */
  const selectItem = (item, selected) => {
    if (!item || !item.path) return;

    const index = selectedItems.value.findIndex((selectedItem) => selectedItem.path === item.path);

    if (selected && index === -1) {
      // 新增到選擇列表
      selectedItems.value.push(item);
    } else if (!selected && index !== -1) {
      // 從選擇列表移除
      selectedItems.value.splice(index, 1);
    }
  };

  /**
   * 切換專案選擇狀態
   * @param {Object} item - 專案物件
   */
  const toggleItemSelection = (item) => {
    const isSelected = isItemSelected(item);
    selectItem(item, !isSelected);
  };

  /**
   * 檢查專案是否被選擇
   * @param {Object} item - 專案物件
   * @returns {boolean} 是否被選擇
   */
  const isItemSelected = (item) => {
    if (!item || !item.path) return false;

    return selectedItems.value.some((selectedItem) => selectedItem.path === item.path);
  };

  /**
   * 新增專案到選擇列表（如果未選擇）
   * @param {Object} item - 專案物件
   */
  const addToSelection = (item) => {
    if (!isItemSelected(item)) {
      selectItem(item, true);
    }
  };

  /**
   * 從選擇列表移除專案
   * @param {Object} item - 專案物件
   */
  const removeFromSelection = (item) => {
    if (isItemSelected(item)) {
      selectItem(item, false);
    }
  };

  // ===== 批次選擇方法 =====

  /**
   * 全選或取消全選
   * @param {boolean} selectAll - 是否全選
   */
  const toggleSelectAll = (selectAll = null) => {
    if (selectAll === null) {
      selectAll = !isAllSelected.value;
    }

    if (selectAll) {
      // 全選：新增所有未選擇的專案
      availableItems.value.forEach((item) => {
        if (!isItemSelected(item)) {
          selectedItems.value.push(item);
        }
      });
    } else {
      // 取消全選：清空選擇
      clearSelection();
    }
  };

  /**
   * 全選所有專案
   */
  const selectAll = () => {
    toggleSelectAll(true);
  };

  /**
   * 取消全選
   */
  const deselectAll = () => {
    toggleSelectAll(false);
  };

  /**
   * 反選所有專案
   */
  const invertSelection = () => {
    const newSelection = availableItems.value.filter((item) => !isItemSelected(item));
    selectedItems.value = newSelection;
  };

  /**
   * 選擇指定範圍的專案
   * @param {number} startIndex - 開始索引
   * @param {number} endIndex - 結束索引
   */
  const selectRange = (startIndex, endIndex) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    for (let i = start; i <= end && i < availableItems.value.length; i++) {
      const item = availableItems.value[i];
      if (!isItemSelected(item)) {
        selectedItems.value.push(item);
      }
    }
  };

  // ===== 清理方法 =====

  /**
   * 清空所有選擇
   */
  const clearSelection = () => {
    selectedItems.value = [];
  };

  /**
   * 重置選擇狀態
   */
  const resetSelection = () => {
    isCheckboxMode.value = false;
    selectedItems.value = [];
    availableItems.value = [];
  };

  // ===== 獲取選擇資訊方法 =====

  /**
   * 獲取選擇的專案列表
   * @returns {Array} 選擇的專案列表
   */
  const getSelectedItems = () => {
    return [...selectedItems.value];
  };

  /**
   * 獲取選擇的檔案列表（排除目錄）
   * @returns {Array} 選擇的檔案列表
   */
  const getSelectedFiles = () => {
    return selectedItems.value.filter((item) => !item.isDirectory);
  };

  /**
   * 獲取選擇的目錄列表
   * @returns {Array} 選擇的目錄列表
   */
  const getSelectedDirectories = () => {
    return selectedItems.value.filter((item) => item.isDirectory);
  };

  /**
   * 檢查選擇中是否包含目錄
   * @returns {boolean} 是否包含目錄
   */
  const hasSelectedDirectories = () => {
    return selectedItems.value.some((item) => item.isDirectory);
  };

  /**
   * 檢查選擇中是否包含檔案
   * @returns {boolean} 是否包含檔案
   */
  const hasSelectedFiles = () => {
    return selectedItems.value.some((item) => !item.isDirectory);
  };

  /**
   * 獲取選擇專案的總大小
   * @returns {number} 總大小（位元組）
   */
  const getSelectedTotalSize = () => {
    return selectedItems.value.reduce((total, item) => {
      return total + (item.size || 0);
    }, 0);
  };

  /**
   * 格式化選擇專案的總大小
   * @returns {string} 格式化後的大小
   */
  const getSelectedTotalSizeFormatted = () => {
    const totalSize = getSelectedTotalSize();
    return formatFileSize(totalSize);
  };

  /**
   * 獲取選擇摘要資訊
   * @returns {Object} 選擇摘要
   */
  const getSelectionSummary = () => {
    const files = getSelectedFiles();
    const directories = getSelectedDirectories();

    return {
      total: selectedCount.value,
      files: files.length,
      directories: directories.length,
      totalSize: getSelectedTotalSize(),
      totalSizeFormatted: getSelectedTotalSizeFormatted(),
      hasFiles: files.length > 0,
      hasDirectories: directories.length > 0,
      isAllFiles: files.length === selectedCount.value,
      isAllDirectories: directories.length === selectedCount.value,
    };
  };

  /**
   * 獲取選擇的路徑列表
   * @returns {Array} 路徑列表
   */
  const getSelectedPaths = () => {
    return selectedItems.value.map((item) => item.path);
  };

  /**
   * 獲取選擇的名稱列表
   * @returns {Array} 名稱列表
   */
  const getSelectedNames = () => {
    return selectedItems.value.map((item) => item.name);
  };

  // ===== 查詢方法 =====

  /**
   * 根據路徑查詢選擇的專案
   * @param {string} path - 檔案路徑
   * @returns {Object|null} 找到的專案或null
   */
  const findSelectedItemByPath = (path) => {
    return selectedItems.value.find((item) => item.path === path) || null;
  };

  /**
   * 檢查是否選擇了指定路徑的專案
   * @param {string} path - 檔案路徑
   * @returns {boolean} 是否選擇
   */
  const isPathSelected = (path) => {
    return selectedItems.value.some((item) => item.path === path);
  };

  /**
   * 獲取選擇專案的索引列表
   * @returns {Array} 索引列表
   */
  const getSelectedIndices = () => {
    return selectedItems.value
      .map((selectedItem) => {
        return availableItems.value.findIndex((item) => item.path === selectedItem.path);
      })
      .filter((index) => index !== -1);
  };

  return {
    // 狀態 - 直接返回ref，讓Vue在模板中自動解包
    isCheckboxMode,
    selectedItems,

    // 計算屬性
    selectedCount,
    hasSelection,
    isAllSelected,
    isPartiallySelected,

    // 專案管理方法
    setAvailableItems,
    getAvailableItems,

    // 選擇模式管理
    toggleCheckboxMode,
    enableCheckboxMode,
    disableCheckboxMode,

    // 單項選擇方法
    selectItem,
    toggleItemSelection,
    isItemSelected,
    addToSelection,
    removeFromSelection,

    // 批次選擇方法
    toggleSelectAll,
    selectAll,
    deselectAll,
    invertSelection,
    selectRange,

    // 清理方法
    clearSelection,
    resetSelection,

    // 獲取選擇資訊方法
    getSelectedItems,
    getSelectedFiles,
    getSelectedDirectories,
    hasSelectedDirectories,
    hasSelectedFiles,
    getSelectedTotalSize,
    getSelectedTotalSizeFormatted,
    getSelectionSummary,
    getSelectedPaths,
    getSelectedNames,

    // 查詢方法
    findSelectedItemByPath,
    isPathSelected,
    getSelectedIndices,
  };
}
