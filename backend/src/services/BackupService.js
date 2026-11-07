import crypto from "crypto";
import { DbTables } from "../constants/index.js";
import { ValidationError, RepositoryError } from "../http/errors.js";
import { StorageConfigUtils } from "../storage/utils/StorageConfigUtils.js";
import { createDbRuntime } from "../db/runtime.js";

/**
 * 資料備份與還原服務
 * 提供資料庫的備份和還原功能
 */
export class BackupService {
  constructor(db, env = {}) {
    this.db = db;
    this.dialect = createDbRuntime({ db, env }).dialect;

    // 模組與資料表的對映關係
    this.moduleTableMapping = {
      text_management: ["pastes", "paste_passwords"],
      file_management: ["files", "file_passwords"],
      vfs_management: ["vfs_nodes"],
      mount_management: ["storage_mounts"],
      storage_config: ["storage_configs", "principal_storage_acl"],
      key_management: ["api_keys"],
      account_management: ["admins", "admin_tokens"],
      system_settings: ["system_settings"],
      fs_meta_management: ["fs_meta"],
      task_management: ["tasks", "scheduled_jobs", "scheduled_job_runs"],
      upload_sessions: ["upload_sessions"],
    };

    // 表的依賴關係（用於確定匯入順序）
    // 基於實際的外來鍵約束關係和應用層依賴關係
    this.tableDependencies = {
      paste_passwords: ["pastes"],
      file_passwords: ["files"],
      admin_tokens: ["admins"],
      storage_configs: ["admins"], // storage_configs.admin_id -> admins.id
      storage_mounts: ["storage_configs"], // storage_mounts.storage_config_id -> storage_configs.id
      vfs_nodes: ["storage_configs"],
      tasks: ["api_keys"], // tasks.user_id -> api_keys.id (當 user_type='apikey' 時)
      principal_storage_acl: ["api_keys", "storage_configs"],
      scheduled_job_runs: ["scheduled_jobs"],
      upload_sessions: ["storage_configs", "storage_mounts"],
    };
  }

  async getExistingTableSet() {
    try {
      const existingTables = await this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
      const rows = existingTables?.results || [];
      return new Set(rows.map((t) => t?.name).filter(Boolean));
    } catch (error) {
      console.warn(`[BackupService] 讀取 sqlite_master 失敗，將跳過“表存在性”檢查: ${error.message}`);
      return null;
    }
  }

  async getTableColumnSet(tableName) {
    try {
      const info = await this.db.prepare(`PRAGMA table_info(${tableName})`).all();
      const rows = info?.results || [];
      return new Set(rows.map((r) => r?.name).filter(Boolean));
    } catch (error) {
      console.warn(`[BackupService] 讀取表欄位失敗（可忽略）: table=${tableName}, error=${error.message}`);
      return null;
    }
  }

  collectBackupColumnsSample(records, sampleLimit = 50) {
    const list = Array.isArray(records) ? records : [];
    const cols = new Set();
    const n = Math.min(sampleLimit, list.length);
    for (let i = 0; i < n; i++) {
      const row = list[i];
      if (!row || typeof row !== "object") continue;
      for (const k of Object.keys(row)) {
        cols.add(k);
      }
    }
    return cols;
  }

  estimateInsertStatementCount(tableName, records, options = {}) {
    const { mode = "overwrite" } = options;
    const list = Array.isArray(records) ? records : [];
    if (list.length === 0) return 0;

    const dialectName = this.dialect?.name || "unknown";
    const canBulkInsert = dialectName === "sqlite";

    // 估算列數：用前 N 條記錄做取樣（預檢查只需要估算，不需要精確到每一條）
    const sampleCols = this.collectBackupColumnsSample(list, 50);
    const columnsCount = Math.max(1, sampleCols.size);

    if (!canBulkInsert) {
      // 非 sqlite：按“每行一條語句”保守估算
      return list.length;
    }

    // D1/SQLite 的變數上限在不同環境裡可能不同（D1 報錯：too many SQL variables）
    // 為了穩：統一用一個更保守的上限，寧可多跑幾條語句，也不要匯入時直接 500。
    const MAX_BIND_VARS = 80;
    const maxRowsPerStatement = Math.max(1, Math.floor(MAX_BIND_VARS / columnsCount));

    // merge/overwrite 都可以走多行插入（merge 用 INSERT OR IGNORE）
    // 這裡僅估算語句數量
    const statements = Math.ceil(list.length / maxRowsPerStatement);
    return Math.max(1, statements);
  }

  /**
   * FS 搜尋索引表屬於派生資料：不參與備份/恢復事實來源，預設透過重建恢復
   * @returns {Set<string>}
   */
  getDerivedIndexTables() {
    return new Set([
      DbTables.FS_SEARCH_INDEX_ENTRIES,
      DbTables.FS_SEARCH_INDEX_STATE,
      DbTables.FS_SEARCH_INDEX_DIRTY,
      DbTables.FS_SEARCH_INDEX_FTS,
      DbTables.UPLOAD_PARTS,
    ].filter(Boolean));
  }

