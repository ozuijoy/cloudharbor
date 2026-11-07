<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener, onClickOutside } from "@vueuse/core";
// 引入Chart.js相關元件
import { Bar, Line } from "vue-chartjs";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend } from "chart.js";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { useDashboardService } from "@/modules/admin/services/dashboardService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useStorageTypePresentation } from "@/modules/admin/storage/useStorageTypePresentation.js";
import { IconChartBar, IconChevronDown, IconCircleStack, IconClock, IconCloud, IconDelete, IconDocument, IconDocumentText, IconFolder, IconKey, IconLockClosed, IconRefresh, IconServerStack } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// 註冊Chart.js元件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

// 定義props
const props = defineProps({
  permissions: {
    type: Object,
    required: true,
  },
});


const { isDarkMode: darkMode } = useThemeMode();
const { t } = useI18n();
const log = createLogger("DashboardView");
const { getCacheStats, getVersionInfo, clearCache } = useAdminSystemService();
const { getDashboardStats, getStorageUsageReport, refreshStorageUsageSnapshots } = useDashboardService();
const { getTypeLabel, ensureLoaded: ensureStorageTypesLoaded } = useStorageTypePresentation();

// 系統統計資料
const statsData = ref({
  totalPastes: 0,
  totalFiles: 0,
  totalApiKeys: 0,
  totalStorageConfigs: 0,
  totalStorageUsed: 0,
  storages: [],
  lastWeekPastes: [],
  lastWeekFiles: [],
});

// 快取統計資料
const cacheStats = ref({
  directory: {
    cacheSize: 0,
    hitRate: 0,
  },
  url: {
    cacheSize: 0,
    hitRate: 0,
  },
  search: {
    cacheSize: 0,
    hitRate: 0,
  },
  error: null,
});

// 快取卡片摺疊狀態
const isCacheExpanded = ref(false);

// 清理快取狀態
const isClearingCache = ref(false);

// 版本資訊資料
const versionInfo = ref({
  version: "載入中...",
  environment: "載入中...",
  storage: "載入中...",
  uptime: 0,
  error: null,
});

// 當前選中的儲存桶
const selectedStorageId = ref(null);

// 儲存用量報告資料（來自獨立介面）
const storageUsageReport = ref({
  storages: [],
  generatedAt: null,
});

// 重新整理儲存快照狀態
const isRefreshingStorage = ref(false);

// 彙總標籤的懸浮列表展開狀態（記錄當前展開的標籤型別）
const expandedSourceTag = ref(null); // 'provider' | 'local_fs' | 'vfs_nodes' | 'fs_index' | 'unlimited' | 'exceeded' | null
const sourcePopoverRef = ref(null); // 懸浮列表容器的 ref

// 點選外部關閉懸浮列表
onClickOutside(sourcePopoverRef, () => {
  expandedSourceTag.value = null;
});

// 關閉懸浮列表
const closeSourcePopover = () => {
  expandedSourceTag.value = null;
};

// 切換懸浮列表展開狀態
const toggleSourcePopover = (source) => {
  if (expandedSourceTag.value === source) {
    expandedSourceTag.value = null;
  } else {
    expandedSourceTag.value = source;
  }
};

// 獲取指定來源的儲存列表
const getStorageListBySource = (source) => {
  if (!aggregateStorageStats.value) return [];
  if (source === "unlimited") {
    return aggregateStorageStats.value.unlimitedStorages || [];
  }
  if (source === "exceeded") {
    return aggregateStorageStats.value.exceededStorages || [];
  }
  return aggregateStorageStats.value.sourceStorages?.[source] || [];
};

// 儲存型別顏色對映
const STORAGE_TYPE_COLORS = {
  LOCAL: { bg: "bg-blue-500", text: "text-blue-500" },
  S3: { bg: "bg-orange-500", text: "text-orange-500" },
  WEBDAV: { bg: "bg-green-500", text: "text-green-500" },
  ONEDRIVE: { bg: "bg-sky-500", text: "text-sky-500" },
  GOOGLE_DRIVE: { bg: "bg-yellow-500", text: "text-yellow-500" },
  TELEGRAM: { bg: "bg-cyan-500", text: "text-cyan-500" },
  DISCORD: { bg: "bg-indigo-500", text: "text-indigo-500" },
  GITHUB_RELEASES: { bg: "bg-slate-400", text: "text-slate-400" },
  GITHUB_API: { bg: "bg-zinc-400", text: "text-zinc-400" },
  HUGGINGFACE_DATASETS: { bg: "bg-amber-500", text: "text-amber-500" },
  MIRROR: { bg: "bg-purple-500", text: "text-purple-500" },
};

// 載入狀態
const isLoading = ref(true);
const error = ref(null);

// 圖表顯示型別切換
const chartType = ref("bar"); // 'bar' 或 'line'

// 匯入統一的時間處理工具
import { formatCurrentTime, getUserLocale } from "@/utils/timeUtils.js";

// 圖表日期標籤
const dateLabels = computed(() => {
  // 獲取過去7天的日期
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    // 使用 Intl.DateTimeFormat 確保正確的本地化
        const locale = getUserLocale();
    dates.push(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date));
  }
  return dates;
});

// Chart.js圖表配置
const chartData = computed(() => {
  return {
    labels: dateLabels.value,
    datasets: [
      {
        label: t("admin.dashboard.totalPastes"),
        backgroundColor: props.darkMode ? "rgba(59, 130, 246, 0.7)" : "rgba(37, 99, 235, 0.7)",
        borderColor: props.darkMode ? "rgba(59, 130, 246, 1)" : "rgba(37, 99, 235, 1)",
        borderWidth: 1,
        data: statsData.value.lastWeekPastes,
        borderRadius: 4,
      },
      {
        label: t("admin.dashboard.totalFiles"),
        backgroundColor: props.darkMode ? "rgba(16, 185, 129, 0.7)" : "rgba(5, 150, 105, 0.7)",
        borderColor: props.darkMode ? "rgba(16, 185, 129, 1)" : "rgba(5, 150, 105, 1)",
        borderWidth: 1,
        data: statsData.value.lastWeekFiles,
        borderRadius: 4,
      },
    ],
  };
});

