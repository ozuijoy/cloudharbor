<script setup>
import { ref, computed, watch, onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import {
  STORAGE_UNITS,
  getDefaultStorageByProvider,
  setStorageSizeFromBytes,
  calculateStorageBytes,
  normalizeDefaultFolder,
  isValidUrl,
} from "@/modules/storage-core/schema/adminStorageSchemas.js";
import { IconEye, IconEyeOff, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("ConfigForm");

// 接收屬性
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  config: {
    type: Object,
    default: null,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
});

// 定義事件
const emit = defineEmits(["close", "success"]);

// 儲存型別後設資料（從後端 /api/storage-types 動態載入，統一走 store 快取）
const storageConfigsStore = useStorageConfigsStore();
const { storageTypesMeta } = storeToRefs(storageConfigsStore);

// 表單資料
const formData = ref({
  name: "",
  storage_type: "",
});

// 儲存容量相關變數
const storageSize = ref("");
const storageUnit = ref(1024 * 1024 * 1024);
const storageUnits = STORAGE_UNITS;

const storageTypes = computed(() =>
  storageTypesMeta.value.map((meta) => ({
    value: meta.type,
    label: meta.displayName || meta.type,
  })),
);

const currentTypeMeta = computed(
  () => storageTypesMeta.value.find((meta) => meta.type === formData.value.storage_type) || null,
);

const providerTypes = computed(() => currentTypeMeta.value?.providerOptions || []);

// 當前儲存型別的配置 schema（用於動態表單）
const currentConfigSchema = computed(() => currentTypeMeta.value?.configSchema || null);
const layoutGroups = computed(() => currentConfigSchema.value?.layout?.groups || []);

// 一些欄位由外層統一處理，不在動態渲染中重複輸出
const FIELDS_HANDLED_EXTERNALLY = new Set(["name", "storage_type", "is_public"]);

// 表單狀態
const loading = ref(false);
const error = ref("");
const success = ref("");

const { getStorageConfigReveal, updateStorageConfig, createStorageConfig } = useAdminStorageConfigService();

const configIdRef = computed(() => (props.config && props.config.id) || null);
const currentType = computed(() => formData.value.storage_type || "");

// 計算表單標題與型別輔助標誌
const isWebDavType = computed(() => formData.value.storage_type === "WEBDAV");
const isOneDriveType = computed(() => currentType.value === "ONEDRIVE");
const isGoogleDriveType = computed(() => currentType.value === "GOOGLE_DRIVE");

const formTitle = computed(() => {
  return props.isEdit ? "編輯儲存配置" : "新增儲存配置";
});

// 輸入處理函式
const trimInput = (field) => {
  const value = formData.value[field];
  if (typeof value === "string") {
    formData.value[field] = value.trim();
  }
};

const formatUrl = (field) => {
  const value = formData.value[field];
  if (!value) {
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  let url = value.trim();
  // 通用規則：先去掉尾部多餘斜槓
  url = url.replace(/\/+$/, "");
  formData.value[field] = url;
};

const formatBucketName = () => {
  if (typeof formData.value.bucket_name === "string") {
    // 只去除空格
    formData.value.bucket_name = formData.value.bucket_name.trim();
  }
};

// 基於後端 schema 的欄位後設資料查詢
const getFieldMeta = (fieldName) => {
  const schema = currentConfigSchema.value;
  if (!schema?.fields) return null;
  return schema.fields.find((f) => f.name === fieldName) || null;
};

// 統一條件表達
const matchSchemaCondition = (condition) => {
  if (!condition || typeof condition !== "object") return false;
  const fieldName = condition.field;
  if (typeof fieldName !== "string" || !fieldName) return false;

  const currentValue = formData.value[fieldName];

  // 相容兩種寫法：equals / value
  if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
    return currentValue === condition.equals;
  }
  if (Object.prototype.hasOwnProperty.call(condition, "value")) {
    return currentValue === condition.value;
  }

  if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) {
    return currentValue !== condition.notEquals;
  }

  if (Array.isArray(condition.values)) {
    return condition.values.includes(currentValue);
  }

  if (condition.truthy === true) {
    return !!currentValue;
  }
  if (condition.falsy === true) {
    return !currentValue;
  }

  return false;
};

