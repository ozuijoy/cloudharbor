<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
// 匯入統一的時間處理工具
import { formatDateTime, formatRelativeTime, isExpired as isExpiredUtil } from "@/utils/timeUtils.js";
// 匯入統一的檔案工具
import { getRemainingViews as getRemainingViewsUtil } from "@/utils/fileUtils.js";
// 匯入建立者徽章統一邏輯
import { useCreatorBadge } from "@/composables/admin-management/useCreatorBadge.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { IconArrowUp, IconCalendar, IconCopy, IconDelete, IconError, IconEye, IconEyeOff, IconGlobeAlt, IconLink, IconLockClosed, IconMenu, IconQrCode, IconRename, IconUser } from "@/components/icons";

const { getCreatorText } = useCreatorBadge();
const { t } = useI18n();
const { showError } = useGlobalMessage();

/**
 * Paste 瀑布流卡片元件
 * 用於在瀑布流佈局中展示文字分享的預覽卡片
 */
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  paste: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["click", "preview", "edit", "delete", "copy-link", "copy-raw-link", "show-qrcode", "quick-edit-content"]);

/**
 * 截斷文字內容用於預覽
 * @param {string} text - 原始文字
 * @param {number} maxLength - 最大長度
 * @returns {string} 截斷後的文字
 */
