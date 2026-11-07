# SQLite/D1 資料庫遷移說明


## 1) 入口呼叫鏈

執行時會走這條鏈路：

1. `backend/unified-entry.js` 在 Workers/Node 啟動或首次請求時呼叫 `ensureDatabaseReady(...)`
2. `backend/src/db/ensureDatabaseReady.js` 構建 runtime（db + provider + dialect）
3. `backend/src/db/providers/sqliteProvider.js` 呼叫遷移 runner：`applyMigrations(runtime, sqliteMigrations)`
4. `backend/src/db/migrations/runner.js` 確儲存在 `schema_migrations`，然後按順序執行每個 migration，並寫入記錄
5. `backend/src/db/migrations/sqlite/index.js` 匯出 SQLite/D1 的遷移列表（實際列表在 `sqlite/plan/index.js`）

---

## 2) migrations 目錄職責劃分

### 2.1 `backend/src/db/migrations/runner.js`

- 遷移執行器（Node + Workers 通用）。
- 職責：按順序執行 migration，並寫入 `schema_migrations`（遷移執行日誌表）。
- 約定：migration 的 `up()` 返回 `false` 表示“無需執行/跳過”，runner 會記錄為 `skipped`，但仍會寫入 `schema_migrations`，避免重複評估。

### 2.2 `backend/src/db/migrations/sqlite/index.js`

- SQLite/D1 遷移集合入口。

### 2.3 `backend/src/db/migrations/sqlite/plan/*`

- `plan/index.js`
  - 遷移列表彙總匯出：`[adopt, ...app-v01..app-vNN]`

- `plan/adoptSchemaMigrations.js`
  - “接管遷移狀態”的一次性遷移：
    - 新庫/缺表庫：執行 `engine/initDatabase.js` 直接把庫建到最終態，然後把 `app-v01..app-vNN` 批次寫入 `schema_migrations`（squash），避免新庫誤跑歷史遷移。
    - 舊庫：如果存在 `system_settings.schema_version`，按其版本上限把 `app-v01..app-vNN` 寫入 `schema_migrations`（squash），隨後刪除 `system_settings` 裡的 legacy key（`schema_version/db_initialized`）。

- `plan/versions.js`
  - 自動生成 `app-v01..app-vNN` 的遷移陣列（每個 `app-vXX` 內部會呼叫 `legacy/migrations.js` 的對應版本邏輯）。

- `plan/adoptUtils.js`
  - adopt 專用工具：表探測、舊 schema_version 讀取、批次寫入 `schema_migrations`、清理 legacy key 等。

### 2.4 `backend/src/db/migrations/sqlite/engine/*`

這部分是“SQLite/D1 最終態 schema + 歷史遷移實現”，供上層複用：

- `engine/version.js`：`APP_SCHEMA_VERSION/DB_SCHEMA_VERSION`（當前應用 schema 版本號）
- `engine/legacyKeys.js`：舊庫 system_settings legacy key + legacy 表名（僅用於接管/歷史遷移降級）
- `engine/schema.js`：最終態建表/建索引（新庫直接用它建到最新）
- `engine/seed.js`：預設配置 + 預設資料（預設管理員、預設 guest key 等）
- `engine/initDatabase.js`：新庫初始化入口（schema + seed）
- `engine/migrations.js`：歷史版本遷移實現（switch-case），供 `app-vXX` 呼叫

---

## 4) 新增遷移怎麼加？

本專案的約定是：**版本號就是 migration 的語義邊界**，不需要為每個版本新增一個檔案（避免碎片化）。

當你要新增 vXX 時，按順序做這幾步：

1) 增大版本號
- 修改：`backend/src/db/migrations/sqlite/engine/version.js`
- 把 `APP_SCHEMA_VERSION`（同時也是 `DB_SCHEMA_VERSION`）從 `27` 改為 `28`

2) 增加遷移實現（只寫差異）
- 修改：`backend/src/db/migrations/sqlite/engine/migrations.js`
- 新增 `case 28:`，只做“從 v27 升級到 v28”的差異變更（冪等/可重入優先）

3) 同步更新新庫最終態（讓新使用者直接就是 v28）
- 修改：`backend/src/db/migrations/sqlite/engine/schema.js`（新增表/欄位/索引）
- 修改：`backend/src/db/migrations/sqlite/engine/seed.js`（新增預設配置/預設資料）

4) 注意 `backend/schema.sql`
- 該檔案應保持“schema 快照”為主，不要手工預填充 `schema_migrations`，避免與執行時的 adopt/init 邏輯產生理解偏差。
