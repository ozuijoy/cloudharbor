<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { useEventListener } from "@vueuse/core";
import EnvSwitcher from "./components/EnvSwitcher.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import PWAInstallPrompt from "./components/PWAInstallPrompt.vue";
import GlobalMusicPlayer from "./components/common/GlobalMusicPlayer.vue";
import { useAuthStore } from "./stores/authStore.js";
import { useSiteConfigStore } from "./stores/siteConfigStore.js";
import FooterMarkdownRenderer from "./modules/admin/components/FooterMarkdownRenderer.vue";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import AnnouncementModal from "@/modules/admin/components/AnnouncementModal.vue";
import { IconBell, IconClose, IconComputerDesktop, IconGithub, IconHamburger, IconMoon, IconSun } from "@/components/icons";
import { Notivue, NotivueSwipe, Notification } from "notivue";
import { CloudHarborLightTheme, CloudHarborDarkTheme } from "@/styles/notivueTheme";
import { createLogger } from "@/utils/logger.js";

const route = useRoute();
const log = createLogger("App");

// 使用認證Store和站點配置Store
const authStore = useAuthStore();
const siteConfigStore = useSiteConfigStore();

// 主題模式: 由全域性 composable 統一管理
const { themeMode, isDarkMode, toggleThemeMode } = useThemeMode();

// 全域性訊息
const { clearMessage, showMessage } = useGlobalMessage();

// 計算當前頁面 - 基於路由
const activePage = computed(() => {
  return route.meta?.originalPage || "home";
});

// 前臺入口開關（站點設定）
// - store 未初始化前，先按“都顯示”處理，避免把使用者鎖死在空白頁面
const canShowHomeEntry = computed(() => !siteConfigStore.isInitialized || siteConfigStore.siteHomeEditorEnabled);
const canShowUploadEntry = computed(() => !siteConfigStore.isInitialized || siteConfigStore.siteUploadPageEnabled);
const canShowMountEntry = computed(() => !siteConfigStore.isInitialized || siteConfigStore.siteMountExplorerEnabled);

// 公告入口（全站）：只有“啟用 + 有內容”才顯示
const announcementModalRef = ref(null);
const canShowAnnouncementEntry = computed(() => {
  if (!siteConfigStore.isInitialized) return false;
  if (!siteConfigStore.siteAnnouncementEnabled) return false;
  const content = siteConfigStore.siteAnnouncementContent || "";
  return !!content.trim();
});

const hasUnseenAnnouncement = computed(() => {
  const exposed = announcementModalRef.value;
  const raw = exposed?.hasUnseenAnnouncement;
  if (typeof raw === "boolean") return raw;
  return !!raw?.value;
});

const openAnnouncement = () => {
  announcementModalRef.value?.open?.();
};

// 過渡狀態，用於頁面切換動畫
const transitioning = ref(false);

// 移動端選單狀態
const isMobileMenuOpen = ref(false);

// 環境切換器顯示狀態
const showEnvSwitcher = ref(false);

// 專案倉庫連結（新專案請改成自己的倉庫；留空則不顯示圖示）
const githubUrl = "https://github.com/ozuijoy/cloudharbor";