const truncateContent = (text, maxLength = 800) => {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

/**
 * 獲取顯示內容
 * 管理端列表統一返回完整 content，這裡直接使用全文，預覽截斷交給前端 truncateContent 處理
 */
const displayContent = computed(() => {
  return props.paste.content || "";
});

/**
 * 檢查是否已過期
 */
const isExpired = computed(() => {
  return props.paste.expires_at ? isExpiredUtil(props.paste.expires_at) : false;
});

/**
 * 獲取剩餘訪問次數
 */
const remainingViews = computed(() => {
  return getRemainingViewsUtil(props.paste);
});

/**
 * 格式化建立者資訊
 */
const creatorLabel = computed(() => {
  return getCreatorText(props.paste.created_by, props.paste.key_name);
});

/**
 * 是否顯示剩餘次數警告角標（<20時顯示）
 */
const showViewsWarning = computed(() => {
  const num = remainingViews.value;
  return num !== Infinity && num > 0 && num < 10;
});

/**
 * 編輯狀態管理
 */
const isEditing = ref(false);
const editingContent = ref("");
const isTouchDevice = ref(false);

// 移動端雙擊檢測
const lastTapTime = ref(0);
const doubleTapDelay = 300;

/**
 * 開始編輯內容
 */
const startEditing = () => {
  editingContent.value = displayContent.value;
  isEditing.value = true;
  // 下一幀聚焦到 textarea
  nextTick(() => {
    const textarea = document.querySelector(`#edit-textarea-${props.paste.id}`);
    if (textarea) {
      // 防止瀏覽器自動滾動
      textarea.focus({ preventScroll: true });
      // 將 textarea 內部滾動位置重置到頂部
      textarea.scrollTop = 0;
      // 將游標定位到開頭
      textarea.setSelectionRange(0, 0);
    }
  });
};

/**
 * 儲存編輯內容
 */
const saveContent = () => {
  if (editingContent.value.trim() === "") {
    showError(t("markdown.messages.contentEmpty"));
    return;
  }

  emit("quick-edit-content", {
    id: props.paste.id,
    slug: props.paste.slug,
    content: editingContent.value,
  });

  isEditing.value = false;
};

/**
 * 取消編輯
 */
const cancelEdit = () => {
  isEditing.value = false;
  editingContent.value = "";
};

/**
 * 處理桌面端雙擊事件
 */
const handleDoubleClick = (event) => {
  // 如果點選的是按鈕或連結，不觸發編輯
  if (event.target.closest("button") || event.target.closest("a")) {
    return;
  }

  startEditing();
};

/**
 * 處理移動端雙擊事件
 * 透過檢測兩次觸控的時間間隔來判斷是否為雙擊
 */
const handleTouchStart = (event) => {
  // 如果點選的是按鈕或連結，不觸發編輯
  if (event.target.closest("button") || event.target.closest("a")) {
    return;
  }

  const currentTime = new Date().getTime();
  const tapInterval = currentTime - lastTapTime.value;

  // 如果兩次點選間隔小於閾值，認為是雙擊
  if (tapInterval < doubleTapDelay && tapInterval > 0) {
    // 阻止預設行為(如縮放)
    event.preventDefault();
    startEditing();
    // 重置時間，避免連續觸發
    lastTapTime.value = 0;
  } else {
    // 記錄本次點選時間
    lastTapTime.value = currentTime;
  }
};

/**
 * 下拉選單顯示狀態
 */
const dropdownRef = ref(null);
const showDropdown = ref(false);

/**
 * 切換下拉選單顯示狀態
 */
const toggleDropdown = (event) => {
  event.stopPropagation();
  showDropdown.value = !showDropdown.value;
};

/**
 * 關閉下拉選單
 */
const closeDropdown = () => {
  showDropdown.value = false;
};

/**
 * 處理卡片點選 - 取消點選行為
 */
const handleCardClick = () => {
  // 不執行任何操作，預覽功能移到三點選單
};

// 點選外部關閉下拉選單（VueUse 自動管理監聽器與清理）
onClickOutside(dropdownRef, () => {
  if (!showDropdown.value) return;
  closeDropdown();
});

// 生命週期：新增全域性點選事件監聽
onMounted(() => {
  // 檢測是否為觸控裝置（移動端）
  isTouchDevice.value =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
});
</script>

<template>
  <div
    class="paste-masonry-card relative group flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    :class="isExpired && !isEditing
      ? 'bg-gray-50 dark:bg-gray-900'
      : 'bg-white dark:bg-gray-800'"
    tabindex="0"
    @dblclick.prevent="handleDoubleClick"
    @touchstart="handleTouchStart"
  >
    <!-- 編輯模式：整個卡片變成編輯區 -->
    <div v-if="isEditing" class="flex flex-col min-h-[180px] sm:min-h-[220px]">
      <textarea
        :id="`edit-textarea-${paste.id}`"
        v-model="editingContent"
        class="w-full flex-1 p-3 sm:p-4 text-sm leading-relaxed resize-none border-none outline-none paste-edit-textarea min-h-[120px] sm:min-h-[160px] max-h-[400px] sm:max-h-[500px]"
        :class="darkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'"
        placeholder="編輯內容..."
        @keydown.esc="cancelEdit"
        @keydown.meta.enter="saveContent"
        @keydown.ctrl.enter="saveContent"
      ></textarea>

      <!-- 編輯按鈕組 -->
      <div class="flex items-center justify-end space-x-2 p-2 sm:p-3 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="cancelEdit"
          class="px-4 py-2 text-sm font-medium rounded transition-colors"
          :class="darkMode
            ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
        >
          取消
        </button>
        <button
          @click="saveContent"
          class="px-4 py-2 text-sm font-medium text-white rounded transition-colors"
          :class="darkMode
            ? 'bg-primary-600 hover:bg-primary-700'
            : 'bg-primary-600 hover:bg-primary-700'"
        >
          儲存
        </button>
      </div>
    </div>

    <!-- 閱讀模式：顯示完整卡片內容 -->
    <template v-else>
      <!-- 卡片頭部：建立時間 + 狀態標籤 + 操作按鈕 -->
      <div class="px-3 pt-3 pb-2 sm:px-4 sm:pt-4">
      <!-- 第一行：建立時間（左）+ 狀態標籤和按鈕（右） -->
      <div class="flex items-center justify-between mb-2">
        <!-- 左：建立時間（小字，顯示具體時分秒） -->
        <time class="text-xs text-gray-500 dark:text-gray-400" :datetime="paste.created_at" :title="formatDateTime(paste.created_at)">
          {{ formatDateTime(paste.created_at) }}
        </time>

        <!-- 右側：狀態標籤 + 操作按鈕 -->
        <div class="flex items-center space-x-2 flex-shrink-0">
          <!-- 狀態圖示組（僅圖示） -->
          <div class="flex items-center space-x-1.5">
            <!-- 密碼圖示 -->
            <span
              v-if="paste.has_password"
              class="inline-flex items-center justify-center w-6 h-6 rounded-full"
              :class="darkMode ? 'bg-amber-500/15' : 'bg-amber-50'"
              title="密碼保護"
            >
              <IconLockClosed class="h-4 w-4" :class="darkMode ? 'text-amber-200' : 'text-amber-600'" />
            </span>

            <!-- 可見性圖示 -->
            <span
              class="inline-flex items-center justify-center w-6 h-6 rounded-full"
              :class="paste.is_public
                ? (darkMode ? 'bg-green-500/15' : 'bg-green-50')
                : (darkMode ? 'bg-gray-500/15' : 'bg-gray-50')"
              :title="paste.is_public ? '公開訪問' : '僅管理員和建立者可見'"
            >
              <!-- 公開圖示 -->
              <IconGlobeAlt v-if="paste.is_public" class="h-4 w-4" :class="darkMode ? 'text-green-200' : 'text-green-600'" />
              <!-- 私密圖示 -->
              <IconEyeOff v-else class="h-4 w-4" :class="darkMode ? 'text-gray-200' : 'text-gray-600'" />
            </span>

            <!-- 過期圖示 -->
            <span v-if="isExpired" class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30" title="已過期">
              <IconError class="h-4 w-4 text-red-600 dark:text-red-400" />
            </span>

            <!-- 剩餘次數警告（<10時顯示）- 圖示+數字組合 -->
            <span
              v-if="showViewsWarning"
              class="inline-flex items-center space-x-0.5"
              :title="`剩餘次數: ${remainingViews}`"
            >
              <!-- 眼睛圖示（與其他圖示風格統一） -->
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded-full"
                :class="darkMode ? 'bg-orange-500/15' : 'bg-orange-50'"
              >
                <IconEye class="h-4 w-4" :class="darkMode ? 'text-orange-300' : 'text-orange-600'" />
              </span>
              <!-- 數字標籤 -->
              <span
                class="text-xs font-medium"
                :class="darkMode ? 'text-orange-300' : 'text-orange-600'"
              >
                {{ remainingViews }}
              </span>
            </span>
          </div>

          <!-- 三點操作按鈕 -->
          <div class="relative" ref="dropdownRef">
            <button
              @click.stop="toggleDropdown"
              class="p-2 sm:p-1 -m-1 sm:m-0 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
              title="更多操作"
            >
              <IconMenu class="h-4 w-4" />
            </button>

            <!-- 下拉選單 -->
            <div
              v-if="showDropdown"
              class="absolute right-0 top-8 mt-1 w-40 rounded-md shadow-lg bg-white dark:bg-gray-700 ring-1 ring-black ring-opacity-5 z-50"
              @click.stop
            >
              <div class="py-1">
                <!-- 預覽 -->
                <button
                  @click.stop="
                    emit('preview', paste);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconEye class="h-4 w-4 mr-2 text-blue-600 dark:text-blue-400" />
                  預覽
                </button>

                <!-- 快速編輯 -->
                <button
                  @click.stop="
                    startEditing();
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconArrowUp class="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
                  快速編輯
                </button>

                <!-- 編輯 -->
                <button
                  @click.stop="
                    emit('edit', paste);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconRename class="h-4 w-4 mr-2 text-indigo-600 dark:text-indigo-400" />
                  完整編輯
                </button>

                <!-- 複製連結 -->
                <button
                  @click.stop="
                    emit('copy-link', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconCopy class="h-4 w-4 mr-2 text-purple-600 dark:text-purple-400" />
                  複製連結
                </button>

                <!-- 複製直鏈 -->
                <button
                  @click.stop="
                    emit('copy-raw-link', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconLink class="h-4 w-4 mr-2 text-cyan-600 dark:text-cyan-400" />
                  複製直鏈
                </button>

                <!-- 顯示二維碼 -->
                <button
                  @click.stop="
                    emit('show-qrcode', paste.slug);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center transition-colors"
                >
                  <IconQrCode class="h-4 w-4 mr-2 text-gray-600 dark:text-gray-400" />
                  顯示二維碼
                </button>

                <!-- 分隔線 -->
                <div class="border-t border-gray-200 dark:border-gray-600 my-1"></div>

                <!-- 刪除 -->
                <button
                  @click.stop="
                    emit('delete', paste.id);
                    closeDropdown();
                  "
                  class="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center transition-colors"
                >
                  <IconDelete class="h-4 w-4 mr-2" />
                  刪除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 第二行：標題 -->
      <h3
        class="text-sm sm:text-base font-medium truncate mb-2"
        :class="isExpired ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400'"
        :title="paste.title || paste.remark || paste.slug"
      >
        {{ paste.title || paste.slug }}
      </h3>

      <!-- 內容區域 -->
      <div class="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-8 sm:line-clamp-10 whitespace-pre-wrap break-words leading-relaxed">
        {{ truncateContent(displayContent, 400) }}
      </div>
    </div>

    <!-- 卡片底部：後設資料（小字灰色） -->
    <div class="px-3 pb-2.5 sm:px-4 sm:pb-3">
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <!-- 建立者 -->
        <span class="inline-flex items-center">
          <IconUser class="h-3 w-3 mr-1" />
          {{ creatorLabel }}
        </span>

        <!-- 過期時間（如果有） -->
        <span v-if="paste.expires_at" class="inline-flex items-center" :class="isExpired ? 'text-red-600 dark:text-red-400' : ''">
          <IconCalendar class="h-3 w-3 mr-1" />
          {{ formatRelativeTime(paste.expires_at) }}
        </span>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 編輯態 textarea 自適應內容高度，疊加最大高度限制 */
.paste-edit-textarea {
  field-sizing: content;
}

/* line-clamp 工具類（Tailwind 3.x 已內建，這裡作為備用） */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-8 {
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-10 {
  display: -webkit-box;
  -webkit-line-clamp: 10;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
