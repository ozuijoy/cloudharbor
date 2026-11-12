<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div
      class="relative w-full max-w-sm sm:max-w-3xl lg:max-w-5xl h-auto min-h-[400px] sm:min-h-[500px] max-h-[85vh] sm:max-h-[80vh] rounded-lg shadow-xl flex flex-col"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
    >
      <!-- 彈窗標題欄 -->
      <div class="p-4 flex justify-between items-center border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-lg font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ t("mount.uppy.title") }}</h3>
        <button
          @click="closeModal"
          class="p-1 rounded-full transition-colors"
          :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        >
          <IconClose size="lg" aria-hidden="true" />
        </button>
      </div>

      <!-- 彈窗內容區 -->
      <div class="flex-1 p-4 overflow-y-auto">
        <!-- 上傳模式選擇 -->
        <UploadModeSelector
          v-model="uploadMethod"
          :modes="uploadModes"
          :title="t('mount.uppy.uploadMethod')"
          :dark-mode="darkMode"
          :disabled="isUploading"
        />

        <!-- 高階功能 -->
        <AdvancedPluginsPanel
          :plugins="mediaPlugins"
          :enabled-count="enabledPluginsCount"
          :title="t('mount.uppy.advancedFeatures')"
          :enabled-count-template="t('mount.uppy.enabledCount', { count: '{count}' })"
          :dark-mode="darkMode"
          @toggle-plugin="togglePlugin"
        />

        <!-- Uppy Dashboard 容器 -->
        <UppyDashboardContainer
          ref="uppyContainerRef"
          container-id="uppy-dashboard"
          :dark-mode="darkMode"
          :show-paste-hint="true"
          :paste-hint-prefix="t('mount.uppy.pasteSupport')"
          :paste-key="t('mount.uppy.pasteKey')"
          :paste-hint-suffix="t('mount.uppy.pasteHint')"
        />
      </div>

      <!-- 底部操作欄 -->
      <div class="p-4 border-t" :class="darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50/50'">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-2">
              <IconFolder size="sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" aria-hidden="true" />
              <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'"> {{ t("mount.uppy.targetPath") }} {{ currentPath }} </span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- 開始上傳按鈕 -->
            <button
              v-if="canStartUpload"
              @click="startUpload"
              :disabled="isUploading"
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center space-x-2 disabled:opacity-50"
              :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'"
            >
              <IconRefresh v-if="isUploading" size="sm" class="animate-spin" aria-hidden="true" />
              <IconUpload v-else size="sm" aria-hidden="true" />
              <span>{{ isUploading ? t("mount.uppy.uploading") : t("mount.uppy.startUpload") }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 多個上傳選擇對話方塊 -->
    <Teleport to="body">
      <SelectUploadDialog
        v-if="showSelectUploadDialog"
        :is-open="showSelectUploadDialog"
        :file="selectUploadData.file"
        :uploads="selectUploadData.uploads"
        :show-match-score="selectUploadData.showMatchScore"
        :dark-mode="darkMode"
        @select="handleUploadSelect"
        @cancel="handleUploadSelectCancel"
        @close="showSelectUploadDialog = false"
      />
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { IconClose, IconFolder, IconRefresh, IconUpload } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

import Dashboard from "@uppy/dashboard";

// 匯入Uppy樣式
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import "@uppy/webcam/dist/style.min.css";
import "@uppy/screen-capture/dist/style.min.css";
import "@uppy/audio/dist/style.min.css";
import "@uppy/image-editor/dist/style.min.css";
import "@uppy/url/dist/style.min.css";

// 匯入共享CSS
import "@/styles/uppy-dashboard.css";

// 匯入共享Composables
import { useUppyCore, useUppyEvents, useUppyPaste, useUppyBackendProgress } from "@/composables/uppy";

// 匯入共享UI元件
import UploadModeSelector from "@/components/uppy/UploadModeSelector.vue";
import AdvancedPluginsPanel from "@/components/uppy/AdvancedPluginsPanel.vue";
import UppyDashboardContainer from "@/components/uppy/UppyDashboardContainer.vue";
import ServerResumePlugin from "@/modules/storage-core/uppy/plugins/ServerResumePlugin.js";
import Sha256PreprocessPlugin from "@/modules/storage-core/uppy/plugins/Sha256PreprocessPlugin.js";
import { api } from "@/api";
import { getUploadProgress } from "@/api/services/systemService.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { STORAGE_STRATEGIES } from "@/modules/storage-core/drivers/types.js";
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";
import { useShareUploadController } from "@/modules/upload";
import { normalizeFsPath } from "@/utils/fsPathUtils.js";

// 匯入外掛管理器
import { createUppyPluginManager } from "@/modules/storage-core/uppy/UppyPluginManager.js";

// 匯入 URL 上傳服務
import { validateUrlInfo, fetchUrlContent } from "@/api/services/urlUploadService.js";

// 匯入對話方塊元件
import SelectUploadDialog from "@/components/common/dialogs/SelectUploadDialog.vue";

// 元件屬性
const props = defineProps({
  isOpen: { type: Boolean, default: false },
  darkMode: { type: Boolean, default: false },
  currentPath: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
});

// 事件
const emit = defineEmits(["close", "upload-success", "upload-error"]);

// 國際化
const { locale, t } = useI18n();
const log = createLogger("UppyUploadModal");

// 使用Composables
const { uppyInstance, initializeUppy, destroyUppy } = useUppyCore();
const { fileCount } = useUppyEvents({
  uppy: uppyInstance,
  onFileAdded: (file) => {
    ensureUploadIdForFile(file);
    errorMessage.value = "";
  },
  onFileRemoved: (file) => {
  },
  onError: (error) => {
    // 捕獲Uppy系統錯誤，統一展示到錯誤區域
    const message = error?.message || t("file.messages.uploadFailed");
    errorMessage.value = message;
  },
});

useUppyPaste({
  uppy: uppyInstance,
  enabled: computed(() => props.isOpen),
  onPaste: (file) => {
  },
});

// 響應式資料
const uppyContainerRef = ref(null);
const uploadMethod = ref("presigned");
const canUsePresigned = ref(true);
const canUseMultipart = ref(true);
const canUseStream = ref(true);
const canUseForm = ref(true);
const currentDriverType = ref(null);
const errorMessage = ref("");
const isUploading = ref(false);
const mediaPlugins = ref([]);

// 多個上傳選擇對話方塊狀態
const showSelectUploadDialog = ref(false);
const selectUploadData = ref({
  file: null,
  uploads: [],
  showMatchScore: true,
  onSelect: null,
  onCancel: null,
});

// 外掛管理器例項
let pluginManager = null;

// 驅動介面卡控制代碼
let fsAdapterHandle = null;
let fsUploadSession = null;

// 目前 Uppy 上所有外掛 id
const listUppyPluginIds = (uppy) => {
  const ids = [];
  try {
    uppy?.iteratePlugins?.((plugin) => {
      if (plugin?.id) ids.push(plugin.id);
    });
  } catch {}
  return ids;
};

const disposeFsAdapterHandle = () => {
  if (fsAdapterHandle?.adapter?.destroy) {
    try {
      fsAdapterHandle.adapter.destroy();
    } catch (error) {
      log.warn("[Uppy] 清理StorageAdapter失敗", error);
    }
  }
  // 移除這個 handle 安裝的上傳外掛（AwsS3 / XHRUpload…）。
  // 不移除的話，切換上傳方式時新外掛會因 id 重複而安裝失敗，
  // 或兩個上傳外掛同時存在，導致同一個檔案被上傳兩次、或仍用舊方式（整檔單次 PUT）上傳。
  const uppy = uppyInstance.value;
  const pluginIds = Array.isArray(fsAdapterHandle?.pluginIds) ? fsAdapterHandle.pluginIds : [];
  for (const id of pluginIds) {
    try {
      const plugin = uppy?.getPlugin?.(id);
      if (plugin) uppy.removePlugin(plugin);
    } catch (error) {
      log.warn(`[Uppy] 移除上傳外掛 ${id} 失敗（可忽略）`, error);
    }
  }
  fsAdapterHandle = null;
};

const disposeFsSession = (shouldCancel = false) => {
  if (shouldCancel) {
    try {
      fsUploadSession?.cancel?.();
    } catch {}
  }
  try {
    fsUploadSession?.destroy?.();
  } catch {}
  fsUploadSession = null;
};

const storageConfigsStore = useStorageConfigsStore();
const { createFsUploadSession } = useShareUploadController();
const driverStrategy = ref(STORAGE_STRATEGIES.PRESIGNED_SINGLE);
const mountsCache = ref([]);
const mountsLoading = ref(false);

const enforceUploadMethodByDriver = (driver) => {
  const fsCaps = driver?.capabilities?.fs || {};
  const allowPresigned = fsCaps.presignedSingle === true;
  const allowMultipart = fsCaps.multipart === true;
  const allowStream = fsCaps.backendStream !== false;
  const allowForm = fsCaps.backendForm !== false;
  canUsePresigned.value = allowPresigned;
  canUseMultipart.value = allowMultipart;
  canUseStream.value = allowStream;
  canUseForm.value = allowForm;
  currentDriverType.value = driver?.config?.storage_type || driver?.type || null;

  const pickFallback = () => {
    if (allowMultipart) return "multipart";
    if (allowPresigned) return "presigned";
    if (allowStream) return "stream";
    if (allowForm) return "form";
    return "stream";
  };

  if (uploadMethod.value === "presigned" && !allowPresigned) uploadMethod.value = pickFallback();
  if (uploadMethod.value === "multipart" && !allowMultipart) uploadMethod.value = pickFallback();
  if (uploadMethod.value === "stream" && !allowStream) uploadMethod.value = pickFallback();
  if (uploadMethod.value === "form" && !allowForm) uploadMethod.value = pickFallback();
};

const getMountRootFromPath = (path) => {
  const normalized = normalizeFsPath(path);
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return null;
  return `/${segments[0]}`;
};

const ensureMountsLoaded = async () => {
  if (mountsCache.value.length || mountsLoading.value) return;
  mountsLoading.value = true;
  try {
    const { useAdminMountService } = await import("@/modules/admin/services/mountService.js");
    const { getMountsList } = useAdminMountService();
    const mounts = await getMountsList();
    mountsCache.value = Array.isArray(mounts) ? mounts : [];
  } catch (error) {
    log.error("[Uppy] 載入掛載列表失敗", error);
  } finally {
    mountsLoading.value = false;
  }
};

const getStorageConfigIdForCurrentPath = async () => {
  await ensureMountsLoaded();
  const mountRoot = getMountRootFromPath(props.currentPath);
  if (!mountRoot) return null;
  const mount = mountsCache.value.find((item) => item.mount_path === mountRoot);
  return mount?.storage_config_id || null;
};

const ensureStorageConfigForCurrentPath = async () => {
  const id = await getStorageConfigIdForCurrentPath();
  if (!id) throw new Error(t("file.messages.noStorageConfig"));

  // 1) 嘗試透過通用 storageConfigsStore 載入配置（可能對非 admin 返回 403）
  let loadError = null;
  try {
    if (!storageConfigsStore.hasFreshCache.value) {
      await storageConfigsStore.loadConfigs();
    }
  } catch (e) {
    // 記錄載入錯誤，但先不急著決定提示內容
    loadError = e;
  }

  // 如果快取中已有目標配置，直接返回
  if (storageConfigsStore.getConfigById(id)) return id;

  // 如果載入過程中發生錯誤（例如非 admin 無權訪問儲存配置列表），
  // 且仍然找不到目標配置，則將原始錯誤丟擲，交由上層統一規範化（包括許可權錯誤提示）。
  if (loadError) {
    throw loadError;
  }

  // 2) admin 場景下的兜底：直接呼叫 admin storageConfigService 補全配置列表
  try {
    const { useAdminStorageConfigService } = await import("@/modules/admin/services/storageConfigService.js");
    const { getStorageConfigs } = useAdminStorageConfigService();
    const resp = await getStorageConfigs();
    if (resp?.data) {
      storageConfigsStore.replaceConfigs(resp.data);
      if (storageConfigsStore.getConfigById(id)) return id;
    }
  } catch (e) {
    // admin 兜底失敗時不覆蓋之前的錯誤語義，仍然落到“缺少配置”提示
  }

  // 3) 確實不存在該儲存配置（或配置被刪除）
  throw new Error(`${t("file.messages.noStorageConfig")}: ${id}`);
};

// 上傳模式配置
const uploadModes = computed(() => {
  return [
    {
      value: "presigned",
      label: t("mount.uppy.presignedUpload"),
      modeLabel: t("mount.uppy.presignedMode"),
      tooltip: t("mount.uppy.presignedModeTooltip"),
      disabled: !canUsePresigned.value,
    },
    {
      value: "stream",
      label: t("mount.uppy.streamUpload"),
      modeLabel: t("mount.uppy.streamMode"),
      tooltip: t("mount.uppy.streamModeTooltip"),
      disabled: !canUseStream.value,
    },
    {
      value: "form",
      label: t("mount.uppy.formUpload"),
      modeLabel: t("mount.uppy.formMode"),
      tooltip: t("mount.uppy.formModeTooltip"),
      disabled: !canUseForm.value,
    },
    {
      value: "multipart",
      label: t("mount.uppy.multipartUpload"),
      modeLabel: t("mount.uppy.multipartMode"),
      tooltip: t("mount.uppy.multipartModeTooltip"),
      badge: t("mount.uppy.resumeSupport"),
      disabled: !canUseMultipart.value,
    },
  ];
});

const {
  ensureUploadIdForFile,
  resetBackendProgressTracking,
  updateBrowserProgressState,
  startBackendProgressPolling,
} = useUppyBackendProgress({
  uppy: uppyInstance,
  isDirectMode: () => uploadMethod.value === "stream",
});

// 計算屬性
const canStartUpload = computed(() => {
  const hasFiles = fileCount.value > 0 && !isUploading.value;
  if (!hasFiles) return false;

  // 如果當前模式已被禁用，就不允許“開始上傳”
  if (uploadMethod.value === "presigned") return canUsePresigned.value === true;
  if (uploadMethod.value === "multipart") return canUseMultipart.value === true;
  if (uploadMethod.value === "stream") return canUseStream.value === true;
  if (uploadMethod.value === "form") return canUseForm.value === true;
  return false;
});

const enabledPluginsCount = computed(() => {
  return pluginManager ? pluginManager.getEnabledPluginsCount() : 0;
});

/**
 * 切換外掛狀態
 */
const togglePlugin = (pluginKey) => {
  if (pluginManager) {
    pluginManager.togglePlugin(pluginKey);
    mediaPlugins.value = pluginManager.getPluginList();
    if (props.isOpen && uppyInstance.value) {
      setupUppy();
    }
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
      name: t("mount.uppy.fileName"),
      placeholder: t("mount.uppy.customFilename"),
    },
  ],
  locale: {
    strings: {
      dataUploadedOfTotal: "%{complete} / %{total}",
    },
  },
});

