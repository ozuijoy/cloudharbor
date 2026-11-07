/**
 * Live Photo 工具函式
 *
 * 用於檢測和配對 Live Photo 檔案（圖片 + 影片）
 *
 * Apple Live Photo 檔案結構：
 * - 圖片檔案：.heic, .heif, .jpg, .jpeg, .png
 * - 影片檔案：.mov, .mp4 (通常與圖片同名)
 *
 * @module livePhotoUtils
 */

/**
 * Live Photo 支援的圖片副檔名
 */
export const LIVE_PHOTO_IMAGE_EXTENSIONS = ["heic", "heif", "jpg", "jpeg", "png", "avif", "webp"];

/**
 * Live Photo 支援的影片副檔名
 */
export const LIVE_PHOTO_VIDEO_EXTENSIONS = ["mov", "mp4"];

/**
 * 獲取副檔名（小寫）
 * @param {string} filename - 檔名
 * @returns {string} 副檔名
 */
export function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * 獲取檔案基礎名（不含副檔名）
 * @param {string} filename - 檔名
 * @returns {string} 基礎名
 */
export function getBaseName(filename) {
  if (!filename) return "";
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

/**
 * 檢查檔案是否為 Live Photo 支援的圖片格式
 * @param {string} filename - 檔名
 * @returns {boolean}
 */
export function isLivePhotoImage(filename) {
  const ext = getExtension(filename);
  return LIVE_PHOTO_IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 在檔案列表中查詢 Live Photo 配對的影片檔案
 *
 * 匹配規則：
 * 1. 完全同名匹配：IMG_1234.heic -> IMG_1234.mov
 * 2. 帶字尾匹配：IMG_1234.heic -> IMG_1234_live.mov
 *
 * @param {string} imageFilename - 圖片檔名
 * @param {Array<Object>} fileList - 檔案列表，每個物件需要有 name 屬性
 * @returns {Object|null} 匹配的影片檔案物件，或 null
 */
export function findLivePhotoVideo(imageFilename, fileList) {
  if (!imageFilename || !fileList || !Array.isArray(fileList)) {
    return null;
  }

  const baseName = getBaseName(imageFilename);
  if (!baseName) return null;

  // 可能的影片檔名模式
  const possibleVideoNames = [];

  for (const ext of LIVE_PHOTO_VIDEO_EXTENSIONS) {
    // 完全同名
    possibleVideoNames.push(`${baseName}.${ext}`);
    // 帶 _live 字尾：部分匯出/轉存工具會將 Live Photo 的影片部分重新命名為 *_live.mov
    possibleVideoNames.push(`${baseName}_live.${ext}`);
    // 帶 _video 字尾：部分工具會將影片部分顯式標註為 *_video.mov
    possibleVideoNames.push(`${baseName}_video.${ext}`);
  }

  // 在檔案列表中查詢匹配的影片
  for (const file of fileList) {
    const fileName = file.name || file.filename || "";
    const lowerFileName = fileName.toLowerCase();

    for (const videoName of possibleVideoNames) {
      if (lowerFileName === videoName.toLowerCase()) {
        return file;
      }
    }
  }

  return null;
}

/**
 * 檢測檔案是否為 Live Photo（需要在檔案列表中有配對的影片）
 *
 * @param {Object} file - 檔案物件，需要有 name 屬性
 * @param {Array<Object>} fileList - 同目錄下的檔案列表
 * @returns {Object} { isLivePhoto: boolean, videoFile: Object|null }
 */
export function detectLivePhoto(file, fileList) {
  const filename = file?.name || file?.filename || "";

  // 檢查是否為支援的圖片格式
  if (!isLivePhotoImage(filename)) {
    return { isLivePhoto: false, videoFile: null };
  }

  // 查詢配對的影片檔案
  const videoFile = findLivePhotoVideo(filename, fileList);

  return {
    isLivePhoto: !!videoFile,
    videoFile,
  };
}
