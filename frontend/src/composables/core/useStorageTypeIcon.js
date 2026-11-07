/**
 * 儲存型別圖示 Composable
 * 統一管理所有儲存型別的圖示、顏色和背景樣式
 */
import {
  IconStorageS3,
  IconStorageOneDrive,
  IconStorageGoogleDrive,
  IconStorageGitHub,
  IconStorageWebDAV,
  IconStorageLocal,
  IconStorageTelegram,
  IconStorageDiscord,
  IconStorageHuggingFace,
  IconStorageMirror,
} from "@/components/icons";

/**
 * 儲存型別配置對映
 * 集中定義每種儲存型別的圖示和樣式
 */
const STORAGE_TYPE_CONFIG = {
  S3: {
    icon: IconStorageS3,
    lightColor: "text-orange-600",
    darkColor: "text-orange-400",
    lightBg: "bg-orange-100",
    darkBg: "bg-orange-900/30",
  },
  ONEDRIVE: {
    icon: IconStorageOneDrive,
    lightColor: "text-sky-600",
    darkColor: "text-sky-400",
    lightBg: "bg-sky-100",
    darkBg: "bg-sky-900/30",
  },
  GOOGLE_DRIVE: {
    icon: IconStorageGoogleDrive,
    lightColor: "text-red-600",
    darkColor: "text-red-400",
    lightBg: "bg-red-100",
    darkBg: "bg-red-900/30",
  },
  GITHUB_RELEASES: {
    icon: IconStorageGitHub,
    lightColor: "text-gray-700",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  GITHUB_API: {
    icon: IconStorageGitHub,
    lightColor: "text-gray-700",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  WEBDAV: {
    icon: IconStorageWebDAV,
    lightColor: "text-blue-600",
    darkColor: "text-blue-400",
    lightBg: "bg-blue-100",
    darkBg: "bg-blue-900/30",
  },
  LOCAL: {
    icon: IconStorageLocal,
    lightColor: "text-gray-600",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  TELEGRAM: {
    icon: IconStorageTelegram,
    lightColor: "text-sky-500",
    darkColor: "text-sky-400",
    lightBg: "bg-sky-100",
    darkBg: "bg-sky-900/30",
  },
  DISCORD: {
    icon: IconStorageDiscord,
    lightColor: "text-indigo-600",
    darkColor: "text-indigo-400",
    lightBg: "bg-indigo-100",
    darkBg: "bg-indigo-900/30",
  },
  HUGGINGFACE_DATASETS: {
    icon: IconStorageHuggingFace,
    lightColor: "text-yellow-600",
    darkColor: "text-yellow-400",
    lightBg: "bg-yellow-100",
    darkBg: "bg-yellow-900/30",
  },
  MIRROR: {
    icon: IconStorageMirror,
    lightColor: "text-purple-600",
    darkColor: "text-purple-400",
    lightBg: "bg-purple-100",
    darkBg: "bg-purple-900/30",
  },
};

// 預設配置（未知型別）
const DEFAULT_CONFIG = {
  icon: IconStorageS3,
  lightColor: "text-gray-600",
  darkColor: "text-gray-400",
  lightBg: "bg-gray-100",
  darkBg: "bg-gray-700",
};

/**
 * 獲取儲存型別配置
 * @param {string} storageType - 儲存型別
 * @returns {Object} 配置物件
 */
function getConfig(storageType) {
  const type = storageType?.toUpperCase();
  return STORAGE_TYPE_CONFIG[type] || DEFAULT_CONFIG;
}

/**
 * 儲存型別圖示 Composable
 * @returns {Object} 包含圖示和樣式獲取函式的物件
 */
export function useStorageTypeIcon() {
  /**
   * 獲取儲存型別圖示元件
   * @param {string} storageType - 儲存型別
   * @returns {Component} Vue 圖示元件
   */
  function getStorageTypeIcon(storageType) {
    return getConfig(storageType).icon;
  }

  /**
   * 獲取儲存型別圖示顏色類
   * @param {string} storageType - 儲存型別
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {string} Tailwind CSS 顏色類
   */
  function getStorageTypeIconClass(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return isDarkMode ? config.darkColor : config.lightColor;
  }

  /**
   * 獲取儲存型別背景色類
   * @param {string} storageType - 儲存型別
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {string} Tailwind CSS 背景色類
   */
  function getStorageTypeBgClass(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return isDarkMode ? config.darkBg : config.lightBg;
  }

  /**
   * 獲取儲存型別完整樣式配置
   * @param {string} storageType - 儲存型別
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {Object} 包含 icon, colorClass, bgClass 的物件
   */
  function getStorageTypeStyle(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return {
      icon: config.icon,
      colorClass: isDarkMode ? config.darkColor : config.lightColor,
      bgClass: isDarkMode ? config.darkBg : config.lightBg,
    };
  }

  return {
    getStorageTypeIcon,
    getStorageTypeIconClass,
    getStorageTypeBgClass,
    getStorageTypeStyle,
  };
}

export default useStorageTypeIcon;
