<template>
  <div class="archive-preview-container">
    <!-- 壓縮檔案資訊展示 -->
    <div v-if="!isExtracted" class="archive-info flex items-center justify-center min-h-[400px]">
      <!-- 密碼輸入介面 -->
      <ArchivePasswordInput
        v-if="isPasswordRequired"
        :dark-mode="darkMode"
        :password-error="passwordError"
        :is-validating="isValidatingPassword"
        @submit="handlePasswordSubmit"
        @cancel="handlePasswordCancel"
      />

      <!-- 簡化的檔案資訊 -->
      <div v-else class="file-info-content text-center">
        <!-- 檔案圖示 -->
        <div class="flex justify-center mb-6">
          <div v-html="fileIcon" class="w-16 h-16"></div>
        </div>

        <!-- 檔案資訊 -->
        <h3 class="text-xl font-semibold mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
          {{ file.name }}
        </h3>
        <p class="text-sm mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ archiveInfo.description }}
        </p>
        <p class="text-sm mb-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ formatFileSize(file.size) }}
        </p>

        <!-- 線上解壓按鈕 -->
        <button
          v-if="archiveInfo.supported"
          @click="handleExtractArchive"
          :disabled="isExtracting"
          class="inline-flex items-center px-8 py-3 rounded-lg font-medium transition-all duration-200"
          :class="[
            darkMode
              ? 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-600 disabled:text-gray-400'
              : 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400 disabled:text-gray-600',
            isExtracting ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-lg',
          ]"
        >
          <IconRefresh v-if="isExtracting" class="animate-spin -ml-1 mr-3" aria-hidden="true" />
          <IconArchive v-else class="mr-2" aria-hidden="true" />
          {{ isExtracting ? `正在${currentStage}... ${extractProgress.toFixed(1)}%` : "線上解壓檢視" }}
        </button>

        <!-- 不支援格式的提示 -->
        <div v-if="!archiveInfo.supported" class="mt-6 p-3 rounded-lg" :class="darkMode ? 'bg-yellow-900/20 border border-yellow-700' : 'bg-yellow-50 border border-yellow-200'">
          <div class="flex items-center justify-center">
            <IconExclamationSolid class="mr-2" :class="darkMode ? 'text-yellow-400' : 'text-yellow-600'" aria-hidden="true" />
            <span class="text-sm" :class="darkMode ? 'text-yellow-200' : 'text-yellow-800'"> 暫不支援 {{ archiveInfo.name }} 格式的線上解壓 </span>
          </div>
        </div>

        <!-- 錯誤提示 -->
        <div v-if="extractError" class="mt-6 p-3 rounded-lg" :class="darkMode ? 'bg-red-900/20 border border-red-700' : 'bg-red-50 border border-red-200'">
          <div class="flex items-center justify-center">
            <IconXCircle class="mr-2" :class="darkMode ? 'text-red-400' : 'text-red-600'" aria-hidden="true" />
            <span class="text-sm" :class="darkMode ? 'text-red-200' : 'text-red-800'">{{ extractError }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 解壓後的檔案列表 -->
    <div v-else class="archive-content">
      <!-- 頭部工具欄 -->
      <div class="archive-header px-4 py-2 border-b" :class="darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <button
              @click="handleBackToInfo"
              class="p-1.5 rounded-lg transition-colors"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
            title="返回檔案資訊"
          >
              <IconChevronLeft size="sm" aria-hidden="true" />
            </button>
            <div class="flex-shrink-0">
              <div v-html="fileIcon" class="w-5 h-5"></div>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-base font-semibold truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
                {{ file.name }}
              </h3>
              <p class="text-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ archiveEntries.length }} 個檔案，{{ formatFileSize(totalSize) }}</p>
            </div>
          </div>

          <!-- 工具欄按鈕 -->
          <div class="flex items-center space-x-2">
            <button
              @click="handleDownload"
              class="inline-flex items-center px-2 py-1 text-xs rounded-lg transition-colors"
            :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
            title="下載原檔案"
          >
              <IconDownload size="xs" class="mr-1" aria-hidden="true" />
              <span class="hidden sm:inline">下載</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 檔案列表表格 -->
      <div class="archive-file-list flex-1 overflow-auto">
        <div v-if="archiveEntries.length === 0" class="text-center py-12">
          <IconDocument size="3xl" class="mx-auto mb-4" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
          <p class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">壓縮檔案為空</p>
          <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">此壓縮檔案不包含任何內容</p>
        </div>

        <!-- 表格式檔案列表 -->
        <div v-else class="min-w-full">
          <!-- 表頭 - 響應式設計 -->
          <div
            class="grid items-center py-2 px-3 border-b border-t"
            :class="[darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-100 border-gray-200', 'grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto]']"
          >
            <div class="font-medium pl-16" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">名稱</div>
            <div class="w-24 text-center font-medium hidden sm:block" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">大小</div>
            <div class="w-32 text-center font-medium hidden sm:block" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">型別</div>
            <div class="min-w-[80px] sm:min-w-32 text-center font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">操作</div>
          </div>

          <!-- 樹狀檔案列表 -->
          <div class="divide-y" :class="darkMode ? 'divide-gray-700' : 'divide-gray-200'">
            <div
              v-for="entry in visibleFileList"
              :key="entry.path"
              @click="handleRowClick(entry)"
              class="grid items-center py-2 px-3 hover:cursor-pointer transition-colors"
              :class="[
                darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100',
                'grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto]',
                selectedEntry?.path === entry.path ? (darkMode ? 'bg-blue-900/20' : 'bg-blue-50') : '',
              ]"
            >
              <!-- 檔名列 - 包含圖示、層級縮排和名稱 -->
              <div class="flex items-center space-x-2 min-w-0" :style="{ paddingLeft: `${entry.level * 16}px` }">
                <!-- 展開/摺疊箭頭（僅資料夾顯示） -->
                <div
                  v-if="entry.isDirectory"
                  @click.stop="toggleFolder(entry.path.replace(/\/$/, ''))"
                  class="flex-shrink-0 w-4 h-4 flex items-center justify-center cursor-pointer rounded transition-colors"
                  :class="darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'"
                  :title="isFolderExpanded(entry.path.replace(/\/$/, '')) ? '摺疊資料夾' : '展開資料夾'"
                >
                  <IconChevronRight
                    size="xs"
                    class="transition-transform duration-200"
                    :class="isFolderExpanded(entry.path.replace(/\/$/, '')) ? 'rotate-90' : ''"
                    aria-hidden="true"
                  />
                </div>
                <!-- 佔位符（非資料夾） -->
                <div v-else class="w-4 h-4 flex-shrink-0"></div>

                <!-- 檔案圖示 -->
                <div class="flex-shrink-0 w-5 sm:w-6 h-5 sm:h-6">
                  <span v-html="getFileIconSvg(entry)"></span>
                </div>

                <!-- 檔名 + 移動端資訊重組 -->
                <div class="flex-grow truncate">
                  <div class="font-medium truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                    {{ entry.name }}
                    <!-- 資料夾檔案數量顯示 -->
                    <span v-if="entry.isDirectory && entry.fileCount > 0" class="text-xs ml-1 font-normal" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                      ({{ entry.fileCount }})
                    </span>
                  </div>
                  <!-- 移動端顯示大小和型別資訊 -->
                  <div class="text-xs block sm:hidden mt-0.5 flex items-center space-x-2" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                    <span v-if="!entry.isDirectory" class="flex-shrink-0">{{ typeof entry.size === 'number' ? formatFileSize(entry.size) : '-' }}</span>
                    <span class="truncate" :title="getMimeTypeDescription(entry)">{{ getMimeTypeDescription(entry) }}</span>
                  </div>
                </div>
              </div>

              <!-- 桌面端大小列 - 固定寬度 -->
              <div class="w-24 text-center text-sm hidden sm:block" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <span v-if="entry.isDirectory">-</span>
                <span v-else>{{ typeof entry.size === 'number' ? formatFileSize(entry.size) : '-' }}</span>
              </div>

              <!-- 桌面端型別列 - 固定寬度，內容過長時省略 -->
              <div class="w-32 text-center text-sm hidden sm:block" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <span class="block truncate px-1" :title="getMimeTypeDescription(entry)">
                  {{ getMimeTypeDescription(entry) }}
                </span>
              </div>

              <!-- 操作按鈕  -->
              <div class="min-w-[80px] sm:min-w-32 text-center">
                <div class="flex justify-end sm:justify-center space-x-0.5 sm:space-x-1">
                  <!-- 預覽按鈕（僅檔案顯示） -->
                  <button
                    v-if="!entry.isDirectory && canPreviewFile(entry, true)"
                    @click.stop="handlePreviewFile(entry)"
                    class="p-1.5 sm:p-2 rounded-full transition-colors"
                  :class="darkMode ? 'hover:bg-gray-600 text-blue-400 hover:text-blue-300' : 'hover:bg-gray-200 text-blue-600 hover:text-blue-700'"
                  title="預覽檔案"
                >
                  <IconEye class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>

                  <!-- 下載按鈕（僅檔案顯示） -->
                  <button
                    v-if="!entry.isDirectory"
                    @click.stop="handleDownloadFile(entry)"
                    class="p-1.5 sm:p-2 rounded-full transition-colors"
                  :class="darkMode ? 'hover:bg-gray-600 text-green-400 hover:text-green-300' : 'hover:bg-gray-200 text-green-600 hover:text-green-700'"
                  title="下載檔案"
                >
                  <IconDownload class="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, nextTick, onBeforeUnmount } from "vue";
