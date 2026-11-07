export default {
  fileBasket: {
    // 標題
    title: "檔案籃",
    
    // 按鈕文字
    button: {
      empty: "檔案籃",
      withCount: "檔案籃 ({count})",
    },

    // 面板標題和標籤
    panel: {
      title: "檔案籃",
      summary: "{fileCount} 個檔案，來自 {directoryCount} 個目錄",
      totalSize: "總大小：{size}MB",
      empty: "檔案籃為空",
      emptyDescription: "在檔案瀏覽器中選擇檔案並新增到檔案籃",
    },

    // 操作按鈕
    actions: {
      packDownload: "打包下載",
      clear: "清空籃子",
      close: "關閉",
      remove: "移除",
      addToBasket: "加入檔案籃",
      removeFromBasket: "從檔案籃移除",
      batchAdd: "批次加入",
      // 移動端短文字
      mobile: {
        batchAdd: "加入",
      },
    },

    // 訊息提示
    messages: {
      addSuccess: "已新增 {count} 個檔案到籃子，當前共 {total} 個檔案",
      addFailed: "新增檔案到籃子失敗",
      removeSuccess: "已從籃子移除檔案",
      removeFailed: "從籃子移除檔案失敗",
      toggleFailed: "切換檔案籃狀態失敗",
      batchAddSuccess: "已批次新增 {count} 個檔案到籃子，當前共 {total} 個檔案",
      batchAddFailed: "批次新增檔案到籃子失敗",
      clearSuccess: "已清空檔案籃",
      clearFailed: "清空檔案籃失敗",
      noFilesToAdd: "沒有可新增的檔案（資料夾將被忽略）",
      emptyBasket: "檔案籃為空，請先新增檔案",
      taskCreated: "已建立任務：{taskName}",
      taskCreateFailed: "建立打包任務失敗",
      cancelled: "操作已取消",
    },

    // 警告資訊
    warnings: {
      large: "選中檔案總大小約 {size}MB，打包可能需要一些時間",
      veryLarge: "選中檔案總大小約 {size}MB，打包可能需要較長時間且消耗較多記憶體",
    },

    // 確認對話方塊
    confirmations: {
      continueAnyway: "是否繼續？",
      clearBasket: "確定要清空檔案籃嗎？這將移除所有已收集的檔案。",
    },

    // 任務相關
    task: {
      name: "打包下載 {count} 個檔案（來自 {directories} 個目錄）",
      preparing: "正在準備下載...",
      downloading: "正在下載檔案...",
      generating: "正在生成壓縮包...",
      completed: "打包下載完成",
      failed: "打包下載失敗",
      summarySuccess: "成功下載 {count} 個檔案",
      summaryWithFailures: "成功: {success}，失敗: {failed}",
      failedFilesHeader: "以下檔案下載失敗：",
    },

    // 錯誤資訊
    errors: {
      noDownloadUrl: "無法獲取檔案下載連結",
      downloadFailed: "檔案下載失敗",
      zipGenerationFailed: "壓縮包生成失敗",
    },

    // 檔案資訊
    fileInfo: {
      fileName: "檔名",
      fileSize: "大小",
      sourceDirectory: "來源目錄",
      addedTime: "新增時間",
    },

    // 狀態文字
    status: {
      inBasket: "已在籃子中",
      notInBasket: "未在籃子中",
      processing: "處理中...",
      completed: "已完成",
      failed: "失敗",
    },
  },
};
