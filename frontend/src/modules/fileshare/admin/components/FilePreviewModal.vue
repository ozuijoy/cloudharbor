<template>
  <div class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div class="relative bg-white dark:bg-gray-800 rounded-lg max-w-sm sm:max-w-lg w-full mx-auto shadow-xl overflow-hidden max-h-[95vh] sm:max-h-[85vh]">
      <!-- 標題欄 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-base sm:text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">檔案詳情</h3>
        <button @click="$emit('close')" class="text-gray-400 hover:text-gray-500">
          <IconClose class="h-6 w-6" />
        </button>
      </div>

      <!-- 檔案內容 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 overflow-y-auto" style="max-height: calc(95vh - 160px)">
        <div class="space-y-4">
          <!-- 基本資訊 -->
          <div>
            <h4 class="text-sm font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">基本資訊</h4>
            <div class="bg-gray-50 dark:bg-gray-900 rounded p-3">
              <dl class="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">檔名</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ file.filename }}</dd>


                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">MIME型別</dt>
                <dd class="col-span-2 break-words" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ file.mimetype || "未知" }}</dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">檔案大小</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ formatFileSize(file.size) }}</dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">備註</dt>
                <dd class="col-span-2 max-h-24 overflow-y-auto">
                  <span v-if="file.remark" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" class="block break-words whitespace-pre-wrap">{{ file.remark }}</span>
                  <span v-else class="text-gray-400">無備註</span>
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">密碼保護</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  <span v-if="file.has_password" class="text-yellow-500">已啟用</span>
                  <span v-else>未啟用</span>
                </dd>
              </dl>
            </div>
          </div>

          <!-- 訪問統計 -->
          <div>
            <h4 class="text-sm font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">訪問統計</h4>
            <div class="bg-gray-50 dark:bg-gray-900 rounded p-3">
              <dl class="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">訪問次數</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ file.views || 0 }} 次</dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">剩餘次數</dt>
                <dd class="col-span-2" :class="remainingViewsClass">
                  {{ getRemainingViews }}
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">過期時間</dt>
                <dd class="col-span-2" :class="expiresClass">
                  <span v-if="file.expires_at">{{ formatDateTime(file.expires_at) }}</span>
                  <span v-else>永不過期</span>
                </dd>
              </dl>
            </div>
          </div>

          <!-- 儲存資訊 -->
          <div>
            <h4 class="text-sm font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">儲存資訊</h4>
            <div class="bg-gray-50 dark:bg-gray-900 rounded p-3">
              <dl class="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">儲存配置</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ file.storage_config_name || "預設儲存" }}
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">提供商</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ file.storage_provider_type || "未知" }}
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">儲存路徑</dt>
                <dd class="col-span-2 break-all text-xs" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ file.storage_path || "未知" }}
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">ETag</dt>
                <dd class="col-span-2 break-all text-xs" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ file.etag || "未知" }}
                </dd>

                <dt :class="darkMode ? 'text-gray-400' : 'text-gray-500'">建立時間</dt>
                <dd class="col-span-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ formatDateTime(file.created_at) }}
                </dd>
              </dl>
            </div>
          </div>

          <!-- 操作按鈕 -->
          <div class="flex justify-between mt-4">
            <!-- 左側按鈕組 -->
            <div class="flex space-x-2">
              <!-- 下載檔案按鈕 - 使用永久連結 -->
              <button @click="emit('download-file', file)" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium">下載檔案</button>

              <!-- 預覽按鈕 - 使用永久連結 -->
              <button @click="emit('preview-file', file)" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium">預覽</button>
            </div>

            <button
              @click="$emit('close')"
              class="px-4 py-2 rounded-md text-sm font-medium transition-colors"
              :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { IconClose } from "@/components/icons";

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "preview-file", "download-file"]);

// 獲取當前網站基礎URL
const baseUrl = computed(() => {
  return window.location.origin;
});

// 匯入統一的工具函式
import { formatFileSize, getRemainingViews as getRemainingViewsUtil } from "@/utils/fileUtils.js";

// 匯入統一的時間處理工具
import { formatDateTimeWithSeconds } from "@/utils/timeUtils.js";

/**
 * 格式化日期時間
 * @param {string} dateString - UTC 時間字串
 * @returns {string} 格式化後的本地時間字串
 */
const formatDateTime = (dateString) => {
  return formatDateTimeWithSeconds(dateString);
};

/**
 * 計算過期時間的顯示樣式
 */
const expiresClass = computed(() => {
  if (!props.file.expires_at) {
    return props.darkMode ? "text-white" : "text-gray-900";
  }

  const expiryDate = new Date(props.file.expires_at);
  const now = new Date();

  if (expiryDate < now) {
    return "text-red-500";
  }

  const diffMs = expiryDate - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) {
    return "text-orange-500";
  }

  return props.darkMode ? "text-white" : "text-gray-900";
});

/**
 * 計算剩餘訪問次數
 */
const getRemainingViews = computed(() => {
  const remaining = getRemainingViewsUtil(props.file);
  if (remaining === Infinity) {
    return "無限制";
  }
  if (remaining === 0) {
    return "已用完";
  }
  return `${remaining} 次`;
});

/**
 * 計算剩餘次數的顯示樣式
 */
const remainingViewsClass = computed(() => {
  if (!props.file.max_views) {
    return props.darkMode ? "text-white" : "text-gray-900";
  }

  const viewCount = props.file.views || 0;
  const remaining = props.file.max_views - viewCount;

  if (remaining <= 0) {
    return "text-red-500";
  }

  if (remaining < 10) {
    return "text-orange-500";
  }

  return props.darkMode ? "text-white" : "text-gray-900";
});
</script>
