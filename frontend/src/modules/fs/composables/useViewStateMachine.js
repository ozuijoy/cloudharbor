import { ref, computed } from 'vue';
import {
  ViewState,
  isLoadingState,
  shouldShowDirectory,
  shouldShowFilePreview,
  isErrorState,
  needsPassword as needsPasswordState,
} from '../constants/ViewState';

/**
 * FS模組檢視狀態機Hook
 *
 * 這個Hook管理整個FS模組的檢視狀態,包括:
 * - 狀態轉換邏輯
 * - 請求取消控制
 * - URL變化響應
 * - 資料儲存
 *
 * @returns {Object} 狀態機例項
 */
export function useViewStateMachine() {
  // ==================== 核心狀態 ====================
  /**
   * 當前檢視狀態
   * @type {import('vue').Ref<string>}
   */
  const viewState = ref(ViewState.INITIAL);

  /**
   * 目錄資料
   * @type {import('vue').Ref<Object|null>}
   */
  const directoryData = ref(null);

  /**
   * 檔案資料
   * @type {import('vue').Ref<Object|null>}
   */
  const fileData = ref(null);

  /**
   * 錯誤資訊
   * @type {import('vue').Ref<Object|null>}
   */
  const errorInfo = ref(null);

  // ==================== 計算屬性 ====================
  /**
   * 是否處於載入狀態
   */
  const isLoading = computed(() => isLoadingState(viewState.value));

  /**
   * 是否應該顯示目錄列表
   */
  const showDirectory = computed(() => shouldShowDirectory(viewState.value));

  /**
   * 是否應該顯示檔案預覽
   */
  const showFilePreview = computed(() => shouldShowFilePreview(viewState.value));

  /**
   * 是否有錯誤
   */
  const hasError = computed(() => isErrorState(viewState.value));

  /**
   * 是否需要密碼
   */
  const needsPassword = computed(() => needsPasswordState(viewState.value));

  /**
   * 當前預覽檔名（從已載入的 fileData 推導）
   * @type {import('vue').ComputedRef<string|null>}
   */
  const previewFileName = computed(() => fileData.value?.name || null);

  // ==================== 狀態轉換方法 ====================

  /**
   * 開始載入目錄
   * @param {string} path - 目錄路徑
   */
  function startLoadingDirectory(path) {
    // 更新狀態
    viewState.value = ViewState.LOADING_DIRECTORY;
    errorInfo.value = null;
  }

  /**
   * 目錄載入完成
   * @param {Object} data - 目錄資料
   */
  function onDirectoryLoaded(data) {
    directoryData.value = data;
    viewState.value = ViewState.DIRECTORY_LOADED;
  }

  /**
   * 開始載入檔案預覽
   * @param {string} filePath - 檔案路徑（不以 / 結尾）
   * @param {string} path - 檔案所在目錄路徑（以 / 結尾）
   */
  function startLoadingFile(filePath, path) {
    // 更新狀態
    viewState.value = ViewState.LOADING_FILE;
    errorInfo.value = null;
  }

  /**
   * 檔案預覽載入完成
   * @param {Object} data - 檔案資料
   */
  function onFileLoaded(data) {
    fileData.value = data;
    viewState.value = ViewState.FILE_LOADED;
  }

  /**
   * 關閉檔案預覽,返回目錄檢視
   */
  function closeFilePreview() {
    // 重置檔案資料
    fileData.value = null;

    // 如果有目錄資料,返回目錄狀態
    if (directoryData.value) {
      viewState.value = ViewState.DIRECTORY_LOADED;
    } else {
      viewState.value = ViewState.INITIAL;
    }
  }

  /**
   * 設定需要密碼狀態
   */
  function requirePassword() {
    viewState.value = ViewState.PASSWORD_REQUIRED;
    errorInfo.value = null;
  }

  /**
   * 設定錯誤狀態
   * @param {Error|string|Object} error - 錯誤資訊
   */
  function setError(error) {
    viewState.value = ViewState.ERROR;

    // 標準化錯誤資訊
    if (typeof error === 'string') {
      errorInfo.value = { message: error };
    } else if (error instanceof Error) {
      errorInfo.value = { message: error.message, stack: error.stack };
    } else {
      errorInfo.value = error;
    }
  }

  /**
   * 重置狀態機到初始狀態
   */
  function reset() {
    viewState.value = ViewState.INITIAL;
    directoryData.value = null;
    fileData.value = null;
    errorInfo.value = null;
  }

  /**
   * 清除錯誤狀態
   */
  function clearError() {
    errorInfo.value = null;
    if (viewState.value === ViewState.ERROR) {
      viewState.value = ViewState.INITIAL;
    }
  }

  // ==================== URL變化監聽 ====================
  // 注意：URL 的變化由 controller 統一驅動；狀態機本身不直接依賴路由。

  // ==================== 返回狀態機例項 ====================
  return {
    // 狀態
    viewState,
    directoryData,
    fileData,
    errorInfo,

    // 計算屬性
    isLoading,
    showDirectory,
    showFilePreview,
    hasError,
    needsPassword,
    previewFileName,

    // 狀態轉換方法
    startLoadingDirectory,
    onDirectoryLoaded,
    startLoadingFile,
    onFileLoaded,
    closeFilePreview,
    requirePassword,
    setError,
    clearError,
    reset,
  };
}
