<template>
  <div class="file-view-container flex flex-col flex-1 pt-6 sm:pt-8">
    <!-- 新增麵包屑導航標題，與文字分享頁面風格一致 -->
    <div class="max-w-6xl mx-auto w-full px-3 sm:px-6">
      <div class="py-3 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 mb-4">
        <a href="/" class="hover:text-primary-600 dark:hover:text-primary-400">{{ t("nav.home") }}</a>
        <span class="mx-2">/</span>
        <span class="text-gray-700 dark:text-gray-300">{{ t("fileView.title") }}</span>
      </div>
    </div>

    <div v-if="error" class="error-container py-12 px-3 sm:px-6 max-w-6xl mx-auto text-center">
      <IconExclamation class="h-16 w-16 mx-auto mb-4 text-red-600 dark:text-red-500" />
      <h2 class="text-2xl font-bold mb-2 text-gray-900 dark:text-white">{{ t("fileView.error") }}</h2>
      <p class="text-lg mb-6 text-gray-600 dark:text-gray-300">{{ error }}</p>
      <a
        href="/"
        class="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700"
      >
        {{ t("common.back") }}
      </a>
    </div>

    <!-- 刪除成功提示 -->
    <div v-else-if="showDeleteSuccess" class="success-container py-12 px-3 sm:px-6 max-w-6xl mx-auto text-center">
      <IconCheck class="h-16 w-16 mx-auto mb-4 text-green-600 dark:text-green-500" />
      <h2 class="text-2xl font-bold mb-2 text-gray-900 dark:text-white">{{ t("fileView.actions.deleteSuccess") }}</h2>
      <p class="text-lg mb-6 text-gray-600 dark:text-gray-300">{{ t("fileView.actions.redirectMessage") }}</p>
      <div class="animate-pulse text-gray-500 dark:text-gray-400">{{ redirectCountdown }} {{ t("fileView.actions.redirecting") }}</div>
    </div>

    <div v-else-if="loading" class="loading-container py-12 px-3 sm:px-6 max-w-6xl mx-auto text-center">
      <LoadingIndicator
        :text="t('fileView.loading')"
        :dark-mode="darkMode"
        size="4xl"
        :icon-class="darkMode ? 'text-blue-400' : 'text-blue-600'"
        :text-class="darkMode ? 'text-gray-300' : 'text-gray-600'"
      />
    </div>

    <div v-else class="file-container flex-1 flex flex-col py-8 px-4 max-w-4xl mx-auto w-full">
      <!-- 密碼驗證介面 -->
      <div v-if="requiresPassword" class="password-container flex-1 flex items-start justify-center pt-8">
        <FileViewPassword :fileId="fileInfo.slug" @verified="handlePasswordVerified" />
      </div>

      <!-- 檔案資訊和操作介面 -->
      <div v-else class="file-content flex flex-col flex-1">
        <!-- 檔案資訊 -->
        <FileViewInfo :fileInfo="fileInfo" :darkMode="darkMode" />

        <!-- 檔案操作按鈕 -->
        <FileViewActions :fileInfo="fileInfo" :darkMode="darkMode" @edit="openEditModal" @delete="handleFileDeleted" @refresh-file-info="refreshFileInfo" />
      </div>

      <!-- 編輯模態框 (僅管理員可見) -->
      <FileEditModal v-if="showEditModal" :file="fileInfo" @close="closeEditModal" @save="saveFileChanges" />
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { useFileShareStore } from "@/modules/fileshare/fileShareStore.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { setFilePassword } from "@/utils/filePasswordUtils.js";
import { createLogger } from "@/utils/logger.js";
import { IconCheck, IconExclamation } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

const { t } = useI18n();
const log = createLogger("FileView");
const fileshareService = useFileshareService();
const fileShareStore = useFileShareStore();
const { showError, showSuccess } = useGlobalMessage();

// 匯入子元件
import FileViewInfo from "@/modules/fileshare/public/components/FileViewInfo.vue";
import FileViewPassword from "@/modules/fileshare/public/components/FileViewPassword.vue";
import FileViewActions from "@/modules/fileshare/public/components/FileViewActions.vue";
import FileEditModal from "@/components/file/FileEditModal.vue";

