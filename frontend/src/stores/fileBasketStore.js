/**
 * 檔案籃 Pinia Store
 * 管理跨目錄檔案收集和批次操作的全域性狀態
 */

import { defineStore } from "pinia";
import { ref, computed, nextTick } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

export const useFileBasketStore = defineStore("fileBasket", () => {
  const log = createLogger("FileBasketStore");
  // ===== 狀態管理 =====

  // 收集的檔案列表 - 確保初始化為空陣列
  const collectedFiles = ref([]);

  // 檔案籃面板顯示狀態
  const isBasketOpen = ref(false);

  // 最後收集時間
  const lastCollectionTime = ref(null);

  // Store初始化狀態 - 預設為true，避免初始化時序問題
  const isInitialized = ref(true);

  // 自動清理配置
  const AUTO_CLEANUP_HOURS = 24; // 24小時後自動清理

  // localStorage鍵名
  const STORAGE_KEY = "cloudharbor_file_basket";
  const storedBasketData = useLocalStorage(STORAGE_KEY, null, { writeDefaults: false });
  const storedForceCleanFlag = useLocalStorage(STORAGE_KEY + "_force_clean", null, { writeDefaults: false });

  // ===== 計算屬性 =====

  /**
   * 收集的檔案數量
   */
  const collectionCount = computed(() => {
    // 確保Store已初始化且collectedFiles是有效陣列
    if (!isInitialized.value || !Array.isArray(collectedFiles.value)) {
      return 0;
    }
    return collectedFiles.value.length;
  });

  /**
   * 是否有收集的檔案
   */
  const hasCollection = computed(() => {
    return isInitialized.value && collectionCount.value > 0;
  });

  /**
   * 收集檔案的總大小（位元組）
   */
  const collectionTotalSize = computed(() => {
    if (!isInitialized.value || !Array.isArray(collectedFiles.value)) {
      return 0;
    }
    return collectedFiles.value.reduce((sum, file) => sum + (file.size || 0), 0);
  });

  /**
   * 收集檔案的總大小（MB）
   */
  const collectionTotalSizeMB = computed(() => {
    return Math.round((collectionTotalSize.value / (1024 * 1024)) * 100) / 100;
  });

  /**
   * 按目錄分組的檔案
   */
  const filesByDirectory = computed(() => {
    const groups = {};
    if (!isInitialized.value || !Array.isArray(collectedFiles.value)) {
      return groups;
    }

    collectedFiles.value.forEach((file) => {
      // 確保file物件存在且有必要的屬性
      if (!file || typeof file !== "object" || !file.path) {
        log.warn("發現無效的檔案物件，跳過:", file);
        return;
      }

      const dir = file.sourceDirectory || "/";
      if (!groups[dir]) {
        groups[dir] = [];
      }
      groups[dir].push(file);
    });
    return groups;
  });

  /**
   * 收集的目錄數量
   */
  const directoryCount = computed(() => {
    if (!isInitialized.value) {
      return 0;
    }
    return Object.keys(filesByDirectory.value).length;
  });

  // ===== 檔案收集方法 =====

  /**
   * 新增檔案到收集籃
   * @param {Object|Array} files - 檔案或檔案陣列
   * @param {string} currentPath - 當前目錄路徑
   */
  const addToBasket = (files, currentPath) => {
    // 確保collectedFiles是陣列
    if (!Array.isArray(collectedFiles.value)) {
      collectedFiles.value = [];
    }

    const fileArray = Array.isArray(files) ? files : [files];

    fileArray.forEach((file) => {
      // 驗證檔案物件的有效性
      if (!file || typeof file !== "object" || !file.path || !file.name) {
        log.warn("嘗試新增無效的檔案物件，跳過:", file);
        return;
      }

      // 檢查檔案是否已經在收集籃中（基於完整路徑）
      const existingIndex = collectedFiles.value.findIndex((collected) => collected.path === file.path);

      if (existingIndex === -1) {
        // 新增新檔案，包含來源目錄資訊
        const fileToAdd = {
          ...file,
          sourceDirectory: currentPath,
          collectedAt: new Date().toISOString(),
          uniqueId: `${currentPath}::${file.path}`, // 唯一標識
        };

        // 確保uniqueId存在
        if (!fileToAdd.uniqueId) {
          fileToAdd.uniqueId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        collectedFiles.value.push(fileToAdd);
      }
    });

    lastCollectionTime.value = new Date().toISOString();
    saveToStorage();
  };

  /**
   * 從收集籃移除檔案
   * @param {string|Array} filePaths - 檔案路徑或路徑陣列
   */
  const removeFromBasket = (filePaths) => {
    if (!Array.isArray(collectedFiles.value)) return;

    const pathArray = Array.isArray(filePaths) ? filePaths : [filePaths];

    pathArray.forEach((path) => {
      const index = collectedFiles.value.findIndex((file) => file.path === path);
      if (index !== -1) {
        collectedFiles.value.splice(index, 1);
      }
    });

    saveToStorage();
  };

  /**
   * 檢查檔案是否已在收集籃中
   * @param {string} filePath - 檔案路徑
   * @returns {boolean}
   */
  const isFileInBasket = (filePath) => {
    if (!isInitialized.value || !Array.isArray(collectedFiles.value)) {
      return false;
    }
    return collectedFiles.value.some((file) => file.path === filePath);
  };

  /**
   * 切換檔案的收集狀態
   * @param {Object} file - 檔案物件
   * @param {string} currentPath - 當前目錄路徑
   */
  const toggleFileInBasket = (file, currentPath) => {
    if (isFileInBasket(file.path)) {
      removeFromBasket(file.path);
    } else {
      addToBasket(file, currentPath);
    }
  };

  /**
   * 批次新增當前目錄的選中檔案
   * @param {Array} selectedFiles - 選中的檔案列表
   * @param {string} currentPath - 當前目錄路徑
   * @returns {number} 新增的檔案數量
   */
  const addSelectedToBasket = (selectedFiles, currentPath) => {
    // 只新增檔案，排除資料夾
    const fileItems = selectedFiles.filter((item) => !item.isDirectory);
    if (fileItems.length > 0) {
      addToBasket(fileItems, currentPath);
    }
    return fileItems.length;
  };

  // ===== 面板管理 =====

  /**
   * 開啟檔案籃面板
   */
  const openBasket = () => {
    isBasketOpen.value = true;
  };

  /**
   * 關閉檔案籃面板
   */
  const closeBasket = () => {
    isBasketOpen.value = false;
  };

  /**
   * 切換檔案籃面板顯示狀態
   */
  const toggleBasket = () => {
    isBasketOpen.value = !isBasketOpen.value;
  };

  // ===== 清理方法 =====

  /**
   * 清空收集籃
   */
  const clearBasket = () => {
    collectedFiles.value = [];
    lastCollectionTime.value = null;
    saveToStorage();
  };

  /**
   * 清空收集籃並關閉面板
   */
  const resetBasket = () => {
    clearBasket();
    closeBasket();
  };

  // ===== 持久化方法 =====

  /**
   * 儲存到localStorage
   */
  const saveToStorage = () => {
    try {
      const data = {
        collectedFiles: collectedFiles.value,
        lastCollectionTime: lastCollectionTime.value,
        savedAt: new Date().toISOString(),
      };
      storedBasketData.value = data;
    } catch (error) {
      log.error("儲存檔案籃狀態失敗:", error);
    }
  };

  /**
   * 從localStorage載入
   */
  const loadFromStorage = () => {
    try {
      const data = storedBasketData.value;
      if (data && typeof data === "object") {

        // 檢查資料是否過期（超過24小時）
        if (data.savedAt) {
          const savedTime = new Date(data.savedAt);
          const now = new Date();
          const hoursDiff = (now - savedTime) / (1000 * 60 * 60);

          if (hoursDiff > AUTO_CLEANUP_HOURS) {
            log.debug("檔案籃資料已過期，自動清理");
            clearBasket();
            return;
          }
        }

        // 嚴格驗證和清理資料
        if (Array.isArray(data.collectedFiles)) {
          const validFiles = [];

          data.collectedFiles.forEach((file) => {
            // 嚴格驗證檔案物件的完整性
            if (!file || typeof file !== "object" || !file.path || !file.name || typeof file.path !== "string" || typeof file.name !== "string") {
              log.warn("從localStorage載入時發現無效檔案物件，已過濾:", file);
              return;
            }

            // 驗證必需的數值欄位
            if (typeof file.size !== "number" || file.size < 0) {
              file.size = 0;
            }

            // 確保uniqueId存在且有效
            if (!file.uniqueId || typeof file.uniqueId !== "string") {
              file.uniqueId = `${file.sourceDirectory || "unknown"}::${file.path}`;
            }

            // 確保sourceDirectory存在
            if (!file.sourceDirectory || typeof file.sourceDirectory !== "string") {
              file.sourceDirectory = "/";
            }

            // 確保collectedAt存在
            if (!file.collectedAt) {
              file.collectedAt = new Date().toISOString();
            }

            validFiles.push(file);
          });

          collectedFiles.value = validFiles;
        } else {
          collectedFiles.value = [];
        }
        lastCollectionTime.value = data.lastCollectionTime || null;
      } else {
        // 沒有儲存資料時，確保初始化為空陣列
        collectedFiles.value = [];
        lastCollectionTime.value = null;
      }
    } catch (error) {
      log.error("載入檔案籃狀態失敗，清理localStorage:", error);
      // 清理損壞的儲存資料
      storedBasketData.remove?.();
      collectedFiles.value = [];
      lastCollectionTime.value = null;
    }
  };

  // ===== 獲取資訊方法 =====

  /**
   * 獲取收集摘要
   */
  const getCollectionSummary = () => {
    return {
      totalFiles: collectionCount.value,
      totalDirectories: directoryCount.value,
      totalSize: collectionTotalSize.value,
      totalSizeMB: collectionTotalSizeMB.value,
      filesByDirectory: filesByDirectory.value,
      lastCollectionTime: lastCollectionTime.value,
    };
  };

  /**
   * 獲取所有收集的檔案
   */
  const getCollectedFiles = () => {
    if (!isInitialized.value || !Array.isArray(collectedFiles.value)) {
      return [];
    }
    return [...collectedFiles.value];
  };

  /**
   * 強制清理localStorage中的檔案籃資料
   */
  const forceCleanStorage = () => {
    try {
      storedBasketData.remove?.();
      log.debug("已強制清理檔案籃localStorage資料");
    } catch (error) {
      log.error("強制清理localStorage失敗:", error);
    }
  };

  // 檢查是否需要強制清理（開發時臨時使用）
  if (storedForceCleanFlag.value) {
    forceCleanStorage();
    storedForceCleanFlag.remove?.();
  }

  // 立即初始化，但使用同步方式確保資料完整性
  loadFromStorage();

  return {
    // 狀態
    collectedFiles,
    isBasketOpen,
    lastCollectionTime,
    isInitialized,

    // 計算屬性
    collectionCount,
    hasCollection,
    collectionTotalSize,
    collectionTotalSizeMB,
    filesByDirectory,
    directoryCount,

    // 檔案收集方法
    addToBasket,
    removeFromBasket,
    isFileInBasket,
    toggleFileInBasket,
    addSelectedToBasket,

    // 面板管理
    openBasket,
    closeBasket,
    toggleBasket,

    // 清理方法
    clearBasket,
    resetBasket,

    // 獲取資訊方法
    getCollectionSummary,
    getCollectedFiles,

    // 持久化方法
    saveToStorage,
    loadFromStorage,
  };
});
