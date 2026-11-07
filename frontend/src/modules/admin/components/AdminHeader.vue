<template>
  <!-- 移動端頂部欄 - 混合導航模式下位於全域性header下方 -->
  <div class="md:hidden sticky top-16 left-0 right-0 z-40 border-b px-4 py-3 flex items-center" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
    <button
      type="button"
      @click="$emit('toggle-mobile-sidebar')"
      class="h-10 w-10 inline-flex items-center justify-center rounded-md focus:outline-none"
      :class="darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-900'"
    >
      <span class="sr-only">開啟選單</span>
      <IconHamburger size="lg" aria-hidden="true" />
    </button>
    <h1 class="ml-3 text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
      {{ currentPageTitle }}
    </h1>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { IconHamburger } from "@/components/icons";

const route = useRoute();
const { t } = useI18n();

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(["toggle-mobile-sidebar"]);

// 計算當前頁面標題
const currentPageTitle = computed(() => {
  // 根據路由名稱返回對應的頁面標題
  switch (route.name) {
    case "AdminDashboard":
      return t("pageTitle.adminModules.dashboard");
    case "AdminTextManagement":
      return t("pageTitle.adminModules.textManagement");
    case "AdminFileManagement":
      return t("pageTitle.adminModules.fileManagement");
    case "AdminStorage":
      return t("pageTitle.adminModules.storageConfig");
    case "AdminMountManagement":
      return t("pageTitle.adminModules.mountManagement");
    case "AdminKeyManagement":
      return t("pageTitle.adminModules.keyManagement");
    case "AdminGlobalSettings":
      return t("pageTitle.adminModules.globalSettings");
    case "AdminAccountSettings":
      return t("pageTitle.adminModules.accountSettings");
    case "AdminAccountManagement":
      return t("pageTitle.adminModules.accountSettings");
    case "AdminWebDAVSettings":
      return t("pageTitle.adminModules.webdavSettings");
    default:
      return t("nav.admin");
  }
});
</script>

<style scoped>
/* 元件特定樣式 */
</style>
