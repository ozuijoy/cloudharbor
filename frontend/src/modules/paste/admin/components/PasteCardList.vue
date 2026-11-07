<script setup>
import { computed } from "vue";
import { useCreatorBadge } from "@/composables/admin-management/useCreatorBadge.js";
import { IconCopy, IconDelete, IconEye, IconEyeOff, IconGlobeAlt, IconLink, IconLockClosed, IconQrCode, IconRefresh, IconRename } from "@/components/icons";

// 移動端的卡片列表檢視
// 建立者徽章統一邏輯
const { formatCreator } = useCreatorBadge();

/**
 * 元件接收的屬性定義
 * darkMode: 主題模式
 * pastes: 要展示的文字分享列表
 * loading: 載入狀態
 * selectedPastes: 已選中的文字分享ID列表
 * copiedTexts: 已複製的文字ID列表
 * copiedRawTexts: 已複製的原始文字ID列表
 */
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  pastes: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedPastes: {
    type: Array,
    required: true,
  },
  copiedTexts: {
    type: Object,
    default: () => ({}),
  },
  copiedRawTexts: {
    type: Object,
    default: () => ({}),
  },
});

/**
 * 定義元件要觸發的事件
 * toggle-select-item: 切換單個專案的選擇狀態
 * view: 檢視分享連結
 * copy-link: 複製分享連結
 * copy-raw-link: 複製原始文字連結
 * preview: 預覽分享內容
 * edit: 編輯分享屬性
 * delete: 刪除分享
 * show-qrcode: 顯示分享連結的二維碼
 */
const emit = defineEmits(["toggle-select-item", "view", "copy-link", "copy-raw-link", "preview", "edit", "delete", "show-qrcode"]);

/**
 * 擷取文字並新增省略號
 * @param {string} text - 需要擷取的文字
 * @param {number} length - 擷取長度
 * @returns {string} 擷取後的文字
 */
const truncateText = (text, length = 10) => {
  if (!text) return "無";
  return text.length <= length ? text : `${text.substring(0, length)}...`;
};

// 匯入統一的時間處理工具
import { formatDateTime, formatExpiry as formatExpiryUtil, isExpired as isExpiredUtil } from "@/utils/timeUtils.js";

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
  return paste.has_password;
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
  if (!paste.expires_at) return false;
  return isExpiredUtil(paste.expires_at);
};

</script>