// Chart.js選項配置
const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    scales: {
      x: {
        grid: {
          color: props.darkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        },
        ticks: {
          color: props.darkMode ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: props.darkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        },
        ticks: {
          precision: 0,
          color: props.darkMode ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
        },
      },
    },
    plugins: {
      tooltip: {
        backgroundColor: props.darkMode ? "rgba(17, 24, 39, 0.9)" : "rgba(255, 255, 255, 0.9)",
        titleColor: props.darkMode ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)",
        bodyColor: props.darkMode ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)",
        borderColor: props.darkMode ? "rgba(55, 65, 81, 1)" : "rgba(229, 231, 235, 1)",
        borderWidth: 1,
        padding: 10,
        boxPadding: 5,
        callbacks: {
          title: function (tooltipItems) {
            const date = tooltipItems[0].label;
            return date;
          },
          label: function (context) {
            const label = context.dataset.label || "";
            const value = context.parsed.y;
            return `${label}: ${value} ${t("admin.dashboard.items")}`;
          },
          footer: function (tooltipItems) {
            // 獲取當前日期的總活動數
            const dataIndex = tooltipItems[0].dataIndex;
            const totalThisDay = statsData.value.lastWeekPastes[dataIndex] + statsData.value.lastWeekFiles[dataIndex];
            return `${t("admin.dashboard.activityOverview")}: ${totalThisDay} ${t("admin.dashboard.items")}`;
          },
        },
      },
      legend: {
        labels: {
          color: props.darkMode ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
          boxWidth: 12,
          padding: 15,
        },
        position: "top",
      },
    },
  };
});

// 獲取當前選擇的儲存配置的詳細資料
const currentBucketData = computed(() => {
  const storages = storageUsageReport.value.storages || [];

  if (!selectedStorageId.value) {
    // 返回總體儲存使用情況
    const totalUsed = storages.reduce((sum, s) => sum + (s.computedUsage?.usedBytes || 0), 0);
    const totalLimit = storages.reduce((sum, s) => sum + (s.limitStatus?.limitBytes || s.configuredLimitBytes || 0), 0);
    const usagePercent = totalLimit > 0 ? Math.min(100, Math.round((totalUsed / totalLimit) * 100)) : 0;

    return {
      isAggregate: true,
      name: t("admin.dashboard.allStorages"),
      usedStorage: totalUsed,
      totalStorage: totalLimit,
      usagePercent,
      source: null,
      snapshotAt: null,
      providerQuota: null,
      storageType: null,
      enableDiskUsage: null,
    };
  }

  // 返回選中的儲存配置詳細資料
  const storage = storages.find((s) => s.id === selectedStorageId.value);
  if (storage) {
    const usedBytes = storage.computedUsage?.usedBytes || 0;
    const limitBytes = storage.limitStatus?.limitBytes || storage.configuredLimitBytes || 0;
    const usagePercent = storage.limitStatus?.percentUsed || (limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0);

    return {
      isAggregate: false,
      name: storage.name,
      usedStorage: usedBytes,
      totalStorage: limitBytes,
      usagePercent,
      source: storage.computedUsage?.source || null,
      snapshotAt: storage.computedUsage?.snapshotAt || null,
      providerQuota:
        storage.computedUsage?.source === "provider"
          ? (storage.computedUsage?.details?.quota || null)
          : null,
      storageType: storage.storageType || null,
      enableDiskUsage: storage.enableDiskUsage ?? null,
      exceeded: storage.limitStatus?.exceeded || false,
      configuredLimitBytes: storage.configuredLimitBytes,
    };
  }

  // 回退到總體資料
  const totalUsed = storages.reduce((sum, s) => sum + (s.computedUsage?.usedBytes || 0), 0);
  const totalLimit = storages.reduce((sum, s) => sum + (s.limitStatus?.limitBytes || s.configuredLimitBytes || 0), 0);
  const usagePercent = totalLimit > 0 ? Math.min(100, Math.round((totalUsed / totalLimit) * 100)) : 0;

  return {
    isAggregate: true,
    name: t("admin.dashboard.allStorages"),
    usedStorage: totalUsed,
    totalStorage: totalLimit,
    usagePercent,
    source: null,
    snapshotAt: null,
    providerQuota: null,
    storageType: null,
    enableDiskUsage: null,
  };
});

// 獲取資料來源的顯示名稱和樣式
const getSourceInfo = (source) => {
  const sourceMap = {
    provider: {
      label: t("admin.dashboard.sourceLabels.provider"),
      color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      description: t("admin.dashboard.sourceDescriptions.provider"),
    },
    local_fs: {
      label: t("admin.dashboard.sourceLabels.localFs"),
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      description: t("admin.dashboard.sourceDescriptions.localFs"),
    },
    vfs_nodes: {
      label: t("admin.dashboard.sourceLabels.vfsNodes"),
      color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      description: t("admin.dashboard.sourceDescriptions.vfsNodes"),
    },
    fs_index: {
      label: t("admin.dashboard.sourceLabels.fsIndex"),
      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      description: t("admin.dashboard.sourceDescriptions.fsIndex"),
    },
  };
  return sourceMap[source] || {
    label: source || t("admin.dashboard.sourceLabels.unknown"),
    color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
    description: "",
  };
};

// 格式化快照時間
const formatSnapshotTime = (isoString) => {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(getUserLocale(), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return null;
  }
};

