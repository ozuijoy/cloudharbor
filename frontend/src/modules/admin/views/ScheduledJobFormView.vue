<script setup>
/**
 * 定時任務表單頁面（建立/編輯合一）
 */
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useScheduledJobs } from '@/modules/admin/composables/useScheduledJobs';
import { useThemeMode } from '@/composables/core/useThemeMode.js';
import ScheduledJobFormContent from '@/modules/admin/components/ScheduledJobFormContent.vue';
import { IconBack, IconChevronRight, IconClock, IconInformationCircle, IconRefresh } from '@/components/icons';
import { createLogger } from '@/utils/logger.js';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const log = createLogger('ScheduledJobFormView');
const { isDarkMode: darkMode } = useThemeMode();
const { createJob, updateJob, loadHandlerTypes, handlerTypes, jobs, loadJobs } = useScheduledJobs();

// 從路由引數獲取任務ID，有 id 則為編輯模式
const taskId = computed(() => route.params.id);
const isEdit = computed(() => !!taskId.value);

const job = ref(null);
const loading = ref(false);
const submitting = ref(false);
const error = ref("");

// 頁面標題
const pageTitle = computed(() =>
  isEdit.value
    ? t('admin.scheduledJobs.form.editTitle')
    : t('admin.scheduledJobs.form.createTitle')
);

onMounted(async () => {
  if (isEdit.value) {
    // 編輯模式：載入 handler 型別和任務資料
    loading.value = true;
    try {
      await Promise.all([loadHandlerTypes(), loadJobs()]);
      job.value = jobs.value.find(j => j.taskId === taskId.value);
      if (!job.value) {
        error.value = t("admin.scheduledJobs.errors.jobNotFound");
      }
    } catch (err) {
      log.error('載入任務失敗:', err);
      error.value = err.message || t("admin.scheduledJobs.errors.loadFailed");
    } finally {
      loading.value = false;
    }
  } else {
    // 建立模式：只載入 handler 型別
    await loadHandlerTypes();
  }
});

const handleSubmit = async (formData) => {
  submitting.value = true;
  error.value = "";

  try {
    if (isEdit.value) {
      await updateJob(taskId.value, formData);
    } else {
      await createJob(formData);
    }
    // 成功後直接跳轉，無需延遲
    router.push({ name: 'AdminScheduledJobs' });
  } catch (err) {
    log.error(isEdit.value ? '更新定時任務失敗:' : '建立定時任務失敗:', err);
    error.value = err.message || t(
      isEdit.value
        ? "admin.scheduledJobs.updateFailed"
        : "admin.scheduledJobs.createFailed"
    );
    submitting.value = false;
  }
};

const handleCancel = () => {
  router.push({ name: 'AdminScheduledJobs' });
};
</script>

<template>
  <!-- 全寬佈局 -->
  <div class="p-4 flex-1 flex flex-col overflow-y-auto">
    <!-- 頂部欄：麵包屑 + 操作按鈕 -->
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
      <!-- 左側：標題和麵包屑 -->
      <div>
        <nav class="text-sm flex items-center mb-2" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          <router-link
            :to="{ name: 'AdminScheduledJobs' }"
            class="hover:text-primary-500 transition flex items-center gap-1"
          >
            <IconClock size="sm" />
            {{ t('admin.scheduledJobs.title') }}
          </router-link>
          <IconChevronRight size="sm" class="mx-2" />
          <span :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
            {{ pageTitle }}
          </span>
        </nav>
        <h1 class="text-xl font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ pageTitle }}
        </h1>
        <p v-if="isEdit && job" class="mt-1 text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ job.name || job.taskId }}
        </p>
      </div>

      <!-- 右側：返回按鈕 -->
      <button
        @click="handleCancel"
        class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 shadow-sm hover:shadow flex items-center gap-1.5"
        :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
      >
        <IconBack size="sm" />
        {{ t('admin.scheduledJobs.form.backToList') }}
      </button>
    </div>

    <!-- 編輯模式：載入狀態 -->
    <div
      v-if="isEdit && loading"
      class="flex flex-col justify-center items-center h-60 rounded-lg"
      :class="darkMode ? 'bg-gray-800' : 'bg-gray-50'"
    >
      <IconRefresh size="2xl" class="animate-spin text-primary-500 mb-4" />
      <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t('common.loading', '載入中...') }}
      </p>
    </div>

    <!-- 編輯模式：任務未找到錯誤 -->
    <div
      v-else-if="isEdit && error && !job && !loading"
      class="flex-1 flex flex-col justify-center items-center p-8 rounded-lg"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
    >
      <div class="text-red-500 mb-4">
        <IconInformationCircle size="4xl" />
      </div>
      <p class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">
        {{ error }}
      </p>
      <p class="text-sm mb-6" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t('admin.scheduledJobs.errors.jobNotFoundHint', '請檢查任務ID是否正確，或返回列表重新選擇') }}
      </p>
      <button
        @click="router.push({ name: 'AdminScheduledJobs' })"
        class="px-6 py-2.5 rounded-md text-sm font-medium transition bg-primary-500 hover:bg-primary-600 text-white inline-flex items-center gap-2"
      >
        <IconBack size="sm" />
        {{ t('common.backToList', '返回列表') }}
      </button>
    </div>

    <!-- 表單內容 -->
    <template v-else-if="!isEdit || job">
      <!-- 錯誤提示 -->
      <div
        v-if="error"
        class="mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2"
        :class="darkMode ? 'bg-red-900/30 text-red-300 border border-red-800' : 'bg-red-50 text-red-700 border border-red-200'"
      >
        <IconInformationCircle size="md" class="flex-shrink-0" />
        {{ error }}
      </div>

      <ScheduledJobFormContent
        :dark-mode="darkMode"
        :job="job"
        :handler-types="handlerTypes"
        :is-edit="isEdit"
        :submitting="submitting"
        @submit="handleSubmit"
        @cancel="handleCancel"
      />
    </template>
  </div>
</template>
