<template>
  <div class="text-renderer" :class="{ 'dark-mode': darkMode }">
    <!-- 內容區域 -->
    <div class="content-area" :style="contentStyle">
      <!-- 空內容 -->
      <div v-if="!content" class="empty-state">
        <div class="empty-icon">📄</div>
        <p class="empty-message" :class="textClass">內容為空</p>
      </div>

      <!-- 文字內容 -->
      <div v-else class="text-content">
        <!-- 純文字模式 -->
        <TextDisplay v-if="mode === 'text'" :content="content" :dark-mode="darkMode" />

        <!-- 程式碼高亮模式 -->
        <CodeDisplay v-else-if="mode === 'code'" :content="content" :language="language" :dark-mode="darkMode" :show-line-numbers="showLineNumbers" :filename="filename" />

        <!-- Markdown模式 -->
        <MarkdownDisplay v-else-if="mode === 'markdown'" :content="content" :dark-mode="darkMode" />

        <!-- HTML模式 -->
        <HtmlDisplay v-else-if="mode === 'html'" :content="content" :dark-mode="darkMode" />

        <!-- 編輯模式 -->
        <TextEditor
          v-else-if="mode === 'edit'"
          :content="content"
          :language="language"
          :dark-mode="darkMode"
          :read-only="readOnly"
          @change="handleContentChange"
          @save="handleSave"
        />

        <!-- 未知模式，降級到純文字 -->
        <TextDisplay v-else :content="content" :dark-mode="darkMode" />
      </div>

      <!-- 文字統計資訊 -->
      <div v-if="showStats && content" class="text-stats-footer" :class="{ 'stats-dark': darkMode }">
        <span class="stat-item">{{ lineCount }} L</span>
        <span class="stat-item">{{ characterCount }} Chars</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import TextDisplay from "./TextDisplay.vue";
import CodeDisplay from "./CodeDisplay.vue";
import HtmlDisplay from "./HtmlDisplay.vue";
import MarkdownDisplay from "./MarkdownDisplay.vue";
import TextEditor from "./TextEditor.vue";

// Props
const props = defineProps({
  // 文字內容
  content: {
    type: String,
    required: true,
  },
  // 渲染模式
  mode: {
    type: String,
    default: "text",
    validator: (value) => ["text", "code", "markdown", "html", "edit"].includes(value),
  },
  // 程式碼語言（僅程式碼模式需要）
  language: {
    type: String,
    default: "",
  },
  // 檔名（用於語言檢測）
  filename: {
    type: String,
    default: "",
  },
  // 是否暗色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否顯示行號（程式碼模式）
  showLineNumbers: {
    type: Boolean,
    default: true,
  },
  // 是否只讀（編輯模式）
  readOnly: {
    type: Boolean,
    default: true,
  },

  // 最大高度
  maxHeight: {
    type: [Number, String],
    default: 600,
  },
  // 是否顯示統計資訊
  showStats: {
    type: Boolean,
    default: true,
  },
});

// Emits
const emit = defineEmits(["content-change", "save"]);

// 計算屬性
const contentStyle = computed(() => {
  const styles = {};
  if (props.maxHeight) {
    styles.maxHeight = typeof props.maxHeight === "number" ? `${props.maxHeight}px` : props.maxHeight;
  }
  return styles;
});

const textClass = computed(() => ({
  "text-dark": props.darkMode,
  "text-light": !props.darkMode,
}));

//快取統計資訊計算
const textStats = computed(() => {
  if (!props.content) {
    return { lineCount: 0, characterCount: 0 };
  }

  // 一次遍歷計算所有統計資訊，避免重複分割字串
  let lineCount = 1;
  const characterCount = props.content.length;

  // 只在需要行數時才進行字串遍歷
  for (let i = 0; i < characterCount; i++) {
    if (props.content[i] === "\n") {
      lineCount++;
    }
  }

  return { lineCount, characterCount };
});

const lineCount = computed(() => textStats.value.lineCount);
const characterCount = computed(() => textStats.value.characterCount);

// 方法
const handleContentChange = (newContent) => {
  emit("content-change", newContent);
};

const handleSave = (content) => {
  emit("save", content);
};
</script>

<style scoped>
.text-renderer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.text-renderer.dark-mode {
  background-color: #1f2937;
}

/* 內容區域樣式 */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
}

.empty-icon {
  font-size: 2.25rem;
  margin-bottom: 1rem;
}

.empty-message {
  color: #6b7280;
}

.text-dark {
  color: #d1d5db;
}

/* 文字內容樣式 */
.text-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0; /* 關鍵：防止flex專案無限擴充套件 */
}

/* 統計資訊樣式 */
.text-stats-footer {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid #e5e7eb;
  background-color: #f9fafb;
  font-size: 0.875rem;
  color: #6b7280;
}

.text-stats-footer.stats-dark {
  border-top-color: #374151;
  background-color: #1f2937;
  color: #9ca3af;
}

.stat-item {
  white-space: nowrap;
}
</style>
