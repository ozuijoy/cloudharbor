/**
 * 位標誌許可權系統常量定義
 * 基於位運算的高效能許可權管理系統
 */

/**
 * 許可權位標誌常量
 * 使用位移操作定義許可權，支援高效的位運算檢查
 *
 * 約定（基礎區 0-7 位）：
 * - *_SHARE：建立/發起分享等“寫入新記錄”的能力
 * - *_MANAGE：對既有分享的列表/檢視/修改/刪除能力
 */
export const Permission = {
  // 基礎許可權 (0-7位)
  TEXT_SHARE: 1 << 0, // 0x0001 - 文字分享建立
  FILE_SHARE: 1 << 1, // 0x0002 - 檔案分享建立
  TEXT_MANAGE: 1 << 2, // 0x0004 - 文字分享管理（列表/修改/刪除）
  FILE_MANAGE: 1 << 3, // 0x0008 - 檔案分享管理（列表/修改/刪除）

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
 * 許可權組合常量
 * 預定義的許可權組合，便於快速分配
 */
export const PermissionGroup = {
  // 基礎許可權組合
  BASIC_TEXT: Permission.TEXT_SHARE | Permission.TEXT_MANAGE,
  BASIC_FILE: Permission.FILE_SHARE | Permission.FILE_MANAGE,

  // 掛載頁許可權組合
  MOUNT_READ_ONLY: Permission.MOUNT_VIEW,
  MOUNT_BASIC: Permission.MOUNT_VIEW | Permission.MOUNT_UPLOAD,
  MOUNT_FULL: Permission.MOUNT_VIEW | Permission.MOUNT_UPLOAD | Permission.MOUNT_COPY | Permission.MOUNT_RENAME | Permission.MOUNT_DELETE,

  // WebDAV許可權組合
  WEBDAV_READ_ONLY: Permission.WEBDAV_READ,
  WEBDAV_FULL: Permission.WEBDAV_READ | Permission.WEBDAV_MANAGE,

  // 完整許可權組合
  ALL_PERMISSIONS:
    Permission.TEXT_SHARE |
    Permission.FILE_SHARE |
    Permission.TEXT_MANAGE |
    Permission.FILE_MANAGE |
    Permission.MOUNT_VIEW |
    Permission.MOUNT_UPLOAD |
    Permission.MOUNT_COPY |
    Permission.MOUNT_RENAME |
    Permission.MOUNT_DELETE |
    Permission.WEBDAV_READ |
    Permission.WEBDAV_MANAGE,
};

/**
 * 角色預設和許可權模板
 * 用於使用者建立時的許可權模板選擇
 */
export const Role = {
  // 訪客角色 - 可以設定為免密訪問
  GUEST: {
    name: "GUEST",
    displayName: "訪客",
    permissions: Permission.MOUNT_VIEW,
    description: "訪客使用者，可以設定為免密訪問，許可權可自定義",
  },

  // 普通使用者角色 - 基礎功能許可權模板
  GENERAL: {
    name: "GENERAL",
    displayName: "普通使用者",
    // 預設同時具備建立和管理文字/檔案分享的能力
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_BASIC |
      Permission.WEBDAV_READ,
    description: "可以使用文字分享、檔案分享（含管理）、基礎掛載頁操作和WebDAV讀取功能",
  },

  // 管理員角色 - 所有許可權
  ADMIN: {
    name: "ADMIN",
    displayName: "管理員",
    permissions: PermissionGroup.ALL_PERMISSIONS,
    description: "擁有所有許可權，可以進行任何操作",
  },
};

/**
 * 許可權模板
 * 用於前端介面的快速許可權設定
 */
export const PermissionTemplate = {
  // 只讀模板 - 只能檢視
  READ_ONLY: {
    name: "READ_ONLY",
    displayName: "只讀許可權",
    permissions: Permission.MOUNT_VIEW,
    description: "只能檢視掛載頁內容，無法進行任何操作",
  },

  // 基礎模板 - 常用功能
  BASIC: {
    name: "BASIC",
    displayName: "基礎許可權",
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_BASIC,
    description: "可以使用文字分享、檔案分享（含管理）和基礎掛載頁操作",
  },

  // 完整模板 - 除管理外的所有功能
  FULL: {
    name: "FULL",
    displayName: "完整許可權",
    permissions:
      Permission.TEXT_SHARE |
      Permission.TEXT_MANAGE |
      Permission.FILE_SHARE |
      Permission.FILE_MANAGE |
      PermissionGroup.MOUNT_FULL |
      PermissionGroup.WEBDAV_FULL,
    description: "可以使用所有功能，包括文字/檔案管理、檔案系統管理和WebDAV訪問",
  },
};

/**
 * 許可權檢查工具函式
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
   * 獲取許可權描述
   * @param {number} permissions - 許可權位標誌
   * @returns {string[]} 許可權描述陣列
   */
  static getPermissionDescriptions(permissions) {
    const descriptions = [];

    if (this.hasPermission(permissions, Permission.TEXT_SHARE)) {
      descriptions.push("文字分享（建立）");
    }
    if (this.hasPermission(permissions, Permission.TEXT_MANAGE)) {
      descriptions.push("文字分享管理");
    }
    if (this.hasPermission(permissions, Permission.FILE_SHARE)) {
      descriptions.push("檔案分享（建立）");
    }
    if (this.hasPermission(permissions, Permission.FILE_MANAGE)) {
      descriptions.push("檔案分享管理");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_VIEW)) {
      descriptions.push("掛載頁檢視");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_UPLOAD)) {
      descriptions.push("上傳/建立目錄");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_COPY)) {
      descriptions.push("複製檔案");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_RENAME)) {
      descriptions.push("重新命名檔案");
    }
    if (this.hasPermission(permissions, Permission.MOUNT_DELETE)) {
      descriptions.push("刪除檔案");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_READ)) {
      descriptions.push("WebDAV讀取");
    }
    if (this.hasPermission(permissions, Permission.WEBDAV_MANAGE)) {
      descriptions.push("WebDAV管理");
    }

    return descriptions;
  }
}
