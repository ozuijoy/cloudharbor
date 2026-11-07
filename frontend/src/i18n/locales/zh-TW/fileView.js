export default {
  fileView: {
    title: "檔案預覽",
    loading: "載入中...",
    error: "載入失敗",
    notFound: "檔案不存在",

    // 檔案資訊
    fileInfo: {
      filename: "檔名",
      fileSize: "檔案大小",
      uploadTime: "上傳時間",
      mimetype: "檔案型別",
      fileLink: "檔案連結",
      needPassword: "需要密碼訪問",
      copyLink: "複製連結",
      linkCopied: "連結已複製到剪貼簿",
      copyFailed: "複製失敗",
      accessCount: "訪問次數",
      expiresAt: "過期時間",
      accessMode: "訪問模式",
      proxyAccess: "本地代理訪問",
      directAccess: "直鏈/URL代理訪問",
      limit: "限制",
    },

    // 密碼驗證
    password: {
      title: "請輸入訪問密碼",
      description: "此檔案已被密碼保護，請輸入密碼檢視內容",
      label: "密碼",
      placeholder: "請輸入密碼",
      submit: "確認",
      error: "密碼錯誤，請重試",
      loading: "驗證中...",
      showPassword: "顯示密碼",
      hidePassword: "隱藏密碼",
    },

    // 檔案操作
    actions: {
      download: "下載檔案",
      downloadFile: "下載檔案",
      updateSuccess: "檔案資訊更新成功",
      downloadFailed: "下載失敗",
      downloadExpired: "下載連結可能已過期，請嘗試重新整理獲取新的下載連結",
      share: "分享連結",
      shareFileText: "分享檔案",
      edit: "編輯資訊",
      delete: "刪除檔案",
      preview: "預覽檔案",
      previewFailed: "預覽失敗",
      getPreviewUrlFailed: "獲取預覽URL失敗",
      noUrlInResponse: "返回資料中沒有URL",
      shareSuccess: "分享成功",
      shareFailed: "分享失敗",
      deleteConfirm: "確定要刪除這個檔案嗎？此操作無法撤銷。",
      deleteSuccess: "檔案刪除成功",
      deleteFailed: "刪除失敗",
      deleting: "刪除中...",
      noPermission: "沒有足夠的許可權",
      redirecting: "秒後自動跳轉",
      redirectMessage: "檔案已成功刪除，即將跳轉到首頁",
      retry: "重試",
      refresh: "重新整理",
      manualCopy: "無法自動複製，請手動複製連結",
      copyLink: "複製連結",
      copied: "已複製",
      nativeShare: "原生分享",
      shareToSocial: "分享到社交平臺",
      qrCode: "二維碼",
      generating: "生成中...",
      scanToShare: "掃碼分享",
      qrCodeError: "生成失敗",
      shareFileText: "分享檔案：{filename}",
    },

    // 檔案預覽
    preview: {
      loading: "載入預覽中...",
      error: "預覽載入失敗",
      notSupported: "此檔案型別不支援預覽",
      downloadToView: "請下載檔案檢視",
      fullscreen: "全屏",
      exitFullscreen: "退出全屏",

      // 文字預覽模式切換（統一歸屬“文字預覽”）
      modes: {
        text: "文字",
        code: "程式碼",
        markdown: "Markdown",
        html: "HTML",
      },

      // 通用預覽
      generic: {
        applicationFile: "應用程式檔案",
        fontFile: "字型檔案",
        modelFile: "3D模型檔案",
        unsupportedType: "此檔案型別不支援線上預覽",
        downloadAndExtract: "請下載後使用解壓軟體開啟",
        downloadAndInstall: "請下載後安裝或執行",
        downloadAndOpenWithDb: "請下載後使用資料庫工具開啟",
        downloadAndInstallFont: "請下載後安裝字型",
        downloadAndMount: "請下載後掛載或燒錄",
        downloadAndOpenWith: "請下載後使用相應的應用程式開啟",
        showDetails: "顯示詳細資訊",
        hideDetails: "隱藏詳細資訊",
        fileInfo: "檔案資訊",
        filename: "檔名",
        mimeType: "MIME型別",
        fileExtension: "副檔名",
        suggestedApps: "建議使用",
      },

      // 文字預覽
      text: {
        title: "文字檔案預覽",
        loading: "載入中...",
        error: "載入文字內容失敗",
        tooLarge: "檔案過大，為了效能考慮，請下載後檢視完整內容",
        truncated: "內容已截斷，請下載檢視完整檔案",
      },

      // 程式碼預覽
      code: {
        title: "程式碼預覽",
        loading: "載入中...",
      },

      // 配置檔案預覽
      config: {
        title: "配置檔案預覽",
        loading: "載入中...",
      },

      // Markdown預覽
      markdown: {
        title: "Markdown預覽",
        loading: "載入中...",
        error: "Markdown預覽載入失敗",
      },

      // HTML預覽
      html: {
        title: "HTML預覽",
        loading: "載入中...",
        loadingSource: "載入HTML原始碼中...",
        error: "HTML載入失敗",
        viewSource: "檢視原始碼",
        viewRendered: "檢視渲染",
      },

      // PDF預覽
      pdf: {
        title: "PDF預覽",
        loading: "載入中...",
        error: "PDF載入失敗",
        browserNative: "原生預覽",
        pdfjsLabel: "PDF.js",
      },

      // EPUB預覽
      epub: {
        title: "EPUB預覽",
        loading: "載入中...",
        error: "EPUB載入失敗",
        browserNative: "本地預覽",
        toc: "目錄",
        closeToc: "關閉目錄",
        noToc: "無目錄",
        readingMode: "閱讀模式",
        modePaginated: "翻頁",
        modeScrolled: "滾動",
        prevPage: "上一頁",
        nextPage: "下一頁",
        page: "第",
        bookmarks: "書籤",
        addBookmark: "新增書籤",
        removeBookmark: "移除書籤",
        untitledBookmark: "未命名書籤",
        historyBack: "返回",
        historyForward: "前進",
        progressSaved: "進度已儲存",
        progressRestored: "已恢復到上次閱讀位置",
      },

      // 圖片預覽
      image: {
        title: "圖片預覽",
        loading: "載入中...",
        error: "圖片載入失敗",
      },

      // 影片預覽
      video: {
        title: "影片預覽",
        loading: "載入中...",
        error: "影片載入失敗",
        notSupported: "您的瀏覽器不支援影片標籤",
        hlsShareNotSupportedTitle: "分享頁不支援 m3u8 切片影片",
        hlsShareNotSupportedTip:
          "這是 m3u8 清單檔案，分享頁（單檔案）無法播放。請回到“掛載瀏覽”頁面配合分片播放",
      },

      // 直鏈預覽提示
      directNotSupported: "當前儲存不支援直鏈預覽，請切換為代理模式。",

      // 音訊預覽
      audio: {
        title: "音訊預覽",
        loading: "載入中...",
        error: "音訊載入失敗",
        notSupported: "您的瀏覽器不支援音訊標籤",
      },

      // Office預覽
      office: {
        title: "Office預覽",
        loading: "載入中...",
        loadingDetail: "載入Office預覽中，請稍候...",
        error: "Office預覽載入失敗",
        useMicrosoft: "使用Microsoft預覽",
        useGoogle: "使用Google預覽",
        refreshPreview: "重新整理預覽",
        downloadFile: "下載檔案",
        previewTrouble: "如果預覽不正常，請嘗試",
        switchService: "或切換預覽服務，或",
        afterDownload: "後檢視",
        wordPreview: "Word文件預覽",
        excelPreview: "Excel表格預覽",
        powerpointPreview: "PowerPoint簡報預覽",
        passwordIssue: "似乎是密碼驗證問題，請嘗試：",
        refreshAndRetry: "重新整理頁面後重新輸入密碼",
        confirmPassword: "確認您輸入的密碼正確",
        tryUrlPassword: "嘗試在URL中直接新增密碼引數",
        googleService: "使用Google Docs服務",
        microsoftService: "使用Microsoft Office服務",
        proxyMode: " (Worker代理模式)",
        directMode: " (直接訪問模式)",
        providerMicrosoft: "Microsoft Office Online",
        providerGoogle: "Google Docs",
      },
    },

    // 錯誤訊息
    errors: {
      networkError: "網路錯誤，請檢查網路連線",
      serverError: "伺服器錯誤，請稍後重試",
      unauthorized: "未授權訪問",
      forbidden: "訪問被禁止",
      notFound: "檔案不存在",
      unknown: "未知錯誤",
      missingSlug: "缺少檔案識別符號",
      loadFailed: "無法載入檔案資訊",
      getDetailsFailed: "獲取詳情失敗",
      getDetailsFailedMessage: "獲取檔案詳情失敗，將使用當前顯示的資訊",
      updateFailed: "更新失敗",
    },
  },
};
