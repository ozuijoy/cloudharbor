export default {
  tasks: {
    title: '任務與操作',
    description: '檢視和管理系統中的所有後臺任務',
    loading: '載入中...',

    viewMode: {
      table: '表格檢視',
      card: '卡片檢視',
    },

    filters: {
      searchPlaceholder: '搜尋任務名稱、ID或路徑...',
      allStatuses: '全部狀態',
      allTypes: '全部型別',
      allCreators: '全部建立者',
      allTriggers: '全部觸發方式',
    },

    list: {
      title: '任務列表',
    },

    table: {
      name: '名稱',
      creator: '建立者',
      status: '狀態',
      progress: '統計/進度',
      actions: '操作',
      details: '任務詳情',
      createdAt: '建立時間',
    },

    status: {
      pending: '等待中',
      running: '執行中',
      completed: '已完成',
      failed: '失敗',
      cancelled: '已取消',
      partial: '部分成功',
    },

    actions: {
      refresh: '重新整理',
      cancel: '取消任務',
      expandAll: '展開全部',
      collapseAll: '收起全部',
      delete: '刪除任務',
      deleteShort: '刪除',
      viewDetails: '檢視詳情',
      deleteTask: '刪除任務',
      retryFile: '重試此檔案',
      retryAllFailed: '重試所有失敗檔案',
      retrySelected: '重試選中檔案',
    },

    labels: {
      creator: '建立者',
      created: '建立時間',
      progress: '進度',
    },

    creator: {
      admin: '管理員',
      keyPrefix: '金鑰: {key}',
    },

    time: {
      created: '建立時間',
    },

    details: {
      trigger: '來源',
      triggerRef: '來源引用',
      fileList: '檔案列表',
      itemList: '執行明細',
      sourcePath: '源路徑',
      targetPath: '目標路徑',
      payload: '任務引數',
      errorInfo: '錯誤資訊',
      noFiles: '暫無檔案資訊',
      none: '無',
    },

    timeline: {
      start: '開始',
      finish: '完成',
      duration: '耗時',
    },

    progress: {
      items: '{count} 項',
      empty: '-',
    },

    indexDetails: {
      rebuildTitle: '掛載點索引重建',
      applyDirtyTitle: '增量索引更新',
      mountUnit: '掛載點',
      queueUnit: '佇列',
      queueProcessed: '佇列處理',
      updated: '更新',
      deleted: '刪除',
      skipped: '跳過',
      duration: '耗時',
      discovered: '發現檔案/目錄',
      upserted: '寫入索引',
      path: '路徑',
      realtime: '實時進度',
      scannedDirs: '已掃描目錄',
      discoveredShort: '已發現',
      pending: '待寫入',
      noMounts: '暫無掛載點資訊',
      noRecords: '暫無處理記錄',
      unknownMount: '未知掛載點',
      errors: {
        indexNotReady: '索引未就緒',
        mountNotFound: '掛載點不存在',
        permissionDenied: '許可權不足',
      },
    },

    trigger: {
      manual: '手動',
      scheduled: '定時',
    },

    fileStatus: {
      success: '完成',
      processing: '傳輸中',
      retrying: '重試中',
      failed: '失敗',
      skipped: '跳過',
      pending: '等待',
    },

    retry: {
      retrying: '重試中',
      retryCount: '已重試 {count} 次',
      retrySuccess: '重試成功',
      retryFailed: '重試失敗',
      retryExhausted: '已達最大重試次數',
      withRetry: '(重試 {count} 次)',
    },

    error: {
      loadFailed: '載入任務列表失敗',
      cancelFailed: '取消任務失敗',
      deleteFailed: '刪除任務失敗',
      deleteBatchFailed: '批次刪除失敗，沒有任務被刪除',
      taskNotFound: '任務不存在',
      cannotDeleteRunning: '無法刪除執行中的任務，請先取消任務',
      cannotDeleteRunningBatch: '有 {count} 個任務正在執行，無法刪除。請先取消這些任務。',
      noTasksToDelete: '選中的任務均無法刪除',
      retryFailed: '重試失敗',
      noFailedFiles: '沒有失敗的檔案可以重試',
      cannotRetryRunning: '無法重試執行中的任務',
    },

    success: {
      deleted: '任務已刪除',
      deletedBatch: '成功刪除 {count} 個任務',
      deletedPartial: '刪除完成，成功 {success} 個，失敗 {failed} 個',
      retryStarted: '重試任務已建立',
      retryStartedWithCount: '已建立包含 {count} 個失敗檔案的重試任務',
    },

    confirmDelete: {
      title: '確認刪除',
      single: '確定要刪除任務 "{name}" 嗎？此操作不可恢復。',
      batch: '確定要刪除選中的 {count} 個任務嗎？此操作不可恢復。',
    },

    confirmCancel: {
      title: '確認取消',
      single: '確定要取消任務 "{name}" 嗎？取消後會儘快停止後續處理。',
      batch: '確定要取消選中的 {count} 個任務嗎？取消後會儘快停止後續處理。',
    },

    empty: {
      title: '暫無任務',
      description: '當前沒有任何任務記錄',
      tableNoData: '暫無任務',
    },

    taskName: {
      single: '{file}',
      batch: '{file} (+{count})',
      default: '任務 {id}',
    },

    taskType: {
      copy: '複製',
      fs_index_rebuild: '索引重建',
      fs_index_apply_dirty: '索引增量應用',
      unknown: '未知任務',
      unknownWithType: '未知任務（{type}）',
    },

    // 階段類任務的階段名稱
    stages: {
      scanning: '掃描檔案',
      indexing: '建立索引',
      finalizing: '完成收尾',
      loading: '載入變更',
      applying: '應用變更',
      committing: '提交更新',
      pending: '等待中',
      running: '執行中',
      completed: '已完成',
      failed: '失敗',
    },

    // 統計資訊
    stats: {
      total: '當前頁合計',
      running: '當前頁執行中',
      completed: '當前頁已完成',
      success: '成功',
      failed: '當前頁失敗',
      skipped: '跳過',
    },

    unknownFile: '未知檔案',
  },
};