const shouldRenderField = (fieldName) => {
  if (FIELDS_HANDLED_EXTERNALLY.has(fieldName)) return false;
  const meta = getFieldMeta(fieldName);
  if (!meta) return false;

  const dependsOn = meta?.ui?.dependsOn;
  if (dependsOn && typeof dependsOn === "object") {
    const depField = dependsOn.field;
    if (typeof depField === "string" && depField) {
      const currentValue = formData.value[depField];
      if (Object.prototype.hasOwnProperty.call(dependsOn, "value")) {
        return currentValue === dependsOn.value;
      }
      if (Array.isArray(dependsOn.values)) {
        return dependsOn.values.includes(currentValue);
      }
      if (dependsOn.truthy === true) {
        return !!currentValue;
      }
    }
  }

  return true;
};

/**
 * 判斷欄位是否應該被禁用
 * - 統一使用後端 schema 的 ui.disabledWhen 描述
 */
const isFieldDisabled = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  const disabledWhen = meta?.ui?.disabledWhen;
  if (disabledWhen && typeof disabledWhen === "object") {
    return matchSchemaCondition(disabledWhen);
  }
  return false;
};

// ===== secret 欄位 =====
const secretVisibleByField = reactive({});
const secretsLoaded = ref(false);
const secretsRevealing = ref(false);

const getSecretFieldNames = () => {
  const schema = currentConfigSchema.value;
  if (!schema?.fields) return [];
  return schema.fields
    .filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name)
    .map((f) => f.name);
};

const resetSecretUiState = () => {
  for (const key of Object.keys(secretVisibleByField)) {
    delete secretVisibleByField[key];
  }
  secretsLoaded.value = false;
  secretsRevealing.value = false;
};

/**
 * 獲取組內的佈局行（支援新格式）
 * - 陣列項 ["field1", "field2"] → 並排渲染
 * - 字串項 "field" → 全寬渲染
 * @param {object} group
 * @returns {Array<{type: 'row'|'full', fields?: string[], field?: string}>}
 */
const getLayoutRowsForGroup = (group) => {
  if (!group || !Array.isArray(group.fields)) return [];

  return group.fields
    .map((item) => {
      if (Array.isArray(item)) {
        // 並排欄位：過濾掉不可渲染的欄位
        const renderableFields = item.filter((name) => shouldRenderField(name));
        if (renderableFields.length === 0) return null;
        return { type: "row", fields: renderableFields };
      } else if (typeof item === "string") {
        // 全寬欄位
        if (!shouldRenderField(item)) return null;
        return { type: "full", field: item };
      }
      return null;
    })
    .filter(Boolean);
};

const getFieldType = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.type || "string";
};

const isSecretField = (fieldName) => getFieldType(fieldName) === "secret";
const isSecretVisible = (fieldName) => !!secretVisibleByField[fieldName];
const isSecretRevealing = (_fieldName) => secretsRevealing.value;
const getSecretInputType = (fieldName) => (isSecretVisible(fieldName) ? "text" : "password");

const handleSecretToggle = async (fieldName) => {
  if (!isSecretField(fieldName)) return;

  const nextVisible = !isSecretVisible(fieldName);

  // 新建時：只做前端可見性切換，不請求 reveal
  if (!props.isEdit || !configIdRef.value) {
    secretVisibleByField[fieldName] = nextVisible;
    return;
  }

  // 編輯時：首次展開任意一個 secret 欄位時，拉一次 plain，把所有 secret 欄位一起填充
  if (nextVisible && !secretsLoaded.value && !secretsRevealing.value) {
    secretsRevealing.value = true;
    try {
      const resp = await getStorageConfigReveal(configIdRef.value, "plain");
      const data = resp?.data || resp || {};

      const secretFields = getSecretFieldNames();
      for (const key of secretFields) {
        formData.value[key] = data[key] || "";
      }

      secretsLoaded.value = true;
    } catch (e) {
      error.value = e?.message || "獲取儲存金鑰失敗";
    } finally {
      secretsRevealing.value = false;
    }
  }

  secretVisibleByField[fieldName] = nextVisible;
};

const getFieldLabel = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.labelKey) {
    return t(meta.labelKey);
  }
  return fieldName;
};

/**
 * 獲取欄位佔位符文字
 */
const getFieldPlaceholder = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.placeholderKey) {
    return t(meta.ui.placeholderKey);
  }
  return "";
};

/**
 * 獲取欄位描述文字
 */
const getFieldDescription = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.descriptionKey) {
    return t(meta.ui.descriptionKey);
  }
  return "";
};

/**
 * 獲取布林欄位的顯示值（用於並排佈局中的核取方塊標籤）
 */
const getBooleanDisplayValue = (fieldName) => {
  return formData.value[fieldName] ? t("common.enabled") : t("common.disabled");
};

/**
 * 檢查欄位是否標記為全寬
 */
