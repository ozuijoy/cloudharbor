<template>
  <div class="paste-view-editor-wrapper">
    <!-- 主要編輯器內容 -->
    <div class="paste-view-editor">
      <!-- 新增隱藏的檔案輸入控制元件用於匯入Markdown檔案 -->
      <input type="file" ref="markdownImporter" accept=".md,.markdown,.mdown,.mkd" style="display: none" @change="importMarkdownFile" />

      <!-- 編輯器模式切換按鈕 -->
      <div class="mb-1 flex justify-end">
        <button
          class="px-1.5 py-0.5 text-xs rounded-md border transition-colors"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600' : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'"
          @click="toggleEditorMode"
          :title="isPlainTextMode ? '切換到Markdown模式' : '切換到純文字模式'"
        >
          <span class="inline-flex items-center">
            <IconRefresh size="xs" class="w-3 h-3 mr-0.5" />
            {{ isPlainTextMode ? "切換MD" : "切換TXT" }}
          </span>
        </button>
      </div>

      <div class="editor-wrapper">
        <!-- 編輯器區域 -->
        <div class="flex flex-col gap-2">
          <!-- 純文字編輯器 (在純文字模式下顯示) -->
          <textarea
            v-if="isPlainTextMode"
            class="w-full h-[500px] p-4 font-mono text-base border rounded-lg resize-y focus:outline-none focus:ring-2"
            :class="darkMode ? 'bg-gray-800 border-gray-700 text-gray-100 focus:ring-primary-600' : 'bg-white border-gray-300 text-gray-900 focus:ring-primary-500'"
            v-model="plainTextContent"
            placeholder="在此輸入純文字內容..."
            @input="syncContentFromPlainText"
          ></textarea>

          <!-- Markdown編輯器 (在Markdown模式下顯示) -->
          <VditorUnified
            v-else
            ref="editorRef"
            :dark-mode="darkMode"
            :is-plain-text-mode="false"
            v-model="editorContent"
            @editor-ready="handleEditorReady"
            @content-change="handleContentChange"
            @import-file="triggerImportFile"
            @clear-content="clearEditorContent"
            @show-copy-formats="showCopyFormatsMenu"
          />
        </div>
      </div>

      <!-- 後設資料編輯表單 - 允許編輯備註、過期時間等 -->
      <div class="mt-6 border-t pt-4" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-2">
          <!-- 標題 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">標題</label>
            <input
              type="text"
              class="form-input w-full rounded-md shadow-sm"
              :class="getInputClasses(darkMode)"
              placeholder="為文字分享新增一個標題（可選）"
              v-model="editForm.title"
            />
          </div>

          <!-- 備註資訊 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">備註(可選)</label>
            <input type="text" class="form-input w-full rounded-md shadow-sm" :class="getInputClasses(darkMode)" placeholder="新增備註資訊..." v-model="editForm.remark" />
          </div>

          <!-- 連結字尾 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">連結字尾</label>
            <div class="flex items-center">
              <input
                type="text"
                class="form-input w-full rounded-md shadow-sm"
                :class="[getInputClasses(darkMode), slugError ? (darkMode ? 'border-red-500' : 'border-red-600') : '']"
                placeholder="留空則自動生成"
                v-model="editForm.customLink"
                @input="handleSlugInput"
              />
            </div>
            <p v-if="slugError" class="mt-1 text-xs" :class="darkMode ? 'text-red-400' : 'text-red-600'">{{ slugError }}</p>
            <p v-else class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">僅限字母、數字、-、_、.，留空自動生成</p>
          </div>

          <!-- 密碼設定 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">訪問密碼</label>
            <div class="flex items-center space-x-2">
              <input
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                class="form-input w-full rounded-md shadow-sm"
                :class="getInputClasses(darkMode)"
                placeholder="設定訪問密碼..."
                v-model="editForm.password"
                :disabled="editForm.clearPassword"
              />
            </div>
            <div class="mt-2 flex items-center">
              <input
                type="checkbox"
                id="clear-password"
                class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                v-model="editForm.clearPassword"
              />
              <label for="clear-password" class="ml-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> 清除訪問密碼 </label>
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ editForm.clearPassword ? "將移除密碼保護" : props.paste?.hasPassword ? "留空表示保持原密碼不變" : "設定密碼後，他人訪問需要輸入密碼" }}
            </p>
          </div>

          <!-- 過期時間選擇 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">過期時間</label>
            <select class="form-input w-full rounded-md shadow-sm" :class="getInputClasses(darkMode)" v-model="editForm.expiryTime">
              <option value="1">1小時</option>
              <option value="24">1天</option>
              <option value="168">7天</option>
              <option value="720">30天</option>
              <option value="0">永不過期</option>
            </select>
          </div>

          <!-- 可開啟次數設定 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">可開啟次數(0表示無限制)</label>
            <input
              type="number"
              min="0"
              step="1"
              pattern="\d*"
              class="form-input w-full rounded-md shadow-sm"
              :class="getInputClasses(darkMode)"
              placeholder="0表示無限制"
              v-model.number="editForm.maxViews"
              @input="validateMaxViews"
            />
          </div>

          <!-- 可見性設定 -->
          <div class="form-group">
            <label class="form-label block mb-1 text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">可見性</label>
            <div class="flex items-center mt-2">
              <button
                type="button"
                @click="editForm.is_public = !editForm.is_public"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 cursor-pointer"
                :class="editForm.is_public ? 'bg-primary-600' : (darkMode ? 'bg-gray-700' : 'bg-gray-200')"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="editForm.is_public ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
              <span class="ml-3 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ editForm.is_public ? '公開' : '私密' }}
              </span>
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">關閉時僅管理員和建立者可訪問</p>
          </div>
        </div>

        <!-- 儲存和取消按鈕 -->
        <div class="submit-section mt-6 flex flex-row items-center gap-4">
          <!-- 儲存按鈕 -->
          <button
            @click="saveEdit"
            class="btn-primary px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            :disabled="loading"
          >
            {{ loading ? "儲存中..." : "儲存修改" }}
          </button>

          <!-- 取消按鈕 -->
          <button
            @click="cancelEdit"
            class="px-4 py-2 text-sm font-medium border rounded-md transition-colors"
            :class="darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
            title="取消編輯並恢復原始內容"
          >
            取消
          </button>

          <!-- 狀態提示資訊 -->
          <div class="saving-status ml-auto text-sm" v-if="error">
            <span :class="[error.includes('成功') ? (darkMode ? 'text-green-400' : 'text-green-600') : darkMode ? 'text-red-400' : 'text-red-600']">
              {{ error }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 複製格式選單元件 -->
    <PasteCopyFormatMenu
      :visible="copyFormatMenuVisible"
      :position="copyFormatMenuPosition"
      :editor="editorRef"
      :dark-mode="darkMode"
      :is-plain-text-mode="isPlainTextMode"
      :plain-text-content="plainTextContent"
      :document-title="editForm.title || editForm.remark || 'CloudHarbor文件'"
      @close="closeCopyFormatMenu"
      @status-message="handleStatusMessage"
    />
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useI18n } from "vue-i18n";
import { getInputClasses } from "./PasteViewUtils";
import { IconRefresh } from "@/components/icons";
import VditorUnified from "@/components/common/VditorUnified.vue";
import PasteCopyFormatMenu from "./PasteCopyFormatMenu.vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PasteViewEditor");

