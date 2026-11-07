<template>
  <div :class="['file-info-container flex flex-col min-h-0', previewKey === PREVIEW_KEYS.AUDIO ? '' : 'flex-grow']">
    <!-- 檔案頭部資訊 -->
    <div class="file-header mb-6">
      <div class="flex items-center gap-3">
        <!-- 檔案圖示 -->
        <div class="file-icon flex items-center justify-center w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700">
          <component :is="headerIconComponent" :class="[iconClass, 'h-6 w-6']" />
        </div>

        <!-- 檔名和型別 -->
        <div class="flex-1 min-w-0">
          <h1 class="text-xl font-bold truncate text-gray-900 dark:text-white">
            {{ fileInfo.filename }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ formattedMimeType }} · {{ formattedSize }}</p>
        </div>
      </div>
    </div>

    <!-- 檔案備註 -->
    <div v-if="fileInfo.remark" class="file-remark mb-6 px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 overflow-auto max-h-[300px]">
      <p class="text-blue-600 dark:text-blue-400 break-words whitespace-pre-wrap">{{ fileInfo.remark }}</p>
    </div>

    <!--使用動態元件進行檔案預覽 -->
    <div
      v-if="shouldShowPreview"
      :class="['file-preview mb-6 flex flex-col min-h-0 w-full', previewKey === PREVIEW_KEYS.AUDIO ? '' : 'flex-grow']"
    >
      <!-- Iframe 預覽 -->
      <div
        ref="iframeContainerRef"
        v-if="previewKey === PREVIEW_KEYS.IFRAME"
        class="iframe-preview-container rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col flex-grow min-h-0"
      >
        <PreviewProviderHeader
          v-if="iframeProviderOptions.length > 1"
          :show-fullscreen="true"
          :fullscreen-target="iframeContainerRef"
          @fullscreen-change="handleIframeFullscreenChange"
          v-model="iframeProviderKey"
          :title="fileInfo.filename"
          :options="iframeProviderOptions"
        />
        <div class="flex-grow min-h-0">
          <component
            :is="currentPreviewComponent"
            v-bind="previewComponentProps"
            class="w-full h-full"
            @load="handlePreviewLoad"
            @error="handlePreviewError"
            @toggle-mode="handleToggleMode"
            @provider-options="handlePreviewProviderOptions"
          />
        </div>
      </div>

      <!-- 其他預覽型別：保持原有結構 -->
      <template v-else>
        <component
          :is="currentPreviewComponent"
          v-bind="previewComponentProps"
          :class="
            previewKey === PREVIEW_KEYS.AUDIO
              ? 'w-full max-w-3xl mx-auto'
              : previewKey === PREVIEW_KEYS.VIDEO
                ? 'w-full'
                : 'w-full h-full'
          "
          @load="handlePreviewLoad"
          @error="handlePreviewError"
          @toggle-mode="handleToggleMode"
          @provider-options="handlePreviewProviderOptions"
        />
      </template>
    </div>
    <!-- 當處於直鏈模式但當前儲存不具備直鏈預覽能力時，在原本內容區域顯示佔位提示 -->
    <div
      v-else-if="!fileInfo.use_proxy && !processedPreviewUrl"
      class="file-preview mb-6 flex-grow flex items-center justify-center"
    >
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t("fileView.preview.directNotSupported") }}
      </p>
    </div>

    <!-- EXIF 拍攝資訊 -->
    <div v-if="exifData" class="exif-compact mb-4 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <!-- 摺疊頭部：點選切換展開/收起 -->
      <button
        type="button"
        class="w-full p-3 flex items-center justify-between gap-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left"
        @click="exifExpanded = !exifExpanded"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <!-- 相機圖示 -->
          <IconCamera size="sm" class="text-gray-500 dark:text-gray-400 flex-shrink-0" />
          <!-- 摘要資訊 -->
          <span class="text-sm text-gray-800 dark:text-gray-200 truncate">
            {{ exifData.summary.camera || '拍攝資訊' }}
          </span>
          <!-- GPS 指示器 -->
          <span v-if="!exifExpanded && exifData.gpsCoords" class="flex-shrink-0">
            <IconLocationMarker class="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
          </span>
        </div>
        <!-- 展開/收起箭頭 -->
        <IconChevronDown
          size="sm"
          class="text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform duration-200"
          :class="{ 'rotate-180': exifExpanded }"
        />
      </button>

      <!-- 可摺疊內容區域 -->
      <transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="max-h-0 opacity-0"
        enter-to-class="max-h-[500px] opacity-100"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="max-h-[500px] opacity-100"
        leave-to-class="max-h-0 opacity-0"
      >
        <div v-show="exifExpanded" class="overflow-hidden">
          <div class="px-3 pb-3 space-y-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <!-- 拍攝引數 -->
            <div v-if="hasExifParams" class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-mono text-gray-600 dark:text-gray-400">
                {{ [exifParams.aperture, exifParams.shutter, exifParams.iso ? `ISO ${exifParams.iso}` : '', exifParams.focalLength].filter(Boolean).join(' · ') }}
              </span>
            </div>

            <!-- 時間 + 位置 -->
            <div v-if="exifData.summary.date || exifData.gpsCoords" class="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <!-- 時間 -->
              <div v-if="exifData.summary.date" class="flex items-center gap-1">
                <IconClock class="h-3.5 w-3.5" />
                <span>{{ exifData.summary.date }}</span>
              </div>
              <!-- 分隔 -->
              <span v-if="exifData.summary.date && exifData.gpsCoords" class="text-gray-300 dark:text-gray-600">|</span>
              <!-- 位置 -->
              <div v-if="exifData.gpsCoords" class="flex items-center gap-1">
                <IconLocationMarker class="h-3.5 w-3.5" />
                <span class="font-mono">{{ formattedGps }}</span>
                <!-- 地圖連結 -->
                <a :href="googleMapsUrl" target="_blank" rel="noopener noreferrer" class="ml-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" title="Google Maps" @click.stop>
                  <IconExternalLink size="sm" class="w-3.5 h-3.5" />
                </a>
                <a :href="amapUrl" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" title="高德地圖" @click.stop>
                  <IconExternalLink size="sm" class="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <!-- 地圖嵌入（僅展開時渲染） -->
            <div v-if="exifData.gpsCoords && !mapLoadError" class="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <MapEmbed
                :lat="exifData.gpsCoords.lat"
                :lng="exifData.gpsCoords.lng"
                :height="140"
                :interactive="true"
                :show-zoom-controls="true"
                @load="handleMapLoad"
                @error="handleMapError"
              />
            </div>
            <!-- 地圖載入失敗時的兜底 -->
            <div v-else-if="exifData.gpsCoords && mapLoadError" class="mt-2 p-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-center">
              <span class="text-xs text-gray-500 dark:text-gray-400">地圖載入失敗</span>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 檔案後設資料 -->
    <div class="file-metadata grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      <!-- 建立時間 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <IconCalendar size="md" class="mr-2 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.uploadTime") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">{{ formattedCreatedAt }}</p>
      </div>

      <!-- 訪問次數 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <IconEye size="md" class="mr-2 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.accessCount") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">
          {{ fileInfo.views || 0 }}
          <span v-if="fileInfo.max_views" class="text-xs text-gray-500 dark:text-gray-400"> / {{ fileInfo.max_views }} ({{ t("fileView.fileInfo.limit") }}) </span>
        </p>
      </div>

      <!-- 過期時間 -->
      <div v-if="fileInfo.expires_at" class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <IconClock size="md" class="mr-2 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.expiresAt") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">{{ formattedExpiresAt }}</p>
      </div>

      <!-- 訪問模式 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <IconShieldCheck size="md" class="mr-2 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.accessMode") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">
          <span :class="{ 'text-green-600 dark:text-green-400': fileInfo.use_proxy, 'text-blue-600 dark:text-blue-400': !fileInfo.use_proxy }">
            {{ fileInfo.use_proxy ? t("fileView.fileInfo.proxyAccess") : t("fileView.fileInfo.directAccess") }}
          </span>
        </p>
      </div>

      <!-- 檔案短連結 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <IconLink size="md" class="mr-2 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.fileLink") }}</span>
        </div>
        <div class="mt-1 pl-7 flex items-center relative">
          <p class="text-sm truncate flex-1 text-gray-800 dark:text-white">
            {{ shareUrl || t("fileView.fileInfo.needPassword") }}
          </p>
          <button
            v-if="shareUrl"
            @click="copyToClipboard(shareUrl)"
            class="ml-2 p-1 rounded hover:bg-opacity-80 transition-colors bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
            :title="t('fileView.fileInfo.copyLink')"
          >
            <IconCopy size="sm" class="h-4 w-4" />
          </button>

          <!-- 複製成功提示 -->
          <div
            v-if="showCopyToast"
            class="absolute right-0 -top-10 px-3 py-2 rounded-md shadow-md text-sm transition-opacity duration-300 bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 border border-gray-200 dark:border-gray-600"
          >
            <div class="flex items-center">
              <IconCheck size="sm" class="h-4 w-4 mr-1" />
              {{ t("fileView.fileInfo.linkCopied") }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { setFilePassword } from "@/utils/filePasswordUtils.js";
import { getFilePassword as resolveFilePassword } from "@/utils/filePasswordUtils.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { isImageLikeForExif, loadExifTagsFromArrayBufferAsync, buildExifRows, resolveGpsCoordinates } from "@/utils/exifReaderUtils.js";
import { IconBookOpen, IconCalendar, IconCamera, IconCheck, IconChevronDown, IconClock, IconCopy, IconDocumentText, IconExternalLink, IconEye, IconLink, IconLocationMarker, IconShieldCheck } from "@/components/icons";

const { t } = useI18n();
const fileshareService = useFileshareService();
const route = useRoute();
import { formatFileSize, getIconType } from "@/utils/fileTypes.js";
import { resolvePreviewSelection, PREVIEW_KEYS } from "@/composables/index.js";
import { formatDateTime } from "@/utils/timeUtils.js";
import { copyToClipboard as clipboardCopy } from "@/utils/clipboard";

//匯入預覽元件
import ImagePreview from "./previews/ImagePreview.vue";
import VideoPreview from "./previews/VideoPreview.vue";
import AudioPreview from "./previews/AudioPreview.vue";
import PdfPreview from "./previews/PdfPreview.vue";
import EpubPreview from "./previews/EpubPreview.vue";
import TextPreview from "./previews/TextPreview.vue";
import OfficeSharePreview from "./previews/OfficeSharePreview.vue";
import GenericPreview from "./previews/GenericPreview.vue";
import IframePreview from "@/components/common/IframePreview.vue";
import MapEmbed from "@/components/common/MapEmbed.vue";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";

const props = defineProps({
  fileInfo: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 分享連結 - 使用當前頁面的URL
const shareUrl = computed(() => {
  return window.location.href;
});

// 複製成功提示狀態
const showCopyToast = ref(false);

// EXIF 相關狀態
const exifData = ref(null); // { gpsCoords, summary, rows }
const exifExpanded = ref(false);
const mapLoadError = ref(false);

// 地圖事件處理
const handleMapLoad = () => {
  mapLoadError.value = false;
};

const handleMapError = () => {
  mapLoadError.value = true;
};
const showExifSection = computed(() => isImageLikeForExif({ ...props.fileInfo, name: props.fileInfo.filename }));

const getFilePassword = () => resolveFilePassword({ file: props.fileInfo });

// 處理預覽URL，統一透過 fileshareService 基於 Link JSON 構造
const processedPreviewUrl = computed(() => {
  return fileshareService.getPermanentPreviewUrl(props.fileInfo) || "";
});

const resolvedPreview = computed(() => resolvePreviewSelection({ file: props.fileInfo }));

const previewKey = computed(() => resolvedPreview.value.key);

// 格式化的檔案大小
const formattedSize = computed(() => {
  return typeof props.fileInfo.size === "number" ? formatFileSize(props.fileInfo.size) : "-";
});

// 格式化的MIME型別
const formattedMimeType = computed(() => {
  return props.fileInfo.mimetype || "";
});

// 格式化的建立時間
const formattedCreatedAt = computed(() => {
  return formatDateTime(props.fileInfo.created_at);
});

// 格式化的過期時間
const formattedExpiresAt = computed(() => {
  return formatDateTime(props.fileInfo.expires_at);
});

// 檔案資訊（直接使用後端type欄位）

const isOfficeFile = computed(() => previewKey.value === PREVIEW_KEYS.OFFICE);
const isImage = computed(() => previewKey.value === PREVIEW_KEYS.IMAGE);
const isVideo = computed(() => previewKey.value === PREVIEW_KEYS.VIDEO);
const isAudio = computed(() => previewKey.value === PREVIEW_KEYS.AUDIO);
const isPdf = computed(() => previewKey.value === PREVIEW_KEYS.PDF);
const isEpub = computed(() => previewKey.value === PREVIEW_KEYS.EPUB);
const isText = computed(() => previewKey.value === PREVIEW_KEYS.TEXT);

// Iframe 多渠道選擇
const iframeContainerRef = ref(null);
const iframeFullscreen = ref(false);
const iframeProviderOptions = ref([]);
const iframeProviderKey = ref("");

const handleIframeFullscreenChange = (val) => {
  iframeFullscreen.value = val;
};

const handlePreviewProviderOptions = (options) => {
  if (previewKey.value !== PREVIEW_KEYS.IFRAME) return;
  const normalized = Array.isArray(options) ? options : [];
  iframeProviderOptions.value = normalized;

  // 預設選擇第一個可用渠道；同時保證當前選擇仍然存在
  if (!normalized.length) {
    iframeProviderKey.value = "";
    return;
  }
  if (!iframeProviderKey.value || !normalized.some((opt) => opt.key === iframeProviderKey.value)) {
    iframeProviderKey.value = normalized[0]?.key || "";
  }
};

// 檔案圖示類名 - 使用標準的 getIconType 函式
const iconClass = computed(() => {
  const iconType = getIconType(props.fileInfo);
  // 根據檔案型別返回對應的圖示顏色類
  const colorMap = {
    image: "text-green-500",
    video: "text-purple-500",
    audio: "text-blue-500",
    text: "text-yellow-500",
    document: "text-red-500",
    book: "text-amber-500",
    folder: "text-blue-500",
    file: "text-gray-500",
  };
  return colorMap[iconType] || "text-gray-500";
});

// 分享頁頭部圖示：電子書用“書本”，其餘先保持原來的“文件”圖示（避免一次性改太多 UI）
const headerIconComponent = computed(() => {
  const iconType = getIconType(props.fileInfo);
  if (iconType === "book") return IconBookOpen;
  return IconDocumentText;
});

const currentPreviewComponent = computed(() => {
  const componentMap = {
    [PREVIEW_KEYS.IMAGE]: ImagePreview,
    [PREVIEW_KEYS.VIDEO]: VideoPreview,
    [PREVIEW_KEYS.AUDIO]: AudioPreview,
    [PREVIEW_KEYS.PDF]: PdfPreview,
    [PREVIEW_KEYS.EPUB]: EpubPreview,
    [PREVIEW_KEYS.TEXT]: TextPreview,
    [PREVIEW_KEYS.OFFICE]: OfficeSharePreview,
    [PREVIEW_KEYS.IFRAME]: IframePreview,
    [PREVIEW_KEYS.ARCHIVE]: GenericPreview,
    [PREVIEW_KEYS.DOWNLOAD]: GenericPreview,
  };

  return componentMap[previewKey.value] || GenericPreview;
});

// 是否應該顯示預覽
const shouldShowPreview = computed(() => {
  // 文字預覽不依賴 processedPreviewUrl（直鏈能力），只要識別為文字就應顯示並走 contentUrl
  if (isText.value) {
    return true;
  }
  return Boolean(processedPreviewUrl.value) || isOfficeFile.value;
});

// 注意：預覽能力檢查現在透過 shouldShowPreview 計算屬性處理


// 動態元件屬性配置
const previewComponentProps = computed(() => {
  const previewUrl = processedPreviewUrl.value;
  const baseProps = {
    filename: props.fileInfo.filename,
    mimetype: props.fileInfo.mimetype,
  };

  const effectiveSlug =
    props.fileInfo?.slug ||
    route.params?.slug ||
    route.params?.fileSlug ||
    "";
  const effectiveContentUrl = effectiveSlug
    ? fileshareService.getPermanentContentUrl({ ...props.fileInfo, slug: effectiveSlug })
    : "";

  // 文字預覽統一使用同一個元件：元件內部提供“文字/程式碼/Markdown/HTML”切換
  if (isText.value) {
    return {
      ...baseProps,
      contentUrl: effectiveContentUrl,
      darkMode: props.darkMode,
      loadingText: t("fileView.preview.text.loading"),
    };
  }

  if (previewKey.value === PREVIEW_KEYS.IFRAME) {
    return {
      providers: resolvedPreview.value.providers || {},
      selectedProvider: iframeProviderKey.value,
      darkMode: props.darkMode,
      loadingText: t("fileView.preview.loading"),
      errorText: t("fileView.preview.error"),
    };
  }

  // PDF檔案特殊處理：支援 DocumentApp 多渠道（如 pdfjs / 原生瀏覽器）
  if (isPdf.value) {
  const providers = resolvedPreview.value.providers || {};
  return {
    ...baseProps,
    previewUrl,
    providers,
    nativeUrl: previewUrl,
  };
  }

  // EPUB：支援 native（foliate-js 本地渲染）+ 外部 iframe 預覽器
  if (isEpub.value) {
    return {
      ...baseProps,
      providers: resolvedPreview.value.providers || {},
      previewUrl,
      nativeUrl: previewUrl,
      darkMode: props.darkMode,
    };
  }

  if (isOfficeFile.value) {
    return {
      providers: resolvedPreview.value.providers || {},
      filename: props.fileInfo.filename,
      downloadUrl: fileshareService.getPermanentDownloadUrl(props.fileInfo),
      contentUrl: effectiveContentUrl,
      darkMode: props.darkMode,
    };
  }

  // Image：統一多源預覽架構
  if (isImage.value) {
    return {
      ...baseProps,
      providers: resolvedPreview.value.providers || {},
      nativeUrl: previewUrl,
      previewUrl,
      darkMode: props.darkMode,
      // Live Photo 支援：videoUrl 需要從外部傳入（如果有配對的影片檔案）
      // 在單檔案分享場景中，通常不會有配對的影片檔案
      videoUrl: "",
    };
  }

  // Audio：統一多源預覽架構
  if (isAudio.value) {
    return {
      ...baseProps,
      providers: resolvedPreview.value.providers || {},
      nativeUrl: previewUrl,
      previewUrl,
      darkMode: props.darkMode,
    };
  }

  // Video：統一多源預覽架構
  if (isVideo.value) {
    return {
      ...baseProps,
      providers: resolvedPreview.value.providers || {},
      nativeUrl: previewUrl,
      previewUrl,
      linkType: props.fileInfo.linkType || null,
      darkMode: props.darkMode,
    };
  }

  return {
    iconClass: iconClass.value,
    filename: props.fileInfo.filename,
    mimetype: props.fileInfo.mimetype,
  };
});

// 動態元件事件處理
const handlePreviewLoad = () => undefined;
const handlePreviewError = () => undefined;
const handleToggleMode = () => undefined;



// 複製到剪貼簿函式
const copyToClipboard = async (text) => {
  try {
    const success = await clipboardCopy(text);

    if (success) {
      // 顯示覆製成功提示
      showCopyToast.value = true;
      // 3秒後自動隱藏提示
      setTimeout(() => {
        showCopyToast.value = false;
      }, 3000);
    } else {
      throw new Error("複製失敗");
    }
  } catch {
    // 複製失敗時保持靜默（後續如需更友好提示，再單獨做 UI 互動）
  }
};

// EXIF 解析邏輯
const parseExif = async () => {
  if (!showExifSection.value || !processedPreviewUrl.value) {
    exifData.value = null;
    return;
  }

  try {
    const url = processedPreviewUrl.value;
    // 跳過 blob/data URL
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      exifData.value = null;
      return;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct && ct.includes("text/html")) throw new Error("unexpected content-type");

    const buf = await res.arrayBuffer();
    const tags = await loadExifTagsFromArrayBufferAsync(buf);
    const gpsCoords = resolveGpsCoordinates(tags);
    const rows = buildExifRows(tags).filter((r) => r.key !== "location");

    // 構建緊湊摘要
    const summary = buildExifSummary(rows);
    const hasSummary = !!(summary.camera || summary.params || summary.date);
    const hasGps = !!gpsCoords;
    // 保留 rows 供 exifParams 使用
    exifData.value = hasSummary || hasGps ? { gpsCoords, summary, rows } : null;
  } catch {
    exifData.value = null;
  }
};

// 構建緊湊摘要文字
const buildExifSummary = (rows) => {
  const result = { camera: "", params: "", date: "" };
  const rowMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  // 相機 + 鏡頭
  const cameraParts = [rowMap.camera, rowMap.lensModel].filter(Boolean);
  result.camera = cameraParts.join(" · ");

  // 拍攝引數：光圈 · 快門 · ISO · 焦距
  const paramParts = [rowMap.aperture, rowMap.shutter, rowMap.iso, rowMap.focalLength].filter(Boolean);
  result.params = paramParts.join(" · ");

  // 拍攝時間
  result.date = rowMap.dateTimeOriginal || "";

  return result;
};

// 單獨的 EXIF 引數（用於網格展示）
const exifParams = computed(() => {
  if (!exifData.value?.rows) return {};
  const rowMap = Object.fromEntries(exifData.value.rows.map((r) => [r.key, r.value]));
  return {
    aperture: rowMap.aperture || "",
    shutter: rowMap.shutter || "",
    iso: rowMap.iso ? rowMap.iso.replace(/^ISO\s*/i, "") : "",
    focalLength: rowMap.focalLength || "",
  };
});

// 是否有任何 EXIF 引數
const hasExifParams = computed(() => {
  const p = exifParams.value;
  return !!(p.aperture || p.shutter || p.iso || p.focalLength);
});

// Google Maps URL
const googleMapsUrl = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const safeLat = Math.min(90, Math.max(-90, Number(lat) || 0));
  const safeLng = Math.min(180, Math.max(-180, Number(lng) || 0));
  const url = new URL("https://www.google.com/maps");
  url.searchParams.set("q", `${safeLat},${safeLng}`);
  return url.toString();
});

