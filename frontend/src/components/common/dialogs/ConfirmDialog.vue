<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-[70] overflow-auto bg-black bg-opacity-50 flex items-center justify-center" @click="handleBackdropClick">
      <div class="relative w-full max-w-md p-6 rounded-lg shadow-xl" :class="darkMode ? 'bg-gray-800' : 'bg-white'" @click.stop>
      <!-- 標題和內容 -->
      <div class="mb-4">
        <h3 class="text-lg font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
          {{ title }}
        </h3>
        <p v-if="message" class="text-sm mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ message }}
        </p>
        <!-- 支援自定義內容插槽 -->
        <div v-if="$slots.content" class="text-sm mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          <slot name="content"></slot>
        </div>
      </div>

      <!-- 按鈕組 -->
      <div class="flex justify-end space-x-2">
        <button
          @click="handleCancel"
          :disabled="loading"
          class="px-4 py-2 rounded-md transition-colors"
          :class="[darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100', loading ? 'opacity-50 cursor-not-allowed' : '']"
        >
          {{ displayCancelText }}
        </button>
        <button @click="handleConfirm" :disabled="loading" class="px-4 py-2 rounded-md text-white transition-colors flex items-center space-x-2" :class="confirmButtonClass">
          <!-- 載入狀態圖示 -->
          <IconRefresh v-if="loading" class="animate-spin h-4 w-4" aria-hidden="true" />
          <span>{{ loading ? displayLoadingText : displayConfirmText }}</span>
        </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { IconRefresh } from "@/components/icons";
import { useI18n } from "vue-i18n";

// 國際化
const { t } = useI18n();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    default: "",
  },
  confirmText: {
    type: String,
    default: "",
  },
  cancelText: {
    type: String,
    default: "",
  },
  confirmType: {
    type: String,
    default: "primary", // 'primary', 'danger', 'warning'
    validator: (value) => ["primary", "danger", "warning"].includes(value),
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: "",
  },
  allowBackdropClose: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["confirm", "cancel", "close"]);

// 國際化文字計算屬性
const displayConfirmText = computed(() => {
  return props.confirmText || t("common.dialogs.confirm");
});

const displayCancelText = computed(() => {
  return props.cancelText || t("common.dialogs.cancel");
});

const displayLoadingText = computed(() => {
  return props.loadingText || t("common.dialogs.processing");
});

// 確認按鈕樣式
const confirmButtonClass = computed(() => {
  const baseClass = "transition-colors";
  const loadingClass = props.loading ? "cursor-not-allowed" : "";

  switch (props.confirmType) {
    case "danger":
      return `${baseClass} ${props.loading ? "bg-red-500" : "bg-red-600 hover:bg-red-700"} ${loadingClass}`;
    case "warning":
      return `${baseClass} ${props.loading ? "bg-yellow-500" : "bg-yellow-600 hover:bg-yellow-700"} ${loadingClass}`;
    case "primary":
    default:
      return `${baseClass} ${props.loading ? "bg-primary-500" : props.darkMode ? "bg-primary-600 hover:bg-primary-700" : "bg-primary-500 hover:bg-primary-600"} ${loadingClass}`;
  }
});

// 事件處理
const handleConfirm = () => {
  if (props.loading) return;
  emit("confirm");
};

const handleCancel = () => {
  if (props.loading) return;
  emit("cancel");
  emit("close");
};

const handleBackdropClick = () => {
  if (props.allowBackdropClose && !props.loading) {
    handleCancel();
  }
};

// 鍵盤事件：ESC 取消，Enter 確認
onKeyStroke("Escape", () => {
  if (!props.isOpen || props.loading) return;
  handleCancel();
});
onKeyStroke("Enter", () => {
  if (!props.isOpen || props.loading) return;
  handleConfirm();
});
</script>
