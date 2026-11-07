<template>
  <div class="file-preview-container">
    <!-- 檔案預覽區域 -->
    <!-- File Header & Actions Area -->
    <div class="mb-4 px-1 transition-all duration-300">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <!-- Left: Title & Metadata -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1.5">
             <h3 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 truncate leading-tight" :title="file.name">
              {{ file.name }}
            </h3>
            <span class="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              {{ file.mimetype || 'FILE' }}
            </span>
          </div>
          
          <div class="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 font-medium tracking-wide">
             <span class="flex items-center gap-1.5">
                <IconDatabase size="sm" class="w-3.5 h-3.5 opacity-70" />
                <span>{{ formatFileSize(file.size) }}</span>
             </span>
             <span class="w-px h-3 bg-gray-300 dark:bg-gray-700"></span>
             <span class="flex items-center gap-1.5">
                <IconClock size="sm" class="w-3.5 h-3.5 opacity-70" />
                <span>{{ formatDate(file.modified) }}</span>
             </span>
          </div>
        </div>

        <!-- Right: Actions Toolbar -->
        <div class="flex items-center gap-2 self-start sm:self-center">
          <!-- Download -->
          <button
            @click="handleDownload"
            class="group flex items-center justify-center w-8 h-8 rounded-full transition-all bg-transparent text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 transform hover:scale-105"
            :title="t('mount.filePreview.downloadFile')"
          >
            <IconDownload size="sm" class="w-5 h-5" />
          </button>

          <!-- Direct Preview -->
          <button
            @click="handleS3DirectPreview"
            class="group flex items-center justify-center w-8 h-8 rounded-full transition-all bg-transparent text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-900/20 transform hover:scale-105"
            :title="t('mount.filePreview.directPreview')"
            :disabled="isGeneratingPreview"
          >
            <IconRefresh v-if="isGeneratingPreview" class="w-5 h-5 animate-spin" />
            <IconEye v-else size="sm" class="w-5 h-5" />
          </button>

          <!-- Share -->
          <button
            @click="handleCreateShare"
            class="group flex items-center justify-center w-8 h-8 rounded-full transition-all bg-transparent text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-900/20 transform hover:scale-105"
            :title="t('mount.filePreview.createShare')"
            :disabled="isCreatingShare"
          >
            <IconRefresh v-if="isCreatingShare" class="w-5 h-5 animate-spin" />
            <IconLink v-else size="sm" class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- File Content Area (Borderless) -->
    <div class="file-content overflow-hidden transition-all duration-300">
      <!-- 非全屏：工具欄和內容分離（保持你原來的佈局習慣） -->
      <PreviewChannelToolbar
        v-if="!isContentFullscreen"
        :title="toolbarTitle"
        :dark-mode="darkMode"
        :provider-options="toolbarProviderOptions"
        v-model="toolbarProviderKey"
        :is-fullscreen="isContentFullscreen"
        :fullscreen-enter-title="$t('mount.filePreview.fullscreen')"
        :fullscreen-exit-title="$t('mount.filePreview.exitFullscreen')"
        @toggle-fullscreen="toggleFullscreen"
      >
        <template #left>
          <template v-if="isText">
            <select
              v-model="textPreviewMode"
              class="mode-select px-3 py-1 text-sm border rounded"
              :class="darkMode ? 'bg-gray-600 border-gray-500 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
            >
              <option v-for="mode in availablePreviewModes" :key="mode.value" :value="mode.value">
                {{ mode.label }}
              </option>
            </select>

            <select
              v-model="textEncoding"
              class="encoding-select px-3 py-1 text-sm border rounded"
              :class="darkMode ? 'bg-gray-600 border-gray-500 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
            >
              <option v-for="encoding in availableEncodings" :key="encoding.value" :value="encoding.value" :title="encoding.description">
                {{ encoding.label }}
              </option>
            </select>
          </template>
        </template>

        <template #right>
          <template v-if="isText">
            <div
              v-if="textPreviewMode === 'edit'"
              class="context-menu-hint flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 cursor-help hover:scale-110"
              :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100/50'"
              :title="$t('mount.filePreview.rightClickHint')"
            >
              <IconError class="text-yellow-500" aria-hidden="true" />
            </div>

            <button
              v-if="textPreviewMode === 'edit'"
              @click="handleSaveFile"
              :disabled="isSaving"
              class="save-btn flex items-center px-3 py-1 text-sm border rounded transition-colors"
              :class="[
                darkMode ? 'bg-blue-600 hover:bg-blue-700 border-blue-500 text-white' : 'bg-blue-500 hover:bg-blue-600 border-blue-400 text-white',
                isSaving ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :title="$t('mount.filePreview.saveFileShortcut')"
            >
              <IconRefresh v-if="isSaving" class="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />
              <IconSave v-else size="sm" class="mr-1" aria-hidden="true" />
              {{ isSaving ? $t("mount.filePreview.saving") : $t("mount.filePreview.save") }}
            </button>
          </template>
        </template>
      </PreviewChannelToolbar>

      <!-- 預覽內容 -->
      <div
        ref="previewContentRef"
        class="preview-content border rounded-xl overflow-hidden transition-all duration-300 flex flex-col"
        :class="[darkMode ? 'border-gray-700' : 'border-gray-200']"
        :style="previewContainerStyle"
      >
        <!-- 全屏：在全屏容器裡顯示一條"內建工具欄" -->
        <div
          v-if="isContentFullscreen && !isVideo"
          class="fullscreen-toolbar sticky top-0 z-20 p-3 border-b"
          :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
        >
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <!-- 左側：檔案資訊 -->
            <div class="toolbar-left flex flex-wrap items-center gap-3 min-w-0">
              <h3 class="text-lg font-medium truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-800'" :title="file.name">{{ file.name }}</h3>
              <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ toolbarTitle }}</span>
            </div>

            <!-- 右側：控制按鈕 -->
            <div class="toolbar-right flex flex-wrap items-center gap-2">
              <!-- 文字類：模式切換 + 編碼 -->
              <template v-if="isText">
                <select
                  v-model="textPreviewMode"
                  class="mode-select px-2 py-1 text-sm border rounded"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
                >
                  <option v-for="mode in availablePreviewModes" :key="mode.value" :value="mode.value">
                    {{ mode.label }}
                  </option>
                </select>

                <select
                  v-model="textEncoding"
                  class="encoding-select px-2 py-1 text-sm border rounded"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
                >
                  <option v-for="encoding in availableEncodings" :key="encoding.value" :value="encoding.value" :title="encoding.description">
                    {{ encoding.label }}
                  </option>
                </select>
              </template>

              <!-- 渠道選擇：PDF/Office/EPUB/Iframe（多於 1 個時才顯示） -->
              <select
                v-if="toolbarProviderOptions.length > 1"
                v-model="toolbarProviderKey"
                class="px-2 py-1 text-sm border rounded"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
              >
                <option v-for="opt in toolbarProviderOptions" :key="opt.key" :value="opt.key">
                  {{ opt.label }}
                </option>
              </select>

              <!-- 文字類：儲存按鈕（僅編輯模式） -->
              <button
                v-if="isText && textPreviewMode === 'edit'"
                @click="handleSaveFile"
                :disabled="isSaving"
                class="save-btn flex items-center px-2 py-1 text-sm border rounded transition-colors"
                :class="[
                  darkMode ? 'bg-blue-600 hover:bg-blue-700 border-blue-500 text-white' : 'bg-blue-500 hover:bg-blue-600 border-blue-400 text-white',
                  isSaving ? 'opacity-50 cursor-not-allowed' : '',
                ]"
                :title="$t('mount.filePreview.saveFileShortcut')"
              >
                <IconRefresh v-if="isSaving" class="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />
                <IconSave v-else size="sm" class="mr-1" aria-hidden="true" />
                {{ isSaving ? $t("mount.filePreview.saving") : $t("mount.filePreview.save") }}
              </button>

              <!-- 退出全屏按鈕 -->
              <button
                @click="toggleFullscreen"
                class="exit-fullscreen-btn flex items-center px-2 py-1 text-sm border rounded transition-colors"
                :class="darkMode ? 'bg-gray-600 hover:bg-gray-700 border-gray-500 text-gray-200' : 'bg-white hover:bg-gray-50 border-gray-300 text-gray-700'"
                :title="$t('mount.filePreview.exitFullscreen')"
              >
                <IconCollapse size="sm" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <!-- 載入指示器 -->
        <div v-if="isLoading" class="flex-1 flex items-center justify-center">
          <div class="p-12">
            <LoadingIndicator
              :dark-mode="darkMode"
              size="3xl"
              :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
            />
          </div>
        </div>

        <!-- 圖片預覽 (含 Live Photo 支援) -->
        <div v-else-if="isImage" class="flex-1 flex justify-center items-center p-4">
          <!-- Live Photo 預覽 -->
          <LivePhotoViewer
            v-if="isLivePhoto && authenticatedPreviewUrl && livePhotoVideoUrl"
            :photo-src="authenticatedPreviewUrl"
            :video-src="livePhotoVideoUrl"
            :dark-mode="darkMode"
            :max-width="'100%'"
            :show-badge="true"
            :show-badge-text="true"
            :show-progress="true"
            :lazy-load="true"
            :enable-vibration="true"
            class="max-w-full max-h-[600px]"
            @load="handleContentLoaded"
            @error="handleContentError"
          />
          <!-- 普通圖片預覽 -->
          <img
            v-else-if="authenticatedPreviewUrl"
            :src="authenticatedPreviewUrl"
            :alt="file.name"
            class="max-w-full max-h-[600px] object-contain"
            @load="handleContentLoaded"
            @error="handleContentError"
          />
          <div v-else class="loading-indicator text-center py-8">
            <LoadingIndicator
              :dark-mode="darkMode"
              size="2xl"
              :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
            />
          </div>
        </div>

        <!-- 影片預覽 -->
        <div v-else-if="isVideo" class="flex-1 min-h-0">
          <VideoPreview
            :file="file"
            :video-url="authenticatedPreviewUrl"
            :dark-mode="darkMode"
            :is-admin="isAdmin"
            :is-fullscreen="isContentFullscreen"
            :current-path="getCurrentDirectoryPath()"
            :directory-items="directoryItems"
            @loaded="handleContentLoaded"
            @toggle-fullscreen="toggleFullscreen"
          />
        </div>

        <!-- 音訊預覽 -->
        <div v-else-if="isAudio" class="flex-1 flex items-center justify-center">
          <AudioPreview
            :file="file"
            :audio-url="authenticatedPreviewUrl"
            :dark-mode="darkMode"
            :is-admin="isAdmin"
            :current-path="getCurrentDirectoryPath()"
            :directory-items="directoryItems"
            @play="handleAudioPlay"
            @pause="handleAudioPause"
            @error="handleAudioError"
            @loaded="handleContentLoaded"
          />
        </div>

        <!-- PDF預覽 -->
        <div v-else-if="isPdf" class="pdf-preview h-[600px]">
          <PdfFsPreview
            :preview-url="currentPdfPreviewUrl"
            :error-message="officePreviewError"
            @load="handleContentLoaded"
            @error="handleContentError"
          />
        </div>

        <!-- EPUB預覽 -->
        <div v-else-if="isEpub" class="epub-preview h-[600px]">
          <EpubFsPreview
            :provider-key="selectedEpubProvider"
            :providers="resolvedPreview.providers || {}"
            :native-url="authenticatedPreviewUrl"
            :dark-mode="darkMode"
            @load="handleContentLoaded"
            @error="handleContentError"
          />
        </div>

        <!-- Office檔案預覽 -->
        <div v-else-if="isOffice" ref="officePreviewRef" class="office-preview">
          <OfficeFsPreview
            :preview-url="currentOfficePreviewUrl"
            :content-url="officeContentUrl"
            :filename="file.name"
            :dark-mode="darkMode"
            :provider-key="selectedOfficeProvider"
            :error-message="officePreviewError"
            :is-fullscreen="isContentFullscreen"
            @load="handleOfficePreviewLoaded"
            @error="handleOfficePreviewError"
          />
        </div>

        <!-- iframe 預覽 -->
        <div v-else-if="isIframe" class="iframe-preview h-[600px]">
          <IframePreview
            :providers="iframeProviders"
            :dark-mode="darkMode"
            :loading-text="t('mount.filePreview.loadingPreview')"
            :error-text="t('mount.filePreview.previewError')"
            :selected-provider="selectedIframeProvider"
            @load="handleContentLoaded"
            @error="handleContentError"
            @provider-options="handleIframeProviderOptions"
          />
        </div>

        <!-- Markdown預覽 - 使用TextRenderer統一處理 -->
        <div v-else-if="isMarkdown" :class="isContentFullscreen ? 'fullscreen-text-container' : ''">
          <TextPreview
            ref="textPreviewRef"
            :file="file"
            :text-url="authenticatedPreviewUrl"
            :dark-mode="darkMode"
            :is-admin="isAdmin"
            :current-path="getCurrentDirectoryPath()"
            :directory-items="directoryItems"
            :initial-mode="textPreviewMode"
            :initial-encoding="textEncoding"
            :max-height="dynamicMaxHeight"
            @load="handleContentLoaded"
            @error="handleContentError"
            @mode-change="handleModeChange"
            @encoding-change="handleEncodingChange"
          />
        </div>

        <!-- 文字預覽 -->
        <div v-else-if="isText" :class="isContentFullscreen ? 'fullscreen-text-container' : ''">
          <TextPreview
            ref="textPreviewRef"
            :file="file"
            :text-url="authenticatedPreviewUrl"
            :dark-mode="darkMode"
            :is-admin="isAdmin"
            :current-path="getCurrentDirectoryPath()"
            :directory-items="directoryItems"
            :initial-mode="textPreviewMode"
            :initial-encoding="textEncoding"
            :max-height="dynamicMaxHeight"
            @load="handleContentLoaded"
            @error="handleContentError"
            @mode-change="handleModeChange"
            @encoding-change="handleEncodingChange"
          />
        </div>

        <!-- 其他檔案型別或錯誤狀態 -->
        <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
          <div class="generic-preview text-center py-12">
            <IconExclamationSolid size="5xl" class="mx-auto mb-4" :class="darkMode ? 'text-red-400' : 'text-red-500'" aria-hidden="true" />
            <p class="text-lg font-medium mb-2" :class="darkMode ? 'text-red-300' : 'text-red-700'">{{ t("mount.filePreview.previewError") }}</p>
            <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("mount.filePreview.retryLoad") }}</p>
          </div>
        </div>

        <!-- 壓縮檔案預覽 -->
        <div v-else-if="isArchive" class="flex-1">
          <ArchivePreview
            :file="file"
            :dark-mode="darkMode"
            :authenticated-preview-url="authenticatedPreviewUrl"
            @download="handleDownload"
            @loaded="handleContentLoaded"
            @error="handleContentError"
          />
        </div>

        <!-- 不支援預覽的檔案型別 -->
        <div v-else class="flex-1 flex items-center justify-center">
          <div class="generic-preview text-center py-12">
            <IconDocument size="5xl" class="mx-auto mb-4" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
            <p class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("mount.filePreview.cannotPreview") }}</p>
            <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("mount.filePreview.downloadToView") }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 外部播放器 Dock (僅影片型別顯示，全屏時隱藏) -->
    <div v-if="isVideo && authenticatedPreviewUrl && !isContentFullscreen" class="external-player-section mt-3 overflow-visible">
      <ExternalPlayerDock
        :video-url="authenticatedPreviewUrl"
        :file-name="file?.name"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { IconCollapse, IconDocument, IconDownload, IconError, IconExclamationSolid, IconEye, IconLink, IconRefresh, IconSave, IconDatabase, IconClock } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { usePreviewRenderers, useFilePreviewExtensions, useFileSave, resolvePreviewSelection, PREVIEW_KEYS } from "@/composables/index.js";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import { useElementFullscreen } from "@/composables/useElementFullscreen.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useFsService } from "@/modules/fs/fsService.js";
