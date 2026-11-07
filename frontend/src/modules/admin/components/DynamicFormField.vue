<script setup>
/**
 * 動態表單欄位元件
 * - 根據 FieldSchema 渲染不同型別的輸入控制元件
 * - 支援 string、number、boolean、select、textarea 型別
 * - 支援暗黑模式
 */
import { computed } from "vue";

const props = defineProps({
  /** 欄位 Schema 定義 */
  field: {
    type: Object,
    required: true,
  },
  /** 欄位值（v-model） */
  modelValue: {
    type: [String, Number, Boolean],
    default: undefined,
  },
  /** 暗黑模式 */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /** 是否禁用 */
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue"]);

// 計算屬性：欄位型別
const fieldType = computed(() => props.field?.type || "string");

// 計算屬性：欄位標籤
const fieldLabel = computed(() => props.field?.label || props.field?.name || "");

// 計算屬性：是否必填
const isRequired = computed(() => props.field?.required === true);

// 計算屬性：欄位描述
const fieldDescription = computed(() => props.field?.description || "");

// 計算屬性：下拉選項（用於 select 型別）
const selectOptions = computed(() => props.field?.options || []);

// 計算屬性：數值範圍
const minValue = computed(() => props.field?.min);
const maxValue = computed(() => props.field?.max);

// 計算屬性：預設值
const defaultValue = computed(() => props.field?.defaultValue);

// 更新值
const updateValue = (newValue) => {
  emit("update:modelValue", newValue);
};

// 處理 input 事件
const handleInput = (event) => {
  const value = event.target.value;
  if (fieldType.value === "number") {
    updateValue(value === "" ? undefined : Number(value));
  } else {
    updateValue(value);
  }
};

// 處理 checkbox 事件
const handleCheckbox = (event) => {
  updateValue(event.target.checked);
};

// 處理 select 事件
const handleSelect = (event) => {
  updateValue(event.target.value);
};

// 輸入框樣式
const inputClass = computed(() => [
  "block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border",
  props.darkMode
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "border-gray-300 text-gray-900 placeholder-gray-500",
  props.disabled ? "opacity-50 cursor-not-allowed" : "",
]);

// 標籤樣式
const labelClass = computed(() => [
  "block text-sm font-medium mb-1",
  props.darkMode ? "text-gray-200" : "text-gray-700",
]);

// 描述文字樣式
const descriptionClass = computed(() => [
  "mt-1 text-xs",
  props.darkMode ? "text-gray-400" : "text-gray-500",
]);
</script>

<template>
  <div class="dynamic-form-field">
    <!-- String 型別：文字輸入框 -->
    <template v-if="fieldType === 'string'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="text"
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Number 型別：數字輸入框 -->
    <template v-else-if="fieldType === 'number'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="number"
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :min="minValue"
        :max="maxValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
        <span v-if="minValue !== undefined || maxValue !== undefined" class="ml-1">
          ({{ minValue !== undefined ? `最小: ${minValue}` : '' }}{{ minValue !== undefined && maxValue !== undefined ? ', ' : '' }}{{ maxValue !== undefined ? `最大: ${maxValue}` : '' }})
        </span>
      </p>
    </template>

    <!-- Boolean 型別：核取方塊 -->
    <template v-else-if="fieldType === 'boolean'">
      <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
        <input
          type="checkbox"
          :id="field.name"
          :checked="modelValue"
          :disabled="disabled"
          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
          @change="handleCheckbox"
        />
        <label :for="field.name" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
          {{ fieldLabel }}
          <span v-if="isRequired" class="text-red-500">*</span>
        </label>
      </div>
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Select 型別：下拉選擇框 -->
    <template v-else-if="fieldType === 'select'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <select
        :id="field.name"
        :value="modelValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @change="handleSelect"
      >
        <option v-for="opt in selectOptions" :key="opt.value" :value="opt.value">
          {{ opt.label || opt.value }}
        </option>
      </select>
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- Textarea 型別：多行文字框 -->
    <template v-else-if="fieldType === 'textarea'">
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <textarea
        :id="field.name"
        :value="modelValue"
        :placeholder="defaultValue !== undefined ? String(defaultValue) : ''"
        :disabled="disabled"
        :required="isRequired"
        rows="4"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>

    <!-- 未知型別：回退到文字輸入框 -->
    <template v-else>
      <label :for="field.name" :class="labelClass">
        {{ fieldLabel }}
        <span v-if="isRequired" class="text-red-500">*</span>
      </label>
      <input
        type="text"
        :id="field.name"
        :value="modelValue"
        :disabled="disabled"
        :required="isRequired"
        :class="inputClass"
        @input="handleInput"
      />
      <p v-if="fieldDescription" :class="descriptionClass">
        {{ fieldDescription }}
      </p>
    </template>
  </div>
</template>