  /**
   * 還原後強制將 FS 搜尋索引標記為“需重建”
   * - D1 的 FTS5 虛表不適合 export/import；索引屬於派生資料，必須可重建
   */
  async markFsSearchIndexNotReadyAfterRestore() {
    const derived = this.getDerivedIndexTables();
    if (!derived.size) return;

    try {
      const statements = [];
      for (const tableName of derived) {
        try {
          statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
        } catch (error) {
          // 舊 schema 或未建立索引表時：prepare 階段就可能失敗
          console.warn(`[BackupService] 清理 FS 搜尋索引表失敗（可忽略）: ${error.message}`);
        }
      }

      if (statements.length === 0) return;
      await this.db.batch(statements);
    } catch (error) {
      // 舊 schema 或未建立索引表時可能失敗；保持“盡力而為”
      console.warn(`[BackupService] 清理 FS 搜尋索引表失敗（可忽略）: ${error.message}`);
    }
  }

  async getSchemaVersionForBackup() {
    try {
      const resp = await this.db.prepare(`SELECT id FROM schema_migrations`).all();
      const rows = resp?.results || [];
      const ids = rows.map((r) => r?.id).filter(Boolean);

      let maxVersion = null;
      for (const id of ids) {
        const match = String(id).match(/^app-v(\d{2})$/);
        if (!match) continue;
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isFinite(parsed)) continue;
        maxVersion = maxVersion === null ? parsed : Math.max(maxVersion, parsed);
      }

      return maxVersion === null ? null : String(maxVersion);
    } catch (error) {
      console.warn(`[BackupService] 讀取 schema_migrations 失敗: ${error.message}`);
      return null;
    }
  }

  /**
   * 建立備份
   * @param {Object} options - 備份選項
   * @returns {Object} 備份資料
   */
  async createBackup(options = {}) {
    const { backup_type = "full", selected_modules = [] } = options;

    let tables;
    let finalModules = selected_modules;
    let dependencies = []; // 在函式作用域定義（包含靜態依賴 + 動態依賴）

    if (backup_type === "full") {
      // 完整備份 - 所有表
      const derived = this.getDerivedIndexTables();
      tables = Object.values(DbTables).filter((t) => !derived.has(t));
    } else if (backup_type === "modules") {
      // 檢查並自動包含依賴模組
      dependencies = this.getModuleDependencies(selected_modules);
      const dynamicDependencies = [];

      // 如果只備份 vfs_nodes 不備份 storage_mounts，恢復後 scope_id 會“對不上”，目錄樹會變成孤兒資料
      // 當選擇了 vfs_management 且資料庫裡存在 scope_type=mount 的 vfs_nodes 時，自動包含 mount_management
      if (selected_modules.includes("vfs_management") && !selected_modules.includes("mount_management")) {
        try {
          const result = await this.db.prepare(`SELECT COUNT(*) as count FROM vfs_nodes WHERE scope_type = 'mount'`).first();
          const count = Number(result?.count || 0);
          if (count > 0) {
            dynamicDependencies.push("mount_management");
            console.log(`[BackupService] 檢測到 vfs_nodes.scope_type=mount 的歷史資料（${count} 條），自動包含模組: mount_management`);
          }
        } catch (error) {
          // 舊 schema 或表不存在時：忽略即可
          console.warn(`[BackupService] 檢測 vfs_nodes.scope_type=mount 失敗（可忽略）: ${error.message}`);
        }
      }

      dependencies = [...new Set([...dependencies, ...dynamicDependencies])];
      if (dependencies.length > 0) {
        finalModules = [...new Set([...selected_modules, ...dependencies])];
        console.log(`[BackupService] 檢測到跨模組依賴，自動包含模組: ${dependencies.join(", ")}`);
      }

      // 模組備份 - 根據選中的模組確定表
      tables = this.getTablesFromModules(finalModules);
    } else {
      throw new ValidationError("不支援的備份型別");
    }

    // 匯出資料
    const data = await this.exportTables(tables);

    const schemaVersion = await this.getSchemaVersionForBackup();

    // 生成後設資料
    const metadata = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      backup_type,
      schema_version: schemaVersion,
      selected_modules: backup_type === "modules" ? selected_modules : null,
      included_modules: backup_type === "modules" ? finalModules : null, // 記錄實際包含的模組
      auto_included_dependencies: backup_type === "modules" ? dependencies : null, // 記錄自動包含的依賴
      tables: Object.keys(data).reduce((acc, table) => {
        acc[table] = data[table].length;
        return acc;
      }, {}),
      total_records: Object.values(data).reduce((sum, arr) => sum + arr.length, 0),
      checksum: this.generateChecksum(data),
    };

    return {
      metadata,
      data,
    };
  }

  /**
   * 獲取模組的依賴模組
   * @param {Array} selectedModules - 選中的模組列表
   * @returns {Array} 依賴的模組列表
   */
  getModuleDependencies(selectedModules) {
    const dependencies = new Set();

      // 定義模組間的依賴關係
      const moduleDependencies = {
        mount_management: ["storage_config"], // 掛載管理依賴S3配置管理
        file_management: ["storage_config"], // 檔案管理可能依賴儲存配置（透過storage_config_id）
        vfs_management: ["storage_config"], // 目錄樹索引依賴儲存配置（scope_type=storage_config 時）
      };

    for (const module of selectedModules) {
      if (moduleDependencies[module]) {
        moduleDependencies[module].forEach((dep) => {
          // 只有當依賴模組未被選中時才新增
          if (!selectedModules.includes(dep)) {
            dependencies.add(dep);
          }
        });
      }
    }

    return Array.from(dependencies);
  }

  /**
   * 還原備份
   * @param {Object} backupData - 備份資料
   * @param {Object} options - 還原選項
   * @param {string} options.mode - 還原模式 ('overwrite' | 'merge')
   * @param {string} options.currentAdminId - 當前管理員ID（合併模式下用於對映admin_id）
   * @param {boolean} options.skipIntegrityCheck - 是否跳過資料完整性檢查
   * @param {boolean} options.preserveTimestamps - 是否保留原始時間戳
   * @returns {Object} 還原結果
   */
  async restoreBackup(backupData, options = {}) {
    const { mode = "overwrite", currentAdminId, skipIntegrityCheck = false, preserveTimestamps = false } = options;

    if (mode !== "overwrite" && mode !== "merge") {
      throw new ValidationError(`不支援的還原模式: ${mode}`);
    }

    // 驗證備份資料
    this.validateBackupData(backupData);

    let { data } = backupData;

    // 進行 admin_id 對映（僅合併模式需要掛接到現有管理員）
    if (currentAdminId && mode === "merge") {
      data = this.mapAdminIds(data, currentAdminId);
    }

    const tables = Object.keys(data);

    // 驗證表是否存在
    await this.validateTablesExist(tables);

    // 關鍵前置校驗：確保目標庫“真的有這些表/欄位”
    // - 目的：避免 overwrite 先清表，後續才發現缺表/缺欄位導致半成品
    const preview = await this.previewRestoreBackup(backupData, {
      mode,
      currentAdminId,
      // 這裡僅做 schema 級別檢查，不做跨表依賴完整性檢查（由下方的 validateDataIntegrity 負責）
      skipIntegrityCheck: true,
      preserveTimestamps,
    });
    const hardErrors = Array.isArray(preview?.issues) ? preview.issues.filter((i) => i?.level === "error") : [];
    if (hardErrors.length > 0) {
      const first = hardErrors[0];
      throw new ValidationError(`還原前置檢查失敗：${first?.message || "目標庫結構不匹配"}`);
    }

    // 資料完整性檢查
    // - 注意：這是“提醒級別”的檢查（預設不會阻斷 restore），但會把問題返回給前端用於展示“操作日誌”
    let integrityIssues = [];
    if (!skipIntegrityCheck) {
      integrityIssues = await this.validateDataIntegrity(data);
      if (integrityIssues.length > 0) {
        console.warn(`[BackupService] 發現 ${integrityIssues.length} 個資料完整性問題:`);
        integrityIssues.forEach((issue) => console.warn(`  - ${issue.message}`));

        // 在嚴格模式下可以選擇丟擲錯誤
        // if (options.strictIntegrityCheck) {
        //   throw new Error(`資料完整性檢查失敗: ${integrityIssues.map(i => i.message).join('; ')}`);
        // }
      }
    }

    // 按依賴關係排序表
    const orderedTables = this.sortTablesByDependency(tables);

    // 記錄每個表的預期記錄數和語句對映
    const expectedResults = {};
    const statementTableMap = []; // 記錄每個語句對應的表名
    const statementInsertRowCounts = []; // 記錄每個插入語句包含的行數（用於統計 ignored/failed）

    try {
      // 收集所有需要執行的語句
      const statements = [];

      // 使用D1的延遲外來鍵約束功能
      statements.push(this.db.prepare("PRAGMA defer_foreign_keys = ON"));
      statementTableMap.push("_pragma"); // 標記為系統語句
      statementInsertRowCounts.push(0);

      // 在覆蓋模式下，按正確順序刪除資料
      if (mode === "overwrite") {
        // 按依賴關係的逆序刪除（子表先刪除）
        const reversedTables = [...orderedTables].reverse();
        for (const tableName of reversedTables) {
          statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
          statementTableMap.push(`_delete_${tableName}`); // 標記為刪除語句
          statementInsertRowCounts.push(0);
        }
      }

      // 按依賴關係順序插入資料
      for (const tableName of orderedTables) {
        const tableData = data[tableName];
        expectedResults[tableName] = {
          expected: tableData ? tableData.length : 0,
          statementIndices: [], // 記錄該表對應的語句索引
        };

        if (tableData && tableData.length > 0) {
          const insertPlans = this.buildInsertStatementsForTable(tableName, tableData, {
            mode,
            preserveTimestamps,
          });

          for (const plan of insertPlans) {
            const statementIndex = statements.length;
            statements.push(plan.statement);
            statementTableMap.push(tableName);
            statementInsertRowCounts.push(plan.rowCount);
            expectedResults[tableName].statementIndices.push(statementIndex);
          }
        }
      }

      // 在batch結束時恢復外來鍵約束檢查（可選，因為事務結束時會自動恢復）
      statements.push(this.db.prepare("PRAGMA defer_foreign_keys = OFF"));
      statementTableMap.push("_pragma"); // 標記為系統語句
      statementInsertRowCounts.push(0);

      // 分批執行（避免單次 batch 過大導致失敗）
      // 注意：多次 batch 可能不具備“全域性原子性”，但可以顯著提升大備份的可恢復性。
      const MAX_STATEMENTS_PER_BATCH = 80;
      let batchResults = [];
      if (statements.length > 0) {
        for (let i = 0; i < statements.length; i += MAX_STATEMENTS_PER_BATCH) {
          const chunk = statements.slice(i, i + MAX_STATEMENTS_PER_BATCH);
          // D1 batch 會返回與 chunk 同長度的結果陣列
          // 將其拼接後，索引仍然與 statementTableMap/statementInsertRowCounts 對齊
          // eslint-disable-next-line no-await-in-loop
          const chunkResults = await this.db.batch(chunk);
          batchResults.push(...(chunkResults || []));
        }
      }

      // 分析batch執行結果，計算實際的成功/失敗統計
      const results = this.analyzeBatchResults(batchResults, statementTableMap, statementInsertRowCounts, expectedResults, { mode });

      // 還原後：索引類派生資料一律視為無效，強制清空並要求重建
      await this.markFsSearchIndexNotReadyAfterRestore();

      return {
        restored_tables: Object.keys(results),
        total_records: Object.values(results).reduce((sum, r) => sum + r.success, 0),
        results,
        integrityIssues,
      };
    } catch (error) {
      console.error("還原備份失敗:", error);
      throw new RepositoryError(`還原備份失敗: ${error.message}`);
    }
  }

  /**
   * 僅做“預檢查/預估”，不寫入資料庫
   * - 用於在真正 restore 前，告訴使用者：會影響哪些表/大概會跑多少語句/有哪些明顯不匹配
   * @param {Object} backupData
   * @param {{ mode?: "overwrite"|"merge", currentAdminId?: string, skipIntegrityCheck?: boolean, preserveTimestamps?: boolean }} options
   */
  async previewRestoreBackup(backupData, options = {}) {
    const { mode = "overwrite", currentAdminId, skipIntegrityCheck = false } = options;

    if (mode !== "overwrite" && mode !== "merge") {
      throw new ValidationError(`不支援的還原模式: ${mode}`);
    }

    this.validateBackupData(backupData);

    let { data } = backupData;
    if (currentAdminId && mode === "merge") {
      data = this.mapAdminIds(data, currentAdminId);
    }

    const tables = Object.keys(data);
    await this.validateTablesExist(tables);

    const existingTables = await this.getExistingTableSet();

    const issues = [];
    const tablePlans = {};

    // 完整性檢查（只產出問題列表，不在預覽階段列印大量 warn）
    let integrityIssues = [];
    if (!skipIntegrityCheck) {
      integrityIssues = await this.validateDataIntegrity(data);
    }

    // 按依賴排序（便於使用者理解插入順序）
    const orderedTables = this.sortTablesByDependency(tables);
    const deleteOrder = mode === "overwrite" ? [...orderedTables].reverse() : [];

    let totalRecords = 0;
    let estimatedInsertStatements = 0;

    for (const tableName of orderedTables) {
      const records = Array.isArray(data[tableName]) ? data[tableName] : [];
      const recordCount = records.length;
      totalRecords += recordCount;

      const insertStatements = this.estimateInsertStatementCount(tableName, records, { mode });
      estimatedInsertStatements += insertStatements;

      const sampleCols = this.collectBackupColumnsSample(records, 50);
      const dbCols = await this.getTableColumnSet(tableName);

      const missingTable = existingTables ? !existingTables.has(tableName) : null;
      if (missingTable === true) {
        issues.push({
          level: "error",
          table: tableName,
          code: "TABLE_NOT_FOUND",
          message: `資料庫中缺少表：${tableName}（請先初始化/遷移資料庫結構）`,
        });
      }

      if (dbCols && sampleCols.size > 0) {
        const extraCols = [];
        for (const c of sampleCols) {
          if (!dbCols.has(c)) extraCols.push(c);
        }
        if (extraCols.length > 0) {
          issues.push({
            level: "error",
            table: tableName,
            code: "COLUMN_MISMATCH",
            message: `備份資料包含資料庫不存在的欄位：${extraCols.join(", ")}`,
          });
        }
      }

      tablePlans[tableName] = {
        records: recordCount,
        estimatedInsertStatements: insertStatements,
        sampleColumns: Array.from(sampleCols).sort(),
      };
    }

    const PRAGMA_STATEMENTS = 2; // defer_foreign_keys ON/OFF
    const estimatedDeleteStatements = mode === "overwrite" ? deleteOrder.length : 0;
    const MAX_STATEMENTS_PER_BATCH = 80;
    const estimatedTotalStatements = PRAGMA_STATEMENTS + estimatedDeleteStatements + estimatedInsertStatements;
    const estimatedBatches = Math.ceil(estimatedTotalStatements / MAX_STATEMENTS_PER_BATCH);

    const notes = [];
    notes.push("這是“預檢查”結果：不會寫入資料庫。");
    notes.push("若匯入到不同的 ENCRYPTION_SECRET 環境，部分加密配置可能無法解密（會表現為配置存在但不可用）。");
    if (mode === "overwrite") {
      notes.push("overwrite 會清空目標庫中對應表的資料，再重新匯入；建議先做一次全量備份留底。");
    } else {
      notes.push("merge 會盡量插入不存在的記錄（主鍵衝突會忽略）；不保證把舊資料“更新成新值”。");
    }

    return {
      mode,
      backup: {
        backup_type: backupData?.metadata?.backup_type || null,
        timestamp: backupData?.metadata?.timestamp || null,
        schema_version: backupData?.metadata?.schema_version || null,
        total_records: totalRecords,
      },
      plan: {
        tables,
        orderedTables,
        deleteOrder,
        tablePlans,
        estimated: {
          totalRecords,
          insertStatements: estimatedInsertStatements,
          deleteStatements: estimatedDeleteStatements,
          totalStatements: estimatedTotalStatements,
          batches: estimatedBatches,
          maxStatementsPerBatch: MAX_STATEMENTS_PER_BATCH,
        },
      },
      issues,
      integrityIssues,
      notes,
    };
  }

  /**
   * 分析batch執行結果，計算實際的成功/失敗統計
   * @param {Array} batchResults - batch執行結果陣列
   * @param {Array} statementTableMap - 語句與表名的對映陣列
   * @param {Object} expectedResults - 預期結果統計
   * @returns {Object} 實際結果統計
   */
  analyzeBatchResults(batchResults, statementTableMap, statementInsertRowCounts, expectedResults, options = {}) {
    const { mode = "overwrite" } = options;
    const results = {};

    // 初始化結果統計
    for (const tableName of Object.keys(expectedResults)) {
      results[tableName] = {
        success: 0, // 實際插入的記錄數
        ignored: 0, // 被忽略的重複記錄數（僅合併模式）
        failed: 0, // 插入失敗的記錄數
        expected: expectedResults[tableName].expected,
      };
    }

    // 分析每個語句的執行結果
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      const tableName = statementTableMap[i];
      const expectedRows = Array.isArray(statementInsertRowCounts) ? (statementInsertRowCounts[i] || 0) : 0;

      // 跳過系統語句（PRAGMA等）
      if (tableName.startsWith("_")) {
        continue;
      }

      // 檢查語句執行是否成功
      if (result && result.success !== false) {
        // 對於INSERT語句，檢查changes欄位
        const changes = result.meta?.changes || result.changes || 0;
        results[tableName].success += changes;

        if (expectedRows > changes) {
          if (mode === "merge") {
            results[tableName].ignored += expectedRows - changes;
          } else {
            // overwrite 下：changes < expectedRows 通常意味著語句未按預期寫入（可能是欄位/約束問題）
            results[tableName].failed += expectedRows - changes;
          }
        }
      } else {
        // 語句執行失敗
        results[tableName].failed += expectedRows > 0 ? expectedRows : 1;
      }
    }

    return results;
  }

  /**
   * 驗證資料完整性
   * @param {Object} data - 備份資料
   * @returns {Array} 完整性問題列表
   */
  async validateDataIntegrity(data) {
    const issues = [];

    // 檢查 storage_mounts 的依賴
    if (data.storage_mounts) {
      for (const mount of data.storage_mounts) {
        if (mount.storage_config_id) {
          // 通用檢查：備份資料中是否包含此儲存配置記錄
          const hasConfig = data.storage_configs?.some((config) => config.id === mount.storage_config_id);
          if (!hasConfig) {
            try {
              const exists = await StorageConfigUtils.configExists(this.db, mount.storage_type || "S3", mount.storage_config_id);
              if (!exists) {
                issues.push({
                  type: "missing_dependency",
                  table: "storage_mounts",
                  record_id: mount.id,
                  record_name: mount.name,
                  dependency_table: "storage_configs",
                  dependency_id: mount.storage_config_id,
                  message: `掛載點 "${mount.name}" 依賴的儲存配置 "${mount.storage_config_id}" 不存在`,
                });
              }
            } catch (error) {
              console.warn(`[BackupService] 檢查儲存配置依賴時出錯: ${error.message}`);
            }
          }
        }
      }
    }

    // 檢查 file_passwords 的依賴
    if (data.file_passwords) {
      for (const filePassword of data.file_passwords) {
        const hasFile = data.files?.some((file) => file.id === filePassword.file_id);
        if (!hasFile) {
          try {
            const existingFile = await this.db.prepare(`SELECT id FROM files WHERE id = ?`).bind(filePassword.file_id).first();

            if (!existingFile) {
              issues.push({
                type: "missing_dependency",
                table: "file_passwords",
                record_id: filePassword.file_id,
                dependency_table: "files",
                dependency_id: filePassword.file_id,
                message: `檔案密碼記錄依賴的檔案 "${filePassword.file_id}" 不存在`,
              });
            }
          } catch (error) {
            console.warn(`[BackupService] 檢查檔案依賴時出錯: ${error.message}`);
          }
        }
      }
    }

    // 檢查 paste_passwords 的依賴
    if (data.paste_passwords) {
      for (const pastePassword of data.paste_passwords) {
        const hasPaste = data.pastes?.some((paste) => paste.id === pastePassword.paste_id);
        if (!hasPaste) {
          try {
            const existingPaste = await this.db.prepare(`SELECT id FROM pastes WHERE id = ?`).bind(pastePassword.paste_id).first();

            if (!existingPaste) {
              issues.push({
                type: "missing_dependency",
                table: "paste_passwords",
                record_id: pastePassword.paste_id,
                dependency_table: "pastes",
                dependency_id: pastePassword.paste_id,
                message: `文字密碼記錄依賴的文字 "${pastePassword.paste_id}" 不存在`,
              });
            }
          } catch (error) {
            console.warn(`[BackupService] 檢查文字依賴時出錯: ${error.message}`);
          }
        }
      }
    }

    return issues;
  }

  /**
   * 處理時間戳欄位
   * @param {Object} record - 記錄物件
   * @param {string} tableName - 表名
   * @param {Object} options - 處理選項
   * @returns {Object} 處理後的記錄
   */
  processTimestampFields(record, tableName, options = {}) {
    const { preserveTimestamps = false, updateTimestamps = true } = options;
    const processedRecord = { ...record };

    if (!preserveTimestamps) {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      // 在合併模式下更新 updated_at 欄位
      if (updateTimestamps && processedRecord.updated_at !== undefined && processedRecord.updated_at !== null) {
        // tasks.updated_at 是 INTEGER（毫秒），不能寫成 ISO 字串
        if (tableName === DbTables.TASKS || tableName === "tasks") {
          processedRecord.updated_at = nowMs;
        } else {
          processedRecord.updated_at = nowIso;
        }
      }

      // 可選：為新插入的記錄更新 created_at（通常不建議）
      // if (processedRecord.created_at && options.updateCreatedAt) {
      //   processedRecord.created_at = nowIso;
      // }
    }

    return processedRecord;
  }

  /**
   * 為單張表構建插入語句列表（儘量合併為“多行插入”，減少語句數量）
   * - overwrite：INSERT INTO ... VALUES (...),(...)\n
   * - merge：SQLite/D1 使用 INSERT OR IGNORE
   * @param {string} tableName
   * @param {Array<Object>} records
   * @param {{ mode: "overwrite"|"merge", preserveTimestamps?: boolean }} options
   * @returns {Array<{ statement: any, rowCount: number }>}
   */
  buildInsertStatementsForTable(tableName, records, options = {}) {
    const { mode = "overwrite", preserveTimestamps = false } = options;

    const list = Array.isArray(records) ? records : [];
    if (list.length === 0) return [];

    // 僅對 sqlite/d1 做“多行插入”最佳化；其它方言按原始單行語句走
    const dialectName = this.dialect?.name || "unknown";
    const canBulkInsert = dialectName === "sqlite";

    // 統一收集列（取 union），並排序保證穩定性
    const colSet = new Set();
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      for (const k of Object.keys(r)) {
        colSet.add(k);
      }
    }
    const columns = Array.from(colSet).sort();
    if (columns.length === 0) return [];

    // 處理記錄（時間戳欄位）
    const processed = list.map((r) =>
      this.processTimestampFields(r, tableName, { preserveTimestamps, updateTimestamps: mode === "merge" }),
    );

    if (!canBulkInsert) {
      // 回退：每行一個語句
      const out = [];
      for (const row of processed) {
        const fields = Object.keys(row);
        const values = Object.values(row);
        const sql =
          mode === "overwrite"
            ? `INSERT INTO ${tableName} (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`
            : this.dialect.buildInsertIgnoreSql({ table: tableName, columns: fields });
        out.push({ statement: this.db.prepare(sql).bind(...values), rowCount: 1 });
      }
      return out;
    }

    // D1/SQLite 的變數上限在不同環境裡可能不同（D1 報錯：too many SQL variables）
    // 為了穩：統一用一個更保守的上限，寧可多跑幾條語句，也不要匯入時直接失敗。
    const MAX_BIND_VARS = 80;
    const maxRowsPerStatement = Math.max(1, Math.floor(MAX_BIND_VARS / columns.length));

    const statements = [];
    for (let i = 0; i < processed.length; i += maxRowsPerStatement) {
      const chunk = processed.slice(i, i + maxRowsPerStatement);
      const rowCount = chunk.length;

      const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
      const valuesClause = Array.from({ length: rowCount }).map(() => rowPlaceholders).join(", ");

      const baseSql =
        mode === "merge"
          ? `INSERT OR IGNORE INTO ${tableName} (${columns.join(", ")}) VALUES ${valuesClause}`
          : `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${valuesClause}`;

      const binds = [];
      for (const row of chunk) {
        for (const col of columns) {
          binds.push(Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null);
        }
      }

      statements.push({
        statement: this.db.prepare(baseSql).bind(...binds),
        rowCount,
      });
    }

    return statements;
  }

  /**
   * 在合併模式下對映 admin_id 到當前管理員
   * @param {Object} data - 備份資料
   * @param {string} currentAdminId - 當前管理員ID
   * @returns {Object} 對映後的資料
   */
  mapAdminIds(data, currentAdminId) {
    const mappedData = { ...data };

    console.log(`[BackupService] 對映 admin_id 到當前管理員 ${currentAdminId}`);

    // 處理 storage_configs 表
    if (mappedData.storage_configs) {
      const originalCount = mappedData.storage_configs.length;
      mappedData.storage_configs = mappedData.storage_configs.map((record) => ({
        ...record,
        admin_id: currentAdminId,
      }));
      console.log(`[BackupService] 對映 storage_configs 表：${originalCount} 條記錄的 admin_id 已更新`);
    }

    // 處理 storage_mounts 表
    if (mappedData.storage_mounts) {
      const originalCount = mappedData.storage_mounts.length;
      mappedData.storage_mounts = mappedData.storage_mounts.map((record) => ({
        ...record,
        created_by: currentAdminId,
      }));
      console.log(`[BackupService] 對映 storage_mounts 表：${originalCount} 條記錄的 created_by 已更新`);
    }

    // 處理 files 表
    if (mappedData.files) {
      const originalCount = mappedData.files.length;
      mappedData.files = mappedData.files.map((record) => ({
        ...record,
        created_by: currentAdminId,
      }));
      console.log(`[BackupService] 對映 files 表：${originalCount} 條記錄的 created_by 已更新`);
    }

    // 處理 pastes 表
    if (mappedData.pastes) {
      const originalCount = mappedData.pastes.length;
      mappedData.pastes = mappedData.pastes.map((record) => ({
        ...record,
        created_by: currentAdminId,
      }));
      console.log(`[BackupService] 對映 pastes 表：${originalCount} 條記錄的 created_by 已更新`);
    }

    // 注意：不處理 api_keys 表，因為API金鑰是獨立的使用者身份
    // 注意：不處理 admin_tokens 表，因為令牌應該跟隨對應的管理員

    return mappedData;
  }

  /**
   * 獲取模組資訊（包含記錄數統計）
   * @returns {Object} 模組資訊
   */
  async getModulesInfo() {
    const modules = {};

    for (const [moduleKey, tables] of Object.entries(this.moduleTableMapping)) {
      let totalRecords = 0;

      for (const tableName of tables) {
        try {
          const result = await this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).first();
          totalRecords += result.count || 0;
        } catch (error) {
          console.error(`獲取表 ${tableName} 記錄數失敗:`, error);
          // 表不存在或查詢失敗時，記錄數為0
          totalRecords += 0;
        }
      }

      modules[moduleKey] = {
        name: this.getModuleDisplayName(moduleKey),
        tables: tables,
        record_count: totalRecords,
        description: this.getModuleDescription(moduleKey),
      };
    }

    return modules;
  }

  /**
   * 根據模組獲取對應的表
   * @param {Array} modules - 模組列表
   * @returns {Array} 表列表
   */
  getTablesFromModules(modules) {
    const tables = new Set();
    modules.forEach((module) => {
      if (this.moduleTableMapping[module]) {
        this.moduleTableMapping[module].forEach((table) => {
          tables.add(table);
        });
      }
    });
    return Array.from(tables);
  }

  /**
   * 匯出指定表的資料
   * @param {Array} tableNames - 表名列表
   * @returns {Object} 匯出的資料
   */
  async exportTables(tableNames) {
    const result = {};

    // 按依賴關係排序表
    const orderedTables = this.sortTablesByDependency(tableNames);

    for (const tableName of orderedTables) {
      try {
        const data = await this.db.prepare(`SELECT * FROM ${tableName}`).all();
        result[tableName] = data.results || [];
        console.log(`匯出表 ${tableName}: ${result[tableName].length} 條記錄`);
      } catch (error) {
        console.error(`匯出表 ${tableName} 失敗:`, error);
        result[tableName] = [];
      }
    }

    return result;
  }

  /**
   * 按依賴關係排序表
   * @param {Array} tables - 表列表
   * @returns {Array} 排序後的表列表
   */
  sortTablesByDependency(tables) {
    const sorted = [];
    const remaining = [...tables];

    while (remaining.length > 0) {
      let found = false;

      for (let i = 0; i < remaining.length; i++) {
        const table = remaining[i];
        const deps = this.tableDependencies[table] || [];

        // 檢查依賴是否都已處理或不在待處理列表中
        if (deps.every((dep) => sorted.includes(dep) || !tables.includes(dep))) {
          sorted.push(table);
          remaining.splice(i, 1);
          found = true;
          break;
        }
      }

      // 如果沒有找到可處理的表，說明有迴圈依賴，直接新增剩餘的表
      if (!found) {
        sorted.push(...remaining);
        break;
      }
    }

    return sorted;
  }

  /**
   * 驗證備份資料
   * @param {Object} backupData - 備份資料
   */
  validateBackupData(backupData) {
    if (!backupData || typeof backupData !== "object") {
      throw new ValidationError("無效的備份資料格式");
    }

    if (!backupData.metadata || !backupData.data) {
      throw new ValidationError("備份資料缺少必要的欄位");
    }

    if (!backupData.metadata.version || !backupData.metadata.timestamp) {
      throw new ValidationError("備份後設資料不完整");
    }

    // 驗證校驗和
    const calculatedChecksum = this.generateChecksum(backupData.data);
    if (backupData.metadata.checksum !== calculatedChecksum) {
      throw new ValidationError("備份資料校驗失敗，檔案可能已損壞");
    }
  }

  /**
   * 驗證表是否存在
   * @param {Array} tables - 表名列表
   */
  async validateTablesExist(tables) {
    const validTables = Object.values(DbTables);

    for (const table of tables) {
      if (!validTables.includes(table)) {
        throw new ValidationError(`不支援的資料表: ${table}`);
      }
    }
  }

  /**
   * 獲取模組顯示名稱
   * @param {string} moduleKey - 模組鍵
   * @returns {string} 顯示名稱
   */
  getModuleDisplayName(moduleKey) {
    const names = {
      text_management: "文字管理",
      file_management: "檔案管理",
      mount_management: "掛載管理",
      storage_config: "儲存配置",
      fs_meta_management: "元資訊管理",
      key_management: "金鑰管理",
      account_management: "賬號管理",
      system_settings: "系統設定",
      task_management: "任務與定時任務",
      upload_sessions: "上傳會話",
      vfs_management: "目錄樹索引（VFS）",
    };
    return names[moduleKey] || moduleKey;
  }

  /**
   * 獲取模組描述
   * @param {string} moduleKey - 模組鍵
   * @returns {string} 模組描述
   */
  getModuleDescription(moduleKey) {
    const descriptions = {
      text_management: "文字分享資料和密碼",
      file_management: "檔案分享資料和密碼",
      mount_management: "儲存掛載點配置",
      storage_config: "儲存配置和訪問控制",
      key_management: "API金鑰管理",
      account_management: "管理員賬號和令牌",
      system_settings: "系統全域性設定",
      fs_meta_management: "目錄元資訊配置",
      task_management: "通用任務佇列 + 後臺定時任務（jobs/runs）",
      upload_sessions: "上傳/分片/斷點續傳會話（可選遷移資料）",
      vfs_management: "虛擬目錄樹索引。建議與“儲存配置”“掛載管理”一起備份",
    };
    return descriptions[moduleKey] || "";
  }

  /**
   * 深度排序物件鍵（遞迴處理巢狀物件和陣列）
   * @param {any} obj - 要排序的物件
   * @returns {any} 排序後的物件
   */
  deepSortKeys(obj) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepSortKeys(item));
    }

    const sortedObj = {};
    const sortedKeys = Object.keys(obj).sort();

    for (const key of sortedKeys) {
      sortedObj[key] = this.deepSortKeys(obj[key]);
    }

    return sortedObj;
  }

  /**
   * 生成資料校驗和（使用穩定的序列化演算法）
   * @param {Object} data - 資料物件
   * @returns {string} 校驗和
   */
  generateChecksum(data) {
    // 遞迴排序所有物件鍵，確保相同資料產生相同校驗和
    const sortedData = this.deepSortKeys(data);
    const dataString = JSON.stringify(sortedData);
    return crypto.createHash("sha256").update(dataString).digest("hex").substring(0, 16);
  }
}
