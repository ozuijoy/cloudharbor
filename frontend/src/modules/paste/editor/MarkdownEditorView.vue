<template>
  <div class="editor-container mx-auto px-3 sm:px-6 flex-1 flex flex-col pt-6 sm:pt-8 w-full max-w-full sm:max-w-6xl">
    <!-- 隱藏的檔案輸入控制元件 -->
    <input type="file" ref="markdownImporter" accept=".md,.markdown,.mdown,.mkd" style="display: none" @change="importMarkdownFile" />

    <!-- 頁面標題和模式切換 -->
    <div class="header mb-4 border-b pb-2" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-semibold">{{ $t("markdown.title") }}</h2>
        <button
          class="px-2 py-1 text-sm rounded transition-colors"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
          @click="toggleEditorMode"
        >
          {{ isPlainTextMode ? $t("markdown.switchToMarkdown") : $t("markdown.switchToPlainText") }}
        </button>
      </div>
    </div>

    <!-- 許可權管理元件 -->
    <PermissionManager
      :dark-mode="darkMode"
      permission-type="text"
      :permission-required-text="$t('markdown.permissionRequired')"
      :login-auth-text="$t('markdown.loginOrAuth')"
      @permission-change="handlePermissionChange"
      @navigate-to-admin="navigateToAdmin"
    />

    <!-- 編輯器元件 -->
    <div class="editor-wrapper">
      <div class="flex flex-col md:flex-row gap-4">
        <VditorUnified
          ref="editorRef"
          :dark-mode="darkMode"
          :is-plain-text-mode="isPlainTextMode"
          v-model="editorContent"
          @editor-ready="handleEditorReady"
          @content-change="handleContentChange"
          @import-file="triggerImportFile"
          @clear-content="clearEditorContent"
          @show-copy-formats="showCopyFormatsMenu"
        />
      </div>
    </div>

    <!-- 表單元件 -->
    <EditorForm
      ref="formRef"
      :dark-mode="darkMode"
      :has-permission="hasPermission"
      :is-submitting="isSubmitting"
      :saving-status="savingStatus"
      @submit="saveContent"
      @form-change="handleFormChange"
    />

    <!-- 分享連結元件 -->
    <ShareLinkBox
      ref="shareLinkRef"
      :dark-mode="darkMode"
      :label="t('markdown.shareLink')"
      :share-link="shareLink"
      :copy-tooltip="t('markdown.copyLink')"
      :copy-success-text="t('markdown.linkCopied')"
      :copy-failure-text="t('markdown.copyFailed')"
      :show-qr-button="true"
      :qr-tooltip="t('markdown.showQRCode')"
      :secondary-link="rawShareLink"
      :secondary-tooltip="t('markdown.copyRawLink')"
      :secondary-success-text="t('markdown.rawLinkCopied')"
      :secondary-failure-text="t('markdown.copyFailed')"
      :show-countdown="true"
      :countdown-seconds="15"
      :countdown-formatter="formatCountdownText"
      @show-qr-code="showQRCode"
      @status-message="handleStatusMessage"
      @countdown-end="handleCountdownEnd"
    />

    <!-- 二維碼彈窗元件 -->
    <QRCodeModal :visible="showQRCodeModal" :share-link="shareLink" @close="closeQRCodeModal" @status-message="handleStatusMessage" />

    <!-- 複製格式選單元件 -->
    <CopyFormatMenu
      :visible="copyFormatMenuVisible"
      :position="copyFormatMenuPosition"
      :editor="currentEditor"
      :dark-mode="darkMode"
      @close="closeCopyFormatMenu"
      @status-message="handleStatusMessage"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useDebounceFn, useEventListener, useLocalStorage, useTimeoutFn } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { usePasteService } from "@/modules/paste";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { createLogger } from "@/utils/logger.js";

// 匯入子元件
import VditorUnified from "@/components/common/VditorUnified.vue";
import PermissionManager from "@/components/common/PermissionManager.vue";
import EditorForm from "@/modules/paste/editor/components/EditorForm.vue";
import ShareLinkBox from "@/components/common/ShareLinkBox.vue";
import QRCodeModal from "@/modules/paste/editor/components/QRCodeModal.vue";
import CopyFormatMenu from "@/modules/paste/editor/components/CopyFormatMenu.vue";

const { t } = useI18n();
const log = createLogger("MarkdownEditor");

// 使用認證Store
const authStore = useAuthStore();
const pasteService = usePasteService();
const { showSuccess, showError, showWarning, showInfo } = useGlobalMessage();

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 元件引用
const editorRef = ref(null);
const formRef = ref(null);
const shareLinkRef = ref(null);
const markdownImporter = ref(null);

// 狀態變數
const savingStatus = ref("");
const isSubmitting = ref(false);
const shareLink = ref("");
const currentSharePassword = ref("");
const draftContent = useLocalStorage("cloudharbor-content", "");