import { getPreviewModeFromFilename, PREVIEW_MODES, SUPPORTED_ENCODINGS } from "@/utils/textUtils.js";
import AudioPreview from "./AudioPreview.vue";
import VideoPreview from "./VideoPreview.vue";
import TextPreview from "./TextPreview.vue";
import ArchivePreview from "./ArchivePreview.vue";
import PdfFsPreview from "./PdfFsPreview.vue";
import EpubFsPreview from "./EpubFsPreview.vue";
import OfficeFsPreview from "./OfficeFsPreview.vue";
import IframePreview from "@/components/common/IframePreview.vue";
import PreviewChannelToolbar from "@/components/common/preview/PreviewChannelToolbar.vue";
import { LivePhotoViewer } from "@/components/common/LivePhoto";
import { detectLivePhoto, isLivePhotoImage } from "@/utils/livePhotoUtils.js";
import ExternalPlayerDock from "./ExternalPlayerDock.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("FilePreview");
const pathPassword = usePathPassword();
const fsService = useFsService();

// Props 定義
const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  // 認證相關props
  isAdmin: {
    type: Boolean,
    default: false,
  },
  apiKeyInfo: {
    type: Object,
    default: null,
  },
  hasFilePermission: {
    type: Boolean,
    default: false,
  },
  // 目錄專案列表（用於音訊播放列表等功能）
  directoryItems: {
    type: Array,
    default: () => [],
  },
});

