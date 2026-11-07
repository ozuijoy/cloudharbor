/**
 * 前端許可權系統常量定義
 *
 * 與後端 Permission 常量保持位級對齊：
 * - *_SHARE：建立/發起分享
 * - *_MANAGE：管理既有分享（列表/修改/刪除）
 */

export const Permission = {
  // 基礎許可權 (0-7位)
  TEXT_SHARE: 1 << 0, // 0x0001 - 文字分享建立
  FILE_SHARE: 1 << 1, // 0x0002 - 檔案分享建立
  TEXT_MANAGE: 1 << 2, // 0x0004 - 文字分享管理
  FILE_MANAGE: 1 << 3, // 0x0008 - 檔案分享管理

  // 掛載頁許可權 (8-15位)
  MOUNT_VIEW: 1 << 8, // 0x0100 - 掛載頁檢視
  MOUNT_UPLOAD: 1 << 9, // 0x0200 - 上傳/建立目錄
  MOUNT_COPY: 1 << 10, // 0x0400 - 複製
  MOUNT_RENAME: 1 << 11, // 0x0800 - 重新命名
  MOUNT_DELETE: 1 << 12, // 0x1000 - 刪除

  // WebDAV許可權 (16-23位)
  WEBDAV_READ: 1 << 16, // 0x10000 - WebDAV讀取
  WEBDAV_MANAGE: 1 << 17, // 0x20000 - WebDAV管理
};

/**
 * 前端許可權檢查工具函式
 * 與後端PermissionChecker保持一致的API
 */
export class PermissionChecker {
  /**
   * 檢查使用者是否擁有指定許可權
   * @param {number} userPermissions - 使用者許可權位標誌
   * @param {number} requiredPermission - 需要的許可權位標誌
   * @returns {boolean} 是否擁有許可權
   */
  static hasPermission(userPermissions, requiredPermission) {
    return (userPermissions & requiredPermission) === requiredPermission;
  }

  /**
   * 檢查使用者是否擁有任一許可權
   * @param {number} userPermissions - 使用者許可權位標誌
   * @param {number[]} requiredPermissions - 需要的許可權位標誌陣列
   * @returns {boolean} 是否擁有任一許可權
   */
  static hasAnyPermission(userPermissions, requiredPermissions) {
    return requiredPermissions.some((permission) => this.hasPermission(userPermissions, permission));
  }

  /**
   * 檢查使用者是否擁有所有許可權
   * @param {number} userPermissions - 使用者許可權位標誌
   * @param {number[]} requiredPermissions - 需要的許可權位標誌陣列
   * @returns {boolean} 是否擁有所有許可權
   */
  static hasAllPermissions(userPermissions, requiredPermissions) {
    return requiredPermissions.every((permission) => this.hasPermission(userPermissions, permission));
  }

  /**
   * 新增許可權
   * @param {number} currentPermissions - 當前許可權位標誌
   * @param {number} newPermission - 要新增的許可權位標誌
   * @returns {number} 新的許可權位標誌
   */
  static addPermission(currentPermissions, newPermission) {
    return currentPermissions | newPermission;
  }

  /**
   * 移除許可權
   * @param {number} currentPermissions - 當前許可權位標誌
   * @param {number} permissionToRemove - 要移除的許可權位標誌
   * @returns {number} 新的許可權位標誌
   */
  static removePermission(currentPermissions, permissionToRemove) {
    return currentPermissions & ~permissionToRemove;
  }

