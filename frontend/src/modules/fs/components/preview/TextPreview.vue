<template>
  <!-- 直接使用 TextRenderer，減少巢狀 -->
  <div class="text-preview-wrapper">
    <TextRenderer
      v-if="textContent"
      :content="textContent"
      :mode="currentMode"
      :language="detectedLanguage"
      :filename="fileData?.name || ''"
      :dark-mode="darkMode"
      :show-line-numbers="true"
      :read-only="currentMode !== 'edit'"
      :show-stats="true"
      :max-height="maxHeight"
      @content-change="handleContentChange"
      @save="handleSave"
    />
    <div v-else class="loading-indicator">
      <LoadingIndicator
        :text="$t('mount.textPreview.loadingText')"
        :dark-mode="darkMode"
        size="xl"
        :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import TextRenderer from "@/components/common/text-preview/TextRenderer.vue";
import { useTextPreview } from "@/composables/text-preview/useTextPreview.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FsTextPreview");

// Props 定義
const props = defineProps({
  // 檔案資訊
  file: {
    type: Object,
    required: true,
  },
  // 文字URL
  textUrl: {
    type: String,
    default: null,
  },
  // 是否為深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否為管理員
  isAdmin: {
    type: Boolean,
    default: false,
  },
  // 當前目錄路徑
  currentPath: {
    type: String,
    default: "",
  },
  // 目錄專案列表
  directoryItems: {
    type: Array,
    default: () => [],
  },
  // 初始預覽模式
  initialMode: {
    type: String,
    default: "text",
  },
  // 初始編碼
  initialEncoding: {
    type: String,
    default: "utf-8",
  },
  // 最大高度
  maxHeight: {
    type: [Number, String],
    default: 600,
  },
});

// Emits 定義
const emit = defineEmits(["load", "error", "encoding-change", "save"]);

// 響應式資料
const currentMode = ref(props.initialMode);
const currentEncoding = ref(props.initialEncoding);

// 當前檔案資料（響應式）
const currentFileData = ref(null);

// 使用統一的文字預覽邏輯
const {
  textContent,
  detectedLanguage,
  currentEncoding: previewEncoding,
  loading,
  error,
  loadTextContent: loadText,
  handleEncodingChange: changeEncoding,
} = useTextPreview({
  checkCancelled: true,
  emitEncodingChange: true,
});

// 路徑密碼管理，用於為受保護路徑的內容請求附加 token
const pathPassword = usePathPassword();

// 為了相容性，保留 fileData 計算屬性
const fileData = computed(() => currentFileData.value);

const handleEncodingChange = async (newEncoding) => {
  currentEncoding.value = newEncoding;

  // 使用統一的編碼切換邏輯
  await changeEncoding(newEncoding, emit);
};

const handleContentChange = (newContent) => {
  textContent.value = newContent;
};

const handleSave = (content) => {
  emit("save", {
    content,
    filename: currentFileData.value?.name,
    path: currentFileData.value?.path,
  });
};

// 載入文字內容 - 使用統一邏輯
const loadTextContent = async () => {
  if (!currentFileData.value) {
    log.warn("沒有可用的檔案資料");
    return;
  }

  // 同步編碼狀態
  const result = await loadText(currentFileData.value, emit);
  if (result.success) {
    currentEncoding.value = result.result.encoding || "utf-8";
  }
};

// 初始化當前檔案資料
const initializeCurrentFile = async () => {
  if (!props.file) {
    return;
  }

  const fsPath = props.file.path || props.currentPath || "/";

  // 為預覽內容構造統一的同源內容 URL
  let baseContentUrl = `/api/fs/content?path=${encodeURIComponent(fsPath)}`;

  // 非管理員訪問時，附加路徑密碼 token（如果存在）
  if (!props.isAdmin) {
    const token = pathPassword.getPathToken(fsPath);
    if (token) {
      baseContentUrl += `&path_token=${encodeURIComponent(token)}`;
    }
  }

  // 文字/Markdown/程式碼預覽需要透過 fetch 拉取內容：
  // - 對同源或 proxy 連結可直接使用 textUrl
  // - 對跨域 direct 連結禁用外鏈 fetch，強制走同源 /api/fs/content
  const safeTextUrl = (() => {
    if (!props.textUrl) return null;
    try {
      const resolved = new URL(props.textUrl, window.location.href);
      if (resolved.origin === window.location.origin) {
        return props.textUrl;
      }
      const linkType = (props.file?.linkType || "").toLowerCase();
      if (linkType === "proxy") {
        return props.textUrl;
      }
      return null;
    } catch {
      return null;
    }
  })();

  const previewUrl = safeTextUrl || baseContentUrl;

  if (previewUrl) {
    currentFileData.value = {
      name: props.file.name || "unknown",
      filename: props.file.name || "unknown",
      previewUrl: previewUrl,
      contentUrl: baseContentUrl,
      path: fsPath,
      contentType: props.file.contentType,
      size: props.file.size,
      modified: props.file.modified,
      originalFile: props.file,
    };

    // 載入文字內容
    await loadTextContent();
  } else {
    log.error("❌ 沒有可用的文字內容 URL");
  }
};

// 監聽檔案變化
watch(
  () => props.file,
  () => {
    initializeCurrentFile();
  },
  { immediate: true }
);

// 監聽URL變化
watch(
  () => props.textUrl,
  () => {
    initializeCurrentFile();
  }
);

// 監聽模式變化
watch(
  () => props.initialMode,
  (newMode) => {
    currentMode.value = newMode;
  }
);

// 監聽編碼變化
watch(
  () => props.initialEncoding,
  (newEncoding) => {
    currentEncoding.value = newEncoding;
  }
);

// 暴露方法供父元件呼叫
defineExpose({
  // 切換預覽模式
  switchMode: (mode) => {
    currentMode.value = mode;
  },
  // 切換編碼
  switchEncoding: async (encoding) => {
    await handleEncodingChange(encoding);
  },
  // 獲取當前狀態
  getCurrentState: () => ({
    mode: currentMode.value,
    encoding: currentEncoding.value,
    file: currentFileData.value,
  }),
  // 獲取編輯器內容
  getValue: () => {
    // 無論什麼模式都返回當前文字內容
    return textContent.value;
  },
  // 設定編輯器內容
  setValue: (content) => {
    textContent.value = content;
  },
});
</script>

<style scoped>
.text-preview-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 200px;
}

.loading-text {
  font-size: 0.875rem;
}
</style>
