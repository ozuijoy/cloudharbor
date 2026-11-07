<template>
  <div class="generic-preview text-center py-6 w-full self-center flex flex-col items-center justify-center" style="min-height: 200px">
    <IconDocumentText class="h-16 w-16 mx-auto mb-3" :class="iconClass" />
    <p class="text-gray-600 dark:text-gray-300 font-medium">{{ fileTypeDescription }}</p>
    <p class="text-gray-500 dark:text-gray-400 text-sm mt-2">{{ actionSuggestion }}</p>

    <!-- 檔案型別詳細資訊 -->
    <div v-if="showDetails" class="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-left max-w-md">
      <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t("fileView.preview.generic.fileInfo") }}</h4>
      <div class="space-y-1 text-xs text-gray-600 dark:text-gray-400">
        <div v-if="filename">
          <span class="font-medium">{{ t("fileView.preview.generic.filename") }}:</span> {{ filename }}
        </div>
        <div v-if="mimetype">
          <span class="font-medium">{{ t("fileView.preview.generic.mimeType") }}:</span> {{ mimetype }}
        </div>
        <div v-if="fileExtension">
          <span class="font-medium">{{ t("fileView.preview.generic.fileExtension") }}:</span> {{ fileExtension }}
        </div>
        <div v-if="suggestedApps.length > 0">
          <span class="font-medium">{{ t("fileView.preview.generic.suggestedApps") }}:</span> {{ suggestedApps.join(", ") }}
        </div>
      </div>
    </div>

    <!-- 顯示/隱藏詳細資訊按鈕 -->
    <button @click="showDetails = !showDetails" class="mt-3 text-xs text-blue-600 dark:text-blue-400 hover:underline">
      {{ showDetails ? t("fileView.preview.generic.hideDetails") : t("fileView.preview.generic.showDetails") }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { IconDocumentText } from "@/components/icons";

const { t } = useI18n();

const props = defineProps({
  iconClass: {
    type: String,
    default: "text-gray-400",
  },
  filename: {
    type: String,
    default: "",
  },
  mimetype: {
    type: String,
    default: "",
  },
});

const showDetails = ref(false);

// 獲取副檔名
const fileExtension = computed(() => {
  if (!props.filename) return "";
  const parts = props.filename.split(".");
  return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : "";
});

// 根據檔案型別生成描述
const fileTypeDescription = computed(() => {
  const ext = fileExtension.value.toLowerCase();
  const mime = props.mimetype.toLowerCase();

  // 常見檔案型別描述
  const typeDescriptions = {
    // 壓縮檔案
    ".zip": "壓縮檔案",
    ".rar": "RAR壓縮檔案",
    ".7z": "7-Zip壓縮檔案",
    ".tar": "TAR歸檔檔案",
    ".gz": "Gzip壓縮檔案",

    // 可執行檔案
    ".exe": "Windows可執行檔案",
    ".msi": "Windows安裝包",
    ".dmg": "macOS磁碟映像",
    ".deb": "Debian安裝包",
    ".rpm": "RPM安裝包",

    // 資料庫檔案
    ".db": "資料庫檔案",
    ".sqlite": "SQLite資料庫",
    ".sql": "SQL指令碼檔案",

    // 字型檔案
    ".ttf": "TrueType字型",
    ".otf": "OpenType字型",
    ".woff": "Web字型",

    // 其他
    ".iso": "光碟映像檔案",
    ".bin": "二進位制檔案",
    ".log": "日誌檔案",
  };

  if (typeDescriptions[ext]) {
    return typeDescriptions[ext];
  }

  // 根據MIME型別判斷
  if (mime.startsWith("application/")) {
    return t("fileView.preview.generic.applicationFile");
  } else if (mime.startsWith("font/")) {
    return t("fileView.preview.generic.fontFile");
  } else if (mime.startsWith("model/")) {
    return t("fileView.preview.generic.modelFile");
  }

  return t("fileView.preview.generic.unsupportedType");
});

// 操作建議
const actionSuggestion = computed(() => {
  const ext = fileExtension.value.toLowerCase();

  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) {
    return t("fileView.preview.generic.downloadAndExtract");
  } else if ([".exe", ".msi", ".dmg", ".deb", ".rpm"].includes(ext)) {
    return t("fileView.preview.generic.downloadAndInstall");
  } else if ([".db", ".sqlite"].includes(ext)) {
    return t("fileView.preview.generic.downloadAndOpenWithDb");
  } else if ([".ttf", ".otf", ".woff"].includes(ext)) {
    return t("fileView.preview.generic.downloadAndInstallFont");
  } else if (ext === ".iso") {
    return t("fileView.preview.generic.downloadAndMount");
  }

  return t("fileView.preview.generic.downloadAndOpenWith");
});

// 建議的應用程式
const suggestedApps = computed(() => {
  const ext = fileExtension.value.toLowerCase();

  const appSuggestions = {
    ".zip": ["WinRAR", "7-Zip", "WinZip"],
    ".rar": ["WinRAR", "7-Zip"],
    ".7z": ["7-Zip", "WinRAR"],
    ".exe": ["Windows系統"],
    ".msi": ["Windows安裝程式"],
    ".dmg": ["macOS系統"],
    ".db": ["DB Browser for SQLite", "DBeaver"],
    ".sqlite": ["DB Browser for SQLite", "SQLite Expert"],
    ".sql": ["MySQL Workbench", "phpMyAdmin", "DBeaver"],
    ".ttf": ["字型管理器", "系統字型安裝"],
    ".otf": ["字型管理器", "系統字型安裝"],
    ".iso": ["虛擬光碟機軟體", "燒錄軟體"],
    ".log": ["文字編輯器", "Notepad++", "VS Code"],
  };

  return appSuggestions[ext] || [];
});
</script>