/**
 * 獲取ServerResumePlugin外掛配置
 */
const getServerResumeConfig = () => ({
  autoCheck: true,
  matchThreshold: 0.8,
  timeWindow: 24,
  showConfirmDialog: true,
  currentPath: props.currentPath,
  maxSelectionOptions: 5,
  showMatchScore: true,
  shouldUseMultipart: () => uploadMethod.value === 'multipart',
  resolveStorageConfigId: async () => await ensureStorageConfigForCurrentPath(),
  // 讓 ServerResumePlugin 能讀取 StorageAdapter 的本地分片賬本（client_keeps）
  storagePrefix: fsAdapterHandle?.adapter?.config?.storagePrefix || 'uppy_multipart_',
  cacheExpiry: fsAdapterHandle?.adapter?.config?.cacheExpiry || 24 * 60 * 60 * 1000,
});

// 超過此大小就強制使用分片上傳（整檔單次 PUT 在部分網路必被重置）
const LARGE_FILE_MULTIPART_THRESHOLD = 16 * 1024 * 1024;

const strategyMap = {
  stream: STORAGE_STRATEGIES.BACKEND_STREAM, // 流式直傳：PUT /fs/upload
  form: STORAGE_STRATEGIES.BACKEND_FORM,     // 表單上傳：POST /fs/upload
  presigned: STORAGE_STRATEGIES.PRESIGNED_SINGLE,
  multipart: STORAGE_STRATEGIES.PRESIGNED_MULTIPART,
};

