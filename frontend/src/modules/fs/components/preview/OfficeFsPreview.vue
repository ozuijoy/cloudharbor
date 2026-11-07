<template>
  <OfficePreviewContainer
    :content-url="contentUrl"
    :filename="filename"
    :is-fullscreen="isFullscreen"
    :providers="normalizedProviders"
    :default-provider="providerKey"
    :height-mode="isFullscreen ? 'flex' : 'fixed'"
    :show-provider-selector="false"
    :show-footer="false"
    :error-message="errorMessage"
    @load="emit('load')"
    @error="emit('error', $event)"
    @provider-change="emit('provider-change', $event)"
  />
</template>

<script setup>
import { computed } from "vue";
import { OfficePreviewContainer } from "@/components/office";

const props = defineProps({
  previewUrl: {
    type: String,
    default: "",
  },
  contentUrl: {
    type: String,
    default: "",
  },
  filename: {
    type: String,
    default: "",
  },
  providerKey: {
    type: String,
    default: "",
  },
  errorMessage: {
    type: String,
    default: "",
  },
  isFullscreen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error", "provider-change"]);

// 將 previewUrl 和 providerKey 轉換為 providers 物件格式
const normalizedProviders = computed(() => {
  const providers = {};

  // 如果 providerKey 是 native，新增 native 渠道
  if (props.providerKey === "native" || props.previewUrl === "native") {
    providers.native = "native";
  } else if (props.previewUrl) {
    // 使用 providerKey 作為 key，previewUrl 作為 url
    providers[props.providerKey || "default"] = props.previewUrl;
  }

  return providers;
});
</script>
