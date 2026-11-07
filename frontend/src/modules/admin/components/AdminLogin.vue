<script setup>
import { ref, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { ApiStatus } from "@/api/ApiStatus";
import { useAuthStore } from "@/stores/authStore.js";
import { createLogger } from "@/utils/logger.js";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(["login-success"]);
const { t } = useI18n();
const log = createLogger("AdminLogin");

// 使用認證Store
const authStore = useAuthStore();

const loading = ref(false);
const error = ref("");
const isApiKeyMode = ref(false);

const form = reactive({
  username: "",
  password: "",
});

const apiKeyForm = reactive({
  apiKey: "",
});

const toggleLoginMode = () => {
  isApiKeyMode.value = !isApiKeyMode.value;
  error.value = "";
};

const handleLogin = async () => {
  if (isApiKeyMode.value) {
    return handleApiKeyLogin();
  }

  if (!form.username || !form.password) {
    error.value = t("admin.login.inputRequired.usernamePassword");
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // 使用認證Store進行管理員登入
    const result = await authStore.adminLogin(form.username, form.password);

    // 登入成功，傳送事件給父元件
    emit("login-success", {
      token: result.data.token,
      type: "admin",
    });
  } catch (err) {
    log.error("管理員登入失敗:", err);
    // 優先使用HTTP狀態碼判斷錯誤型別，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - 使用者名稱或密碼錯誤
      error.value = t("admin.login.errors.invalidCredentials") || "使用者名稱或密碼錯誤";
    } else if (err.message && err.message.includes("認證失敗")) {
      // 特殊處理：如果錯誤訊息包含"認證失敗"，也顯示使用者名稱或密碼錯誤
      error.value = t("admin.login.errors.invalidCredentials") || "使用者名稱或密碼錯誤";
    } else {
      // 後備判斷：基於錯誤訊息內容判斷錯誤型別（保持相容性）
      error.value = err.message || t("admin.login.errors.loginFailed");
    }
  } finally {
    loading.value = false;
  }
};

const handleApiKeyLogin = async () => {
  if (!apiKeyForm.apiKey) {
    error.value = t("admin.login.inputRequired.apiKey");
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // 使用認證Store進行API金鑰登入
    const result = await authStore.apiKeyLogin(apiKeyForm.apiKey);

    // 登入成功，傳送事件給父元件
    emit("login-success", {
      apiKey: apiKeyForm.apiKey,
      permissions: result.data.permissions,
      keyInfo: result.data.key_info,
      type: "apikey",
    });
  } catch (err) {
    log.error("API金鑰驗證失敗:", err);
    // 優先使用HTTP狀態碼判斷錯誤型別，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - API金鑰無效
      error.value = t("admin.login.errors.invalidApiKey") || "API金鑰無效或未授權";
    } else if (err.status === ApiStatus.FORBIDDEN || err.response?.status === ApiStatus.FORBIDDEN || err.code === ApiStatus.FORBIDDEN) {
      // 403 Forbidden - 許可權不足
      error.value = t("admin.login.errors.insufficientPermissions") || "API金鑰許可權不足";
    } else if (err.message && err.message.includes("認證失敗")) {
      // 特殊處理：如果錯誤訊息包含"認證失敗"，顯示API金鑰無效
      error.value = t("admin.login.errors.invalidApiKey") || "API金鑰無效或未授權";
    } else {
      // 後備判斷：基於錯誤訊息內容判斷錯誤型別（保持相容性）
      error.value = err.message || t("admin.login.errors.keyValidationFailed");
    }
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-sm rounded-lg p-6 shadow-md" :class="[darkMode ? 'bg-gray-800 shadow-gray-700/20' : 'bg-white shadow-gray-200/70']">
      <div class="sm:mx-auto sm:w-full sm:max-w-sm">
        <h2 class="mt-4 text-center text-2xl font-bold leading-9 tracking-tight" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ isApiKeyMode ? $t("admin.login.apiKeyAuth") : $t("admin.login.adminLogin") }}
        </h2>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-sm">
        <form v-if="isApiKeyMode" class="space-y-6" @submit.prevent="handleLogin">
          <div>
            <label for="apiKey" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.apiKey") }}</label>
            <div class="mt-2">
              <input id="apiKey" v-model="apiKeyForm.apiKey" name="apiKey" type="text" required class="form-input" />
            </div>
          </div>

          <div v-if="error" class="rounded-md p-4" :class="darkMode ? 'bg-red-900/30' : 'bg-red-50'">
            <div class="flex">
              <div class="text-sm" :class="darkMode ? 'text-red-200' : 'text-red-700'">
                {{ error }}
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              :disabled="loading"
              :class="[
                'flex w-full justify-center rounded-md px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-500',
                darkMode ? 'bg-primary-600 focus-visible:outline-primary-500' : 'bg-primary-600 focus-visible:outline-primary-600',
              ]"
            >
              <span v-if="loading">{{ t("common.loading") }}</span>
              <span v-else>{{ t("common.confirm") }}</span>
            </button>
          </div>
        </form>

        <form v-else class="space-y-6" @submit.prevent="handleLogin">
          <div>
            <label for="username" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.username") }}</label>
            <div class="mt-2">
              <input id="username" v-model="form.username" name="username" type="text" required class="form-input" />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <label for="password" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.password") }}</label>
            </div>
            <div class="mt-2">
              <input id="password" v-model="form.password" name="password" type="password" autocomplete="current-password" required class="form-input" />
            </div>
          </div>

          <div v-if="error" class="rounded-md p-4" :class="darkMode ? 'bg-red-900/30' : 'bg-red-50'">
            <div class="flex">
              <div class="text-sm" :class="darkMode ? 'text-red-200' : 'text-red-700'">
                {{ error }}
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              :disabled="loading"
              :class="[
                'flex w-full justify-center rounded-md px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-500',
                darkMode ? 'bg-primary-600 focus-visible:outline-primary-500' : 'bg-primary-600 focus-visible:outline-primary-600',
              ]"
            >
              <span v-if="loading">{{ $t("admin.login.loggingIn") }}</span>
              <span v-else>{{ $t("admin.login.loginButton") }}</span>
            </button>
          </div>
        </form>

        <div class="mt-6 text-center">
          <button
            @click="toggleLoginMode"
            class="text-sm transition-colors duration-200"
            :class="darkMode ? 'text-primary-400 hover:text-primary-300' : 'text-primary-600 hover:text-primary-500'"
          >
            {{ isApiKeyMode ? $t("admin.login.useAdminAccount") : $t("admin.login.useApiKey") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
