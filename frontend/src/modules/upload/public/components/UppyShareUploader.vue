<template>
  <div class="uppy-share-uploader">
    <!-- 上傳模式選擇 -->
    <UploadModeSelector
      v-model="uploadMode"
      :modes="uploadModes"
      :title="t('file.uploadMethod')"
      :dark-mode="darkMode"
      :disabled="isUploading"
    />

    <!-- 高階功能 -->
    <AdvancedPluginsPanel
      :plugins="mediaPlugins"
      :enabled-count="enabledPluginsCount"
      :title="t('file.advancedFeatures')"
      :enabled-count-template="t('file.enabledCount', { count: '{count}' })"
      :dark-mode="darkMode"
      @toggle-plugin="togglePlugin"
    />

    <!-- Uppy Dashboard 容器 -->
    <UppyDashboardContainer
      ref="uppyContainerRef"
      container-id="uppy-share-dashboard"
      :dark-mode="darkMode"
      :show-paste-hint="true"
      :paste-hint-prefix="t('file.pasteSupport')"
      :paste-key="t('file.pasteKey')"
      :paste-hint-suffix="t('file.pasteHint')"
      :max-file-size-hint="maxUploadBytes ? t('file.dragDropHint', { size: formatMaxFileSize() }) : ''"
    />

    <!-- 分享設定表單 -->
    <div class="mt-6 border-t pt-4 w-full overflow-hidden" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
      <h3 class="text-lg font-medium mb-4" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ t("file.shareSettings") }}</h3>

      <!-- 儲存配置與路徑 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.storage") }}</label>
          <div class="relative">
            <select
              v-model="formData.storage_config_id"
              class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent appearance-none"
              :class="[
                darkMode
                  ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                  : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
              ]"
              :disabled="!storageConfigs.length || loading || isUploading"
              required
              @change="onStorageConfigChange"
            > 
              <option value="" disabled selected>{{ storageConfigs.length ? t("file.selectStorage") : t("file.noStorage") }}</option>
              <option v-for="config in storageConfigs" :key="config.id" :value="config.id">{{ formatStorageOptionLabel(config) }}</option>
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <IconChevronDown size="md" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.path") }}</label>
          <input
            type="text"
            v-model="formData.path"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
            ]"
            :placeholder="t('file.pathPlaceholder')"
            :disabled="isUploading"
          />
        </div>
      </div>

      <!-- 分享選項 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <!-- 備註 -->
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.remark") }}</label>
          <input
            type="text"
            v-model="formData.remark"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
            ]"
            :placeholder="t('file.remarkPlaceholder')"
            :disabled="isUploading"
          />
        </div>

        <!-- 自定義連結 -->
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.customLink") }}</label>
          <input
            type="text"
            v-model="formData.slug"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
              slugError ? (darkMode ? 'border-red-500' : 'border-red-600') : '',
            ]"
            :placeholder="t('file.customLinkPlaceholder')"
            :disabled="isUploading || isMultiFileUpload"
            @input="validateCustomLink"
          />
          <p v-if="isMultiFileUpload" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('file.multiFileSlugDisabled') }}</p>
          <p v-else-if="slugError" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ slugError }}</p>
          <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t("file.onlyAllowedChars") }}</p>
        </div>

        <!-- 密碼保護 -->
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.passwordProtection") }}</label>
          <input
            type="text"
            v-model="formData.password"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
            ]"
            :placeholder="t('file.passwordPlaceholder')"
            :disabled="isUploading"
          />
        </div>

        <!-- 過期時間 -->
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.expireTime") }}</label>
          <select
            v-model="formData.expires_in"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
            ]"
            :disabled="isUploading"
          >
            <option value="1">{{ t("file.expireOptions.hour1") }}</option>
            <option value="24">{{ t("file.expireOptions.day1") }}</option>
            <option value="168">{{ t("file.expireOptions.day7") }}</option>
            <option value="720">{{ t("file.expireOptions.day30") }}</option>
            <option value="0">{{ t("file.expireOptions.never") }}</option>
          </select>
        </div>

        <!-- 最大檢視次數 -->
        <div class="form-group flex flex-col">
          <label class="form-label text-sm font-medium mb-1.5" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">{{ t("file.maxViews") }}</label>
          <input
            type="number"
            v-model.number="formData.max_views"
            min="0"
            step="1"
            pattern="\d*"
            class="form-input w-full rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
            :class="[
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
            ]"
            :placeholder="t('file.maxViewsPlaceholder')"
            :disabled="isUploading"
            @input="validateMaxViews"
          />
        </div>
      </div>

      <!-- 表單按鈕 -->
      <div class="submit-section flex flex-row items-center gap-3 mt-4">
        <button
          type="button"
          @click="startUpload"
          :disabled="!canStartUpload || isUploading || loading"
          class="btn-primary px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors flex items-center justify-center min-w-[120px]"
          :class="[
            !canStartUpload || isUploading || loading
              ? darkMode
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : darkMode
              ? 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
              : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-white',
          ]"
        >
          <IconRefresh v-if="isUploading" size="sm" class="animate-spin -ml-1 mr-2" aria-hidden="true" />
          {{ isUploading ? t("file.loading") : t("file.upload") }}
        </button>

        <!-- 取消按鈕 -->
        <button
          v-if="isUploading"
          type="button"
          @click="cancelUpload"
          class="px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors flex items-center justify-center border"
          :class="
            darkMode
              ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-red-900/60 hover:text-red-200 hover:border-red-800 focus:ring-gray-500 focus:ring-offset-gray-800'
              : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-300 focus:ring-gray-300 focus:ring-offset-white'
          "
        >
          <IconClose size="sm" class="mr-1" aria-hidden="true" />
          {{ t("file.cancel") }}
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { IconChevronDown, IconClose, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

import Dashboard from "@uppy/dashboard";

// 匯入Uppy樣式
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";

// 匯入共享CSS
import "@/styles/uppy-dashboard.css";

// 匯入共享Composables
import { useUppyCore, useUppyEvents, useUppyPaste, useUppyBackendProgress } from "@/composables/uppy";

// 匯入共享UI元件
import UploadModeSelector from "@/components/uppy/UploadModeSelector.vue";
import AdvancedPluginsPanel from "@/components/uppy/AdvancedPluginsPanel.vue";
import UppyDashboardContainer from "@/components/uppy/UppyDashboardContainer.vue";

// 匯入業務邏輯
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";
import { useShareUploadController, useShareUploadDomain, useUploadService } from "@/modules/upload";
import { useShareSettingsForm } from "@/composables/upload/useShareSettingsForm.js";
// ⚠️ 效能：不要從 "@/modules/fileshare" 聚合入口匯入
// 因為它會連帶引入 FileView / FileManagementView 等大元件，導致上傳頁首屏 JS 體積暴漲。
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { createUppyPluginManager } from "@/modules/storage-core/uppy/UppyPluginManager.js";
import { formatFileSize } from "@/utils/fileUtils.js";
import { validateUrlInfo, fetchUrlContent } from "@/api/services/urlUploadService.js";

// 元件屬性
const props = defineProps({
  darkMode: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  storageConfigs: { type: Array, default: () => [] },
});

// 事件
const emit = defineEmits(["upload-success", "upload-error", "share-results"]);

// 國際化
const { locale, t } = useI18n();
const log = createLogger("UppyShareUploader");

// 使用Composables
const { uppyInstance, initializeUppy, destroyUppy, snapshotFiles, restoreFiles } = useUppyCore();
const { fileCount } = useUppyEvents({
  uppy: uppyInstance,
  onFileAdded: (file) => {
    if (maxUploadBytes.value && file?.size > maxUploadBytes.value) {
      errorMessage.value = t("file.maxSizeExceeded", { size: formatMaxFileSize() });
      try {
        uppyInstance.value.removeFile(file.id);
      } catch {}
      return;
    }
    errorMessage.value = "";
  },
  onFileRemoved: (file) => {
  },
  onRestrictionFailed: (file, error) => {
    log.warn("[UppyShareUploader] 檔案未透過限制", file?.name, error);
    errorMessage.value = error?.message || t("file.maxSizeExceeded", { size: formatMaxFileSize() });
  },
  onError: (error) => {
    // 捕獲Uppy系統錯誤，統一展示到錯誤區域
    const message = error?.message || t("file.messages.uploadFailed");
    errorMessage.value = message;
  },
});

useUppyPaste({
  uppy: uppyInstance,
  onPaste: (file) => {
  },
});

// 響應式資料
const uppyContainerRef = ref(null);
const uploadMode = ref("presigned");
const canUsePresignMode = ref(true);
const canUseStreamMode = ref(true);
const canUseFormMode = ref(true);
const errorMessage = ref("");
const isUploading = ref(false);
const mediaPlugins = ref([]);
const maxFileSizeMB = ref(100);
const maxUploadBytes = computed(() => (maxFileSizeMB.value > 0 ? maxFileSizeMB.value * 1024 * 1024 : null));

// 分享設定表單
const {
  formData,
  slugError,
  validateSlug,
  handleSlugInput,
  handleMaxViewsInput,
} = useShareSettingsForm();

// Share upload domain
const { buildPayloadForFile, buildErrorDescriptor, summarizeUploadResults } = useShareUploadDomain();

// Upload service
const { getMaxUploadSize } = useUploadService();

// Fileshare service
const fileshareService = useFileshareService();

// Share upload controller
const { activeShareSession, createShareSession, createDirectShareSession, disposeShareSession } = useShareUploadController();

// 外掛管理器例項
let pluginManager = null;

// Share 記錄快取
const shareRecordMap = new Map();
const pendingShareItems = ref([]);

// 當前儲存配置
const currentStorageConfig = computed(() => {
  return props.storageConfigs.find(config => config.id === formData.storage_config_id);
});

// 上傳模式配置
const uploadModes = computed(() => {
  const modes = [
    {
      value: "presigned",
      label: t("file.uploadModes.presigned"),
      modeLabel: t("file.uploadModes.presignedMode"),
      tooltip: t("file.uploadModes.presignedTooltip"),
      disabled: !canUsePresignMode.value || isUploading.value,
      disabledHint: !canUsePresignMode.value ? t("file.uploadModes.presignedOnly") : "",
    },
    {
      value: "stream",
      label: t("file.uploadModes.stream"),
      modeLabel: t("file.uploadModes.streamMode"),
      tooltip: t("file.uploadModes.streamTooltip"),
      disabled: !canUseStreamMode.value || isUploading.value,
    },
    {
      value: "form",
      label: t("file.uploadModes.form"),
      modeLabel: t("file.uploadModes.formMode"),
      tooltip: t("file.uploadModes.formTooltip"),
      disabled: !canUseFormMode.value || isUploading.value,
    },
  ];
  return modes;
});

// 是否可以使用預簽名模式(僅S3支援)
watch(currentStorageConfig, (config) => {
  if (!config) {
    canUsePresignMode.value = false;
    canUseStreamMode.value = true;
    canUseFormMode.value = true;
    return;
  }
  const storageType = (config.storage_type || config.provider_type || "").toUpperCase();
  try {
    const driver = resolveDriverByConfigId(config.id);
    const driverType = (driver?.config?.storage_type || driver?.type || storageType || "").toUpperCase();
    const shareCaps = driver?.capabilities?.share || {};
    const allowPresign = shareCaps.presigned === true || shareCaps.presign === true || driverType === "S3";
    canUsePresignMode.value = allowPresign;
    canUseStreamMode.value = shareCaps.backendStream !== false;
    canUseFormMode.value = shareCaps.backendForm !== false;
  } catch (error) {
    log.warn("[UppyShareUploader] 解析驅動失敗，使用儲存型別回退", error);
    canUsePresignMode.value = storageType === "S3";
    // 兜底：未知驅動時不主動禁用流式/表單，避免“能用卻被禁用”
    canUseStreamMode.value = true;
    canUseFormMode.value = true;
  }

  // 如果當前模式不可用，自動切換
  const pickFallback = () => {
    if (canUsePresignMode.value) return "presigned";
    if (canUseStreamMode.value) return "stream";
    if (canUseFormMode.value) return "form";
    return "stream";
  };

  if (uploadMode.value === "presigned" && !canUsePresignMode.value) uploadMode.value = pickFallback();
  if (uploadMode.value === "stream" && !canUseStreamMode.value) uploadMode.value = pickFallback();
  if (uploadMode.value === "form" && !canUseFormMode.value) uploadMode.value = pickFallback();
});

// 計算屬性
const isSlugValid = computed(() => !formData.slug || !slugError.value);
const isMaxViewsValid = computed(() => Number(formData.max_views) >= 0);
const isMultiFileUpload = computed(() => fileCount.value > 1);
const canStartUpload = computed(() => {
  const basic =
    fileCount.value > 0 &&
    !isUploading.value &&
    !!formData.storage_config_id &&
    isSlugValid.value &&
    isMaxViewsValid.value;
  if (!basic) return false;

  // 防呆：如果當前模式已被禁用，就不要允許“開始上傳”
  if (uploadMode.value === "presigned") return canUsePresignMode.value === true;
  if (uploadMode.value === "stream") return canUseStreamMode.value === true;
  if (uploadMode.value === "form") return canUseFormMode.value === true;
  return false;
});

const enabledPluginsCount = computed(() => {
  return pluginManager ? pluginManager.getEnabledPluginsCount() : 0;
});

const formatMaxFileSize = () => formatFileSize(maxUploadBytes.value || 0);
const {
  ensureUploadIdForFile,
  resetBackendProgressTracking,
  updateBrowserProgressState,
  startBackendProgressPolling,
} = useUppyBackendProgress({
  uppy: uppyInstance,
  isDirectMode: () => uploadMode.value === "stream",
});

// 載入最大上傳大小
const loadMaxUploadSize = async () => {
  try {
    const size = await getMaxUploadSize();
    if (size) {
      maxFileSizeMB.value = size;
    }
  } catch (error) {
    log.warn("[UppyShareUploader] 獲取最大上傳大小失敗", error);
  }
};

/**
 * 獲取Dashboard外掛配置
 */
const getDashboardConfig = () => ({
  inline: true,
  target: uppyContainerRef.value.container,
  theme: props.darkMode ? "dark" : "light",
  width: "100%",
  height: 400,
  showProgressDetails: true,
  showRemoveButtonAfterComplete: true,
  hideUploadButton: true,
  hidePauseResumeButton: false,
  proudlyDisplayPoweredByUppy: false,
  disableLocalFiles: false,
  metaFields: [
    {
      id: "name",
      name: t("file.fileName"),
      placeholder: t("file.customFilename"),
    },
  ],
  locale: {
    strings: {
      dataUploadedOfTotal: "%{complete} / %{total}",
    },
  },
});

/**
 * 切換外掛狀態
 */
const togglePlugin = (pluginKey) => {
  if (pluginManager) {
    pluginManager.togglePlugin(pluginKey);
    mediaPlugins.value = pluginManager.getPluginList();
    if (uppyInstance.value && !isUploading.value) {
      reinitUppy({ preserveFiles: true });
    }
  }
};

/**
 * 初始化Uppy例項
 */
const setupUppy = async ({ preserveFiles = false } = {}) => {
  try {
    const preservedFiles = preserveFiles ? snapshotFiles() : [];

    if (uppyInstance.value) {
      disposeShareSession(true);
      destroyUppy();
    }

    await initializeUppy({
      id: "uppy-share-uploader",
      locale: locale.value,
      maxFileSize: maxUploadBytes.value,
    });

    pluginManager = createUppyPluginManager(uppyInstance.value, locale.value);
    mediaPlugins.value = pluginManager.getPluginList();

    // 設定 URL 匯入外掛回撥
    pluginManager.setUrlImportCallbacks({
      validateUrlInfo,
      fetchUrlContent,
    });

    uppyInstance.value.use(Dashboard, getDashboardConfig());
    await pluginManager.addPluginsToUppy();

    restoreFiles(preservedFiles);
  } catch (error) {
    log.error("[UppyShareUploader] 初始化失敗:", error);
    errorMessage.value = t("file.messages.uploadFailed", { message: error.message });
  }
};

/**
 * 重新初始化Uppy
 */
const reinitUppy = (options) => {
  setupUppy(options);
};

/**
 * 格式化儲存選項標籤
 */
const formatStorageOptionLabel = (config) => {
  if (!config) return t("file.storage");
  const meta = config.provider_type || config.storage_type;
  return meta ? `${config.name} (${meta})` : config.name;
};

/**
 * 儲存配置變更處理
 */
const onStorageConfigChange = () => {
  if (!canUsePresignMode.value && uploadMode.value === "presigned") {
    uploadMode.value = "stream";
  }
};

/**
 * 驗證自定義連結
 */
const validateCustomLink = (event) => {
  handleSlugInput(event?.target?.value ?? formData.slug);
  return validateSlug();
};

// 多檔案上傳：禁用自定義字尾（slug），並在檔案數變為 2+ 時自動清空
watch(
  () => fileCount.value,
  (count) => {
    if (count > 1 && formData.slug) {
      handleSlugInput('');
    }
  },
  { immediate: true },
);

/**
 * 驗證最大檢視次數
 */
const validateMaxViews = (event) => {
  handleMaxViewsInput(event?.target?.value ?? 0);
};

/**
 * 構建分享結果條目
 */
const buildShareResultEntry = (item) => {
  const meta = item?.meta || {};
  const cachedRecord = shareRecordMap.get(item?.id);
  const record = meta.shareRecord || cachedRecord;
  if (!record) return null;

  const slug = record.slug || meta.slug || item?.slug || null;
  if (!slug && !record.url) return null;

  const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
  let shareUrl = "";
  if (slug) {
    shareUrl = fileshareService.buildShareUrl({ slug }, origin);
  } else if (record.url) {
    shareUrl = record.url.startsWith("http") || !origin ? record.url : `${origin.replace(/\/$/,"")}${record.url}`;
  }

  // 預覽與下載統一依賴 Link JSON + share URL：
  // - 預覽：優先使用 fileshareService 基於 Link JSON 構造的 previewUrl，其次退回分享頁
  // - 下載：基於 Link JSON 構造的 downloadUrl；downloadUrl=null 時無下載入口
  const previewUrl = fileshareService.getPermanentPreviewUrl(record) || shareUrl;
  const downloadUrl = fileshareService.getPermanentDownloadUrl(record);

  return {
    id: record.id || meta.fileId || item?.id || slug,
    filename: record.filename || meta.filename || item?.name || slug || "file",
    slug,
    shareUrl,
    previewUrl,
    downloadUrl,
    password: meta.password || null,
    expiresAt: record.expires_at || record.expiresAt || null,
  };
};

/**
 * 提取分享結果
 */
const extractShareResults = (uploadResults = []) => {
  const normalized = uploadResults.map((item) => {
    const entry = buildShareResultEntry(item);
    return entry;
  });
  return normalized.filter((entry) => entry && entry.shareUrl);
};

/**
 * 重新整理待處理的分享結果
 */
const flushPendingShareResults = () => {
  if (!pendingShareItems.value.length) return;
  const ready = [];
  const waiting = [];

  pendingShareItems.value.forEach((item) => {
    const entry = buildShareResultEntry(item);
    if (entry) {
      ready.push(entry);
      if (item?.id) {
        shareRecordMap.delete(item.id);
      }
    } else {
      waiting.push(item);
    }
  });

  if (!ready.length) {
    pendingShareItems.value = waiting;
    return;
  }

  emit("share-results", ready);
  pendingShareItems.value = waiting;
  if (!waiting.length) {
    shareRecordMap.clear();
  }
};

/**
 * 重置分享快取
 */
const resetShareCaches = () => {
  shareRecordMap.clear();
  pendingShareItems.value = [];
};

/**
 * 開始上傳
 */
const startUpload = async () => {
  if (!uppyInstance.value || !canStartUpload.value || isUploading.value) {
    return;
  }

  // 多檔案上傳時強制禁用自定義字尾
  if (isMultiFileUpload.value && formData.slug) {
    handleSlugInput('');
  }

  // 前置檢查
  if (!formData.storage_config_id) {
    errorMessage.value = t("file.messages.noStorageConfig");
    return;
  }
  if (Number(formData.max_views) < 0) {
    errorMessage.value = t("file.messages.negativeMaxViews");
    return;
  }
  if (!isMultiFileUpload.value && formData.slug && !validateSlug()) {
    errorMessage.value = slugError.value;
    return;
  }

  try {
    resetBackendProgressTracking();
    errorMessage.value = "";
    isUploading.value = true;

    disposeShareSession();
    emit("share-results", []);
    resetShareCaches();

    const basePayload = buildPayloadForFile(
      isMultiFileUpload.value ? { ...formData, slug: '' } : formData,
    );

    let session;
    if (uploadMode.value === "presigned" && canUsePresignMode.value) {
      // 預簽名模式：沿用現有單請求直傳 + commit 流程
      session = createShareSession({
        payload: {
          ...basePayload,
        },
        uppy: uppyInstance.value,
        events: {
          onProgress: (progress) => {
            if (progress) {
              updateBrowserProgressState(progress);
            }
          },
          onError: ({ file, error }) => {
            log.error("[UppyShareUploader] 上傳錯誤:", file?.name, error);
            errorMessage.value = error?.message || t("file.messages.uploadFailed");
          }, 
          onComplete: (result) => {
            const failedDescriptors = (result?.failed || []).map((item) =>
              buildErrorDescriptor(item?.error || new Error(t("file.messages.uploadFailed")))
            );
            const uploadResults = result?.successful || [];
            pendingShareItems.value = uploadResults;
            const normalizedShareResults = extractShareResults(uploadResults);
            const summary = summarizeUploadResults({
              errors: failedDescriptors,
              uploadResults,
              totalFiles: uppyInstance.value.getFiles().length,
            });

            if (normalizedShareResults.length) {
              emit("share-results", normalizedShareResults);
              resetShareCaches();
            } else if (pendingShareItems.value.length) {
            }

            flushPendingShareResults();

            if (summary) {
              if (summary.kind === "error") {
                errorMessage.value = summary.message;
                emit("upload-error", new Error(summary.message));
              } else if (summary.kind === "success") {
                emit("upload-success", uploadResults);
                formData.slug = "";
                formData.remark = "";
                formData.password = "";

                // 清理成功的檔案
                setTimeout(() => {
                  if (uppyInstance.value) {
                    uppyInstance.value.clear();
                  }
                }, 3000);
              }
            }

            disposeShareSession();
          }, 
          onShareRecord: ({ file, shareRecord }) => {
            if (file?.id && shareRecord) {
              shareRecordMap.set(file.id, shareRecord);
            }
            flushPendingShareResults();
          },
        },
      });
    } else {
      // 直傳分享模式：根據 uploadMode 決定流式 / 表單
      session = createDirectShareSession({
        payload: {
          ...basePayload,
        },
        shareMode: uploadMode.value,
        uppy: uppyInstance.value,
        events: {
        onProgress: (progress) => {
          if (progress) {
            updateBrowserProgressState(progress);
          }
        },
        onError: ({ file, error }) => {
          log.error("[UppyShareUploader] 上傳錯誤:", file?.name, error);
          errorMessage.value = error?.message || t("file.messages.uploadFailed");
        },
        onComplete: (result) => {
          const failedDescriptors = (result?.failed || []).map((item) =>
            buildErrorDescriptor(item?.error || new Error(t("file.messages.uploadFailed")))
          );
          const uploadResults = result?.successful || [];
          pendingShareItems.value = uploadResults;
          const normalizedShareResults = extractShareResults(uploadResults);
          const summary = summarizeUploadResults({
            errors: failedDescriptors,
            uploadResults,
            totalFiles: uppyInstance.value.getFiles().length,
          });

          if (normalizedShareResults.length) {
            emit("share-results", normalizedShareResults);
            resetShareCaches();
          } else if (pendingShareItems.value.length) {
          }

          flushPendingShareResults();

          if (summary) {
            if (summary.kind === "error") {
              errorMessage.value = summary.message;
              emit("upload-error", new Error(summary.message));
            } else if (summary.kind === "success") {
              emit("upload-success", uploadResults);
              formData.slug = "";
              formData.remark = "";
              formData.password = "";

              // 清理成功的檔案
              setTimeout(() => {
                if (uppyInstance.value) {
                  uppyInstance.value.clear();
                }
              }, 3000);
            }
          }

          disposeShareSession();
        },
        onShareRecord: ({ file, shareRecord }) => {
          if (file?.id && shareRecord) {
            shareRecordMap.set(file.id, shareRecord);
          }
          flushPendingShareResults();
        },
      }});
    }

    if (uploadMode.value === "stream") {
      try {
        uppyInstance.value.getFiles().forEach((file) => ensureUploadIdForFile(file));
      } catch {}
      startBackendProgressPolling();
    }

    await session.start();
  } catch (error) {
    log.error("[UppyShareUploader] 上傳失敗", error);
    errorMessage.value = error.message || t("file.messages.uploadFailed");
    emit("upload-error", error);
    disposeShareSession();
  } finally {
    resetBackendProgressTracking();
    isUploading.value = false;
  }
};

/**
 * 取消上傳
 */
const cancelUpload = () => {
  if (!isUploading.value && !activeShareSession.value) return;
  try {
    activeShareSession.value?.cancel?.();
  } catch {}
  isUploading.value = false;
  errorMessage.value = t("file.cancelAllMessage");
  resetBackendProgressTracking();
  disposeShareSession();
};

// 監聽上傳模式變化，重新初始化 Uppy（確保清理舊外掛）
watch(
  () => uploadMode.value,
  () => {
    if (uppyInstance.value && !isUploading.value) {
      reinitUppy({ preserveFiles: true });
    }
  }
);

// 監聽暗色模式變化
watch(
  () => props.darkMode,
  async () => {
    if (uppyInstance.value) {
      resetBackendProgressTracking();
      await setupUppy();
    }
  }
);

// 監聽語言變化
watch(
  () => locale.value,
  () => {
    if (pluginManager) {
      pluginManager.updateLocale(locale.value);
      mediaPlugins.value = pluginManager.getPluginList();
    }
    if (uppyInstance.value && !isUploading.value) {
      resetBackendProgressTracking();
      reinitUppy({ preserveFiles: true });
    }
  }
);

// 生命週期
onMounted(async () => {
  await nextTick();
  await loadMaxUploadSize();
  await setupUppy();
});

onBeforeUnmount(() => {
  destroyUppy();
  resetBackendProgressTracking();
  disposeShareSession(true);
});
</script>

<style scoped>
/* 元件特有樣式 */
</style>