/**
 * 配置上傳方式
 */
const configureUploadMethod = async () => {
  try {
    const storageConfigId = await ensureStorageConfigForCurrentPath();
    const driver = resolveDriverByConfigId(storageConfigId);
    enforceUploadMethodByDriver(driver);
    driverStrategy.value = strategyMap[uploadMethod.value] || STORAGE_STRATEGIES.BACKEND_STREAM;
    if (
      driver?.fs?.applyFsUploader &&
      (driverStrategy.value === STORAGE_STRATEGIES.PRESIGNED_SINGLE ||
        driverStrategy.value === STORAGE_STRATEGIES.PRESIGNED_MULTIPART ||
        driverStrategy.value === STORAGE_STRATEGIES.BACKEND_STREAM ||
        driverStrategy.value === STORAGE_STRATEGIES.BACKEND_FORM)
    ) {
      disposeFsAdapterHandle();
      // 記下 applyFsUploader 新增了哪些外掛（不含 Sha256 這類前處理外掛），之後切換方式時才能精準移除
      const before = new Set(listUppyPluginIds(uppyInstance.value));
      const handle = driver.fs.applyFsUploader(uppyInstance.value, { strategy: driverStrategy.value, path: props.currentPath });
      const pluginIds = listUppyPluginIds(uppyInstance.value).filter(
        (id) => !before.has(id) && id !== "Sha256PreprocessPlugin" && id !== "ServerResumePlugin",
      );
      fsAdapterHandle =
        handle && typeof handle === "object"
          ? { ...handle, mode: handle.mode || driverStrategy.value, pluginIds }
          : { adapter: null, mode: driverStrategy.value, pluginIds };
    }
  } catch (e) {
    log.warn('[Uppy] configureUploadMethod 解析驅動失敗', e);
    disposeFsAdapterHandle();
  }
};

