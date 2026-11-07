<script setup>
/**
 * 定時任務表單元件
 * - 3步建立流程：選擇handler型別 → 配置引數 → 設定執行計劃
 * - 支援表單模式和JSON模式切換
 * - 編輯模式跳過步驟1
 */
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import cronstrue from "cronstrue/i18n";
import { useScheduledJobs } from "@/modules/admin/composables/useScheduledJobs";
import DynamicFormField from "./DynamicFormField.vue";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  job: {
    type: Object,
    default: null,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
  handlerTypes: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["close", "success"]);

const { t, locale } = useI18n();
const { createJob, updateJob } = useScheduledJobs();

// 狀態
const loading = ref(false);
const error = ref("");
const success = ref("");

// 步驟控制（1: 選擇型別, 2: 配置引數, 3: 執行計劃）
const step = ref(1);

// 配置模式（form: 表單模式, json: JSON模式）
const configMode = ref("form");

// 表單資料
// - taskId: 作業ID（jobId，唯一標識此排程作業）
// - handlerId: 任務處理器型別ID（Handler ID）
const formData = ref({
  taskId: "",
  handlerId: "",
  name: "",
  description: "",
  scheduleType: "interval", // interval | cron
  intervalSec: 3600,
  cronExpression: "",
  enabled: true,
  config: {},
});

// 間隔值和單位
const intervalValue = ref(1);
const intervalUnit = ref(3600);

// JSON配置文字
const configText = ref("{}");
const configError = ref("");

// 時間單位選項
const timeUnits = [
  { value: 60, label: "minutes" },
  { value: 3600, label: "hours" },
  { value: 86400, label: "days" },
];

// 當前選中的handler型別
const currentHandlerType = computed(() => {
  if (!formData.value.handlerId) return null;
  return props.handlerTypes.find((h) => h.id === formData.value.handlerId) || null;
});

// 類別標籤樣式
const getCategoryClass = (category) => {
  if (category === "maintenance") {
    return props.darkMode
      ? "bg-blue-900/40 text-blue-300"
      : "bg-blue-100 text-blue-700";
  }
  return props.darkMode
    ? "bg-purple-900/40 text-purple-300"
    : "bg-purple-100 text-purple-700";
};

// 類別顯示文字
const getCategoryLabel = (category) => {
  return category === "maintenance"
    ? t("admin.scheduledJobs.handlerType.category.maintenance")
    : t("admin.scheduledJobs.handlerType.category.business");
};

// 解析 cron 表示式為人類可讀文字
const getCronDescription = (cronExpression) => {
  if (!cronExpression) return '-';
  try {
    // 根據當前語言環境選擇 cronstrue 的語言
    // cronstrue 僅提供 zh_CN 語系（無 zh_TW），華語一律對應到 zh_CN
    const lang = String(locale.value || '').toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
    return cronstrue.toString(cronExpression, { locale: lang });
  } catch (error) {
    console.warn('解析 cron 表示式失敗:', error);
    return '無法解析 cron 表示式';
  }
};

// 監聽間隔值和單位變化
watch([intervalValue, intervalUnit], ([value, unit]) => {
  formData.value.intervalSec = value * unit;
});

// 監聽configText變化（JSON模式 → 表單資料）
watch(configText, (newVal) => {
  if (configMode.value !== "json") return;
  try {
    if (!newVal.trim()) {
      formData.value.config = {};
      configError.value = "";
      return;
    }
    formData.value.config = JSON.parse(newVal);
    configError.value = "";
  } catch (e) {
    configError.value = t("admin.scheduledJobs.validation.configInvalidJson");
  }
});

// 監聽config變化（表單資料 → JSON文字）
watch(
  () => formData.value.config,
  (newConfig) => {
    if (configMode.value !== "form") return;
    configText.value = JSON.stringify(newConfig || {}, null, 2);
  },
  { deep: true }
);

// 重置表單函式（必須在watch之前定義）
const resetForm = () => {
  formData.value = {
    taskId: "",
    handlerId: "",
    name: "",
    description: "",
    scheduleType: "interval",
    intervalSec: 3600,
    cronExpression: "",
    enabled: true,
    config: {},
  };
  intervalValue.value = 1;
  intervalUnit.value = 3600;
  configText.value = "{}";
  configError.value = "";
  configMode.value = "form";
  error.value = "";
  success.value = "";
  step.value = 1;
};

