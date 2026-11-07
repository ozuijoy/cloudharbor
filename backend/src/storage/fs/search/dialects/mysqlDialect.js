/**
 * MySQL dialect（規劃佔位）
 * - 預期路線：
 *   - FULLTEXT（MATCH ... AGAINST）或退化 LIKE（需謹慎）
 *
 * 說明：
 * - 該檔案僅作為“介面樁”，用於約束未來擴充套件的形態
 */

export function createMysqlDialect() {
  return {
    id: "mysql",
    minQueryLength: 1,
    buildSearchSql() {
      throw new Error("MySQL dialect 未實現：請按 FULLTEXT 方案補齊");
    },
    buildCountSql() {
      throw new Error("MySQL dialect 未實現：請按 FULLTEXT 方案補齊");
    },
  };
}