/**
 * 配置 ServerResumePlugin 外掛
 * - 避免重複安裝相同 id 的外掛
 * - 根據當前上傳模式動態開啟/關閉並更新配置
 */
const configureServerResumePlugin = () => {
  const uppy = uppyInstance.value;
  if (!uppy) return;

  const existing = uppy.getPlugin('ServerResumePlugin');

  if (uploadMethod.value === 'multipart') {
    const opts = getServerResumeConfig();
    if (existing) {
      try {
        existing.setOptions(opts);
      } catch (e) {
        log.warn('[Uppy] 更新 ServerResumePlugin 配置失敗', e);
      }
    } else {
      uppy.use(ServerResumePlugin, opts);
    }
  } else if (existing) {
    // 非分片模式時移除外掛，避免多次初始化
    try {
      uppy.removePlugin(existing);
    } catch (e) {
      log.warn("[Uppy] 移除 ServerResumePlugin 失敗（可忽略）", e);
    }
  }
};

/**
 * 配置 Sha256PreprocessPlugin 外掛（預簽名模式使用）
 * “計算 sha256” 發生在 preprocess 階段，Uppy 面板就能顯示進度
 */
const configureSha256PreprocessPlugin = () => {
  const uppy = uppyInstance.value;
  if (!uppy) return;

  const existing = uppy.getPlugin("Sha256PreprocessPlugin");

  // 只有當“該驅動的預簽名模式確實需要 sha256”時才開啟：
  // HuggingFace LFS 需要 sha256(oid) 才能換到 uploadUrl
  const requireSha256ForPresign = fsAdapterHandle?.adapter?.config?.requireSha256ForPresign === true;

  if ((uploadMethod.value === "presigned" || uploadMethod.value === "multipart") && requireSha256ForPresign) {
    const opts = {
      enabled: true,
      maxWebCryptoSize: 10_000_000,
      metaKey: "cloudharborSha256",
    };

    if (existing) {
      try {
        existing.setOptions(opts);
      } catch (e) {
        log.warn("[Uppy] 更新 Sha256PreprocessPlugin 配置失敗", e);
      }
    } else {
      uppy.use(Sha256PreprocessPlugin, opts);
    }
  } else if (existing) {
    try {
      uppy.removePlugin(existing);
    } catch (e) {
      log.warn("[Uppy] 移除 Sha256PreprocessPlugin 失敗（可忽略）", e);
    }
  }
};

