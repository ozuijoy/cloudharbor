<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div
      class="relative w-full max-w-sm sm:max-w-lg bg-white dark:bg-gray-800 rounded-lg shadow-xl max-h-[85vh] sm:max-h-[80vh] overflow-hidden"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
    >
      <!-- 標題欄 -->
      <div class="px-4 py-3 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-lg font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ t("mount.copyModal.title") }}</h3>
        <button @click="closeModal" class="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400">
          <IconClose aria-hidden="true" />
        </button>
      </div>

      <!-- 內容區 -->
      <div class="p-3 sm:p-4 overflow-y-auto" style="max-height: calc(85vh - 140px)">
        <!-- 已選專案資訊 -->
        <div class="mb-3 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
          {{
            t("mount.copyModal.selectedInfo", {
              count: selectedItems.length,
              folders: selectedItems.filter((item) => item.isDirectory).length,
              files: selectedItems.filter((item) => !item.isDirectory).length,
            })
          }}
        </div>

        <!-- 當前路徑 -->
        <div class="mb-3 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          {{ t("mount.copyModal.targetLocation") }} <span class="font-bold">{{ currentPath }}</span>
        </div>

        <!-- 警告資訊 -->
        <div v-if="pathWarning" class="mb-3 p-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-md">
          <div class="flex items-start">
            <IconExclamation class="text-yellow-500 dark:text-yellow-400 mt-0.5 mr-2 flex-shrink-0" aria-hidden="true" />
            <span class="text-sm text-yellow-700 dark:text-yellow-300">{{ pathWarning }}</span>
          </div>
        </div>

        <!-- 目錄樹 -->
        <div class="border rounded-md overflow-hidden mb-4 h-64" :class="darkMode ? 'border-gray-700' : 'border-gray-300'">
          <!-- 載入狀態 -->
          <div v-if="loading" class="h-full flex justify-center items-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            <IconRefresh class="animate-spin mr-2" aria-hidden="true" />
            <span>{{ t("mount.copyModal.loading") }}</span>
          </div>

          <div v-else class="h-full overflow-y-auto p-1">
            <!-- 目錄樹結構 -->
            <div class="file-tree">
              <!-- 根目錄 -->
              <div class="tree-item" :class="{ selected: currentPath === userBasicPath }" @click="selectDestination(userBasicPath)">
                <div class="flex items-center py-2 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                  <IconHome size="sm" class="flex-shrink-0 mr-2" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" aria-hidden="true" />
                  <span class="truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ rootDisplayName }}</span>
                </div>
              </div>

              <!-- 遞迴渲染目錄樹 -->
              <div v-for="item in rootDirectories" :key="item.path" class="folder-item">
                <DirectoryItemVue :item="item" :current-path="currentPath" :dark-mode="darkMode" :fs-api="fsApi" :level="0" @select="selectDestination" />
              </div>
            </div>
          </div>
        </div>

        <!-- 複製選項 -->
        <div class="mb-4 flex items-center">
          <label class="flex items-center cursor-pointer select-none">
            <input
              type="checkbox"
              v-model="skipExisting"
              class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-700"
            />
            <span class="ml-2 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ t("mount.copyModal.skipExisting") }}
            </span>
          </label>
          <div class="ml-2 group relative">
            <IconInformationCircle size="sm" class="text-gray-400 dark:text-gray-500 cursor-help" aria-hidden="true" />
            <div
              class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-xs rounded-md shadow-lg whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10"
              :class="darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-white'"
            >
              {{ t("mount.copyModal.skipExistingTooltip") }}
              <div
                class="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent"
                :class="darkMode ? 'border-t-gray-700' : 'border-t-gray-800'"
              ></div>
            </div>
          </div>
        </div>

        <!-- 操作按鈕 -->
        <div class="flex justify-end space-x-3">
          <button
            @click="closeModal"
            class="px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
            :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
          >
            {{ t("mount.copyModal.cancel") }}
          </button>
          <button
            @click="confirmCopy"
            class="px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            :class="[darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white', copying ? 'opacity-70 cursor-not-allowed' : '']"
            :disabled="copying"
          >
            {{ copying ? t("mount.copyModal.copying") : t("mount.copyModal.confirmCopy") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 確認對話方塊 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
  import { ref, watch, computed, shallowRef } from "vue";
  import { useI18n } from "vue-i18n";
  import { useTaskManager, TaskType } from "@/utils/taskManager.js";
  import { useFsService } from "@/modules/fs";
  import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
  import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
  import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
  import { IconClose, IconExclamation, IconHome, IconInformationCircle, IconRefresh } from "@/components/icons";
  import { createLogger } from "@/utils/logger.js";

  const { t } = useI18n();
  const fsApi = useFsService();
  const { showError } = useGlobalMessage();
  const log = createLogger("CopyModal");

// 確認對話方塊
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 註冊遞迴元件
import { h } from "vue";

// 目錄快取物件，用於儲存已載入的目錄內容
const directoryCache = shallowRef(new Map());

// 建立目錄項元件
const DirectoryItemVue = {
  name: "DirectoryItemVue",
  props: {
    item: {
      type: Object,
      required: true,
    },
    currentPath: {
      type: String,
      required: true,
    },
    darkMode: {
      type: Boolean,
      default: false,
    },
    fsApi: {
      type: Object,
      required: true,
    },
    level: {
      type: Number,
      default: 0,
    },
  },
  emits: ["select"],
  setup(props, { emit }) {
    const expanded = ref(false);
    const children = shallowRef([]);
    const loading = ref(false);

    // 載入子目錄
    const loadChildren = async () => {
      const cacheKey = props.item.path;
      if (directoryCache.value.has(cacheKey)) {
        children.value = directoryCache.value.get(cacheKey);
        return;
      }

      loading.value = true;
      try {
        const data = await props.fsApi.getDirectoryList(props.item.path);
        const items = Array.isArray(data?.items) ? data.items : [];
        const dirItems = items.filter((item) => item && item.isDirectory);

        children.value = dirItems;
        directoryCache.value.set(cacheKey, dirItems);
      } catch (error) {
        children.value = [];
      } finally {
        loading.value = false;
      }
    };

    // 監聽當前路徑變化
    watch(
      () => props.currentPath,
      (newPath) => {
        // 如果當前路徑是此節點的子路徑，自動展開
        if (newPath.startsWith(props.item.path + "/") && newPath !== props.item.path + "/") {
          expanded.value = true;
          if (children.value.length === 0) {
            loadChildren();
          }
        }
      },
      { immediate: true }
    );

    // 計算是否被選中
    const isSelected = computed(() => {
      return props.currentPath === props.item.path + "/";
    });

    // 切換展開/摺疊狀態
    const toggleExpand = (event) => {
      event.stopPropagation();

      if (expanded.value) {
        expanded.value = false;
        return;
      }

      expanded.value = true;
      if (children.value.length === 0) {
        loadChildren();
      }
    };

    // 選擇當前目錄
    const selectFolder = () => {
      emit("select", props.item.path);
    };

    return {
      expanded,
      children,
      loading,
      isSelected,
      toggleExpand,
      selectFolder,
    };
  },
  render() {
    // 使用渲染函式代替模板，以確保遞迴元件正確渲染
    return h("div", { class: "directory-item" }, [
      h(
        "div",
        {
          class: ["tree-item", { selected: this.isSelected }],
          onClick: this.selectFolder,
        },
        [
          h(
            "div",
            {
              class: "flex items-center py-2 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer",
              style: { paddingLeft: `${this.level * 0.75 + 0.5}rem` }, // 增加層級縮排值
            },
            [
              h(
                "div",
                {
                  class: "folder-toggle",
                  onClick: (e) => {
                    e.stopPropagation();
                    this.toggleExpand(e);
                  },
                },
                [
                  this.expanded
                    ? h(
                        "svg",
                        {
                          class: "h-4 w-4",
                          xmlns: "http://www.w3.org/2000/svg",
                          fill: "none",
                          viewBox: "0 0 24 24",
                          stroke: "currentColor",
                          "stroke-width": "2",
                        },
                        [
                          h("path", {
                            "stroke-linecap": "round",
                            "stroke-linejoin": "round",
                            d: "M19 9l-7 7-7-7",
                          }),
                        ]
                      )
                    : h(
                        "svg",
                        {
                          class: "h-4 w-4",
                          xmlns: "http://www.w3.org/2000/svg",
                          fill: "none",
                          viewBox: "0 0 24 24",
                          stroke: "currentColor",
                          "stroke-width": "2",
                        },
                        [
                          h("path", {
                            "stroke-linecap": "round",
                            "stroke-linejoin": "round",
                            d: "M9 5l7 7-7 7",
                          }),
                        ]
                      ),
                ]
              ),
              h(
                "svg",
                {
                  class: ["h-4 w-4 flex-shrink-0 mr-2", this.darkMode ? "text-yellow-400" : "text-yellow-600"],
                  xmlns: "http://www.w3.org/2000/svg",
                  fill: "none",
                  viewBox: "0 0 24 24",
                  stroke: "currentColor",
                  "stroke-width": "2",
                },
                [
                  h("path", {
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    d: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
                  }),
                ]
              ),
              h(
                "span",
                {
                  class: ["truncate", this.darkMode ? "text-gray-200" : "text-gray-700"],
                },
                this.item.name
              ),
            ]
          ),
        ]
      ),
      this.expanded
        ? h("div", { class: "folder-children" }, [
            this.loading
              ? h(
                  "div",
                  {
                    class: "folder-loading",
                    style: { paddingLeft: `${(this.level + 1) * 0.75 + 0.75}rem` },
                  },
                  [
                    h(
                      "svg",
                      {
                        class: "animate-spin h-3 w-3 mr-1",
                        xmlns: "http://www.w3.org/2000/svg",
                        fill: "none",
                        viewBox: "0 0 24 24",
                      },
                      [
                        h("circle", {
                          class: "opacity-25",
                          cx: "12",
                          cy: "12",
                          r: "10",
                          stroke: "currentColor",
                          "stroke-width": "4",
                        }),
                        h("path", {
                          class: "opacity-75",
                          fill: "currentColor",
                          d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z",
                        }),
                      ]
                    ),
                    h("span", { class: "text-xs" }, t("mount.copyModal.loading")),
                  ]
                )
              : this.children.length === 0
              ? null // 如果沒有子目錄，不顯示任何內容
              : this.children.map((child) =>
                  h("div", { class: "folder-item", key: child.path }, [
                    h(DirectoryItemVue, {
                      item: child,
                      currentPath: this.currentPath,
                      darkMode: this.darkMode,
                      fsApi: this.fsApi,
                      level: this.level + 1, // 增加層級深度
                      onSelect: (path) => this.$emit("select", path),
                    }),
                  ])
                ),
          ])
        : null,
    ]);
  },
};

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  selectedItems: {
    type: Array,
    default: () => [],
  },
  sourcePath: {
    type: String,
    default: "/",
  },
  isAdmin: {
    type: Boolean,
    default: true,
  },
  apiKeyInfo: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["close", "copy-started"]);

// 計算使用者的基本路徑
const userBasicPath = computed(() => {
  if (props.isAdmin) {
    return "/";
  }
  return props.apiKeyInfo?.basic_path || "/";
});

// 計算根路徑顯示名稱
const rootDisplayName = computed(() => {
  if (props.isAdmin) {
    return t("mount.copyModal.rootDirectory");
  }
  // 對於API金鑰使用者，顯示基本路徑的最後一段作為根目錄名稱
  const basicPath = userBasicPath.value;
  if (basicPath === "/") {
    return t("mount.copyModal.rootDirectory");
  }
  const pathParts = basicPath.split("/").filter((part) => part);
  return pathParts.length > 0 ? pathParts[pathParts.length - 1] : t("mount.copyModal.rootDirectory");
});

// 狀態變數
const currentPath = ref("/");
const rootDirectories = shallowRef([]);
const loading = ref(false);
const copying = ref(false);
const pathWarning = ref(""); // 新增路徑警告狀態
const skipExisting = ref(true); // 預設跳過已存在的檔案

// 清除目錄快取的函式，在模態視窗關閉時呼叫
const clearDirectoryCache = () => {
  directoryCache.value.clear();
};

// 載入根目錄內容
const loadRootDirectories = async () => {
  const rootPath = userBasicPath.value;

  const cacheKey = rootPath;
  if (directoryCache.value.has(cacheKey)) {
    rootDirectories.value = directoryCache.value.get(cacheKey);
    return;
  }

  loading.value = true;
  try {
    const data = await fsApi.getDirectoryList(rootPath);
    const items = Array.isArray(data?.items) ? data.items : [];
    const dirItems = items.filter((item) => item && item.isDirectory);

    rootDirectories.value = dirItems;
    directoryCache.value.set(cacheKey, dirItems);
  } catch (error) {
    rootDirectories.value = [];
  } finally {
    loading.value = false;
  }
};

// 監聽模態視窗開啟狀態
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      // 當模態視窗開啟時，設定初始路徑為使用者的基本路徑
      currentPath.value = userBasicPath.value;
      loadRootDirectories();
    } else {
      // 當模態視窗關閉時，清除目錄快取
      clearDirectoryCache();
    }
  },
  // 關鍵：當 CopyModal 元件“首次掛載時就已經是開啟狀態”（例如非同步載入 + 首次開啟才渲染）也要立刻初始化
  { immediate: true }
);