// Props 定義
const props = defineProps({
  darkMode: { type: Boolean, required: true },
  content: { type: String, default: "" },
  paste: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  isDev: { type: Boolean, default: false },
  enableDebug: { type: Boolean, default: false },
  isPlainTextMode: { type: Boolean, default: false },
});

// Emits 定義
const emit = defineEmits(["save", "cancel", "update:error", "update:isPlainTextMode"]);

// 國際化
const { t } = useI18n();

// 全域性訊息
const { showSuccess, showError, showWarning, showInfo } = useGlobalMessage();

// 響應式資料
const editorRef = ref(null);
const editorContent = ref(props.content);
const showPassword = ref(false);
const markdownImporter = ref(null);

// 純文字模式變數
const isPlainTextMode = ref(props.isPlainTextMode);
// 純文字內容
const plainTextContent = ref("");
// 原始純文字內容（保留格式）
const originalPlainTextContent = ref("");

// 複製格式選單狀態
const copyFormatMenuVisible = ref(false);
const copyFormatMenuPosition = ref({ x: 0, y: 0 });

// 計算初始過期時間選項
const getInitialExpiryTime = (expiresAt) => {
  if (!expiresAt) return "0";

  const expiryDate = new Date(expiresAt);
  const now = new Date();
  const diffHours = Math.round((expiryDate - now) / (1000 * 60 * 60));

  if (diffHours <= 1) {
    return "1";
  } else if (diffHours <= 24) {
    return "24";
  } else if (diffHours <= 168) {
    return "168";
  } else if (diffHours <= 720) {
    return "720";
  } else {
    return "0"; // 設定為永不過期
  }
};

// 編輯表單資料
const editForm = ref({
  title: props.paste?.title || "",
  remark: props.paste?.remark || "",
  customLink: props.paste?.slug || "",
  expiryTime: getInitialExpiryTime(props.paste?.expires_at),
  maxViews: props.paste?.max_views || 0,
  password: "",
  clearPassword: false,
  is_public: Boolean(props.paste?.is_public ?? true),
});