const isFieldFullWidth = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.ui?.fullWidth === true;
};

const getEnumOptions = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (Array.isArray(meta?.enumValues) && meta.enumValues.length > 0) {
    return meta.enumValues;
  }
  // provider_type 預設複用後端提供的 providerOptions
  if (fieldName === "provider_type" && Array.isArray(providerTypes.value)) {
    return providerTypes.value;
  }
  return [];
};

const isEnumToggle = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.type !== "enum") return false;
  if (meta?.ui?.renderAs !== "toggle") return false;
  const opts = getEnumOptions(fieldName);
  return Array.isArray(opts) && opts.length === 2;
};

const getEnumToggleValues = (fieldName) => {
  const opts = getEnumOptions(fieldName);
  const values = (opts || []).map((o) => o?.value).filter(Boolean);
  // 優先識別 Telegram 的常用值，避免依賴 options 順序
  const onValue = values.includes("self_hosted") ? "self_hosted" : values[1];
  const offValue = values.includes("official") ? "official" : values[0];
  return { onValue, offValue };
};

const getEnumToggleLabel = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (meta?.ui?.toggleLabelKey) {
    return t(meta.ui.toggleLabelKey);
  }

  const { onValue } = getEnumToggleValues(fieldName);
  const opts = getEnumOptions(fieldName) || [];
  const onOpt = opts.find((o) => o?.value === onValue) || null;
  if (onOpt?.labelKey) return t(onOpt.labelKey);
  return onOpt?.label || String(onValue || "");
};

const handleEnumToggleChange = (fieldName, checked) => {
  const { onValue, offValue } = getEnumToggleValues(fieldName);
  formData.value[fieldName] = checked ? onValue : offValue;
};

const isUrlField = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.validation?.rule === "url";
};

const isAbsPathField = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  return meta?.validation?.rule === "abs_path";
};

const isFieldRequiredOnCreate = (fieldName) => {
  const meta = getFieldMeta(fieldName);
  if (!meta) return false;

  // 條件必填：requiredWhen 命中時，視為必填
  const requiredWhen = meta?.requiredWhen;
  if (requiredWhen && typeof requiredWhen === "object") {
    if (matchSchemaCondition(requiredWhen)) {
      return true;
    }
  }

  // 編輯
  if (props.isEdit) {
    return !!meta.required;
  }

  // 新建
  if (meta.requiredOnCreate === true) {
    return true;
  }
  return !!meta.required;
};

/**
 * 判斷欄位值是否為掩碼（未修改的金鑰）
 * 掩碼格式：以 * 開頭的字串，如 "********abcd"
 */
const isMaskedValue = (value) => {
  return typeof value === "string" && value.startsWith("*");
};

/**
 * 歸一化布林欄位的取值：
 */
const normalizeBooleanLike = (value) => {
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return value;
};

const normalizeFormBooleans = (schema = currentConfigSchema.value) => {
  // 頂層欄位：後端儲存為 0/1
  formData.value.is_public = normalizeBooleanLike(formData.value.is_public);

  // schema 內 boolean 欄位：統一轉換為 boolean
  if (!schema?.fields) return;
  for (const field of schema.fields) {
    if (!field || field.type !== "boolean" || !field.name) continue;
    formData.value[field.name] = normalizeBooleanLike(formData.value[field.name]);
  }
};

// 基於 schema.defaultValue 填充預設值
// 只在當前欄位為空（undefined/null/空字串）時寫入，避免覆蓋使用者輸入或編輯態資料
const applySchemaDefaultValues = (schema = currentConfigSchema.value) => {
  if (!schema?.fields) return;
  for (const field of schema.fields) {
    const key = field?.name;
    if (!key) continue;
    const current = formData.value[key];
    if ((current === undefined || current === null || current === "") && field.defaultValue !== undefined) {
      formData.value[key] = field.defaultValue;
    }
  }
};

// 欄位級 blur 處理：複用已有工具邏輯
const handleFieldBlur = (fieldName) => {
  if (fieldName === "name") {
    trimInput("name");
    return;
  }
  if (fieldName === "default_folder") {
    formData.value.default_folder = normalizeDefaultFolder(formData.value.default_folder);
    return;
  }
  if (fieldName === "endpoint_url") {
    formatUrl("endpoint_url");
    return;
  }
  if (isUrlField(fieldName)) {
    formatUrl(fieldName);
    return;
  }
  trimInput(fieldName);
};

