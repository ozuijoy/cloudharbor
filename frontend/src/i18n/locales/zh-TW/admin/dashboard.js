export default {
  dashboard: {
    systemOverview: "系統概覽",
    refresh: "重新整理",
    refreshing: "重新整理中...",
    refreshStorage: "重新整理儲存",
    refreshingStorage: "重新整理中...",
    refreshStorageTooltip: "重新計算所有儲存配置的用量快照",
    fetchError: "獲取資料失敗",
    loading: "載入中...",
    error: "載入失敗",

    // 統計卡片
    totalPastes: "文字分享",
    totalFiles: "檔案上傳",
    totalApiKeys: "API金鑰",
    totalStorageConfigs: "儲存配置",
    totalStorageUsed: "儲存使用",

    // 快取監控
    cacheMonitoring: "快取監控",
    directoryCache: "目錄快取",
    urlCache: "URL快取",
    searchCache: "搜尋快取",
    hitRate: "命中率",
    cacheItems: "快取項",
    cacheUnavailable: "快取資料不可用",
    clearAllCache: "清理所有快取",

    // 儲存相關
    storageUsage: "儲存使用情況(已用/限額)",
    storageConfigs: "儲存配置",
    noStorageConfigs: "暫無儲存配置",
    allStorages: "所有儲存",
    selectStorage: "選擇儲存",
    usagePercent: "使用率",
    availableStorage: "可用儲存",
    usedStorage: "已用儲存",
    remaining: "剩餘",
    total: "總容量",
    used: "已使用",
    available: "可用",
    unlimited: "不限額",
    configs: "個配置",
    exceeded: "已超限",

    // 儲存詳情
    showDetails: "檢視詳情",
    hideDetails: "隱藏詳情",
    providerQuota: "上游用量（總/已用）",
    quotaSnapshot: "配額快照",
    snapshotInfo: "快照資訊",
    snapshotTime: "上次快照",
    latestSnapshot: "最新快照",
    clickToViewList: "點選檢視列表",
    totalItems: "共 {count} 個",

    // 資料來源標籤
    sourceLabels: {
      provider: "上游資料",
      localFs: "磁碟掃描",
      vfsNodes: "虛擬檔案",
      fsIndex: "檔案索引",
      unknown: "未知來源",
    },

    // 資料來源描述
    sourceDescriptions: {
      provider: "資料來自儲存驅動的原生配額介面",
      localFs: "透過掃描本地磁碟目錄計算",
      vfsNodes: "基於虛擬檔案系統節點統計",
      fsIndex: "基於檔案索引記錄統計",
    },

    storageUnits: {
      bytes: "位元組",
      kb: "KB",
      mb: "MB",
      gb: "GB",
      tb: "TB",
    },

    // 圖表相關
    chartTitle: "過去7天活動統計",
    chartType: {
      bar: "柱狀圖",
      line: "折線圖",
      toggle: "切換圖表型別",
    },
    weeklyStats: "本週統計",
    weeklyActivity: "本週活動",
    weeklyPastes: "本週文字",
    weeklyFiles: "本週檔案",
    mostActiveDate: "最活躍日期",
    highestDailyActivity: "最高日活躍",
    activityOverview: "活動概覽",
    items: "項",
    switchToLineChart: "切換到折線圖",
    switchToBarChart: "切換到柱狀圖",
    dailyActivity: "每日活動",
    noData: "暫無資料",

    // 時間相關
    lastUpdated: "最後更新",
    timeAgo: "{time}前",
    justNow: "剛剛",

    // 儲存型別
    storageTypeDistribution: "儲存型別分佈",

    // 狀態資訊
    status: {
      healthy: "正常",
      warning: "警告",
      error: "錯誤",
      offline: "離線",
    },

    // 操作按鈕
    actions: {
      viewDetails: "檢視詳情",
      manage: "管理",
      configure: "配置",
      export: "匯出資料",
    },

    // 系統資訊
    systemVersion: "系統版本",
    serverEnvironment: "伺服器環境",
    dataStorage: "資料儲存",

    // 提示資訊
    tips: {
      noApiKeys: "還沒有建立API金鑰",
      noStorageConfigs: "還沒有配置儲存",
      noActivity: "最近沒有活動",
      lowStorage: "儲存空間不足",
    },
  },
};