  /**
   * 獲取許可權描述（支援國際化）
   * @param {number} permissions - 許可權位標誌
   * @param {Function} t - 國際化翻譯函式
   * @returns {string[]} 許可權描述陣列
   */
  static getPermissionDescriptions(permissions, t = null) {
    const descriptions = [];

    if (this.hasPermission(permissions, Permission.TEXT_SHARE)) {
      descriptions.push(t ? t("permissions.textShare") : "文字分享（建立）");
    }
    if (this.hasPermission(permissions, Permission.TEXT_MANAGE)) {
      descriptions.push(t ? t("permissions.textManage") : "文字分享管理");
    }
    if (this.hasPermission(permissions, Permission.FILE_SHARE)) {
      descriptions.push(t ? t("permissions.fileShare") : "檔案分享（建立）");
    }
    if (this.hasPermission(permissions, Permission.FILE_MANAGE)) {
      descriptions.push(t ? t("permissions.fileManage") : "檔案分享管理");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_VIEW)) {
      descriptions.push(t ? t("permissions.mountView") : "掛載頁檢視");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_UPLOAD)) {
      descriptions.push(t ? t("permissions.mountUpload") : "上傳/建立目錄");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_COPY)) {
      descriptions.push(t ? t("permissions.mountCopy") : "複製檔案");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_RENAME)) {
      descriptions.push(t ? t("permissions.mountRename") : "重新命名檔案");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_DELETE)) {
      descriptions.push(t ? t("permissions.mountDelete") : "刪除檔案");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_READ)) {
      descriptions.push(t ? t("permissions.webdavRead") : "WebDAV讀取");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_MANAGE)) {
      descriptions.push(t ? t("permissions.webdavManage") : "WebDAV管理");
    }

    return descriptions;
  }

  /**
   * 將位標誌許可權轉換為布林許可權物件（用於前端表單）
   * @param {number} bitFlag - 位標誌許可權
   * @returns {Object} 布林許可權物件
   */
  static convertFromBitFlag(bitFlag) {
    return {
      text: this.hasPermission(bitFlag, Permission.TEXT_SHARE),
      text_manage: this.hasPermission(bitFlag, Permission.TEXT_MANAGE),
      file_share: this.hasPermission(bitFlag, Permission.FILE_SHARE),
      file_manage: this.hasPermission(bitFlag, Permission.FILE_MANAGE),
      mount_view: this.hasPermission(bitFlag, Permission.MOUNT_VIEW),
      mount_upload: this.hasPermission(bitFlag, Permission.MOUNT_UPLOAD),
      mount_copy: this.hasPermission(bitFlag, Permission.MOUNT_COPY),
      mount_rename: this.hasPermission(bitFlag, Permission.MOUNT_RENAME),
      mount_delete: this.hasPermission(bitFlag, Permission.MOUNT_DELETE),
      webdav_read: this.hasPermission(bitFlag, Permission.WEBDAV_READ),
      webdav_manage: this.hasPermission(bitFlag, Permission.WEBDAV_MANAGE),
    };
  }

  /**
   * 將布林許可權物件轉換為位標誌許可權（用於前端表單）
   * @param {Object} permissions - 布林許可權物件
   * @returns {number} 位標誌許可權
   */
  static convertToBitFlag(permissions) {
    let bitFlag = 0;
    if (permissions.text) bitFlag |= Permission.TEXT_SHARE;
    if (permissions.text_manage) bitFlag |= Permission.TEXT_MANAGE;
    if (permissions.file_share) bitFlag |= Permission.FILE_SHARE;
    if (permissions.file_manage) bitFlag |= Permission.FILE_MANAGE;
    if (permissions.mount_view) bitFlag |= Permission.MOUNT_VIEW;
    if (permissions.mount_upload) bitFlag |= Permission.MOUNT_UPLOAD;
    if (permissions.mount_copy) bitFlag |= Permission.MOUNT_COPY;
    if (permissions.mount_rename) bitFlag |= Permission.MOUNT_RENAME;
    if (permissions.mount_delete) bitFlag |= Permission.MOUNT_DELETE;
    if (permissions.webdav_read) bitFlag |= Permission.WEBDAV_READ;
    if (permissions.webdav_manage) bitFlag |= Permission.WEBDAV_MANAGE;
    return bitFlag;
  }
}