/**
 * 設定斷點續傳對話方塊事件監聽器
 */
const setupResumeDialogEvents = () => {
  uppyInstance.value.on("server-resume-select-dialog", (data) => {
    selectUploadData.value = {
      file: data.file,
      uploads: data.uploads,
      showMatchScore: data.showMatchScore,
      onSelect: data.onSelect,
      onCancel: data.onCancel,
    };
    showSelectUploadDialog.value = true;
  });
};

/**
 * 初始化Uppy例項
 */
const setupUppy = async () => {
  try {
    if (uppyInstance.value) {
      disposeFsSession(true);
      destroyUppy();
    }
    disposeFsAdapterHandle();

    await initializeUppy({
      id: "new-uppy-dashboard",
      locale: locale.value,
    });

    pluginManager = createUppyPluginManager(uppyInstance.value, locale.value);
    mediaPlugins.value = pluginManager.getPluginList();

    // 設定 URL 匯入外掛回撥
    pluginManager.setUrlImportCallbacks({
      validateUrlInfo,
      fetchUrlContent,
    });

    uppyInstance.value.use(Dashboard, getDashboardConfig());

    // 安裝“斷點續傳檢查”外掛：
    configureServerResumePlugin();
    if (uploadMethod.value === "multipart") {
      setupResumeDialogEvents();
    }

    await configureUploadMethod();
    // configureUploadMethod 可能會建立 StorageAdapter（其中含有 storagePrefix/cacheExpiry），
    // 這裡再更新一次 ServerResumePlugin 的配置，確保 client_keeps 能讀到本地賬本。
    configureServerResumePlugin();

    configureSha256PreprocessPlugin();

    await pluginManager.addPluginsToUppy();
  } catch (error) {
    log.error("[Uppy] 初始化失敗:", error);
    errorMessage.value = t("mount.uppy.initializationFailed", { message: error.message });
  }
};

