import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useScheduledJobService } from "@/modules/admin/services/scheduledJobService";

/**
 * 定時任務管理 Composable
 * 
 * 提供定時任務的CRUD操作、狀態管理和執行歷史查詢
 */
export function useScheduledJobs() {
  const { t } = useI18n();
  const service = useScheduledJobService();
  const { showSuccess, showError } = useGlobalMessage();

  // 狀態管理
  const jobs = ref([]);
  const currentJob = ref(null);
  const jobRuns = ref([]);
  const loading = ref(false);
  const runsLoading = ref(false);

  // 行級載入狀態：正在執行的任務 ID 集合
  const runningJobIds = ref(new Set());

  // Handler 型別狀態
  const handlerTypes = ref([]);
  const handlerTypesLoading = ref(false);

  // 平臺觸發器（Cloudflare/Docker）的狀態：用於展示“下一次觸發倒計時”
  const schedulerTicker = ref(null);
  const schedulerTickerLoading = ref(false);

  // 詳情對話方塊狀態
  const showDetailDialog = ref(false);

  // 篩選狀態
  const enabledFilter = ref("all"); // 'all' | 'enabled' | 'disabled'

  /**
   * 篩選後的任務列表
   */
  const filteredJobs = computed(() => {
    if (enabledFilter.value === "all") {
      return jobs.value;
    }
    const isEnabled = enabledFilter.value === "enabled";
    return jobs.value.filter((job) => job.enabled === isEnabled);
  });

  /**
   * 載入任務列表
   */
  const loadJobs = async (params = {}, options = {}) => {
    const { silent = false, showErrorOnCatch = true } = options || {};

    if (!silent) {
      loading.value = true;
    }
    try {
      const { items } = await service.getScheduledJobs(params);
      jobs.value = items;
      return items;
    } catch (error) {
      if (showErrorOnCatch) {
        showError(error.message || t("admin.scheduledJobs.loadFailed"));
      }
      throw error;
    } finally {
      if (!silent) {
        loading.value = false;
      }
    }
  };

  /**
   * 載入單個任務詳情
   */
  const loadJob = async (taskId) => {
    loading.value = true;
    try {
      const job = await service.getScheduledJob(taskId);
      currentJob.value = job;
      return job;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadDetailFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 建立任務
   */
  const createJob = async (data) => {
    loading.value = true;
    try {
      const created = await service.createScheduledJob(data);
      showSuccess(t("admin.scheduledJobs.createSuccess"));
      // 不在這裡重新整理列表，由呼叫方決定何時重新整理
      return created;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.createFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 更新任務
   */
  const updateJob = async (taskId, data) => {
    loading.value = true;
    try {
      const updated = await service.updateScheduledJob(taskId, data);
      showSuccess(t("admin.scheduledJobs.updateSuccess"));
      // 不在這裡重新整理列表，由呼叫方決定何時重新整理
      return updated;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.updateFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 刪除任務（確認對話方塊由呼叫方處理）
   */
  const deleteJob = async (taskId) => {
    loading.value = true;
    try {
      await service.deleteScheduledJob(taskId);
      showSuccess(t("admin.scheduledJobs.deleteSuccess"));
      await loadJobs(); // 重新整理列表
      return true;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.deleteFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 切換任務啟用狀態
   */
  const toggleJobEnabled = async (taskId, enabled) => {
    loading.value = true;
    try {
      await service.toggleScheduledJob(taskId, enabled);
      const statusText = enabled
        ? t("admin.scheduledJobs.status.enabled")
        : t("admin.scheduledJobs.status.disabled");
      showSuccess(t("admin.scheduledJobs.toggleSuccess", { status: statusText }));
      await loadJobs(); // 重新整理列表
      return true;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.toggleFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 立即執行任務（行級載入狀態，不影響全域性 loading）
   */
  const runJobNow = async (taskId) => {
    // 新增到正在執行集合
    runningJobIds.value = new Set([...runningJobIds.value, taskId]);
    try {
      const result = await service.runScheduledJobNow(taskId);
      if (result.status === "success") {
        showSuccess(t("admin.scheduledJobs.runNowSuccess"));
      } else {
        showError(result.errorMessage || t("admin.scheduledJobs.runNowFailed"));
      }
      // 不在這裡重新整理列表，由呼叫方決定何時重新整理
      return result;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.runNowFailed"));
      throw error;
    } finally {
      // 從正在執行集合中移除
      const newSet = new Set(runningJobIds.value);
      newSet.delete(taskId);
      runningJobIds.value = newSet;
    }
  };

  /**
   * 載入任務執行歷史
   */
  const loadJobRuns = async (taskId, params = {}) => {
    runsLoading.value = true;
    try {
      const { items } = await service.getScheduledJobRuns(taskId, params);
      jobRuns.value = items;
      return items;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadRunsFailed"));
      throw error;
    } finally {
      runsLoading.value = false;
    }
  };

  /**
   * 載入按小時統計的執行資料
   */
  const loadHourlyAnalytics = async (windowHours = 24) => {
    try {
      return await service.getHourlyAnalytics(windowHours);
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadAnalyticsFailed"));
      throw error;
    }
  };

  /**
   * 載入“平臺觸發器”的狀態（cron + 下次觸發時間）
   */
  const loadSchedulerTicker = async (options = {}) => {
    const { silent = false, showErrorOnCatch = true } = options || {};

    if (!silent) {
      schedulerTickerLoading.value = true;
    }
    try {
      const data = await service.getSchedulerTicker();
      schedulerTicker.value = data;
      return data;
    } catch (error) {
      if (showErrorOnCatch) {
        showError(error.message || t("admin.scheduledJobs.ticker.loadFailed"));
      }
      throw error;
    } finally {
      if (!silent) {
        schedulerTickerLoading.value = false;
      }
    }
  };



  // ==================== Handler 型別方法 ====================

  /**
   * 載入所有 handler 型別列表
   */
  const loadHandlerTypes = async () => {
    handlerTypesLoading.value = true;
    try {
      const { items } = await service.getHandlerTypes();
      handlerTypes.value = items;
      return items;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadHandlerTypesFailed"));
      throw error;
    } finally {
      handlerTypesLoading.value = false;
    }
  };

  /**
   * 獲取單個 handler 型別詳情
   * @param {string} taskId - Handler ID
   */
  const loadHandlerType = async (taskId) => {
    try {
      return await service.getHandlerType(taskId);
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadHandlerTypeFailed"));
      throw error;
    }
  };

  /**
   * 根據 taskId 從已載入的 handlerTypes 中查詢
   * @param {string} taskId - Handler ID
   */
  const getHandlerTypeById = (taskId) => {
    return handlerTypes.value.find((h) => h.id === taskId) || null;
  };

  /**
   * 格式化時間間隔為人類可讀格式
   */
  const formatInterval = (seconds) => {
    if (!seconds) return "-";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}${t("common.hour")}`);
    if (minutes > 0) parts.push(`${minutes}${t("common.minute")}`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}${t("common.second")}`);

    return `每隔${parts.join("")}`;
  };

  /**
   * 格式化排程配置（interval/cron）
   * @param {ScheduledJob} job
   */
  const formatSchedule = (job) => {
    if (!job) return "-";
    const type = (job.scheduleType || "interval").toLowerCase();

    let base = "-";

    if (type === "interval") {
      base = formatInterval(Number(job.intervalSec) || 0);
    } else if (type === "cron") {
      base = job.cronExpression || "-";
    }

    return base;
  };

  /**
   * 判斷任務是否正在執行
   * @param {string} taskId - 任務 ID
   */
  const isJobRunning = (taskId) => {
    return runningJobIds.value.has(taskId);
  };

  return {
    // 狀態
    jobs,
    currentJob,
    jobRuns,
    loading,
    runsLoading,
    filteredJobs,
    enabledFilter,

    // 行級載入狀態
    runningJobIds,
    isJobRunning,

    // Handler 型別狀態
    handlerTypes,
    handlerTypesLoading,

    // 平臺觸發器狀態
    schedulerTicker,
    schedulerTickerLoading,

    // 對話方塊狀態
    showDetailDialog,

    // 方法
    loadJobs,
    loadJob,
    createJob,
    updateJob,
    deleteJob,
    toggleJobEnabled,
    runJobNow,
    loadJobRuns,
    loadHourlyAnalytics,
    loadSchedulerTicker,

    // Handler 型別方法
    loadHandlerTypes,
    loadHandlerType,
    getHandlerTypeById,

    // 工具方法
    formatSchedule,
    formatInterval,
  };
}