import { getArchiveType, formatFileSize, canPreviewFile, createMockFileObject, getMimeTypeDescription } from "@/utils/fileTypes.js";
import { getFileIcon } from "@/utils/fileTypeIcons.js";
import { useArchivePreview } from "@/composables/archive/useArchivePreview.js";
import ArchivePasswordInput from "./ArchivePasswordInput.vue";
import { IconArchive, IconChevronLeft, IconChevronRight, IconDocument, IconDownload, IconEye, IconExclamationSolid, IconRefresh, IconXCircle } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// Props
const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  authenticatedPreviewUrl: {
    type: String,
    default: "",
  },
});

// Emits
const emit = defineEmits(["download", "loaded", "error"]);
const log = createLogger("ArchivePreview");

// 使用壓縮檔案預覽 composable
const { isExtracting, extractError, archiveEntries, isExtracted, extractProgress, currentStage, totalSize, extractArchive, previewFile, downloadFile, resetState } =
  useArchivePreview();

// 本地狀態
const selectedEntry = ref(null);
const expandedFolders = ref(new Set()); // 展開的資料夾狀態

// 密碼相關狀態
const isPasswordRequired = ref(false); // 是否需要密碼
const passwordError = ref(""); // 密碼錯誤資訊
const isValidatingPassword = ref(false); // 是否正在驗證密碼

