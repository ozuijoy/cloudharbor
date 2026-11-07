/**
 * Vercel專用構建指令碼
 * 用於在構建時生成包含環境變數的配置檔案
 */
const fs = require("fs");
const path = require("path");

// 獲取環境變數，如果不存在則使用預設值
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:8787";

console.log(`Vercel構建: 使用後端URL ${backendUrl}`);

// 配置內容
const configContent = `// 執行時配置 - 由Vercel構建指令碼生成
window.appConfig = {
  backendUrl: '${backendUrl}'
};
`;

// 確保public目錄存在
const publicDir = path.resolve(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 寫入配置檔案
fs.writeFileSync(path.resolve(publicDir, "config.js"), configContent, "utf8");

console.log("✅ 配置檔案已生成");
