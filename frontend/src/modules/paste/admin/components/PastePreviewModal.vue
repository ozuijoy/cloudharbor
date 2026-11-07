<script setup>
import { computed } from "vue";
// 預覽彈窗
import { IconClose, IconCopy, IconEye, IconEyeOff, IconGlobeAlt, IconLockClosed } from "@/components/icons";

// 元件接收的屬性定義
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  showPreview: {
    type: Boolean,
    required: true,
  },
  paste: {
    type: Object,
    default: null,
  },
  copiedTexts: {
    type: Object,
    default: () => ({}),
  },
});

// 定義元件要觸發的事件
const emit = defineEmits(["close", "view-paste", "copy-link"]);

// 匯入統一的時間處理工具
import { formatDateTime, formatExpiry as formatExpiryUtil } from "@/utils/timeUtils.js";

/**
 * 格式化日期為本地日期時間字串
 * @param {string} dateString - UTC 時間字串
 * @returns {string} 格式化後的本地時間字串
 */
const formatDate = (dateString) => {
  return formatDateTime(dateString);
};

 

/**
 * 格式化過期日期，同時顯示具體日期和相對時間
 * @param {string} expiryDate - UTC 時間字串
 * @returns {string} 格式化後的過期資訊
 */
const formatExpiry = (expiryDate) => {
  return formatExpiryUtil(expiryDate);
};

/**
 * 檢查文字分享是否設定了密碼
 * @param {Object} paste - 文字分享物件
 * @returns {boolean} 是否有密碼
 */
const hasPassword = (paste) => {
  return paste?.has_password;
};

// 匯入統一的工具函式
import { getRemainingViews as getRemainingViewsUtil } from "@/utils/fileUtils.js";

/**
 * 計算剩餘可訪問次數（數值）
 * @param {Object} paste - 文字分享物件
 * @returns {number} Infinity 表示無限制，0 表示已用完，正數表示剩餘次數
 */
const getRemainingViews = (paste) => {
  return getRemainingViewsUtil(paste);
};

/**
 * 格式化剩餘訪問次數為展示文案
 * @param {Object} paste - 文字分享物件
 * @returns {string}
 */
const getRemainingViewsLabel = (paste) => {
  const remaining = getRemainingViews(paste);
  if (remaining === Infinity) {
    return "無限制";
  }
  if (remaining === 0) {
    return "已用完";
  }
  return `${remaining}`;
};

/**
 * 檢查文字分享是否已過期
 * @param {Object} paste - 文字分享物件
 * @returns {boolean} 是否已過期
 */
const isExpired = (paste) => {
  if (!paste?.expires_at) return false;
  const expiryDate = new Date(paste.expires_at);
  const now = new Date();
  return expiryDate < now;
};

/**
 * 關閉預覽彈窗
 * 觸發close事件通知父元件
 */
const closePreview = () => {
  emit("close");
};

/**
 * 檢視文字分享連結
 * 觸發view-paste事件通知父元件
 * @param {string} slug - 文字分享的唯一標識
 */
const viewPaste = (slug) => {
  emit("view-paste", slug);
};
</script>

