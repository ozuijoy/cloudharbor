<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 py-2">
      <!-- 左側操作按鈕組 -->
      <div class="flex items-center space-x-2">
        <!-- 上傳檔案按鈕 -->
        <button
          v-if="!isVirtual"
          @click="openUploadFileDialog"
          class="inline-flex items-center justify-center p-2 sm:px-4 sm:py-1.5 rounded-md sm:rounded-full transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md active:scale-95"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'"
          :title="t('mount.operations.upload')"
        >
          <IconUpload size="sm" class="sm:mr-1.5" />
          <span class="hidden sm:inline">{{ t("mount.operations.upload") }}</span>
        </button>

        <!-- 新建資料夾按鈕 -->
        <button
          v-if="!isVirtual"
          @click="createFolder"
          class="inline-flex items-center justify-center p-2 sm:px-4 sm:py-1.5 rounded-md sm:rounded-full transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md active:scale-95"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'"
          :title="t('mount.operations.createFolder')"
        >
          <IconFolderPlus size="sm" class="sm:mr-1.5" />
          <span class="hidden sm:inline">{{ t("mount.operations.createFolder") }}</span>
        </button>
      </div>

      <!-- 右側檢視操作按鈕組 -->
      <div class="flex items-center space-x-2">
        <!-- 檔案籃按鈕 -->
        <div class="mr-2">
          <FileBasket :dark-mode="darkMode" @task-created="$emit('task-created', $event)" @show-message="$emit('show-message', $event)" />
        </div>

        <!-- 任務管理按鈕 -->
        <button
          @click="$emit('openTasksModal')"
          class="inline-flex items-center justify-center p-2 sm:px-4 sm:py-1.5 rounded-md sm:rounded-full transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md active:scale-95 mr-2"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'"
          :title="t('mount.operations.tasks')"
        >
          <IconTaskList size="sm" class="sm:mr-1.5" />
          <span class="hidden sm:inline">{{ t("mount.operations.tasks") }}</span>
        </button>

        <!-- 檢視切換按鈕組 -->
        <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-700' : 'border-gray-300'">
          <!-- 列表檢視按鈕 -->
          <button
            @click="changeViewMode('list')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[viewMode === 'list' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500']"
            :title="t('mount.viewModes.list')"
          >
            <IconList size="sm" />
          </button>

          <!-- 網格檢視按鈕 -->
          <button
            @click="changeViewMode('grid')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[viewMode === 'grid' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500']"
            :title="t('mount.viewModes.grid')"
          >
            <IconGrid size="sm" />
          </button>

          <!-- 圖廊檢視按鈕 -->
          <button
            @click="changeViewMode('gallery')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[
              viewMode === 'gallery' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500',
            ]"
            :title="t('mount.viewModes.gallery')"
          >
            <IconGallery size="sm" />
          </button>
        </div>

        <!-- 重新整理按鈕 -->
        <button
          @click="$emit('refresh')"
          class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium ml-2"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
          :title="t('mount.operations.refresh')"
        >
          <IconRefresh size="sm" />
        </button>  
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from "vue-i18n";
import FileBasket from "./FileBasket.vue";
import {
  IconUpload,
  IconFolderPlus,
  IconTaskList,
  IconList,
  IconGrid,
  IconGallery,
  IconRefresh
} from '@/components/icons';

const { t } = useI18n();

const props = defineProps({
  currentPath: {
    type: String,
    required: true,
    default: "/",
  },
  isVirtual: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  viewMode: {
    type: String,
    default: "list", // 'list' | 'grid' | 'gallery'
  },
});

const emit = defineEmits(["upload", "createFolder", "refresh", "changeViewMode", "openUploadModal", "openTasksModal", "task-created", "show-message"]);

// 檢視模式切換
const changeViewMode = (mode) => {
  emit("changeViewMode", mode);
};

// 開啟檔案上傳對話方塊
const openUploadFileDialog = () => {
  emit("openUploadModal");
};

// 新建資料夾
const createFolder = () => {
  emit("createFolder");
};
</script>