const buildPayload = () => {
  const base = {
    name: formData.value.name,
    storage_type: formData.value.storage_type,
    is_public: formData.value.is_public,
  };

  // 容量限制不在 schema 中，單獨處理
  if (formData.value.total_storage_bytes !== undefined) {
    base.total_storage_bytes = formData.value.total_storage_bytes;
  }

  const extra = {};
  const schema = currentConfigSchema.value;
  if (schema?.fields) {
    for (const field of schema.fields) {
      const key = field.name;
      if (FIELDS_HANDLED_EXTERNALLY.has(key)) continue;
      const value = formData.value[key];
      if (value !== undefined) {
        extra[key] = value;
      }
    }
  }

  return {
    ...base,
    ...extra,
  };
};

// 表單驗證：基於 schema + 通用規則
const formValid = computed(() => {
  const hasName = Boolean(formData.value.name && formData.value.name.trim());
  if (!hasName || !formData.value.storage_type) {
    return false;
  }

  const schema = currentConfigSchema.value;
  if (!schema || !Array.isArray(schema.fields)) {
    return true;
  }

  for (const field of schema.fields) {
    const key = field.name;
    if (FIELDS_HANDLED_EXTERNALLY.has(key)) continue;

    const value = formData.value[key];
    const requiredOnCreate = isFieldRequiredOnCreate(key);

    if (requiredOnCreate) {
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0);
      if (missing) {
        return false;
      }
    }

    if (field.validation?.rule === "url") {
      if (value && !isValidUrl(value)) {
        return false;
      }
    }

    if (field.validation?.rule === "abs_path" && typeof value === "string") {
      const trimmed = value.trim();
      const isPosixAbs = trimmed.startsWith("/");
      const isWinAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
      if (!isPosixAbs && !isWinAbs) {
        return false;
      }
    }
  }

  return true;
});

// 照顧當前已有的 S3/MIRROR 體驗。
const ensureTypeDefaults = () => {
  const type = currentType.value;

  if (type === "S3") {
    const providerType = formData.value.provider_type;
    if (!providerType) return;
    if (formData.value.endpoint_url) return;

    switch (providerType) {
      case "Cloudflare R2":
        formData.value.endpoint_url = "https://<accountid>.r2.cloudflarestorage.com";
        formData.value.region = "auto";
        formData.value.path_style = false;
        break;
      case "Backblaze B2":
        formData.value.endpoint_url = "https://s3.us-west-000.backblazeb2.com";
        formData.value.region = "";
        formData.value.path_style = true;
        break;
      case "AWS S3":
        formData.value.endpoint_url = "https://s3.amazonaws.com";
        formData.value.path_style = false;
        break;
      case "Aliyun OSS":
        formData.value.endpoint_url = "https://oss-cn-hangzhou.aliyuncs.com";
        formData.value.region = "oss-cn-hangzhou";
        formData.value.path_style = false;
        break;
      default:
        formData.value.endpoint_url = "https://your-s3-endpoint.com";
        formData.value.path_style = false;
        break;
    }
  }

  if (type === "MIRROR") {
    const preset = formData.value.preset;
    if (!preset) return;
    const currentEndpoint = (formData.value.endpoint_url || "").trim();

    const defaultsByPreset = {
      tuna: "https://mirrors.tuna.tsinghua.edu.cn/",
      ustc: "https://mirrors.ustc.edu.cn/",
      aliyun: "https://mirrors.aliyun.com/",
    };

    const key = String(preset).trim().toLowerCase();
    const nextDefault = defaultsByPreset[key] || "";
    if (!nextDefault) return;

    if (!currentEndpoint) {
      formData.value.endpoint_url = nextDefault;
      return;
    }

    const knownDefaults = new Set(Object.values(defaultsByPreset));
    if (knownDefaults.has(currentEndpoint)) {
      formData.value.endpoint_url = nextDefault;
    }
  }
};

// 監聽提供商變化（S3 預設 endpoint 由 per-type 行為配置填充）
watch(
  () => formData.value.provider_type,
  () => {
    ensureTypeDefaults();
  },
);

// 監聽 MIRROR preset 變化（選擇模板後自動回填 endpoint_url）
watch(
  () => [formData.value.storage_type, formData.value.preset],
  ([type]) => {
    if (type === "MIRROR") {
      ensureTypeDefaults();
    }
  },
);

// 切換儲存型別時，secret 可見性與 reveal 狀態必須重置（避免“上一個型別的金鑰狀態串到下一個型別”）
watch(
  () => currentType.value,
  () => {
    resetSecretUiState();
  },
);

