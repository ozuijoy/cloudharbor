<template>
  <div class="vditor-editor-wrapper">
    <!-- 純文字編輯器 (在純文字模式下顯示) -->
    <textarea
      v-if="isPlainTextMode"
      :class="[
        'w-full p-4 font-mono text-base border rounded-lg resize-y focus:outline-none focus:ring-2',
        miniMode ? 'h-[250px]' : 'h-[600px]',
        darkMode ? 'bg-gray-800 border-gray-700 text-gray-100 focus:ring-primary-600' : 'bg-white border-gray-300 text-gray-900 focus:ring-primary-500',
      ]"
      v-model="plainTextContent"
      :placeholder="placeholder || $t('markdown.plainTextPlaceholder')"
      @input="syncContentFromPlainText"
    ></textarea>

    <!-- Markdown編輯器 (在Markdown模式下顯示) -->
    <div v-else :id="vditorId" class="w-full border rounded-lg" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

    <!-- 確認對話方塊：用於“清空內容”等需要二次確認的操作 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useBreakpoints, breakpointsTailwind } from "@vueuse/core";
import { loadVditor, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { createLogger } from "@/utils/logger.js";

// 國際化函式
const { t } = useI18n();
const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobileScreen = breakpoints.smaller("md"); // < 768px
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();
const log = createLogger("VditorUnified");

// 最佳化的表情配置
const getOptimizedEmojis = () => ({
  // 基本表情 (20個)
  smile: "😊",
  joy: "😂",
  laughing: "😆",
  wink: "😉",
  heart_eyes: "😍",
  thinking: "🤔",
  worried: "😟",
  cry: "😢",
  angry: "😠",
  sunglasses: "😎",
  // 手勢表情 (10個)
  thumbsup: "👍",
  thumbsdown: "👎",
  ok_hand: "👌",
  clap: "👏",
  muscle: "💪",
  // 心形表情 (5個)
  heart: "❤️",
  yellow_heart: "💛",
  green_heart: "💚",
  blue_heart: "💙",
  broken_heart: "💔",
  // 符號表情 (10個)
  check: "✅",
  x: "❌",
  warning: "⚠️",
  question: "❓",
  exclamation: "❗",
  star: "⭐",
  fire: "🔥",
  zap: "⚡",
  rocket: "🚀",
  bulb: "💡",
});

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  isPlainTextMode: {
    type: Boolean,
    default: false,
  },
  modelValue: {
    type: String,
    default: "",
  },
  miniMode: {
    type: Boolean,
    default: false,
  },
  placeholder: {
    type: String,
    default: "",
  },
});

// Emits
const emit = defineEmits(["update:modelValue", "editor-ready", "content-change", "import-file", "clear-content", "show-copy-formats"]);

const confirmClearContent = () => {
  confirm({
    title: t("common.dialogs.warningTitle"),
    message: t("markdown.messages.confirmClearContent"),
    confirmType: "warning",
    darkMode: props.darkMode,
  }).then((ok) => {
    if (ok) emit("clear-content");
  });
};

// 編輯器例項
let editor = null;
// 元件解除安裝標記
let isUnmounted = false;
// 每個元件例項一個唯一 id，避免多個 VditorUnified 同屏時 id 衝突
const vditorId = `vditor-${Math.random().toString(16).slice(2)}-${Date.now()}`;

// 純文字內容
const plainTextContent = ref("");
// 原始純文字內容（保留格式）
const originalPlainTextContent = ref("");

// 內容變化快取
let lastKnownValue = "";