const props = defineProps({
  slug: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const router = useRouter();
const route = useRoute();

// 狀態變數
const slug = ref(props.slug);
const fileInfo = ref({});
const loading = ref(true);
const error = ref("");
const requiresPassword = ref(false);
const showEditModal = ref(false);

// 刪除成功狀態
const showDeleteSuccess = ref(false);
const redirectCountdown = ref(3);
const { pause: stopRedirectCountdown, resume: startRedirectCountdown } = useIntervalFn(
  () => {
    redirectCountdown.value--;
    if (redirectCountdown.value <= 0) {
      stopRedirectCountdown();
      window.location.href = "/";
    }
  },
  1000,
  { immediate: false }
);

// 使用認證Store
const authStore = useAuthStore();

// 從Store獲取許可權狀態的計算屬性
const isAdmin = computed(() => authStore.isAdmin);

/**
 * 重新載入檔案資訊
 * 當預簽名URL過期時，可以呼叫此方法重新整理獲取新的URL
 */
const refreshFileInfo = async () => {
  // 如果檔案已透過密碼驗證，記錄當前密碼以便在重新整理後使用
  if (fileInfo.value && fileInfo.value.passwordVerified && fileInfo.value.currentPassword) {
    try {
      // 確保當前密碼被儲存到會話儲存
      setFilePassword(fileInfo.value.slug, fileInfo.value.currentPassword);
    } catch (err) {
      log.error("無法儲存密碼到會話儲存:", err);
    }
  }

  // 重新載入檔案資訊
  await loadFileInfo(true);
};

/**
 * 載入檔案資訊
 */
const loadFileInfo = async (force = false) => {
  loading.value = true;
  error.value = "";

  try {
    const fileSlug = slug.value;
    if (!fileSlug) {
      error.value = t("fileView.errors.missingSlug");
      loading.value = false;
      return;
    }

    // force=true 時跳過快取，確保拿到最新資料
    const data = await fileShareStore.fetchBySlug(fileSlug, { useCache: !force });

    fileInfo.value = {
      ...data,
      slug: fileSlug,
    };

    requiresPassword.value = !!data.requires_password;
  } catch (err) {
    log.error("載入檔案資訊失敗:", err);
    error.value = err.message || t("fileView.errors.loadFailed");
  } finally {
    loading.value = false;
  }
};


/**
 * 處理密碼驗證成功事件
 * @param {Object} data - 包含檔案URLs和資訊的物件
 */
const handlePasswordVerified = (data) => {
  const updated = {
    ...fileInfo.value,
    ...data,
    passwordVerified: true,
    currentPassword: data.currentPassword,
  };

  fileInfo.value = updated;

  if (data.currentPassword) {
    try {
      setFilePassword(fileInfo.value.slug, data.currentPassword);
    } catch (err) {
      log.error("無法儲存密碼到會話儲存:", err);
    }
  }

  requiresPassword.value = false;

  // 更新快取中的檔案資訊，保持 admin/public 檢視一致
  fileShareStore.updateCachedFile(updated);
};

/**
 * 開啟編輯模態框
 */
const openEditModal = async () => {
  try {
    // 只有當檔案有ID時才嘗試獲取詳情
    if (fileInfo.value.id) {
      const prev = fileInfo.value;
      const detail = await fileShareStore.fetchById(fileInfo.value.id, { useCache: false });
      // 合併資料時，只保留執行時狀態欄位，不保留可編輯欄位
      fileInfo.value = {
        ...detail,
        // 保留執行時狀態欄位
        slug: prev.slug,
        type: prev.type,
        requires_password: prev.requires_password,
        passwordVerified: prev.passwordVerified,
        currentPassword: prev.currentPassword,
        // 移除 use_proxy 的舊值保留，使用從後端獲取的最新值
        previewUrl: prev.previewUrl,
        downloadUrl: prev.downloadUrl,
        linkType: prev.linkType,
        previewSelection: prev.previewSelection,
      };
    }

    // 顯示編輯模態框
    showEditModal.value = true;
  } catch (err) {
    log.error("獲取檔案詳情出錯:", err);
    showError(`${t("fileView.errors.getDetailsFailed")}: ${t("fileView.errors.getDetailsFailedMessage")}`);
    showEditModal.value = true;
  }
};

/**
 * 關閉編輯模態框
 */
const closeEditModal = () => {
  showEditModal.value = false;
};

/**
 * 儲存檔案修改
 * @param {Object} updatedFile - 更新後的檔案資訊
 */
const saveFileChanges = async (updatedFile) => {
  try {
    if (!updatedFile?.id) {
      showError(`${t("fileView.errors.updateFailed")}: ${t("fileView.errors.missingId")}`);
      return;
    }

    // 使用 fileshareService 統一更新檔案後設資料
    const result = await fileshareService.updateFileMetadata(updatedFile.id, updatedFile);
    const updatedSlug = result && typeof result === "object" && result.slug ? result.slug : fileInfo.value.slug;
    const slugChanged = updatedSlug && updatedSlug !== fileInfo.value.slug;

    if (slugChanged) {
      slug.value = updatedSlug;
    }

    // 更新成功，重新載入檔案資訊並關閉彈窗（強制重新整理，避免使用舊快取）
    await loadFileInfo(true);
    if (slugChanged) {
      try {
        await router.replace({
          name: "FileView",
          params: { slug: updatedSlug },
          query: route.query,
          hash: route.hash,
        });
      } catch (replaceError) {
        log.warn("跳轉新連結失敗", replaceError);
      }
    }
    closeEditModal();
    showSuccess(t("fileView.actions.updateSuccess"));
  } catch (err) {
    log.error("更新檔案錯誤:", err);
    const msg = err?.message || t("fileView.errors.unknown");
    showError(`${t("fileView.errors.updateFailed")}: ${msg}`);
  }
};

/**
 * 處理檔案刪除事件
 */
const handleFileDeleted = () => {
  // 顯示刪除成功提示
  showDeleteSuccess.value = true;

  // 開始倒計時
  redirectCountdown.value = 3;

  stopRedirectCountdown();
  startRedirectCountdown();
};

// 元件掛載時載入檔案資訊
onMounted(() => {
  loadFileInfo();
});

// 元件解除安裝時清除計時器
onUnmounted(() => {
  stopRedirectCountdown();
});

watch(
  () => props.slug,
  (newSlug) => {
    if (newSlug && newSlug !== slug.value) {
      slug.value = newSlug;
      loadFileInfo(true);
    }
  }
);
</script>