// 監聽編輯的配置變化
watch(
  () => props.config,
  () => {
    resetSecretUiState();
    const config = props.config;
    if (config) {
      const type = config.storage_type || (storageTypes.value[0]?.value || "");
      const next = { ...config, storage_type: type };

      // Google Drive：如果未顯式設定 root_id，則編輯表單中統一展示為 "root"
      if (
        next.storage_type === "GOOGLE_DRIVE" &&
        (!next.root_id || String(next.root_id).trim().length === 0)
      ) {
        next.root_id = "root";
      }

      formData.value = next;
      normalizeFormBooleans();

      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(formData.value.total_storage_bytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    } else {
      const type = storageTypes.value[0]?.value || "";
      formData.value = {
        name: "",
        storage_type: type,
      };
      normalizeFormBooleans();
      const defaultBytes = getDefaultStorageByProvider("Cloudflare R2");
      formData.value.total_storage_bytes = defaultBytes;
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(defaultBytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  },
  { immediate: true },
);

// 監聽provider_type變化，自動設定預設儲存容量
watch(
  () => formData.value.provider_type,
  (newProvider) => {
    if (!formData.value.total_storage_bytes) {
      const defaultBytes = getDefaultStorageByProvider(newProvider);
      formData.value.total_storage_bytes = defaultBytes;
      const sizeState = { storageSize: "", storageUnit: storageUnit.value };
      setStorageSizeFromBytes(defaultBytes, sizeState);
      storageSize.value = sizeState.storageSize;
      storageUnit.value = sizeState.storageUnit;
    }
  },
);

// 監聽儲存大小和單位的變化
watch([storageSize, storageUnit], () => {
  formData.value.total_storage_bytes = calculateStorageBytes({
    storageSize: storageSize.value,
    storageUnit: storageUnit.value,
  });
});

// 當 schema 載入完成或 storage_type 切換時，確保布林欄位已歸一化
watch(
  () => currentConfigSchema.value,
  (schema) => {
    if (!schema) return;
    applySchemaDefaultValues(schema);
    normalizeFormBooleans(schema);
    ensureTypeDefaults();
  },
);

// 提交表單
const submitForm = async () => {
  loading.value = true;
  error.value = "";
  success.value = "";

  try {
    let savedConfig;
    if (props.isEdit && props.config?.id) {
      const updateData = { ...buildPayload() };

      // 通用規則：所有 secret 欄位（按後端 schema 定義）在編輯時都遵循：
      // - 空值：不提交（保留原值）
      // - masked 佔位符（*****1234）：不提交（保留原值）
      const schema = currentConfigSchema.value;
      const secretFields = Array.isArray(schema?.fields)
        ? schema.fields
            .filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name)
            .map((f) => f.name)
        : [];

      for (const fieldName of secretFields) {
        if (!Object.prototype.hasOwnProperty.call(updateData, fieldName)) continue;
        const raw = updateData[fieldName];
        const str = typeof raw === "string" ? raw.trim() : "";
        const shouldSkip = raw === null || raw === undefined || str.length === 0 || isMaskedValue(str);
        if (shouldSkip) {
          delete updateData[fieldName];
        }
      }

      savedConfig = await updateStorageConfig(props.config.id, updateData);
    } else {
      savedConfig = await createStorageConfig(buildPayload());
    }

    success.value = props.isEdit ? "儲存配置更新成功！" : "儲存配置建立成功！";
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        const configId = props.isEdit ? props.config?.id : savedConfig?.data?.id || savedConfig?.id;
        window.dispatchEvent(
          new CustomEvent("cloudharbor:storage-config-changed", {
            detail: {
              id: configId || null,
              storage_type: formData.value.storage_type || null,
            },
          }),
        );
      }
    } catch {}
    emit("success", savedConfig);
    setTimeout(() => {
      emit("close");
    }, 1000);
  } catch (err) {
    log.error("儲存配置操作失敗:", err);
    error.value = err.message || "操作失敗，請重試";
  } finally {
    loading.value = false;
  }
};

// 處理關閉模態框
const closeModal = () => {
  emit("close");
};