// 獲取編輯器配置
const getEditorConfig = () => {
  // 編輯器主題：只有 "classic" 和 "dark"
  const editorTheme = props.darkMode ? "dark" : "classic";
  // 內容主題：用於預覽區域
  const contentTheme = props.darkMode ? "dark" : "light";

  // 檢測是否為移動裝置（按 Tailwind 斷點：< 768）
  const isMobile = isMobileScreen.value;
  // Mini 模式：移動端使用即時渲染(ir)，桌面端使用分屏(sv)
  // 完整模式：移動端使用即時渲染(ir)，桌面端使用分屏(sv)
  const defaultMode = isMobile || props.miniMode ? "ir" : "sv";
  const enableOutline = !isMobile && !props.miniMode;

  // Mini 模式的簡化工具欄
  const miniToolbar = [
    "bold",
    "italic",
    "strike",
    "|",
    "list",
    "ordered-list",
    "|",
    "link",
    "quote",
    "line",
    "|",
    "undo",
    "redo",
    {
      name: "clear-content-mini",
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"></path></svg>',
      tip: t("markdown.toolbar.clearContent"),
      click() {
        confirmClearContent();
      },
    },
    "|",
    "fullscreen",
    "edit-mode",
  ];

  // 完整工具欄
  const fullToolbar = [
    "emoji",
    "headings",
    "bold",
    "italic",
    "strike",
    "link",
    "|",
    "list",
    "ordered-list",
    "check",
    "outdent",
    "indent",
    "|",
    "quote",
    "line",
    "code",
    "inline-code",
    "insert-before",
    "insert-after",
    "|",
    // "upload",
    "table",
    "|",
    "undo",
    "redo",
    "|",
    {
      name: "import-markdown",
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"></path></svg>',
      tip: t("markdown.toolbar.importFile"),
      click() {
        emit("import-file");
      },
    },
    {
      name: "clear-content",
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"></path></svg>',
      tip: t("markdown.toolbar.clearContent"),
      click() {
        confirmClearContent();
      },
    },
    {
      name: "copy-formats",
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"></path></svg>',
      tip: t("markdown.toolbar.copyFormats"),
      click(event) {
        // 獲取按鈕位置資訊
        const buttonElement = event.target.closest(".vditor-tooltipped");
        if (buttonElement) {
          const rect = buttonElement.getBoundingClientRect();
          emit("show-copy-formats", {
            x: rect.left,
            y: rect.bottom + 5,
          });
        } else {
          emit("show-copy-formats");
        }
      },
    },
    "|",
    "fullscreen",
    "edit-mode",
    "both",
    "outline",
    "preview",
    "export",
    "help",
  ];

  return {
    height: props.miniMode ? 250 : 600,
    minHeight: props.miniMode ? 200 : 400,
    width: "100%",
    mode: defaultMode, // 保持原有的響應式模式邏輯
    theme: editorTheme,
    cdn: VDITOR_ASSETS_BASE,
    resize: {
      enable: true,
      position: "bottom",
    },
    counter: {
      enable: !props.miniMode, // Mini 模式不顯示計數器
      type: "text",
    },
    tab: "\t",
    indent: {
      tab: "\t",
      codeBlock: 4,
    },
    preview: {
      delay: props.miniMode ? 300 : 800, // Mini 模式更快的預覽響應
      maxWidth: 800,
      mode: "both",
      theme: {
        current: contentTheme,
        path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
      },
      hljs: {
        lineNumber: !props.miniMode, // Mini 模式不顯示行號
        style: props.darkMode ? "vs2015" : "github",
        js: `${VDITOR_ASSETS_BASE}/dist/js/highlight.js/third-languages.js`,
        css: (style) => `${VDITOR_ASSETS_BASE}/dist/js/highlight.js/styles/${style}.min.css`,
      },
      actions: props.miniMode ? [] : ["desktop", "tablet", "mobile", "mp-wechat", "zhihu"],
      markdown: {
        toc: !props.miniMode, // Mini 模式不需要目錄
        mark: true,
        footnotes: !props.miniMode,
        autoSpace: true,
        listStyle: true,
        task: true,
        paragraphBeginningSpace: true,
        fixTermTypo: true,
        media: !props.miniMode, // Mini 模式不需要媒體支援
        mermaid: {
          theme: props.darkMode ? "dark" : "default",
          useMaxWidth: false,
        },
      },
      math: {
        engine: "KaTeX",
        inlineDigit: true,
      },
    },
    typewriterMode: !props.miniMode, // Mini 模式關閉打字機模式
    outline: {
      enable: enableOutline,
      position: "left",
    },
    hint: {
      delay: 200,
      emoji: props.miniMode ? {} : getOptimizedEmojis(), // Mini 模式簡化表情
    },
    toolbar: props.miniMode ? miniToolbar : fullToolbar,
    placeholder: props.placeholder || t("markdown.editorPlaceholder"),
    cache: props.miniMode
      ? {
          enable: false,
        }
      : {
          enable: true,
          id: "cloudharbor-editor",
          after: (html) => {
            // 快取後的回撥，可以進行一些清理工作
            return html;
          },
        },
    upload: props.miniMode
      ? false
      : {
          accept: "image/*,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
          token: "",
          linkToImgUrl: "/api/fetch?url=",
          filename(name) {
            return name.replace(/\W/g, "");
          },
        },
    after: () => {
      emit("editor-ready", editor);
    },
    input: () => {
      try {
        if (editor && editor.getValue && typeof editor.getValue === "function") {
          const content = editor.getValue();
          if (content !== lastKnownValue) {
            lastKnownValue = content;
            emit("update:modelValue", content);
            emit("content-change", content);
          }
        }
      } catch (error) {
        log.error("獲取編輯器內容時出錯:", error);
      }
    },
    customKeymap: {
      Tab: () => {
        return false;
      },
    },
  };
};