// 計算屬性
const archiveInfo = computed(() => {
  return getArchiveType(props.file.name);
});

// 檔案圖示計算屬性
const fileIcon = computed(() => {
  if (!props.file) return "";
  return getFileIcon(props.file, props.darkMode);
});

// 樹狀結構資料
const treeStructure = computed(() => {
  if (!archiveEntries.value || !archiveEntries.value.length) return [];

  // 將扁平陣列轉換為樹狀結構
  const tree = [];
  const pathMap = new Map();

  // 為根目錄建立虛擬容器
  pathMap.set("", { children: tree });

  // 按路徑深度排序，確保父目錄先處理
  const sortedEntries = [...archiveEntries.value].sort((a, b) => {
    const depthA = a.name.split("/").length;
    const depthB = b.name.split("/").length;
    return depthA - depthB;
  });

  sortedEntries.forEach((entry) => {
    // 邊界情況檢查
    if (!entry || !entry.name) return;

    const pathParts = entry.name.split("/").filter((part) => part); // 移除空字串

    if (pathParts.length === 0) return; // 跳過空路徑

    const fileName = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join("/");

    // 跳過無效的檔名
    if (!fileName) return;

    // 確保父目錄存在
    if (parentPath && !pathMap.has(parentPath)) {
      // 建立缺失的父目錄節點
      const parentParts = parentPath.split("/");
      let currentPath = "";

      parentParts.forEach((part) => {
        const prevPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!pathMap.has(currentPath)) {
          const parentContainer = pathMap.get(prevPath);
          const folderNode = {
            name: part,
            path: currentPath,
            fullPath: `${currentPath}/`,
            isDirectory: true,
            size: 0,
            children: [],
            entry: null,
            isVirtual: true, // 標記為虛擬節點
          };

          parentContainer.children.push(folderNode);
          pathMap.set(currentPath, folderNode);
        }
      });
    }

    // 新增當前節點
    const parent = pathMap.get(parentPath);
    const node = {
      name: fileName,
      path: entry.name,
      fullPath: entry.name,
      isDirectory: entry.isDirectory,
      size: entry.size || 0,
      lastModDate: entry.lastModDate,
      entry: entry.entry,
      children: entry.isDirectory ? [] : undefined,
      isVirtual: false, // 標記為真實節點
    };

    if (entry.isDirectory) {
      // 如果已存在虛擬節點，替換為真實節點
      const normalizedPath = entry.name.replace(/\/$/, "");
      const existingNode = pathMap.get(normalizedPath);
      if (existingNode && existingNode.isVirtual) {
        // 保留虛擬節點的 children，更新為真實節點
        node.children = existingNode.children;
        // 從父容器中移除虛擬節點
        const index = parent.children.findIndex((child) => child.path.replace(/\/$/, "") === normalizedPath);
        if (index !== -1) {
          parent.children.splice(index, 1); // 移除虛擬節點
        }
      }
      pathMap.set(normalizedPath, node);
    }

    // 新增節點到父容器（統一處理，避免重複新增）
    parent.children.push(node);
  });

  return tree;
});