// 關閉模態視窗
const closeModal = () => {
  if (copying.value) return; // 如果正在複製，不允許關閉
  emit("close");
};

// 選擇目標位置
const selectDestination = (path) => {
  // 確保路徑格式正確
  let formattedPath = path;
  if (!formattedPath.endsWith("/")) {
    formattedPath = formattedPath + "/";
  }

  // 對於API金鑰使用者，確保選擇的路徑在基本路徑範圍內
  if (!props.isAdmin) {
    const basicPath = userBasicPath.value;
    const normalizedBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
    const normalizedSelectedPath = formattedPath.replace(/\/+$/, "") || "/";

    // 特殊處理：如果基本路徑是根目錄，允許選擇任何路徑
    if (normalizedBasicPath !== "/") {
      // 檢查選擇的路徑是否在基本路徑範圍內
      if (normalizedSelectedPath !== normalizedBasicPath && !normalizedSelectedPath.startsWith(normalizedBasicPath + "/")) {
        // 如果選擇的路徑不在基本路徑範圍內，重置為基本路徑
        formattedPath = basicPath.endsWith("/") ? basicPath : basicPath + "/";
      }
    }
  }

  currentPath.value = formattedPath;

  // 清除之前的警告
  pathWarning.value = "";

  // 驗證路徑
  validateDestinationPath();
};