// 切換配置模式時同步資料
watch(configMode, (newMode) => {
  if (newMode === "json") {
    configText.value = JSON.stringify(formData.value.config || {}, null, 2);
  } else {
    try {
      formData.value.config = JSON.parse(configText.value || "{}");
      configError.value = "";
    } catch (e) {
      // 保持原有config
    }
  }
});

// 監聽job prop變化（編輯模式）
watch(
  () => props.job,
  (newJob) => {
    if (newJob) {
    formData.value = {
      taskId: newJob.taskId,
      handlerId: newJob.handlerId,
      name: newJob.name || "",
      description: newJob.description || "",
      scheduleType: newJob.scheduleType || "interval",
      intervalSec: newJob.intervalSec,
      cronExpression: newJob.cronExpression || "",
      enabled: newJob.enabled,
      config: newJob.config || {},
    };

      // 轉換intervalSec為合適的單位
      const sec = newJob.intervalSec;
      if (sec % 86400 === 0) {
        intervalValue.value = sec / 86400;
        intervalUnit.value = 86400;
      } else if (sec % 3600 === 0) {
        intervalValue.value = sec / 3600;
        intervalUnit.value = 3600;
      } else if (sec % 60 === 0) {
        intervalValue.value = sec / 60;
        intervalUnit.value = 60;
      } else {
        intervalValue.value = Math.ceil(sec / 60);
        intervalUnit.value = 60;
      }

      configText.value = JSON.stringify(newJob.config || {}, null, 2);

      // 編輯模式跳過步驟1
      step.value = 2;
    } else {
      resetForm();
    }
  }, 
  { immediate: true }
);

// 初始化：編輯模式跳過步驟1
onMounted(() => {
  if (props.isEdit && props.job) {
    step.value = 2;
  }
});

// 步驟1驗證：是否選擇了handler型別
const step1Valid = computed(() => {
  return !!formData.value.handlerId && !!currentHandlerType.value;
});

// 步驟2驗證：配置引數是否有效
const step2Valid = computed(() => {
  if (configError.value) return false;
  // 檢查必填欄位
  const schema = currentHandlerType.value?.configSchema || [];
  for (const field of schema) {
    if (field.required) {
      const value = formData.value.config[field.name];
      if (value === undefined || value === null || value === "") {
        return false;
      }
    }
  }
  return true;
});

// 步驟3驗證：執行計劃是否有效
const step3Valid = computed(() => {
  const type = formData.value.scheduleType || "interval";
  if (type === "interval") {
    return Number(formData.value.intervalSec) >= 60;
  }
  if (type === "cron") {
    return !!formData.value.cronExpression;
  }
  return false;
});

// Cron 表示式人類可讀提示（使用 cronstrue 完整解析）
const cronHint = computed(() => {
  const expr = (formData.value.cronExpression || "").trim();
  if (!expr) {
    return t("admin.scheduledJobs.form.cronExample");
  }

  try {
    const currentLocale = (locale.value || "zh-TW").toLowerCase();
    const cronLocale = currentLocale.startsWith("zh") ? "zh_CN" : "en";
    return cronstrue.toString(expr, {
      locale: cronLocale,
      use24HourTimeFormat: true,
    });
  } catch (e) {
    // 表示式不合法或不受支援時，退回示例文案，避免給出誤導性描述
    return t("admin.scheduledJobs.form.cronExample");
  }
});

// 整體表單驗證
const formValid = computed(() => {
  return step1Valid.value && step2Valid.value && step3Valid.value;
});

// 下一步
const nextStep = () => {
  if (step.value === 1 && step1Valid.value) {
    // 初始化配置預設值
    initConfigDefaults();
    step.value = 2;
  } else if (step.value === 2 && step2Valid.value) {
    step.value = 3;
  }
};

// 上一步
const prevStep = () => {
  if (step.value > 1) {
    // 編輯模式不能回到步驟1
    if (props.isEdit && step.value === 2) return;
    step.value--;
  }
};