// Emit 事件定義
const emit = defineEmits(["download", "loaded", "error", "updated", "switch-audio", "show-message"]);

// 使用認證Store
const authStore = useAuthStore();

// 建立認證資訊物件
const authInfo = computed(() => ({
  isAdmin: props.isAdmin ?? authStore.isAdmin,
  apiKeyInfo: props.apiKeyInfo ?? authStore.apiKeyInfo,
  hasFilePermission: props.hasFilePermission ?? authStore.hasPathPermission(props.file?.path || ""),
  get isAuthenticated() {
    return this.isAdmin || !!this.apiKeyInfo;
  },
  get authType() {
    return this.isAdmin ? "admin" : this.apiKeyInfo ? "apikey" : "none";
  },
}));

// 使用檔案預覽渲染器
const renderers = usePreviewRenderers(
  computed(() => props.file),
  emit,
  computed(() => props.darkMode)
);

// 使用檔案預覽擴充套件功能
const extensions = useFilePreviewExtensions(
  computed(() => props.file),
  authInfo,
  renderers.officePreviewLoading,
  renderers.officePreviewError,
  renderers.officePreviewTimedOut,
  renderers.previewUrl,
  renderers.handleFullscreenChange,
  renderers.handleKeyDown,
  emit,
  renderers.authenticatedPreviewUrl,
  renderers.previewTimeoutId
);

