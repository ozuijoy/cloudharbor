import { jobTypeCatalog, buildBuiltinJobTypeDefinitions } from "./JobTypeCatalog.js";
import { taskRegistry } from "./TaskRegistry.js";

export function registerJobTypes(): void {
  console.log("[JobTypeCatalog] 開始註冊任務型別定義...");
  const defs = buildBuiltinJobTypeDefinitions();
  for (const def of defs) {
    jobTypeCatalog.register(def);
  }
  console.log(
    `[JobTypeCatalog] 註冊完成! 共註冊 ${defs.length} 個任務型別定義: ${defs
      .map((d) => d.taskType)
      .join(", ")}`
  );
}

export function validateJobTypesConsistency(): void {
  const supported = taskRegistry.getSupportedTypes();
  const handlers = supported.map((t) => taskRegistry.getHandler(t));
  jobTypeCatalog.validateAgainstHandlers(handlers);
  console.log("[JobTypeCatalog] 一致性校驗透過（definitions <-> handlers）");
}

