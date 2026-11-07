/**
 * FS模組檢視狀態列舉
 *
 * 狀態轉換圖:
 *
 *                    ┌──────────────┐
 *                    │   INITIAL    │
 *                    └──────┬───────┘
 *                           │
 *              ┌────────────┼────────────┐
 *              │                         │
 *              ▼                         ▼
 *    ┌──────────────────┐      ┌──────────────┐
 *    │ LOADING_DIRECTORY│      │ LOADING_FILE │
 *    └────────┬─────────┘      └──────┬───────┘
 *             │                       │
 *             ▼                       ▼
 *    ┌──────────────────┐      ┌──────────────┐
 *    │DIRECTORY_LOADED  │◄────►│ FILE_LOADED  │
 *    └──────────────────┘      └──────────────┘
 *             │                       │
 *             └───────────┬───────────┘
 *                         │
 *              ┌──────────┼──────────┐
 *              ▼          ▼          ▼
 *    ┌─────────────┐  ┌───────┐  ┌──────────────────┐
 *    │PASSWORD_REQ │  │ ERROR │  │ 可返回INITIAL    │
 *    └─────────────┘  └───────┘  └──────────────────┘
 *
 * @module fs/constants/ViewState
 */

/**
 * 檢視狀態列舉
 * @readonly
 * @enum {string}
 */
export const ViewState = Object.freeze({
  /** 初始狀態,還未載入任何內容 */
  INITIAL: 'INITIAL',

  /** 正在載入目錄列表 */
  LOADING_DIRECTORY: 'LOADING_DIRECTORY',

  /** 目錄列表已載入完成 */
  DIRECTORY_LOADED: 'DIRECTORY_LOADED',

  /** 正在載入檔案預覽 */
  LOADING_FILE: 'LOADING_FILE',

  /** 檔案預覽已載入完成 */
  FILE_LOADED: 'FILE_LOADED',

  /** 需要輸入密碼才能訪問 */
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',

  /** 發生錯誤 */
  ERROR: 'ERROR',
});

/**
 * 判斷當前狀態是否為載入中狀態
 * @param {string} state - 檢視狀態
 * @returns {boolean} 是否為載入狀態
 */
export function isLoadingState(state) {
  return state === ViewState.LOADING_DIRECTORY || state === ViewState.LOADING_FILE;
}

/**
 * 判斷是否應該顯示目錄列表
 * @param {string} state - 檢視狀態
 * @returns {boolean} 是否顯示目錄
 */
export function shouldShowDirectory(state) {
  return state === ViewState.DIRECTORY_LOADED ||
         state === ViewState.LOADING_DIRECTORY ||
         state === ViewState.LOADING_FILE ||
         state === ViewState.FILE_LOADED ||
         state === ViewState.INITIAL;
}

/**
 * 判斷是否應該顯示檔案預覽
 * @param {string} state - 檢視狀態
 * @returns {boolean} 是否顯示檔案預覽
 */
export function shouldShowFilePreview(state) {
  return state === ViewState.FILE_LOADED ||
         state === ViewState.LOADING_FILE;
}

/**
 * 判斷是否為錯誤狀態
 * @param {string} state - 檢視狀態
 * @returns {boolean} 是否為錯誤狀態
 */
export function isErrorState(state) {
  return state === ViewState.ERROR;
}

/**
 * 判斷是否需要密碼
 * @param {string} state - 檢視狀態
 * @returns {boolean} 是否需要密碼
 */
export function needsPassword(state) {
  return state === ViewState.PASSWORD_REQUIRED;
}

/**
 * 獲取狀態的可讀描述
 * @param {string} state - 檢視狀態
 * @returns {string} 狀態描述
 */
export function getStateDescription(state) {
  const descriptions = {
    [ViewState.INITIAL]: '初始狀態',
    [ViewState.LOADING_DIRECTORY]: '載入目錄中',
    [ViewState.DIRECTORY_LOADED]: '目錄已載入',
    [ViewState.LOADING_FILE]: '載入檔案中',
    [ViewState.FILE_LOADED]: '檔案已載入',
    [ViewState.PASSWORD_REQUIRED]: '需要密碼',
    [ViewState.ERROR]: '發生錯誤',
  };
  return descriptions[state] || '未知狀態';
}

/**
 * 驗證狀態值是否有效
 * @param {string} state - 要驗證的狀態
 * @returns {boolean} 狀態是否有效
 */
export function isValidState(state) {
  return Object.values(ViewState).includes(state);
}