<template>
  <!-- 預覽彈窗 - 僅在showPreview為true時顯示 -->
  <div v-if="showPreview" class="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
    <div class="flex items-center sm:items-center justify-center min-h-screen pt-20 sm:pt-2 px-2 sm:px-4 pb-4 sm:pb-20 text-center sm:p-0">
      <!-- 背景蒙層 - 點選時關閉彈窗 -->
      <div class="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75 transition-opacity" aria-hidden="true" @click="closePreview"></div>

      <!-- 使對話方塊居中的輔助元素 -->
      <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

      <!-- 彈窗主體內容 -->
      <div
        class="inline-block align-middle sm:align-middle bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-sm sm:max-w-2xl lg:max-w-3xl max-h-[85vh] sm:max-h-[85vh] my-1 sm:my-8"
        :class="darkMode ? 'dark' : ''"
      >
        <!-- 彈窗頭部帶關閉按鈕 -->
        <div class="bg-white dark:bg-gray-800 px-3 py-2 sm:px-4 sm:py-3 border-b dark:border-gray-700 flex justify-between items-center">
          <h3 class="text-base sm:text-lg leading-6 font-medium text-gray-900 dark:text-gray-100" id="modal-title">內容預覽</h3>
          <button
            type="button"
            @click="closePreview"
            class="rounded-md p-1 inline-flex items-center justify-center text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none"
          >
            <span class="sr-only">關閉</span>
            <IconClose class="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        <!-- 彈窗內容區 - 帶捲軸 -->
        <div class="bg-white dark:bg-gray-800 px-2 sm:px-4 py-2 sm:py-4 overflow-y-auto" style="max-height: calc(85vh - 120px); min-height: 200px">
          <div class="flex flex-col space-y-2 sm:space-y-4 w-full">
            <!-- 後設資料展示區域 - 網格佈局 -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 bg-gray-50 dark:bg-gray-700 p-2 sm:p-4 rounded-lg text-sm">
              <!-- 標題 -->
              <div>
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">標題:</p>
                <p class="font-medium text-gray-900 dark:text-gray-100 truncate" :title="paste?.title || '未設定'">
                  {{ paste?.title || '未設定' }}
                </p>
              </div>

              <!-- ID資訊 - 移動端隱藏 -->
              <div class="hidden sm:block">
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">ID:</p>
                <p class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ paste?.id }}</p>
              </div>

              <!-- 連結資訊及複製按鈕 -->
              <div>
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">連結字尾:</p>
                <div class="flex items-center space-x-2">
                  <p class="font-medium text-primary-600 dark:text-primary-400 truncate">{{ paste?.slug }}</p>
                  <button @click="emit('copy-link', paste?.slug)" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0 relative">
                    <IconCopy class="h-4 w-4" />
                    <!-- 複製成功提示 -->
                    <span
                      v-if="props.copiedTexts[paste?.id]"
                      class="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 text-xs text-white bg-green-500 rounded whitespace-nowrap"
                    >
                      已複製
                    </span>
                  </button>
                </div>
              </div>

              <!-- 建立時間 -->
              <div>
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">建立時間:</p>
                <p class="font-medium text-gray-900 dark:text-gray-100">{{ formatDate(paste?.created_at) }}</p>
              </div>

              <!-- 過期時間 - 過期則使用紅色文字 -->
              <div class="col-span-1 sm:col-span-2">
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">過期時間:</p>
                <p class="font-medium" :class="[isExpired(paste) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100']">
                  {{ formatExpiry(paste?.expires_at) }}
                </p>
              </div>

              <!-- 狀態標籤組 - 橫向排列 -->
              <div class="col-span-1 sm:col-span-2">
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1.5">狀態:</p>
                <div class="flex flex-wrap items-center gap-2">
                  <!-- 密碼保護 -->
                  <span
                    v-if="paste && hasPassword(paste)"
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="[
                      isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100',
                    ]"
                  >
                    <IconLockClosed class="h-3 w-3 mr-1" />
                    已加密
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="[isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100']"
                  >
                    <IconLockClosed class="h-3 w-3 mr-1" />
                    未加密
                  </span>

                  <!-- 可見性 -->
                  <span
                    v-if="paste?.is_public"
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="[isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100']"
                  >
                    <IconGlobeAlt class="h-3 w-3 mr-1" />
                    公開
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="[isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300']"
                  >
                    <IconEyeOff class="h-3 w-3 mr-1" />
                    私密
                  </span>

                  <!-- 剩餘訪問次數 -->
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="[
                      isExpired(paste)
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                        : getRemainingViews(paste) === 0
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                        : paste?.max_views && getRemainingViews(paste) !== Infinity && getRemainingViews(paste) < 10
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
                    ]"
                  >
                    <IconEye class="h-3 w-3 mr-1" />
                    {{ paste ? getRemainingViewsLabel(paste) : "-" }}
                  </span>
                </div>
              </div>

              <!-- 備註資訊 - 如果存在則跨兩列顯示 -->
              <div v-if="paste?.remark" class="col-span-1 sm:col-span-2">
                <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">備註:</p>
                <p class="font-medium whitespace-pre-wrap break-words text-sm" :class="[isExpired(paste) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100']">
                  {{ paste.remark }}
                </p>
              </div>
            </div>

            <!-- 內容展示區域 - 帶捲軸 -->
            <div class="mt-1 sm:mt-2">
              <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1 sm:mb-2">內容:</p>
              <div class="bg-gray-50 dark:bg-gray-700 p-2 sm:p-4 rounded-lg max-h-48 sm:max-h-64 overflow-y-auto">
                <pre class="text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words text-xs sm:text-sm">{{ paste?.content }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- 彈窗底部按鈕區 -->
        <div class="bg-gray-50 dark:bg-gray-700 px-3 py-2 sm:px-6 sm:py-3 flex flex-col sm:flex-row-reverse sm:space-x-reverse space-y-2 sm:space-y-0 sm:space-x-3">
          <button
            type="button"
            class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-3 py-1.5 sm:px-4 sm:py-2 bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:w-auto"
            @click="viewPaste(paste?.slug)"
          >
            檢視連結
          </button>
          <button
            type="button"
            class="w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-3 py-1.5 sm:px-4 sm:py-2 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:w-auto"
            @click="closePreview"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