/**
 * 處理上傳完成事件
 */
const handleUploadComplete = async (result) => {
  isUploading.value = false;

  if (result.successful.length > 0) {
    // skipUpload（秒傳/去重）統計來源說明：
    // - 對 presigned-single：commit 階段會清理 uploadSessions，所以必須在 runFsCommitIfNeeded 裡先做快照並寫回 result.cloudharbor
    // - 對 multipart（HuggingFace 的 skipUpload=true）：complete 階段會清理 uploadSessions，因此必須依賴 file.meta.cloudharborSkipUpload
    let skippedUploadCount = 0;
    try {
      const fromMeta = result.successful.filter((file) => file?.meta?.cloudharborSkipUpload === true).length;
      const fromCloudHarbor = Number(result?.cloudharbor?.skippedUploadCount || 0);
      skippedUploadCount = Math.max(fromMeta, fromCloudHarbor);
    } catch {
      skippedUploadCount = Number(result?.cloudharbor?.skippedUploadCount || 0);
    }

    const successCount = result.successful.length;
    const message =
      skippedUploadCount > 0
        ? `上傳完成：成功 ${successCount} 個（其中 ${skippedUploadCount} 個已跳過上傳/秒傳）`
        : `上傳完成：成功 ${successCount} 個`;

    emit("upload-success", {
      count: result.successful.length,
      skippedUploadCount,
      message,
      commitFailures: [],
      commitStats: {
        successCount: result.successful.length,
        failureCount: 0,
        totalCount: result.successful.length,
      },
      results: result.successful.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        url: file.uploadURL,
      })),
    });

    setTimeout(() => {
      if (uppyInstance.value) {
        uppyInstance.value.clear();
      }
    }, 4000);
  }

  if (result.failed.length > 0) {
    const firstError = result.failed[0].error;
    emit("upload-error", new Error(firstError?.message || "上傳失敗"));
  }
};

