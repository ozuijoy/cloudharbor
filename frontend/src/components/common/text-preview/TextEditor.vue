<template>
  <div class="text-editor" :class="{ 'text-editor-dark': darkMode }">
    <!-- Monaco編輯器容器 - 始終渲染 -->
    <div ref="editorContainer" class="editor-container">
      <!-- 載入狀態覆蓋層 -->
      <div v-if="loading" class="loading-overlay">
        <LoadingIndicator
          :text="$t('textPreview.loadingEditor')"
          :dark-mode="darkMode"
          size="xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>

      <!-- 錯誤狀態覆蓋層 -->
      <div v-else-if="error" class="error-overlay">
        <p class="error-text">{{ error }}</p>
        <div class="fallback-editor">
          <textarea
            v-model="localContent"
            class="fallback-textarea"
            :class="{ 'fallback-dark': darkMode }"
            :readonly="readOnly"
            @input="handleInput"
            :placeholder="$t('textPreview.fallbackEditor')"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import loader from "@monaco-editor/loader";
import { formatLocalDateTimeWithSeconds } from "@/utils/timeUtils.js";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("TextEditor");

// CDN 配置列表（按優先順序排序）
const CDN_LIST = [
  "https://cdnjs.znnu.com/monaco-editor/0.52.2/min/vs",  // cdnjs CDN
  "https://s4.zstatic.net/npm/monaco-editor@0.52.2/min/vs",  // ZStatic
  "https://fastly.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs", // JSDelivr
  "https://unpkg.com/monaco-editor@0.52.2/min/vs", // unpkg
];