const slugError = ref("");

// 切換編輯器模式
const toggleEditorMode = () => {
  isPlainTextMode.value = !isPlainTextMode.value;
  emit("update:isPlainTextMode", isPlainTextMode.value);

  if (isPlainTextMode.value) {
    // 切換到純文字模式，儲存當前Markdown內容
    if (editorRef.value) {
      plainTextContent.value = editorContent.value;
      originalPlainTextContent.value = editorContent.value;
    }
  } else {
    // 切換到Markdown模式，使用純文字內容
    editorContent.value = plainTextContent.value || "";
  }
};

// 同步純文字內容到編輯器
const syncContentFromPlainText = () => {
  // 同時更新原始純文字內容，保留格式
  originalPlainTextContent.value = plainTextContent.value;
  editorContent.value = plainTextContent.value;
};

// 驗證可開啟次數輸入，確保輸入合法
const validateMaxViews = () => {
  const value = editForm.value.maxViews;
  if (value < 0) {
    editForm.value.maxViews = 0;
  }
  if (!Number.isInteger(value)) {
    editForm.value.maxViews = Math.floor(value);
  }
};

const validateCustomLink = () => {
  slugError.value = "";
  const raw = editForm.value.customLink ? editForm.value.customLink.trim() : "";
  if (!raw) {
    return true;
  }

  const slugRegex = /^[a-zA-Z0-9._-]+$/;
  if (!slugRegex.test(raw)) {
    slugError.value = "連結字尾只能包含字母、數字、-、_、.";
    return false;
  }

  if (raw.length > 50) {
    slugError.value = "連結字尾不能超過50個字元";
    return false;
  }

  editForm.value.customLink = raw;
  return true;
};

const handleSlugInput = () => {
  validateCustomLink();
};

// 編輯器事件處理
const handleEditorReady = () => {
};

const handleContentChange = (content) => {
  editorContent.value = content;
};

// 觸發匯入檔案功能
const triggerImportFile = () => {
  if (markdownImporter.value) {
    markdownImporter.value.click();
  }
};

// 清空編輯器內容
// 注意：VditorUnified 工具欄已經在 emit clear-content 前執行了 confirm()，此處無需重複確認
const clearEditorContent = () => {
  if (isPlainTextMode.value) {
    plainTextContent.value = "";
    originalPlainTextContent.value = "";
  } else {
    editorContent.value = "";
    if (editorRef.value) {
      editorRef.value.setValue("");
    }
  }
  handleStatusMessage({ type: "success", message: "內容已清空" });
};

// 根據當前工具欄按鈕位置更新複製格式選單的位置
const updateCopyFormatMenuPosition = () => {
  if (!copyFormatMenuVisible.value) {
    return;
  }

  const copyFormatBtn = document.querySelector('.vditor-toolbar .vditor-tooltipped[data-type="copy-formats"]');
  if (copyFormatBtn) {
    const rect = copyFormatBtn.getBoundingClientRect();
    copyFormatMenuPosition.value = {
      x: rect.left,
      y: rect.bottom + 5,
    };
  }
};

// 視窗尺寸變化時，保持選單跟隨工具欄按鈕（自動清理）
useEventListener(window, "resize", updateCopyFormatMenuPosition);

// 顯示覆制格式選單
const showCopyFormatsMenu = (position = null) => {
  if (position && position.x !== undefined && position.y !== undefined) {
    // 如果傳入了位置引數，直接使用（來自按鈕點選事件）
    copyFormatMenuPosition.value = position;
  } else {
    // 如果沒有傳入位置，則嘗試基於工具欄按鈕計算位置
    const copyFormatBtn = document.querySelector('.vditor-toolbar .vditor-tooltipped[data-type="copy-formats"]');
    if (copyFormatBtn) {
      const rect = copyFormatBtn.getBoundingClientRect();
      copyFormatMenuPosition.value = {
        x: rect.left,
        y: rect.bottom + 5,
      };
    } else {
      // 回退到預設位置
      copyFormatMenuPosition.value = {
        x: 100,
        y: 100,
      };
    }
  }

  // 顯示選單
  copyFormatMenuVisible.value = true;
};

// 關閉複製格式選單
const closeCopyFormatMenu = () => {
  copyFormatMenuVisible.value = false;
};

// 處理狀態訊息
const handleStatusMessage = (payload) => {
  /** @type {string | undefined} */
  let message;
  /** @type {string} */
  let type = "info";

  if (typeof payload === "string") {
    message = payload;
  } else if (payload && typeof payload === "object") {
    message = payload.message;
    type = payload.type || "info";
  }

  if (!message) {
    return;
  }

  if (type === "error") {
    emit("update:error", message);
    showError(message);
    return;
  }

  if (type === "success") {
    showSuccess(message);
  } else if (type === "warning") {
    showWarning(message);
  } else {
    showInfo(message);
  }
};

