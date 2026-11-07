import { createI18n } from "vue-i18n";
import { useLocalStorage } from "@vueuse/core";
import zhTW from "./locales/zh-TW/index.js";
import enUS from "./locales/en-US/index.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("i18n");

// 獲取瀏覽器語言設定
const getBrowserLanguage = () => {
  const browserLang = (navigator.language || navigator.userLanguage || "").toLowerCase();
  // 華語圈（台灣/香港/澳門）與 zh-Hant 一律對應到正體中文（台灣）語系
  if (browserLang.startsWith("zh")) {
    return "zh-TW";
  }
  return "en-US";
};

// 獲取儲存的語言設定，如果沒有則使用瀏覽器語言
const storedLanguage = useLocalStorage("language", getBrowserLanguage());
const getSavedLanguage = () => storedLanguage.value || getBrowserLanguage();

// 儲存語言設定到本地儲存
export const saveLanguagePreference = (lang) => {
  storedLanguage.value = lang;
};

// 建立i18n例項
const i18n = createI18n({
  legacy: false, // 使用組合式API
  locale: getSavedLanguage(),
  fallbackLocale: "zh-TW", // 回退語言
  messages: {
    "zh-TW": zhTW,
    "en-US": enUS,
  },
  // 確保正確處理日期和數字等格式化
  globalInjection: true,
  // 使用HTML
  warnHtmlMessage: false,
  // 缺少翻譯/回退時保持靜默（vue-i18n v10+ 已移除 silentTranslationWarn/silentFallbackWarn）
  missingWarn: false,
  fallbackWarn: false,
});

// 除錯輔助函式 - 僅在開發環境需要時使用
export const debugI18n = () => {
  if (import.meta.env.DEV) {
    log.debug("當前i18n配置:", {
      當前語言: i18n.global.locale.value,
      回退語言: i18n.global.fallbackLocale.value,
      可用語言: Object.keys(i18n.global.messages.value),
      模組化結構: "已啟用",
    });
  }
};

export default i18n;
