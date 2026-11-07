import type { TaskHandler } from "./TaskHandler.js";
// cSpell:words Retryable
import { PermissionChecker, Permission } from "../../../constants/permissions.js";
import { UserType } from "../../../constants/index.js";

export type JobTypeVisibility =
  | { mode: "admin-only" }
  | { mode: "owner-only"; permission?: number };

export type JobTypeCreatePolicy = {
  /**
   * - "fs.copy"：需要路徑解析鑑權
   * - "admin.all"：管理員專用
   */
  policy: string;
  /**
   * 是否需要按路徑做鑑權（目前只有 copy 需要）
   */
  pathCheck: boolean;
};

export type JobTypeCapabilities = {
  /**
   * 目前僅 copy 支援“前端一鍵重試”（本質是建立新的 copy job）。
   * 其他型別如果未來要支援重試，需要先定義清晰的 retry 語義和 API。
   */
  retry?: "none" | "copy-retry";
};

export type JobTypeDefinition = {
  taskType: string;
  /**
   * 前端用的翻譯 key，例如 "admin.tasks.taskType.copy"
   * - 前端可以用 t(i18nKey, taskType) 兜底
   */
  i18nKey?: string;
  /**
   * 可選：後端提供的顯示名
   */
  displayName?: string;
  category?: string;
  visibility: JobTypeVisibility;
  createPolicy: JobTypeCreatePolicy;
  capabilities?: JobTypeCapabilities;
};

export type JobTypePrincipal = {
  userType: string;
  permissions?: number;
};

class JobTypeCatalog {
  private static instance: JobTypeCatalog;
  private defs = new Map<string, JobTypeDefinition>();

  private constructor() {}

  static getInstance(): JobTypeCatalog {
    if (!JobTypeCatalog.instance) {
      JobTypeCatalog.instance = new JobTypeCatalog();
    }
    return JobTypeCatalog.instance;
  }

  register(def: JobTypeDefinition): void {
    if (!def?.taskType || typeof def.taskType !== "string") {
      throw new Error("[JobTypeCatalog] taskType 必須是非空字串");
    }
    if (this.defs.has(def.taskType)) {
      throw new Error(`[JobTypeCatalog] taskType "${def.taskType}" 已註冊，不允許重複註冊`);
    }
    this.defs.set(def.taskType, def);
    console.log(`[JobTypeCatalog] 已註冊任務型別定義: ${def.taskType}`);
  }

  get(taskType: string): JobTypeDefinition {
    const def = this.defs.get(taskType);
    if (!def) {
      throw new Error(
        `[JobTypeCatalog] 未知任務型別定義: "${taskType}"\n` +
          `已註冊: ${Array.from(this.defs.keys()).join(", ")}`
      );
    }
    return def;
  }

  tryGet(taskType: string): JobTypeDefinition | null {
    return this.defs.get(taskType) || null;
  }

  listAll(): JobTypeDefinition[] {
    return Array.from(this.defs.values());
  }

  isVisibleToPrincipal(taskType: string, principal: JobTypePrincipal): boolean {
    const def = this.tryGet(taskType);
    // 未知型別預設不可見（避免洩露/誤展示）
    if (!def) return false;

    if (principal.userType === UserType.ADMIN) return true;

    if (def.visibility?.mode === "admin-only") return false;

    if (def.visibility?.mode === "owner-only") {
      const required = def.visibility.permission;
      if (!required) return true;
      const perms = principal.permissions;
      if (typeof perms !== "number") return false;
      return PermissionChecker.hasPermission(perms, required);
    }

    return false;
  }

  listVisibleTypes(principal: JobTypePrincipal): JobTypeDefinition[] {
    if (principal.userType === UserType.ADMIN) {
      return this.listAll();
    }
    return this.listAll().filter((d) => this.isVisibleToPrincipal(d.taskType, principal));
  }

  /**
   * 啟動時做一致性校驗：
   * - definition 必須能找到 handler
   * - handler 也應該有 definition（否則 UI/許可權規則會缺失）
   */
  validateAgainstHandlers(handlers: TaskHandler[]): void {
    const handlerTypes = new Set(handlers.map((h) => h.taskType));
    const defTypes = new Set(Array.from(this.defs.keys()));

    const missingHandler = Array.from(defTypes).filter((t) => !handlerTypes.has(t));
    const missingDef = Array.from(handlerTypes).filter((t) => !defTypes.has(t));

    if (missingHandler.length > 0) {
      throw new Error(
        `[JobTypeCatalog] 存在未實現 handler 的 taskType: ${missingHandler.join(", ")}`
      );
    }

    if (missingDef.length > 0) {
      throw new Error(
        `[JobTypeCatalog] 存在未註冊 definition 的 taskType: ${missingDef.join(", ")}`
      );
    }
  }

  /**
   * 根據 definition 判斷是否允許“重試按鈕”
   */
  isRetryable(taskType: string): boolean {
    const def = this.tryGet(taskType);
    if (!def) return false;
    return (def.capabilities?.retry || "none") === "copy-retry";
  }
}

export const jobTypeCatalog = JobTypeCatalog.getInstance();

export function buildBuiltinJobTypeDefinitions(): JobTypeDefinition[] {
  return [
    {
      taskType: "copy",
      i18nKey: "admin.tasks.taskType.copy",
      category: "fs",
      visibility: { mode: "owner-only", permission: Permission.MOUNT_COPY },
      createPolicy: { policy: "fs.copy", pathCheck: true },
      capabilities: { retry: "copy-retry" },
    },
    {
      taskType: "fs_index_rebuild",
      i18nKey: "admin.tasks.taskType.fs_index_rebuild",
      category: "index",
      visibility: { mode: "admin-only" },
      createPolicy: { policy: "admin.all", pathCheck: false },
      capabilities: { retry: "none" },
    },
    {
      taskType: "fs_index_apply_dirty",
      i18nKey: "admin.tasks.taskType.fs_index_apply_dirty",
      category: "index",
      visibility: { mode: "admin-only" },
      createPolicy: { policy: "admin.all", pathCheck: false },
      capabilities: { retry: "none" },
    },
  ];
}