// 高德地圖 URL
const amapUrl = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const safeLat = Math.min(90, Math.max(-90, Number(lat) || 0));
  const safeLng = Math.min(180, Math.max(-180, Number(lng) || 0));
  const url = new URL("https://uri.amap.com/marker");
  url.searchParams.set("position", `${safeLng},${safeLat}`);
  url.searchParams.set("name", "拍攝位置");
  return url.toString();
});

// 格式化 GPS 座標顯示
const formattedGps = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}°${latDir} ${Math.abs(lng).toFixed(5)}°${lngDir}`;
});

// 確保密碼被儲存到會話儲存
const savePasswordToSessionStorage = () => {
  if (!props.fileInfo.slug) return;

  try {
    // 獲取潛在的密碼源
    let password = null;

    // 1. 首先檢查props.fileInfo.currentPassword
    if (props.fileInfo.currentPassword) {
      password = props.fileInfo.currentPassword;
    }
    // 2. 其次檢查URL中的密碼引數
    else {
      const currentUrl = new URL(window.location.href);
      const passwordParam = currentUrl.searchParams.get("password");
      if (passwordParam) {
        password = passwordParam;
      }
    }

    // 如果找到了密碼，儲存到會話儲存
    if (password) {
      setFilePassword(props.fileInfo.slug, password);
    }
  } catch {
    // ignore
  }
};

// Office 預覽初始化僅保留密碼快取邏輯
onMounted(() => {
  savePasswordToSessionStorage();
});

watch(
  () => processedPreviewUrl.value,
  () => {
    void parseExif();
  },
  { immediate: true },
);

// 元件解除安裝時清理資源
onUnmounted(() => {
  if (showCopyToast.value) {
    showCopyToast.value = false;
  }
});
</script>
