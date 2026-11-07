/**
 * Postgres 方言實現（骨架）
 * - 僅定義能力面
 */

export const postgresDialect = {
  name: "postgres",
  placeholderStyle() {
    return "dollar";
  },
  buildInsertIgnoreSql({ table, columns, conflictTarget = null }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
    const colList = cols.join(", ");
    // 注意：conflictTarget 在 PG 中通常必需；此處先留空，讓未來 provider 做更精確的約束對映
    const conflict = conflictTarget ? `(${conflictTarget})` : "";
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT ${conflict} DO NOTHING`;
  },
  supportsPartialIndex() {
    return true;
  },
};
