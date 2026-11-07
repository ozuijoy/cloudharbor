/**
 * Postgres dialect（規劃佔位）
 * - 預期路線：
 *   - contains/模糊：pg_trgm（GIN/GiST + % / similarity）
 *   - 全文：tsvector + websearch_to_tsquery / plainto_tsquery
 *
 * 說明：
 * - 本專案當前執行時主線為 D1(SQLite) + SQLite（Docker）
 * - 該檔案僅作為“介面樁”，用於約束未來擴充套件的形態，避免業務層直接耦合某個資料庫語法
 */

export function createPostgresDialect() {
  return {
    id: "postgres",
    minQueryLength: 1,
    buildSearchSql() {
      throw new Error("Postgres dialect 未實現：請按 pg_trgm/tsvector 方案補齊");
    },
    buildCountSql() {
      throw new Error("Postgres dialect 未實現：請按 pg_trgm/tsvector 方案補齊");
    },
  };
}

