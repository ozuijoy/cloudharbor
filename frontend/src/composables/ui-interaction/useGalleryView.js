/**
 * 圖廊檢視組合式函式
 * 提供圖廊檢視的完整功能邏輯，包括設定管理、資料處理、MasonryWall配置等
 */

import { ref, computed, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useFsService } from "@/modules/fs";
import { decodeImagePreviewUrlToObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode";

const INITIAL_RENDER_LIMIT = 120;
const RENDER_BATCH = 120;
const MAX_CONCURRENT_IMAGE_REQUESTS = 6;

/**
 * @typedef {{ status: "idle" | "loading" | "loaded" | "error", url: string | null, decoded?: boolean, decodeAttempted?: boolean, naturalWidth?: number, naturalHeight?: number, aspectRatio?: number }} GalleryImageState
 */

/**
 * 圖廊邏輯入口
 * @param {{ items: import("vue").Ref<Array<any>> | import("vue").ComputedRef<Array<any>> }} input
 */
export function useGalleryView(input = {}) {
  const { t } = useI18n();
  const fsService = useFsService();
  const itemsRef = input.items;

  // ===== 設定持久化 =====
  const columnCount = useLocalStorage("gallery_column_count", "auto");
  const horizontalGap = useLocalStorage("gallery_horizontal_gap", 16);
  const verticalGap = useLocalStorage("gallery_vertical_gap", 20);
  const sortBy = useLocalStorage("gallery_sort_by", "name");

  // ===== 圖廊設定狀態 =====

  // 工具欄狀態管理
  const showSortMenu = ref(false);
  const showViewSettings = ref(false);

  // ===== MasonryWall配置 =====

  // MasonryWall的gap直接使用水平間距（控制列間距）
  const baseGap = computed(() => horizontalGap.value);

  // MasonryWall配置
  const columnWidth = computed(() => {
    // 固定列寬，讓MasonryWall根據min-columns和max-columns控制列數
    return 280; // 固定列寬280px
  });

  // 計算最小和最大列數
  const minColumns = computed(() => {
    if (columnCount.value === "auto") {
      return 1; // 自動模式：最少1列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列數模式：最小列數等於設定值
  });

  const maxColumns = computed(() => {
    if (columnCount.value === "auto") {
      return undefined; // 自動模式：無最大列數限制
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列數模式：最大列數等於設定值
  });

  // ===== 工具欄選項配置 =====

  const sortOptions = computed(() => [
    { value: "name", label: t("gallery.sortByName") },
    { value: "size", label: t("gallery.sortBySize") },
    { value: "date", label: t("gallery.sortByDate") },
    { value: "type", label: t("gallery.sortByType") },
  ]);

  // ===== 圖片資料處理 =====

  // 狀態驅動的圖片管理
  /** @type {import("vue").Ref<Map<string, GalleryImageState>>} */
  const imageStates = ref(new Map()); // key: image.path
  const renderLimit = ref(INITIAL_RENDER_LIMIT);

  const resetRenderWindow = () => {
    renderLimit.value = INITIAL_RENDER_LIMIT;
  };

  const clearImageStates = () => {
    imageStates.value.forEach((state) => {
      revokeObjectUrl(state?.url);
    });
    imageStates.value.clear();
  };

  // 智慧分組（依賴後端 type 欄位：IMAGE=5、VIDEO=2）
  const groups = computed(() => {
    const items = Array.isArray(itemsRef?.value) ? itemsRef.value : [];
    const allFolders = items.filter((item) => item?.isDirectory);
    const allImages = items.filter((item) => !item?.isDirectory && item?.type === 5);
    const allOtherFiles = items.filter((item) => !item?.isDirectory && item?.type !== 5 && item?.type !== 2);
    return { allFolders, allImages, allOtherFiles };
  });

  // 排序函式
  const sortImages = (images) => {
    const sorted = [...images];

    switch (sortBy.value) {
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "size":
        return sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
      case "date":
        return sorted.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
      case "type":
        return sorted.sort((a, b) => {
          const extA = a.name.split(".").pop().toLowerCase();
          const extB = b.name.split(".").pop().toLowerCase();
          return extA.localeCompare(extB);
        });
      default:
        return sorted;
    }
  };

  const allImages = computed(() => sortImages(groups.value.allImages));
  const allFolders = computed(() => groups.value.allFolders);
  const allOtherFiles = computed(() => groups.value.allOtherFiles);

  // 漸進渲染視窗
  const visibleImages = computed(() => {
    return allImages.value.slice(0, renderLimit.value);
  });

  const hasMoreImages = computed(() => {
    return renderLimit.value < allImages.value.length;
  });

  const loadMoreImages = () => {
    if (!hasMoreImages.value) return;
    renderLimit.value = Math.min(renderLimit.value + RENDER_BATCH, allImages.value.length);
  };

  // 將圖片資料轉換為MasonryWall需要的格式
  const masonryItems = computed(() => {
    return visibleImages.value.map((image, index) => ({
      id: image.path,
      image,
      index,
    }));
  });

  // ===== 圖片URL管理 =====

  const inFlight = new Map(); // key: image.path => Promise<void>
  /** @type {Array<{ image: any, signal?: AbortSignal, resolve: () => void, reject: (e: any) => void }>} */
  const queueHigh = [];
  /** @type {Array<{ image: any, signal?: AbortSignal, resolve: () => void, reject: (e: any) => void }>} */
  const queueNormal = [];
  let activeCount = 0;

  const ensureIdleState = (image) => {
    if (!image?.path) return;
    if (!imageStates.value.has(image.path)) {
      imageStates.value.set(image.path, { status: "idle", url: null });
    }
  };

  const dequeue = () => {
    if (queueHigh.length > 0) return queueHigh.shift();
    if (queueNormal.length > 0) return queueNormal.shift();
    return null;
  };

  const runQueue = () => {
    while (activeCount < MAX_CONCURRENT_IMAGE_REQUESTS) {
      const job = dequeue();
      if (!job) return;
      const { image, signal, resolve, reject } = job;
      const path = image?.path;
      if (!path) {
        resolve();
        continue;
      }
      if (signal?.aborted) {
        resolve();
        continue;
      }
      const state = imageStates.value.get(path);
      if (state?.status === "loaded" || state?.status === "loading") {
        resolve();
        continue;
      }

      activeCount += 1;
      void (async () => {
        try {
          await loadImageUrlInternal(image, { signal });
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          activeCount -= 1;
          runQueue();
        }
      })();
    }
  };

  const scheduleLoad = (image, { priority = "normal", signal } = {}) => {
    if (!image?.path) return Promise.resolve();
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job = { image, signal, resolve, reject };
      if (priority === "high") {
        queueHigh.push(job);
      } else {
        queueNormal.push(job);
      }
      runQueue();
    });
  };

  const loadImageUrlInternal = async (image, { signal } = {}) => {
    const imagePath = image?.path || "";
    if (!imagePath) return;
    if (signal?.aborted) return;

    const currentState = imageStates.value.get(imagePath);
    if (currentState?.status === "loading" || currentState?.status === "loaded") return;

    imageStates.value.set(imagePath, { ...(currentState || {}), status: "loading", url: null });

    try {
      // 圖廊允許併發：cancelPrevious=false（避免互相 Abort）
      const fileInfo = await fsService.getFileInfo(imagePath, { cancelPrevious: false, signal });
      if (signal?.aborted) return;

      const previewUrl = fileInfo?.previewUrl || "";
      if (!previewUrl) {
        imageStates.value.set(imagePath, { status: "error", url: null });
        return;
      }

      // HEIC/HEIF：按副檔名/型別預判，直接走 wasm 解碼，避免“先失敗再解碼”的二次開銷
      if (shouldAttemptDecodeImagePreview({ filename: image?.name || "", mimetype: image?.mimetype || "" })) {
        const decoded = await decodeImagePreviewUrlToObjectUrl({
          url: previewUrl,
          filename: image?.name || "",
          mimetype: image?.mimetype || "",
          signal,
          outputType: "image/webp",
          quality: 0.9,
        });

        const prevUrl = currentState?.url || "";
        revokeObjectUrl(prevUrl);

        imageStates.value.set(imagePath, {
          status: "loaded",
          url: decoded.objectUrl,
          decoded: true,
          decodeAttempted: true,
          naturalWidth: decoded.width,
          naturalHeight: decoded.height,
          aspectRatio: decoded.width && decoded.height ? decoded.width / decoded.height : undefined,
        });
        return;
      }

        imageStates.value.set(imagePath, { status: "loaded", url: previewUrl });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) return;
      imageStates.value.set(imagePath, { status: "error", url: null });
    }
  };

  /**
   * 外部呼叫：排程載入（帶優先順序/併發控制）
   * @param {any} image
   * @param {{ priority?: "high" | "normal"; signal?: AbortSignal }} [options]
   */
  const loadImageUrl = async (image, options = {}) => {
    const imagePath = image?.path || "";
    if (!imagePath) return;

    const currentState = imageStates.value.get(imagePath);
    if (currentState?.status === "loaded" || currentState?.status === "loading") return;

    if (inFlight.has(imagePath)) {
      return inFlight.get(imagePath);
    }

    const promise = scheduleLoad(image, options);

    inFlight.set(imagePath, promise);
    try {
      await promise;
    } finally {
      inFlight.delete(imagePath);
    }
  };

  // 隨著可見視窗變化，確保新進入視窗的圖片具備 idle state（供 Observer 判定）
  watch(
    visibleImages,
    (images) => {
      images.forEach((img) => ensureIdleState(img));
    },
    { immediate: true }
  );

  // items 切換（目錄切換/重新整理）：清空狀態，重置渲染視窗
  watch(
    () => itemsRef?.value,
    () => {
      clearImageStates();
      resetRenderWindow();
    }
  );

  // ===== 懶載入管理 =====

  // ===== 設定管理方法 =====

  // 檢查是否為預設設定
  const isDefaultSettings = computed(() => {
    return columnCount.value === "auto" && horizontalGap.value === 16 && verticalGap.value === 20 && sortBy.value === "name";
  });

  // 重置圖廊設定到預設值
  const resetGallerySettings = () => {
    // 重置到預設值
    columnCount.value = "auto";
    horizontalGap.value = 16;
    verticalGap.value = 20;
    sortBy.value = "name";
  };

  // ===== 工具欄互動方法 =====

  const toggleSortMenu = () => {
    showSortMenu.value = !showSortMenu.value;
    if (showSortMenu.value) {
      showViewSettings.value = false;
    }
  };

  const toggleViewSettings = () => {
    showViewSettings.value = !showViewSettings.value;
    if (showViewSettings.value) {
      showSortMenu.value = false;
    }
  };

  const handleSortChange = (sortValue) => {
    sortBy.value = sortValue;
    showSortMenu.value = false;
  };

  // ===== 監聽器設定 =====

  let watchersInitialized = false;

  // 相容舊呼叫：保留方法名
  const setupWatchers = () => {
    // 避免重複註冊
    if (watchersInitialized) return;
    watchersInitialized = true;
  };

  // 返回所有需要的狀態和方法
  return {
    // 資料
    allFolders,
    allImages,
    allOtherFiles,
    visibleImages,
    masonryItems,
    hasMoreImages,
    loadMoreImages,

    // 狀態
    columnCount,
    horizontalGap,
    verticalGap,
    sortBy,
    showSortMenu,
    showViewSettings,

    // MasonryWall配置
    baseGap,
    columnWidth,
    minColumns,
    maxColumns,

    // 工具欄配置
    sortOptions,

    // 圖片狀態
    imageStates,
    clearImageStates,
    resetRenderWindow,

    // 圖片URL管理
    loadImageUrl,

    // 設定管理
    isDefaultSettings,
    resetGallerySettings,

    // 工具欄互動
    toggleSortMenu,
    toggleViewSettings,
    handleSortChange,

    // 初始化方法
    setupWatchers,
  };
}
