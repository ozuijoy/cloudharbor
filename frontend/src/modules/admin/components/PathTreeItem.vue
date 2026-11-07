<template>
  <div
    class="path-tree-item flex items-center px-3 py-2.5 cursor-pointer transition-colors group"
    :class="[
      isSelected
        ? (darkMode ? 'bg-primary-900/40 border-l-2 border-primary-400' : 'bg-primary-50 border-l-2 border-primary-500')
        : (darkMode ? 'hover:bg-gray-700/70 border-l-2 border-transparent' : 'hover:bg-gray-50 border-l-2 border-transparent'),
      darkMode ? 'text-gray-300' : 'text-gray-700'
    ]"
    @click="handleClick"
    @dblclick="handleDoubleClick"
  >
    <!-- 選中指示點 -->
    <div
      v-if="isSelected"
      class="flex-shrink-0 mr-2 w-1.5 h-1.5 rounded-full"
      :class="darkMode ? 'bg-primary-400' : 'bg-primary-500'"
    ></div>

    <!-- 檔案/資料夾圖示 - 使用統一的 getFileIcon -->
    <div class="flex-shrink-0 mr-2.5 w-5 h-5" v-html="fileIconHtml"></div>

    <!-- 檔案/資料夾名稱 -->
    <div class="flex-1 min-w-0">
      <div
        class="truncate text-sm"
        :class="isSelected ? 'font-semibold' : 'font-medium'"
      >
        {{ item.name }}
      </div>
      <!-- 檔案大小（如有） -->
      <div v-if="!item.isDirectory && item.size" class="text-xs mt-0.5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
        {{ formatSize(item.size) }}
      </div>
    </div>

    <!-- 資料夾進入箭頭按鈕 - 始終顯示（資料夾時） -->
    <button
      v-if="item.isDirectory"
      @click.stop="handleEnter"
      class="flex-shrink-0 ml-2 p-1 rounded transition-all"
      :class="[
        darkMode
          ? 'text-gray-500 hover:text-primary-400 hover:bg-gray-700'
          : 'text-gray-400 hover:text-primary-500 hover:bg-gray-100',
        'opacity-50 group-hover:opacity-100'
      ]"
      :title="$t('admin.scheduledJobs.syncTask.enterFolder', '進入資料夾')"
    >
      <IconChevronRight size="sm" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { IconChevronRight } from '@/components/icons'
import { getFileIcon } from '@/utils/fileTypeIcons.js'
import { detectFileTypeFromFilename, FileType } from '@/utils/fileTypes.js'

const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  darkMode: {
    type: Boolean,
    default: false
  },
  selectedPath: {
    type: String,
    default: ''
  },
  allowFiles: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['select', 'enter'])

// 是否選中
const isSelected = computed(() => {
  return props.selectedPath === props.item.path
})

// 獲取檔案圖示 HTML
const fileIconHtml = computed(() => {
  // 構造符合 getFileIcon 期望的物件格式
  // 關鍵：需要根據檔名檢測 type，因為 API 可能不返回 type 欄位
  const itemType = props.item.isDirectory
    ? FileType.FOLDER
    : (props.item.type ?? detectFileTypeFromFilename(props.item.name))

  const iconItem = {
    isDirectory: props.item.isDirectory,
    isMount: props.item.isMount || false,
    filename: props.item.name,
    name: props.item.name,
    type: itemType
  }
  return getFileIcon(iconItem, props.darkMode)
})

// 格式化檔案大小
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let size = bytes
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

// 處理點選 - 選中專案（檔案或資料夾都可選中）
const handleClick = () => {
  emit('select', props.item)
}

// 處理雙擊 - 資料夾雙擊進入目錄
const handleDoubleClick = () => {
  if (props.item.isDirectory) {
    emit('enter', props.item)
  }
}

// 處理進入資料夾（箭頭按鈕）
const handleEnter = () => {
  if (props.item.isDirectory) {
    emit('enter', props.item)
  }
}
</script>

<style scoped>
.path-tree-item {
  @apply select-none;
  /* 禁用移動端雙擊縮放，使雙擊事件正常工作 */
  touch-action: manipulation;
}
</style>