// 解構保留的預覽功能
const {
  // 模板中使用的狀態
  loadError,
  authenticatedPreviewUrl,
  officePreviewLoading,
  officePreviewError,
  isOfficeFullscreen,

  // 模板中使用的DOM引用
  officePreviewRef,

  // 模板中使用的方法
  formatFileSize,
  formatDate,
  toggleOfficeFullscreen,
  updateOfficePreviewUrls,
  handleContentLoaded,
  handleContentError,
} = renderers;

const resolvedPreview = computed(() => resolvePreviewSelection({ file: props.file }));

const previewKey = computed(() => resolvedPreview.value.key);
const iframeProviders = computed(() => resolvedPreview.value.providers || {});

const isImage = computed(() => previewKey.value === PREVIEW_KEYS.IMAGE);
const isVideo = computed(() => previewKey.value === PREVIEW_KEYS.VIDEO);
const isAudio = computed(() => previewKey.value === PREVIEW_KEYS.AUDIO);
const isPdf = computed(() => previewKey.value === PREVIEW_KEYS.PDF);
const isEpub = computed(() => previewKey.value === PREVIEW_KEYS.EPUB);
const isOffice = computed(() => previewKey.value === PREVIEW_KEYS.OFFICE);
const isIframe = computed(() => previewKey.value === PREVIEW_KEYS.IFRAME);
const isArchive = computed(() => previewKey.value === PREVIEW_KEYS.ARCHIVE);
const isMarkdown = computed(() => previewKey.value === PREVIEW_KEYS.MARKDOWN);
const isText = computed(() =>
  [PREVIEW_KEYS.TEXT, PREVIEW_KEYS.CODE, PREVIEW_KEYS.MARKDOWN, PREVIEW_KEYS.HTML].includes(previewKey.value)
);

// 從擴充套件功能中解構保留的功能
const {
  isGeneratingPreview,
  handleDownload,
  handleS3DirectPreview,
  getCurrentDirectoryPath,
  isCreatingShare,
  handleCreateShare,
  handleOfficePreviewLoaded,
  handleOfficePreviewError,
  handleAudioPlay,
  handleAudioPause,
  handleAudioError,
} = extensions;

// 智慧初始模式計算屬性
const smartInitialMode = computed(() => {
  if (!props.file?.name) return "text";
  return getPreviewModeFromFilename(props.file.name);
});

// 文字預覽狀態管理
const textPreviewMode = ref("text");
const textEncoding = ref("utf-8");
const textPreviewRef = ref(null);
const userHasManuallyChanged = ref(false);

