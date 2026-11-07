<template>
  <div class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div class="relative bg-white dark:bg-gray-800 rounded-lg max-w-xs sm:max-w-md w-full mx-auto shadow-xl overflow-hidden max-h-[95vh] sm:max-h-[85vh]">
      <!-- 標題欄 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-base sm:text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">檔案分享二維碼</h3>
        <button @click="$emit('close')" class="text-gray-400 hover:text-gray-500">
          <IconClose class="h-6 w-6" />
        </button>
      </div>

      <!-- 二維碼內容 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 flex flex-col items-center overflow-y-auto" style="max-height: calc(95vh - 140px)">
        <!-- 二維碼 -->
        <div class="mb-6 p-4 bg-white rounded-lg">
          <img :src="qrCodeUrl" :alt="`QR Code for ${fileSlug}`" class="max-w-full h-auto" />
        </div>

        <!-- 下載按鈕 -->
        <div class="w-full flex space-x-3 mb-2">
          <button @click="downloadQRCode" class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors">
            <span class="flex items-center justify-center">
              <IconDownload class="h-4 w-4 mr-1.5" />
              下載二維碼
            </span>
          </button>
        </div>

        <button
          @click="$emit('close')"
          class="w-full px-4 py-2 rounded-md text-sm font-medium transition-colors mt-2"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
        >
          關閉
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { IconClose, IconDownload } from "@/components/icons";

const props = defineProps({
  qrCodeUrl: {
    type: String,
    required: true,
  },
  fileSlug: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["close"]);

// 計算完整的檔案URL（如需展示，可在父元件透過 fileshareService.buildShareUrl 提供）
const fileUrl = computed(() => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/file/${props.fileSlug}`;
});

/**
 * 下載二維碼圖片
 */
const downloadQRCode = () => {
  // 建立一個臨時的a標籤用於下載
  const link = document.createElement("a");
  link.href = props.qrCodeUrl;
  link.download = `cloudharbor-file-${props.fileSlug}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
</script>
