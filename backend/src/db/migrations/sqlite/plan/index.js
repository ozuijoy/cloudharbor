import adoptSchemaMigrations from "./adoptSchemaMigrations.js";
import versionMigrations from "./versions.js";

// 說明：
// - 採用單表 schema_migrations：僅用 app-v01..app-vN 表達版本鏈
// - 新庫初始化與 squash 標記由 adopt 遷移負責
export const sqliteMigrations = [
  adoptSchemaMigrations,
  ...versionMigrations,
];

export default sqliteMigrations;