// 文字預覽標題（根據當前模式動態顯示）
const textPreviewTitle = computed(() => {
  const modeLabels = {
    text: t("mount.filePreview.textPreview"),
    code: t("mount.filePreview.codePreview"),
    markdown: "Markdown",
    html: "HTML",
    edit: t("mount.filePreview.editMode"),
  };
  return modeLabels[textPreviewMode.value] || t("mount.filePreview.textPreview");
});

// iframe 預覽狀態管理
const selectedIframeProvider = ref("");
const iframeProviderOptionsForToolbar = ref([]);

// 處理 iframe 元件傳遞的 provider options
const handleIframeProviderOptions = (options) => {
  const list = Array.isArray(options) ? options : [];
  iframeProviderOptionsForToolbar.value = list;

  // 沒有可用 provider 時，清空選中值，避免下拉框出現“空值但還顯示”的怪狀態
  if (!list.length) {
    selectedIframeProvider.value = "";
    return;
  }

  // 如果當前選中值不存在於新的 options 裡，預設選中第一個（比如切換檔案/規則後）
  const exists = list.some((opt) => opt.key === selectedIframeProvider.value);
  if (!exists) {
    selectedIframeProvider.value = list[0].key;
  }
};

// ===== 統一工具欄（放在 previewContentRef 內，保證全屏時也能顯示）=====

const toolbarTitle = computed(() => {
  if (isText.value) return textPreviewTitle.value;
  if (isPdf.value) return "PDF";
  if (isOffice.value) return officeTypeDisplayName.value;
  if (isEpub.value) return "EPUB";
  if (isImage.value) return t("mount.filePreview.imagePreview");
  if (isVideo.value) return t("mount.filePreview.videoPreview");
  if (isAudio.value) return t("mount.filePreview.audioPreview");
  if (isIframe.value) return t("mount.filePreview.iframePreview");
  if (isArchive.value) return t("mount.filePreview.archivePreview");
  return t("mount.filePreview.previewTypeOther");
});

const toolbarProviderOptions = computed(() => {
  if (isPdf.value) return pdfProviderOptions.value;
  if (isOffice.value) return officeProviderOptions.value;
  if (isEpub.value) return epubProviderOptions.value;
  if (isIframe.value) return iframeProviderOptionsForToolbar.value;
  return [];
});

const toolbarProviderKey = computed({
  get() {
    if (isPdf.value) return selectedPdfProvider.value;
    if (isOffice.value) return selectedOfficeProvider.value;
    if (isEpub.value) return selectedEpubProvider.value;
    if (isIframe.value) return selectedIframeProvider.value;
    return "";
  },
  set(value) {
    const key = String(value || "");
    if (isPdf.value) selectedPdfProvider.value = key;
    if (isOffice.value) selectedOfficeProvider.value = key;
    if (isEpub.value) selectedEpubProvider.value = key;
    if (isIframe.value) selectedIframeProvider.value = key;
  },
});

// PDF 預覽：統一用通用 providers 選擇器
const {
  providerOptions: pdfProviderOptions,
  selectedKey: selectedPdfProvider,
  currentUrl: currentPdfPreviewUrl,
} = useProviderSelector({
  providers: computed(() => resolvedPreview.value.providers || {}),
  nativeUrl: authenticatedPreviewUrl,
  nativeLabel: computed(() => t("mount.filePreview.browserNative")),
  labelMap: computed(() => ({
    pdfjs: t("mount.filePreview.pdfjsLabel"),
  })),
});

// Office 預覽狀態管理
const selectedOfficeProvider = ref("");

// Office native 渲染內容 URL：強制使用同源 /api/fs/content（避免跨域直鏈 fetch）
const officeContentUrl = computed(() => {
  const fsPath = props.file?.path || "";
  if (!fsPath) return "";
  let url = `/api/fs/content?path=${encodeURIComponent(fsPath)}`;

  // 非管理員訪問時，附加路徑密碼 token（如果存在）
  if (!props.isAdmin) {
    const token = pathPassword.getPathToken(fsPath);
    if (token) {
      url += `&path_token=${encodeURIComponent(token)}`;
    }
  }

  return url;
});

// Office provider 選項
const officeProviderOptions = computed(() => {
  const options = [];
  const providers = resolvedPreview.value.providers || {};

  for (const [key, url] of Object.entries(providers)) {
    const labelKey = `mount.filePreview.officeProvider.${key}`;
    const translated = t(labelKey);
    options.push({
      key,
      label: translated === labelKey ? key : translated,
      url,
    });
  }

  return options;
});

watch(
  officeProviderOptions,
  (options) => {
    if (!options.length) {
      selectedOfficeProvider.value = "";
      return;
    }
    // 噹噹前選中值為空或不在 options 中時，預設選中第一個
    const exists = options.some((opt) => opt.key === selectedOfficeProvider.value);
    if (!exists) {
      selectedOfficeProvider.value = options[0].key;
    }
  },
  { immediate: true },
);

// Office 型別顯示名稱
const officeTypeDisplayName = computed(() => {
  const filename = props.file?.name || "";
  const ext = filename.split(".").pop()?.toLowerCase();

  // Word 文件
  if (["doc", "docx", "odt", "rtf"].includes(ext)) {
    return t("mount.filePreview.wordPreview");
  }
  // Excel 表格
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) {
    return t("mount.filePreview.excelPreview");
  }
  // PowerPoint 簡報
  if (["ppt", "pptx", "odp"].includes(ext)) {
    return t("mount.filePreview.powerpointPreview");
  }

  return t("mount.filePreview.officePreview");
});

