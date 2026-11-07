import { postgresDialect } from "../dialects/postgresDialect.js";

export const postgresProvider = {
  name: "postgres",
  dialect: postgresDialect,
  async ensureReady(_runtime) {
    throw new Error("PostgresProvider: 遷移/初始化尚未實現（需要接入遷移系統後再啟用）");
  },
};