// 初始化編輯器
const initEditor = async () => {
  if (isUnmounted) return;
  const vditorContainer = document.getElementById(vditorId);
  if (!vditorContainer) {
    log.error("找不到vditor容器元素，無法初始化編輯器");
    return;
  }

  try {
    // 懶載入Vditor
    const VditorConstructor = await loadVditor();

    // 使用配置函式獲取編輯器配置
    const config = getEditorConfig();

    if (isUnmounted) return;
    editor = new VditorConstructor(vditorId, config);
  } catch (error) {
    log.error("Vditor編輯器初始化失敗:", error);
  }
};

// 安全設定編輯器內容
const safeSetValue = (content) => {
  if (!editor || !editor.setValue || typeof editor.setValue !== "function") return;

  setTimeout(() => {
    if (editor && editor.setValue && typeof editor.setValue === "function") {
      try {
        editor.setValue(content);
      } catch (error) {
        log.error("設定編輯器內容失敗:", error);
      }
    }
  }, 500);
};

// 同步純文字內容
const syncContentFromPlainText = () => {
  originalPlainTextContent.value = plainTextContent.value;
  emit("update:modelValue", plainTextContent.value);
  emit("content-change", plainTextContent.value);
};

// 獲取編輯器內容
const getValue = () => {
  if (props.isPlainTextMode) {
    return originalPlainTextContent.value || plainTextContent.value;
  } else if (editor && editor.getValue && typeof editor.getValue === "function") {
    try {
      return editor.getValue();
    } catch (error) {
      log.error("獲取編輯器內容時出錯:", error);
      return "";
    }
  }
  return "";
};

// 設定編輯器內容
const setValue = (content) => {
  // 始終先同步內部的純文字狀態
  plainTextContent.value = content;
  originalPlainTextContent.value = content;

  // 在 Markdown 模式下，透過 safeSetValue 進行延遲、容錯的寫入
  if (!props.isPlainTextMode) {
    safeSetValue(content);
  }
};

// 獲取HTML內容
const getHTML = () => {
  if (editor && editor.getHTML && typeof editor.getHTML === "function") {
    try {
      return editor.getHTML();
    } catch (error) {
      log.error("獲取HTML內容時出錯:", error);
      return "";
    }
  }
  return "";
};

// 清空內容
const clearContent = () => {
  // Markdown 模式下，同樣透過 safeSetValue 清空，避免在銷燬/重建期間直接訪問例項內部狀態
  if (!props.isPlainTextMode) {
    safeSetValue("");
  }
  plainTextContent.value = "";
  originalPlainTextContent.value = "";
  emit("update:modelValue", "");
  emit("content-change", "");
};

