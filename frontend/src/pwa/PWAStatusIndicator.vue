<!--
  PWA 狀態指示器元件
  顯示完整的PWA狀態資訊
-->
<template>
  <div class="pwa-status-indicator">
    <!-- 主狀態指示器 -->
    <div v-if="showIndicator" :class="indicatorClasses" @click="toggleDetails" :title="statusText">
      <div class="flex items-center space-x-2">
        <!-- 狀態圖示 -->
        <component :is="statusIcon" size="sm" />

        <!-- 狀態文字 -->
        <span v-if="showText" class="text-sm font-medium">
          {{ statusText }}
        </span>

        <!-- 更新進度 -->
        <IconRefresh v-if="pwaState.isUpdating" class="animate-spin w-4 h-4" aria-hidden="true" />
      </div>
    </div>

    <!-- 詳細狀態面板 -->
    <Transition name="slide-down">
      <div v-if="showDetails" class="pwa-details-panel">
        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 mt-2">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {{ t("pwa.status.title") }}
          </h3>

          <!-- 狀態網格 -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <!-- 網路狀態 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.networkStatus") }}:</span>
              <span :class="pwaState.isOffline ? 'text-red-500' : 'text-green-500'">
                {{ pwaState.isOffline ? t("pwa.network.offline") : t("pwa.network.online") }}
              </span>
            </div>

            <!-- 安裝狀態 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.installStatus") }}:</span>
              <span :class="pwaState.isInstalled ? 'text-green-500' : 'text-gray-500'">
                {{ pwaState.isInstalled ? t("pwa.install.installed") : t("pwa.install.notInstalled") }}
              </span>
            </div>

            <!-- Service Worker 狀態 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.serviceWorker") }}:</span>
              <span :class="swStateColor">
                {{ swStateText }}
              </span>
            </div>

            <!-- 更新狀態 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.updateStatus") }}:</span>
              <span :class="pwaState.isUpdateAvailable ? 'text-orange-500' : 'text-green-500'">
                {{ pwaState.isUpdateAvailable ? t("pwa.update.available") : t("pwa.update.latest") }}
              </span>
            </div>

            <!-- 通知許可權 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.notificationPermission") }}:</span>
              <span :class="notificationPermissionColor">
                {{ notificationPermissionText }}
              </span>
            </div>

            <!-- 後臺同步 -->
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.backgroundSync") }}:</span>
              <span :class="pwaState.backgroundSyncSupported ? 'text-green-500' : 'text-gray-500'">
                {{ pwaState.backgroundSyncSupported ? t("pwa.backgroundSync.supported") : t("pwa.backgroundSync.notSupported") }}
              </span>
            </div>

            <!-- 版本資訊 -->
            <div class="flex justify-between col-span-2">
              <span class="text-gray-600 dark:text-gray-400">{{ t("pwa.labels.appVersion") }}:</span>
              <span class="text-gray-900 dark:text-white font-mono">
                {{ pwaState.version }}
              </span>
            </div>
          </div>

          <!-- 操作按鈕 -->
          <div class="flex space-x-2 mt-4">
            <!-- 安裝按鈕 -->
            <button
              v-if="pwaState.isInstallable"
              @click="installApp"
              :disabled="installing"
              class="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {{ installing ? t("pwa.install.installing") : t("pwa.actions.install") }}
            </button>

            <!-- 更新按鈕 -->
            <button
              v-if="pwaState.isUpdateAvailable"
              @click="updateApp"
              :disabled="pwaState.isUpdating"
              class="px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:opacity-50"
            >
              {{ pwaState.isUpdating ? t("pwa.update.updating") : t("pwa.update.updateApp") }}
            </button>

            <!-- 通知許可權按鈕 -->
            <button
              v-if="pwaState.notificationPermission === 'default'"
              @click="requestNotification"
              :disabled="requestingNotification"
              class="px-3 py-1.5 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 disabled:opacity-50"
            >
              {{ requestingNotification ? t("pwa.notification.requesting") : t("pwa.notification.enable") }}
            </button>

            <!-- 檢查更新按鈕 -->
            <button @click="checkUpdate" :disabled="checking" class="px-3 py-1.5 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 disabled:opacity-50">
              {{ checking ? t("pwa.update.checking") : t("pwa.update.checkUpdate") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useEventListener } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { pwaState, pwaUtils } from "./pwaManager.js";
import { IconCheckCircle, IconDownload, IconExclamation, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// 國際化支援
const { t } = useI18n();
const log = createLogger("PWAStatus");

// Props
const props = defineProps({
  position: {
    type: String,
    default: "bottom-right", // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
    validator: (value) => ["top-left", "top-right", "bottom-left", "bottom-right"].includes(value),
  },
  showText: {
    type: Boolean,
    default: false,
  },
  autoHide: {
    type: Boolean,
    default: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 響應式狀態
const showDetails = ref(false);
const installing = ref(false);
const checking = ref(false);
const requestingNotification = ref(false);

// 計算屬性
const showIndicator = computed(() => {
  if (!props.autoHide) return true;

  // 有重要狀態時顯示
  return pwaState.isOffline || pwaState.isUpdateAvailable || pwaState.isUpdating || pwaState.isInstallable;
});

const indicatorClasses = computed(() => {
  const base = "fixed z-50 px-3 py-2 rounded-full shadow-lg cursor-pointer transition-all duration-300 hover:scale-105";

  // 位置類
  const positions = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
  };

  // 狀態顏色
  let colorClass = "";
  if (pwaState.isOffline) {
    colorClass = "bg-red-500 text-white";
  } else if (pwaState.isUpdateAvailable) {
    colorClass = "bg-orange-500 text-white";
  } else if (pwaState.isUpdating) {
    colorClass = "bg-blue-500 text-white";
  } else if (pwaState.isInstallable) {
    colorClass = "bg-green-500 text-white";
  } else {
    colorClass = "bg-gray-500 text-white";
  }

  return `${base} ${positions[props.position]} ${colorClass}`;
});

const statusText = computed(() => {
  if (pwaState.isOffline) return t("pwa.status.offline");
  if (pwaState.isUpdateAvailable) return t("pwa.status.updateAvailable");
  if (pwaState.isUpdating) return t("pwa.status.updating");
  if (pwaState.isInstallable) return t("pwa.status.installable");
  return t("pwa.status.ready");
});

const statusIcon = computed(() => {
  if (pwaState.isOffline) return IconExclamation;
  if (pwaState.isUpdateAvailable) return IconRefresh;
  if (pwaState.isUpdating) return IconRefresh;
  if (pwaState.isInstallable) return IconDownload;
  return IconCheckCircle;
});

const swStateText = computed(() => {
  const stateKey = `pwa.serviceWorker.${pwaState.swState}`;
  return t(stateKey, t("pwa.serviceWorker.unknown"));
});

const swStateColor = computed(() => {
  const colors = {
    unknown: "text-gray-500",
    installing: "text-blue-500",
    waiting: "text-orange-500",
    active: "text-green-500",
    redundant: "text-red-500",
  };
  return colors[pwaState.swState] || "text-gray-500";
});

// 通知許可權相關計算屬性
const notificationPermissionText = computed(() => {
  const permissionKey = `pwa.notification.${pwaState.notificationPermission}`;
  return t(permissionKey, t("common.unknown"));
});

const notificationPermissionColor = computed(() => {
  const colors = {
    default: "text-gray-500",
    granted: "text-green-500",
    denied: "text-red-500",
  };
  return colors[pwaState.notificationPermission] || "text-gray-500";
});

// 方法
const toggleDetails = () => {
  showDetails.value = !showDetails.value;
};

const installApp = async () => {
  installing.value = true;
  try {
    await pwaUtils.install();
  } finally {
    installing.value = false;
  }
};

const updateApp = async () => {
  try {
    const success = await pwaUtils.update();
    if (success) {
      // 等待一下然後重新整理
      setTimeout(() => {
        pwaUtils.reloadApp();
      }, 1000);
    }
  } catch (error) {
    log.error("更新失敗:", error);
  }
};

const checkUpdate = async () => {
  checking.value = true;
  try {
    await pwaUtils.checkForUpdate();
  } finally {
    checking.value = false;
  }
};

// 請求通知許可權
const requestNotification = async () => {
  requestingNotification.value = true;
  try {
    await pwaUtils.requestNotificationPermission();
  } catch (error) {
    log.error("請求通知許可權失敗:", error);
  } finally {
    requestingNotification.value = false;
  }
};

// 監聽 PWA 更新事件（自動清理）
useEventListener(window, "pwa-update-available", () => {
  log.debug("收到更新通知");
});
</script>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease-out;
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.pwa-details-panel {
  position: fixed;
  z-index: 60;
  max-width: 320px;
}

/* 根據位置調整詳情面板位置 */
.pwa-status-indicator:has(.top-left) .pwa-details-panel {
  top: 60px;
  left: 16px;
}

.pwa-status-indicator:has(.top-right) .pwa-details-panel {
  top: 60px;
  right: 16px;
}

.pwa-status-indicator:has(.bottom-left) .pwa-details-panel {
  bottom: 60px;
  left: 16px;
}

.pwa-status-indicator:has(.bottom-right) .pwa-details-panel {
  bottom: 60px;
  right: 16px;
}
</style>
