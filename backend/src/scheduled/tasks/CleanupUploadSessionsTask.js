import { DbTables } from "../../constants/index.js";

/**
 * 清理 upload_sessions 會話記錄的後臺任務
 * - 標記明顯過期的 initiated/uploading 會話為 expired
 * - 刪除超出保留視窗的歷史會話（completed/aborted/error/expired）
 *
 * 生命週期約定（只針對本地 upload_sessions 表）：
 * - expires_at：代表“應用側認為的會話過期時間”
 *   - OneDrive 場景下通常對映自 Graph uploadSession.expirationDateTime
 *   - 其他驅動（S3 / Google Drive 等）可能為空，由 activeGraceHours + updated_at 推導“長時間未更新的進行中會話”
 * - 本任務只負責清理本地會話記錄，不保證雲端 Provider 資源一定已被釋放
 *   （例如 S3 multipart upload 的真正清理由生命週期策略或專用指令碼負責）
 */
export class CleanupUploadSessionsTask {
  constructor() {
    /** @type {string} 任務唯一標識 */
    this.id = "cleanup_upload_sessions";

    /** @type {string} 任務顯示名稱 */
    this.name = "清理分片上傳會話";

    /** @type {string} 任務描述 */
    this.description =
      "定期清理本地分片上傳會話記錄";

    /** @type {"maintenance" | "business"} 任務類別 */
    this.category = "maintenance";

    /**
     * 配置引數 Schema
     * @type {Array<{
     *   name: string,
     *   label: string,
     *   type: "string" | "number" | "boolean" | "select" | "textarea",
     *   defaultValue: any,
     *   required: boolean,
     *   min?: number,
     *   max?: number,
     *   description?: string
     * }>}
     */
    this.configSchema = [
      {
        name: "keepDays",
        label: "歷史記錄保留天數",
        type: "number",
        defaultValue: 30,
        required: true,
        min: 1,
        max: 365,
        description:
          "保留多少天內的資料；超出該天數的歷史記錄將從本地資料庫中刪除。",
      },
      {
        name: "activeGraceHours",
        label: "活躍會話最大空閒時長（小時）",
        type: "number",
        defaultValue: 24,
        required: true,
        min: 1,
        max: 168,
        description:
          "對於仍處於 initiated/uploading 狀態在該時長內沒有任何更新，則視為已失效並標記為過期。",
      },
      {
        name: "deleteBatchSize",
        label: "刪除批次大小",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 50,
        max: 500,
        description: "每次最多刪除多少條歷史會話（以及關聯的 upload_parts），避免一次性刪除過重。",
      },
    ];
  }

