<script setup>
import { ref, onMounted } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { API_BASE_URL, getEnvironmentInfo } from "../api/config";
import { createLogger } from "@/utils/logger.js";

// 預設環境配置
const environments = [
  { name: "本地開發", url: "http://localhost:8787" },
  { name: "開發Worker", url: "https://cloudharbor-backend.開發環境域名.workers.dev" },
  { name: "測試Worker", url: "https://cloudharbor-backend.xxxx.workers.dev" },
  { name: "生產Worker", url: "https://api.你的生產域名.com" },
];

// 新增自定義環境選項
const customUrl = ref("");
const showCustomInput = ref(false);

// 當前環境URL
const currentEnv = ref(API_BASE_URL);
const storedApiBaseUrl = useLocalStorage("vite-api-base-url", API_BASE_URL);
const log = createLogger("EnvSwitcher");

// 初始化時檢查是否是自定義環境
onMounted(() => {
  // 如果當前環境不在預設列表中，則認為是自定義環境
  const isCustomEnv = !environments.some((env) => env.url === API_BASE_URL);
  if (isCustomEnv && API_BASE_URL) {
    customUrl.value = API_BASE_URL;
    showCustomInput.value = true;
  }

  // 輸出當前環境資訊
  log.debug("當前API環境:", getEnvironmentInfo());
});

// 切換環境
const switchEnvironment = (url) => {
  // 儲存選擇的環境URL到本地儲存
  storedApiBaseUrl.value = url;
  currentEnv.value = url;

  // 重新整理頁面以應用新環境
  window.location.reload();
};

// 切換到自定義環境
const toggleCustomEnv = () => {
  showCustomInput.value = !showCustomInput.value;
  if (!showCustomInput.value) {
    customUrl.value = "";
  }
};

// 應用自定義環境
const applyCustomEnv = () => {
  if (customUrl.value.trim()) {
    switchEnvironment(customUrl.value.trim());
  }
};
</script>

<template>
  <div class="env-switcher p-2 rounded-lg" :class="{ 'bg-gray-100 dark:bg-gray-800': true }">
    <div class="flex flex-col space-y-2">
      <p class="text-xs font-medium text-gray-600 dark:text-gray-300">API環境切換</p>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="env in environments"
          :key="env.url"
          @click="switchEnvironment(env.url)"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="[currentEnv === env.url ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600']"
        >
          {{ env.name }}
        </button>

        <button
          @click="toggleCustomEnv"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="[showCustomInput ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600']"
        >
          自定義
        </button>
      </div>

      <div v-if="showCustomInput" class="flex items-center space-x-2">
        <input
          v-model="customUrl"
          type="text"
          placeholder="輸入API基礎URL"
          class="flex-1 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <button @click="applyCustomEnv" class="px-2 py-1 text-xs bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors">應用</button>
      </div>

      <div class="text-xs text-gray-500 dark:text-gray-400">當前: {{ currentEnv }}</div>
    </div>
  </div>
</template>

<style scoped>
.env-switcher {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-width: 300px;
}
</style>