// 所有儲存的彙總統計資訊（用於"所有儲存"檢視下方顯示）
const aggregateStorageStats = computed(() => {
  const storages = storageUsageReport.value.storages || [];
  if (storages.length === 0) return null;

  // 統計各資料來源的數量，並記錄具體的儲存列表
  const sourceCount = {};
  const sourceStorages = {}; // 按來源分組的儲存列表
  let latestSnapshotAt = null;
  let exceededCount = 0;
  let unlimitedCount = 0;
  const exceededStorages = []; // 超限的儲存列表
  const unlimitedStorages = []; // 不限額的儲存列表

  storages.forEach((s) => {
    const source = s.computedUsage?.source || "unknown";
    sourceCount[source] = (sourceCount[source] || 0) + 1;

    // 記錄該來源下的儲存
    if (!sourceStorages[source]) {
      sourceStorages[source] = [];
    }
    sourceStorages[source].push({
      id: s.id,
      name: s.name,
      storageType: s.storageType,
    });

    // 找最新的快照時間
    const snapshotAt = s.computedUsage?.snapshotAt;
    if (snapshotAt) {
      if (!latestSnapshotAt || new Date(snapshotAt) > new Date(latestSnapshotAt)) {
        latestSnapshotAt = snapshotAt;
      }
    }

    // 統計超限和不限額的數量
    if (s.limitStatus?.exceeded) {
      exceededCount++;
      exceededStorages.push({ id: s.id, name: s.name, storageType: s.storageType });
    }
    if (!s.configuredLimitBytes || s.configuredLimitBytes === 0) {
      unlimitedCount++;
      unlimitedStorages.push({ id: s.id, name: s.name, storageType: s.storageType });
    }
  });

  return {
    totalCount: storages.length,
    sourceCount,
    sourceStorages,
    latestSnapshotAt,
    exceededCount,
    exceededStorages,
    unlimitedCount,
    unlimitedStorages,
  };
});

// 按儲存型別聚合統計資料
const storageTypeDistribution = computed(() => {
  const storages = storageUsageReport.value.storages || [];
  if (storages.length === 0) return [];

  // 按 storageType 分組統計
  const typeMap = new Map();
  storages.forEach((s) => {
    const type = s.storageType || "UNKNOWN";
    if (!typeMap.has(type)) {
      typeMap.set(type, { type, count: 0 });
    }
    typeMap.get(type).count++;
  });

  // 轉換為陣列並計算百分比
  const total = storages.length;
  const result = Array.from(typeMap.values())
    .map((item) => ({
      ...item,
      percent: Math.round((item.count / total) * 100),
      color: STORAGE_TYPE_COLORS[item.type] || { bg: "bg-gray-500", text: "text-gray-500" },
    }))
    .sort((a, b) => b.count - a.count); // 按數量降序排列

  return result;
});

// CategoryBar 的分段資料（用於頂部進度條，包含 tooltip 資訊）
const categoryBarSegments = computed(() => {
  return storageTypeDistribution.value.map((item) => ({
    percent: item.percent,
    color: item.color.bg,
    type: item.type,
    count: item.count,
    // tooltip 顯示：型別名稱 - 數量 (百分比)
    tooltip: `${getStorageTypeName(item.type)}: ${item.count}${t("admin.dashboard.configs")} (${item.percent}%)`,
  }));
});

// 獲取儲存型別的顯示名稱
const getStorageTypeName = (type) => {
  // 不寫死：優先使用後端 /api/storage-types 返回的 displayName / i18nKey
  // - i18nKey 由後端 StorageFactory 後設資料提供（統一走 admin.storage.type.*）
  // - 新增驅動時 Dashboard 不需要再補 nameMap
  return getTypeLabel(type, t) || type;
};

// 格式化儲存大小
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return `0 ${t("admin.dashboard.storageUnits.bytes")}`;

  const k = 1024;
  const sizeKeys = ["bytes", "kb", "mb", "gb", "tb"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const sizeKey = sizeKeys[i] || "bytes";
  const sizeUnit = t(`admin.dashboard.storageUnits.${sizeKey}`);

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizeUnit;
};

// 切換選中的儲存桶
const selectStorage = (storageId) => {
  selectedStorageId.value = storageId;
};

// 切換圖表型別
const toggleChartType = () => {
  chartType.value = chartType.value === "bar" ? "line" : "bar";
};

// 計算總共文字分享數量
const totalWeekPastes = computed(() => {
  return statsData.value.lastWeekPastes.reduce((sum, current) => sum + current, 0);
});

// 計算總共檔案上傳數量
const totalWeekFiles = computed(() => {
  return statsData.value.lastWeekFiles.reduce((sum, current) => sum + current, 0);
});

// 獲取每日最高值
const weeklyMaxValues = computed(() => {
  const combinedData = [];
  for (let i = 0; i < 7; i++) {
    combinedData.push(statsData.value.lastWeekPastes[i] + statsData.value.lastWeekFiles[i]);
  }
  return {
    maxDay: combinedData.indexOf(Math.max(...combinedData)),
    maxValue: Math.max(...combinedData),
  };
});

// 獲取快取統計資料
const fetchCacheStats = async () => {
  try {
    const data = await getCacheStats();
    cacheStats.value = {
      directory: {
        cacheSize: data.cache?.directory?.cacheSize || 0,
        hitRate: data.cache?.directory?.hitRate || 0,
      },
      url: {
        cacheSize: data.cache?.url?.cacheSize || 0,
        hitRate: data.cache?.url?.hitRate || 0,
      },
      search: {
        cacheSize: data.cache?.search?.cacheSize || 0,
        hitRate: data.cache?.search?.hitRate || 0,
      },
      error: null,
    };
  } catch (err) {
    log.warn("獲取快取統計失敗:", err);
    cacheStats.value.error = "獲取快取資料失敗";
  }
};

// 獲取版本資訊
const fetchVersionInfo = async () => {
  try {
    const data = await getVersionInfo();
    versionInfo.value = {
      version: data.version || "1.0.0",
      environment: data.environment || "Docker",
      storage: data.storage || "SQLite",
      uptime: data.uptime || 0,
      error: null,
    };
  } catch (err) {
    log.warn("獲取版本資訊失敗:", err);
    versionInfo.value.error = "獲取版本資訊失敗";
  }
};

// 清理所有快取
const clearAllCache = async () => {
  if (isClearingCache.value) return;

  isClearingCache.value = true;
  try {
    const result = await clearCache(); // 無引數 = 清理所有快取

    // 顯示成功訊息
    const clearedCount = typeof result?.clearedCount === "number" ? result.clearedCount : 0;

    // 重新獲取快取統計
    await fetchCacheStats();

    // 可以新增toast通知
    // toast.success(`快取清理成功，共清理 ${clearedCount} 項`);
  } catch (err) {
    log.error("清理快取失敗:", err);
    // toast.error("清理快取失敗：" + err.message);
  } finally {
    isClearingCache.value = false;
  }
};

