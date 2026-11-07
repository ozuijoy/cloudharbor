import { mysqlDialect } from "../dialects/mysqlDialect.js";

export const mysqlProvider = {
  name: "mysql",
  dialect: mysqlDialect,
  async ensureReady(_runtime) {
    throw new Error("MySQLProvider: 遷移/初始化尚未實現（需要接入遷移系統後再啟用）");
  },
};
