/**
 * SQLite/D1 遷移集合（當前主線）
 *
 * 目標：
 * - 遷移編排透過 `plan/` 目錄維護：由 `plan/index.js` 彙總匯出
 * - 具體遷移實現透過 `engine/` 目錄維護（最終態 schema + v01..vN 的歷史遷移實現）
 */

import sqliteMigrations from "./plan/index.js";

export { sqliteMigrations };
export default sqliteMigrations;
