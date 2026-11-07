<template>
  <div 
    ref="contentRef" 
    :class="['footer-markdown-content', darkMode ? 'footer-dark' : 'footer-light']"
  />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ensureMermaidPatchedForVditor, loadVditor, mightContainMermaid, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FooterMarkdownRenderer");

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

// Refs
const contentRef = ref(null);

// 元件銷燬狀態
const isDestroyed = ref(false);
let renderTimer = null;
let renderVersion = 0;

const scheduleIdle = (fn) => {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return;
  }
  setTimeout(fn, 800);
};

/**
 * - 看起來不像 Markdown：直接按純文字顯示
 * - 看起來像 Markdown：再用 Vditor preview 渲染
 */
const looksLikeMarkdown = (text) => {
  if (!text || typeof text !== "string") return false;
  // 只要出現這些特徵，就可能需要 Markdown 解析
  return /(?:```|~~~)|\[[^\]]+\]\([^)]+\)|(^|\n)\s{0,3}#{1,6}\s|\*\*|__|[*_-]{3,}/m.test(text);
};

// 使用 Vditor 渲染 Markdown 內容
const renderContent = async () => {
  const currentVersion = ++renderVersion;
  if (!contentRef.value || !props.content || isDestroyed.value) return;

  try {
    // 確保DOM更新後再渲染
    await nextTick();

    // 再次檢查元件狀態
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) {
      return;
    }

    // 清空之前的內容
    contentRef.value.innerHTML = "";

    // 快路徑：不像 Markdown 就直接顯示文字，避免引入 Vditor/lute 等大指令碼
    if (!looksLikeMarkdown(props.content)) {
      contentRef.value.textContent = props.content;
      return;
    }

    // 如果內容裡包含 Mermaid，先做同樣的補丁，避免 foreignObject 報錯
    if (mightContainMermaid(props.content)) {
      try {
        await ensureMermaidPatchedForVditor();
      } catch (e) {
        log.warn("頁尾 Mermaid 補丁載入失敗（將繼續正常渲染）:", e);
      }
    }

    // 透過統一 loader 獲取 Vditor 建構函式
    // 效能最佳化：重的載入放到“瀏覽器空閒時”再做，避免阻塞首屏
    await new Promise((resolve) => scheduleIdle(resolve));
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) return;

    const Vditor = await loadVditor();

    // 再次檢查元件狀態
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) {
      return;
    }

    // 使用 Vditor 的預覽功能渲染 Markdown
    Vditor.preview(contentRef.value, props.content, {
      cdn: VDITOR_ASSETS_BASE,
      lang: "zh_TW", // 介面文案使用正體中文（i18n/zh_TW.js）
      theme: {
        current: props.darkMode ? "dark" : "light",
        path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
      },
      hljs: {
        lineNumber: false, // 頁尾不需要行號
        style: props.darkMode ? "vs2015" : "github",
      },
      markdown: {
        toc: false, // 頁尾不需要目錄
        mark: true, // 支援標記
        footnotes: false, // 頁尾不需要腳註
        autoSpace: true, // 自動空格
        listStyle: true, // 支援列表樣式
        task: true, // 支援任務列表
        paragraphBeginningSpace: true,
        fixTermTypo: true,
        media: false, // 頁尾不需要媒體支援
      },
      math: {
        engine: "KaTeX",
        inlineDigit: true,
      },
      after: () => {
        // 渲染完成後的回撥
        if (isDestroyed.value || !contentRef.value) {
          return;
        }
        
        // 確保主題類正確應用
        if (props.darkMode) {
          contentRef.value.classList.add("vditor-reset--dark");
          contentRef.value.classList.remove("vditor-reset--light");
        } else {
          contentRef.value.classList.add("vditor-reset--light");
          contentRef.value.classList.remove("vditor-reset--dark");
        }
      },
    });
  } catch (error) {
    log.error("頁尾Markdown渲染失敗:", error);
    // 渲染失敗時顯示原始文字
    if (contentRef.value && !isDestroyed.value) {
      contentRef.value.textContent = props.content;
    }
  }
};

// 監聽內容變化
watch(
  () => props.content,
  () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderContent();
    }, 120);
  }
);

// 監聽暗色模式變化
watch(
  () => props.darkMode,
  () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderContent();
    }, 120);
  }
);

// 元件掛載時渲染
onMounted(() => {
  if (props.content) {
    renderContent();
  }
});

// 元件銷燬時清理
onBeforeUnmount(() => {
  isDestroyed.value = true;
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = null;
  
  // 清理 DOM
  if (contentRef.value) {
    contentRef.value.innerHTML = "";
  }
});
</script>

<style scoped>
.footer-markdown-content {
  /* 頁尾特定的樣式 */
  font-size: 0.875rem; /* text-sm */
  line-height: 1.25rem;
}

.footer-light {
  color: rgb(107 114 128); /* text-gray-500 */
}

.footer-dark {
  color: rgb(156 163 175); /* text-gray-400 */
}

/* 確保Vditor渲染的內容適配頁尾樣式 */
.footer-markdown-content :deep(.vditor-reset) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

/* 連結樣式適配 */
.footer-markdown-content :deep(.vditor-reset a) {
  color: rgb(59 130 246); /* blue-500 */
  text-decoration: underline;
}

.footer-dark .footer-markdown-content :deep(.vditor-reset a) {
  color: rgb(96 165 250); /* blue-400 */
}

.footer-markdown-content :deep(.vditor-reset a:hover) {
  color: rgb(37 99 235); /* blue-600 */
}

.footer-dark .footer-markdown-content :deep(.vditor-reset a:hover) {
  color: rgb(147 197 253); /* blue-300 */
}

/* 移除不必要的邊距 */
.footer-markdown-content :deep(.vditor-reset p) {
  margin: 0;
}

.footer-markdown-content :deep(.vditor-reset) {
  padding: 0;
  margin: 0;
}
</style>
