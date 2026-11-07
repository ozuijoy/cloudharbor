<template>
  <div class="code-display" :class="{ 'code-display-dark': darkMode }">
    <!-- 載入狀態 -->
    <div v-if="loading" class="loading-state">
      <LoadingIndicator
        :text="$t('textPreview.loadingHighlight')"
        :dark-mode="darkMode"
        size="xl"
        :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
      />
    </div>
    <!-- 錯誤狀態 -->
    <div v-else-if="error" class="error-state">
      <p class="error-text">{{ error }}</p>
      <pre class="fallback-code">{{ content }}</pre>
    </div>
    <!-- 程式碼內容 -->
    <div v-else ref="codeContainer" class="code-container" v-html="highlightedCode"></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, watchEffect, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useCodeHighlight } from "@/composables/text-preview/useCodeHighlight.js";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("CodeDisplay");

// Props
const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  language: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  showLineNumbers: {
    type: Boolean,
    default: true,
  },
  filename: {
    type: String,
    default: "",
  },
});

// 響應式資料
const codeContainer = ref(null);
const loading = ref(false);
const error = ref(null);
const highlightedCode = ref("");

// 使用程式碼高亮 Composable
const { highlightCode, detectLanguageFromFilename, loadTheme } = useCodeHighlight();

// 渲染程式碼高亮
const renderCode = async () => {
  if (!props.content) {
    highlightedCode.value = "";
    return;
  }

  try {
    loading.value = true;
    error.value = null;

    // 檢測語言
    let language = props.language;
    if (!language && props.filename) {
      language = detectLanguageFromFilename(props.filename);
    }

    // 載入主題
    await loadTheme(null, props.darkMode);

    // 高亮程式碼
    const result = await highlightCode(props.content, language);

    if (result.success) {
      // 構建HTML字串
      let html = `<pre class="hljs-pre"><code class="hljs language-${result.language}">${result.html}</code></pre>`;

      // 新增行號
      if (props.showLineNumbers && props.content.split("\n").length > 1) {
        html = addLineNumbersToHTML(html, props.content);
      }

      highlightedCode.value = html;
    } else {
      throw new Error(result.error || "Code highlighting failed");
    }
  } catch (err) {
    log.error("程式碼高亮渲染失敗:", err);
    error.value = err.message;

    // 降級顯示原始程式碼
    highlightedCode.value = `<pre class="hljs-pre"><code class="hljs">${escapeHtml(props.content)}</code></pre>`;
  } finally {
    loading.value = false;
  }
};

/**
 * 為程式碼塊新增行號
 * @param {HTMLElement} preElement - pre 元素
 */
const addLineNumbers = (preElement) => {
  const codeElement = preElement.querySelector("code");
  if (!codeElement) return;

  const lines = codeElement.innerHTML.split("\n");
  const lineCount = lines.length;

  // 建立行號容器
  const lineNumbersContainer = document.createElement("div");
  lineNumbersContainer.className = "hljs-line-numbers";

  // 生成行號
  for (let i = 1; i <= lineCount; i++) {
    const lineNumber = document.createElement("span");
    lineNumber.className = "hljs-line-number";
    lineNumber.textContent = i.toString();
    lineNumbersContainer.appendChild(lineNumber);
  }

  // 包裝程式碼內容
  const codeWrapper = document.createElement("div");
  codeWrapper.className = "hljs-code-wrapper";
  codeWrapper.appendChild(codeElement.cloneNode(true));

  // 重新組織結構
  preElement.innerHTML = "";
  preElement.className += " hljs-with-line-numbers";
  preElement.appendChild(lineNumbersContainer);
  preElement.appendChild(codeWrapper);
};

/**
 * 為HTML新增行號
 * @param {string} html - 原始HTML
 * @param {string} content - 原始內容
 * @returns {string} 新增行號後的HTML
 */