// 初始化配置預設值
const initConfigDefaults = () => {
  const schema = currentHandlerType.value?.configSchema || [];
  const config = { ...formData.value.config };
  for (const field of schema) {
    if (config[field.name] === undefined && field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue;
    }
  }
  formData.value.config = config;
  configText.value = JSON.stringify(config, null, 2);
};

// 更新配置欄位值
const updateConfigField = (fieldName, value) => {
  formData.value.config = {
    ...formData.value.config,
    [fieldName]: value,
  };
};

// 關閉
const closeModal = () => {
  emit("close");
};

// 提交
const submitForm = async () => {
  if (!formValid.value || configError.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    if (props.isEdit) {
      await updateJob(formData.value.taskId, {
        handlerId: formData.value.handlerId,
        name: formData.value.name,
        description: formData.value.description,
        scheduleType: formData.value.scheduleType,
        intervalSec:
          formData.value.scheduleType === "interval"
            ? formData.value.intervalSec
            : undefined,
        cronExpression:
          formData.value.scheduleType === "cron"
            ? formData.value.cronExpression
            : undefined,
        enabled: formData.value.enabled,
        config: formData.value.config,
      });
    } else {
      // 建立時不再手動指定 taskId，由後端根據 handlerId 自動生成唯一作業ID
      await createJob({
        handlerId: formData.value.handlerId,
        name: formData.value.name,
        description: formData.value.description,
        scheduleType: formData.value.scheduleType,
        intervalSec:
          formData.value.scheduleType === "interval"
            ? formData.value.intervalSec
            : undefined,
        cronExpression:
          formData.value.scheduleType === "cron"
            ? formData.value.cronExpression
            : undefined,
        enabled: formData.value.enabled,
        config: formData.value.config,
      });
    }

    success.value = props.isEdit
      ? t("admin.scheduledJobs.updateSuccess")
      : t("admin.scheduledJobs.createSuccess");

    emit("success");
    setTimeout(() => {
      emit("close");
    }, 1000);
  } catch (err) {
    error.value = err.message || t("admin.scheduledJobs.createFailed");
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4 bg-black bg-opacity-50 overflow-y-auto"
    @click.self="closeModal"
  >
    <div
      class="w-full max-w-md sm:max-w-xl rounded-lg shadow-xl overflow-hidden transition-colors max-h-[85vh] sm:max-h-[80vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'"
      @click.stop
    >
      <!-- 頭部 -->
      <div
        class="px-4 sm:px-6 py-3 sm:py-4 border-b"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <h2 class="text-base sm:text-lg font-semibold">
          {{ isEdit ? t("admin.scheduledJobs.form.editTitle") : t("admin.scheduledJobs.form.createTitle") }}
        </h2>
        <!-- 步驟指示器 -->
        <div class="flex items-center mt-2 text-xs">
          <template v-for="(stepInfo, idx) in [
            { num: 1, label: t('admin.scheduledJobs.form.step1Title') },
            { num: 2, label: t('admin.scheduledJobs.form.step2Title') },
            { num: 3, label: t('admin.scheduledJobs.form.step3Title') },
          ]" :key="stepInfo.num">
            <div
              class="flex items-center"
              :class="step >= stepInfo.num ? 'text-primary-500' : (darkMode ? 'text-gray-500' : 'text-gray-400')"
            >
              <span
                class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium"
                :class="step >= stepInfo.num
                  ? 'bg-primary-500 text-white'
                  : (darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500')"
              >
                {{ stepInfo.num }}
              </span>
              <span class="ml-1 hidden sm:inline">{{ stepInfo.label }}</span>
            </div>
            <div
              v-if="idx < 2"
              class="w-8 h-px mx-2"
              :class="step > stepInfo.num ? 'bg-primary-500' : (darkMode ? 'bg-gray-700' : 'bg-gray-300')"
            ></div>
          </template>
        </div>
      </div>

      <!-- 內容 -->
      <div class="p-4 sm:p-6 space-y-4 flex-1 overflow-y-auto">
        <!-- 成功/錯誤提示 -->
        <div
          v-if="success"
          class="p-3 rounded-md text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
        >
          {{ success }}
        </div>
        <div
          v-if="error"
          class="p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {{ error }}
        </div>

        <!-- 步驟1：選擇handler型別 -->
        <div v-if="step === 1" class="space-y-4">
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.handlerType.select") }}
              <span class="text-red-500">*</span>
            </label>
            <select
              v-model="formData.handlerId"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'"
            >
              <option value="">{{ t("admin.scheduledJobs.handlerType.selectPlaceholder") }}</option>
              <option v-for="handler in handlerTypes" :key="handler.id" :value="handler.id">
                {{ handler.name }}
              </option>
            </select>
          </div>

          <!-- 選中的handler詳情 -->
          <div
            v-if="currentHandlerType"
            class="p-4 rounded-md border"
            :class="darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'"
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="font-medium">{{ currentHandlerType.name }}</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="getCategoryClass(currentHandlerType.category)"
              >
                {{ getCategoryLabel(currentHandlerType.category) }}
              </span>
            </div>
            <p class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
              {{ currentHandlerType.description }}
            </p>
          </div>
        </div>

        <!-- 步驟2：配置引數 -->
        <div v-if="step === 2" class="space-y-4">
          <!-- 任務名稱 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.name") }}
            </label>
            <input
              v-model="formData.name"
              type="text"
              :placeholder="t('admin.scheduledJobs.form.namePlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            />
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.nameHint") }}
            </p>
          </div>

          <!-- 任務描述 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.description") }}
            </label>
            <textarea
              v-model="formData.description"
              rows="2"
              :placeholder="t('admin.scheduledJobs.form.descriptionPlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            ></textarea>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.descriptionHint") }}
            </p>
          </div>

          <!-- 分隔線 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 模式切換 -->
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.scheduledJobs.form.configParams") }}
            </span>
            <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
              <button
                type="button"
                @click="configMode = 'form'"
                class="px-3 py-1 text-xs font-medium transition"
                :class="configMode === 'form'
                  ? 'bg-primary-500 text-white'
                  : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')"
              >
                {{ t("admin.scheduledJobs.form.modeForm") }}
              </button>
              <button
                type="button"
                @click="configMode = 'json'"
                class="px-3 py-1 text-xs font-medium transition"
                :class="configMode === 'json'
                  ? 'bg-primary-500 text-white'
                  : (darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')"
              >
                {{ t("admin.scheduledJobs.form.modeJson") }}
              </button>
            </div>
          </div>

          <!-- 表單模式 -->
          <div v-if="configMode === 'form'" class="space-y-4">
            <DynamicFormField
              v-for="field in currentHandlerType?.configSchema || []"
              :key="field.name"
              :field="field"
              :model-value="formData.config[field.name]"
              :dark-mode="darkMode"
              @update:model-value="updateConfigField(field.name, $event)"
            />
            <p
              v-if="!currentHandlerType?.configSchema?.length"
              class="text-sm"
              :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
            >
              {{ t("admin.scheduledJobs.form.noConfigParams") }}
            </p>
          </div>

          <!-- JSON模式 -->
          <div v-else class="space-y-2">
            <textarea
              v-model="configText"
              rows="10"
              :placeholder="t('admin.scheduledJobs.form.configPlaceholder')"
              class="w-full px-3 py-2 rounded-md border text-sm font-mono"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
            ></textarea>
            <p v-if="configError" class="text-xs text-red-500">
              {{ configError }}
            </p>
          </div>
        </div>

        <!-- 步驟3：執行計劃 -->
        <div v-if="step === 3" class="space-y-4">
          <!-- 排程型別 -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.scheduleType") }}
            </label>
            <select
              v-model="formData.scheduleType"
              class="w-full px-3 py-2 rounded-md border text-sm"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'"
            >
              <option value="interval">
                {{ t("admin.scheduledJobs.form.scheduleTypeInterval") }}
              </option>
              <option value="cron">
                {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
              </option>
            </select>
          </div>

          <!-- 執行間隔 -->
          <div v-if="formData.scheduleType === 'interval'">
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.intervalSec") }}
              <span class="text-red-500">*</span>
            </label>
            <div class="flex gap-2">
              <input
                v-model.number="intervalValue"
                type="number"
                min="1"
                class="flex-1 px-3 py-2 rounded-md border text-sm"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'"
              />
              <select
                v-model="intervalUnit"
                class="px-3 py-2 rounded-md border text-sm"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'"
              >
                <option v-for="unit in timeUnits" :key="unit.value" :value="unit.value">
                  {{ t(`admin.scheduledJobs.timeUnit.${unit.label}`) }}
                </option>
              </select>
            </div>

            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.scheduledJobs.form.intervalHint") }}
            </p>
          </div>

          <!-- Cron 表示式 -->
          <div v-if="formData.scheduleType === 'cron'">
            <label
              class="block text-sm font-medium mb-1"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.scheduleTypeCron") }}
            </label>
            <input
              v-model="formData.cronExpression"
              type="text"
              class="w-full px-3 py-2 rounded-md border text-sm font-mono"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'"
              placeholder="0 2 * * *"
            />
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ cronHint }}
            </p>
          </div>

          <!-- 啟用狀態 -->
          <div class="flex items-center gap-2">
            <input
              v-model="formData.enabled"
              type="checkbox"
              id="enabled"
              class="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
            />
            <label
              for="enabled"
              class="text-sm"
              :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
            >
              {{ t("admin.scheduledJobs.form.enabledLabel") }}
            </label>
          </div>

          <!-- 任務摘要 -->
          <div
            class="p-4 rounded-lg border"
            :class="darkMode ? 'bg-gray-700/30 border-gray-600' : 'bg-gray-50 border-gray-200'"
          >
            <h4 class="text-sm font-medium mb-3" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.scheduledJobs.form.summary") }}
            </h4>
            <dl class="text-sm space-y-2">
              <!-- 任務型別 -->
              <div class="flex">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.handlerType.title") }}:
                </dt>
                <dd :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  {{ currentHandlerType?.name || '-' }}
                </dd>
              </div>
              <!-- 執行間隔 -->
              <div class="flex">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.form.intervalSec") }}:
                </dt>
                <dd :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  <template v-if="formData.scheduleType === 'interval'">
                    {{ intervalValue }}
                    {{ t(`admin.scheduledJobs.timeUnit.${timeUnits.find(u => u.value === intervalUnit)?.label || 'hours'}`) }}
                    <span class="ml-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                      ({{ formData.intervalSec }} 秒)
                    </span>
                  </template>
                  <template v-else-if="formData.scheduleType === 'cron'">
                    <div class="space-y-1">
                      <div class="font-mono text-xs" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                        {{ formData.cronExpression || '-' }}
                      </div>
                      <div v-if="formData.cronExpression" class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getCronDescription(formData.cronExpression) }}
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    -
                  </template>
                </dd>
              </div>
              <!-- 啟用狀態 -->
              <div class="flex items-center">
                <dt class="w-24 flex-shrink-0" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.scheduledJobs.form.enabled") }}:
                </dt>
                <dd>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                    :class="formData.enabled
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'"
                  >
                    {{ formData.enabled ? t("admin.scheduledJobs.status.enabled") : t("admin.scheduledJobs.status.disabled") }}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <!-- 底部按鈕 -->
      <div
        class="px-4 sm:px-6 py-3 sm:py-4 border-t flex justify-between"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <div>
          <button
            v-if="step > 1 && !(isEdit && step === 2)"
            @click="prevStep"
            class="px-4 py-2 rounded-md text-sm font-medium transition"
            :class="darkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          >
            {{ t("admin.scheduledJobs.form.prevStep") }}
          </button>
        </div>
        <div class="flex gap-3">
          <button
            @click="closeModal"
            class="px-4 py-2 rounded-md text-sm font-medium transition"
            :class="darkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          >
            {{ t("admin.scheduledJobs.form.cancel") }}
          </button>
          <!-- 下一步按鈕 -->
          <button
            v-if="step < 3"
            @click="nextStep"
            :disabled="(step === 1 && !step1Valid) || (step === 2 && !step2Valid)"
            class="px-4 py-2 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ t("admin.scheduledJobs.form.nextStep") }}
          </button>
          <!-- 提交按鈕 -->
          <button
            v-if="step === 3"
            @click="submitForm"
            :disabled="!formValid || loading"
            class="px-4 py-2 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="loading" class="flex items-center">
              <svg class="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              {{ t("common.loading") }}
            </span>
            <span v-else>
              {{ isEdit ? t("admin.scheduledJobs.form.save") : t("admin.scheduledJobs.form.create") }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