// savingStatus 自動清理
const clearSavingStatusDelayMs = ref(0);
const { start: startClearSavingStatus, stop: stopClearSavingStatus } = useTimeoutFn(
  () => {
    savingStatus.value = "";
  },
  clearSavingStatusDelayMs,
  { immediate: false }
);

const rawShareLink = computed(() => {
  if (!shareLink.value) return "";
  const slug = shareLink.value.split("/").pop();
  return slug ? pasteService.getRawPasteUrl(slug, currentSharePassword.value || null) : "";
});

const formatCountdownText = (seconds) => t("markdown.linkExpireIn", { seconds });
const isPlainTextMode = ref(false);
const editorContent = ref("");
const currentEditor = ref(null);

// 從Store獲取許可權狀態的計算屬性（文字分享建立許可權）
const hasPermission = computed(() => authStore.hasTextSharePermission);

// 二維碼彈窗狀態
const showQRCodeModal = ref(false);

// 複製格式選單狀態
const copyFormatMenuVisible = ref(false);
const copyFormatMenuPosition = ref({ x: 0, y: 0 });

// 許可權變化處理 - 當許可權狀態改變時執行相應的業務邏輯
const handlePermissionChange = (hasPermissionValue) => {
  log.debug("許可權狀態變化", hasPermissionValue);
  // 許可權狀態會自動更新，這裡只需要記錄日誌
};

const handleEditorReady = (editor) => {
  currentEditor.value = editor;

  // 驗證編輯器例項
  if (!editor || typeof editor.getValue !== "function" || typeof editor.getHTML !== "function") {
    log.error("Editor instance validation failed, missing required methods");
  }
};

const handleContentChange = (content) => {
  editorContent.value = content;
  autoSaveDebounce();
};

const handleFormChange = (formData) => {
  // 表單資料變化處理
  log.debug("Form data changed:", formData);
};

const handleStatusMessage = (payload) => {
  const message = typeof payload === "string" ? payload : payload?.message;
  const type = typeof payload === "object" && payload?.type ? payload.type : "info";

  if (!message) return;

  savingStatus.value = message;

  if (type === "error") {
    showError(message);
  } else if (type === "success") {
    showSuccess(message);
  } else if (type === "warning") {
    showWarning(message);
  } else {
    showInfo(message);
  }

  stopClearSavingStatus();
  clearSavingStatusDelayMs.value = type === "error" ? 4000 : 3000;
  startClearSavingStatus();
};

const handleCountdownEnd = () => {
  shareLink.value = "";
  currentSharePassword.value = "";
};

// 導航到管理頁面
const navigateToAdmin = () => {
  // 使用全域性 routerUtils 進行導航
  import("@/router").then(({ routerUtils }) => {
    routerUtils.navigateTo("admin");
  });
};

// 編輯器模式切換
const toggleEditorMode = () => {
  isPlainTextMode.value = !isPlainTextMode.value;
  log.debug("切換編輯器模式:", isPlainTextMode.value ? t("markdown.switchToPlainText") : t("markdown.switchToMarkdown"));
};

// 觸發檔案匯入
const triggerImportFile = () => {
  if (markdownImporter.value) {
    markdownImporter.value.click();
  }
};

// 匯入Markdown檔案
const importMarkdownFile = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    if (editorRef.value) {
      editorRef.value.setValue(content);
    }
    editorContent.value = content;
  };
  reader.readAsText(file);

  // 清空檔案輸入
  event.target.value = "";
};

