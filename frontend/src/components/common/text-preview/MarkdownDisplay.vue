<template>
  <div class="markdown-display" :class="{ 'markdown-display-dark': darkMode }">
    <!-- Markdown容器始終存在 -->
    <div ref="markdownContainer" class="vditor-reset markdown-body" :class="{ 'opacity-0': !rendered }"></div>

    <!-- 載入狀態覆蓋層 -->
    <div v-if="loading" class="loading-overlay">
      <LoadingIndicator
        :text="$t('textPreview.loadingMarkdown')"
        :dark-mode="darkMode"
        size="xl"
        :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
      />
    </div>

    <!-- 錯誤狀態覆蓋層 -->
    <div v-if="error" class="error-overlay">
      <p class="error-text">{{ error }}</p>
      <pre class="fallback-content">{{ content }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { ensureMermaidPatchedForVditor, loadVditor, mightContainMermaid, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("MarkdownDisplay");

// Props
const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["load", "error"]);

// 響應式狀態
const loading = ref(false);
const error = ref(null);
const rendered = ref(false);
const markdownContainer = ref(null);
const isDestroyed = ref(false);
const isActive = ref(true);
let renderVersion = 0;
let renderTimer = null;

/**
 * 檢查元件是否應該繼續執行非同步操作
 * @param {number} version - 發起操作時的版本號
 * @returns {boolean} - 是否應該繼續
 */
const shouldContinue = (version) => {
  return !isDestroyed.value && isActive.value && version === renderVersion;
};

/**
 * 渲染Markdown內容
 */
const renderMarkdown = async () => {
  // 遞增版本號，使之前的非同步操作失效
  const currentVersion = ++renderVersion;

  if (!props.content || !shouldContinue(currentVersion)) return;

  try {
    loading.value = true;
    error.value = null;
    rendered.value = false;

    // 確保DOM更新後再初始化Vditor
    await nextTick();

    // 更嚴格的元件狀態檢查（包含版本檢查）
    if (!shouldContinue(currentVersion) || !markdownContainer.value) {
      log.warn("MarkdownDisplay元件已銷燬/隱藏或DOM不存在，跳過渲染");
      return;
    }

    // 清空之前的內容
    markdownContainer.value.innerHTML = "";
    markdownContainer.value.classList.remove("vditor-reset--dark", "vditor-reset--light");

    // 載入和驗證
    let VditorConstructor;
    try {
      VditorConstructor = await loadVditor();
    } catch (loadError) {
      log.error("Vditor 載入失敗:", loadError);
      throw new Error(`Vditor 載入失敗: ${loadError.message}`);
    }

    // 再次檢查元件狀態（包含版本檢查）
    if (!shouldContinue(currentVersion) || !markdownContainer.value) {
      log.warn("MarkdownDisplay元件已銷燬/隱藏，取消Vditor渲染");
      return;
    }

    // 檢查 Vditor 是否有效
    if (!VditorConstructor || typeof VditorConstructor.preview !== "function") {
      throw new Error("Vditor.preview 方法不可用");
    }

    // 避免 foreignObject 的 width 出現極小負數，導致控制檯報錯。
    if (mightContainMermaid(props.content)) {
      try {
        await ensureMermaidPatchedForVditor();
      } catch (patchError) {
        log.warn("Mermaid 補丁載入失敗（將繼續正常渲染）:", patchError);
      }

      // 非同步等待後再做一次狀態檢查，避免元件已切走但仍繼續渲染
      if (!shouldContinue(currentVersion) || !markdownContainer.value) {
        log.warn("MarkdownDisplay元件已銷燬/隱藏，跳過 Mermaid 補丁後的渲染");
        return;
      }
    }

    try {
      // 使用 Vditor 的預覽 API 渲染內容
      VditorConstructor.preview(markdownContainer.value, props.content, {
        mode: "dark-light", // 支援明暗主題
        theme: {
          current: props.darkMode ? "dark" : "light", // 根據darkMode設定主題
          path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
        },
        cdn: VDITOR_ASSETS_BASE,
        hljs: {
          lineNumber: true, // 程式碼塊顯示行號
          style: props.darkMode ? "vs2015" : "github", // 程式碼高亮樣式
        },
        markdown: {
          toc: true, // 啟用目錄
          mark: true, // 啟用標記
          footnotes: true, // 啟用腳註
          autoSpace: true, // 自動空格
          media: true, // 啟用媒體連結解析
          listStyle: true, // 啟用列表樣式支援
          task: true, // 啟用任務列表
          mermaid: {
            theme: "default",
            useMaxWidth: false,
          },
          flowchart: {
            theme: "default",
          },
        },
        math: {
          engine: "KaTeX",
          inlineDigit: true,
        },
        after: () => {
          // 檢查元件是否已被銷燬/隱藏，或者是否是過期的渲染操作
          if (!shouldContinue(currentVersion) || !markdownContainer.value) {
            log.warn("MarkdownDisplay元件已銷燬/隱藏或渲染已過期，跳過after回撥");
            return;
          }

          // 渲染完成後的回撥
          log.debug("Markdown 內容渲染完成");

          // 強制新增對應主題的類
          if (props.darkMode) {
            markdownContainer.value.classList.add("vditor-reset--dark");
            markdownContainer.value.classList.remove("vditor-reset--light");
          } else {
            markdownContainer.value.classList.add("vditor-reset--light");
            markdownContainer.value.classList.remove("vditor-reset--dark");
          }

          // 設定渲染完成狀態
          rendered.value = true;
          loading.value = false;
          emit("load");
        },
      });
    } catch (previewError) {
      log.error("Vditor.preview 呼叫失敗:", previewError);
      throw new Error(`Markdown 渲染失敗: ${previewError.message}`);
    }

    log.debug("Markdown 預覽渲染成功");
  } catch (err) {
    log.error("Markdown 預覽渲染失敗:", err);
    error.value = err.message || t("textPreview.markdownRenderFailed");
    loading.value = false;
    rendered.value = false;
    emit("error", err);
  }
};

/**
 * 延遲渲染（防抖）
 */
const scheduleRenderMarkdown = () => {
  // 遞增版本號，讓已經排隊/執行中的任務失效
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderMarkdown();
  }, 80);
};

