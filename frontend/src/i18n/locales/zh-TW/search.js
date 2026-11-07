export default {
  search: {
    title: "檔案搜尋",
    placeholder: "搜尋檔名...",

    scope: {
      global: "全域性搜尋",
      mount: "單盤搜尋",
      directory: "當前及子目錄搜尋",
    },

    results: {
      foundInMounts: "在 {mounts} 個掛載點中找到 {count} 個檔案",
      loadMore: "載入更多",
      loadingMore: "載入更多結果...",
      noResults: "未找到匹配的檔案",
      noResultsHint: "請嘗試調整搜尋條件或使用不同的關鍵詞",

      item: {
        copyPath: "複製路徑",
      },
    },

    status: {
      idle: "請輸入搜尋關鍵詞",
      searching: "正在搜尋...",
      failed: "搜尋失敗",
    },

    errors: {
      queryTooShort: "搜尋關鍵詞至少需要3個字元",
      searchFailed: "搜尋失敗，請稍後重試",
      loadMoreFailed: "載入更多結果失敗",
    },

    history: {
      recent: "最近搜尋",
      clear: "清除歷史",
    },

    tips: {
      keywordTips: "支援檔名模糊搜尋",
    },

    notices: {
      pathRestricted: "已按你的許可權將搜尋範圍限制為：{path}",
      passwordFiltered: "已隱藏 {count} 條受密碼保護的結果",
    },
  },
};