<template>
  <!-- 移動端卡片檢視 - 僅在移動裝置上顯示 -->
  <div class="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
    <!-- 載入狀態 -->
    <div v-if="loading" class="p-4 text-center" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
      <div class="flex justify-center">
        <IconRefresh class="animate-spin h-5 w-5 text-primary-500" />
        <span class="ml-2">載入中...</span>
      </div>
    </div>

    <!-- 空資料狀態 -->
    <div v-else-if="pastes.length === 0" class="p-4 text-center" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">未找到分享記錄</div>

    <!-- 移動端卡片列表 - 遍歷pastes陣列生成卡片 -->
    <div v-for="paste in pastes" :key="paste.id" class="p-4 bg-white dark:bg-gray-800 border-b dark:border-gray-700">
      <!-- 卡片頭部 - 連結和操作按鈕 -->
      <div class="flex justify-between items-start mb-2">
        <!-- 左側：核取方塊、連結和複製按鈕 -->
        <div class="flex items-center">
          <input
            type="checkbox"
            :checked="selectedPastes.includes(paste.id)"
            @change="$emit('toggle-select-item', paste.id)"
            class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer mr-2"
          />
          <span
            class="cursor-pointer font-medium text-base hover:underline"
            @click="$emit('view', paste.slug)"
            :class="isExpired(paste) ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400'"
          >
            {{ paste.title || paste.remark || paste.slug }}
          </span>
          <button @click="$emit('copy-link', paste.slug)" class="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 relative" title="複製連結">
            <IconCopy class="h-4 w-4" />
            <!-- 新增複製成功提示 -->
            <span v-if="copiedTexts[paste.id]" class="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 text-xs text-white bg-green-500 rounded whitespace-nowrap">
              已複製
            </span>
          </button>
          <!-- 新增二維碼按鈕 -->
          <button @click="$emit('show-qrcode', paste.slug)" class="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="顯示二維碼">
            <IconQrCode class="h-4 w-4" />
          </button>
        </div>

        <!-- 右側：操作按鈕組（預覽、編輯、刪除） -->
        <div class="flex space-x-2">
          <!-- 預覽按鈕 -->
          <button class="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-300 p-1" @click="$emit('preview', paste)">
            <IconEye class="h-5 w-5" />
          </button>

          <!-- 編輯按鈕 -->
          <button class="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 p-1" @click="$emit('edit', paste)">
            <IconRename class="h-5 w-5" />
          </button>

          <!-- 複製原始文字直鏈按鈕 -->
          <button class="text-purple-600 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300 p-1 relative" @click="$emit('copy-raw-link', paste.slug)">
            <IconLink class="h-5 w-5" />
            <!-- 原始文字直鏈複製成功提示 -->
            <span v-if="copiedRawTexts[paste.id]" class="absolute -top-8 right-0 px-2 py-1 text-xs text-white bg-green-500 rounded whitespace-nowrap">已複製直鏈</span>
          </button>

          <!-- 刪除按鈕 -->
          <button class="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-1" @click="$emit('delete', paste.id)">
            <IconDelete class="h-5 w-5" />
          </button>
        </div>
      </div>

      <!-- 卡片內容 - 網格佈局展示詳細資訊 -->
      <div class="grid grid-cols-2 gap-2 text-sm mt-3">
        <!-- 備註資訊 -->
        <div>
          <div class="text-gray-500 dark:text-gray-400 text-xs mb-1">備註</div>
          <span
            class="truncate max-w-xs inline-block px-2 py-1 rounded"
            :class="[
              paste.remark ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : darkMode ? 'text-gray-300' : 'text-gray-500',
              isExpired(paste) ? 'text-red-600 dark:text-red-400' : '',
            ]"
            :title="paste.remark || '無'"
          >
            {{ truncateText(paste.remark) }}
          </span>
        </div>

        <!-- 建立時間 -->
        <div>
          <div class="text-gray-500 dark:text-gray-400 text-xs mb-1">建立時間</div>
          <div :class="[darkMode ? 'text-gray-300' : 'text-gray-500', isExpired(paste) ? 'text-red-600 dark:text-red-400' : '']">
            {{ formatDate(paste.created_at) }}
          </div>
        </div>

        <!-- 過期時間 -->
        <div>
          <div class="text-gray-500 dark:text-gray-400 text-xs mb-1">過期時間</div>
          <div :class="[darkMode ? 'text-gray-300' : 'text-gray-500', isExpired(paste) ? 'text-red-600 dark:text-red-400' : '']">
            {{ formatExpiry(paste.expires_at) }}
          </div>
        </div>

        <!-- 建立者 -->
        <div>
          <div class="text-gray-500 dark:text-gray-400 text-xs mb-1">建立者</div>
          <div class="flex">
            <span
              v-if="paste.created_by && paste.created_by.startsWith('apikey:')"
              class="px-3 py-1 text-xs rounded bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100 inline-block mt-1"
            >
              {{ paste.key_name ? `金鑰：${paste.key_name}` : `金鑰：${paste.created_by.substring(7, 12)}...` }}
            </span>
            <span
              v-else-if="paste.created_by === 'admin' || (paste.created_by && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paste.created_by))"
              class="px-3 py-1 text-xs rounded bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100 inline-block mt-1"
            >
              管理員
            </span>
            <span v-else class="px-3 py-1 text-xs rounded bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 inline-block mt-1">
              {{ paste.created_by || "未知來源" }}
            </span>
          </div>
        </div>

        <!-- 狀態資訊 - 包含密碼保護、可見性和剩餘次數 -->
        <div class="col-span-2">
          <div class="text-gray-500 dark:text-gray-400 text-xs mb-1">狀態資訊</div>
          <div class="flex items-center flex-wrap gap-2">
            <!-- 可見性標籤 -->
            <span
              v-if="paste.is_public === false"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            >
              <IconEyeOff class="h-3 w-3 mr-1" />
              僅內部
            </span>

            <!-- 密碼狀態標籤 - 已加密 -->
            <span
              v-if="hasPassword(paste)"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              :class="[isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100']"
            >
              <IconLockClosed class="h-3 w-3 mr-1" />
              已加密
            </span>

            <!-- 密碼狀態標籤 - 公開 -->
            <span
              v-else
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              :class="[isExpired(paste) ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100']"
            >
              <IconGlobeAlt class="h-3 w-3 mr-1" />
              公開
            </span>

            <!-- 剩餘訪問次數標籤 -->
            <span
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              :class="[
                isExpired(paste)
                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                  : getRemainingViews(paste) === 0
                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
              ]"
            >
              <IconEye class="h-3 w-3 mr-1" />
              剩餘 {{ getRemainingViewsLabel(paste) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