// 當前 Office 預覽 URL
const currentOfficePreviewUrl = computed(() => {
  const options = officeProviderOptions.value;
  if (!options.length) return "";
  const current = options.find((opt) => opt.key === selectedOfficeProvider.value) || options[0];
  return current.url || "";
});

// EPUB/電子書預覽
const { providerOptions: epubProviderOptions, selectedKey: selectedEpubProvider } = useProviderSelector({
  providers: computed(() => resolvedPreview.value.providers || {}),
  nativeUrl: authenticatedPreviewUrl,
  nativeLabel: computed(() => t("mount.filePreview.browserNative")),
});

// 使用檔案儲存composable
const { isSaving, saveFile } = useFileSave();

// 編輯許可權控制
const canEdit = computed(() => {
  // 管理員總是可以編輯
  if (authStore.isAdmin) {
    return true;
  }

  // API金鑰使用者需要有上傳許可權和路徑許可權
  return authStore.hasMountUploadPermission && authStore.hasPathPermission(props.file?.path || "");
});

// 可用的預覽模式選項
const availablePreviewModes = computed(() => {
  const modes = [
    { value: PREVIEW_MODES.TEXT, label: "Text" },
    { value: PREVIEW_MODES.CODE, label: "Code" },
    { value: PREVIEW_MODES.MARKDOWN, label: "Markdown" },
    { value: PREVIEW_MODES.HTML, label: "HTML" },
  ];

  // 根據許可權新增編輯模式
  if (canEdit.value) {
    modes.push({ value: PREVIEW_MODES.EDIT, label: "Edit" });
  }

  return modes;
});

// 可用的編碼選項
const availableEncodings = computed(() => {
  // 返回所有支援的編碼
  return SUPPORTED_ENCODINGS;
});

// 內容區域全屏狀態管理
const previewContentRef = ref(null);
const { isFullscreen: isContentFullscreen, toggleFullscreen, exitFullscreen } = useElementFullscreen(previewContentRef, { includeChildren: false });

const previewContainerStyle = computed(() => {
  if (isContentFullscreen.value) {
    return { height: "100vh" };
  }
  // 影片預覽：影片自適應
  if (isVideo.value) {
    return {
      maxHeight: "80vh",
    };
  }
  return {
    minHeight: "400px",
    maxHeight: "80vh",
  };
});

// 動態計算文字預覽的最大高度（僅 TextPreview 使用）
const dynamicMaxHeight = computed(() => {
  if (isContentFullscreen.value) {
    // 全屏模式下：100vh減去工具欄高度(60px)
    return "calc(100vh - 60px)";
  } else {
    // 普通模式下：保持原有的600px限制
    return 600;
  }
});

// 儲存檔案功能
const handleSaveFile = async () => {
  if (!textPreviewRef.value || !textPreviewRef.value.getValue) {
    log.error("無法獲取編輯器內容");
    emit("show-message", {
      type: "error",
      message: t("mount.filePreview.cannotGetEditorContent"),
    });
    return;
  }

  // 獲取編輯器最新內容
  const content = textPreviewRef.value.getValue();

  // 使用composable儲存檔案
  const result = await saveFile(props.file.path, props.file.name, content, getCurrentDirectoryPath());

  if (result.success) {
    // 顯示成功訊息
    emit("show-message", {
      type: "success",
      message: result.message,
    });

    // 觸發檔案更新事件，通知父元件重新整理
    emit("updated", {
      file: props.file,
      action: "save",
      result: result.data,
    });
  } else {
    // 顯示錯誤訊息
    emit("show-message", {
      type: "error",
      message: result.message,
    });
  }
};

// Live Photo 檢測
const livePhotoData = computed(() => {
  if (!props.file?.name || !isLivePhotoImage(props.file.name)) {
    return { isLivePhoto: false, videoFile: null };
  }
  return detectLivePhoto(props.file, props.directoryItems);
});

const isLivePhoto = computed(() => livePhotoData.value.isLivePhoto);

// Live Photo 影片 URL（注意：<video> 標籤無法攜帶自定義 header；API Key/路徑密碼場景必須走“預簽名直鏈”）
const livePhotoVideoUrl = ref("");
let livePhotoVideoUrlRequestId = 0;

watch(
  () => livePhotoData.value.videoFile,
  async (videoFile) => {
    const currentRequestId = ++livePhotoVideoUrlRequestId;

    if (!videoFile) {
      livePhotoVideoUrl.value = "";
      return;
    }

    // 走 getFileLink 獲取預簽名 URL（適配 apikey/路徑密碼）
    // 說明：當前目錄列表的 FsDirectoryItem 型別不包含 previewUrl，因此這裡不做 previewUrl 複用分支（避免死程式碼與誤解）。
    const videoPath = typeof videoFile.path === "string" ? videoFile.path : "";
    if (!videoPath) {
      livePhotoVideoUrl.value = "";
      return;
    }

    try {
      const url = await fsService.getFileLink(videoPath, null, false);
      if (currentRequestId !== livePhotoVideoUrlRequestId) return;
      livePhotoVideoUrl.value = url || "";
    } catch (error) {
      if (currentRequestId !== livePhotoVideoUrlRequestId) return;
      log.error("[LivePhoto] 獲取影片直鏈失敗:", error);
      livePhotoVideoUrl.value = "";
    }
  },
  { immediate: true }
);

