<template>
  <!-- 公告彈窗 - 主流設計模式 -->
  <Teleport to="body">
    <Transition name="modal" appear>
      <div
        v-if="showModal"
        class="fixed inset-0 z-[70] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 pt-16 sm:pt-4"
        @click="handleBackdropClick"
      >
        <div
          class="relative w-full max-w-sm sm:max-w-md lg:max-w-lg bg-white dark:bg-gray-800 rounded-lg shadow-xl transform transition-all max-h-[60vh] sm:max-h-[55vh] flex flex-col"
          @click.stop
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <!-- 標題欄 -->
          <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <!-- 公告圖示 -->
                <div class="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mr-3">
                  <IconInformationCircle size="md" class="text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </div>
                <h3 :id="titleId" class="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                  {{ t("announcement.title") }}
                </h3>
              </div>

              <!-- 關閉按鈕 -->
              <button @click="closeModal" class="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 transition-colors" :aria-label="t('common.close')">
                <IconClose size="lg" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- 內容區域 - 可滾動 -->
          <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-3 sm:py-4 min-h-0 custom-scrollbar">
            <div ref="contentRef" class="vditor-reset markdown-body"></div>
          </div>

          <!-- 底部操作欄 - 固定在底部 -->
          <div class="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg border-t border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between">
              <!-- 不再顯示選項 -->
              <label class="flex items-center cursor-pointer">
                <input type="checkbox" v-model="dontShowAgain" class="sr-only" />
                <div class="relative flex items-center justify-center">
                  <div
                    class="w-4 h-4 border-2 rounded transition-colors flex items-center justify-center"
                    :class="dontShowAgain ? 'bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500' : 'border-gray-300 dark:border-gray-600'"
                  >
                    <IconCheck v-if="dontShowAgain" size="xs" class="w-2.5 h-2.5 text-white" aria-hidden="true" />
                  </div>
                </div>
                <span class="ml-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  {{ t("announcement.dontShowAgain") }}
                </span>
              </label>

              <!-- 確定按鈕 -->
              <button
                @click="closeModal"
                class="px-3 sm:px-4 py-1.5 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                {{ t("announcement.gotIt") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { useLocalStorage } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { loadVditor, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { IconCheck, IconClose, IconInformationCircle } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const props = defineProps({
  content: {
    type: String,
    default: "",
  },
  enabled: {
    type: Boolean,
    default: false,
  },
  // 是否在頁面載入後自動彈出
  // - true: 自動彈出（舊行為）
  // - false: 不自動彈出（由父元件手動觸發 open()）
  autoOpen: {
    type: Boolean,
    default: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const { t } = useI18n();
const log = createLogger("AnnouncementModal");
const showModal = ref(false);
const dontShowAgain = ref(false);
const contentRef = ref(null);

// 生成唯一的標題ID
const titleId = `announcement-title-${Math.random().toString(36).substr(2, 9)}`;

// 使用者關閉狀態管理
const STORAGE_KEY = "cloudharbor_announcement_dismissed";
const MAX_DISMISSED_COUNT = 7; // 最多記住7個公告
const dismissedState = useLocalStorage(STORAGE_KEY, "");

// 生成內容唯一標識
const getContentKey = (content) => {
  if (!content) return "";
  // 使用完整內容生成唯一標識，支援中文字元
  // 任何內容變化都會生成新的雜湊，確保更新後重新顯示
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // 轉換為32位整數
  }
  return Math.abs(hash).toString(36); // 轉換為36進位制字串
};

const contentKey = computed(() => getContentKey(props.content));

// 檢查是否已被使用者關閉
const isDismissed = (contentKey) => {
  if (!contentKey) return false;
  return dismissedState.value && dismissedState.value.includes(contentKey);
};

// 是否存在“未讀公告”（用於父元件顯示紅點等）
const hasUnseenAnnouncement = computed(() => {
  return !!(props.enabled && props.content && !isDismissed(contentKey.value));
});

// 標記為已關閉
const markDismissed = (contentKey) => {
  if (!contentKey) return;

  const dismissed = dismissedState.value || "";
  let dismissedArray = dismissed ? dismissed.split(",").filter(Boolean) : [];

  // 新增新的雜湊（如果不存在）
  if (!dismissedArray.includes(contentKey)) {
    dismissedArray.push(contentKey);
  }

  // 限制數量，保留最新的10個
  if (dismissedArray.length > MAX_DISMISSED_COUNT) {
    dismissedArray = dismissedArray.slice(-MAX_DISMISSED_COUNT);
  }

  dismissedState.value = dismissedArray.join(",");
};

