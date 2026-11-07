<script setup>
/**
 * ViewModeToggle - 檢視模式切換按鈕組元件
 *
 * 統一的檢視切換元件，用於在不同檢視模式（表格/卡片/網格/列表/瀑布流）之間切換
 *
 * @example
 * <ViewModeToggle
 *   v-model="viewMode"
 *   :options="[
 *     { value: 'table', icon: 'table', titleKey: 'admin.tasks.viewMode.table' },
 *     { value: 'card', icon: 'card', titleKey: 'admin.tasks.viewMode.card' }
 *   ]"
 *   :dark-mode="isDarkMode"
 *   size="md"
 * />
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { IconCollection, IconGrid, IconList } from "@/components/icons";

const props = defineProps({
  /**
   * 當前選中的檢視模式值 (v-model)
   */
  modelValue: {
    type: String,
    required: true,
  },
  /**
   * 檢視選項陣列
   * @type {Array<{ value: string, icon: string, titleKey?: string, title?: string }>}
   */
  options: {
    type: Array,
    required: true,
    validator: (val) => val.length >= 2 && val.every((opt) => opt.value && opt.icon),
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * 尺寸大小
   */
  size: {
    type: String,
    default: "md",
    validator: (val) => ["sm", "md"].includes(val),
  },
});

const emit = defineEmits(["update:modelValue"]);

const { t, te } = useI18n();

/**
 * 獲取選項的 title 文字
 */
const getOptionTitle = (option) => {
  if (option.titleKey && te(option.titleKey)) {
    return t(option.titleKey);
  }
  return option.title || option.value;
};

/**
 * 尺寸配置
 */
const sizeConfig = computed(() => ({
  sm: {
    button: "px-2 py-1.5 text-xs",
  },
  md: {
    button: "px-3 py-2 text-sm",
  },
}));

/**
 * 當前尺寸的樣式類
 */
const currentSize = computed(() => sizeConfig.value[props.size]);

/**
 * 獲取按鈕的邊框類
 * - 第一個按鈕：左圓角 + 全邊框
 * - 中間按鈕：無左邊框（避免雙邊框）
 * - 最後一個按鈕：右圓角 + 無左邊框
 */
const getBorderClass = (index) => {
  const total = props.options.length;
  if (index === 0) {
    return "rounded-l-md border";
  } else if (index === total - 1) {
    return "rounded-r-md border-t border-r border-b";
  }
  return "border-t border-r border-b";
};

/**
 * 獲取按鈕的狀態樣式類
 */
const getStateClass = (isActive) => {
  if (isActive) {
    return "bg-primary-600 text-white border-primary-600 hover:bg-primary-700";
  }
  return props.darkMode
    ? "bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600"
    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";
};

/**
 * 獲取完整的按鈕類名
 */
const getButtonClass = (option, index) => {
  const isActive = props.modelValue === option.value;
  return [
    "inline-flex items-center justify-center font-medium",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset",
    "transition-colors duration-200",
    currentSize.value.button,
    getBorderClass(index),
    getStateClass(isActive),
  ];
};

/**
 * 處理選項點選
 */
const handleClick = (value) => {
  if (value !== props.modelValue) {
    emit("update:modelValue", value);
  }
};

const iconComponentMap = {
  table: IconList,
  list: IconList,
  card: IconCollection,
  grid: IconGrid,
  masonry: IconGrid,
};

const getIconComponent = (icon) => iconComponentMap[icon] || IconList;
</script>

<template>
  <div class="inline-flex rounded-md shadow-sm" role="group">
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      :class="getButtonClass(option, index)"
      :title="getOptionTitle(option)"
      @click="handleClick(option.value)"
    >
      <component :is="getIconComponent(option.icon)" :size="props.size" class="shrink-0" />
    </button>
  </div>
</template>
