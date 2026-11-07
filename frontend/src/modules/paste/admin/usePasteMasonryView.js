/**
 * 文字瀑布流檢視組合式函式
 * 管理文字瀑布流的列數、間距等配置
 */

import { ref, computed, watch } from "vue";
import { useLocalStorage, useWindowSize } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

export function usePasteMasonryView() {
  const log = createLogger("PasteMasonry");
  // ===== 設定持久化 =====

  const STORAGE_KEYS = {
    COLUMN_COUNT: "paste_masonry_column_count",
    HORIZONTAL_GAP: "paste_masonry_horizontal_gap",
    VERTICAL_GAP: "paste_masonry_vertical_gap",
  };

  // ===== 瀑布流設定狀態 =====

  // 列數控制 - 預設值（自動）
  const columnCount = useLocalStorage(STORAGE_KEYS.COLUMN_COUNT, "auto");

  // 水平和垂直間距 - 預設值
  const horizontalGap = useLocalStorage(STORAGE_KEYS.HORIZONTAL_GAP, 16);
  const verticalGap = useLocalStorage(STORAGE_KEYS.VERTICAL_GAP, 16);

  // 工具欄狀態管理
  const showViewSettings = ref(false);

  // 視窗寬度響應式狀態
  const { width: windowWidth } = useWindowSize({ initialWidth: 1024 });

  // ===== MasonryWall配置 =====

  // MasonryWall的gap直接使用水平間距（控制列間距）
  const baseGap = computed(() => horizontalGap.value);

  // MasonryWall列寬配置 - 響應式列寬
  const columnWidth = computed(() => {
    // 移動端：較寬的卡片以適應單列顯示
    if (windowWidth.value < 640) return 300; // 移動端：300px
    if (windowWidth.value < 1024) return 280; // 平板：280px
    return 260; // 桌面：260px
  });

  // 計算最小和最大列數 - 移動端優先
  const minColumns = computed(() => {
    if (columnCount.value === "auto") {
      return 1; // 自動模式：最少1列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列數模式：最小列數等於設定值
  });

  const maxColumns = computed(() => {
    if (columnCount.value === "auto") {
      // 自動模式：根據螢幕寬度限制最大列數
      if (windowWidth.value < 640) return 1; // 移動端：最多1列
      if (windowWidth.value < 1024) return 3; // 平板：最多3列
      return 4; // 桌面：最多4列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列數模式：最大列數等於設定值
  });

  // ===== 設定管理方法 =====

  // 檢查是否為預設設定
  const isDefaultSettings = computed(() => {
    return columnCount.value === "auto" && horizontalGap.value === 16 && verticalGap.value === 16;
  });

  // 重置瀑布流設定到預設值
  const resetMasonrySettings = () => {
    // 重置到預設值
    columnCount.value = "auto";
    horizontalGap.value = 16;
    verticalGap.value = 16;

    // 清除儲存中的設定
    columnCount.remove?.();
    horizontalGap.remove?.();
    verticalGap.remove?.();

    log.debug("文字瀑布流設定已重置為預設值");
  };

  // ===== 工具欄互動方法 =====

  const toggleViewSettings = () => {
    showViewSettings.value = !showViewSettings.value;
  };

  // ===== 監聽器設定 =====

  // 監聽設定變化（這裡主要用於列印日誌，持久化由 useLocalStorage 自動完成）
  const setupWatchers = () => {
    watch(columnCount, (newValue) => {
      log.debug(`文字瀑布流列數設定已儲存: ${newValue}`);
    });

    watch(horizontalGap, (newValue) => {
      log.debug(`文字瀑布流水平間距設定已儲存: ${newValue}px`);
    });

    watch(verticalGap, (newValue) => {
      log.debug(`文字瀑布流垂直間距設定已儲存: ${newValue}px`);
    });
  };

  // 清理監聽器
  const cleanupWatchers = () => {
  };

  // 返回所有需要的狀態和方法
  return {
    // 設定狀態
    columnCount,
    horizontalGap,
    verticalGap,
    showViewSettings,

    // MasonryWall配置
    baseGap,
    columnWidth,
    minColumns,
    maxColumns,

    // 設定管理
    isDefaultSettings,
    resetMasonrySettings,

    // 工具欄互動
    toggleViewSettings,

    // 初始化和清理方法
    setupWatchers,
    cleanupWatchers,
  };
}