// 工具函式
const validateEntry = (entry) => {
  if (entry.isDirectory) {
    return { valid: false, reason: "directory" };
  }
  if (entry.isVirtual || !entry.entry) {
    return { valid: false, reason: "virtual" };
  }
  return { valid: true };
};

const createOriginalEntry = (entry) => ({
  name: entry.fullPath,
  isDirectory: entry.isDirectory,
  size: entry.size,
  entry: entry.entry,
});

const resetPasswordState = () => {
  isPasswordRequired.value = false;
  passwordError.value = "";
  isValidatingPassword.value = false;
};

// 方法
const handleExtractArchive = async () => {
  if (!archiveInfo.value.supported) return;

  // 檢查預覽URL是否有效
  if (!props.authenticatedPreviewUrl) {
    log.error("預覽URL無效，無法進行解壓操作");
    return;
  }

  // 第一次嘗試解壓
  await attemptExtraction(null);
};

// 嘗試解壓的核心方法
const attemptExtraction = async (password) => {
  try {
    // 使用composable進行解壓，傳遞密碼
    await extractArchive(props.authenticatedPreviewUrl, props.file.name, password);

    // 解壓成功，隱藏密碼輸入介面
    resetPasswordState();

    // 自動展開第一層目錄
    await nextTick();
    expandedFolders.value.clear();

    // 自動展開第一層目錄
    if (archiveEntries.value && Array.isArray(archiveEntries.value)) {
      archiveEntries.value.forEach((node) => {
        if (node && node.isDirectory && node.path) {
          expandedFolders.value.add(node.path.replace(/\/$/, ""));
        }
      });
    }

    emit("loaded");
  } catch (error) {
    log.error("解壓失敗:", error);

    // 檢查是否是加密檢測錯誤
    if (error.message && error.message.includes("ENCRYPTED_ARCHIVE_DETECTED")) {
      // 檢測到加密檔案，檔案已預下載完成，顯示密碼輸入介面
      isPasswordRequired.value = true;
      passwordError.value = "";
      isValidatingPassword.value = false;
    } else if (error.message && error.message.includes("INVALID_ARCHIVE_PASSWORD")) {
      // 密碼錯誤，重新顯示密碼輸入介面
      isPasswordRequired.value = true;
      passwordError.value = "密碼錯誤，請重新輸入";
      isValidatingPassword.value = false;
    } else {
      // 其他錯誤，正常處理
      emit("error", error);
    }
  }
};

// 密碼處理方法
const handlePasswordSubmit = async (inputPassword) => {
  // 隱藏密碼輸入介面，顯示正常的解壓進度介面
  resetPasswordState();

  // 使用提交的密碼重新嘗試解壓（會顯示正常的進度條）
  await attemptExtraction(inputPassword);
};

const handlePasswordCancel = () => {
  resetPasswordState();
};

const handleBackToInfo = () => {
  // 重置狀態，返回到檔案資訊頁面
  resetState();
  expandedFolders.value.clear(); // 清理展開狀態
  selectedEntry.value = null; // 清理選擇狀態

  // 重置密碼相關狀態
  resetPasswordState();
};

// 統一的行點選處理（避免移動端點選事件衝突）
const handleRowClick = (entry) => {
  if (entry.isDirectory) {
    // 資料夾：展開/摺疊
    toggleFolder(entry.path.replace(/\/$/, ""));
  } else {
    // 檔案：選擇高亮
    selectedEntry.value = entry;
  }
};

const handlePreviewFile = async (entry) => {
  const validation = validateEntry(entry);

  if (!validation.valid) {
    if (validation.reason === "directory") {
      toggleFolder(entry.path.replace(/\/$/, ""));
      return;
    }
    if (validation.reason === "virtual") {
      log.warn("無法預覽虛擬節點:", entry.name);
      return;
    }
  }

  const originalEntry = createOriginalEntry(entry);
  await previewFile(originalEntry);
};

// 移除彈窗相關處理函式，改為新頁面預覽