// 監聽內容變化
watch(() => props.content, scheduleRenderMarkdown);

// 監聽暗色模式變化，重新渲染
watch(() => props.darkMode, scheduleRenderMarkdown);

// 元件掛載時渲染
onMounted(() => {
  if (props.content) {
    scheduleRenderMarkdown();
  }
});

// KeepAlive 啟用時（如果父元件使用 KeepAlive）
onActivated(() => {
  isActive.value = true;
  if (props.content && !rendered.value) {
    scheduleRenderMarkdown();
  }
});

// KeepAlive 停用時
onDeactivated(() => {
  isActive.value = false;
  renderVersion++;
});

// 元件銷燬時清理
onBeforeUnmount(() => {
  isDestroyed.value = true;
  isActive.value = false;
  // 遞增版本號，取消正在進行的渲染操作
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = null;

  // 清理 DOM
  if (markdownContainer.value) {
    markdownContainer.value.innerHTML = "";
  }
  log.debug("MarkdownDisplay元件銷燬");
});

defineExpose({
  // 暫停渲染
  pause: () => {
    isActive.value = false;
    renderVersion++;
  },
  // 恢復渲染
  resume: () => {
    isActive.value = true;
    if (props.content && !rendered.value) {
      renderMarkdown();
    }
  },
});
</script>

<style scoped>
.markdown-display {
  width: 100%;
  flex: 1;
  overflow: auto;
  position: relative;
}

.markdown-display-dark {
  background-color: #1f2937;
}

/* 載入狀態覆蓋層 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background-color: rgba(255, 255, 255, 0.95);
  z-index: 10;
}

.loading-text {
  color: #6b7280;
  font-size: 0.875rem;
}

.markdown-display-dark .loading-overlay {
  background-color: rgba(31, 41, 55, 0.95);
}

.markdown-display-dark .loading-text {
  color: #9ca3af;
}

/* 錯誤狀態覆蓋層 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.95);
  z-index: 10;
}

.error-text {
  color: #ef4444;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.fallback-content {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #374151;
  background-color: #f9fafb;
  padding: 1rem;
  border-radius: 0.375rem;
  border: 1px solid #e5e7eb;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

.markdown-display-dark .error-overlay {
  background-color: rgba(31, 41, 55, 0.95);
}

.markdown-display-dark .fallback-content {
  color: #d4d4d4;
  background-color: #1f2937;
  border-color: #4b5563;
}

/* VditorJS相關樣式 */
:deep(.vditor-reset) {
  font-size: 1rem !important;
  line-height: 1.7 !important;
  padding: 0.5rem 1rem !important;
  transition: all 0.3s ease;
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"') !important;
  background-color: transparent !important;
}

/* 確保程式碼塊樣式正確 */
:deep(.vditor-reset pre) {
  background-color: v-bind('props.darkMode ? "#1f2937" : "#f8f9fa"') !important;
  border: 1px solid v-bind('props.darkMode ? "#374151" : "#e9ecef"');
  border-radius: 0.375rem;
}

:deep(.vditor-reset code) {
  background-color: v-bind('props.darkMode ? "#374151" : "#f1f5f9"') !important;
  color: v-bind('props.darkMode ? "#e2e8f0" : "#1e293b"') !important;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
}

/* 表格樣式 */
:deep(.vditor-reset table) {
  border-color: v-bind('props.darkMode ? "#374151" : "#e5e7eb"') !important;
}

:deep(.vditor-reset th),
:deep(.vditor-reset td) {
  border-color: v-bind('props.darkMode ? "#374151" : "#e5e7eb"') !important;
}

/* 引用塊樣式 */
:deep(.vditor-reset blockquote) {
  border-left-color: v-bind('props.darkMode ? "#6b7280" : "#d1d5db"') !important;
  background-color: v-bind('props.darkMode ? "#1f2937" : "#f9fafb"') !important;
}

/* 連結樣式 */
:deep(.vditor-reset a) {
  color: v-bind('props.darkMode ? "#60a5fa" : "#3b82f6"') !important;
}

:deep(.vditor-reset a:hover) {
  color: v-bind('props.darkMode ? "#93c5fd" : "#1d4ed8"') !important;
}
</style>
