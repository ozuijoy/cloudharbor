import { api } from "@/api";

/**
 * Admin 賬戶相關 Service
 *
 * - 封裝賬號與密碼管理相關介面（當前僅包含修改密碼）
 *
 * 不負責：
 * - 表單校驗、倒計時、登出等 UI/流程控制
 */
export function useAdminAccountService() {
 /**
  * 修改當前登入管理員的密碼/使用者名稱
  *
  * @param {string} currentPassword 當前密碼
  * @param {string} newPassword 新密碼（可選）
  * @param {string} newUsername 新使用者名稱（可選）
  */
  const changePassword = async (currentPassword, newPassword, newUsername) => {
    const resp = await api.admin.changePassword(currentPassword, newPassword, newUsername);
    if (!resp) {
      throw new Error("修改密碼失敗");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "修改密碼失敗");
      }
      return true;
    }
    return true;
  };

  return {
    changePassword,
  };
}
