<template>
  <div class="h-screen" :class="darkMode ? 'bg-gray-900' : 'bg-gray-100'">
    <AdminSidebar
      :dark-mode="darkMode"
      :permissions="userPermissions"
      :is-mobile-sidebar-open="isMobileSidebarOpen"
      @close-mobile-sidebar="closeMobileSidebar"
      @sidebar-toggle="handleSidebarToggle"
      @logout="handleLogout"
    />

    <!-- 移動端頂部欄 -->
    <AdminHeader :dark-mode="darkMode" @toggle-mobile-sidebar="toggleMobileSidebar" />

    <!-- 主內容區域 - 混合導航模式，響應側邊欄收縮狀態 -->
    <main
      class="w-full md:w-auto md:fixed md:left-64 md:top-16 md:right-0 md:bottom-0 md:overflow-y-auto focus:outline-none z-40 transition-all duration-300"
      :class="[sidebarCollapsed ? 'md:left-16' : 'md:left-64', darkMode ? 'bg-gray-900' : 'bg-white md:bg-gray-100']"
    >
      <!-- 背景顏色包裝器 -->
      <div class="min-h-full flex flex-col pt-2 md:pt-4 pb-4 px-2 sm:px-4 md:px-6 lg:px-8" :class="darkMode ? 'bg-gray-900' : 'bg-gray-100 md:bg-transparent'">
        <!-- 內容區域 -->
        <div class="w-full mx-auto flex-1 flex flex-col" style="max-width: 1280px">
          <div class="rounded-lg flex-1 flex flex-col" :class="darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'">
            <!-- 頁面內容 -->
            <div class="p-2 md:p-4 flex-1 flex flex-col">
              <router-view :permissions="userPermissions" :dark-mode="darkMode" @logout="handleLogout" />
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useEventListener } from "@vueuse/core";
import AdminSidebar from "@/modules/admin/components/AdminSidebar.vue";
import AdminHeader from "@/modules/admin/components/AdminHeader.vue";
import { useAuthStore } from "@/stores/authStore.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";


const { isDarkMode: darkMode } = useThemeMode();
const authStore = useAuthStore();
const router = useRouter();


// 計算使用者許可權
const userPermissions = computed(() => ({
  isAdmin: authStore.isAdmin,
  text: authStore.hasTextManagePermission,
  file: authStore.hasFileManagePermission,
  mount: authStore.hasMountPermission,
}));

const isMobileSidebarOpen = ref(false);
const sidebarCollapsed = ref(false);

const toggleMobileSidebar = () => {
  isMobileSidebarOpen.value = !isMobileSidebarOpen.value;
};

const closeMobileSidebar = () => {
  isMobileSidebarOpen.value = false;
};

// 處理側邊欄收縮狀態變化
const handleSidebarToggle = (event) => {
  sidebarCollapsed.value = event.collapsed;
};

// 在元件載入時驗證認證狀態
onMounted(async () => {
  // 如果需要重新驗證，則進行驗證
  if (authStore.needsRevalidation) {
    await authStore.validateAuth();
  }

  // 監聽認證狀態變化事件（VueUse 自動管理監聽器與清理）
  useEventListener(window, "auth-state-changed", handleAuthStateChange);
});


// 處理認證狀態變化
const handleAuthStateChange = (event) => {
  // 由於使用了響應式的計算屬性，UI會自動更新
};

const emit = defineEmits(["logout"]);

// 處理登出
const handleLogout = async () => {
  await authStore.logout();
  // 登出後重定向到首頁
  router.push({ name: "Home" });
};
</script>
