/**
 * 統一的建立者徽章邏輯 composable
 *
 * 用於管理面板中顯示建立者資訊的統一處理，支援：
 * - 管理員 (admin / UUID 格式的使用者ID)
 * - API金鑰 (apikey: 字首 / 有 keyName 的記錄)
 * - 系統/未知來源
 *
 * @example
 * // 在元件中使用
 * import { useCreatorBadge } from '@/composables/admin-management/useCreatorBadge.js';
 * const { getCreatorType, getCreatorText, getCreatorBadgeClass } = useCreatorBadge();
 *
 * // 獲取建立者型別
 * const type = getCreatorType(userId, keyName);
 *
 * // 獲取顯示文字
 * const text = getCreatorText(userId, keyName);
 *
 * // 獲取徽章樣式類
 * const badgeClass = getCreatorBadgeClass(userId, keyName);
 */

/**
 * UUID 正規表示式
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 建立者型別列舉
 */
export const CreatorType = {
  ADMIN: 'admin',
  API_KEY: 'apikey',
  SYSTEM: 'system',
  OTHER: 'other',
};

/**
 * 徽章樣式對映 (Tailwind CSS 類)
 */
const BADGE_CLASSES = {
  [CreatorType.ADMIN]: 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100',
  [CreatorType.API_KEY]: 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100',
  [CreatorType.SYSTEM]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  [CreatorType.OTHER]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

/**
 * 建立者徽章 composable
 * @param {Object} options - 可選配置
 * @param {Object} options.apiKeyNames - API金鑰名稱對映表 (可選，用於查詢已知金鑰)
 * @returns {Object} 建立者徽章相關方法
 */
export function useCreatorBadge(options = {}) {
  const { apiKeyNames = null } = options;

  /**
   * 判斷建立者型別
   * @param {string|null} userId - 使用者ID或建立者標識
   * @param {string|null} keyName - API金鑰名稱 (可選，後端可能直接返回)
   * @returns {string} 建立者型別 (admin/apikey/system/other)
   */
  const getCreatorType = (userId, keyName = null) => {
    // 無建立者資訊
    if (!userId) {
      return CreatorType.SYSTEM;
    }

    // 優先使用後端返回的 keyName 判斷
    if (keyName) {
      return CreatorType.API_KEY;
    }

    // 明確的 admin 標識
    if (userId === 'admin') {
      return CreatorType.ADMIN;
    }

    // 處理帶 "apikey:" 字首的 API 金鑰 ID
    if (typeof userId === 'string' && userId.startsWith('apikey:')) {
      return CreatorType.API_KEY;
    }

    // UUID 格式檢查
    if (UUID_REGEX.test(userId)) {
      // 如果提供了 apiKeyNames 對映表，檢查是否為已知 API 金鑰
      if (apiKeyNames && apiKeyNames[userId]) {
        return CreatorType.API_KEY;
      }
      // UUID 格式但不在已知 API 金鑰列表中，視為管理員
      return CreatorType.ADMIN;
    }

    // 預設為其他型別
    return CreatorType.OTHER;
  };

  /**
   * 獲取建立者顯示文字
   * @param {string|null} userId - 使用者ID或建立者標識
   * @param {string|null} keyName - API金鑰名稱 (可選)
   * @returns {string} 用於顯示的文字
   */
  const getCreatorText = (userId, keyName = null) => {
    const creatorType = getCreatorType(userId, keyName);

    switch (creatorType) {
      case CreatorType.ADMIN:
        return '管理員';

      case CreatorType.API_KEY:
        // 優先顯示 keyName
        if (keyName) {
          return `金鑰：${keyName}`;
        }
        // 處理 apikey: 字首格式
        if (typeof userId === 'string' && userId.startsWith('apikey:')) {
          const keyPart = userId.substring(7);
          return `金鑰：${keyPart.substring(0, 5)}...`;
        }
        // UUID 格式的 API 金鑰
        if (apiKeyNames && apiKeyNames[userId]) {
          return `金鑰：${apiKeyNames[userId]}`;
        }
        return `金鑰：${userId.substring(0, 8)}...`;

      case CreatorType.SYSTEM:
        return '未知來源';

      default:
        return userId || '未知';
    }
  };

  /**
   * 獲取建立者徽章樣式類 (Tailwind CSS)
   * @param {string|null} userId - 使用者ID或建立者標識
   * @param {string|null} keyName - API金鑰名稱 (可選)
   * @returns {string} Tailwind CSS 類名
   */
  const getCreatorBadgeClass = (userId, keyName = null) => {
    const creatorType = getCreatorType(userId, keyName);
    return BADGE_CLASSES[creatorType] || BADGE_CLASSES[CreatorType.OTHER];
  };

  /**
   * 格式化建立者資訊 (相容舊版 formatCreator 函式)
   * @param {Object} item - 包含 created_by 和可選 key_name 的物件
   * @returns {string} 格式化後的建立者文字
   */
  const formatCreator = (item) => {
    if (!item) return '未知';
    return getCreatorText(item.created_by, item.key_name);
  };

  /**
   * 獲取建立者徽章完整資訊
   * @param {string|null} userId - 使用者ID或建立者標識
   * @param {string|null} keyName - API金鑰名稱 (可選)
   * @returns {Object} 包含 type, text, badgeClass 的物件
   */
  const getCreatorBadgeInfo = (userId, keyName = null) => {
    const type = getCreatorType(userId, keyName);
    return {
      type,
      text: getCreatorText(userId, keyName),
      badgeClass: BADGE_CLASSES[type] || BADGE_CLASSES[CreatorType.OTHER],
    };
  };

  return {
    // 型別列舉
    CreatorType,
    // 核心方法
    getCreatorType,
    getCreatorText,
    getCreatorBadgeClass,
    // 便捷方法
    formatCreator,
    getCreatorBadgeInfo,
  };
}

// 匯出靜態版本供非元件環境使用
export const creatorBadgeUtils = {
  CreatorType,
  UUID_REGEX,
  BADGE_CLASSES,

  /**
   * 靜態方法：判斷建立者型別
   */
  getCreatorType(userId, keyName = null) {
    if (!userId) return CreatorType.SYSTEM;
    if (keyName) return CreatorType.API_KEY;
    if (userId === 'admin') return CreatorType.ADMIN;
    if (typeof userId === 'string' && userId.startsWith('apikey:')) return CreatorType.API_KEY;
    if (UUID_REGEX.test(userId)) return CreatorType.ADMIN;
    return CreatorType.OTHER;
  },

  /**
   * 靜態方法：獲取徽章樣式類
   */
  getBadgeClass(userId, keyName = null) {
    const type = this.getCreatorType(userId, keyName);
    return BADGE_CLASSES[type] || BADGE_CLASSES[CreatorType.OTHER];
  },
};
