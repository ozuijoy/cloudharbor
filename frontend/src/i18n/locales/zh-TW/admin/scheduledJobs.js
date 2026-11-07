export default {
  scheduledJobs: {
    // 頁面標題
    title: "定時任務管理",
    subtitle: "管理系統定時任務的執行計劃和配置",

    // 工具欄
    toolbar: {
      createJob: "新建任務",
      refresh: "重新整理",
      filter: "篩選",
      search: "搜尋任務ID...",
      filterAll: "全部",
      filterEnabled: "已啟用",
      filterDisabled: "已禁用",
    },

    // 任務狀態
    status: {
      enabled: "已啟用",
      disabled: "已禁用",
      running: "執行中",
      unknownType: "未知型別",
      success: "成功",
      failure: "失敗",
      skipped: "跳過",
    },

    // Handler型別
    handlerType: {
      title: "任務型別",
      select: "選擇任務型別",
      selectPlaceholder: "請選擇任務型別...",
      category: {
        maintenance: "維護",
        business: "業務",
      },
    },

    // 警告資訊
    warnings: {
      handlerNotFound: "任務處理器不存在",
      handlerNotFoundHint: "該任務型別的處理器已被移除，任務將無法執行。建議刪除此任務或聯絡管理員。",
    },

    // 執行狀態
    runStatus: {
      success: "成功",
      failure: "失敗",
      skipped: "跳過",
    },

    // 任務卡片
    card: {
      interval: "執行間隔",
      lastRun: "上次執行",
      nextRun: "下次執行",
      lastRunResult: "最近執行",
      successRate: "成功率",
      never: "從未執行",
      notScheduled: "未計劃",
      ago: "前",
      later: "後",
      viewHistory: "檢視歷史",
      runNow: "立即執行",
      more: "更多",
    },

    // 平臺觸發器（Cloudflare/Docker）倒計時
    ticker: {
      title: "平臺觸發器倒計時",
      subtitle: "這是外部定時器（Cloudflare Cron / Docker 定時器）的下一次觸發時間，用於驅動後臺掃描執行到期任務。",
      refresh: "重新整理",
      runtime: "執行環境",
      cron: "觸發規則（cron）",
      next: "下次觸發",
      last: "上次觸發",
      dueNow: "即將觸發",
      waiting: "等待觸發",
      noNext: "暫無資料",
      loadFailed: "獲取觸發器狀態失敗",
    },

    // 操作按鈕
    actions: {
      enable: "啟用",
      disable: "禁用",
      edit: "編輯",
      delete: "刪除",
      viewDetail: "檢視詳情",
      runNow: "立即執行",
      viewHistory: "執行歷史",
    },

    // 表單
    form: {
      createTitle: "建立定時任務",
      editTitle: "編輯定時任務",
      createDescription: "配置並建立新的定時任務",
      editDescription: "修改現有定時任務的配置",
      name: "任務名稱",
      namePlaceholder: "用於在列表和時間線中展示的名稱",
      nameHint: "可選，未填寫時將使用任務型別名稱",
      description: "任務描述",
      descriptionPlaceholder: "簡要描述此作業的用途，例如：每天清理過期上傳會話",
      descriptionHint: "可選，用於說明任務的作用和注意事項",
      scheduleType: "排程型別",
      scheduleTypeInterval: "固定間隔",
      scheduleTypeCron: "Cron 表示式",
      scheduleTypeOneTime: "只執行一次",
      intervalSec: "執行間隔",
      intervalSecPlaceholder: "輸入秒數",
      intervalUnit: "時間單位",
      intervalValue: "間隔值",
      intervalHint: "最小間隔: 60秒",
      cronExample: "例如：0 2 * * * 表示每天凌晨 2 點執行",
      enabled: "啟用狀態",
      enabledLabel: "建立後立即啟用",
      config: "配置引數 (JSON)",
      configPlaceholder: '{\n  "key": "value"\n}',
      configHint: "任務特定的配置引數，必須是有效的JSON格式",
      validateJson: "驗證JSON",
      useTemplate: "使用模板",
      cancel: "取消",
      create: "建立任務",
      save: "儲存修改",
      backToList: "返回列表",
      // 步驟標題
      step1Title: "選擇型別",
      step2Title: "配置引數",
      step3Title: "執行計劃",
      // 配置模式
      modeForm: "表單",
      modeJson: "JSON",
      configParams: "配置引數",
      noConfigParams: "此任務型別無需配置引數",
      // 導航按鈕
      prevStep: "上一步",
      nextStep: "下一步",
      summary: "任務摘要",
      reviewTitle: "確認資訊",
      editInfo: "編輯",
    },

    // 時間單位
    timeUnit: {
      seconds: "秒",
      minutes: "分鐘",
      hours: "小時",
      days: "天",
    },

    // 詳情（當前使用的最小子集）
    detail: {
      title: "任務詳情",
      handlerType: "任務型別",
      status: "狀態",
      runCount: "執行次數",
      actions: "操作",
      lastRun: "上次執行",
      nextRun: "下次執行",
      configParams: "配置引數",
      recentRuns: "最近執行記錄",
      noRuns: "暫無執行記錄",
      notScheduled: "未安排",
      totalSessions: "表總數：{count}",
    },

    // 表單頁面錯誤提示
    errors: {
      jobNotFound: "定時任務不存在",
      loadFailed: "載入定時任務失敗",
      jobNotFoundHint: "請檢查任務 ID 是否正確，或返回列表重新選擇",
    },

    // 訊息提示
    loadFailed: "載入任務列表失敗",
    loadDetailFailed: "載入任務詳情失敗",
    createSuccess: "建立任務成功",
    createFailed: "建立任務失敗",
    updateSuccess: "更新任務成功",
    updateFailed: "更新任務失敗",
    deleteSuccess: "刪除任務成功",
    deleteFailed: "刪除任務失敗",
    toggleSuccess: "任務狀態已切換為 {status}",
    toggleFailed: "切換任務狀態失敗",
    loadRunsFailed: "載入執行歷史失敗",
    loadAnalyticsFailed: "載入統計資料失敗",
    runNowSuccess: "任務已觸發執行",
    runNowFailed: "觸發任務執行失敗",
    loadHandlerTypesFailed: "載入任務型別列表失敗",
    loadHandlerTypeFailed: "載入任務型別詳情失敗",

    // 確認對話方塊
    deleteConfirmTitle: "確認刪除",
    deleteConfirmMessage: "確定要刪除此定時任務嗎？此操作不可撤銷。",

    // 驗證訊息
    validation: {
      configInvalidJson: "配置引數必須是有效的JSON格式",
    },

    // 空狀態
    empty: {
      title: "暫無定時任務",
      description: '點選上方"新建任務"按鈕建立第一個定時任務',
    },

    // 統計與熱力圖
    stats: {
      sectionTitle: "統計與熱力圖",
      hourlyActivityTitle: "24小時執行活動",
      hourlyActivitySubtitle: "最近24小時",
      hourlyTooltip: "{hour}:00 · {count}次",
      legendNone: "無",
      legendRange1: "1-3",
      legendRange2: "4-7",
      legendRange3: "8-12",
      legendRange4: ">12",
      totalJobs: "總任務",
      enabledJobs: "已啟用",
      pendingJobs: "等待觸發",
      runningJobs: "執行中",
      nextTickCountdown: "預計下次觸發時間",
    },

    // 同步任務配置（同步任務表單和路徑選擇器使用）
    syncTask: {
      // 路徑對標題
      pairNumber: "路徑對 {n}",
      collapsePair: "收起路徑對",
      expandPair: "展開路徑對",

      // 源/目標路徑
      sourcePath: "源路徑",
      targetPath: "目標路徑",
      sourcePathHint: "可以是檔案或資料夾路徑",
      targetPathHint: "可以是資料夾路徑（自動拼接原始檔名），也可手動重新命名檔案路徑",
      quickInputPlaceholder: "輸入路徑後按回車...",
      copyPath: "複製路徑",
      collapse: "收起",
      expand: "展開",
      clearPath: "清除",

      // 路徑對操作
      addPathPair: "新增路徑對",
      advancedOptions: "高階選項",

      // 同步選項
      skipExisting: "跳過已存在檔案",
      skipExistingHint: "啟用後僅複製目標位置不存在的檔案（增量同步）",
      maxConcurrency: "複製併發數",
      concurrencyHint: "Workers 環境建議使用 1",

      // 路徑樹選擇器
      goToRoot: "返回根目錄",
      goUp: "返回上級",
      refresh: "重新整理",
      loading: "載入中...",
      retry: "點選重試",
      emptyDirectory: "空目錄",
      emptyDirectoryHint: "當前目錄下沒有可選內容",
      enterFolder: "進入資料夾",
    },
  },
};
