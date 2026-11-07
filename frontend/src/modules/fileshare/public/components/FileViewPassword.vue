<template>
  <div class="max-w-sm w-full mx-auto p-5 border rounded-lg shadow-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
    <h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-white">{{ t("fileView.password.title") }}</h3>
    <p class="mb-4 text-sm text-gray-600 dark:text-gray-300">{{ t("fileView.password.description") }}</p>

    <form @submit.prevent="verifyPassword" class="space-y-4">
      <!-- 密碼輸入框 -->
      <div>
        <label for="password" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{{ t("fileView.password.label") }}</label>
        <div class="relative">
          <input
            :type="showPassword ? 'text' : 'password'"
            id="password"
            autocomplete="current-password"
            v-model="password"
            :placeholder="t('fileView.password.placeholder')"
            class="block w-full px-3 py-2 rounded-md shadow-sm border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:focus:ring-offset-gray-800 password-input"
            :disabled="loading"
          />
          <button
            type="button"
            @click="togglePasswordVisibility"
            class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
          >
            <IconEyeOff v-if="showPassword" size="md" class="h-5 w-5" />
            <IconEye v-else size="md" class="h-5 w-5" />
          </button>
        </div>
        <!-- 錯誤提示 -->
        <p v-if="error" class="mt-2 text-sm text-red-500 dark:text-red-400">{{ error }}</p>
      </div>

      <!-- 提交按鈕 -->
      <button
        type="submit"
        class="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-offset-gray-800"
        :disabled="loading || !password"
      >
        <span v-if="loading">
          <IconRefresh class="animate-spin h-5 w-5 mr-2 inline-block" />
          {{ t("fileView.password.loading") }}
        </span>
        <span v-else>{{ t("fileView.password.submit") }}</span>
      </button>
    </form>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { ApiStatus } from "@/api/ApiStatus"; // 匯入API狀態碼常量
import { IconEye, IconEyeOff, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const fileshareService = useFileshareService();
const log = createLogger("FileViewPassword");

const props = defineProps({
  fileId: {
    type: String,
    required: true,
  },
  appUrl: {
    type: String,
    required: false, // 不再需要appUrl
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  fileThumbnail: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["verified"]);

const password = ref("");
const loading = ref(false);
const error = ref("");
const showPassword = ref(false);

// 切換密碼可見性
const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

// 驗證密碼
const verifyPassword = async () => {
  if (!password.value) return;

  loading.value = true;
  error.value = "";

  try {
    // 透過 fileshareService 驗證檔案密碼
    // 約定：成功時返回領域資料物件，失敗時丟擲 Error
    const data = await fileshareService.verifyFilePassword(props.fileId, password.value);

    // 密碼驗證成功，將使用者輸入的密碼與API返回的資料一起傳遞給父元件
    emit("verified", {
      ...(data || {}),
      currentPassword: password.value, // 傳遞當前輸入的密碼，用於後續操作
    });
  } catch (err) {
    log.error("驗證密碼時出錯:", err);
    // 優先使用HTTP狀態碼判斷錯誤型別，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - 密碼錯誤
      error.value = "密碼錯誤，請重新輸入";
    } else if (err.status === ApiStatus.GONE || err.response?.status === ApiStatus.GONE || err.code === ApiStatus.GONE) {
      // 410 Gone - 資源已過期
      error.value = "此檔案已過期或不可訪問";
    } else if (err.status === ApiStatus.NOT_FOUND || err.response?.status === ApiStatus.NOT_FOUND || err.code === ApiStatus.NOT_FOUND) {
      // 404 Not Found - 資源不存在
      error.value = "此檔案不存在或已被刪除";
    } else {
      // 根據錯誤訊息內容精確對映到文案
      const msg = err.message || "";
      if (msg.includes("密碼不正確") || msg.includes("密碼錯誤")) {
        error.value = t("fileView.password.error");
      } else if (msg.includes("已過期") || msg.includes("達到最大檢視次數") || msg.includes("410")) {
        error.value = "此檔案已過期或不可訪問";
      } else if (msg.includes("不存在") || msg.includes("已被刪除") || msg.includes("404")) {
        error.value = "此檔案不存在或已被刪除";
      } else {
        error.value = msg || t("fileView.errors.unknown");
      }
    }
  } finally {
    loading.value = false;
  }
};

// 清除表單
watch(
  () => props.fileId,
  () => {
    password.value = "";
    error.value = "";
    loading.value = false;
  }
);
</script>

<style>
/* 隱藏密碼框的瀏覽器自帶眼睛圖示 */
.password-input::-ms-reveal,
.password-input::-ms-clear {
  display: none !important;
}

/* 確保表單不會自動填充 */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  transition: background-color 5000s ease-in-out 0s;
}
</style>
