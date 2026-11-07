<template>
  <div v-if="!hasPermission" class="permission-warning">
    <div
      class="mb-4 p-3 rounded-md border"
      :class="
        isApiKeyUserWithoutPermission
          ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700/50 dark:text-red-200'
          : 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700/50 dark:text-yellow-200'
      "
    >
      <div class="flex items-center">
        <component
          :is="isApiKeyUserWithoutPermission ? IconExclamation : IconInformationCircle"
          size="md"
          class="mr-2"
          aria-hidden="true"
        />
        <span v-if="isApiKeyUserWithoutPermission">
          {{ $t("common.noPermission") }}
        </span>
        <span v-else>
          {{ permissionRequiredText }}
          <a href="#" @click.prevent="navigateToAdmin" class="font-medium underline">{{ loginAuthText }}</a
          >。
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useEventListener } from "@vueuse/core";
import { useAuthStore } from "@/stores/authStore.js";
import { IconExclamation, IconInformationCircle } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  permissionType: {
    type: String,
    default: "text", // text, file, mount
  },
  permissionRequiredText: {
    type: String,
    default: "",
  },
  loginAuthText: {
    type: String,
    default: "",
  },
});

// Emits
const emit = defineEmits(["permission-change", "navigate-to-admin"]);

// 使用認證Store
const authStore = useAuthStore();
const log = createLogger("PermissionManager");

// 從Store獲取許可權狀態的計算屬性
const isAdmin = computed(() => authStore.isAdmin);
const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
const hasTextPermission = computed(() => authStore.hasTextSharePermission);
const hasFilePermission = computed(() => authStore.hasFileSharePermission);
const hasMountPermission = computed(() => authStore.hasMountPermission);

// 根據許可權型別動態計算許可權狀態
const hasPermission = computed(() => {
  switch (props.permissionType) {
    case "file":
      return authStore.hasFileSharePermission;
    case "mount":
      return authStore.hasMountPermission;
    case "text":
    default:
      return authStore.hasTextSharePermission;
  }
});

// 判斷是否為已登入但無許可權的API金鑰使用者
const isApiKeyUserWithoutPermission = computed(() => {
  return authStore.isAuthenticated && authStore.isKeyUser && !hasPermission.value;
});

// 檢查使用者許可權狀態（簡化版，主要用於觸發事件）
const checkPermissionStatus = async () => {
  log.debug("檢查使用者許可權狀態...");

  // 如果需要重新驗證，則進行驗證
  if (authStore.needsRevalidation) {
    log.debug("需要重新驗證認證狀態");
    await authStore.validateAuth();
  }

  log.debug("使用者許可權:", hasPermission.value ? "有許可權" : "無許可權");
  emit("permission-change", hasPermission.value);
};


// 導航到管理員登入頁面
const navigateToAdmin = () => {
  emit("navigate-to-admin");
};

// 事件處理函式
const handleAuthStateChange = async (e) => {
  log.debug("接收到認證狀態變化事件:", e.detail);
  emit("permission-change", hasPermission.value);
};

// 元件掛載
onMounted(async () => {
  await checkPermissionStatus();

  // 監聽認證狀態變化事件
  useEventListener(window, "auth-state-changed", handleAuthStateChange);
});


// 暴露方法和狀態
defineExpose({
  hasPermission,
  isAdmin,
  hasApiKey,
  hasTextPermission,
  hasFilePermission,
  hasMountPermission,
  isApiKeyUserWithoutPermission,
  checkPermissionStatus,
});
</script>

<style scoped>
.permission-warning {
  margin-bottom: 1rem;
}
</style>
