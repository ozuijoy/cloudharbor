<script setup>
// HTML預覽彈窗元件 - 用於在彈窗中安全預覽HTML程式碼
// 該元件使用iframe實現HTML的安全渲染，並提供複製程式碼、在新視窗開啟等功能
import { ref, watch, onMounted, nextTick, computed } from "vue";
import { onKeyStroke, useTimeoutFn } from "@vueuse/core";
import { IconClose, IconCollapse, IconExpand } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("HtmlPreviewModal");

// 定義元件接受的屬性
const props = defineProps({
  // HTML 程式碼內容
  htmlContent: {
    type: String,
    default: "",
  },
  // 是否顯示彈窗
  show: {
    type: Boolean,
    default: false,
  },
  // 暗色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 內容型別
  contentType: {
    type: String,
    default: "html",
  },
});

// 定義元件事件
const emit = defineEmits(["close", "open-external"]);

// iframe 引用
const iframeRef = ref(null);
// 渲染狀態
const renderState = ref("idle"); // 'idle', 'loading', 'rendered', 'error'
// 錯誤資訊
const errorMessage = ref("");
// 複製按鈕引用
const copyButtonRef = ref(null);

// 全屏狀態
const isFullscreen = ref(false);

// 計算HTML模板
const htmlTemplate = computed(() => {
  if (!props.htmlContent) return "";

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HTML預覽</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: ${props.darkMode ? "#d4d4d4" : "#333"};
      background-color: ${props.darkMode ? "#1a1a1a" : "#fff"};
    }

    /* 響應式設計 */
    @media (max-width: 768px) {
      body {
        padding: 8px;
        font-size: 14px;
      }
    }

    /* 基礎樣式重置 */
    * {
      box-sizing: border-box;
    }

    img {
      max-width: 100%;
      height: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
    }

    th, td {
      border: 1px solid ${props.darkMode ? "#444" : "#ddd"};
      padding: 8px;
      text-align: left;
    }

    th {
      background-color: ${props.darkMode ? "#333" : "#f5f5f5"};
    }

    pre {
      background-color: ${props.darkMode ? "#2d2d2d" : "#f5f5f5"};
      padding: 1em;
      border-radius: 4px;
      overflow-x: auto;
    }

    code {
      background-color: ${props.darkMode ? "#2d2d2d" : "#f5f5f5"};
      padding: 2px 4px;
      border-radius: 2px;
      font-family: 'Courier New', monospace;
    }
  </style>
</head>
<body>
  ${props.htmlContent}
</body>
</html>
  `.trim();
});

// 切換全屏
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
};

// 監聽 ESC：全屏時按 ESC 退出全屏
onKeyStroke("Escape", () => {
  if (isFullscreen.value) {
    isFullscreen.value = false;
  }
});

// 監聽 show 和 htmlContent 變化
watch([() => props.show, () => props.htmlContent], ([newShow, newHtml]) => {
  if (newShow && newHtml) {
    nextTick(() => renderHtml());
  }
});

// 處理關閉彈窗
const closeModal = () => {
  emit("close");
};

// 渲染 HTML 內容
const renderHtml = () => {
  if (!props.htmlContent) return;

  try {
    renderState.value = "loading";
    // 使用nextTick確保DOM更新後再設定狀態
    nextTick(() => {
      renderState.value = "rendered";
    });
  } catch (error) {
    log.error("渲染 HTML 時出錯:", error);
    errorMessage.value = error.message || "渲染 HTML 時發生錯誤";
    renderState.value = "error";
  }
};

// 在新視窗中開啟
const openInNewWindow = () => {
  emit("open-external", props.htmlContent);
};

// 複製 HTML 程式碼
const copyHtml = async () => {
  try {
    const success = await copyToClipboard(props.htmlContent);
    if (!success) {
      throw new Error("copy_failed");
    }

    const btn = copyButtonRef.value;
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "已複製";
      useTimeoutFn(() => {
        if (copyButtonRef.value) {
          copyButtonRef.value.textContent = original || "複製程式碼";
        }
      }, 2000);
    }
  } catch (err) {
    log.error("複製失敗:", err);
  }
};

// 元件掛載時，如果彈窗顯示就渲染內容
onMounted(() => {
  if (props.show && props.htmlContent) {
    renderHtml();
  }
});
</script>

<template>
  <div v-if="show" class="html-preview-modal">
    <div class="modal-overlay" @click="closeModal"></div>
    <div class="modal-container" :class="{ 'dark-mode': darkMode, fullscreen: isFullscreen }">
      <div class="modal-header">
        <h3>{{ contentType === "svg" ? "SVG 預覽" : "HTML 預覽" }}</h3>
        <div class="modal-actions">
          <button ref="copyButtonRef" class="action-button copy-button" @click="copyHtml">複製程式碼</button>
          <button class="action-button" @click="openInNewWindow">在新視窗開啟</button>
          <button class="action-button" @click="toggleFullscreen">
            <IconExpand v-if="!isFullscreen" size="sm" />
            <IconCollapse v-else size="sm" />
          </button>
          <button class="close-button" @click="closeModal">
            <IconClose />
          </button>
        </div>
      </div>

      <div class="modal-content">
        <!-- 載入狀態 -->
        <div v-if="renderState === 'loading'" class="loading-state">
          <LoadingIndicator
            text="正在渲染 HTML..."
            :dark-mode="darkMode"
            size="2xl"
            :icon-class="darkMode ? 'text-blue-400' : 'text-blue-600'"
            text-class="text-inherit"
          />
        </div>

        <!-- 錯誤狀態 -->
        <div v-else-if="renderState === 'error'" class="error-state">
          <p>渲染失敗: {{ errorMessage }}</p>
        </div>

        <!-- iframe 預覽 -->
        <iframe
          v-show="renderState === 'rendered'"
          ref="iframeRef"
          class="preview-iframe"
          :srcdoc="htmlTemplate"
          sandbox="allow-same-origin allow-scripts"
          title="HTML 預覽"
          @load="renderState = 'rendered'"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<style scoped>
.html-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1060;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px;
  padding-top: 80px;
}

@media (min-width: 640px) {
  .html-preview-modal {
    padding: 16px;
    padding-top: 16px;
  }
}

.modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  z-index: -1;
}

.modal-container {
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 320px;
  height: 85%;
  max-height: 600px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.3s ease;
}

@media (min-width: 640px) {
  .modal-container {
    max-width: 900px;
    height: 80%;
    max-height: 700px;
  }
}

.modal-container.dark-mode {
  background-color: #1e1e1e;
  color: #d4d4d4;
  border: 1px solid #333;
}

.modal-container.fullscreen {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1001;
}

.modal-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dark-mode .modal-header {
  border-color: #333;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.action-button {
  background-color: #f3f4f6;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #374151;
  min-height: 36px;
  transition: all 0.2s ease;
}

.dark-mode .action-button {
  background-color: #2d2d2d;
  color: #d4d4d4;
}

.action-button:hover {
  background-color: #e5e7eb;
}

.dark-mode .action-button:hover {
  background-color: #3d3d3d;
}

.action-button svg {
  width: 16px;
  height: 16px;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: #6b7280;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-button:hover {
  background-color: #f3f4f6;
  color: #374151;
}

.dark-mode .close-button {
  color: #9ca3af;
}

.dark-mode .close-button:hover {
  background-color: #2d2d2d;
  color: #d4d4d4;
}

.modal-content {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #f9fafb;
  position: relative;
}

.dark-mode .modal-content {
  background-color: #121212;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
}

.dark-mode .loading-state,
.dark-mode .error-state {
  color: #d4d4d4;
}

.error-state {
  color: #ef4444;
  padding: 24px;
  text-align: center;
}

.dark-mode .error-state {
  color: #f87171;
}

@media (max-width: 640px) {
  .modal-container {
    width: 95%;
    height: 90%;
  }

  .modal-header {
    flex-direction: column;
    align-items: flex-start;
    padding: 12px;
  }

  .modal-actions {
    margin-top: 8px;
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px;
  }

  .action-button {
    flex: 1;
    min-width: 80px;
    padding: 10px;
    font-size: 13px;
    min-height: 40px;
  }

  .close-button {
    padding: 8px;
  }
}
</style>
