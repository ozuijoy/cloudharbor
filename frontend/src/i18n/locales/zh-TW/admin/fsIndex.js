export default {
  fsIndex: {
    title: "檔案系統索引管理",
    description: "管理檔案系統搜尋索引,支援全量重建和增量更新",

    // KPI 指標
    kpi: {
      health: "整體健康度",
      running: "執行中",
      pending: "待處理",
      lastUpdate: "最後更新",
      activeTasks: "個活躍任務",
      changes: "條變更",
      never: "從未",
      justNow: "剛剛",
      minutesAgo: "分鐘前",
      hoursAgo: "小時前",
      daysAgo: "天前",
    },

    viewMode: {
      table: "表格檢視",
      card: "卡片檢視",
    },

    // 索引狀態
    status: {
      notReady: "未就緒",
      indexing: "索引中",
      ready: "就緒",
      error: "錯誤",
      unknown: "未知",
    },

    // 建議操作
    action: {
      none: "無需操作",
      wait: "請等待",
      rebuild: "建議重建",
      applyDirty: "建議增量更新",
      unknown: "未知",
    },

    // 表格列
    table: {
      title: "掛載點索引狀態",
      mountName: "掛載點",
      storageType: "儲存型別",
      status: "索引狀態",
      dirtyCount: "待處理變更",
      lastIndexed: "最後索引時間",
      actions: "操作",
    },

    // 操作按鈕
    actions: {
      title: "快速操作",
      refresh: "重新整理",
      rebuildAll: "全量重建",
      applyDirtyAll: "增量更新",
      clearAll: "清空索引",
      stop: "停止",
      rebuild: "重建",
      applyDirty: "增量更新",
      clear: "清空",
    },

    // 操作面板描述
    actionPanel: {
      rebuildDesc: "掃描所有檔案，從頭重建搜尋索引",
      applyDirtyDesc: "處理待處理的變更，增量更新索引",
      clearDesc: "刪除所有索引資料，重建前搜尋將不可用",
    },

    // 執行中任務區域
    runningJobs: {
      title: "執行中的任務",
      empty: "當前沒有執行中的索引任務",
      processed: "已處理",
      mountProgress: "完成掛載點",
      scannedDirs: "已掃描目錄",
      discoveredCount: "已發現條目",
      upsertedCount: "已更新條目",
      duration: "耗時",
      lastUpdate: "最後更新",
      processing: "處理中",
    },

    // 任務型別
    taskType: {
      fs_index_rebuild: "索引重建",
      fs_index_apply_dirty: "增量更新",
    },

    // 確認對話方塊
    confirm: {
      rebuildTitle: "確認重建索引",
      rebuildAll: "確定要重建所有掛載點的索引嗎？這可能需要較長時間。",
      rebuildSelected: "確定要重建選中的 {count} 個掛載點的索引嗎？",
      applyDirtyTitle: "確認增量更新",
      applyDirtyAll: "確定要對所有掛載點執行增量更新嗎？",
      applyDirtySelected: "確定要對選中的 {count} 個掛載點執行增量更新嗎？",
      clearTitle: "確認清空索引",
      clearAll: "確定要清空所有索引資料嗎？清空後需要重新重建索引才能使用搜尋功能。",
      clearSelected: "確定要清空選中的 {count} 個掛載點的索引嗎？",
      stopTitle: "確認停止任務",
      stopJob: "確定要停止任務 {jobId} 嗎？",
    },

    // 成功訊息
    success: {
      rebuildStarted: "索引重建任務已建立",
      applyDirtyStarted: "增量更新任務已建立",
      stopped: "任務已停止",
      cleared: "索引已清空",
    },

    // 錯誤訊息
    error: {
      loadFailed: "載入索引狀態失敗",
      rebuildFailed: "建立重建任務失敗",
      applyDirtyFailed: "建立增量更新任務失敗",
      stopFailed: "停止任務失敗",
      clearFailed: "清空索引失敗",
    },

    // 空狀態
    empty: {
      title: "暫無掛載點",
      description: "當前沒有配置任何掛載點",
    },

    // 卡片檢視
    card: {
      neverIndexed: "從未索引",
    },

    // 狀態圖表
    chart: {
      title: "狀態分佈",
      total: "總計",
    },

    // 篩選
    filter: {
      all: "全部",
      placeholder: "搜尋掛載點...",
      noResults: "沒有找到匹配的掛載點",
    },

    // 高階選項
    advancedOptions: {
      title: "高階選項",
      description: "配置重建和更新引數",
      rebuildOptions: "重建選項",
      applyDirtyOptions: "增量更新選項",
      batchSize: "批次大小",
      maxDepth: "最大深度",
      maxItems: "最大條目數",
      forceRefresh: "強制重新整理（跳過快取）",
      rebuildSubtree: "遞迴重建目錄子樹",
      unlimited: "不限制",
      resetDefaults: "重置為預設值",
    },
  },
};