const handleDownloadFile = async (entry) => {
  const validation = validateEntry(entry);

  if (!validation.valid) {
    if (validation.reason === "directory") {
      log.warn("無法下載目錄:", entry.name);
      return;
    }
    if (validation.reason === "virtual") {
      log.warn("無法下載虛擬節點:", entry.name);
      return;
    }
  }

  const originalEntry = createOriginalEntry(entry);
  await downloadFile(originalEntry);
};

const handleDownload = () => {
  emit("download");
};

// 樹狀結構相關方法
const toggleFolder = (folderPath) => {
  if (expandedFolders.value.has(folderPath)) {
    expandedFolders.value.delete(folderPath);
  } else {
    expandedFolders.value.add(folderPath);
  }
};

const isFolderExpanded = (folderPath) => {
  return expandedFolders.value.has(folderPath);
};

// 渲染樹狀節點的方法
const renderTreeNode = (node, level = 0) => {
  return {
    ...node,
    level,
    isExpanded: node.isDirectory ? isFolderExpanded(node.path.replace(/\/$/, "")) : false,
  };
};

// 獲取可見的樹狀節點
const getVisibleTreeNodes = (nodes, level = 0) => {
  if (!nodes || !Array.isArray(nodes)) return [];

  const result = [];

  // 排序：資料夾在前，檔案在後
  const sortedNodes = [...nodes].sort((a, b) => {
    // 資料夾優先
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    // 同型別按名稱排序
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  sortedNodes.forEach((node) => {
    if (!node) return; // 跳過無效節點

    // 新增當前節點（包含檔案數量資訊）
    const nodeWithCount = {
      ...renderTreeNode(node, level),
      fileCount: node.isDirectory ? getDirectoryFileCount(node) : 0,
    };
    result.push(nodeWithCount);

    // 如果是展開的資料夾，遞迴新增子節點
    if (node.isDirectory && node.children && Array.isArray(node.children) && isFolderExpanded(node.path.replace(/\/$/, ""))) {
      result.push(...getVisibleTreeNodes(node.children, level + 1));
    }
  });

  return result;
};

// 計算資料夾內的檔案數量（遞迴統計）
const getDirectoryFileCount = (directory) => {
  if (!directory || !directory.children || !Array.isArray(directory.children)) {
    return 0;
  }

  let count = 0;
  directory.children.forEach((child) => {
    if (child.isDirectory) {
      count += getDirectoryFileCount(child); // 遞迴統計子資料夾
    } else {
      count += 1; // 檔案計數
    }
  });

  return count;
};

// 可見的檔案列表（用於渲染）
const visibleFileList = computed(() => {
  return getVisibleTreeNodes(treeStructure.value);
});

// 工具函式 - 獲取檔案圖示
const getFileIconSvg = (entry) => {
  if (!entry) return "";

  // 使用介面卡建立模擬檔案物件，完全複用現有圖示系統
  const mockFile = createMockFileObject(entry);
  return getFileIcon(mockFile, props.darkMode);
};

// 🧹 元件解除安裝時清理快取
onBeforeUnmount(() => {
  resetState(); // 清理所有快取資料

  if (props.authenticatedPreviewUrl) {
    const { archiveService } = useArchivePreview();

    // 清理檔案Blob快取（原始壓縮檔案）
    archiveService.clearFileBlobCache(props.authenticatedPreviewUrl);

    // 清理解壓結果快取
    archiveService.clearFileCache(props.authenticatedPreviewUrl, props.file.name);
  }
});
</script>

<style scoped>
.archive-preview-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.archive-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.archive-file-list {
  flex: 1;
  overflow: auto;
  max-height: 400px;
}

.archive-file-preview {
  flex-shrink: 0;
  max-height: 300px;
}

.preview-content {
  overflow: auto;
}

/* 移動端響應式最佳化 - 應用 DirectoryList 設計模式 */
@media (max-width: 768px) {
  /* 頭部工具欄緊湊化 */
  .archive-header {
    padding: 0.5rem 0.75rem !important;
  }

  .archive-header h3 {
    font-size: 0.875rem !important;
  }

  .archive-header p {
    font-size: 0.75rem !important;
  }

  /* 檔案資訊頁面最佳化 */
  .archive-info {
    min-height: 300px !important;
    padding: 1rem !important;
  }

  .file-info-content .w-16 {
    width: 3rem !important;
    height: 3rem !important;
  }

  /* 移動端檔案列表最佳化 - 增大觸控目標 */
  .archive-file-list .grid {
    min-height: 48px; /* 符合移動端觸控標準 */
  }

  /* 移動端按鈕觸控最佳化 */
  .archive-file-list button {
    min-width: 36px;
    min-height: 36px;
  }
}
</style>
