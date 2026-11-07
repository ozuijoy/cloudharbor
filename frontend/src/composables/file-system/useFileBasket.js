/**
 * 檔案籃 Composable
 * 處理檔案籃相關的業務邏輯，連線Store和元件
 */

import { computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useFileBasketStore } from "@/stores/fileBasketStore.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useTaskManager } from "@/utils/taskManager.js";
import { api } from "@/api";
import { formatNowForFilename } from "@/utils/timeUtils.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { getZipJsDefaultConfig } from "@/utils/zipjsRuntimeUris.js";
import { createLogger } from "@/utils/logger.js";

// zip.js 全域性 configure
let isZipJsConfigured = false;

export function useFileBasket() {
  const { t } = useI18n();
  const fileBasketStore = useFileBasketStore();
  const authStore = useAuthStore();
  const taskManager = useTaskManager();
  const pathPassword = usePathPassword();
  const log = createLogger("FileBasket");

  // ===== 全域性清理狀態跟蹤 =====

  // 跟蹤所有活動的XMLHttpRequest（全域性級別）
  const globalActiveXHRs = new Set();

  // 跟蹤所有事件監聽器
  const globalEventListeners = new Set();

  // 跟蹤所有活動的 ZIP 寫入流（File System Access API）
  const globalActiveZipWritables = new Set();

  // 全域性清理函式
  const globalCleanup = () => {
    // 取消所有活動的XMLHttpRequest
    globalActiveXHRs.forEach((xhr) => {
      if (xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort();
      }
    });
    globalActiveXHRs.clear();

    // 中止所有活動的 ZIP 寫入流
    globalActiveZipWritables.forEach((writable) => {
      try {
        if (writable && typeof writable.abort === "function") {
          writable.abort();
        }
      } catch (e) {
        log.warn("中止 ZIP 寫入流失敗:", e?.message || e);
      }
    });
    globalActiveZipWritables.clear();

    // 移除所有事件監聽器
    globalEventListeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });
    globalEventListeners.clear();

    log.debug("檔案籃composable已清理所有資源");
  };

  // ===== Store狀態解構 =====
  const { collectedFiles, isBasketOpen, collectionCount, hasCollection, collectionTotalSize, collectionTotalSizeMB, filesByDirectory, directoryCount, isInitialized } =
    storeToRefs(fileBasketStore);

  // ===== 計算屬性 =====

  /**
   * 檔案籃按鈕顯示文字
   */
  const basketButtonText = computed(() => {
    try {
      if (collectionCount.value === 0) {
        return t("fileBasket.button.empty");
      }
      return t("fileBasket.button.withCount", { count: collectionCount.value });
    } catch (error) {
      log.warn("國際化函式呼叫失敗，使用預設文字:", error);
      // 使用預設文字作為後備
      if (collectionCount.value === 0) {
        return "檔案籃";
      }
      return `檔案籃 (${collectionCount.value})`;
    }
  });

  /**
   * 檔案籃摘要資訊
   */
  const basketSummary = computed(() => {
    return {
      fileCount: collectionCount.value,
      directoryCount: directoryCount.value,
      totalSizeMB: collectionTotalSizeMB.value,
      isEmpty: !hasCollection.value,
    };
  });

  // ===== 檔案籃操作方法 =====

  /**
   * 新增檔案到籃子
   * @param {Object|Array} files - 檔案或檔案陣列
   * @param {string} currentPath - 當前目錄路徑
   * @returns {Object} 操作結果
   */
  const addToBasket = (files, currentPath) => {
    try {
      const fileArray = Array.isArray(files) ? files : [files];
      const fileItems = fileArray.filter((item) => !item.isDirectory);

      if (fileItems.length === 0) {
        return {
          success: false,
          message: t("fileBasket.messages.noFilesToAdd"),
        };
      }

      fileBasketStore.addToBasket(fileItems, currentPath);

      return {
        success: true,
        message: t("fileBasket.messages.addSuccess", {
          count: fileItems.length,
          total: collectionCount.value,
        }),
      };
    } catch (error) {
      log.error("新增檔案到籃子失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.addFailed"),
      };
    }
  };

  /**
   * 從籃子移除檔案
   * @param {string|Array} filePaths - 檔案路徑
   * @returns {Object} 操作結果
   */
  const removeFromBasket = (filePaths) => {
    try {
      fileBasketStore.removeFromBasket(filePaths);
      return {
        success: true,
        message: t("fileBasket.messages.removeSuccess"),
      };
    } catch (error) {
      log.error("從籃子移除檔案失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.removeFailed"),
      };
    }
  };

  /**
   * 切換檔案在籃子中的狀態
   * @param {Object} file - 檔案物件
   * @param {string} currentPath - 當前目錄路徑
   * @returns {Object} 操作結果
   */
  const toggleFileInBasket = (file, currentPath) => {
    try {
      const isInBasket = fileBasketStore.isFileInBasket(file.path);
      fileBasketStore.toggleFileInBasket(file, currentPath);

      return {
        success: true,
        isInBasket: !isInBasket,
        message: isInBasket ? t("fileBasket.messages.removeSuccess") : t("fileBasket.messages.addSuccess", { count: 1, total: collectionCount.value }),
      };
    } catch (error) {
      log.error("切換檔案籃狀態失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.toggleFailed"),
      };
    }
  };

  /**
   * 批次新增選中檔案到籃子
   * @param {Array} selectedFiles - 選中的檔案列表
   * @param {string} currentPath - 當前目錄路徑
   * @returns {Object} 操作結果
   */
  const addSelectedToBasket = (selectedFiles, currentPath) => {
    try {
      const addedCount = fileBasketStore.addSelectedToBasket(selectedFiles, currentPath);

      if (addedCount === 0) {
        return {
          success: false,
          message: t("fileBasket.messages.noFilesToAdd"),
        };
      }

      return {
        success: true,
        addedCount,
        message: t("fileBasket.messages.batchAddSuccess", {
          count: addedCount,
          total: collectionCount.value,
        }),
      };
    } catch (error) {
      log.error("批次新增檔案到籃子失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.batchAddFailed"),
      };
    }
  };

  // ===== 面板管理方法 =====

  /**
   * 開啟檔案籃面板
   */
  const openBasket = () => {
    fileBasketStore.openBasket();
  };

  /**
   * 關閉檔案籃面板
   */
  const closeBasket = () => {
    fileBasketStore.closeBasket();
  };

  /**
   * 切換檔案籃面板顯示狀態
   */
  const toggleBasket = () => {
    fileBasketStore.toggleBasket();
  };

  // ===== 清理方法 =====

  /**
   * 清空檔案籃
   * @returns {Object} 操作結果
   */
  const clearBasket = () => {
    try {
      fileBasketStore.clearBasket();
      return {
        success: true,
        message: t("fileBasket.messages.clearSuccess"),
      };
    } catch (error) {
      log.error("清空檔案籃失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.clearFailed"),
      };
    }
  };

  /**
   * 重置檔案籃（清空並關閉面板）
   */
  const resetBasket = () => {
    fileBasketStore.resetBasket();
  };

  // ===== 打包下載方法 =====

  /**
   * 嘗試使用 File System Access API 建立 ZIP 寫入目標
   * - 僅在 Chromium 系瀏覽器、且 secure context 下可用
   * - 不可用時返回 null（由呼叫方降級到 BlobWriter + file-saver）
   * @param {string} suggestedName
   * @returns {Promise<null | { mode: "fs_access", writable: any, fileName: string }>}
   */
  const tryPickZipSaveTarget = async (suggestedName) => {
    if (typeof window === "undefined") return null;
    if (typeof window.showSaveFilePicker !== "function") return null;
    if (!window.isSecureContext) return null;

    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || "CloudHarbor.zip",
      types: [
        {
          description: "ZIP 檔案",
          accept: {
            "application/zip": [".zip"],
          },
        },
      ],
      excludeAcceptAllOption: true,
    });

    const writable = await handle.createWritable();
    return {
      mode: "fs_access",
      writable,
      fileName: handle?.name || suggestedName || "CloudHarbor.zip",
    };
  };

  /**
   * 建立打包下載任務
   * @returns {Promise<Object>} 操作結果
   */
  const createPackTask = async () => {
    try {
      if (!hasCollection.value) {
        return {
          success: false,
          message: t("fileBasket.messages.emptyBasket"),
        };
      }

      // 先生成檔名（保持與舊邏輯一致），用於：
      // - File System Access API 的 suggestedName
      // - Blob 模式下 saveAs 的下載檔名
      const timestamp = formatNowForFilename();
      const suggestedZipFileName = `CloudHarbor_${timestamp}.zip`;

      // 優先嚐試 File System Access API
      /** @type {null | { mode: "fs_access", writable: any, fileName: string }} */
      let outputTarget = null;
      /** @type {string} */
      let zipFileName = suggestedZipFileName;
      try {
        const picked = await tryPickZipSaveTarget(suggestedZipFileName);
        if (picked) {
          outputTarget = picked;
          zipFileName = picked.fileName || suggestedZipFileName;
        }
      } catch (e) {
        // 使用者取消“儲存為”對話方塊：不建立任務，直接提示
        if (e?.name === "AbortError") {
          return {
            success: false,
            message: "已取消儲存",
          };
        }
        throw e;
      }

      // 建立任務
      const taskName = t("fileBasket.task.name", {
        count: collectionCount.value,
        directories: directoryCount.value,
      });

      const taskId = taskManager.addTask("download", taskName, collectionCount.value);

      // 啟動非同步打包處理
      processPackTask(taskId, { outputTarget, zipFileName });

      return {
        success: true,
        taskId,
        message: t("fileBasket.messages.taskCreated", { taskName }),
      };
    } catch (error) {
      log.error("建立打包任務失敗:", error);
      return {
        success: false,
        message: t("fileBasket.messages.taskCreateFailed"),
      };
    }
  };

  /**
   * 處理打包任務（非同步）
   * @param {number} taskId - 任務ID
   * @param {{ outputTarget?: null | { mode: "fs_access", writable: any, fileName: string }, zipFileName?: string }} [options]
   */
  const processPackTask = async (taskId, options = {}) => {
    // 初始化檔案狀態跟蹤
    const fileStates = new Map();

    // 清理函式
    const cleanup = () => {
      if (fileStates) {
        fileStates.clear();
      }
    };

    const outputTarget = options?.outputTarget || null;
    const zipFileName = options?.zipFileName || `CloudHarbor_${formatNowForFilename()}.zip`;
    const isFsAccessMode = outputTarget?.mode === "fs_access" && outputTarget?.writable;

    try {
      if (isFsAccessMode) {
        globalActiveZipWritables.add(outputTarget.writable);
      }

      // 更新任務狀態
      taskManager.updateTaskProgress(taskId, 0, {
        status: t("fileBasket.task.preparing"),
        total: collectionCount.value,
        processed: 0,
        currentFile: "",
        startTime: new Date().toISOString(),
      });

      // 獲取收集的檔案
      const files = fileBasketStore.getCollectedFiles();

      // 動態匯入 zip.js（file-saver 僅在 Blob 模式需要）
      const { ZipWriter, BlobWriter, BlobReader, HttpReader, configure } = await import("@zip.js/zip.js");
      const saveAs = isFsAccessMode ? null : (await import("file-saver")).saveAs;

      // 顯式配置 workerURI/wasmURI
      if (!isZipJsConfigured) {
        configure(getZipJsDefaultConfig());
        isZipJsConfigured = true;
      }

      // 建立 ZipWriter
      log.debug(`處理 ${files.length} 個檔案`);
      const zipOutput = isFsAccessMode ? outputTarget.writable : new BlobWriter("application/zip");
      const zipWriter = new ZipWriter(zipOutput, {
        // 生成 >4GB 的 zip，需要顯式開啟 zip64
        zip64: true,
        keepOrder: true, // 保持檔案順序
        useWebWorkers: true, // 啟用Web Workers
        useCompressionStream: true, // 使用原生壓縮流
        bufferedWrite: false, // 不緩衝寫入，減少記憶體佔用
      });
      const failedFiles = [];
      const addedFiles = new Set();

      /**
       * 預先分配 ZIP 內路徑（避免併發下 addedFiles 競態）
       * @param {any} file
       * @returns {string}
       */
      const reserveZipPath = (file) => {
        const directoryName = (file?.sourceDirectory || "")
          .replace(/^\//, "")
          .replace(/\//g, "_") || "root";
        const zipPath = `${directoryName}/${file.name}`;

        let finalZipPath = zipPath;
        let counter = 1;
        while (addedFiles.has(finalZipPath)) {
          const lastDotIndex = zipPath.lastIndexOf(".");
          if (lastDotIndex > 0) {
            const name = zipPath.substring(0, lastDotIndex);
            const ext = zipPath.substring(lastDotIndex);
            finalZipPath = `${name}_${counter}${ext}`;
          } else {
            finalZipPath = `${zipPath}_${counter}`;
          }
          counter++;
        }
        addedFiles.add(finalZipPath);
        return finalZipPath;
      };

      /**
       * 有限併發執行器（避免網路/Worker/記憶體峰值）
       * @template T
       * @param {T[]} items
       * @param {number} limit
       * @param {(item:T)=>Promise<any>} worker
       */
      const runWithConcurrency = async (items, limit, worker) => {
        const safeLimit = Math.max(1, Math.min(limit || 1, items.length || 1));
        let index = 0;
        const runners = Array.from({ length: safeLimit }).map(async () => {
          while (index < items.length) {
            const current = items[index++];
            await worker(current);
          }
        });
        await Promise.all(runners);
      };

      // 初始化檔案狀態
      files.forEach((file) => {
        fileStates.set(file.path, {
          name: file.name,
          path: file.path,
          size: file.size,
          status: "pending",
          progress: 0,
          receivedBytes: 0,
          totalBytes: file.size || 0,
        });
      });

      const processOneFile = async (file) => {
        try {
          const finalZipPath = reserveZipPath(file);
          const downloadUrl = await getFileDownloadUrl(file);

          // 更新檔案狀態
          let fileState = fileStates.get(file.path);
          if (fileState) {
            fileState.status = "downloading";
          }

          await zipWriter.add(
            finalZipPath,
            new HttpReader(downloadUrl, {
              preventHeadRequest: true, // 避免額外的HEAD請求
              useXHR: false, // 使用fetch API
            }),
            {
              useWebWorkers: true, // 啟用Web Workers
              useCompressionStream: true, // 使用原生壓縮流
              onprogress: (progress, total) => {
                if (fileState) {
                  fileState.progress = total > 0 ? Math.round((progress / total) * 100) : 0;
                  fileState.receivedBytes = progress;
                  fileState.totalBytes = total;

                  const completedFiles = Array.from(fileStates.values()).filter((f) => f.status === "completed").length;
                  const currentRatio = total > 0 ? progress / total : 0;
                  const overallProgress = Math.round(((completedFiles + currentRatio) / files.length) * 90);

                  taskManager.updateTaskProgress(taskId, overallProgress, {
                    status: t("fileBasket.task.downloading"),
                    currentFile: `${file.name} (${fileState.progress}%)`,
                    processed: completedFiles,
                    total: files.length,
                  });
                }
              },
            }
          );

          // 檔案完成
          fileState = fileStates.get(file.path);
          if (fileState) {
            fileState.status = "completed";
            fileState.progress = 100;
          }

          return { success: true, fileName: file.name };
        } catch (error) {
          log.error(`新增檔案 ${file.name} 失敗:`, error);
          failedFiles.push({ fileName: file.name, path: file.path, error: error.message });

          const failedFileState = fileStates.get(file.path);
          if (failedFileState) {
            failedFileState.status = "failed";
            failedFileState.progress = 0;
          }

          return { success: false, fileName: file.name, error: error.message };
        }
      };

      // 有限併發新增檔案到 ZIP（避免峰值過高）
      await runWithConcurrency(files, 4, processOneFile);

      // 新增錯誤報告
      if (failedFiles.length > 0) {
        const errorReport = [t("fileBasket.task.failedFilesHeader"), "", ...failedFiles.map(({ fileName, path, error }) => `${path} (${fileName}): ${error}`)].join("\n");

        await zipWriter.add("下載失敗檔案列表.txt", new BlobReader(new Blob([errorReport], { type: "text/plain" })));
      }

      // 生成ZIP
      taskManager.updateTaskProgress(taskId, 95, {
        status: t("fileBasket.task.generating"),
        currentFile: "",
        processed: files.length,
        total: files.length,
      });

      // 目錄結構顯式用 Zip64 寫入，避免超大包在 central directory 階段觸發邊界問題
      const zipResult = await zipWriter.close(undefined, { zip64: true });
      if (!isFsAccessMode) {
        saveAs(zipResult, zipFileName);
      }

      // 完成任務
      const successCount = files.length - failedFiles.length;
      taskManager.completeTask(taskId, {
        status: t("fileBasket.task.completed"),
        successCount,
        failedCount: failedFiles.length,
        zipFileName,
        endTime: new Date().toISOString(),
        summary:
          failedFiles.length > 0
            ? t("fileBasket.task.summaryWithFailures", { success: successCount, failed: failedFiles.length })
            : t("fileBasket.task.summarySuccess", { count: successCount }),
      });

      // 打包完成後自動清空檔案籃
      fileBasketStore.clearBasket();
    } catch (error) {
      log.error("打包任務失敗:", error);
      taskManager.failTask(
        taskId,
        error?.message || String(error),
        {
          status: t("fileBasket.task.failed"),
          error: error?.message || String(error),
          endTime: new Date().toISOString(),
        }
      );
    } finally {
      // File System Access 模式下，失敗時儘量中止寫入，避免留下不完整檔案
      if (isFsAccessMode && outputTarget?.writable) {
        try {
          const tasks = taskManager.getTasks();
          const task = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
          const shouldAbort = task?.status !== "completed";
          if (shouldAbort && typeof outputTarget.writable.abort === "function") {
            await outputTarget.writable.abort();
          }
        } catch (e) {
          log.warn("中止 ZIP 寫入失敗:", e?.message || e);
        }
      }

      if (isFsAccessMode && outputTarget?.writable) {
        globalActiveZipWritables.delete(outputTarget.writable);
      }

      cleanup();
    }
  };

  /**
   * 獲取檔案下載URL
   * @param {Object} file - 檔案物件
   * @returns {Promise<string>} 下載URL
   */
  const getFileDownloadUrl = async (file) => {
    try {
      // 優先使用控制面提供的 downloadUrl；缺失時按需簽發 file-link
      if (file?.downloadUrl) {
        return file.downloadUrl;
      }

      const getFileLinkApi = api.fs.getFileLink;
      const isAdmin = authStore.isAdmin;

      /** @type {{ headers?: Record<string,string> }} */
      const requestOptions = {};
      if (!isAdmin) {
        const token = pathPassword.getPathToken(file.path);
        if (token) {
          requestOptions.headers = {
            "X-FS-Path-Token": token,
          };
        }
      }

      const url = await getFileLinkApi(file.path, null, true, requestOptions);

      if (url) {
        return url;
      }

      throw new Error(t("fileBasket.errors.noDownloadUrl"));
    } catch (error) {
      log.error(`獲取檔案 ${file.name} 下載連結失敗:`, error);
      throw error;
    }
  };

  // ===== 工具方法 =====

  /**
   * 檢查檔案是否在籃子中
   * @param {string} filePath - 檔案路徑
   * @returns {boolean}
   */
  const isFileInBasket = (filePath) => {
    return fileBasketStore.isFileInBasket(filePath);
  };

  /**
   * 獲取籃子摘要資訊
   * @returns {Object}
   */
  const getBasketSummary = () => {
    return fileBasketStore.getCollectionSummary();
  };

  // ===== 元件解除安裝清理 =====

  onUnmounted(() => {
    globalCleanup();
  });

  return {
    // Store狀態
    collectedFiles,
    isBasketOpen,
    collectionCount,
    hasCollection,
    collectionTotalSize,
    collectionTotalSizeMB,
    filesByDirectory,
    directoryCount,
    isInitialized,

    // 計算屬性
    basketButtonText,
    basketSummary,

    // 檔案籃操作方法
    addToBasket,
    removeFromBasket,
    toggleFileInBasket,
    addSelectedToBasket,

    // 面板管理方法
    openBasket,
    closeBasket,
    toggleBasket,

    // 清理方法
    clearBasket,
    resetBasket,

    // 打包下載方法
    createPackTask,

    // 工具方法
    isFileInBasket,
    getBasketSummary,

    // 手動清理方法（用於緊急情況）
    globalCleanup,
  };
}