  /**
   * 執行清理邏輯
   * @param {{ db: D1Database, env: any, now: string, config: any }} ctx
   */
  async run(ctx) {
    const { db, now, config } = ctx;

    // 始終提供預設值，相容舊配置和缺失欄位
    const keepDays = Number(config.keepDays) > 0 ? Number(config.keepDays) : 30;
    const activeGraceHours =
      Number(config.activeGraceHours) > 0 ? Number(config.activeGraceHours) : 24;
    const deleteBatchSize =
      Number(config.deleteBatchSize) > 0 ? Math.min(Number(config.deleteBatchSize), 500) : 200;

    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();

    // 計算時間視窗
    const activeGraceMs = activeGraceHours * 60 * 60 * 1000;
    const activeStaleThresholdIso = new Date(nowMs - activeGraceMs).toISOString();
    const keepMs = keepDays * 24 * 60 * 60 * 1000;
    const historyThresholdIso = new Date(nowMs - keepMs).toISOString();

    const getChanges = (result) => {
      if (!result) return 0;
      if (typeof result.meta?.changes === "number") return result.meta.changes;
      if (typeof result.changes === "number") return result.changes;
      return 0;
    };

    // 工具函式：統計當前 upload_sessions 各狀態數量，方便日誌觀測
    const readStatusCounts = async () => {
      const row = await db
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'initiated' THEN 1 ELSE 0 END) AS initiated_count,
            SUM(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_count,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count
          FROM ${DbTables.UPLOAD_SESSIONS}
        `,
        )
        .first();

      return {
        total: Number(row?.total) || 0,
        initiated: Number(row?.initiated_count) || 0,
        uploading: Number(row?.uploading_count) || 0,
        completed: Number(row?.completed_count) || 0,
        aborted: Number(row?.aborted_count) || 0,
        error: Number(row?.error_count) || 0,
        expired: Number(row?.expired_count) || 0,
      };
    };

    // 清理前統計一次當前會話分佈，方便後續在日誌中觀察整體趨勢
    const beforeCounts = await readStatusCounts();

    // 1) 標記明顯過期的 initiated/uploading 會話為 expired
    // 1.1 expires_at 非空且早於當前時間的會話
    const expireByExpiresAtResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status IN ('initiated','uploading')
          AND expires_at IS NOT NULL
          AND expires_at < ?
      `,
      )
      .bind(now, now)
      .run();

    // 1.2 expires_at 為空且長時間未更新的 initiated/uploading 會話
    const expireByStaleActiveResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status IN ('initiated','uploading')
          AND expires_at IS NULL
          AND updated_at < ?
      `,
      )
      .bind(now, activeStaleThresholdIso)
      .run();

    // 2) 刪除歷史會話（completed/aborted/error/expired 且更新時間早於保留視窗）
    // 說明：
    // - 必須連帶清理 upload_parts（臨時分片記錄），避免留下“垃圾分片”
    // - 刪除必須分批（bounded/batched），避免一次性 IN 引數過大或單次 DELETE 過重
    let deletedHistory = 0;
    let deletedHistoryBatches = 0;
    let deletedPartsTotal = 0;

    const pickDeleteCandidates = async () => {
      const res = await db
        .prepare(
          `
          SELECT id
          FROM ${DbTables.UPLOAD_SESSIONS}
          WHERE status IN ('completed','aborted','error','expired')
            AND updated_at < ?
          LIMIT ?
        `,
        )
        .bind(historyThresholdIso, deleteBatchSize)
        .all();
      return (res?.results || []).map((r) => r?.id).filter(Boolean);
    };

    while (true) {
      const ids = await pickDeleteCandidates();
      if (ids.length === 0) break;

      deletedHistoryBatches += 1;
      const placeholders = ids.map(() => "?").join(", ");

      // 2.1 先刪 upload_parts
      const delPartsRes = await db
        .prepare(
          `
          DELETE FROM ${DbTables.UPLOAD_PARTS}
          WHERE upload_id IN (${placeholders})
        `,
        )
        .bind(...ids)
        .run();
      deletedPartsTotal += getChanges(delPartsRes);

      // 2.2 再刪 upload_sessions
      const delSessionsRes = await db
        .prepare(
          `
          DELETE FROM ${DbTables.UPLOAD_SESSIONS}
          WHERE id IN (${placeholders})
        `,
        )
        .bind(...ids)
        .run();
      deletedHistory += getChanges(delSessionsRes);
    }

    const expiredByExpiresAt = getChanges(expireByExpiresAtResult);
    const expiredByStaleActive = getChanges(expireByStaleActiveResult);
    const expiredTotal = expiredByExpiresAt + expiredByStaleActive;

    // 清理後再統計一次，便於對比前後變化
    const afterCounts = await readStatusCounts();

    // 3)（兜底）一致性自檢：統計 orphan upload_parts（upload_id 不存在對應 upload_session）
    // 說明：這裡先只做統計 + 日誌觀測，不做強制刪除，避免誤刪導致排查困難
    const orphanRow = await db
      .prepare(
        `
        SELECT COUNT(*) AS cnt
        FROM ${DbTables.UPLOAD_PARTS} p
        WHERE NOT EXISTS (
          SELECT 1 FROM ${DbTables.UPLOAD_SESSIONS} s WHERE s.id = p.upload_id
        )
      `,
      )
      .first();
    const orphanParts = Number(orphanRow?.cnt) || 0;

    const summaryParts = [
      `標記過期會話 ${expiredTotal} 條`,
      `刪除歷史會話 ${deletedHistory} 條（分 ${deletedHistoryBatches} 批）`,
      `連帶清理 upload_parts ${deletedPartsTotal} 條`,
      `orphan upload_parts ${orphanParts} 條`,
    ];

    const summary = summaryParts.join("，");


    return {
      summary,
      // 清理結束後 upload_sessions 表的總記錄數，便於在前端或日誌中快速檢視當前規模
      totalSessions: afterCounts.total,
      stats: {
        before: beforeCounts,
        after: afterCounts,
        expiredByExpiresAt,
        expiredByStaleActive,
        deletedHistory,
        keepDays,
        activeGraceHours,
      },
    };
  }
}