// 監聽 props 變化
watch(
  () => props.content,
  (newContent) => {
    editorContent.value = newContent;
  }
);

watch(
  () => props.paste,
  (newPaste) => {
    if (newPaste) {
      editForm.value.title = newPaste.title || "";
      editForm.value.remark = newPaste.remark || "";
      editForm.value.customLink = newPaste.slug || "";
      editForm.value.maxViews = newPaste.max_views || 0;
      editForm.value.password = "";
      slugError.value = "";
      editForm.value.expiryTime = getInitialExpiryTime(newPaste.expires_at);
      editForm.value.is_public = Boolean(newPaste.is_public);
    }
  }
);

// 儲存編輯內容，收集所有表單資料並觸發儲存事件
const saveEdit = async () => {
  // 根據當前模式獲取內容
  let newContent;

  if (isPlainTextMode.value) {
    // 純文字模式下，使用plainTextContent或originalPlainTextContent
    newContent = originalPlainTextContent.value || plainTextContent.value;
  } else if (editorRef.value) {
    // Markdown模式下，從編輯器獲取內容
    newContent = editorContent.value;
  } else {
    emit("update:error", "編輯器未初始化");
    return;
  }

  // 檢查文字內容是否為空
  if (!newContent || !newContent.trim()) {
    emit("update:error", t("markdown.messages.contentEmpty"));
    return;
  }

  if (!validateCustomLink()) {
    emit("update:error", slugError.value || "連結字尾格式無效");
    return;
  }

  // 準備更新資料物件，包含內容和後設資料
  const updateData = {
    content: newContent,
    title: editForm.value.title || null,
    remark: editForm.value.remark || null,
    max_views: editForm.value.maxViews === 0 ? null : parseInt(editForm.value.maxViews),
    is_public: editForm.value.is_public,
  };

  const normalizedSlug = editForm.value.customLink ? editForm.value.customLink.trim() : "";
  const currentSlug = props.paste?.slug || "";
  if (normalizedSlug !== currentSlug) {
    updateData.newSlug = normalizedSlug || null;
  }

  // 處理過期時間
  if (editForm.value.expiryTime !== "0") {
    const hours = parseInt(editForm.value.expiryTime);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);
    updateData.expires_at = expiresAt.toISOString();
  } else {
    updateData.expires_at = null; // 永不過期
  }

  // 處理密碼設定
  if (editForm.value.clearPassword) {
    // 如果選擇清除密碼，明確設定為null
    updateData.password = null;
    updateData.clearPassword = true;
  } else if (editForm.value.password && editForm.value.password.trim()) {
    // 如果設定了新密碼
    updateData.password = editForm.value.password.trim();
  }
  // 如果密碼欄位為空且未選擇清除，則不包含password欄位，保持原密碼不變

  // 觸發儲存事件，將資料傳遞給父元件
  emit("save", updateData);
};

// 取消編輯
const cancelEdit = () => {
  emit("cancel");
};

// 匯入Markdown檔案的函式
const importMarkdownFile = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // 檢查檔案型別
  const allowedTypes = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
  const fileName = file.name.toLowerCase();
  const isValidType = allowedTypes.some((type) => fileName.endsWith(type));

  if (!isValidType) {
    emit("update:error", "請選擇有效的Markdown檔案（.md, .markdown, .mdown, .mkd, .txt）");
    return;
  }

  // 檢查檔案大小（限制為5MB）
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    emit("update:error", "檔案大小不能超過5MB");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;

      if (isPlainTextMode.value) {
        // 純文字模式下，直接設定純文字內容
        plainTextContent.value = content;
        originalPlainTextContent.value = content;
      } else {
        // Markdown模式下，設定編輯器內容
        editorContent.value = content;
        if (editorRef.value) {
          editorRef.value.setValue(content);
        }
      }

      handleStatusMessage({ type: "success", message: "檔案匯入成功" });

      // 清空檔案輸入，允許重複匯入同一檔案
      if (markdownImporter.value) {
        markdownImporter.value.value = "";
      }
    } catch (error) {
      log.error("匯入檔案時出錯:", error);
      emit("update:error", "匯入檔案失敗");
    }
  };

  reader.onerror = () => {
    emit("update:error", "讀取檔案失敗");
  };

  reader.readAsText(file, "UTF-8");
};

// 監聽 isPlainTextMode 變化
watch(
  () => isPlainTextMode.value,
  (newMode) => {
    emit("update:isPlainTextMode", newMode);
  }
);

</script>

<style scoped>
.paste-view-editor {
  width: 100%;
}

.editor-wrapper {
  width: 100%;
  margin-bottom: 1rem;
}
</style>