const runFsCommitIfNeeded = async (result) => {
  if (!result) return;
  result.failed = result.failed || [];
  result.successful = result.successful || [];
  if (!fsAdapterHandle?.adapter || fsAdapterHandle.mode !== STORAGE_STRATEGIES.PRESIGNED_SINGLE) {
    return;
  }
  if (!result.successful.length) {
    return;
  }

  // 先快照本次上傳的 skipUpload 資訊（物件已存在/秒傳/去重）：
  // commitPresignedUpload 成功後會 delete uploadSessions，所以必須在 commit 前儲存。
  const adapter = fsAdapterHandle.adapter;
  const skipSnapshot = {};
  try {
    if (adapter?.isUploadSkipped && typeof adapter.isUploadSkipped === "function") {
      result.successful.forEach((file) => {
        skipSnapshot[file.id] = adapter.isUploadSkipped(file.id) === true;
      });
    }
  } catch (e) {
    log.warn("[Uppy] 生成 skipUpload 快照失敗，將忽略該提示", e);
  }

  try {
    const summary = await fsAdapterHandle.adapter.batchCommitPresignedUploads(result.successful);
    const failures = summary?.failures || [];
    if (!failures.length) {
      result.cloudharbor = {
        ...(result.cloudharbor || {}),
        skippedUploadCount: result.successful.filter((file) => skipSnapshot[file.id] === true).length,
      };
      return;
    }

    const failureMap = new Map();
    failures.forEach((failure) => {
      const error = new Error(failure.error || "提交預簽名上傳失敗");
      failureMap.set(failure.fileId, error);
    });

    const remaining = [];
    result.successful.forEach((file) => {
      const failureError = failureMap.get(file.id);
      if (failureError) {
        try {
          uppyInstance.value?.emit?.("upload-error", file, failureError);
        } catch {}
        result.failed.push({ file, error: failureError });
      } else {
        remaining.push(file);
      }
    });

    result.successful = remaining;
    result.cloudharbor = {
      ...(result.cloudharbor || {}),
      skippedUploadCount: result.successful.filter((file) => skipSnapshot[file.id] === true).length,
    };
  } catch (error) {
    const failureError = error instanceof Error ? error : new Error(String(error));
    const failedFiles = result.successful.slice();
    failedFiles.forEach((file) => {
      try {
        uppyInstance.value?.emit?.("upload-error", file, failureError);
      } catch {}
      result.failed.push({ file, error: failureError });
    });
    result.successful = [];
    result.cloudharbor = {
      ...(result.cloudharbor || {}),
      skippedUploadCount: 0,
    };
  }
};

/**
 * 規範化 FS 上傳錯誤資訊，統一處理許可權錯誤等場景
 */
const normalizeFsUploadError = (error) => {
  if (!error) {
    return t("file.messages.uploadFailed");
  }

  const status = error?.request?.status || error?.response?.status;
  const body = error?.response?.body;
  const code = body?.code || error.code;

  // 許可權錯誤：後端返回 403 或特定錯誤碼時，統一提示為“沒有許可權使用此儲存配置”
  if (status === 403 || code === "FS_PERMISSION_DENIED") {
    return t("file.messages.permissionError");
  }

  if (typeof body?.message === "string" && body.message) {
    return body.message;
  }

  if (typeof error.message === "string" && error.message) {
    return error.message;
  }

  return t("file.messages.uploadFailed");
};

/**
 * 開始上傳
 */
const startUpload = async () => {
  if (!uppyInstance.value || !canStartUpload.value || isUploading.value) {
    return;
  }

  try {
    errorMessage.value = "";
    isUploading.value = true;
    const storageConfigId = await ensureStorageConfigForCurrentPath();
    try {
      const driver = resolveDriverByConfigId(storageConfigId);
      enforceUploadMethodByDriver(driver);
    } catch (e) {
      log.warn("[Uppy] startUpload 驅動解析失敗", e);
    }

    // 大檔一律走分片（S3/HuggingFace 的「整檔一次 PUT」在部分網路會被重置成
    // net::ERR_CONNECTION_RESET，而且失敗就整檔重來；分片可以把風險切小並逐片重試）
    try {
      const files = uppyInstance.value?.getFiles?.() || [];
      const oversizedFile = files.find((file) => {
        const size = Number(file?.size || file?.data?.size || 0);
        return size > LARGE_FILE_MULTIPART_THRESHOLD;
      });
      if (oversizedFile && uploadMethod.value !== "multipart" && canUseMultipart.value) {
        log.info(
          `[Uppy] 檔案 ${oversizedFile.name} 大小 ${Math.round((oversizedFile.size || 0) / 1024 / 1024)}MB 超過 ` +
            `${Math.round(LARGE_FILE_MULTIPART_THRESHOLD / 1024 / 1024)}MB，自動切換為分片上傳（直連）`,
        );
        uploadMethod.value = "multipart";
        // configureUploadMethod 會先移除舊的上傳外掛再安裝分片外掛
        await configureUploadMethod();
        if (fsAdapterHandle?.mode !== STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
          throw new Error("切換為分片上傳失敗：分片上傳外掛未能安裝");
        }
        // 分片模式需要的輔助外掛（HuggingFace 的 sha256、斷點續傳檢查）也要跟著更新
        configureServerResumePlugin();
        configureSha256PreprocessPlugin();
      }
    } catch (e) {
      log.warn("[Uppy] 自動切換分片上傳失敗（忽略）", e);
    }

    driverStrategy.value = strategyMap[uploadMethod.value] || STORAGE_STRATEGIES.BACKEND_STREAM;

    disposeFsSession();
    resetBackendProgressTracking();
    fsUploadSession = createFsUploadSession({
      storageConfigId,
      fsOptions: { strategy: driverStrategy.value, path: props.currentPath },
      uppy: uppyInstance.value,
      events: {
        onProgress: (progress) => {
          if (progress) {
            updateBrowserProgressState(progress);
          }
        },
        onError: ({ error }) => {
          errorMessage.value = normalizeFsUploadError(error);
        },
        onComplete: async (result) => {
          try {
            await runFsCommitIfNeeded(result);
            await handleUploadComplete(result);
          } finally {
            resetBackendProgressTracking();
            disposeFsSession();
          }
        },
      },
    });

    if (uploadMethod.value === "stream") {
      try {
        uppyInstance.value.getFiles().forEach((file) => ensureUploadIdForFile(file));
      } catch {}
      startBackendProgressPolling();
    }

    await fsUploadSession.start();
  } catch (error) {
    log.error("[Uppy] 上傳失敗", error);
    errorMessage.value = normalizeFsUploadError(error);
    emit("upload-error", error);
    disposeFsSession();
  } finally {
    resetBackendProgressTracking();
    isUploading.value = false;
  }
};

