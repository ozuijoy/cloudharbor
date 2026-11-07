/**
 * UI狀態管理 Composable
 * 統一管理元件的UI狀態，包括彈窗、檢視模式等
 */

import { ref, computed } from "vue";
import { useGlobalMessage } from "../core/useGlobalMessage.js";

export function useUIState() {
  // ===== 訊息管理 - 使用全域性訊息系統 =====
  const globalMessage = useGlobalMessage();

  // 相容性包裝器
  const message = globalMessage.message;
  const showMessage = globalMessage.showMessage;
  const showSuccess = globalMessage.showSuccess;
  const showError = globalMessage.showError;
  const showWarning = globalMessage.showWarning;
  const showInfo = globalMessage.showInfo;
  const clearMessage = globalMessage.clearMessage;
  const hasMessage = globalMessage.hasMessage;
  const messageType = globalMessage.messageType;
  const messageContent = globalMessage.messageContent;

  // ===== 檢視模式管理 =====
  const viewMode = ref("list"); // 'list' | 'grid' | 'gallery'

  /**
   * 是否為列表模式
   */
  const isListMode = computed(() => viewMode.value === "list");

  /**
   * 是否為網格模式
   */
  const isGridMode = computed(() => viewMode.value === "grid");

  /**
   * 是否為圖廊模式
   */
  const isGalleryMode = computed(() => viewMode.value === "gallery");

  /**
   * 設定檢視模式
   * @param {string} mode - 目標模式 ('list' | 'grid' | 'gallery')
   */
  const setViewMode = (mode) => {
    if (mode === "list" || mode === "grid" || mode === "gallery") {
      viewMode.value = mode;
    }
  };

  /**
   * 在列表和網格模式之間切換
   */
  const toggleViewMode = () => {
    viewMode.value = viewMode.value === "list" ? "grid" : "list";
  };

  /**
   * 切換到列表模式
   */
  const switchToListMode = () => {
    setViewMode("list");
  };

  /**
   * 切換到網格模式
   */
  const switchToGridMode = () => {
    setViewMode("grid");
  };

  /**
   * 切換到圖廊模式
   */
  const switchToGalleryMode = () => {
    setViewMode("gallery");
  };

  // ===== 彈窗狀態管理 =====
  const isUploadModalOpen = ref(false);
  const isCopyModalOpen = ref(false);
  const isTasksModalOpen = ref(false);
  const isSearchModalOpen = ref(false);
  const isDeleteConfirmModalOpen = ref(false);
  const isRenameModalOpen = ref(false);
  const isCreateFolderModalOpen = ref(false);

  /**
   * 開啟上傳彈窗
   */
  const openUploadModal = () => {
    isUploadModalOpen.value = true;
  };

  /**
   * 關閉上傳彈窗
   */
  const closeUploadModal = () => {
    isUploadModalOpen.value = false;
  };

  /**
   * 切換上傳彈窗狀態
   */
  const toggleUploadModal = () => {
    isUploadModalOpen.value = !isUploadModalOpen.value;
  };

  /**
   * 開啟復制彈窗
   */
  const openCopyModal = () => {
    isCopyModalOpen.value = true;
  };

  /**
   * 關閉複製彈窗
   */
  const closeCopyModal = () => {
    isCopyModalOpen.value = false;
  };

  /**
   * 切換複製彈窗狀態
   */
  const toggleCopyModal = () => {
    isCopyModalOpen.value = !isCopyModalOpen.value;
  };

  /**
   * 開啟任務彈窗
   */
  const openTasksModal = () => {
    isTasksModalOpen.value = true;
  };

  /**
   * 關閉任務彈窗
   */
  const closeTasksModal = () => {
    isTasksModalOpen.value = false;
  };

  /**
   * 切換任務彈窗狀態
   */
  const toggleTasksModal = () => {
    isTasksModalOpen.value = !isTasksModalOpen.value;
  };

  /**
   * 開啟搜尋彈窗
   */
  const openSearchModal = () => {
    isSearchModalOpen.value = true;
  };

  /**
   * 關閉搜尋彈窗
   */
  const closeSearchModal = () => {
    isSearchModalOpen.value = false;
  };

  /**
   * 切換搜尋彈窗狀態
   */
  const toggleSearchModal = () => {
    isSearchModalOpen.value = !isSearchModalOpen.value;
  };

  /**
   * 開啟刪除確認彈窗
   */
  const openDeleteConfirmModal = () => {
    isDeleteConfirmModalOpen.value = true;
  };

  /**
   * 關閉刪除確認彈窗
   */
  const closeDeleteConfirmModal = () => {
    isDeleteConfirmModalOpen.value = false;
  };

  /**
   * 切換刪除確認彈窗狀態
   */
  const toggleDeleteConfirmModal = () => {
    isDeleteConfirmModalOpen.value = !isDeleteConfirmModalOpen.value;
  };

  /**
   * 開啟重新命名彈窗
   */
  const openRenameModal = () => {
    isRenameModalOpen.value = true;
  };

  /**
   * 關閉重新命名彈窗
   */
  const closeRenameModal = () => {
    isRenameModalOpen.value = false;
  };

  /**
   * 切換重新命名彈窗狀態
   */
  const toggleRenameModal = () => {
    isRenameModalOpen.value = !isRenameModalOpen.value;
  };

  /**
   * 開啟建立資料夾彈窗
   */
  const openCreateFolderModal = () => {
    isCreateFolderModalOpen.value = true;
  };

  /**
   * 關閉建立資料夾彈窗
   */
  const closeCreateFolderModal = () => {
    isCreateFolderModalOpen.value = false;
  };

  /**
   * 切換建立資料夾彈窗狀態
   */
  const toggleCreateFolderModal = () => {
    isCreateFolderModalOpen.value = !isCreateFolderModalOpen.value;
  };

  /**
   * 關閉所有彈窗
   */
  const closeAllModals = () => {
    isUploadModalOpen.value = false;
    isCopyModalOpen.value = false;
    isTasksModalOpen.value = false;
    isSearchModalOpen.value = false;
    isDeleteConfirmModalOpen.value = false;
    isRenameModalOpen.value = false;
    isCreateFolderModalOpen.value = false;
  };

  /**
   * 檢查是否有彈窗開啟
   * @returns {boolean} 是否有彈窗開啟
   */
  const hasOpenModal = computed(() => {
    return (
      isUploadModalOpen.value ||
      isCopyModalOpen.value ||
      isTasksModalOpen.value ||
      isSearchModalOpen.value ||
      isDeleteConfirmModalOpen.value ||
      isRenameModalOpen.value ||
      isCreateFolderModalOpen.value
    );
  });

  /**
   * 獲取當前開啟的彈窗列表
   * @returns {Array} 開啟的彈窗名稱列表
   */
  const getOpenModals = () => {
    const openModals = [];
    if (isUploadModalOpen.value) openModals.push("upload");
    if (isCopyModalOpen.value) openModals.push("copy");
    if (isTasksModalOpen.value) openModals.push("tasks");
    if (isSearchModalOpen.value) openModals.push("search");
    if (isDeleteConfirmModalOpen.value) openModals.push("deleteConfirm");
    if (isRenameModalOpen.value) openModals.push("rename");
    if (isCreateFolderModalOpen.value) openModals.push("createFolder");
    return openModals;
  };

  // ===== 載入狀態管理 =====
  const isLoading = ref(false);
  const loadingMessage = ref("");

  /**
   * 設定載入狀態
   * @param {boolean} loading - 是否載入中
   * @param {string} message - 載入訊息
   */
  const setLoading = (loading, message = "") => {
    isLoading.value = loading;
    loadingMessage.value = message;
  };

  /**
   * 開始載入
   * @param {string} message - 載入訊息
   */
  const startLoading = (message = "載入中...") => {
    setLoading(true, message);
  };

  /**
   * 停止載入
   */
  const stopLoading = () => {
    setLoading(false, "");
  };

  // ===== 工具方法 =====

  /**
   * 重置所有UI狀態
   */
  const resetUIState = () => {
    globalMessage.clearMessage();
    closeAllModals();
    stopLoading();
    setViewMode("list");
  };

  /**
   * 獲取UI狀態摘要
   * @returns {Object} UI狀態摘要
   */
  const getUIStateSummary = () => {
    return {
      hasMessage: hasMessage.value,
      messageType: messageType.value,
      viewMode: viewMode.value,
      hasOpenModal: hasOpenModal.value,
      openModals: getOpenModals(),
      isLoading: isLoading.value,
      loadingMessage: loadingMessage.value,
    };
  };

  return {
    // 訊息管理
    message,
    showMessage,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    clearMessage,
    hasMessage,
    messageType,
    messageContent,

    // 檢視模式管理
    viewMode,
    isListMode,
    isGridMode,
    isGalleryMode,
    setViewMode,
    toggleViewMode,
    switchToListMode,
    switchToGridMode,
    switchToGalleryMode,

    // 彈窗狀態管理
    isUploadModalOpen,
    isCopyModalOpen,
    isTasksModalOpen,
    isSearchModalOpen,
    isDeleteConfirmModalOpen,
    isRenameModalOpen,
    isCreateFolderModalOpen,
    openUploadModal,
    closeUploadModal,
    toggleUploadModal,
    openCopyModal,
    closeCopyModal,
    toggleCopyModal,
    openTasksModal,
    closeTasksModal,
    toggleTasksModal,
    openSearchModal,
    closeSearchModal,
    toggleSearchModal,
    openDeleteConfirmModal,
    closeDeleteConfirmModal,
    toggleDeleteConfirmModal,
    openRenameModal,
    closeRenameModal,
    toggleRenameModal,
    openCreateFolderModal,
    closeCreateFolderModal,
    toggleCreateFolderModal,
    closeAllModals,
    hasOpenModal,
    getOpenModals,

    // 載入狀態管理
    isLoading,
    loadingMessage,
    setLoading,
    startLoading,
    stopLoading,

    // 工具方法
    resetUIState,
    getUIStateSummary,
  };
}