// 獲取儲存用量報告（獨立介面）
const fetchStorageUsageReport = async () => {
  try {
    const data = await getStorageUsageReport();
    storageUsageReport.value = {
      storages: Array.isArray(data.storages) ? data.storages : [],
      generatedAt: data.generatedAt || null,
    };
  } catch (err) {
    log.warn("獲取儲存用量報告失敗:", err);
    // 不影響主要資料展示，靜默失敗
  }
};

// 重新整理儲存用量快照（使用者主動觸發）
const handleRefreshStorageSnapshots = async () => {
  if (isRefreshingStorage.value) return;

  isRefreshingStorage.value = true;
  try {
    await refreshStorageUsageSnapshots({ maxItems: 50 });
    // 重新整理完成後重新獲取儲存用量報告
    await fetchStorageUsageReport();
  } catch (err) {
    log.error("重新整理儲存用量快照失敗:", err);
  } finally {
    isRefreshingStorage.value = false;
  }
};

// 從後端獲取統計資料
const fetchDashboardStats = async () => {
  isLoading.value = true;
  error.value = null;

  try {
    // 確保拿到 /api/storage-types 後設資料，這樣儲存型別名稱展示就不需要寫死對映
    await ensureStorageTypesLoaded().catch(() => null);

    // 統一後端返回的資料結構（通用命名優先）
    const normalizeDashboardData = (raw) => {
      const data = raw || {};
      const storages = Array.isArray(data.storages) ? data.storages : [];

      return {
        totalPastes: Number.isFinite(data.totalPastes) ? data.totalPastes : 0,
        totalFiles: Number.isFinite(data.totalFiles) ? data.totalFiles : 0,
        totalApiKeys: Number.isFinite(data.totalApiKeys) ? data.totalApiKeys : 0,
        totalStorageConfigs: Number.isFinite(data.totalStorageConfigs) ? data.totalStorageConfigs : 0,
        totalStorageUsed: Number.isFinite(data.totalStorageUsed) ? data.totalStorageUsed : 0,
        storages,
        lastWeekPastes: Array.isArray(data.lastWeekPastes) ? data.lastWeekPastes : [],
        lastWeekFiles: Array.isArray(data.lastWeekFiles) ? data.lastWeekFiles : [],
      };
    };

    // 並行獲取儀表盤資料、儲存用量報告、快取統計和版本資訊
    const [dashboardData] = await Promise.all([
      getDashboardStats(),
      fetchStorageUsageReport(), // 儲存用量報告（獨立介面）
      fetchCacheStats(), // 快取統計失敗不影響主要資料
      fetchVersionInfo(), // 版本資訊失敗不影響主要資料
    ]);

    statsData.value = normalizeDashboardData(dashboardData || {});
    // 重置選中的儲存桶
    selectedStorageId.value = null;
  } catch (err) {
    log.error("獲取控制面板資料失敗:", err);
    error.value = t("admin.dashboard.fetchError");
  } finally {
    isLoading.value = false;
  }
};

// 監聽暗色模式變化
watch(
  () => props.darkMode,
  () => {
    // 當暗色模式變化時，透過重新計算chartData和chartOptions來更新圖表
    chartData.value; // 觸發重新計算
    chartOptions.value; // 觸發重新計算
  }
);

// 監聽語言變化事件
const handleLanguageChange = () => {
  // 語言變化時的處理邏輯
};

// 元件掛載時載入資料和新增事件監聽
onMounted(() => {
  fetchDashboardStats();
});

// 監聽語言變化事件（自動清理）
useEventListener(window, "languageChanged", handleLanguageChange);
</script>

