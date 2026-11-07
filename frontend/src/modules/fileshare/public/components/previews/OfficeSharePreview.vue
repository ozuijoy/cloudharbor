<template>
  <div ref="previewContainerRef" class="office-preview-wrapper flex-grow flex flex-col w-full">
    <OfficePreviewContainer
      :content-url="contentUrl"
      :filename="filename"
      :providers="providers"
      :height-mode="isFullscreen ? 'flex' : 'fixed'"
      :show-provider-selector="true"
      :show-footer="true"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      :download-url="downloadUrl"
      :error-message="localErrorMessage"
      @load="handleLoad"
      @error="handleError"
      @provider-change="handleProviderChange"
    >
      <!-- 自定義 Footer：包含密碼錯誤提示 -->
      <template #footer="{ downloadUrl: dlUrl }">
        <div class="office-custom-footer">
          <p v-if="localErrorMessage" class="text-red-500 mb-1">{{ localErrorMessage }}</p>
          <div v-if="localErrorMessage && localErrorMessage.includes('401')">
            <p class="text-amber-500 text-sm mb-2">{{ t("fileView.preview.office.passwordIssue") }}</p>
            <ul class="text-left text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 mb-2">
              <li>{{ t("fileView.preview.office.refreshAndRetry") }}</li>
              <li>{{ t("fileView.preview.office.confirmPassword") }}</li>
              <li>{{ t("fileView.preview.office.tryUrlPassword") }}</li>
            </ul>
          </div>
          <p>
            {{ t("fileView.preview.office.previewTrouble") }}
            {{ t("fileView.preview.office.switchService") }}
            <a :href="dlUrl || downloadUrl" class="text-blue-500 hover:underline" target="_blank">{{
              t("fileView.preview.office.downloadFile")
            }}</a>
            {{ t("fileView.preview.office.afterDownload") }}
          </p>
        </div>
      </template>
    </OfficePreviewContainer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { OfficePreviewContainer } from "@/components/office";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("OfficeSharePreview");

defineProps({
  // DocumentApp providers 對映，例如 { native: 'native', microsoft: 'https://...', google: 'https://...' }
  providers: {
    type: Object,
    default: () => ({}),
  },
  // native 渲染所需內容 URL（同源內容口）
  contentUrl: {
    type: String,
    default: "",
  },
  filename: {
    type: String,
    default: "",
  },
  downloadUrl: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

const previewContainerRef = ref(null);
const isFullscreen = ref(false);

// 本地錯誤訊息狀態
const localErrorMessage = ref("");

const handleLoad = () => {
  localErrorMessage.value = "";
  emit("load");
};

const handleError = (err) => {
  log.error("Office 預覽錯誤:", err);
  localErrorMessage.value = err?.message || t("fileView.preview.office.error") || "預覽載入失敗";
  emit("error", err);
};

const handleProviderChange = () => {
  // 切換渠道時清除錯誤
  localErrorMessage.value = "";
};
</script>

<style scoped>
.office-preview-wrapper {
  border-radius: 0.5rem;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.office-custom-footer {
  padding: 0.5rem;
  background-color: #f9fafb;
  font-size: 0.75rem;
  color: #6b7280;
  text-align: center;
}
</style>

<!-- Dark Mode 適配  -->
<style>
.dark .office-custom-footer {
  background-color: #374151;
  color: #9ca3af;
}
</style>
