/**
 * 預覽設定快取工具
 * 檔案型別檢測快取機制
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";
import { SETTING_GROUPS } from "../constants/settings.js";

/**
 * 預覽設定快取類
 * 提供O(1)複雜度的檔案型別查詢效能
 */
export class PreviewSettingsCache {
  constructor() {
    this.cache = new Map();
    this.typeCache = new Map();
    this.providerTypeCache = new Map();
    this.previewProviderRuleCache = [];
    this.lastUpdate = null;
    this.ttl = Infinity;
    this._isLoaded = false;
  }

  /**
   * 獲取檔案型別（基於副檔名）
   * @param {string} extension - 副檔名（不含點）
   * @param {D1Database} db - 資料庫例項（可選）
   * @returns {Promise<string>} 檔案型別 (text|audio|video|image|office|document|unknown)
   */
  async getFileType(extension, db = null) {
    await this.ensureLoaded(db);
    const key = extension.toLowerCase();
    return this.typeCache.get(key) || this.providerTypeCache.get(key) || "unknown";
  }

  /**
   * 檢查快取是否已載入
   * @returns {boolean}
   */
  isLoaded() {
    return this._isLoaded && this.lastUpdate; // 永不過期，只檢查是否已載入
  }

  /**
   * 確保快取已載入
   * @param {D1Database} db - 資料庫例項（可選）
   */
  async ensureLoaded(db = null) {
    if (!this.isLoaded()) {
      await this.refresh(db);
    }
  }

  /**
   * 重新整理快取（從資料庫重新載入預覽設定）
   * @param {D1Database} db - 資料庫例項（可選，用於外部呼叫）
   */
  async refresh(db = null, repositoryFactory = null) {
    try {
      // 如果沒有傳入db，嘗試從全域性獲取（在實際使用中需要傳入）
      if (!db) {
        console.warn("PreviewSettingsCache.refresh: 沒有提供資料庫例項，跳過重新整理");
        return;
      }

      const factory = ensureRepositoryFactory(db, repositoryFactory);
      const systemRepository = factory.getSystemRepository();

      // 獲取預覽設定分組的所有設定
      const previewSettings = await systemRepository.getSettingsByGroup(SETTING_GROUPS.PREVIEW, false);

      // 清空現有快取
      this.cache.clear();
      this.typeCache.clear();
      this.providerTypeCache.clear();

      // 重建快取
      for (const setting of previewSettings) {
        this.cache.set(setting.key, setting.value);

        // 解析副檔名列表並建立對映
        if (setting.key.endsWith("_types")) {
          const typeCategory = this.extractTypeCategory(setting.key);
          this.parseAndCacheExtensions(typeCategory, setting.value);
        }
      }

      this.rebuildProviderTypeCache();
      this.rebuildPreviewProviderRuleCache();

      this.lastUpdate = Date.now();
      this._isLoaded = true;

      console.log(`預覽設定快取已重新整理，共快取 ${this.typeCache.size} 個副檔名對映`);
    } catch (error) {
      console.error("重新整理預覽設定快取失敗:", error);
      // 重新整理失敗時保持舊快取，避免服務中斷
    }
  }

  /**
   * 從設定鍵名提取型別分類
   * @param {string} settingKey - 設定鍵名 (如 preview_text_types)
   * @returns {string} 型別分類 (如 text)
   */
  extractTypeCategory(settingKey) {
    const match = settingKey.match(/^preview_(.+)_types$/);
    return match ? match[1] : "unknown";
  }

  /**
   * 解析副檔名字串並快取對映關係
   * @param {string} typeCategory - 型別分類 (text|audio|video|image|office|document)
   * @param {string} extensionString - 逗號分隔的副檔名字串
   */
  parseAndCacheExtensions(typeCategory, extensionString) {
    if (!extensionString || typeof extensionString !== "string") {
      return;
    }

    const extensions = extensionString
      .split(",")
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.length > 0 && /^[a-z0-9]+$/.test(ext));

    for (const extension of extensions) {
      this.typeCache.set(extension, typeCategory);
    }

