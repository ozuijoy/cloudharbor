export default {
  pwa: {
    // 狀態指示器
    status: {
      title: "PWA 狀態詳情",
      offline: "離線模式",
      updateAvailable: "有新版本",
      updating: "更新中",
      installable: "可安裝",
      ready: "PWA 就緒",
    },

    // 狀態標籤
    labels: {
      networkStatus: "網路狀態",
      installStatus: "安裝狀態",
      serviceWorker: "Service Worker",
      updateStatus: "更新狀態",
      notificationPermission: "通知許可權",
      backgroundSync: "後臺同步",
      appVersion: "應用版本",
    },

    // 網路狀態
    network: {
      online: "線上",
      offline: "離線",
    },

    // 安裝狀態
    install: {
      installed: "已安裝",
      notInstalled: "未安裝",
      installable: "可安裝",
      installing: "安裝中",
      installApp: "安裝應用",
      installPrompt: "將 CloudHarbor 新增到主螢幕，獲得更好的使用體驗",
    },

    // Service Worker 狀態
    serviceWorker: {
      unknown: "未知",
      installing: "安裝中",
      waiting: "等待中",
      active: "活躍",
      redundant: "已廢棄",
    },

    // 更新狀態
    update: {
      latest: "最新版本",
      available: "有更新",
      updating: "更新中",
      updateApp: "立即更新",
      checkUpdate: "檢查更新",
      checking: "檢查中",
      updatePrompt: "發現新版本，點選更新獲得最新功能",
      updateSuccess: "更新成功",
      updateFailed: "更新失敗",
    },

    // 通知許可權
    notification: {
      default: "未設定",
      granted: "已授權",
      denied: "已拒絕",
      enable: "啟用通知",
      requesting: "請求中",
      requestFailed: "請求通知許可權失敗",
    },

    // 後臺同步
    backgroundSync: {
      supported: "支援",
      notSupported: "不支援",
      syncing: "同步中",
      syncComplete: "同步完成",
      syncFailed: "同步失敗",
    },

    // 離線提示
    offline: {
      message: "您已離線，部分功能可能受限",
      restored: "網路已恢復，正在同步資料...",
      pageUnavailable: "{page}暫時無法訪問，請檢查網路連線",
    },

    // 安裝提示
    installPrompt: {
      title: "安裝應用",
      message: "將 CloudHarbor 新增到主螢幕，獲得更好的使用體驗",
      install: "安裝",
      later: "稍後",
      dismiss: "稍後",
    },

    // 更新提示
    updatePrompt: {
      title: "新版本可用",
      message: "發現新版本，點選更新獲得最新功能",
      update: "更新",
      later: "稍後",
      dismiss: "稍後",
    },

    // 操作按鈕
    actions: {
      install: "安裝",
      update: "更新",
      checkUpdate: "檢查更新",
      enableNotification: "啟用通知",
      close: "關閉",
      later: "稍後",
      dismiss: "稍後",
    },

    // 錯誤訊息
    errors: {
      installFailed: "安裝失敗",
      updateFailed: "更新失敗",
      notificationFailed: "通知許可權請求失敗",
      syncFailed: "資料同步失敗，請稍後重試",
      notSupported: "您的瀏覽器不支援此功能",
    },

    // 成功訊息
    success: {
      installed: "應用已成功安裝",
      updated: "應用已更新到最新版本",
      notificationEnabled: "通知許可權已啟用",
      syncComplete: "資料同步完成",
    },
  },
};
