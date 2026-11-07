<!-- UppyDashboardContainer.vue - Uppy Dashboard容器元件 -->
<template>
  <div class="uppy-container mb-4">
    <div ref="container" :id="containerId" class="min-h-[300px]"></div>

    <!-- 提示資訊區域 -->
    <div class="mt-2 text-center">
      <div class="flex items-center justify-center gap-3 flex-wrap">
        <!-- 貼上提示 -->
        <span v-if="showPasteHint" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          {{ pasteHintPrefix }}
          <kbd
            class="px-1 py-0.5 text-xs font-mono rounded"
            :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'"
          >
            {{ pasteKey }}
          </kbd>
          {{ pasteHintSuffix }}
        </span>

        <!-- 分隔符 -->
        <span v-if="showPasteHint && maxFileSizeHint" class="text-xs" :class="darkMode ? 'text-gray-600' : 'text-gray-300'">•</span>

        <!-- 最大檔案大小提示 -->
        <span v-if="maxFileSizeHint" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          {{ maxFileSizeHint }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  /**
   * Dashboard DOM ID
   */
  containerId: {
    type: String,
    required: true,
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * 顯示貼上提示
   */
  showPasteHint: {
    type: Boolean,
    default: true,
  },
  /**
   * 貼上提示字首
   */
  pasteHintPrefix: {
    type: String,
    default: '支援',
  },
  /**
   * 貼上快捷鍵
   */
  pasteKey: {
    type: String,
    default: 'Ctrl+V',
  },
  /**
   * 貼上提示字尾
   */
  pasteHintSuffix: {
    type: String,
    default: '貼上上傳',
  },
  /**
   * 最大檔案大小提示文字
   */
  maxFileSizeHint: {
    type: String,
    default: '',
  },
});

const container = ref(null);

defineExpose({ container });
</script>