// 清空編輯器內容
const clearEditorContent = () => {
  if (editorRef.value) {
    editorRef.value.clearContent();
  }
  editorContent.value = "";
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

// 顯示覆制格式選單
const showCopyFormatsMenu = (position) => {
  if (!currentEditor.value) return;

  // 如果傳入了位置引數，直接使用
  if (position && position.x !== undefined && position.y !== undefined) {
    copyFormatMenuPosition.value = position;
  } else {
    // 否則嘗試獲取工具欄中複製格式按鈕的位置
    const copyFormatBtn = document.querySelector('.vditor-toolbar .vditor-tooltipped[data-type="copy-formats"]');
    if (copyFormatBtn) {
      const rect = copyFormatBtn.getBoundingClientRect();
      copyFormatMenuPosition.value = {
        x: rect.left,
        y: rect.bottom + 5,
      };
    } else {
      // 使用預設位置
      copyFormatMenuPosition.value = { x: 100, y: 100 };
    }
  }

  copyFormatMenuVisible.value = true;
};

// 關閉複製格式選單
const closeCopyFormatMenu = () => {
  copyFormatMenuVisible.value = false;
};

// 視窗尺寸變化時，保持選單跟隨工具欄按鈕（自動清理）
useEventListener(window, "resize", updateCopyFormatMenuPosition);

// 顯示二維碼
const showQRCode = () => {
  showQRCodeModal.value = true;
};

// 關閉二維碼彈窗
const closeQRCodeModal = () => {
  showQRCodeModal.value = false;
};

// 儲存內容
const saveContent = async (formData) => {
  if (!hasPermission.value) {
    handleStatusMessage(t("common.noPermission"));
    return;
  }

  if (!editorContent.value.trim()) {
    handleStatusMessage(t("markdown.messages.contentEmpty"));
    return;
  }

  isSubmitting.value = true;
  handleStatusMessage(t("markdown.messages.creating"));

  try {
    // 準備要提交的資料 - 只傳遞有值的欄位
    const pasteData = {
      content: editorContent.value,
    };

    // 只有當欄位有值時才新增到請求中
    if (formData.customLink && formData.customLink.trim()) {
      pasteData.slug = formData.customLink.trim();
    }

    if (formData.title && formData.title.trim()) {
      pasteData.title = formData.title.trim();
    }

    if (formData.remark && formData.remark.trim()) {
      pasteData.remark = formData.remark.trim();
    }

    if (formData.password && formData.password.trim()) {
      pasteData.password = formData.password.trim();
    }

    if (formData.max_views && parseInt(formData.max_views) > 0) {
      pasteData.max_views = parseInt(formData.max_views);
    }

    // 始終包含 is_public 欄位（布林值）
    if (typeof formData.is_public === "boolean") {
      pasteData.is_public = formData.is_public;
    }

    // 處理過期時間
    const expiryHours = parseInt(formData.expiry_time);
    if (expiryHours > 0) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);
      pasteData.expires_at = expiresAt.toISOString();
    }

    log.debug("建立分享，資料:", pasteData);

    // 呼叫領域 service，統一返回 slug
    const slug = await pasteService.createPaste(pasteData);
    log.debug("建立分享結果 slug:", slug);

    // 構建分享連結
    shareLink.value = `${window.location.origin}/paste/${slug}`;
    currentSharePassword.value = formData.password || "";

    // 啟動倒計時
    if (shareLinkRef.value) {
      shareLinkRef.value.startCountdown();
    }

    // 重置表單
    if (formRef.value) {
      formRef.value.resetForm();
    }

    handleStatusMessage(t("markdown.messages.createSuccess"));
  } catch (error) {
    log.error("儲存失敗:", error);

    // 根據錯誤訊息內容進行分類處理
    if (error.message && error.message.includes("已被佔用")) {
      handleStatusMessage(t("markdown.messages.linkOccupied"));
    } else if (error.message && error.message.includes("許可權")) {
      handleStatusMessage(t("common.noPermission"));
    } else if (error.message && error.message.includes("內容過大")) {
      handleStatusMessage(t("markdown.messages.contentTooLarge"));
    } else {
      handleStatusMessage(`${t("markdown.messages.createFailed")}: ${error.message || t("markdown.messages.unknownError")}`);
    }
  } finally {
    isSubmitting.value = false;
  }
};

// 自動儲存
const autoSaveDebounce = useDebounceFn(() => {
  try {
    draftContent.value = editorContent.value;
  } catch (e) {
    log.warn(t("markdown.messages.autoSaveFailed"), e);
  }
}, 1000);

// 元件掛載
onMounted(async () => {
  // 恢復儲存的內容
  try {
    if (draftContent.value) {
      editorContent.value = draftContent.value;
    }
  } catch (e) {
    log.warn(t("markdown.messages.restoreContentFailed"), e);
  }
});

// 元件解除安裝
onUnmounted(() => {
  stopClearSavingStatus();
  autoSaveDebounce.cancel?.();
});
</script>

<style scoped>
.editor-container {
  min-height: 700px;
  box-sizing: border-box; /* 確保內邊距不增加元素實際寬度 */
}

/* 移動端最佳化 */
@media (max-width: 640px) {
  .editor-container {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    width: 100%;
    overflow-x: hidden;
  }

  .form-input,
  .form-label {
    width: 100%;
    max-width: 100%;
  }

  .form-group {
    margin-bottom: 0.75rem;
  }

  /* 確保分享連結區域不溢位 */
  .share-link-box {
    max-width: 100%;
    overflow-x: hidden;
  }
}

/* 新增表單響應式樣式 */
.form-input {
  width: 100%;
  max-width: 100%;
  padding: 0.5rem;
  border-width: 1px;
  border-radius: 0.375rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

/* 新增新的過渡動畫 */
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 應用動畫到分享連結區域 */
.mt-4 {
  animation: slideDown 0.25s ease-out;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  font-weight: 500;
  border-radius: 0.375rem;
  background-color: v-bind('props.darkMode ? "#3b82f6" : "#2563eb"');
  color: white;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background-color: v-bind('props.darkMode ? "#2563eb" : "#1d4ed8"');
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* 分享連結樣式 */
.share-link-box {
  animation: fadeIn 0.3s ease-out;
  border: 1px solid v-bind('props.darkMode ? "rgba(75, 85, 99, 0.3)" : "rgba(229, 231, 235, 0.8)"');
}

.link-text {
  text-decoration: none;
  word-break: break-all;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-text:hover {
  text-decoration: underline;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 複製格式選單樣式 */
#copyFormatMenu {
  min-width: 180px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
  transform-origin: top left;
}

#copyFormatMenu div {
  transition: background-color 0.15s ease-in-out;
}
</style>
