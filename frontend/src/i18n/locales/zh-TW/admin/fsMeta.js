export default {
  fsMeta: {
    // 頂部標題與工具欄
    title: "元資訊管理",
    toolbar: {
      create: "新建元資訊",
      createShort: "新建",
      refresh: "重新整理",
      refreshing: "重新整理中...",
      refreshShort: "刷",
    },

    // 搜尋與統計
    search: {
      placeholder: "搜尋路徑...",
      hint: "客戶端搜尋，支援路徑模糊匹配",
    },
    stats: {
      total: "共 {count} 條記錄",
      searchResultTag: "(搜尋結果)",
    },
    lastRefresh: "上次重新整理",

    // 通用文案
    common: {
      notSet: "未設定",
      set: "已設定",
      inherited: "繼承",
      inheritedSuffix: " (繼承)",
      loading: "載入中...",
      noDataCell: "無資料",
    },

    // 表格相關
    table: {
      path: "路徑",
      headerMarkdown: "頂部說明",
      footerMarkdown: "底部說明",
      hidePatterns: "隱藏規則",
      password: "密碼",
      createdAt: "建立時間",
      actions: "操作",
      noData: "暫無元資訊記錄",
    },

    // 表單相關
    form: {
      titleCreate: "建立元資訊",
      titleEdit: "編輯元資訊",
      tabs: {
        basic: "基本資訊",
        path: "路徑選擇",
      },
      path: {
        label: "路徑",
        required: "路徑不能為空",
        placeholder: "/claw",
        helper: "檔案系統路徑，必須以 / 開頭，可點選右側按鈕選擇",
        selectButton: "選擇路徑",
      },
      headerMarkdown: {
        label: "頂部說明 (Markdown)",
        placeholder: "支援 Markdown 格式的頂部說明...",
        inheritLabel: "子目錄繼承此說明",
      },
      footerMarkdown: {
        label: "底部說明 (Markdown)",
        placeholder: "支援 Markdown 格式的底部說明...",
        inheritLabel: "子目錄繼承此說明",
      },
      hidePatterns: {
        label: "隱藏規則 (正規表示式)",
        placeholder:
          "每行一個正規表示式，例如：\n^\\\\..*\n.*\\\\.tmp$\nnode_modules",
        inheritLabel: "子目錄繼承隱藏規則",
        helper: "匹配的檔案將在介面中隱藏（每行一個正規表示式）",
      },
      password: {
        label: "訪問密碼",
        placeholderKeep: "留空保持不變",
        placeholderSetOptional: "設定目錄訪問密碼（可選）",
        inheritLabel: "子目錄繼承密碼保護",
        helper: "設定後訪問此路徑需要驗證密碼",
      },
      pathSelector: {
        currentSelection: "當前選擇",
        selectDirectory: "選擇目錄",
        rootLabel: "/",
        loading: "載入中...",
      },
      actions: {
        cancel: "取消",
        create: "建立",
        creating: "建立中...",
        update: "更新",
        updating: "更新中...",
      },
      errors: {
        submitFailed: "提交失敗",
      },
    },

    // 密碼狀態
    passwordStatus: {
      inherited: "繼承保護",
      protected: "已保護",
    },

    // 隱藏規則顯示
    hidePatternsStatus: {
      count: "{count} 條",
    },

    // 刪除確認
    confirmDelete: {
      title: "確認刪除",
      message: '確定要刪除路徑 "{path}" 的元資訊嗎？',
      confirm: "刪除",
      cancel: "取消",
    },

    // 列表空態與錯誤
    empty: {
      noData: "暫無元資訊記錄",
      noSearchResults: "未找到匹配的元資訊記錄",
      createFirst: "建立第一條記錄",
    },

    // 成功提示
    success: {
      created: "元資訊建立成功",
      updated: "元資訊更新成功",
      deleted: "元資訊刪除成功",
    },

    // 錯誤提示
    error: {
      loadFailed: "載入元資訊列表失敗",
      createFailed: "建立元資訊失敗",
      updateFailed: "更新元資訊失敗",
      deleteFailed: "刪除元資訊失敗",
    },

    // 操作按鈕
    actions: {
      edit: "編輯",
      delete: "刪除",
    },
  },
};

