/**
 * WebDAV鎖管理器 
 */

import { AppError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { generateLockToken } from "./lockUtils.js";

export class LockManager {
  constructor() {
    // 鎖儲存 - 保持雙索引以支援按路徑和令牌查詢
    this.locksByPath = new Map(); // path -> lockInfo
    this.locksByToken = new Map(); // token -> lockInfo
    this.nextTokenId = 1;
  }

  /**
   * 建立鎖定
   * @param {string} path - 資源路徑
   * @param {string} owner - 鎖定所有者
   * @param {number} timeoutSeconds - 超時時間（秒）
   * @param {string} depth - 鎖定深度
   * @param {string} scope - 鎖定範圍
   * @param {string} type - 鎖定型別
   * @returns {Object} 鎖定資訊
   */
  createLock(path, owner, timeoutSeconds = 600, depth = "0", scope = "exclusive", type = "write") {
    // 檢查是否已鎖定
    const existingLock = this.locksByPath.get(path);
    if (existingLock && !this.isExpired(existingLock)) {
      throw new AppError(`資源已被鎖定: ${path}`, { status: ApiStatus.LOCKED, code: "LOCKED", expose: true, details: { lockToken: existingLock.token } });
    }

    // 建立鎖資訊
    const token = generateLockToken(this.nextTokenId++);
    const now = Date.now();
    const lockInfo = {
      token,
      path,
      owner,
      depth,
      scope,
      type,
      createdAt: now,
      expiresAt: now + timeoutSeconds * 1000,
      timeoutSeconds,
    };

    // 儲存鎖資訊
    this.locksByPath.set(path, lockInfo);
    this.locksByToken.set(token, lockInfo);

    console.log(`WebDAV鎖定建立: ${path} -> ${token}`);
    return lockInfo;
  }

  /**
   * 檢查鎖定狀態
   * @param {string} path - 資源路徑
   * @param {string} ifHeader - If頭部
   * @returns {Object|null} 鎖定資訊或null
   */
  checkLock(path, ifHeader = null) {
    // 清理過期鎖
    this.cleanupExpired();

    // 檢查直接鎖定
    const lock = this.locksByPath.get(path);
    if (lock && !this.isExpired(lock)) {
      // 如果有If頭，驗證條件
      if (ifHeader && this.checkIfCondition(ifHeader, lock.token)) {
        return null; // 條件滿足，允許操作
      }
      return lock;
    }

    return null;
  }

  /**
   * 刪除鎖定
   * @param {string} token - 鎖令牌
   * @returns {boolean} 是否成功刪除
   */
  unlock(token) {
    const lockInfo = this.locksByToken.get(token);
    if (!lockInfo) {
      return false;
    }

    this.locksByPath.delete(lockInfo.path);
    this.locksByToken.delete(token);

    console.log(`WebDAV鎖定刪除: ${lockInfo.path} -> ${token}`);
    return true;
  }

  /**
   * 重新整理鎖定
   * @param {string} token - 鎖令牌
   * @param {number} timeoutSeconds - 新的超時時間
   * @returns {Object|null} 更新後的鎖資訊
   */
  refreshLock(token, timeoutSeconds = 600) {
    const lockInfo = this.locksByToken.get(token);
    if (!lockInfo || this.isExpired(lockInfo)) {
      return null;
    }

    // 更新過期時間
    lockInfo.expiresAt = Date.now() + timeoutSeconds * 1000;
    lockInfo.timeoutSeconds = timeoutSeconds;

    console.log(`WebDAV鎖定重新整理: ${lockInfo.path} -> ${token}`);
    return lockInfo;
  }

  /**
   * 檢查鎖是否過期
   * @param {Object} lockInfo - 鎖資訊
   * @returns {boolean} 是否過期
   */
  isExpired(lockInfo) {
    return Date.now() > lockInfo.expiresAt;
  }

  /**
   * 簡化的If條件檢查
   * @param {string} ifHeader - If頭部
   * @param {string} token - 鎖令牌
   * @returns {boolean} 條件是否滿足
   */
  checkIfCondition(ifHeader, token) {
    // 令牌匹配檢查
    return ifHeader.includes(token);
  }

  /**
   * 清理過期鎖定
   */
  cleanupExpired() {
    const now = Date.now();
    const expiredPaths = [];
    const expiredTokens = [];

    // 查詢過期鎖
    for (const [path, lockInfo] of this.locksByPath) {
      if (now > lockInfo.expiresAt) {
        expiredPaths.push(path);
        expiredTokens.push(lockInfo.token);
      }
    }

    // 刪除過期鎖
    for (const path of expiredPaths) {
      this.locksByPath.delete(path);
    }
    for (const token of expiredTokens) {
      this.locksByToken.delete(token);
    }

    if (expiredPaths.length > 0) {
      console.log(`WebDAV清理過期鎖: ${expiredPaths.length}個`);
    }
  }

  /**
   * 獲取鎖資訊
   * @param {string} token - 鎖令牌
   * @returns {Object|null} 鎖資訊
   */
  getLockByToken(token) {
    const lockInfo = this.locksByToken.get(token);
    return lockInfo && !this.isExpired(lockInfo) ? lockInfo : null;
  }

  /**
   * 獲取路徑的鎖資訊
   * @param {string} path - 資源路徑
   * @returns {Object|null} 鎖資訊
   */
  getLockByPath(path) {
    const lockInfo = this.locksByPath.get(path);
    return lockInfo && !this.isExpired(lockInfo) ? lockInfo : null;
  }

  /**
   * 獲取統計資訊
   * @returns {Object} 統計資訊
   */
  getStats() {
    return {
      totalLocks: this.locksByPath.size,
      activeLocks: Array.from(this.locksByPath.values()).filter(lock => !this.isExpired(lock)).length,
    };
  }
}

// 建立全域性例項
export const lockManager = new LockManager();
