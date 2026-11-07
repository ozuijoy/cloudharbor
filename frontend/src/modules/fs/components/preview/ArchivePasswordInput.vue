<template>
  <div class="archive-password-container p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
    <div class="text-center mb-6">
      <!-- 鎖圖示 -->
      <div class="mx-auto w-16 h-16 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center mb-4">
        <IconLockClosed size="xl" class="text-yellow-600 dark:text-yellow-400" aria-hidden="true" />
      </div>

      <h3 class="text-lg font-semibold mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">壓縮檔案已加密</h3>
      <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">請輸入密碼以解壓檔案內容</p>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <!-- 密碼輸入框 -->
      <div>
        <label for="archive-password" class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'"> 密碼 </label>
        <div class="relative">
          <input
            :type="showPassword ? 'text' : 'password'"
            id="archive-password"
            autocomplete="current-password"
            v-model="passwordInput"
            placeholder="請輸入解壓密碼"
            class="block w-full px-3 py-2 pr-10 rounded-md shadow-sm border focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            :class="[
              darkMode ? 'bg-gray-700 border-gray-600 text-white focus:ring-offset-gray-800' : 'border-gray-300 text-gray-900 focus:ring-offset-white',
              passwordError ? 'border-red-500' : '',
            ]"
            :disabled="isValidating"
            ref="passwordInputRef"
          />
          <!-- 密碼可見性切換按鈕 -->
          <button type="button" @click="togglePasswordVisibility" class="absolute inset-y-0 right-0 pr-3 flex items-center" :disabled="isValidating">
            <IconEye
              v-if="!showPassword"
              :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
              aria-hidden="true"
            />
            <IconEyeOff
              v-else
              :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
              aria-hidden="true"
            />
          </button>
        </div>

        <!-- 錯誤提示 -->
        <div v-if="passwordError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ passwordError }}
        </div>
      </div>

      <!-- 操作按鈕 -->
      <div class="flex space-x-3 pt-4">
        <button
          type="submit"
          :disabled="!passwordInput || isValidating"
          class="flex-1 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          :class="darkMode ? 'focus:ring-offset-gray-800' : 'focus:ring-offset-white'"
        >
          <span v-if="!isValidating">確認</span>
          <span v-else class="flex items-center justify-center">
            <IconRefresh size="sm" class="animate-spin -ml-1 mr-2 text-white" aria-hidden="true" />
            驗證中...
          </span>
        </button>

        <button
          type="button"
          @click="handleCancel"
          :disabled="isValidating"
          class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors"
          :class="[darkMode ? 'text-gray-300 hover:bg-gray-700 focus:ring-offset-gray-800' : 'text-gray-700 hover:bg-gray-50 focus:ring-offset-white']"
        >
          取消
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from "vue";
import { IconEye, IconEyeOff, IconLockClosed, IconRefresh } from "@/components/icons";

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  passwordError: {
    type: String,
    default: "",
  },
  isValidating: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["submit", "cancel"]);

// 響應式資料
const passwordInput = ref("");
const showPassword = ref(false);
const passwordInputRef = ref(null);

// 切換密碼可見性
const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

// 提交密碼
const handleSubmit = () => {
  if (passwordInput.value && !props.isValidating) {
    emit("submit", passwordInput.value);
  }
};

// 取消操作
const handleCancel = () => {
  emit("cancel");
};

// 元件掛載後自動聚焦
onMounted(async () => {
  await nextTick();
  if (passwordInputRef.value) {
    passwordInputRef.value.focus();
  }
});
</script>

<style scoped>
/* 自定義樣式 */
.archive-password-container {
  max-width: 400px;
  margin: 0 auto;
}
</style>
