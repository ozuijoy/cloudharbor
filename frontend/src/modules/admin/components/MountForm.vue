<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { api } from "@/api";
import { IconClose, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("MountForm");
const { updateMount, createMount } = useAdminMountService();
const { getStorageConfigs } = useAdminStorageConfigService();
const { getGlobalSettings } = useAdminSystemService();

const props = defineProps({
  darkMode: { type: Boolean, required: true },
  mount: { type: Object, default: null },
  userType: { type: String, default: "admin", validator: (v) => ["admin", "apikey"].includes(v) },
});

const emit = defineEmits(["close", "save-success"]);

// === 核心狀態 ===
const schema = ref(null);
const storageConfigs = ref([]);
const formData = ref({});
const errors = ref({});
const loading = ref(false);
const submitting = ref(false);
const formSubmitted = ref(false);
const globalError = ref("");

// === 全域性代理簽名提示（用於避免“全域性強制 vs 掛載配置”理解混亂）===
const globalProxySignAll = ref(false);
const globalProxySignExpires = ref(0);
const globalProxySignExpiresLabel = computed(() => {
  const v = Number(globalProxySignExpires.value);
  if (!v || Number.isNaN(v)) return t("admin.mount.form.proxySign.globalExpiresForever");
  return t("admin.mount.form.proxySign.globalExpiresSeconds", { seconds: v });
});

// === 計算屬性 ===
const isEditMode = computed(() => !!props.mount);
const formTitle = computed(() => isEditMode.value ? t("admin.mount.editMount") : t("admin.mount.createMount"));
const isAdmin = computed(() => props.userType === "admin");

// 從儲存配置中提取可用的儲存型別
const availableStorageTypes = computed(() => {
  const types = [...new Set(storageConfigs.value.map((c) => c.storage_type).filter(Boolean))];
  return types.map((type) => ({
    value: type,
    label: t(`admin.mount.form.storageTypes.${type}`, type),
  }));
});

// 根據選擇的儲存型別篩選儲存配置
const filteredStorageConfigs = computed(() => {
  if (!formData.value.storage_type) return storageConfigs.value;
  return storageConfigs.value.filter((c) => c.storage_type === formData.value.storage_type);
});

// 當前選中的儲存配置
const selectedStorageConfig = computed(() => {
  if (!formData.value.storage_config_id) return null;
  return storageConfigs.value.find((c) => c.id === formData.value.storage_config_id) || null;
});

// 根據儲存能力計算可用的WebDAV策略
const availableWebdavPolicies = computed(() => {
  const cfg = selectedStorageConfig.value;
  const policies = Array.isArray(cfg?.webdav_supported_policies) ? cfg.webdav_supported_policies : null;
  if (policies && policies.length > 0) return policies;
  return ["native_proxy"];
});

// 按分組組織的欄位（支援新佈局格式）
const fieldGroups = computed(() => {
  if (!schema.value?.layout?.groups) return [];
  return schema.value.layout.groups.map((group) => ({
    ...group,
    title: group.titleKey ? t(group.titleKey) : group.id,
    // 解析佈局項（支援 row/card/full 型別）
    layoutItems: parseLayoutItems(group),
  }));
});

// === 欄位渲染輔助方法 ===
const getFieldLabel = (field) => (field.labelKey ? t(field.labelKey) : field.name);
const getFieldPlaceholder = (field) => (field.ui?.placeholderKey ? t(field.ui.placeholderKey) : "");
const getFieldDescription = (field) => (field.ui?.descriptionKey ? t(field.ui.descriptionKey) : "");

// 判斷是否應該顯示描述（避免與placeholder冗餘）
const shouldShowDescription = (field) => {
  // 這些欄位的描述提供了額外有用資訊，始終顯示
  const alwaysShowDesc = ["mount_path", "webdav_policy", "enable_sign", "sign_expires", "web_proxy"];
  if (alwaysShowDesc.includes(field.name)) return true;
  // 有placeholder的string/select型別，不顯示描述（避免冗餘）
  if ((field.type === "string" || field.type === "select") && field.ui?.placeholderKey) {
    return false;
  }
  return !!field.ui?.descriptionKey;
};

// 檢查欄位是否應該顯示（基於dependsOn條件）
const shouldShowField = (field) => {
  if (!field.dependsOn) return true;
  const { field: depField, value: depValue } = field.dependsOn;
  return formData.value[depField] === depValue;
};

// === 佈局解析輔助 ===
// 解析組內的佈局行（支援 { row: [...] } 和 { card: ... } 格式）
const parseLayoutItems = (group) => {
  if (!group?.fields) return [];

  return group.fields.map((item) => {
    // 物件形式：{ row: [...] } 或 { card: ... }
    if (typeof item === "object" && item !== null) {
      if (item.row) {
        return { type: "row", fields: item.row };
      }
      if (item.card) {
        return { type: "card", ...item };
      }
    }
    // 字串形式：單個欄位全寬顯示
    if (typeof item === "string") {
      return { type: "full", field: item };
    }
    return null;
  }).filter(Boolean);
};

// 判斷卡片是否應該顯示
const shouldShowCard = (card) => {
  if (!card.dependsOn) return true;
  return formData.value[card.dependsOn.field] === card.dependsOn.value;
};

// 檢查欄位是否屬於卡片內部（不在常規迴圈中顯示）
const isCardChildField = (fieldName, groups) => {
  if (!groups) return false;
  for (const group of groups) {
    if (!group.fields) continue;
    for (const item of group.fields) {
      if (typeof item === "object" && item?.card && item.fields?.includes(fieldName)) {
        return true;
      }
    }
  }
  return false;
};

// 根據欄位名獲取欄位定義
const getFieldByName = (fieldName) => {
  return schema.value?.fields?.find((f) => f.name === fieldName) || null;
};

// 獲取欄位的動態選項
const getFieldOptions = (field) => {
  const dynamicOpts = field.ui?.dynamicOptions;
  
  // 儲存型別選擇（從已有配置中提取）
  if (field.name === "storage_type" || dynamicOpts === "storageTypes") {
    return availableStorageTypes.value;
  }
  
  // 儲存配置選擇
  if (field.name === "storage_config_id" || dynamicOpts === "storageConfigs") {
    return filteredStorageConfigs.value.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.provider_type || c.storage_type})`,
    }));
  }
  
  // WebDAV策略
  if (field.name === "webdav_policy" || dynamicOpts === "webdavPolicies") {
    return availableWebdavPolicies.value.map((p) => ({
      value: p,
      label: t(`admin.mount.form.webdavPolicyOptions.${p}`, p),
    }));
  }
  
  return [];
};

// 檢查select欄位是否禁用
const isSelectDisabled = (field) => {
  if (loading.value) return true;
  if (field.name === "storage_config_id") {
    return !formData.value.storage_type || filteredStorageConfigs.value.length === 0;
  }
  if (field.name === "storage_type") {
    return availableStorageTypes.value.length === 0;
  }
  return false;
};

// === 驗證邏輯 ===
const validateField = (fieldName) => {
  const field = schema.value?.fields.find((f) => f.name === fieldName);
  if (!field) return true;

  const value = formData.value[fieldName];
  const newErrors = { ...errors.value };

  // 必填驗證
  if (field.required) {
    const isEmpty = value === undefined || value === null || String(value).trim() === "";
    if (isEmpty) {
      newErrors[fieldName] = t("admin.mount.validation.required", { field: getFieldLabel(field) });
      errors.value = newErrors;
      return false;
    }
  }

  // 自定義驗證規則
  const validation = field.validation;
  if (validation && value !== undefined && value !== null && value !== "") {
    // 最大長度
    if (validation.maxLength && String(value).length > validation.maxLength) {
      newErrors[fieldName] = t("admin.mount.validation.maxLength", { max: validation.maxLength });
      errors.value = newErrors;
      return false;
    }
    // 正則模式
    if (validation.pattern) {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(String(value))) {
        newErrors[fieldName] = validation.patternMessageKey 
          ? t(validation.patternMessageKey) 
          : t("admin.mount.validation.invalidFormat");
        errors.value = newErrors;
        return false;
      }
    }
    // 數值範圍
    if (field.type === "number") {
      const numVal = Number(value);
      if (validation.min !== undefined && numVal < validation.min) {
        newErrors[fieldName] = t("admin.mount.validation.min", { min: validation.min });
        errors.value = newErrors;
        return false;
      }
      if (validation.max !== undefined && numVal > validation.max) {
        newErrors[fieldName] = t("admin.mount.validation.max", { max: validation.max });
        errors.value = newErrors;
        return false;
      }
    }
  }

  // 掛載路徑特殊驗證（保持與原版一致的完整邏輯）
  if (fieldName === "mount_path" && value) {
    const mountPath = String(value).trim();
    if (!mountPath.startsWith("/")) {
      newErrors[fieldName] = t("admin.mount.validation.mountPathFormat");
      errors.value = newErrors;
      return false;
    }
    if (mountPath === "/") {
      // 不允許單獨的"/"，必須是"/xxx"格式
      newErrors[fieldName] = t("admin.mount.validation.mountPathInvalid");
      errors.value = newErrors;
      return false;
    }
    // 檢查掛載路徑格式，必須是"/xxx"格式
    // 只允許字母、數字、下劃線、連字元、中文和斜槓，且"/"後必須有內容
    const validPathRegex = /^\/(?:[A-Za-z0-9_\-\/]|[\u4e00-\u9fa5]|[\u0080-\uFFFF])+$/;
    if (!validPathRegex.test(mountPath)) {
      newErrors[fieldName] = t("admin.mount.validation.mountPathInvalid");
      errors.value = newErrors;
      return false;
    }
    // 檢查不允許的系統路徑
    const forbiddenPaths = ["/bin", "/etc", "/lib", "/root", "/sys", "/proc", "/dev"];
    for (const path of forbiddenPaths) {
      if (mountPath === path || mountPath.startsWith(`${path}/`)) {
        newErrors[fieldName] = t("admin.mount.validation.mountPathSystemReserved");
        errors.value = newErrors;
        return false;
      }
    }
  }

  delete newErrors[fieldName];
  errors.value = newErrors;
  return true;
};

const validateForm = () => {
  if (!schema.value?.fields) return false;
  
  let isValid = true;
  for (const field of schema.value.fields) {
    if (shouldShowField(field)) {
      if (!validateField(field.name)) {
        isValid = false;
      }
    }
  }
  
  if (!isValid) {
    globalError.value = t("common.required");
  } else {
    globalError.value = "";
  }
  
  return isValid;
};

// === 事件處理 ===
const handleFieldChange = (fieldName) => {
  // 儲存型別變化時清空不匹配的配置
  if (fieldName === "storage_type" && formData.value.storage_config_id) {
    const selectedConfig = storageConfigs.value.find((c) => c.id === formData.value.storage_config_id);
    if (selectedConfig && selectedConfig.storage_type !== formData.value.storage_type) {
      formData.value.storage_config_id = "";
    }
  }
  
  // 儲存配置變化時同步儲存型別
  if (fieldName === "storage_config_id" && formData.value.storage_config_id) {
    const selectedConfig = storageConfigs.value.find((c) => c.id === formData.value.storage_config_id);
    if (selectedConfig?.storage_type) {
      formData.value.storage_type = selectedConfig.storage_type;
    }
  }
  
  if (formSubmitted.value || errors.value[fieldName]) {
    validateField(fieldName);
  }
};

// === 表單提交 ===
const submitForm = async () => {
  formSubmitted.value = true;
  if (!validateForm()) return;

  submitting.value = true;
  globalError.value = "";

  try {
    const payload = { ...formData.value };
    
    // 轉換數字欄位
    if (payload.sort_order !== undefined) payload.sort_order = Number(payload.sort_order);
    if (payload.cache_ttl !== undefined) payload.cache_ttl = Number(payload.cache_ttl);
    if (payload.sign_expires !== undefined && payload.sign_expires !== null && payload.sign_expires !== "") {
      payload.sign_expires = Number(payload.sign_expires);
    } else {
      payload.sign_expires = null;
    }

    if (props.userType === "apikey") {
      globalError.value = t("admin.mount.error.apiKeyCannotManage");
      return;
    }

    if (isEditMode.value) {
      await updateMount(props.mount.id, payload);
    } else {
      await createMount(payload);
    }

    emit("save-success");
  } catch (err) {
    log.error("儲存掛載點錯誤:", err);
    globalError.value = err.message || t("admin.mount.error.saveFailed");
  } finally {
    submitting.value = false;
  }
};

// === 初始化 ===
const initFormData = () => {
  if (!schema.value?.fields) return;

  const data = {};
  for (const field of schema.value.fields) {
    if (props.mount && props.mount[field.name] !== undefined) {
      // 編輯模式：複製現有值
      if (field.type === "boolean") {
        data[field.name] = !!props.mount[field.name];
      } else {
        data[field.name] = props.mount[field.name];
      }
    } else {
      // 新建模式：使用預設值
      data[field.name] = field.defaultValue !== undefined ? field.defaultValue : (field.type === "boolean" ? false : "");
    }
  }

  // 編輯模式下，根據已選擇的儲存配置推斷 storage_type
  if (props.mount?.storage_config_id && !data.storage_type) {
    const selectedConfig = storageConfigs.value.find((c) => c.id === props.mount.storage_config_id);
    if (selectedConfig?.storage_type) {
      data.storage_type = selectedConfig.storage_type;
    }
  }

  formData.value = data;
};

const loadData = async () => {
  loading.value = true;
  try {
    // 並行載入Schema和儲存配置
    const [schemaResp, configsResp, globalSettings] = await Promise.all([
      api.mount.getMountSchema(),
      getStorageConfigs({ page: 1, limit: 100 }),
      getGlobalSettings().catch(() => []),
    ]);
    
    schema.value = schemaResp?.data || schemaResp;
    storageConfigs.value = Array.isArray(configsResp?.items) ? configsResp.items : [];

    // 讀取全域性代理簽名設定（僅用於提示，不影響掛載編輯）
    (Array.isArray(globalSettings) ? globalSettings : []).forEach((setting) => {
      if (setting?.key === "proxy_sign_all") {
        globalProxySignAll.value = setting.value === "true";
      }
      if (setting?.key === "proxy_sign_expires") {
        globalProxySignExpires.value = parseInt(setting.value, 10) || 0;
      }
    });
    
    initFormData();
  } catch (err) {
    log.error("載入資料錯誤:", err);
    globalError.value = err?.message || t("admin.mount.error.loadFailed");
  } finally {
    loading.value = false;
  }
};

const closeForm = () => emit("close");

// === 生命週期 ===
onMounted(loadData);

watch(() => props.mount, () => {
  initFormData();
  formSubmitted.value = false;
  globalError.value = "";
  errors.value = {};
}, { deep: true });

// 確保WebDAV策略始終是可用選項
watch([() => formData.value.storage_type, () => formData.value.storage_config_id], () => {
  const allowed = availableWebdavPolicies.value;
  if (formData.value.webdav_policy && !allowed.includes(formData.value.webdav_policy)) {
    formData.value.webdav_policy = allowed[0] || "native_proxy";
  }
});
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4 bg-black bg-opacity-50 overflow-y-auto" @click.self="closeForm">
    <div
      class="w-full max-w-sm sm:max-w-lg rounded-lg shadow-xl overflow-hidden transition-colors max-h-[80vh] sm:max-h-[75vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'"
      @click.stop
    >
      <!-- 表單標題 -->
      <div class="px-3 sm:px-6 py-2 sm:py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex justify-between items-center">
          <h3 class="text-base sm:text-lg font-semibold">{{ formTitle }}</h3>
          <button @click="closeForm" class="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none">
            <IconClose size="lg" />
          </button>
        </div>
      </div>

      <!-- 表單內容 -->
      <div class="p-3 sm:p-6 space-y-2 sm:space-y-4 flex-1 overflow-y-auto">
        <!-- 載入狀態 -->
        <div v-if="loading" class="flex justify-center items-center py-8">
          <IconRefresh size="xl" class="animate-spin text-primary-500" />
        </div>

        <template v-else-if="schema">
          <!-- 全域性錯誤 -->
          <div v-if="globalError" class="p-2 sm:p-3 rounded-md bg-red-100 border border-red-300 text-red-700 text-sm">
            {{ globalError }}
          </div>

          <form @submit.prevent="submitForm" class="space-y-4">
            <!-- 動態渲染欄位組 -->
            <div v-for="group in fieldGroups" :key="group.id" class="space-y-2">
                <h4 v-if="group.titleKey" class="text-sm font-medium border-b pb-1 mt-2" :class="darkMode ? 'text-gray-300 border-gray-600' : 'text-gray-700 border-gray-200'">
                  {{ group.title }}
                </h4>
                
                <!-- 基於佈局項動態渲染 -->
                <div v-for="(layoutItem, idx) in group.layoutItems" :key="`${group.id}-${idx}`" class="contents">
                  
                  <!-- === 全寬欄位 === -->
                  <template v-if="layoutItem.type === 'full'">
                    <div v-for="field in [getFieldByName(layoutItem.field)].filter(f => f && shouldShowField(f) && !isCardChildField(f.name, schema?.layout?.groups))" :key="field.name">
                        <!-- 渲染單個欄位（複用欄位渲染元件） -->
                        <template v-if="field.type === 'string'">
                          <label :for="field.name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getFieldLabel(field) }}
                            <span v-if="field.required" class="text-red-500">*</span>
                          </label>
                          <div class="relative">
                            <span v-if="field.ui?.prefix" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{{ field.ui.prefix }}</span>
                            <input :id="field.name" type="text" v-model="formData[field.name]" @input="handleFieldChange(field.name)" @blur="validateField(field.name)" :placeholder="getFieldPlaceholder(field)" :maxlength="field.ui?.maxLength" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500', errors[field.name] ? 'border-red-500' : '', field.ui?.prefix ? 'pl-6' : '']" />
                          </div>
                          <p v-if="errors[field.name]" class="mt-1 text-sm text-red-500">{{ errors[field.name] }}</p>
                          <p v-if="shouldShowDescription(field)" class="mt-0.5 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ getFieldDescription(field) }}</p>
                        </template>
                        <template v-else-if="field.type === 'textarea'">
                          <label :for="field.name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ getFieldLabel(field) }}</label>
                          <textarea :id="field.name" v-model="formData[field.name]" :rows="field.ui?.rows || 2" :placeholder="getFieldPlaceholder(field)" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"></textarea>
                        </template>
                        <template v-else-if="field.type === 'number'">
                          <label :for="field.name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ getFieldLabel(field) }}</label>
                          <div class="relative">
                            <input :id="field.name" type="number" v-model="formData[field.name]" @input="handleFieldChange(field.name)" @blur="validateField(field.name)" :placeholder="getFieldPlaceholder(field)" :min="field.ui?.min" :max="field.ui?.max" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500', errors[field.name] ? 'border-red-500' : '']" />
                            <span v-if="field.ui?.suffix" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ field.ui.suffix.startsWith('admin.') ? t(field.ui.suffix) : field.ui.suffix }}</span>
                          </div>
                          <p v-if="errors[field.name]" class="mt-1 text-sm text-red-500">{{ errors[field.name] }}</p>
                          <p v-if="shouldShowDescription(field)" class="mt-0.5 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ getFieldDescription(field) }}</p>
                        </template>
                        <template v-else-if="field.type === 'select'">
                          <label :for="field.name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getFieldLabel(field) }}
                            <span v-if="field.required" class="text-red-500">*</span>
                          </label>
                          <select :id="field.name" v-model="formData[field.name]" @change="handleFieldChange(field.name)" @blur="validateField(field.name)" :disabled="isSelectDisabled(field)" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900', errors[field.name] ? 'border-red-500' : '']">
                            <option value="">{{ getFieldPlaceholder(field) || t('common.pleaseSelect') }}</option>
                            <option v-for="opt in getFieldOptions(field)" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                          </select>
                          <p v-if="errors[field.name]" class="mt-1 text-sm text-red-500">{{ errors[field.name] }}</p>
                          <p v-if="shouldShowDescription(field)" class="mt-0.5 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ getFieldDescription(field) }}</p>
                          <p v-if="field.name === 'storage_config_id' && !formData.storage_type" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t('admin.mount.form.selectStorageTypeFirst') }}</p>
                          <p v-if="field.name === 'storage_config_id' && formData.storage_type && filteredStorageConfigs.length === 0" class="mt-1 text-xs text-yellow-600 dark:text-yellow-400">{{ t('admin.mount.form.noConfigsForType') }}</p>
                        </template>
                        <template v-else-if="field.type === 'boolean'">
                          <div class="flex items-center">
                            <input :id="field.name" type="checkbox" v-model="formData[field.name]" class="h-4 w-4 sm:h-5 sm:w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" :class="darkMode ? 'bg-gray-700 border-gray-600' : ''" />
                            <div class="ml-2 sm:ml-3">
                              <label :for="field.name" class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ getFieldLabel(field) }}</label>
                              <p v-if="shouldShowDescription(field)" class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ getFieldDescription(field) }}</p>
                            </div>
                          </div>
                        </template>
                    </div>
                  </template>

                  <!-- === 雙列布局 === -->
                  <div v-else-if="layoutItem.type === 'row'" class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                    <div v-for="fieldName in layoutItem.fields" :key="fieldName" class="contents">
                      <div v-for="field in [getFieldByName(fieldName)].filter(f => f && shouldShowField(f))" :key="field.name">
                          <label :for="field.name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ getFieldLabel(field) }}</label>
                          <div class="relative">
                            <input v-if="field.type === 'number'" :id="field.name" type="number" v-model="formData[field.name]" @input="handleFieldChange(field.name)" @blur="validateField(field.name)" :placeholder="getFieldPlaceholder(field)" :min="field.ui?.min" :max="field.ui?.max" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500', errors[field.name] ? 'border-red-500' : '']" />
                            <input v-else :id="field.name" type="text" v-model="formData[field.name]" @input="handleFieldChange(field.name)" @blur="validateField(field.name)" :placeholder="getFieldPlaceholder(field)" class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border" :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500', errors[field.name] ? 'border-red-500' : '']" />
                            <span v-if="field.ui?.suffix" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ field.ui.suffix.startsWith('admin.') ? t(field.ui.suffix) : field.ui.suffix }}</span>
                          </div>
                          <p v-if="errors[field.name]" class="mt-1 text-sm text-red-500">{{ errors[field.name] }}</p>
                          <p v-if="shouldShowDescription(field)" class="mt-0.5 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ getFieldDescription(field) }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- === 卡片佈局（代理簽名配置） === -->
                  <Transition
                    v-else-if="layoutItem.type === 'card'"
                    enter-active-class="transition-all duration-200 ease-out"
                    enter-from-class="opacity-0 -translate-y-1"
                    enter-to-class="opacity-100 translate-y-0"
                    leave-active-class="transition-all duration-150 ease-in"
                    leave-from-class="opacity-100 translate-y-0"
                    leave-to-class="opacity-0 -translate-y-1"
                  >
                    <div
                      v-if="shouldShowCard(layoutItem)"
                      class="mt-3 sm:mt-4 p-3 rounded-md border"
                      :class="darkMode ? 'bg-gray-800/50 border-gray-600' : 'bg-gray-50 border-gray-200'"
                    >
                      <!-- 卡片標題 -->
                      <h4
                        v-if="layoutItem.titleKey"
                        class="text-sm font-medium mb-3"
                        :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                      >
                        {{ t(layoutItem.titleKey) }}
                      </h4>

                      <!-- 全域性簽名強制提示 -->
                      <p
                        v-if="layoutItem.card === 'proxy_sign' && globalProxySignAll"
                        class="text-xs mb-3"
                        :class="darkMode ? 'text-red-400' : 'text-red-600'"
                      >
                        {{ t("admin.mount.form.proxySign.globalOverrideHint", { expires: globalProxySignExpiresLabel }) }}
                      </p>

                      <!-- 卡片內欄位 -->
                      <div class="space-y-3">
                        <div v-for="cardFieldName in layoutItem.fields" :key="cardFieldName" class="contents">
                          <div v-for="cardField in [getFieldByName(cardFieldName)].filter(Boolean)" :key="cardField.name">
                            <!-- enable_sign checkbox -->
                            <div v-if="cardField.type === 'boolean'" class="flex items-center">
                              <input
                                :id="cardField.name"
                                type="checkbox"
                                v-model="formData[cardField.name]"
                                class="h-4 w-4 sm:h-5 sm:w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                              />
                              <div class="ml-2 sm:ml-3">
                                <label :for="cardField.name" class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                                  {{ getFieldLabel(cardField) }}
                                </label>
                                <p v-if="shouldShowDescription(cardField)" class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                                  {{ getFieldDescription(cardField) }}
                                </p>
                              </div>
                            </div>

                            <!-- sign_expires 數字輸入（平級顯示，根據 enable_sign 禁用） -->
                            <div v-else-if="cardField.type === 'number'">
                              <label
                                :for="cardField.name"
                                class="block text-sm font-medium mb-1"
                                :class="[
                                  darkMode ? 'text-gray-200' : 'text-gray-700',
                                  cardField.name === 'sign_expires' && !formData.enable_sign ? 'opacity-50' : ''
                                ]"
                              >
                                {{ getFieldLabel(cardField) }}
                              </label>
                              <div class="relative">
                                <input
                                  :id="cardField.name"
                                  type="number"
                                  v-model="formData[cardField.name]"
                                  :disabled="cardField.name === 'sign_expires' && !formData.enable_sign"
                                  :placeholder="getFieldPlaceholder(cardField)"
                                  :min="cardField.ui?.min"
                                  :max="cardField.ui?.max"
                                  class="block w-full px-3 py-1.5 sm:py-2 rounded-md text-sm transition-colors border"
                                  :class="[
                                    darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                                    cardField.name === 'sign_expires' && !formData.enable_sign ? 'opacity-50 cursor-not-allowed' : ''
                                  ]"
                                />
                                <span
                                  v-if="cardField.ui?.suffix"
                                  class="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                                  :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                                >
                                  {{ cardField.ui.suffix.startsWith('admin.') ? t(cardField.ui.suffix) : cardField.ui.suffix }}
                                </span>
                              </div>
                              <p
                                v-if="shouldShowDescription(cardField)"
                                class="mt-0.5 text-xs"
                                :class="[
                                  darkMode ? 'text-gray-400' : 'text-gray-500',
                                  cardField.name === 'sign_expires' && !formData.enable_sign ? 'opacity-50' : ''
                                ]"
                              >
                                {{ getFieldDescription(cardField) }}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Transition>

                </div>
            </div>
          </form>
        </template>
      </div>

      <!-- 操作按鈕 -->
      <div
        class="px-3 sm:px-4 py-2 sm:py-3 border-t flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0"
        :class="darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'"
      >
        <button
          @click="closeForm"
          class="w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium transition-colors"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          :disabled="submitting"
        >
          {{ t("admin.mount.form.cancel") }}
        </button>
        <button
          type="button"
          @click="submitForm"
          :disabled="submitting || loading"
          class="w-full sm:w-auto flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium transition-colors text-white"
          :class="[submitting ? 'opacity-75 cursor-not-allowed' : 'hover:bg-primary-600', darkMode ? 'bg-primary-600' : 'bg-primary-500']"
        >
          <IconRefresh v-if="submitting" size="sm" class="animate-spin -ml-1 mr-2" />
          {{ submitting ? t("admin.mount.form.saving") : isEditMode ? t("admin.mount.form.save") : t("admin.mount.form.create") }}
        </button>
      </div>
    </div>
  </div>
</template>