// 使用 Vditor 渲染 Markdown 內容
const renderContent = async () => {
  if (!contentRef.value || !props.content) return;

  try {
    // 清空之前的內容
    contentRef.value.innerHTML = "";

    // 透過統一 loader 載入 Vditor
    const Vditor = await loadVditor();

    // 使用 Vditor 的預覽功能渲染 Markdown
      Vditor.preview(contentRef.value, props.content, {
        cdn: VDITOR_ASSETS_BASE,
        lang: "zh_TW", // 介面文案使用正體中文（i18n/zh_TW.js）
        theme: {
          current: props.darkMode ? "dark" : "light",
          path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
        },
      hljs: {
        lineNumber: false,
        style: props.darkMode ? "vs2015" : "github",
      },
      markdown: {
        toc: false,
        mark: true,
        footnotes: false,
        autoSpace: true,
        listStyle: true,
        task: true,
        paragraphBeginningSpace: true,
        fixTermTypo: true,
        media: false,
      },
      math: {
        engine: "KaTeX",
        inlineDigit: true,
      },
    });
  } catch (error) {
    log.error("Vditor 渲染失敗:", error);
    // 降級到簡單渲染
    if (contentRef.value) {
      contentRef.value.innerHTML = `<div class="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">${props.content}</div>`;
    }
  }
};

// 關閉彈窗
const closeModal = () => {
  if (props.content) {
    if (dontShowAgain.value) {
      markDismissed(contentKey.value);
    }
  }
  showModal.value = false;
};

// 手動開啟
const open = async () => {
  if (!props.enabled || !props.content) return;
  showModal.value = true;
  await nextTick();
  renderContent();
};

// 背景點選關閉
const handleBackdropClick = () => {
  closeModal();
};

// 鍵盤事件處理
onKeyStroke("Escape", () => {
  if (showModal.value) {
    closeModal();
  }
});

// 檢查是否應該顯示公告
const checkShouldShow = async () => {
  if (props.enabled && props.content && props.autoOpen) {
    if (!isDismissed(contentKey.value)) {
      // 延遲顯示，讓頁面先載入完成
      await nextTick();
      setTimeout(async () => {
        showModal.value = true;
        // 等待彈窗顯示後再渲染內容
        await nextTick();
        renderContent();
      }, 500); // 頁面載入後0.5秒顯示
    }
  }
};

onMounted(() => {
  checkShouldShow();
});

// 監聽 props 變化
watch(
  () => [props.enabled, props.content],
  () => {
    checkShouldShow();
  }
);

// 監聽暗色模式變化，重新渲染內容
watch(
  () => props.darkMode,
  () => {
    if (showModal.value && contentRef.value) {
      renderContent();
    }
  }
);

defineExpose({
  open,
  close: closeModal,
  hasUnseenAnnouncement,
});
</script>

<style scoped>
/* 模態框動畫 */
.modal-enter-active {
  transition: all 0.3s ease-out;
}

.modal-leave-active {
  transition: all 0.2s ease-in;
}

.modal-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(-20px);
}

.modal-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-10px);
}

/* 自定義捲軸樣式 */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 3px;
  transition: background-color 0.2s ease;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* 暗色模式捲軸 */
.dark .custom-scrollbar {
  scrollbar-color: rgba(75, 85, 99, 0.5) transparent;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(75, 85, 99, 0.7);
}

/* 確保暗色模式正確顯示 */
:deep(.vditor-reset) {
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"') !important;
  background-color: transparent !important;
  font-size: 1rem !important;
  line-height: 1.7 !important;
  transition: all 0.3s ease;
}

/* 確保暗色模式下的特定樣式 */
:deep(.vditor-reset--dark) {
  color: #d4d4d4 !important;
  background-color: transparent !important;
}

/* 確保亮色模式下的特定樣式 */
:deep(.vditor-reset--light) {
  color: #374151 !important;
  background-color: transparent !important;
}

/* 表格暗色模式背景 */
:deep(.vditor-reset table),
:deep(.vditor-reset thead),
:deep(.vditor-reset tbody),
:deep(.vditor-reset tr),
:deep(.vditor-reset th),
:deep(.vditor-reset td) {
  background-color: v-bind('props.darkMode ? "transparent" : ""') !important;
  background: v-bind('props.darkMode ? "transparent" : ""') !important;
}
</style>
