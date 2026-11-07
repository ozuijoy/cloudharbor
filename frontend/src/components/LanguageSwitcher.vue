<template>
  <button
    type="button"
    ref="buttonRef"
    @click="toggleLanguageMenu"
    :class="[
      'p-2 rounded-full focus:outline-none transition-colors relative',
      darkMode ? 'text-blue-300 hover:text-blue-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-600 hover:bg-gray-100',
    ]"
    :aria-label="$t('language.toggle')"
  >
    <span class="sr-only">{{ $t("language.toggle") }}</span>
    <IconTranslate />

    <!-- 當前語言指示器 -->
    <span class="absolute top-0 right-0 inline-flex items-center justify-center h-3 w-3 rounded-full bg-blue-500 text-xs text-white">
      {{ currentLanguage === "zh-TW" ? "繁" : "en" }}
    </span>

    <!-- 語言選擇下拉選單 -->
    <div
      v-show="showLanguageMenu"
      class="absolute right-0 mt-2 py-1 w-40 rounded-md shadow-lg z-10"
      :class="darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'"
    >
      <a
        href="#"
        @click.prevent="changeLanguage('zh-TW')"
        class="block px-4 py-2 text-sm"
        :class="[
          currentLanguage === 'zh-TW' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
          darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        ]"
      >
        {{ $t("language.zh") }}
      </a>
      <a
        href="#"
        @click.prevent="changeLanguage('en-US')"
        class="block px-4 py-2 text-sm"
        :class="[
          currentLanguage === 'en-US' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
          darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        ]"
      >
        {{ $t("language.en") }}
      </a>
    </div>
  </button>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useLocalStorage, onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { saveLanguagePreference } from "../i18n";
import { IconTranslate } from "@/components/icons";

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const { locale, t } = useI18n();
const buttonRef = ref(null);
const showLanguageMenu = ref(false);
const currentLanguage = computed(() => locale.value);
const storedLanguage = useLocalStorage("language", locale.value);

// 初始化時檢查當前語言
onMounted(() => {
  // 確保語言與本地儲存一致
  if (storedLanguage.value && storedLanguage.value !== locale.value) {
    locale.value = storedLanguage.value;
  }
});

// 切換語言選單顯示狀態
const toggleLanguageMenu = () => {
  showLanguageMenu.value = !showLanguageMenu.value;
};

// 切換語言
const changeLanguage = (lang) => {
  locale.value = lang;
  saveLanguagePreference(lang);
  showLanguageMenu.value = false;

  // 觸發全域性事件，用於通知其他元件語言已更改
  window.dispatchEvent(new CustomEvent("languageChanged", { detail: { locale: lang } }));
};

// 點選外部關閉選單（VueUse 自動管理監聽器與清理）
onClickOutside(buttonRef, () => {
  if (!showLanguageMenu.value) return;
  showLanguageMenu.value = false;
});
</script>
