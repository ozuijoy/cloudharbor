/**
 * MySQL 方言實現（骨架）
 * - 僅定義能力面
 */

export const mysqlDialect = {
  name: "mysql",
  placeholderStyle() {
    return "question";
  },
  buildInsertIgnoreSql({ table, columns }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.join(", ");
    return `INSERT IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
  },
  supportsPartialIndex() {
    return false;
  },
};