// 檢查是否為開發環境
const isDev = import.meta.env.DEV;

  // 計算是否顯示頁尾
  const shouldShowFooter = computed(() => {
    // 管理面板頁面不顯示頁尾
    if (activePage.value === "admin") {
      return false;
    }

    // 站點配置還沒初始化完之前，不要先按預設值顯示頁尾
    if (!siteConfigStore.isInitialized) {
      return false;
    }

    const footerMarkdown = siteConfigStore.siteFooterMarkdown;
    return footerMarkdown && footerMarkdown.trim();
  });

  // 切換移動端選單狀態
  const toggleMobileMenu = () => {
    isMobileMenuOpen.value = !isMobileMenuOpen.value;
  };

  const handleGlobalMessageEvent = (event) => {
    const detail = event.detail || {};
    const type = detail.type || "info";
    const content = detail.content || detail.message || "";
    const duration = typeof detail.duration === "number" ? detail.duration : undefined;

    if (!content) return;

    showMessage(type, content, duration);
  };

  const handleGlobalMessageClearEvent = () => {
    clearMessage();
  };

  // 元件掛載時初始化
  onMounted(() => {
    // 在開發環境中始終顯示環境切換器
    if (isDev) {
      showEnvSwitcher.value = true;
    } else {
      // 在生產環境中，只有在明確的條件下才顯示：
      // 1. 存在管理員token
      // 2. URL中有特定的引數 (showEnvSwitcher) 如："https://域名.com?showEnvSwitcher"
      const hasAdminToken = authStore.isAdmin;
      const urlParams = new URLSearchParams(window.location.search);
      const hasEnvParam = urlParams.has("showEnvSwitcher");

      // 確保在生產環境中預設不顯示
      showEnvSwitcher.value = hasAdminToken && hasEnvParam;
    }

    log.debug("應用初始化完成");

    useEventListener(window, "global-message", handleGlobalMessageEvent);
    useEventListener(window, "global-message-clear", handleGlobalMessageClearEvent);
  });


</script>