// 監聽模式變化
watch(textPreviewMode, (newMode) => {
  // 透過ref呼叫TextPreview元件的方法
  if (textPreviewRef.value) {
    textPreviewRef.value.switchMode(newMode);
  }
});

// 監聽編碼變化
watch(textEncoding, (newEncoding) => {
  // 透過ref呼叫TextPreview元件的方法
  if (textPreviewRef.value) {
    textPreviewRef.value.switchEncoding(newEncoding);
  }
});

// 文字預覽事件處理（保留用於其他地方呼叫）
const handleModeChange = (newMode) => {
  textPreviewMode.value = newMode;
  userHasManuallyChanged.value = true; // 標記使用者已手動切換
};

const handleEncodingChange = (newEncoding) => {
  textEncoding.value = newEncoding;
};

// 監聽檔案變化，智慧設定初始預覽模式
watch(
  () => props.file,
  (newFile, oldFile) => {
    if (newFile) {
      // 如果是新檔案或檔名發生變化，重置使用者手動切換標記並設定智慧模式
      if (!oldFile || (oldFile && newFile.name !== oldFile.name)) {
        userHasManuallyChanged.value = false;
        textPreviewMode.value = smartInitialMode.value;
      }
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  void exitFullscreen();
});
</script>

<style scoped>
/* 程式碼高亮和Markdown預覽樣式 */
.preview-content pre {
  margin: 0;
  padding: 1rem;
  border-radius: 0.5rem;
  overflow: auto;
}

.preview-content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* 全屏模式樣式 */
:deep(:fullscreen) {
  background-color: white;
  padding: 0;
  overflow: auto;
  border: none !important;
  border-radius: 0 !important;
}

:deep(.dark :fullscreen) {
  background-color: #1f2937;
}

:deep(:fullscreen iframe) {
  height: calc(100vh - 60px);
  width: 100%;
  border: none;
}

/* 全屏模式下 Office 預覽填滿容器 */
:deep(:fullscreen .office-preview) {
  height: 100%;
}

:deep(:fullscreen .office-fs-preview-wrapper) {
  height: 100%;
  max-height: none;
}

/* 全屏模式下 EPUB 預覽填滿容器 */
:deep(:fullscreen .epub-preview) {
  height: 100% !important;
  max-height: none !important;
}

:deep(:fullscreen .epub-fs-preview) {
  height: 100% !important;
  width: 100% !important;
}

:deep(:fullscreen .foliate-epub-view) {
  height: 100% !important;
  width: 100% !important;
}

:deep(:fullscreen foliate-view) {
  height: 100% !important;
  width: 100% !important;
}

/* 全屏模式下 iframe 預覽填滿容器 */
:deep(:fullscreen .iframe-preview) {
  height: 100% !important;
  max-height: none !important;
}

:deep(:fullscreen .iframe-container) {
  height: 100% !important;
  min-height: unset !important;
}

:deep(:fullscreen .iframe-preview iframe) {
  height: 100% !important;
  width: 100% !important;
}

/* 全屏模式下 PDF 預覽填滿容器） */
:deep(:fullscreen .pdf-preview) {
  height: 100% !important;
  max-height: none !important;
}

/* 全屏模式下影片容器佔滿 */
:deep(:fullscreen .video-preview-container) {
  height: 100% !important;
  border-radius: 0 !important;
}

/* 確保全屏模式下的控制欄固定在頂部 */
:deep(:fullscreen .sticky) {
  position: sticky;
  top: 0;
  z-index: 20;
  width: 100%;
}

/* 全屏模式下的文字容器 */
:deep(:fullscreen .fullscreen-text-container) {
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
}

/* 全屏按鈕懸停效果增強 */
button:hover svg {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}

.fullscreen-toolbar {
  flex-shrink: 0;
}

/* Markdown預覽樣式 */
.markdown-preview {
  line-height: 1.6;
}

/* Office預覽區樣式 - 使用 flex 佈局確保子元件正確填充 */
.office-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Vditor相關樣式 */
:deep(.vditor-reset) {
  font-size: 1rem;
  line-height: 1.7;
  padding: 0.5rem;
  transition: all 0.3s ease;
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"');
  background-color: transparent !important;
}

/* 確保暗色模式下的特定樣式 */
:deep(.vditor-reset--dark) {
  color: #d4d4d4 !important;
  background-color: transparent !important;
}

/* 確保亮色模式下的特定樣式 */
:deep(.vditor-reset--light) {
  color: #374151 !important;
  background-color: transparent !important;
}

/* 標題樣式 */
:deep(.vditor-reset h1, .vditor-reset h2) {
  border-bottom: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  padding-bottom: 0.3em;
  margin-top: 1.8em;
  margin-bottom: 1em;
}

:deep(.vditor-reset h1) {
  font-size: 2em;
}

:deep(.vditor-reset h2) {
  font-size: 1.6em;
}

:deep(.vditor-reset h3) {
  font-size: 1.4em;
  margin-top: 1.5em;
  margin-bottom: 0.75em;
}

/* 段落樣式 */
:deep(.vditor-reset p) {
  margin-top: 0.75em;
  margin-bottom: 0.75em;
}

/* 行內程式碼樣式 */
:deep(.vditor-reset code:not(.hljs)) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f3f4f6"');
  color: v-bind('props.darkMode ? "#ce9178" : "#ef4444"');
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* 引用塊樣式 */
:deep(.vditor-reset blockquote) {
  border-left: 4px solid v-bind('props.darkMode ? "#4b5563" : "#e5e7eb"');
  padding: 0.5em 1em;
  margin-left: 0;
  margin-right: 0;
  margin-top: 1em;
  margin-bottom: 1em;
  color: v-bind('props.darkMode ? "#9ca3af" : "#6b7280"');
  background-color: v-bind('props.darkMode ? "#1a1a1a" : "#f9fafb"');
  border-radius: 0.25rem;
}

/* 連結樣式 */
:deep(.vditor-reset a) {
  color: v-bind('props.darkMode ? "#3b82f6" : "#2563eb"');
  text-decoration: none;
}

:deep(.vditor-reset a:hover) {
  text-decoration: underline;
}

/* 表格樣式 */
:deep(.vditor-reset table) {
  border-collapse: collapse;
  margin: 1.25em 0;
  width: 100%;
}

:deep(.vditor-reset table th, .vditor-reset table td) {
  border: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  padding: 0.6em 1em;
}

:deep(.vditor-reset table th) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f3f4f6"');
  font-weight: 600;
  color: v-bind('props.darkMode ? "#e2e8f0" : "#374151"');
}