// 驗證目標路徑
const validateDestinationPath = () => {
  // 檢查是否有選擇的專案
  if (!props.selectedItems || props.selectedItems.length === 0) return;

  // 檢查是否存在將資料夾複製到其自身或其子目錄的情況
  for (const item of props.selectedItems) {
    if (item.isDirectory) {
      const sourcePath = item.path.endsWith("/") ? item.path : item.path + "/";

      // 檢查目標路徑是否是源路徑的子目錄
      if (currentPath.value.startsWith(sourcePath)) {
        pathWarning.value = t("mount.copyModal.warnings.recursiveCopy");
        return;
      }

      // 檢查是否將資料夾複製到其自身
      if (currentPath.value === sourcePath) {
        pathWarning.value = t("mount.copyModal.warnings.selfCopy");
        return;
      }
    }
  }
};

// 準備複製專案
const prepareCopyItems = () => {
  return props.selectedItems.map((item) => {
    // 確保目標路徑正確拼接，避免雙斜槓
    const basePath = currentPath.value.endsWith('/') ? currentPath.value : currentPath.value + '/';
    return {
      sourcePath: item.path,
      targetPath: `${basePath}${item.name}`,
    };
  });
};


// 建立複製任務
const createCopyTask = (itemCount, jobId = null) => {
  const taskManager = useTaskManager();
  const taskId = taskManager.addTask(TaskType.COPY, t("mount.taskManager.copyTaskName", { count: itemCount, path: currentPath.value }), itemCount);

  // 準備任務詳情
  const taskDetails = {
    total: itemCount,
    processed: 0,
  };

  // 如果是作業模式，記錄 jobId 到任務詳情中
  if (jobId) {
    taskDetails.jobId = jobId;
  }

  // 更新任務狀態為執行中
  taskManager.updateTaskProgress(taskId, 0, taskDetails);

  return { taskManager, taskId };
};

