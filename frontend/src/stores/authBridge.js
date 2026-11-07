// 統一的認證狀態橋接器，允許跨模組安全訪問認證資訊而不引入迴圈依賴
let authStateAccessor = null;
let logoutHandler = null;

/**
 * 註冊認證狀態訪問器與登出處理
 * @param {{ getSnapshot: () => { authType: string, adminToken: string|null, apiKey: string|null, isAuthenticated: boolean }, logout: () => Promise<void> }} bridge
 */
export function registerAuthBridge({ getSnapshot, logout }) {
  authStateAccessor = getSnapshot;
  logoutHandler = logout;
}

/**
 * 獲取當前認證快照（無依賴）
 * @returns {{ authType: string, adminToken: string|null, apiKey: string|null, isAuthenticated: boolean }|null}
 */
export function getAuthSnapshot() {
  return typeof authStateAccessor === "function" ? authStateAccessor() : null;
}

/**
 * 透過橋接執行登出
 */
export async function logoutViaBridge() {
  if (typeof logoutHandler === "function") {
    await logoutHandler();
  }
}
