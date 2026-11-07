/**
 * 基礎儲存驅動介面
 * 所有儲存驅動必須實現的核心基礎介面
 * 提供最小化的必需介面
 */

export class BaseDriver {
  /**
   * 建構函式
   * @param {Object} config - 儲存配置物件
   */
  constructor(config) {
    this.config = config;
    this.type = "base"; // 子類應該重寫此屬性
    this.initialized = false;
    this.capabilities = []; // 子類需要宣告支援的能力
  }

  /**
   * 初始化儲存驅動
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error("initialize方法必須在子類中實現");
  }

  /**
   * 檢查儲存驅動是否已初始化
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * 獲取儲存型別
   * @returns {string}
   */
  getType() {
    return this.type;
  }

  /**
   * 獲取支援的能力列表
   * @returns {Array<string>} 能力名稱陣列
   */
  getCapabilities() {
    return [...this.capabilities];
  }

  /**
   * 檢查是否支援特定能力
   * @param {string} capability - 能力名稱
   * @returns {boolean}
   */
  hasCapability(capability) {
    return this.capabilities.includes(capability);
  }

  /**
   * 獲取檔案或目錄的狀態資訊
   * @param {string} path - 檔案或目錄路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<Object>} 狀態資訊物件
   */
  async stat(path, options = {}) {
    throw new Error("stat方法必須在子類中實現");
  }

  /**
   * 檢查檔案或目錄是否存在
   * @param {string} path - 檔案或目錄路徑
   * @param {Object} options - 選項引數
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(path, options = {}) {
    throw new Error("exists方法必須在子類中實現");
  }

  /**
   * 清理資源
   * @returns {Promise<void>}
   */
  async cleanup() {
    // 預設實現：什麼都不做
    // 子類可以重寫此方法來清理特定資源
  }

  /**
   * 獲取儲存統計資訊
   * @returns {Promise<Object>} 統計資訊物件
   */
  async getStats() {
    // 預設實現：返回基礎資訊
    return {
      type: this.type,
      initialized: this.initialized,
      capabilities: this.capabilities,
    };
  }

  /**
   * 確保驅動已初始化
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new DriverError(`儲存驅動未初始化: ${this.type}`);
    }
  }
}
import { DriverError } from "../../../http/errors.js";
