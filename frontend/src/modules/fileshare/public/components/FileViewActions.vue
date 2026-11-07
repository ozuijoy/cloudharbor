<template>
  <div class="file-actions flex flex-wrap gap-3">
    <!-- 預覽按鈕 -->
    <button
      v-if="hasPreviewUrl"
      @click="previewFile"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <IconEye size="md" class="mr-2" />
      <span>{{ t("fileView.actions.preview") }}</span>
    </button>

    <!-- 下載按鈕 -->
    <button
      v-if="hasDownloadUrl"
      @click="downloadFile"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <IconDownload size="md" class="mr-2" />
      <span>{{ t("fileView.actions.download") }}</span>
    </button>

    <!-- 編輯按鈕 (管理員可見所有檔案，API金鑰使用者只能看到自己的檔案) -->
    <button
      v-if="(isAdmin || (hasApiKey && hasFilePermission && isCreator)) && fileInfo.id"
      @click="$emit('edit')"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white focus:ring-gray-400 dark:focus:ring-gray-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <IconRename size="md" class="mr-2" />
      <span>{{ t("fileView.actions.edit") }}</span>
    </button>

    <!-- 分享按鈕 -->
    <button
      @click="openShareModal"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <IconShare size="md" class="mr-2" />
      <span>{{ t("fileView.actions.share") }}</span>
    </button>

    <!-- 刪除按鈕 (管理員可見所有檔案，API金鑰使用者只能看到自己的檔案) -->
    <button
      v-if="(isAdmin || (hasApiKey && hasFilePermission && isCreator)) && fileInfo.id"
      @click="confirmDelete"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <IconDelete size="md" class="mr-2" />
      <span>{{ t("fileView.actions.delete") }}</span>
    </button>

    <!-- 刪除確認模態框 -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div class="rounded-lg p-6 max-w-sm w-full shadow-xl bg-white dark:bg-gray-800">
        <h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-white">{{ t("fileView.actions.delete") }}</h3>
        <p class="mb-6 text-gray-600 dark:text-gray-300">
          {{ t("fileView.actions.deleteConfirm") }}
        </p>
        <div class="flex justify-end space-x-3">
          <button
            @click="showDeleteConfirm = false"
            class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white"
          >
            {{ t("common.cancel") }}
          </button>
          <button @click="deleteFile" class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-red-600 hover:bg-red-700 text-white" :disabled="deleting">
            {{ deleting ? t("fileView.actions.deleting") : t("common.confirm") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 複製成功提示 -->
    <div
      v-if="showCopyToast"
      class="fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center transition-opacity duration-200 bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 border border-gray-200 dark:border-gray-700"
    >
      <IconCheck size="md" class="mr-2" />
      <span>{{ t("fileView.fileInfo.linkCopied") }}</span>
    </div>

    <!-- 分享模態框 -->
    <ShareModal :visible="showShareModal" :file-info="fileInfo" :dark-mode="darkMode" @close="closeShareModal" />
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import ShareModal from "./ShareModal.vue";
import { useAuthStore } from "@/stores/authStore.js";
import { FileType } from "@/utils/fileTypes.js";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";
import { getFileErrorKey } from "@/api/services/fileGateway.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { IconCheck, IconDelete, IconDownload, IconEye, IconRename, IconShare } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("FileViewActions");

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

const emit = defineEmits(["edit", "delete", "refresh-file-info"]);

const fileshareService = useFileshareService();
const { showSuccess, showError } = useGlobalMessage();

// 使用認證Store
const authStore = useAuthStore();

// 從Store獲取許可權狀態的計算屬性
const isAdmin = computed(() => authStore.isAdmin);
const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
// 這裡的檔案許可權用於管理（編輯/刪除），對應後端 FILE_MANAGE 位
const hasFilePermission = computed(() => authStore.hasFileManagePermission);

// 刪除確認狀態
const showDeleteConfirm = ref(false);
const deleting = ref(false);

// 複製提示狀態
const showCopyToast = ref(false);

// 分享模態框狀態
const showShareModal = ref(false);

// 計算屬性：判斷當前使用者是否為檔案建立者
const isCreator = computed(() => authStore.isFileCreator(props.fileInfo));

// 預覽/下載可用性（統一基於 Link JSON + fileshareService）
const hasPreviewUrl = computed(() => !!fileshareService.getPermanentPreviewUrl(props.fileInfo));
const hasDownloadUrl = computed(() => !!fileshareService.getPermanentDownloadUrl(props.fileInfo));

/**
 * 預覽檔案
 * 在新視窗中開啟預覽連結，為Office檔案使用線上預覽服務
 */
const previewFile = async () => {
  if (!props.fileInfo) return;

  try {
    if (props.fileInfo.type === FileType.OFFICE) {
      const officePreviewUrl = await fileshareService.getOfficePreviewUrl(props.fileInfo, {
        provider: "microsoft",
      });

      if (!officePreviewUrl) {
        throw new Error(t("fileView.errors.serverError"));
      }

      window.open(officePreviewUrl, "_blank");
      return;
    }

    const previewUrl = fileshareService.getPermanentPreviewUrl(props.fileInfo);
    if (!previewUrl) {
      throw new Error(t("fileView.errors.serverError"));
    }

    window.open(previewUrl, "_blank");
  } catch (error) {
    log.error("預覽檔案失敗:", error);

    let message = error.message || t("fileView.errors.unknown");
    if (error.status) {
      const errorKey = getFileErrorKey(error.status);
      message = t(errorKey);
    }

    showError(`${t("fileView.actions.previewFailed")}: ${message}`);
  }
};

/**
 * 下載檔案
 * 透過建立隱藏的a元素並模擬點選下載檔案
 */
const downloadFile = () => {
  if (!props.fileInfo) return;

  try {
    const downloadUrl = fileshareService.getPermanentDownloadUrl(props.fileInfo);
    if (!downloadUrl) {
      throw new Error(t("fileView.errors.serverError"));
    }

    const fileName = props.fileInfo.filename || t("fileView.actions.downloadFile");
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  } catch (error) {
    log.error("下載檔案失敗:", error);
    const fallbackUrl = fileshareService.getPermanentDownloadUrl(props.fileInfo);
    if (fallbackUrl) {
      window.open(fallbackUrl, "_blank");
    }
    showError(`${t("fileView.actions.downloadFailed")}: ${error.message || t("fileView.errors.unknown")}`);
  }
};

/**
 * 開啟分享模態框
 */
const openShareModal = () => {
  showShareModal.value = true;
};

/**
 * 關閉分享模態框
 */
const closeShareModal = () => {
  showShareModal.value = false;
};

/**
 * 顯示刪除確認對話方塊
 */
const confirmDelete = () => {
  showDeleteConfirm.value = true;
};

/**
 * 刪除檔案
 */
const deleteFile = async () => {
  if (!props.fileInfo.id) return;

  deleting.value = true;

  try {
    // 使用統一的批次刪除 API
    if (isAdmin.value || (hasApiKey.value && hasFilePermission.value && isCreator.value)) {
      const deleteSettingsStore = useDeleteSettingsStore();
      const response = await fileshareService.deleteFiles([props.fileInfo.id], deleteSettingsStore.getDeleteMode());

      if (response?.data && response.data.failed && response.data.failed.length > 0) {
        const failedItem = response.data.failed[0];
        throw new Error(failedItem.error || "刪除失敗");
      }

      // 關閉確認對話方塊
      showDeleteConfirm.value = false;
      // 通知父元件檔案已刪除
      emit("delete", props.fileInfo.id);
    } else {
      throw new Error(t("fileView.actions.noPermission"));
    }
  } catch (err) {
    log.error("刪除檔案錯誤:", err);
      showError(`${t("fileView.actions.deleteFailed")}: ${err.message || t("fileView.errors.unknown")}`);
  } finally {
    deleting.value = false;
  }
};
</script>