    console.log(`快取 ${typeCategory} 型別副檔名: ${extensions.join(", ")} (共${extensions.length}個)`);
  }

  /**
   * 解析 preview_providers 規則並建立型別對映（用於 office/document 等分類）
   */
  rebuildProviderTypeCache() {
    const rules = this.getPreviewProvidersConfig();
    if (!Array.isArray(rules)) return;

    for (const rule of rules) {
      const category = this.resolveProviderCategory(rule);
      if (!category) continue;

      const match = rule?.match || {};
      const extList = this.normalizeExtensionList(match.ext || match.exts || match.extensions);
      if (!extList.length) continue;

      for (const ext of extList) {
        this.providerTypeCache.set(ext, category);
      }
    }
  }

  /**
   * 預編譯 preview_providers 規則（支援 ext + regex）
   * - 僅用於“型別歸類/圖示歸類”用途，不會生成 providers URL
   * - 排序規則與預覽選擇保持一致：priority 越大越優先；priority 相同按陣列順序
   */
  rebuildPreviewProviderRuleCache() {
    const rules = this.getPreviewProvidersConfig();
    if (!Array.isArray(rules)) {
      this.previewProviderRuleCache = [];
      return;
    }

    const compiled = rules
      .map((rule, index) => {
        const previewKey = (rule?.previewKey || rule?.key || "").toString().toLowerCase();
        // 對圖示/型別來說：iframe / download 不代表“檔案本身型別”，不參與歸類
        if (previewKey === "iframe" || previewKey === "download") {
          return null;
        }

        const category = this.resolveProviderCategory(rule);
        if (!category) return null;

        const match = rule?.match || {};
        const extList = this.normalizeExtensionList(match.ext || match.exts || match.extensions || rule.ext);
        const regexSource = (match.regex || match.pattern || "").toString().trim();
        const regex = regexSource ? this.toRegex(regexSource) : null;

        return {
          _index: index,
          priority: Number.isFinite(rule?.priority) ? Number(rule.priority) : 0,
          extSet: extList.length ? new Set(extList) : null,
          regex,
          category,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority || a._index - b._index);

    this.previewProviderRuleCache = compiled;
  }

  /**
   * 將 preview_providers 中的 regex 字串解析為 RegExp
   * - 支援 /pattern/flags（例如 /^(readme|license)$/i）
   * - 也支援直接寫 pattern（不帶斜槓/flags）
   * @param {string} value
   * @returns {RegExp|null}
   */
  toRegex(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    if (raw.startsWith("/")) {
      const lastSlash = raw.lastIndexOf("/");
      if (lastSlash > 0) {
        const pattern = raw.slice(1, lastSlash);
        const flags = raw.slice(lastSlash + 1);
        try {
          return new RegExp(pattern, flags);
        } catch (error) {
          console.warn("preview_providers 正則無效，已忽略:", raw, error);
          return null;
        }
      }
    }

    try {
      return new RegExp(raw);
    } catch (error) {
      console.warn("preview_providers 正則無效，已忽略:", raw, error);
      return null;
    }
  }

  /**
   * 根據 preview_providers（ext + regex）推斷“型別分類”
   * @param {{ filename: string, extension?: string }} input
   * @returns {string} text|audio|video|image|office|document|unknown
   */
  resolveTypeCategoryByProviders(input) {
    const filename = (input?.filename || "").toString();
    const extension = (input?.extension || "").toString().toLowerCase();

    for (const rule of this.previewProviderRuleCache || []) {
      if (rule.extSet && !rule.extSet.has(extension)) continue;
      if (rule.regex && !rule.regex.test(filename)) continue;
      return rule.category || "unknown";
    }

    return "unknown";
  }

  normalizeExtensionList(value) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : String(value).split(",");
    return list
      .map((ext) => String(ext).trim().toLowerCase())
      .filter((ext) => ext.length > 0 && /^[a-z0-9]+$/.test(ext));
  }


  resolveProviderCategory(rule) {
    const explicit = (rule?.category || rule?.fileType || "").toString().toLowerCase();
    if (explicit) return explicit;

    const previewKey = (rule?.previewKey || rule?.key || "").toString().toLowerCase();
    if (["text", "code", "markdown", "html"].includes(previewKey)) return "text";
    if (["image", "video", "audio"].includes(previewKey)) return previewKey;
    if (previewKey === "office") return "office";
    if (["pdf", "document", "epub"].includes(previewKey)) return "document";
    return "";
  }

  /**
   * 獲取原始設定值
   * @param {string} key - 設定鍵名
   * @returns {string|null} 設定值
   */
  getSetting(key) {
    return this.cache.get(key) || null;
  }

  /**
   * 獲取 Preview Providers 配置（JSON 陣列）
   * @returns {Array|null}
   */
  getPreviewProvidersConfig() {
    const raw = this.getSetting("preview_providers");
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error("解析 preview_providers 配置失敗，將視為未配置:", e);
      return [];
    }

    return [];
  }

  /**
   * 獲取所有支援的副檔名（按型別分組）
   * @returns {Object} 按型別分組的副檔名物件
   */
  getAllSupportedExtensions() {
    const result = {};
    for (const [extension, type] of this.typeCache.entries()) {
      if (!result[type]) {
        result[type] = [];
      }
      result[type].push(extension);
    }
    return result;
  }

  /**
   * 清除快取
   */
  clear() {
    this.cache.clear();
    this.typeCache.clear();
    this.lastUpdate = null;
    this._isLoaded = false;
  }

  /**
   * 獲取快取統計資訊
   * @returns {Object} 快取統計
   */
  getStats() {
    return {
      isLoaded: this._isLoaded,
      lastUpdate: this.lastUpdate,
      settingsCount: this.cache.size,
      extensionMappings: this.typeCache.size,
      ttl: "永不過期",
      age: this.lastUpdate ? Date.now() - this.lastUpdate : null,
      cacheStrategy: "永不過期 + 主動重新整理",
    };
  }
}

// 建立全域性單例例項
const previewSettingsCacheInstance = new PreviewSettingsCache();

// 預設匯出單例例項
export default previewSettingsCacheInstance;

// 命名匯出
export const previewSettingsCache = previewSettingsCacheInstance;