<template>
  <div :class="['app-container min-h-[100dvh] transition-colors duration-200', isDarkMode ? 'bg-custom-bg-900 text-custom-text-dark' : 'bg-custom-bg-50 text-custom-text']">
    <header :class="['sticky top-0 z-50 shadow-sm transition-colors', isDarkMode ? 'bg-custom-surface-dark' : 'bg-custom-surface']">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex">
            <div class="flex-shrink-0 flex items-center">
              <h1 class="text-xl font-bold">{{ siteConfigStore.siteTitle || $t("app.title") }}</h1>
            </div>
            <nav class="hidden sm:ml-6 sm:flex sm:space-x-8">
              <router-link
                to="/"
                v-if="canShowHomeEntry"
                :class="[
                  activePage === 'home' ? 'border-primary-500 text-current' : 'border-transparent hover:border-gray-300',
                  'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200',
                  activePage !== 'home' && isDarkMode ? 'text-gray-300 hover:text-gray-100' : activePage !== 'home' ? 'text-gray-500 hover:text-gray-700' : '',
                ]"
              >
                {{ $t("nav.home") }}
              </router-link>
              <router-link
                to="/upload"
                v-if="canShowUploadEntry"
                :class="[
                  activePage === 'upload' ? 'border-primary-500 text-current' : 'border-transparent hover:border-gray-300',
                  'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200',
                  activePage !== 'upload' && isDarkMode ? 'text-gray-300 hover:text-gray-100' : activePage !== 'upload' ? 'text-gray-500 hover:text-gray-700' : '',
                ]"
              >
                {{ $t("nav.upload") }}
              </router-link>
              <router-link
                to="/mount-explorer"
                v-if="canShowMountEntry"
                :class="[
                  activePage === 'mount-explorer' ? 'border-primary-500 text-current' : 'border-transparent hover:border-gray-300',
                  'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200',
                  activePage !== 'mount-explorer' && isDarkMode ? 'text-gray-300 hover:text-gray-100' : activePage !== 'mount-explorer' ? 'text-gray-500 hover:text-gray-700' : '',
                ]"
              >
                {{ $t("nav.mountExplorer") }}
              </router-link>
              <router-link
                to="/admin"
                :class="[
                  activePage === 'admin' ? 'border-primary-500 text-current' : 'border-transparent hover:border-gray-300',
                  'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200',
                  activePage !== 'admin' && isDarkMode ? 'text-gray-300 hover:text-gray-100' : activePage !== 'admin' ? 'text-gray-500 hover:text-gray-700' : '',
                ]"
              >
                {{ $t("nav.admin") }}
              </router-link>
            </nav>
          </div>
          <div class="hidden sm:ml-6 sm:flex sm:items-center space-x-2">
            <a
              :href="githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              :class="[
                'p-2 rounded-full focus:outline-none transition-colors',
                isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              ]"
              aria-label="GitHub"
              title="GitHub"
            >
              <IconGithub size="md" aria-hidden="true" />
            </a>

            <button
              v-if="canShowAnnouncementEntry"
              type="button"
              @click="openAnnouncement"
              :class="[
                'relative p-2 rounded-full focus:outline-none transition-colors',
                isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              ]"
              :aria-label="$t('announcement.title')"
              :title="$t('announcement.title')"
            >
              <IconBell size="md" aria-hidden="true" />
              <span
                v-if="hasUnseenAnnouncement"
                class="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2"
                :class="isDarkMode ? 'ring-gray-800' : 'ring-white'"
                aria-hidden="true"
              ></span>
            </button>

            <LanguageSwitcher :darkMode="isDarkMode" />

            <button
              type="button"
              @click="toggleThemeMode"
              :class="[
                'p-2 rounded-full focus:outline-none transition-colors mr-2',
                isDarkMode ? 'text-yellow-300 hover:text-yellow-200 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-500 hover:bg-gray-100',
              ]"
            >
              <span class="sr-only">{{ $t("theme.toggle") }}</span>
              <IconComputerDesktop v-if="themeMode === 'auto'" size="md" aria-hidden="true" />
              <IconMoon v-else-if="themeMode === 'dark'" size="md" aria-hidden="true" />
              <IconSun v-else size="md" aria-hidden="true" />
            </button>
          </div>

          <!-- 移動端選單按鈕 -->
          <div class="flex items-center sm:hidden">
            <a
              :href="githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              :class="[
                'p-2 rounded-full focus:outline-none transition-colors mr-2',
                isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              ]"
              aria-label="GitHub"
              title="GitHub"
            >
              <IconGithub size="md" aria-hidden="true" />
            </a>

            <button
              v-if="canShowAnnouncementEntry"
              type="button"
              @click="openAnnouncement"
              :class="[
                'relative p-2 rounded-full focus:outline-none transition-colors mr-2',
                isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              ]"
              :aria-label="$t('announcement.title')"
              :title="$t('announcement.title')"
            >
              <IconBell size="md" aria-hidden="true" />
              <span
                v-if="hasUnseenAnnouncement"
                class="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2"
                :class="isDarkMode ? 'ring-gray-800' : 'ring-white'"
                aria-hidden="true"
              ></span>
            </button>

            <LanguageSwitcher :darkMode="isDarkMode" class="mr-2" />

            <button
              type="button"
              @click="toggleThemeMode"
              :class="[
                'p-2 rounded-full focus:outline-none transition-colors mr-2',
                isDarkMode ? 'text-yellow-300 hover:text-yellow-200 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-500 hover:bg-gray-100',
              ]"
              :aria-label="$t('theme.toggle')"
            >
              <span class="sr-only">{{ $t("theme.toggle") }}</span>
              <IconComputerDesktop v-if="themeMode === 'auto'" size="md" aria-hidden="true" />
              <IconMoon v-else-if="themeMode === 'dark'" size="md" aria-hidden="true" />
              <IconSun v-else size="md" aria-hidden="true" />
            </button>
            <button
              type="button"
              @click="toggleMobileMenu"
              :class="[
                'inline-flex items-center justify-center p-2 rounded-full focus:outline-none transition-all duration-200',
                isMobileMenuOpen
                  ? isDarkMode
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-200 text-gray-900'
                  : isDarkMode
                  ? 'text-gray-300 hover:text-white hover:bg-gray-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
              ]"
              :aria-expanded="isMobileMenuOpen"
              :aria-label="$t('nav.menu')"
            >
              <!-- 選單圖示 -->
              <!-- 關閉圖示 -->
              <IconHamburger v-if="!isMobileMenuOpen" size="lg" aria-hidden="true" />
              <IconClose v-else size="lg" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <!-- 移動端選單面板 -->
      <div class="sm:hidden overflow-hidden transition-all duration-300 ease-in-out" :class="[isMobileMenuOpen ? 'max-h-80' : 'max-h-0']">
        <div :class="['py-3 border-t transition-colors', isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200']">
          <router-link
            to="/"
            @click="isMobileMenuOpen = false"
            v-if="canShowHomeEntry"
            :class="[
              'flex items-center px-4 py-3 transition-colors duration-200',
              activePage === 'home'
                ? isDarkMode
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-900'
                : isDarkMode
                ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
          >
            <span class="ml-2">{{ $t("nav.home") }}</span>
          </router-link>
          <router-link
            to="/upload"
            @click="isMobileMenuOpen = false"
            v-if="canShowUploadEntry"
            :class="[
              'flex items-center px-4 py-3 transition-colors duration-200',
              activePage === 'upload'
                ? isDarkMode
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-900'
                : isDarkMode
                ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
          >
            <span class="ml-2">{{ $t("nav.upload") }}</span>
          </router-link>
          <router-link
            to="/mount-explorer"
            @click="isMobileMenuOpen = false"
            v-if="canShowMountEntry"
            :class="[
              'flex items-center px-4 py-3 transition-colors duration-200',
              activePage === 'mount-explorer'
                ? isDarkMode
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-900'
                : isDarkMode
                ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
          >
            <span class="ml-2">{{ $t("nav.mountExplorer") }}</span>
          </router-link>
          <router-link
            to="/admin"
            @click="isMobileMenuOpen = false"
            :class="[
              'flex items-center px-4 py-3 transition-colors duration-200',
              activePage === 'admin'
                ? isDarkMode
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-900'
                : isDarkMode
                ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
          >
            <span class="ml-2">{{ $t("nav.admin") }}</span>
          </router-link>
        </div>
      </div>
    </header>

    <main class="flex-1 flex flex-col" :class="activePage !== 'admin' ? 'pb-8' : ''">
      <router-view :dark-mode="isDarkMode" class="transition-opacity duration-300 flex-1 flex flex-col" :class="{ 'opacity-0': transitioning }" />
    </main>

    <footer v-if="shouldShowFooter" :class="['border-t transition-colors mt-auto', isDarkMode ? 'bg-custom-surface-dark border-gray-700' : 'bg-custom-surface border-gray-200']">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-6">
        <FooterMarkdownRenderer :content="siteConfigStore.siteFooterMarkdown" :dark-mode="isDarkMode" />
      </div>
    </footer>

    <!-- 新增環境切換器元件 (在開發環境或管理員登入狀態下顯示) -->
    <!-- <EnvSwitcher v-if="showEnvSwitcher" /> -->

    <!-- PWA 安裝提示元件 -->
    <PWAInstallPrompt :dark-mode="isDarkMode" />

    <!-- 公告：全站右上角入口開啟 -->
    <AnnouncementModal
      ref="announcementModalRef"
      :content="siteConfigStore.siteAnnouncementContent"
      :enabled="siteConfigStore.siteAnnouncementEnabled"
      :dark-mode="isDarkMode"
      :auto-open="false"
    />

    <!-- 全域性音樂播放器 -->
    <GlobalMusicPlayer />

    <!-- 全域性訊息提示（Notivue） -->
    <Notivue v-slot="item">
      <NotivueSwipe :item="item">
        <Notification
          :item="item"
          :theme="isDarkMode ? CloudHarborDarkTheme : CloudHarborLightTheme"
        />
      </NotivueSwipe>
    </Notivue>
  </div>
</template>

<style>
/* 全域性樣式 */
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* 移動端選單過渡動畫 */
.sm\:hidden {
  transition: all 0.3s ease-in-out;
}

/* 按鈕觸控反饋 */
@media (max-width: 640px) {
  button,
  a {
    -webkit-tap-highlight-color: transparent;
  }
}

/* 禁用移動端點選時的藍色高亮 */
* {
  -webkit-tap-highlight-color: transparent;
}
</style>