// 初始化：載入儲存型別後設資料
onMounted(async () => {
  try {
    await storageConfigsStore.loadStorageTypes();
    if (!formData.value.storage_type && storageTypes.value.length > 0) {
      formData.value.storage_type = storageTypes.value[0].value;
    }
    // schema 預設值填充
    applySchemaDefaultValues(currentConfigSchema.value);
    normalizeFormBooleans();
  } catch (e) {
    log.error("載入儲存型別後設資料失敗:", e);
  }
});
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4 bg-black bg-opacity-50 overflow-y-auto" @click.self="closeModal">
    <div
      class="w-full max-w-md sm:max-w-xl rounded-lg shadow-xl overflow-hidden transition-colors max-h-[85vh] sm:max-h-[80vh] flex flex-col"
      :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'"
      @click.stop
    >
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h2 class="text-base sm:text-lg font-semibold">{{ formTitle }}</h2>
      </div>

      <div class="p-4 sm:p-6 space-y-3 sm:space-y-4 flex-1 overflow-y-auto">
        <div v-if="success" class="p-3 rounded-md text-sm font-medium mb-4 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
          {{ success }}
        </div>
        <div v-if="error" class="p-3 rounded-md text-sm font-medium mb-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {{ error }}
        </div>

        <!-- 表單欄位 -->
        <form @submit.prevent="submitForm" class="space-y-6">
          <!-- 基本資訊 -->
          <div class="space-y-4">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">基本資訊</h3>

            <div>
              <label for="storage_type" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                儲存型別 <span class="text-red-500">*</span>
              </label>
              <select
                id="storage_type"
                v-model="formData.storage_type"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
              >
                <option v-for="type in storageTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">請先選擇儲存型別。</p>
            </div>

            <!-- 配置名稱 -->
            <div>
              <label for="name" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 配置名稱 <span class="text-red-500">*</span> </label>
              <input
                type="text"
                id="name"
                v-model="formData.name"
                required
                @blur="trimInput('name')"
                class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                placeholder="例如：我的備份儲存"
              />
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">為此配置指定一個易於識別的名稱</p>
            </div>

            <!-- 容量限制 -->
            <div>
              <label for="storage_size" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'"> 儲存容量限制 </label>
              <div class="flex space-x-2">
                <input
                  type="number"
                  id="storage_size"
                  v-model="storageSize"
                  min="0"
                  step="0.01"
                  class="block w-2/3 px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                  placeholder="例如：10"
                />
                <select
                  v-model="storageUnit"
                  class="block w-1/3 px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                >
                  <option v-for="unit in storageUnits" :key="unit.value" :value="unit.value">{{ unit.label }}</option>
                </select>
              </div>
              <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                用於限制該儲存的最大可用容量（預設 10GB，清空=不限額）
              </p>
            </div>

            <!-- schema 驅動的儲存配置 -->
            <div v-if="currentConfigSchema && layoutGroups && layoutGroups.length" class="space-y-4">
              <div
                v-for="group in layoutGroups"
                :key="group.name"
                class="space-y-3"
              >
                <h3
                  class="text-sm font-medium border-b pb-2"
                  :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'"
                >
                  {{ group.titleKey ? t(group.titleKey) : "儲存配置" }}
                </h3>

                <!-- 遍歷佈局行 -->
                <template v-for="(row, rowIndex) in getLayoutRowsForGroup(group)">
                  <!-- 並排欄位行 -->
                  <div v-if="row.type === 'row'" :key="`row-${rowIndex}`" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div v-for="fieldName in row.fields" :key="fieldName">
                      <!-- 布林型別：勾選框 -->
                      <template v-if="getFieldType(fieldName) === 'boolean'">
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                        </label>
                        <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                          <input
                            type="checkbox"
                            :id="fieldName"
                            v-model="formData[fieldName]"
                            class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                          />
                          <label :for="fieldName" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getBooleanDisplayValue(fieldName) }}
                          </label>
                        </div>
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- 列舉：下拉選擇 -->
                      <template v-else-if="getFieldType(fieldName) === 'enum'">
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                          <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                        </label>
                        <div
                          v-if="isEnumToggle(fieldName)"
                          class="flex items-center h-10 px-3 py-2 rounded-md border"
                          :class="darkMode ? 'border-gray-600' : 'border-gray-300'"
                        >
                          <input
                            type="checkbox"
                            :id="fieldName"
                            :checked="formData[fieldName] === getEnumToggleValues(fieldName).onValue"
                            @change="handleEnumToggleChange(fieldName, $event.target.checked)"
                            class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                          />
                          <label :for="fieldName" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                            {{ getEnumToggleLabel(fieldName) }}
                          </label>
                        </div>
                        <select
                          v-else
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                        >
                          <option
                            v-for="opt in getEnumOptions(fieldName)"
                            :key="opt.value"
                            :value="opt.value"
                          >
                            {{ opt.labelKey ? t(opt.labelKey) : opt.label || opt.value }}
                          </option>
                        </select>
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- secret：密碼欄位 -->
                      <template v-else-if="getFieldType(fieldName) === 'secret'">
                        <div class="flex items-center justify-between mb-1">
                          <label
                            :for="fieldName"
                            class="block text-sm font-medium"
                            :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                          >
                            {{ getFieldLabel(fieldName) }}
                            <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                          </label>
                          <button
                            v-if="isSecretField(fieldName)"
                            type="button"
                            @click.stop="handleSecretToggle(fieldName)"
                            class="inline-flex items-center px-2 py-1 rounded text-xs flex-shrink-0"
                            :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                            :disabled="isSecretRevealing(fieldName)"
                          >
                            <IconEye v-if="!isSecretRevealing(fieldName) && !isSecretVisible(fieldName)" size="sm" />
                            <IconEyeOff v-else-if="!isSecretRevealing(fieldName) && isSecretVisible(fieldName)" size="sm" />
                            <IconRefresh v-else size="sm" class="animate-spin" />
                          </button>
                        </div>
                        <input
                          :type="getSecretInputType(fieldName)"
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          :required="isFieldRequiredOnCreate(fieldName) && !isEdit"
                          :placeholder="getFieldPlaceholder(fieldName)"
                          autocomplete="new-password"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                        />
                        <p v-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>

                      <!-- 數字 / 文字欄位 -->
                      <template v-else>
                        <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(fieldName) }}
                          <span v-if="isFieldRequiredOnCreate(fieldName)" class="text-red-500">*</span>
                        </label>
                        <input
                          :type="getFieldType(fieldName) === 'number' ? 'number' : 'text'"
                          :id="fieldName"
                          v-model="formData[fieldName]"
                          :required="isFieldRequiredOnCreate(fieldName)"
                          :disabled="isFieldDisabled(fieldName)"
                          :placeholder="getFieldPlaceholder(fieldName)"
                          @blur="handleFieldBlur(fieldName)"
                          class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                          :class="[
                            darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                            isUrlField(fieldName) && formData[fieldName] && !isValidUrl(formData[fieldName]) ? 'border-red-500' : '',
                            isFieldDisabled(fieldName) ? 'opacity-50 cursor-not-allowed' : '',
                          ]"
                        />
                        <p v-if="isUrlField(fieldName) && formData[fieldName] && !isValidUrl(formData[fieldName])" class="mt-1 text-xs text-red-500">
                          請輸入有效的 URL 格式，如 https://xxx.com
                        </p>
                        <p v-else-if="getFieldDescription(fieldName)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                          {{ getFieldDescription(fieldName) }}
                        </p>
                      </template>
                    </div>
                  </div>

                  <!-- 全寬欄位 -->
                  <div v-else-if="row.type === 'full'" :key="`full-${rowIndex}`" class="w-full">
                    <!-- 布林型別：勾選框 -->
                    <template v-if="getFieldType(row.field) === 'boolean'">
                      <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                        <input
                          type="checkbox"
                          :id="row.field"
                          v-model="formData[row.field]"
                          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                        />
                        <label :for="row.field" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getFieldLabel(row.field) }}
                        </label>
                      </div>
                      <p v-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- 列舉：下拉選擇 -->
                    <template v-else-if="getFieldType(row.field) === 'enum'">
                      <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                        {{ getFieldLabel(row.field) }}
                        <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                      </label>
                      <div
                        v-if="isEnumToggle(row.field)"
                        class="flex items-center h-10 px-3 py-2 rounded-md border"
                        :class="darkMode ? 'border-gray-600' : 'border-gray-300'"
                      >
                        <input
                          type="checkbox"
                          :id="row.field"
                          :checked="formData[row.field] === getEnumToggleValues(row.field).onValue"
                          @change="handleEnumToggleChange(row.field, $event.target.checked)"
                          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                        />
                        <label :for="row.field" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                          {{ getEnumToggleLabel(row.field) }}
                        </label>
                      </div>
                      <select
                        v-else
                        :id="row.field"
                        v-model="formData[row.field]"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300 text-gray-900'"
                      >
                        <option
                          v-for="opt in getEnumOptions(row.field)"
                          :key="opt.value"
                          :value="opt.value"
                        >
                          {{ opt.labelKey ? t(opt.labelKey) : opt.label || opt.value }}
                        </option>
                      </select>
                      <p v-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- secret：密碼欄位 -->
                    <template v-else-if="getFieldType(row.field) === 'secret'">
                      <div class="flex items-center justify-between mb-1">
                        <label
                          :for="row.field"
                          class="block text-sm font-medium"
                          :class="darkMode ? 'text-gray-200' : 'text-gray-700'"
                        >
                          {{ getFieldLabel(row.field) }}
                          <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                        </label>
                        <button
                          v-if="isSecretField(row.field)"
                          type="button"
                          @click.stop="handleSecretToggle(row.field)"
                          class="inline-flex items-center px-2 py-1 rounded text-xs flex-shrink-0"
                          :class="darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                          :disabled="isSecretRevealing(row.field)"
                        >
                          <IconEye v-if="!isSecretRevealing(row.field) && !isSecretVisible(row.field)" size="sm" />
                          <IconEyeOff v-else-if="!isSecretRevealing(row.field) && isSecretVisible(row.field)" size="sm" />
                          <IconRefresh v-else size="sm" class="animate-spin" />
                        </button>
                      </div>
                      <!-- OneDrive refresh_token 欄位：僅輸入框，由外部授權站點提供令牌 -->
                      <input
                        v-if="row.field === 'refresh_token' && isOneDriveType"
                        :type="getSecretInputType(row.field)"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field) && !isEdit"
                        :placeholder="getFieldPlaceholder(row.field)"
                        autocomplete="new-password"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                      />
                      <!-- 其他 secret 欄位：普通輸入框 -->
                      <input
                        v-else
                        :type="getSecretInputType(row.field)"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field) && !isEdit"
                        :placeholder="getFieldPlaceholder(row.field)"
                        autocomplete="new-password"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500'"
                      />
                      <p v-if="row.field === 'refresh_token' && isOneDriveType" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        請輸入在外部授權頁面（如 OpenList APIPages）獲取的重新整理令牌
                      </p>
                      <p v-else-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>

                    <!-- 數字 / 文字欄位 -->
                    <template v-else>
                      <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                        {{ getFieldLabel(row.field) }}
                        <span v-if="isFieldRequiredOnCreate(row.field)" class="text-red-500">*</span>
                      </label>
                      <input
                        :type="getFieldType(row.field) === 'number' ? 'number' : 'text'"
                        :id="row.field"
                        v-model="formData[row.field]"
                        :required="isFieldRequiredOnCreate(row.field)"
                        :disabled="isFieldDisabled(row.field)"
                        :placeholder="getFieldPlaceholder(row.field)"
                        @blur="handleFieldBlur(row.field)"
                        class="block w-full px-3 py-2 rounded-md text-sm transition-colors duration-200 border"
                        :class="[
                          darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'border-gray-300 text-gray-900 placeholder-gray-500',
                          isUrlField(row.field) && formData[row.field] && !isValidUrl(formData[row.field]) ? 'border-red-500' : '',
                          isFieldDisabled(row.field) ? 'opacity-50 cursor-not-allowed' : '',
                        ]"
                      />
                      <p v-if="isUrlField(row.field) && formData[row.field] && !isValidUrl(formData[row.field])" class="mt-1 text-xs text-red-500">
                        請輸入有效的 URL 格式，如 https://xxx.com
                      </p>
                      <p v-else-if="getFieldDescription(row.field)" class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ getFieldDescription(row.field) }}
                      </p>
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- 其他選項 -->
          <div class="space-y-4">
            <h3 class="text-sm font-medium border-b pb-2" :class="darkMode ? 'text-gray-200 border-gray-600' : 'text-gray-700 border-gray-200'">其他選項</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- API金鑰許可權 -->
              <div>
                <label class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">API金鑰許可權</label>
                <div class="flex items-center h-10 px-3 py-2 rounded-md border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                  <input
                    type="checkbox"
                    id="is_public"
                    v-model="formData.is_public"
                    class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    :class="darkMode ? 'bg-gray-700 border-gray-600' : ''"
                  />
                  <label for="is_public" class="ml-2 text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">允許API金鑰使用者使用</label>
                </div>
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">允許API金鑰使用者使用此儲存</p>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div
        class="px-3 sm:px-4 py-2 sm:py-3 border-t transition-colors duration-200 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <button
          @click="closeModal"
          class="w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
        >
          取消
        </button>

        <button
          @click="submitForm"
          :disabled="!formValid || loading"
          class="w-full sm:w-auto flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 bg-primary-500 hover:bg-primary-600 text-white"
          :class="{ 'opacity-50 cursor-not-allowed': !formValid || loading }"
        >
          <IconRefresh v-if="loading" size="sm" class="animate-spin -ml-1 mr-2 text-white" />
          {{ loading ? "儲存中..." : "儲存配置" }}
        </button>
      </div>
    </div>
  </div>
</template>
