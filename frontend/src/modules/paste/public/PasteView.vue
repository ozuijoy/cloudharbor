<script setup>
// PasteView元件是一個輕量級包裝器元件
// 主要負責接收slug屬性，並傳遞給主元件PasteViewMain
// 透過這種方式實現了關注點分離，使程式碼結構更加清晰
import PasteViewMain from "@/modules/paste/public/components/PasteViewMain.vue";
import { useThemeMode } from "@/composables/core/useThemeMode.js";

// 定義元件接收的屬性
const props = defineProps({
  // 文字分享的唯一識別符號
  slug: {
    type: String,
    required: true,
  },
});

/**
 * 使用主題模式 composable
 */
const { isDarkMode: darkMode } = useThemeMode();
</script>

<template>
  <!-- 將接收到的屬性傳遞給主元件 -->
  <PasteViewMain :dark-mode="darkMode" :slug="slug" />
</template>
