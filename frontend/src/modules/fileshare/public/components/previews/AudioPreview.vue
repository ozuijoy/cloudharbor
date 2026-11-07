<template>
  <div
    ref="previewContainerRef"
    class="audio-preview rounded-lg overflow-hidden mb-2 w-full relative border border-gray-200 dark:border-gray-700"
    :class="isFullscreen ? 'flex flex-col h-screen' : ''"
  >
    <PreviewProviderHeader
      :title="filename || t('fileView.preview.audio.title')"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 音訊預覽內容：緊湊設計，內容驅動 -->
    <div
      class="bg-gray-100 dark:bg-gray-700"
      :class="isFullscreen ? 'flex-1 flex items-center justify-center px-6' : 'py-3 px-4'"
    >
      <div class="w-full max-w-2xl mx-auto">
        <audio
          controls
          class="w-full"
          @loadeddata="handleLoad"
          @error="handleError"
        >
          <source :src="currentPreviewUrl" :type="mimetype" />
          {{ t("fileView.preview.audio.notSupported") }}
        </audio>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";

const { t } = useI18n();

const props = defineProps({
  // 多源預覽架構
  providers: {
    type: Object,
    default: () => ({}),
  },
  nativeUrl: {
    type: String,
    default: "",
  },
  // 相容舊呼叫
  previewUrl: {
    type: String,
    default: "",
  },
  mimetype: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

// 容器 ref 和全屏狀態
const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

// 解析 nativeUrl
const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

// 使用統一的 provider 選擇器
const {
  providerOptions,
  selectedKey: selectedProviderKey,
  currentUrl: currentPreviewUrl,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.audio.browserNative")),
});

const handleLoad = () => {
  emit("load");
};

const handleError = () => {
  emit("error");
};
</script>

<style scoped>
/* 全屏時預覽容器填滿螢幕 */
.audio-preview :deep(:fullscreen),
.audio-preview :deep(:-webkit-full-screen),
.audio-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}
</style>