const addLineNumbersToHTML = (html, content) => {
  //早期返回，避免不必要的計算
  if (!props.showLineNumbers) {
    return html;
  }

  const lineCount = content.split("\n").length;

  // 陣列join
  const lineNumbers = [];
  lineNumbers.push('<div class="hljs-line-numbers">');

  // 批次生成行號
  for (let i = 1; i <= lineCount; i++) {
    lineNumbers.push(`<div class="hljs-line-number">${i}</div>`);
  }

  lineNumbers.push("</div>");
  const lineNumbersHTML = lineNumbers.join("");

  const wrappedHTML = html.replace(
    /<pre class="hljs-pre"><code class="([^"]*)">([\s\S]*?)<\/code><\/pre>/,
    `<pre class="hljs-pre hljs-with-line-numbers">${lineNumbersHTML}<div class="hljs-code-wrapper"><code class="$1">$2</code></div></pre>`
  );

  return wrappedHTML;
};

/**
 * 轉義HTML字元
 * @param {string} text - 原始文字
 * @returns {string} 轉義後的文字
 */
const escapeHtml = (text) => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

//  watchEffect 避免重複渲染
// 新增防抖
let renderTimer = null;

const debouncedRender = () => {
  if (renderTimer) {
    clearTimeout(renderTimer);
  }
  renderTimer = setTimeout(() => {
    renderCode();
    renderTimer = null;
  }, 100); // 100ms 防抖
};

// 使用 watchEffect 統一監聽所有相關屬性
watchEffect(() => {
  // 監聽所有影響渲染的屬性
  const { content, language, darkMode, showLineNumbers, filename } = props;

  // 如果沒有內容，直接清空
  if (!content) {
    highlightedCode.value = "";
    return;
  }

  // 使用防抖渲染
  debouncedRender();
});
</script>

<style scoped>
.code-display {
  @apply w-full h-full overflow-auto;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
}

.loading-text,
.error-text {
  @apply text-sm text-gray-600;
}

.code-display-dark .loading-text,
.code-display-dark .error-text {
  @apply text-gray-400;
}

.fallback-code {
  @apply mt-4 p-4 text-sm font-mono bg-gray-100 rounded;
  @apply text-gray-800 whitespace-pre-wrap break-words;
}

.code-display-dark .fallback-code {
  @apply bg-gray-700 text-gray-200;
}

.code-container {
  width: 100%;
  height: 100%;
  position: relative;
}

/* 程式碼高亮樣式 */
:deep(.hljs-pre) {
  @apply m-0 p-2 text-sm font-mono overflow-auto;
  @apply bg-transparent border-0;
  line-height: 1.5;
  border-radius: 0;
}

:deep(.hljs-with-line-numbers) {
  @apply flex;
}

:deep(.hljs-line-numbers) {
  @apply flex flex-col text-right pr-2;
  @apply text-gray-400;
  min-width: 2rem;
  padding: 0.5rem 0.25rem;
  margin-left: -0.7rem;
  user-select: none;
  background: transparent;
}

:deep(.hljs-line-number) {
  @apply block;
  line-height: 1.5;
  font-size: 0.875rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

:deep(.hljs-code-wrapper) {
  @apply flex-1 overflow-auto;
}

:deep(.hljs-code-wrapper code) {
  @apply block p-2;
  background: transparent !important;
}

/* 暗色模式下的行號樣式 */
.code-display-dark :deep(.hljs-line-numbers) {
  @apply text-gray-500;
  background: transparent;
}

.code-display-dark :deep(.hljs-line-number) {
  color: #6b7280;
}

/* 捲軸樣式 */
.code-display::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.code-display::-webkit-scrollbar-track {
  background-color: #f3f4f6;
}

.code-display-dark::-webkit-scrollbar-track {
  background-color: #374151;
}

.code-display::-webkit-scrollbar-thumb {
  background-color: #d1d5db;
  border-radius: 4px;
}

.code-display-dark::-webkit-scrollbar-thumb {
  background-color: #6b7280;
}

.code-display::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af;
}

.code-display-dark::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af;
}
</style>