const closeModal = () => {
  if (uppyInstance.value) {
    uppyInstance.value.cancelAll?.();
    uppyInstance.value.clear();
  }
  errorMessage.value = "";
  isUploading.value = false;
  resetBackendProgressTracking();
  disposeFsSession(true);
  disposeFsAdapterHandle();
  emit("close");
};

/**
 * 處理上傳選擇對話方塊確認
 */
const handleUploadSelect = (selectedUpload) => {
  showSelectUploadDialog.value = false;
  if (selectUploadData.value.onSelect) {
    selectUploadData.value.onSelect(selectedUpload);
  }
};

/**
 * 處理上傳選擇對話方塊取消
 */
const handleUploadSelectCancel = () => {
  showSelectUploadDialog.value = false;
  if (selectUploadData.value.onCancel) {
    selectUploadData.value.onCancel();
  }
};

// 監聽上傳方式變化，重新初始化 Uppy（確保清理舊外掛）
watch(
  () => uploadMethod.value,
  async () => {
    if (props.isOpen && uppyInstance.value && !isUploading.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
      await setupUppy();
    }
  }
);

// 監聽彈窗開啟狀態
watch(
  () => props.isOpen,
  async (newValue) => {
    if (newValue) {
      await ensureMountsLoaded();
      try {
        await storageConfigsStore.loadConfigs();
      } catch (e) {}
      await nextTick();
      await setupUppy();
    } else if (uppyInstance.value) {
      uppyInstance.value.cancelAll?.();
      uppyInstance.value.clear();
      errorMessage.value = "";
      isUploading.value = false;
      resetBackendProgressTracking();
      disposeFsSession(true);
      disposeFsAdapterHandle();
    }
  }
);

// 監聽路徑變化
watch(
  () => props.currentPath,
  async () => {
    if (!props.isOpen || !uppyInstance.value || isUploading.value) {
      return;
    }
    resetBackendProgressTracking();
    disposeFsSession(true);
    await setupUppy();
  }
);

// 監聽暗色模式變化
watch(
  () => props.darkMode,
  async () => {
    if (props.isOpen && uppyInstance.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
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
    if (props.isOpen && uppyInstance.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
      setupUppy();
    }
  }
);

// 生命週期
onMounted(async () => {
  if (props.isOpen) {
    await ensureMountsLoaded();
    await nextTick();
    await setupUppy();
  }
});

onBeforeUnmount(() => {
  destroyUppy();
  resetBackendProgressTracking();
  disposeFsSession(true);
  disposeFsAdapterHandle();
});
</script>

<style scoped>
/* 元件特有樣式 */
</style>