<template>
  <!-- 當API金鑰使用者嘗試訪問Dashboard時顯示許可權不足提示 -->
  <div v-if="!permissions.isAdmin" class="p-6 flex-1 flex flex-col items-center justify-center text-center">
    <IconLockClosed class="h-16 w-16 mb-4" :class="darkMode ? 'text-gray-600' : 'text-gray-400'" />
    <h3 class="text-xl font-semibold mb-2" :class="darkMode ? 'text-white' : 'text-gray-800'">許可權不足</h3>
    <p class="text-base mb-4" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">您沒有訪問此頁面的許可權</p>
  </div>

  <!-- 管理員儀表板內容 -->
  <div v-else class="flex flex-col h-full w-full">
    <!-- 標題和重新整理按鈕 -->
    <div class="flex justify-between items-center mb-4 md:mb-6">
      <h2 class="text-xl font-bold" :class="darkMode ? 'text-white' : 'text-gray-800'">
        {{ t("admin.dashboard.systemOverview") }}
      </h2>
      <div class="flex items-center gap-2">
        <!-- 重新整理儲存按鈕 -->
        <button
          @click="handleRefreshStorageSnapshots"
          :disabled="isRefreshingStorage"
          class="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          :class="[
            darkMode
              ? 'bg-primary-600 text-white hover:bg-primary-500 disabled:bg-gray-600 disabled:text-gray-400'
              : 'bg-primary-500 text-white hover:bg-primary-600 disabled:bg-gray-300 disabled:text-gray-500',
          ]"
          :title="t('admin.dashboard.refreshStorageTooltip')"
        >
          <IconRefresh class="w-4 h-4 mr-1.5" :class="isRefreshingStorage ? 'animate-spin' : ''" />
          {{ isRefreshingStorage ? t("admin.dashboard.refreshingStorage") : t("admin.dashboard.refreshStorage") }}
        </button>
        <!-- 重新整理全部按鈕 -->
        <button
          @click="fetchDashboardStats"
          class="flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          :class="[darkMode ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300']"
        >
          <IconRefresh class="w-4 h-4 mr-1.5" :class="isLoading ? 'animate-spin' : ''" />
          {{ isLoading ? t("admin.dashboard.refreshing") : t("admin.dashboard.refresh") }}
        </button>
      </div>
    </div>

    <!-- 錯誤提示 -->
    <div v-if="error" class="mb-4 p-3 bg-red-100 text-red-700 rounded-md border border-red-200">
      {{ error }}
    </div>

    <!-- 統計卡片佈局 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <!-- 文字分享統計 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between">
          <div>
            <p class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
              {{ t("admin.dashboard.totalPastes") }}
            </p>
            <p class="mt-1 text-2xl font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
              {{ statsData.totalPastes }}
            </p>
          </div>
          <div class="h-12 w-12 rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'">
            <IconDocumentText class="h-6 w-6" />
          </div>
        </div>
      </div>

      <!-- 檔案上傳統計 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between">
          <div>
            <p class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
              {{ t("admin.dashboard.totalFiles") }}
            </p>
            <p class="mt-1 text-2xl font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
              {{ statsData.totalFiles }}
            </p>
          </div>
          <div class="h-12 w-12 rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'">
            <IconFolder class="h-6 w-6" />
          </div>
        </div>
      </div>

      <!-- API金鑰統計 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between">
          <div>
            <p class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
              {{ t("admin.dashboard.totalApiKeys") }}
            </p>
            <p class="mt-1 text-2xl font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
              {{ statsData.totalApiKeys }}
            </p>
          </div>
          <div class="h-12 w-12 rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'">
            <IconKey class="h-6 w-6" />
          </div>
        </div>
      </div>

      <!-- 儲存配置統計 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between">
          <div>
            <p class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
              {{ t("admin.dashboard.totalStorageConfigs") }}
            </p>
            <p class="mt-1 text-2xl font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
              {{ statsData.totalStorageConfigs }}
            </p>
          </div>
          <div class="h-12 w-12 rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'">
            <IconCloud class="h-6 w-6" />
          </div>
        </div>
      </div>
    </div>

    <!-- 儲存使用情況 -->
    <div class="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- 儲存空間使用量 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
            {{ t("admin.dashboard.storageUsage") }}
          </h3>

          <!-- 儲存桶選擇器 -->
          <div class="relative">
            <button
              @click="$refs.bucketDropdown.classList.toggle('hidden')"
              class="px-2 py-1 text-xs rounded flex items-center"
              :class="darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
            >
              <span>{{ currentBucketData.name }}</span>
              <IconChevronDown class="h-3 w-3 ml-1" />
            </button>

            <!-- 儲存桶下拉選單 -->
            <div
              ref="bucketDropdown"
              class="hidden absolute right-0 mt-1 w-40 rounded-md shadow-lg z-10"
              :class="darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'"
            >
              <div class="py-1">
                <a
                  href="#"
                  @click.prevent="selectStorage(null)"
                  class="block px-4 py-2 text-xs"
                  :class="[
                    !selectedStorageId ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
                    darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
                  ]"
                >
                  {{ t("admin.dashboard.allStorages") }}
                </a>

                <!-- 各個儲存配置選項 -->
                <a
                  v-for="storage in storageUsageReport.storages"
                  :key="storage.id"
                  href="#"
                  @click.prevent="selectStorage(storage.id)"
                  class="block px-4 py-2 text-xs"
                  :class="[
                    selectedStorageId === storage.id ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-900') : '',
                    darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
                  ]"
                >
                  {{ storage.name }}
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- 使用量顯示 -->
        <div class="flex justify-between items-center mb-1.5">
          <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
            {{ formatBytes(currentBucketData.usedStorage) }} /
            {{ currentBucketData.totalStorage > 0 ? formatBytes(currentBucketData.totalStorage) : t("admin.dashboard.unlimited") }}
          </span>
          <span
            v-if="currentBucketData.totalStorage > 0"
            class="text-sm font-medium"
            :class="[
              currentBucketData.exceeded
                ? 'text-red-500'
                : currentBucketData.usagePercent > 80
                  ? (darkMode ? 'text-red-400' : 'text-red-600')
                  : (darkMode ? 'text-blue-300' : 'text-blue-600'),
            ]"
          >
            {{ currentBucketData.usagePercent }}%
          </span>
          <span v-else class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            {{ t("admin.dashboard.unlimited") }}
          </span>
        </div>

        <!-- 進度條 -->
        <div
          v-if="currentBucketData.totalStorage > 0"
          class="w-full bg-gray-200 rounded-full h-2.5"
          :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'"
        >
          <div
            class="h-2.5 rounded-full transition-all duration-500"
            :class="[
              currentBucketData.exceeded
                ? 'bg-red-600'
                : currentBucketData.usagePercent > 80
                  ? 'bg-red-500'
                  : currentBucketData.usagePercent > 60
                    ? 'bg-orange-500'
                    : 'bg-primary-500',
            ]"
            :style="{ width: `${Math.min(currentBucketData.usagePercent, 100)}%` }"
          ></div>
        </div>

        <!-- 詳細資訊區域（僅在選中單個儲存時顯示） -->
        <div v-if="!currentBucketData.isAggregate" class="mt-3 pt-3 border-t" :class="darkMode ? 'border-gray-600' : 'border-gray-200'">
          <!-- 資料來源標籤 -->
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <!-- 儲存型別標籤 -->
            <span
              v-if="currentBucketData.storageType"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              :class="STORAGE_TYPE_COLORS[currentBucketData.storageType]?.bg || 'bg-gray-500'"
              style="color: white"
            >
              {{ getStorageTypeName(currentBucketData.storageType) }}
            </span>

            <!-- 資料來源標籤 -->
            <span
              v-if="currentBucketData.source"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              :class="getSourceInfo(currentBucketData.source).color"
              :title="getSourceInfo(currentBucketData.source).description"
            >
              {{ getSourceInfo(currentBucketData.source).label }}
            </span>

            <!-- 超限警告標籤 -->
            <span
              v-if="currentBucketData.exceeded"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            >
              {{ t("admin.dashboard.exceeded") }}
            </span>
          </div>

          <!-- 上游用量資訊（僅當本次用量來源就是 provider 時才有） -->
          <div v-if="currentBucketData.source === 'provider' && currentBucketData.providerQuota" class="mb-2">
            <p class="text-xs font-medium mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.dashboard.providerQuota") }}
            </p>
            <div class="flex items-center gap-3 text-xs" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
              <span>
                {{ t("admin.dashboard.total") }}: {{ formatBytes(currentBucketData.providerQuota.totalBytes) }}
              </span>
              <span>
                {{ t("admin.dashboard.used") }}: {{ formatBytes(currentBucketData.providerQuota.usedBytes) }}
              </span>
              <span v-if="currentBucketData.providerQuota.percentUsed !== undefined && currentBucketData.providerQuota.percentUsed !== null">
                ({{ currentBucketData.providerQuota.percentUsed }}%)
              </span>
            </div>
          </div>

          <!-- 快照時間 -->
          <div v-if="currentBucketData.snapshotAt" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
            {{ t("admin.dashboard.snapshotTime") }}: {{ formatSnapshotTime(currentBucketData.snapshotAt) }}
          </div>
        </div>

        <!-- 彙總資訊區域（僅在"所有儲存"檢視時顯示） -->
        <div v-if="currentBucketData.isAggregate && aggregateStorageStats" class="mt-3 pt-3 border-t" :class="darkMode ? 'border-gray-600' : 'border-gray-200'">
          <div ref="sourcePopoverRef" class="flex flex-wrap items-center gap-2 text-xs">
            <!-- 儲存配置總數 -->
            <span class="inline-flex items-center px-2 py-0.5 rounded font-medium" :class="darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-100 text-gray-700'">
              {{ aggregateStorageStats.totalCount }}{{ t("admin.dashboard.configs") }}
            </span>

            <!-- 資料來源分佈（可點選展開列表） -->
            <div
              v-for="(count, source) in aggregateStorageStats.sourceCount"
              :key="source"
              class="relative"
            >
              <button
                @click="toggleSourcePopover(source)"
                class="inline-flex items-center px-2 py-0.5 rounded font-medium cursor-pointer transition-all hover:opacity-80"
                :class="getSourceInfo(source).color"
                :title="t('admin.dashboard.clickToViewList')"
              >
                {{ getSourceInfo(source).label }}: {{ count }}
                <IconChevronDown
                  class="w-3 h-3 ml-0.5 transition-transform duration-200"
                  :class="expandedSourceTag === source ? 'rotate-180' : ''"
                />
              </button>

              <!-- 懸浮列表 -->
              <transition name="popover-fade">
                <div
                  v-if="expandedSourceTag === source"
                  class="absolute left-0 top-full mt-1 z-20 min-w-[160px] max-w-[240px] max-h-[200px] overflow-y-auto rounded-md shadow-lg border"
                  :class="darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'"
                >
                  <div class="py-1">
                    <div
                      v-for="storage in getStorageListBySource(source)"
                      :key="storage.id"
                      class="px-3 py-1.5 flex items-center gap-2 text-xs"
                      :class="darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'"
                    >
                      <span
                        class="w-2 h-2 rounded-sm shrink-0"
                        :class="STORAGE_TYPE_COLORS[storage.storageType]?.bg || 'bg-gray-400'"
                      ></span>
                      <span class="truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-700'" :title="storage.name">
                        {{ storage.name }}
                      </span>
                    </div>
                  </div>
                  <div class="px-3 py-1.5 border-t text-xs" :class="darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-100 text-gray-500'">
                    {{ t("admin.dashboard.totalItems", { count }) }}
                  </div>
                </div>
              </transition>
            </div>

            <!-- 不限額數量（可點選展開列表） -->
            <div v-if="aggregateStorageStats.unlimitedCount > 0" class="relative">
              <button
                @click="toggleSourcePopover('unlimited')"
                class="inline-flex items-center px-2 py-0.5 rounded font-medium cursor-pointer transition-all hover:opacity-80"
                :class="darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-100 text-gray-600'"
                :title="t('admin.dashboard.clickToViewList')"
              >
                {{ t("admin.dashboard.unlimited") }}: {{ aggregateStorageStats.unlimitedCount }}
                <IconChevronDown
                  class="w-3 h-3 ml-0.5 transition-transform duration-200"
                  :class="expandedSourceTag === 'unlimited' ? 'rotate-180' : ''"
                />
              </button>

              <!-- 懸浮列表 -->
              <transition name="popover-fade">
                <div
                  v-if="expandedSourceTag === 'unlimited'"
                  class="absolute left-0 top-full mt-1 z-20 min-w-[160px] max-w-[240px] max-h-[200px] overflow-y-auto rounded-md shadow-lg border"
                  :class="darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'"
                >
                  <div class="py-1">
                    <div
                      v-for="storage in getStorageListBySource('unlimited')"
                      :key="storage.id"
                      class="px-3 py-1.5 flex items-center gap-2 text-xs"
                      :class="darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'"
                    >
                      <span
                        class="w-2 h-2 rounded-sm shrink-0"
                        :class="STORAGE_TYPE_COLORS[storage.storageType]?.bg || 'bg-gray-400'"
                      ></span>
                      <span class="truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-700'" :title="storage.name">
                        {{ storage.name }}
                      </span>
                    </div>
                  </div>
                  <div class="px-3 py-1.5 border-t text-xs" :class="darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-100 text-gray-500'">
                    {{ t("admin.dashboard.totalItems", { count: aggregateStorageStats.unlimitedCount }) }}
                  </div>
                </div>
              </transition>
            </div>

            <!-- 超限數量（可點選展開列表） -->
            <div v-if="aggregateStorageStats.exceededCount > 0" class="relative">
              <button
                @click="toggleSourcePopover('exceeded')"
                class="inline-flex items-center px-2 py-0.5 rounded font-medium cursor-pointer transition-all hover:opacity-80 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                :title="t('admin.dashboard.clickToViewList')"
              >
                {{ t("admin.dashboard.exceeded") }}: {{ aggregateStorageStats.exceededCount }}
                <IconChevronDown
                  class="w-3 h-3 ml-0.5 transition-transform duration-200"
                  :class="expandedSourceTag === 'exceeded' ? 'rotate-180' : ''"
                />
              </button>

              <!-- 懸浮列表 -->
              <transition name="popover-fade">
                <div
                  v-if="expandedSourceTag === 'exceeded'"
                  class="absolute left-0 top-full mt-1 z-20 min-w-[160px] max-w-[240px] max-h-[200px] overflow-y-auto rounded-md shadow-lg border"
                  :class="darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'"
                >
                  <div class="py-1">
                    <div
                      v-for="storage in getStorageListBySource('exceeded')"
                      :key="storage.id"
                      class="px-3 py-1.5 flex items-center gap-2 text-xs"
                      :class="darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'"
                    >
                      <span
                        class="w-2 h-2 rounded-sm shrink-0"
                        :class="STORAGE_TYPE_COLORS[storage.storageType]?.bg || 'bg-gray-400'"
                      ></span>
                      <span class="truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-700'" :title="storage.name">
                        {{ storage.name }}
                      </span>
                    </div>
                  </div>
                  <div class="px-3 py-1.5 border-t text-xs" :class="darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-100 text-gray-500'">
                    {{ t("admin.dashboard.totalItems", { count: aggregateStorageStats.exceededCount }) }}
                  </div>
                </div>
              </transition>
            </div>
          </div>

          <!-- 最新快照時間 -->
          <div v-if="aggregateStorageStats.latestSnapshotAt" class="mt-2 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
            {{ t("admin.dashboard.latestSnapshot") }}: {{ formatSnapshotTime(aggregateStorageStats.latestSnapshotAt) }}
          </div>
        </div>
      </div>

      <!-- 儲存型別分佈 -->
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <h3 class="text-lg font-semibold mb-3" :class="darkMode ? 'text-white' : 'text-gray-800'">
          {{ t("admin.dashboard.storageTypeDistribution") }}
        </h3>

        <!-- 無資料提示 -->
        <div v-if="storageTypeDistribution.length === 0" class="text-center py-4">
          <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ t("admin.dashboard.noStorageConfigs") }}
          </p>
        </div>

        <!-- CategoryBar 分段進度條 -->
        <div v-else>
          <div class="w-full h-3 rounded-full overflow-hidden flex" :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'">
            <div
              v-for="(segment, index) in categoryBarSegments"
              :key="index"
              class="h-full transition-all duration-300 cursor-pointer hover:opacity-80 hover:scale-y-125"
              :class="segment.color"
              :style="{ width: `${segment.percent}%` }"
              :title="segment.tooltip"
            ></div>
          </div>

          <!-- 流式圖例列表 -->
          <ul role="list" class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            <li v-for="item in storageTypeDistribution" :key="item.type" class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" :class="item.color.bg"></span>
              <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                {{ getStorageTypeName(item.type) }}
              </span>
              <span class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                {{ item.percent }}%
              </span>
              <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                ({{ item.count }}{{ t("admin.dashboard.configs") }})
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 快取監控卡片 -->
    <div class="mb-6">
      <div class="p-4 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex justify-between items-center">
          <div class="flex-1 cursor-pointer" @click="isCacheExpanded = !isCacheExpanded">
            <div class="flex items-center mb-2">
              <div class="h-10 w-10 rounded-lg flex items-center justify-center mr-3" :class="darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'">
                <IconChartBar class="h-5 w-5" />
              </div>
              <div>
                <p class="text-base font-medium" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ t("admin.dashboard.cacheMonitoring") }}
                </p>
                <p v-if="!isCacheExpanded && !cacheStats.error" class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                  {{ t("admin.dashboard.directoryCache") }}: {{ Math.round(cacheStats.directory.hitRate * 100) }}% | {{ t("admin.dashboard.urlCache") }}:
                  {{ Math.round(cacheStats.url.hitRate * 100) }}% | {{ t("admin.dashboard.searchCache") }}: {{ Math.round(cacheStats.search.hitRate * 100) }}%
                </p>
                <p v-else-if="!isCacheExpanded && cacheStats.error" class="text-sm text-red-500">
                  {{ t("admin.dashboard.cacheUnavailable") }}
                </p>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- 清理快取按鈕 -->
            <button
              @click.stop="clearAllCache"
              :disabled="isClearingCache"
              class="p-2 rounded-lg transition-colors"
              :class="[
                darkMode
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:bg-gray-600 disabled:text-gray-400'
                  : 'bg-red-100 text-red-600 hover:bg-red-200 disabled:bg-gray-100 disabled:text-gray-400',
              ]"
              :title="t('admin.dashboard.clearAllCache')"
            >
              <IconDelete v-if="!isClearingCache" class="h-4 w-4" />
              <IconRefresh v-else class="h-4 w-4 animate-spin" />
            </button>
            <!-- 展開/收起按鈕 -->
            <button @click.stop="isCacheExpanded = !isCacheExpanded" class="p-1">
              <IconChevronDown
                class="w-5 h-5 transition-transform duration-200"
                :class="[isCacheExpanded ? 'rotate-180' : '', darkMode ? 'text-gray-400' : 'text-gray-500']"
              />
            </button>
          </div>
        </div>

        <!-- 展開的詳細資訊 -->
        <transition name="slide-down">
          <div v-if="isCacheExpanded" class="mt-4 pt-4 border-t" :class="darkMode ? 'border-gray-600' : 'border-gray-200'">
            <div v-if="!cacheStats.error" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <!-- 目錄快取 -->
              <div class="p-3 rounded-lg" :class="darkMode ? 'bg-gray-600' : 'bg-gray-50'">
                <p class="text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t("admin.dashboard.directoryCache") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ t("admin.dashboard.hitRate") }}: {{ Math.round(cacheStats.directory.hitRate * 100) }}%
                </p>
                <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ t("admin.dashboard.cacheItems") }}: {{ cacheStats.directory.cacheSize }}</p>
              </div>

              <!-- URL快取 -->
              <div class="p-3 rounded-lg" :class="darkMode ? 'bg-gray-600' : 'bg-gray-50'">
                <p class="text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t("admin.dashboard.urlCache") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ t("admin.dashboard.hitRate") }}: {{ Math.round(cacheStats.url.hitRate * 100) }}%
                </p>
                <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ t("admin.dashboard.cacheItems") }}: {{ cacheStats.url.cacheSize }}</p>
              </div>

              <!-- 搜尋快取 -->
              <div class="p-3 rounded-lg" :class="darkMode ? 'bg-gray-600' : 'bg-gray-50'">
                <p class="text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t("admin.dashboard.searchCache") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ t("admin.dashboard.hitRate") }}: {{ Math.round(cacheStats.search.hitRate * 100) }}%
                </p>
                <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ t("admin.dashboard.cacheItems") }}: {{ cacheStats.search.cacheSize }}</p>
              </div>
            </div>
            <div v-else class="text-center py-4">
              <p class="text-red-500">{{ cacheStats.error }}</p>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- 活動趨勢圖表 -->
    <div class="mb-5">
      <div class="p-3 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
            {{ t("admin.dashboard.weeklyActivity") }}
          </h3>

          <div class="flex items-center space-x-2">
            <!-- 圖表型別切換按鈕 -->
            <button
              @click="toggleChartType"
              class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
              :class="darkMode ? 'bg-gray-600 hover:bg-gray-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
            >
              <IconChartBar class="h-3.5 w-3.5 mr-1" />
              {{ chartType === "bar" ? t("admin.dashboard.switchToLineChart") : t("admin.dashboard.switchToBarChart") }}
            </button>
          </div>
        </div>

        <!-- 活動統計概覽卡片 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          <div class="p-2 rounded-lg bg-opacity-10" :class="darkMode ? 'bg-blue-500' : 'bg-blue-100'">
            <div class="flex items-center">
              <div class="w-7 h-7 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'">
                <IconDocumentText class="h-3.5 w-3.5" />
              </div>
              <div>
                <p class="text-xs font-medium" :class="darkMode ? 'text-blue-200' : 'text-blue-700'">
                  {{ t("admin.dashboard.weeklyPastes") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ totalWeekPastes }}
                </p>
              </div>
            </div>
          </div>

          <div class="p-2 rounded-lg bg-opacity-10" :class="darkMode ? 'bg-green-500' : 'bg-green-100'">
            <div class="flex items-center">
              <div class="w-7 h-7 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'">
                <IconDocument class="h-3.5 w-3.5" />
              </div>
              <div>
                <p class="text-xs font-medium" :class="darkMode ? 'text-green-200' : 'text-green-700'">
                  {{ t("admin.dashboard.weeklyFiles") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ totalWeekFiles }}
                </p>
              </div>
            </div>
          </div>

          <div class="p-2 rounded-lg bg-opacity-10" :class="darkMode ? 'bg-purple-500' : 'bg-purple-100'">
            <div class="flex items-center">
              <div class="w-7 h-7 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'">
                <IconChartBar class="h-3.5 w-3.5" />
              </div>
              <div>
                <p class="text-xs font-medium" :class="darkMode ? 'text-purple-200' : 'text-purple-700'">
                  {{ t("admin.dashboard.mostActiveDate") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">
                  {{ dateLabels[weeklyMaxValues.maxDay] }}
                </p>
              </div>
            </div>
          </div>

          <div class="p-2 rounded-lg bg-opacity-10" :class="darkMode ? 'bg-yellow-500' : 'bg-yellow-100'">
            <div class="flex items-center">
              <div class="w-7 h-7 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-600'">
                <IconChartBar class="h-3.5 w-3.5" />
              </div>
              <div>
                <p class="text-xs font-medium" :class="darkMode ? 'text-yellow-200' : 'text-yellow-700'">
                  {{ t("admin.dashboard.highestDailyActivity") }}
                </p>
                <p class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-800'">{{ weeklyMaxValues.maxValue }} {{ t("admin.dashboard.items") }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Chart.js圖表 -->
        <div class="h-60 sm:h-68 md:h-72">
          <Bar v-if="chartType === 'bar'" :data="chartData" :options="chartOptions" />
          <Line v-else :data="chartData" :options="chartOptions" />
        </div>
      </div>
    </div>

    <!-- 系統資訊卡片 -->
    <div class="flex flex-col sm:flex-row gap-4">
      <!-- 版本資訊 -->
      <div class="flex-1 p-3 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex items-center mb-2">
          <div class="w-6 h-6 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'">
            <IconDocument class="h-3.5 w-3.5" />
          </div>
          <h3 class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
            {{ t("admin.dashboard.systemVersion") }}
          </h3>
        </div>
        <p v-if="!versionInfo.error" class="text-sm ml-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">v{{ versionInfo.version }}</p>
        <p v-else class="text-sm ml-8 text-red-500">{{ versionInfo.error }}</p>
      </div>

      <!-- 伺服器資訊 -->
      <div class="flex-1 p-3 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex items-center mb-2">
          <div class="w-6 h-6 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'">
            <IconServerStack class="h-3.5 w-3.5" />
          </div>
          <h3 class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
            {{ t("admin.dashboard.serverEnvironment") }}
          </h3>
        </div>
        <p v-if="!versionInfo.error" class="text-sm ml-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ versionInfo.environment }}
        </p>
        <p v-else class="text-sm ml-8 text-red-500">{{ versionInfo.error }}</p>
      </div>

      <!-- 資料庫資訊 -->
      <div class="flex-1 p-3 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex items-center mb-2">
          <div class="w-6 h-6 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'">
            <IconCircleStack class="h-3.5 w-3.5" />
          </div>
          <h3 class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
            {{ t("admin.dashboard.dataStorage") }}
          </h3>
        </div>
        <p v-if="!versionInfo.error" class="text-sm ml-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ versionInfo.storage }}
        </p>
        <p v-else class="text-sm ml-8 text-red-500">{{ versionInfo.error }}</p>
      </div>

      <!-- 上次更新時間 -->
      <div class="flex-1 p-3 rounded-lg shadow transition-shadow hover:shadow-md" :class="darkMode ? 'bg-gray-700' : 'bg-white'">
        <div class="flex items-center mb-2">
          <div class="w-6 h-6 rounded-full flex items-center justify-center mr-2" :class="darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'">
            <IconClock class="h-3.5 w-3.5" />
          </div>
          <h3 class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
            {{ t("admin.dashboard.lastUpdated") }}
          </h3>
        </div>
        <p class="text-sm ml-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ formatCurrentTime() }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 新增過渡動畫效果 */
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 300ms;
}

/* 快取卡片摺疊動畫 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-10px);
}

.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 200px;
  opacity: 1;
  transform: translateY(0);
}

/* 懸停效果 */
.hover\:shadow-md:hover {
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
}

/* Popover 懸浮列表動畫 */
.popover-fade-enter-active,
.popover-fade-leave-active {
  transition: all 0.15s ease-out;
}

.popover-fade-enter-from,
.popover-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.popover-fade-enter-to,
.popover-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>
