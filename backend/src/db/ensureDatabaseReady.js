import { createDbRuntime } from "./runtime.js";

/**
 * 確保資料庫可用（統一入口）
 * - 由 provider 決定初始化/遷移策略
 *
 * @param {{ db:any, env?:any, providerName?:string }} params
 */
export async function ensureDatabaseReady({ db, env = {}, providerName = null }) {
  const runtime = createDbRuntime({ db, env, providerName });
  await runtime.provider.ensureReady(runtime);
  return runtime;
}