:deep(.vditor-reset table td) {
  background-color: v-bind('props.darkMode ? "#1e1e1e" : "#ffffff"');
}

:deep(.vditor-reset table tr:nth-child(even) td) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f9fafb"');
}

/* 列表樣式 */
:deep(.vditor-reset ul, .vditor-reset ol) {
  padding-left: 2em;
  margin: 1em 0;
}

/* 圖片樣式 */
:deep(.vditor-reset img) {
  max-width: 100%;
  margin: 1.25em 0;
  border-radius: 0.25rem;
}

/* 針對暗色模式的自定義樣式 */
:deep(.hljs) {
  background: transparent !important;
}

/* 程式碼塊在暗色模式下的樣式 */
:deep(.vditor-reset--dark pre) {
  background-color: #1e1e1e !important;
  border: 1px solid #333 !important;
}

:deep(.vditor-reset--dark code.hljs) {
  background-color: #1e1e1e !important;
  color: #d4d4d4 !important;
}

/* 程式碼塊在亮色模式下的樣式 */
:deep(.vditor-reset--light pre) {
  background-color: #f6f8fa !important;
  border: 1px solid #e5e7eb !important;
}

:deep(.vditor-reset--light code.hljs) {
  background-color: #f6f8fa !important;
  color: #24292e !important;
}

/* 響應式調整 */
@media (max-width: 640px) {
  :deep(.vditor-reset) {
    font-size: 15px;
    padding: 0.25rem;
  }
}

/* 移動端檔案預覽容器最佳化 */
@media (max-width: 768px) {
  .file-preview-container {
    margin: 0 -1rem;
    padding: 0 0.5rem;
  }

  .file-preview {
    margin-bottom: 1rem !important;
    padding: 0.75rem !important;
    border-radius: 0.5rem !important;
  }

  /* 檔案資訊網格在移動端單列顯示 */
  .file-info {
    grid-template-columns: 1fr !important;
    gap: 0.5rem !important;
    padding: 0.75rem !important;
  }

  /* 按鈕組在移動端更緊湊 */
  .file-preview .flex.flex-wrap {
    gap: 0.5rem !important;
  }

  /* 預覽內容區域最佳化 */
  .preview-content {
    border-radius: 0.5rem !important;
  }

  /* PDF預覽高度調整 */
  .pdf-preview {
    height: 60vh !important;
  }

  /* Office預覽高度調整 */
  .office-preview {
    height: 65vh !important;
  }

  /* Markdown預覽高度調整 */
  .markdown-preview {
    max-height: 60vh !important;
    padding: 0.75rem !important;
  }
}

/* 全域性確保程式碼高亮在暗色模式下可見  */
:deep(.hljs-comment) {
  color: #6a9955 !important;
}
:deep(.hljs-keyword) {
  color: #569cd6 !important;
}
:deep(.hljs-attribute) {
  color: #9cdcfe !important;
}
:deep(.hljs-literal) {
  color: #569cd6 !important;
}
:deep(.hljs-symbol) {
  color: #b5cea8 !important;
}
:deep(.hljs-name) {
  color: #569cd6 !important;
}
:deep(.hljs-tag) {
  color: #569cd6 !important;
}
:deep(.hljs-string) {
  color: #ce9178 !important;
}
:deep(.hljs-number) {
  color: #b5cea8 !important;
}
:deep(.hljs-title) {
  color: #dcdcaa !important;
}
:deep(.hljs-built_in) {
  color: #4ec9b0 !important;
}
:deep(.hljs-class) {
  color: #4ec9b0 !important;
}
:deep(.hljs-variable) {
  color: #9cdcfe !important;
}
:deep(.hljs-params) {
  color: #9cdcfe !important;
}
:deep(.hljs-meta) {
  color: #db8942 !important;
}

/* 上面是舊的：歷史遺留樣式（已不再使用） */

.fullscreen-text-container {
  height: calc(100vh - 60px); /* 減去工具欄高度 */
  display: flex;
  flex-direction: column;
}

.fullscreen-text-container :deep(.text-preview-wrapper) {
  height: 100%;
  flex: 1;
}

.fullscreen-text-container :deep(.editor-container) {
  height: 100%;
  min-height: unset;
}

/* 確保Monaco編輯器在全屏模式下正確顯示 */
.fullscreen-text-container :deep(.monaco-editor) {
  height: 100% !important;
}
</style>
