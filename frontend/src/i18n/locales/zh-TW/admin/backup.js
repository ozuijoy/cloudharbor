export default {
  backup: {
    title: "資料備份與恢復",
    subtitle: "管理系統資料的備份和恢復操作",
    operationLogs: "操作日誌",

    // 備份操作
    backupOperations: {
      title: "備份操作",
      backupType: "備份型別：",
      fullBackup: {
        title: "完整備份",
        description: "備份所有資料和配置（推薦）",
      },
      moduleBackup: {
        title: "模組選擇備份",
        description: "選擇特定功能模組進行備份",
      },
      selectModules: "選擇要備份的模組：",
      selectedModules: "已選擇 {count} 個模組",
      createBackup: "建立備份",
      creating: "建立中...",
    },

    // 恢復操作
    restoreOperations: {
      title: "恢復操作",
      selectFile: "選擇備份檔案",
      restoreMode: "恢復模式：",
      overwriteMode: "覆蓋",
      mergeMode: "合併",
      executeRestore: "執行恢復",
      restoring: "恢復中...",
    },

    // 模組定義
    modules: {
      text_management: {
        name: "文字管理",
        description: "文字分享資料和密碼",
      },
      file_management: {
        name: "檔案管理",
        description: "檔案分享資料和密碼",
      },
      mount_management: {
        name: "掛載管理",
        description: "儲存掛載點配置",
      },
      storage_config: {
        name: "儲存配置管理",
        description: "儲存配置資訊和訪問控制",
      },
      key_management: {
        name: "金鑰管理",
        description: "API金鑰管理",
      },
      account_management: {
        name: "賬號管理",
        description: "管理員賬號和令牌",
      },
      system_settings: {
        name: "系統設定",
        description: "系統全域性設定",
      },
      fs_meta_management: {
        name: "目錄元資訊管理",
        description: "目錄元資訊配置",
      },
      task_management: {
        name: "任務管理",
        description: "非同步任務執行記錄和狀態",
      },
      upload_sessions: {
        name: "分片上傳會話管理",
        description: "分片上傳會話記錄和狀態"
      },
      vfs_management: {
        name: "虛擬目錄樹管理",
        description: "虛擬目錄樹索引。建議與“儲存配置”“掛載管理”一起備份",
      },
    },

    // 日誌和狀態訊息
    logs: {
      startFullBackup: "開始建立完整備份...",
      startModuleBackup: "開始建立模組備份 ({count}個模組)...",
      backupFileParsed: "備份檔案解析成功（本地）",
      previewStart: "開始預檢查（{mode}模式）...",
      previewPassed: "預檢查透過，可以開始恢復",
      previewFailed: "預檢查發現問題，已取消恢復",
      previewIssue: "預檢查問題：{message}",
      previewIssueUnknown: "未知問題",
      previewBlockedRestore: "預檢查未透過，已阻止執行恢復",
      previewIntegrityIssues: "預檢查提示：發現 {count} 個潛在資料完整性問題",
      restoreIntegrityIssues: "恢復提示：發現 {count} 個資料完整性問題",
      serverWarning: "提示：{message}",
      startRestore: "開始執行恢復 ({mode}模式)...",
      backupComplete: "備份建立完成，共匯出{count}條記錄",
      moduleBackupComplete: "模組備份建立完成，共匯出{count}條記錄",
      downloadStarted: "備份檔案開始下載",
      restoreComplete: "資料恢復完成，共新增{added}條記錄，忽略{ignored}條重複記錄",
      restoreCompleteOverwrite: "資料恢復完成，共恢復{count}條記錄",
      tableExported: "{table}表: 匯出{count}條記錄",
      tableRestored: "{table}表: 新增{added}條，忽略{ignored}條，預期{expected}條 (部分已存在)",
      tableRestoredOverwrite: "{table}表: 成功{success}條，預期{expected}條",
      gettingModuleInfo: "正在獲取模組資訊...",
      moduleInfoSuccess: "模組資訊獲取成功",
      recordsCount: "{count} 條記錄",
      clearLogs: "清空日誌",
    },

    // 錯誤訊息
    errors: {
      selectAtLeastOneModule: "請選擇至少一個模組",
      getModuleInfoFailed: "獲取模組資訊失敗: {error}",
      backupFailed: "備份建立失敗: {error}",
      restoreFailed: "資料恢復失敗: {error}",
      fileSelectRequired: "請先選擇備份檔案",
      invalidBackupFile: "無效的備份檔案格式",
      parseBackupFailed: "解析備份檔案失敗: {error}",
    },

    // 成功訊息
    success: {
      backupCreated: "備份建立成功",
      dataRestored: "資料恢復成功",
    },

    // 確認對話方塊
    confirmations: {
      restoreOverwrite: "覆蓋模式將替換現有資料，此操作不可撤銷。確定要繼續嗎？",
      restoreMerge: "合併模式將保留現有資料並新增新資料。確定要繼續嗎？",
    },
  },
};
