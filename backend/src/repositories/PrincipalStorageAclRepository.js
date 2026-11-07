/**
 * PrincipalStorageAclRepository
 * 負責主體 -> 儲存配置（storage_configs）訪問白名單的持久化
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class PrincipalStorageAclRepository extends BaseRepository {
  /**
   * 根據主體獲取可訪問的 storage_config_id 列表
   * @param {string} subjectType - 主體型別，例如 'API_KEY' / 'USER' / 'ROLE'
   * @param {string} subjectId - 主體 ID
   * @returns {Promise<string[]>} 可訪問的 storage_config_id 列表
   */
  async findConfigIdsBySubject(subjectType, subjectId) {
    if (!subjectType || !subjectId) {
      return [];
    }

    const result = await this.query(
      `SELECT storage_config_id FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ?`,
      [subjectType, subjectId]
    );

    const rows = result.results || [];
    return rows.map((row) => row.storage_config_id).filter(Boolean);
  }

  /**
   * 為主體新增一條儲存配置訪問許可權繫結（冪等）
   */
  async addBinding(subjectType, subjectId, storageConfigId) {
    if (!subjectType || !subjectId || !storageConfigId) {
      return;
    }

    const sql = this._buildInsertIgnoreSql(DbTables.PRINCIPAL_STORAGE_ACL, [
      "subject_type",
      "subject_id",
      "storage_config_id",
    ]);
    await this.execute(
      sql,
      [subjectType, subjectId, storageConfigId]
    );
  }

  /**
   * 為主體移除一條儲存配置訪問許可權繫結
   */
  async removeBinding(subjectType, subjectId, storageConfigId) {
    if (!subjectType || !subjectId || !storageConfigId) {
      return;
    }

    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ? AND storage_config_id = ?`,
      [subjectType, subjectId, storageConfigId]
    );
  }

  /**
   * 用一組 storage_config_id 替換某主體的所有繫結
   * 傳入空陣列表示清空白名單（回退到預設行為）
   */
  async replaceBindings(subjectType, subjectId, storageConfigIds) {
    if (!subjectType || !subjectId) {
      return;
    }

    // 先清空現有繫結
    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ?`,
      [subjectType, subjectId]
    );

    if (!Array.isArray(storageConfigIds) || storageConfigIds.length === 0) {
      return;
    }

    // 逐條插入新的繫結
    for (const configId of storageConfigIds) {
      if (!configId) continue;
      const sql = this._buildInsertIgnoreSql(DbTables.PRINCIPAL_STORAGE_ACL, [
        "subject_type",
        "subject_id",
        "storage_config_id",
      ]);
      await this.execute(
        sql,
        [subjectType, subjectId, configId]
      );
    }
  }

  /**
   * 根據儲存配置ID批次刪除所有 ACL 繫結
   * @param {string} storageConfigId - storage_configs.id
   * @returns {Promise<void>}
   */
  async deleteByStorageConfigId(storageConfigId) {
    if (!storageConfigId) {
      return;
    }

    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE storage_config_id = ?`,
      [storageConfigId]
    );
  }
}
