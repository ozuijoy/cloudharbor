/**
 * SQLite / D1 方言實現
 * - 面向“多 DB 外掛化”的最小方言面
 * - 當前專案的預設方言（D1 與 Node SQLiteAdapter 都屬於此類）
 */

export const sqliteDialect = {
  name: "sqlite",

  /**
   * SQLite/D1 使用 ? 佔位符
   * @returns {"question"}
   */
  placeholderStyle() {
    return "question";
  },

  /**
   * INSERT IGNORE 的統一語義：衝突時忽略
   * - SQLite: INSERT OR IGNORE
   */
  buildInsertIgnoreSql({ table, columns }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.join(", ");
    return `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
  },

  /**
   * 是否支援部分索引（WHERE 子句索引）
   */
  supportsPartialIndex() {
    return true;
  },
};