// Props
const props = defineProps({
  content: {
    type: String,
    default: "",
  },
  language: {
    type: String,
    default: "plaintext",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
  height: {
    type: [Number, String],
    default: 400,
  },
  fontSize: {
    type: Number,
    default: 14,
  },
  wordWrap: {
    type: String,
    default: "on", // "on" | "off" | "wordWrapColumn" | "bounded"
  },
  minimap: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["change", "focus", "blur"]);

// 響應式狀態
const loading = ref(true);
const error = ref(null);
const editorContainer = ref(null);
const localContent = ref(props.content);

// Monaco編輯器例項
let monacoEditor = null;
let monaco = null;

// 監聽器清理
let contentChangeDisposable = null;
let focusDisposable = null;
let blurDisposable = null;

const addEditorActions = (editor, monaco) => {
  // 1. 切換自動換行
  editor.addAction({
    id: "toggle-word-wrap",
    label: "切換自動換行",
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
    contextMenuGroupId: "view",
    contextMenuOrder: 1,
    run: function (ed) {
      const currentWordWrap = ed.getOption(monaco.editor.EditorOption.wordWrap);
      ed.updateOptions({
        wordWrap: currentWordWrap === "on" ? "off" : "on",
      });
    },
  });

  // 2. 插入時間戳
  editor.addAction({
    id: "insert-timestamp",
    label: "插入時間戳",
    contextMenuGroupId: "modification",
    contextMenuOrder: 1,
    run: function (ed) {
      const timestamp = formatLocalDateTimeWithSeconds(new Date());
      const selection = ed.getSelection();
      ed.executeEdits("", [
        {
          range: selection,
          text: timestamp,
        },
      ]);
    },
  });

  // 3. 文字統計資訊
  editor.addAction({
    id: "show-text-stats",
    label: "顯示文字統計",
    contextMenuGroupId: "view",
    contextMenuOrder: 2,
    run: function (ed) {
      const content = ed.getValue();
      const lines = content.split("\n").length;
      const chars = content.length;
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;

      log.debug("文字統計:", { lines, chars, words });
    },
  });

  // 4. 轉換為大寫
  editor.addAction({
    id: "convert-to-uppercase",
    label: "轉換為大寫",
    contextMenuGroupId: "modification",
    contextMenuOrder: 2,
    run: function (ed) {
      const selection = ed.getSelection();
      const selectedText = ed.getModel().getValueInRange(selection);
      if (selectedText) {
        ed.executeEdits("", [
          {
            range: selection,
            text: selectedText.toUpperCase(),
          },
        ]);
      }
    },
  });

  // 5. 轉換為小寫
  editor.addAction({
    id: "convert-to-lowercase",
    label: "轉換為小寫",
    contextMenuGroupId: "modification",
    contextMenuOrder: 3,
    run: function (ed) {
      const selection = ed.getSelection();
      const selectedText = ed.getModel().getValueInRange(selection);
      if (selectedText) {
        ed.executeEdits("", [
          {
            range: selection,
            text: selectedText.toLowerCase(),
          },
        ]);
      }
    },
  });

  // 6. 切換程式碼縮圖（Minimap）
  editor.addAction({
    id: "toggle-minimap",
    label: "切換程式碼縮圖",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM],
    contextMenuGroupId: "view",
    contextMenuOrder: 3,
    run: function (ed) {
      const currentMinimap = ed.getOption(monaco.editor.EditorOption.minimap);
      ed.updateOptions({
        minimap: {
          ...currentMinimap,
          enabled: !currentMinimap.enabled,
        },
      });
    },
  });
};

/**
 * 初始化Monaco編輯器
 */
const initMonacoEditor = async () => {
  try {
    loading.value = true;
    error.value = null;

    // 等待DOM更新
    await nextTick();

    // 新增重試機制，確保DOM容器準備就緒
    let retryCount = 0;
    const maxRetries = 5;

    while (!editorContainer.value && retryCount < maxRetries) {
      log.debug(`等待編輯器容器準備就緒... (${retryCount + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      retryCount++;
    }

    if (!editorContainer.value) {
      throw new Error(`編輯器容器不存在 (重試${retryCount}次後仍然失敗)`);
    }

    log.debug("編輯器容器準備就緒，開始初始化Monaco編輯器");

    // 載入Monaco編輯器（帶CDN切換）
    log.debug("開始載入Monaco編輯器...");

    let lastError = null;
    for (let i = 0; i < CDN_LIST.length; i++) {
      try {
        const cdnUrl = CDN_LIST[i];
        log.debug(`嘗試 CDN ${i + 1}/${CDN_LIST.length}: ${cdnUrl}`);

        // 配置當前 CDN
        loader.config({
          paths: {
            vs: cdnUrl,
          },
        });

        // 嘗試載入
        monaco = await loader.init();

        if (monaco && monaco.editor) {
          log.debug(`Monaco編輯器載入成功，使用 CDN: ${cdnUrl}`);
          break;
        } else {
          throw new Error("Monaco編輯器物件無效");
        }
      } catch (error) {
        lastError = error;
        log.warn(`CDN ${i + 1} 載入失敗:`, error.message);

        if (i === CDN_LIST.length - 1) {
          throw new Error(`所有 CDN 都無法載入 Monaco Editor。最後錯誤: ${lastError?.message}`);
        }

        // 繼續嘗試下一個 CDN
        continue;
      }
    }

    // 建立編輯器例項
    monacoEditor = monaco.editor.create(editorContainer.value, {
      value: props.content,
      language: props.language,
      theme: props.darkMode ? "vs-dark" : "vs",
      readOnly: props.readOnly,
      fontSize: props.fontSize,
      wordWrap: props.wordWrap,
      // 啟用 minimap（程式碼縮圖）
      minimap: {
        enabled: true,
        side: "right",
        showSlider: "mouseover",
        renderCharacters: true,
        maxColumn: 120,
        scale: 1,
      },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      lineNumbers: "on",
      renderWhitespace: "selection",
      tabSize: 2,
      insertSpaces: true,
      folding: true,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      contextmenu: true,
      mouseWheelZoom: true,
      smoothScrolling: true,
      cursorBlinking: "blink",
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "line",
      selectionHighlight: true,
      occurrencesHighlight: "singleFile",
      codeLens: false,
      suggest: {
        showKeywords: true,
        showSnippets: true,
      },
    });

    // 監聽內容變化
    let changeTimer = null;
    let lastEmittedValue = ""; // 避免重複emit相同內容

    contentChangeDisposable = monacoEditor.onDidChangeModelContent(() => {
      if (changeTimer) clearTimeout(changeTimer);

      changeTimer = setTimeout(() => {
        const value = monacoEditor.getValue();

        // 避免重複emit相同內容
        if (value !== lastEmittedValue) {
          lastEmittedValue = value;
          localContent.value = value;
          emit("change", value);

          // 只在開發環境輸出日誌
          if (process.env.NODE_ENV === "development") {
            log.debug("Monaco編輯器內容變化:", value.length, "字元");
          }
        }

        changeTimer = null;
      }, 300); // 300ms防抖，平衡響應性和效能
    });

    // 監聽焦點事件
    focusDisposable = monacoEditor.onDidFocusEditorText(() => {
      emit("focus");
    });

    blurDisposable = monacoEditor.onDidBlurEditorText(() => {
      emit("blur");
    });

    // 新增有用的編輯器功能
    addEditorActions(monacoEditor, monaco);

    loading.value = false;
    log.debug("Monaco編輯器初始化成功", {
      language: props.language,
      theme: props.darkMode ? "vs-dark" : "vs",
      readOnly: props.readOnly,
    });
  } catch (err) {
    log.error("Monaco編輯器初始化失敗:", err);
    log.error("錯誤詳情:", {
      containerExists: !!editorContainer.value,
      containerElement: editorContainer.value,
      props: {
        content: props.content?.length || 0,
        language: props.language,
        darkMode: props.darkMode,
        readOnly: props.readOnly,
      },
    });
    error.value = err.message || t("textPreview.editorInitFailed");
    loading.value = false;
  }
};

/**
 * 處理fallback textarea輸入
 */
const handleInput = (event) => {
  const value = event.target.value;
  localContent.value = value;
  emit("change", value);
};

/**
 * 設定編輯器內容
 */
const setValue = (value) => {
  if (monacoEditor) {
    monacoEditor.setValue(value || "");
  } else {
    localContent.value = value || "";
  }
};

/**
 * 獲取編輯器內容
 */
const getValue = () => {
  if (monacoEditor) {
    return monacoEditor.getValue();
  }
  return localContent.value;
};

/**
 * 設定編輯器語言
 */
const setLanguage = (language) => {
  if (monacoEditor && monaco) {
    const model = monacoEditor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
  }
};

/**
 * 聚焦編輯器
 */
const focus = () => {
  if (monacoEditor) {
    monacoEditor.focus();
  }
};

/**
 * 調整編輯器大小
 */
const resize = () => {
  if (monacoEditor) {
    monacoEditor.layout();
  }
};

// 監聽props變化
watch(
  () => props.content,
  (newContent) => {
    if (newContent !== getValue()) {
      setValue(newContent);
    }
  }
);

watch(
  () => props.language,
  (newLanguage) => {
    setLanguage(newLanguage);
  }
);

watch(
  () => props.darkMode,
  (newDarkMode) => {
    if (monacoEditor) {
      monacoEditor.updateOptions({
        theme: newDarkMode ? "vs-dark" : "vs",
      });
    }
  }
);

watch(
  () => props.readOnly,
  (newReadOnly) => {
    if (monacoEditor) {
      monacoEditor.updateOptions({
        readOnly: newReadOnly,
      });
    }
  }
);

// 元件掛載
onMounted(async () => {
  await nextTick();

  // 使用requestIdleCallback最佳化初始化時機，確保DOM完全準備好
  const initializeEditor = async () => {
    try {
      await initMonacoEditor();
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
});

// 元件銷燬
onBeforeUnmount(() => {
  // 清理監聽器
  if (contentChangeDisposable) {
    contentChangeDisposable.dispose();
    contentChangeDisposable = null;
  }
  if (focusDisposable) {
    focusDisposable.dispose();
    focusDisposable = null;
  }
  if (blurDisposable) {
    blurDisposable.dispose();
    blurDisposable = null;
  }

  // 清理編輯器例項
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }
});

// 暴露方法
defineExpose({
  setValue,
  getValue,
  setLanguage,
  focus,
  resize,
  getEditor: () => monacoEditor,
});
</script>

<style scoped>
.text-editor {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  overflow: hidden;
}

.text-editor-dark {
  border-color: #374151;
}

.editor-container {
  flex: 1;
  min-height: 400px;
  position: relative;
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
  background-color: rgba(255, 255, 255, 0.9);
  z-index: 10;
}

.text-editor-dark .loading-overlay {
  background-color: rgba(31, 41, 55, 0.9);
}

.loading-text {
  margin-top: 1rem;
  color: #6b7280;
  font-size: 0.875rem;
}

/* 錯誤狀態覆蓋層 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.95);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  overflow: auto;
}

.text-editor-dark .error-overlay {
  background-color: rgba(31, 41, 55, 0.95);
}

.error-text {
  color: #ef4444;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.fallback-editor {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-top: 1rem;
}

.fallback-textarea {
  width: 100%;
  flex: 1;
  min-height: 300px;
  padding: 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background-color: #ffffff;
  color: #1f2937;
  resize: none;
  outline: none;
}

.fallback-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.fallback-dark {
  background-color: #1f2937;
  color: #e5e7eb;
  border-color: #374151;
}

.fallback-dark:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
}

/* 動畫 */
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