// 監聽內容變化
watch(
  () => props.modelValue,
  (newValue) => {
    // 避免不必要的getValue()呼叫
    if (newValue !== lastKnownValue) {
      setValue(newValue);
      lastKnownValue = newValue;
    }
  },
  { immediate: true }
);

// 監聽暗色模式變化
watch(
  () => props.darkMode,
  async (newDarkMode, oldDarkMode) => {
    if (!props.isPlainTextMode && editor && newDarkMode !== oldDarkMode) {
      try {
        let currentValue = "";

        // 安全地獲取當前內容
        if (editor && editor.getValue && typeof editor.getValue === "function") {
          try {
            currentValue = editor.getValue();
          } catch (e) {
            log.warn("獲取編輯器內容失敗，使用空內容:", e);
            currentValue = "";
          }
        }

        // 重新初始化編輯器以應用新主題
        if (editor.destroy) {
          editor.destroy();
        }
        editor = null;

        await initEditor();

        // 設定內容
        if (currentValue) {
          safeSetValue(currentValue);
        }
      } catch (error) {
        log.error("切換主題時出錯:", error);
      }
    }
  }
);

// 監聽模式切換
watch(
  () => props.isPlainTextMode,
  async (newMode, oldMode) => {
    if (!newMode && oldMode !== newMode) {
      // 切換到Markdown模式
      await nextTick();

      if (editor) {
        try {
          if (editor.destroy) {
            editor.destroy();
          }
        } catch (e) {
          log.error("銷燬編輯器時出錯:", e);
        }
        editor = null;
      }

      // 初始化編輯器
      const initializeEditor = async () => {
        try {
          await initEditor();

          // 設定內容
          const contentToSet = plainTextContent.value || "";
          if (contentToSet) {
            safeSetValue(contentToSet);
          }
        } catch (error) {
          log.error("初始化編輯器時出錯:", error);
        }
      };

      if (window.requestIdleCallback) {
        window.requestIdleCallback(initializeEditor, { timeout: 1000 });
      } else {
        setTimeout(initializeEditor, 100);
      }
    }
  }
);

// 元件掛載
onMounted(async () => {
  if (!props.isPlainTextMode) {
    await nextTick();

    // 使用requestIdleCallback最佳化初始化時機
    const initializeEditor = async () => {
      try {
        if (isUnmounted) return;
        await initEditor();

        // 設定初始內容
        if (props.modelValue && editor) {
          safeSetValue(props.modelValue);
        }
      } catch (error) {
        log.error("初始化編輯器時出錯:", error);
      }
    };

    if (window.requestIdleCallback) {
      window.requestIdleCallback(initializeEditor, { timeout: 1000 });
    } else {
      // 降級方案
      setTimeout(initializeEditor, 100);
    }
  } else {
    plainTextContent.value = props.modelValue;
    originalPlainTextContent.value = props.modelValue;
  }
});

// 元件解除安裝
onUnmounted(() => {
  isUnmounted = true;
  if (!props.isPlainTextMode && editor) {
    try {
      if (editor.destroy && editor.element) {
        editor.destroy();
      }
      editor = null;
    } catch (e) {
      log.warn("銷燬編輯器時發生錯誤:", e);
      editor = null;
    }
  }
});

// 暴露方法
defineExpose({
  getValue,
  setValue,
  getHTML,
  clearContent,
  editor: () => editor,
});
</script>

<style scoped>
.vditor-editor-wrapper {
  width: 100%;
}

/* 純文字編輯器樣式 */
textarea {
  resize: vertical;
  min-height: 400px;
  font-family: Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace;
  line-height: 1.6;
  tab-size: 4;
  -moz-tab-size: 4;
  transition: border-color 0.2s, box-shadow 0.2s;
}

textarea:focus {
  outline: none;
}

/* 純文字編輯器暗色模式 */
textarea.bg-gray-800 {
  color: #d4d4d4;
}

/* 預覽區域的文字顏色 */
:deep(.vditor-reset) {
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"') !important;
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