// 確認複製
const confirmCopy = async () => {
  if (copying.value) return;

  // 先驗證路徑
  validateDestinationPath();

  // 如果有警告，需要使用者確認
  if (pathWarning.value) {
    const confirmed = await confirm({
      title: t("mount.copyModal.warningTitle", "複製警告"),
      message: t("mount.copyModal.confirmPotentialIssue", { warning: pathWarning.value }),
      confirmType: "warning",
      confirmText: t("mount.copyModal.continueCopy", "繼續複製"),
      darkMode: props.darkMode,
    });
    if (!confirmed) {
      return;
    }
  }

  copying.value = true;

  try {
    // 準備複製專案
    const copyItems = prepareCopyItems();

    // ========== 統一任務模式 ==========
    // 所有複製操作統一走任務系統，無條件分支
    // 複製策略（同儲存/跨儲存/S3最佳化）由後端 CopyTaskHandler 內部決策
    // 呼叫後端 batch-copy API（現在始終返回 jobId）
    const response = await fsApi.batchCopyItems(copyItems, {
      skipExisting: skipExisting.value,
    });

    if (!response.success || !response.data?.jobId) {
      throw new Error(response.message || '建立復製作業失敗');
    }

    const jobId = response.data.jobId;

    // 建立前端任務追蹤，並在 details 中記錄 jobId
    const { taskManager, taskId } = createCopyTask(props.selectedItems.length, jobId);

    // 發出複製開始事件
    emit("copy-started", {
      message: t("mount.taskManager.copyStarted", {
        count: props.selectedItems.length,
        path: currentPath.value,
      }),
      taskId: taskId,
      itemCount: props.selectedItems.length,
      targetPath: currentPath.value,
      jobId: jobId,
    });

    // 立即關閉模態框
    emit("close");
    copying.value = false;
  } catch (error) {
    // 如果 API 請求失敗，保持模態框開啟並顯示錯誤
    // 注意：此時尚未建立前端任務，無需標記任何任務為失敗
    log.error("[CopyModal] 複製啟動失敗:", error);
    showError(error.message || t('mount.copyModal.copyFailed'));
    copying.value = false;
  }
};
</script>

<style scoped>
.file-tree {
  @apply text-sm;
}

.tree-item {
  @apply mb-1;
}

.tree-item.selected > div {
  @apply bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 dark:border-blue-400;
}

.tree-item.selected > div span {
  @apply text-blue-700 dark:text-blue-300 font-medium;
}

/* 目錄項元件樣式 */
.directory-item {
  @apply w-full;
}

/* 資料夾元件樣式 */
.folder-item {
  @apply relative;
}

/* 新增層級連線線 */
.folder-item::before {
  content: "";
  @apply absolute border-l border-gray-300 dark:border-gray-600;
  height: calc(100% - 1.5rem);
  left: 1rem;
  top: 1.5rem;
}

/* 最後一個子項不需要顯示連線線到底部 */
.folder-item:last-child::before {
  height: 0;
}

.folder-toggle {
  @apply w-5 h-5 flex items-center justify-center flex-shrink-0 mr-1 text-gray-500 dark:text-gray-400;
}

.folder-icon {
  @apply h-4 w-4 flex-shrink-0 mr-2;
}

.folder-children {
  @apply mt-1 relative;
}

.folder-loading {
  @apply py-1 text-xs text-gray-500 dark:text-gray-400 flex items-center;
}
</style>
