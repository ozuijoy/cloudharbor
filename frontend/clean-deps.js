/**
 * 清理Vite依賴快取的指令碼
 * 當遇到依賴問題時執行: node clean-deps.js
 * npm run clean
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// 獲取當前檔案的目錄名
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 要清理的目錄
const directoriesToClean = [path.join(__dirname, "node_modules", ".vite"), path.join(__dirname, "node_modules", ".cache")];

// 清理快取目錄
directoriesToClean.forEach((dir) => {
  if (fs.existsSync(dir)) {
    console.log(`正在清理: ${dir}`);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`✅ 清理完成: ${dir}`);
    } catch (err) {
      console.error(`❌ 清理失敗: ${dir}`, err);
    }
  } else {
    console.log(`目錄不存在，跳過: ${dir}`);
  }
});

// 清理package-lock.json
const packageLockPath = path.join(__dirname, "package-lock.json");
if (fs.existsSync(packageLockPath)) {
  console.log("正在清理: package-lock.json");
  try {
    fs.unlinkSync(packageLockPath);
    console.log("✅ 已刪除 package-lock.json");
  } catch (err) {
    console.error("❌ 刪除 package-lock.json 失敗", err);
  }
}

// 重新安裝依賴
console.log("正在重新安裝依賴...");
try {
  execSync("npm install", { stdio: "inherit" });
  console.log("✅ 依賴安裝完成");
} catch (err) {
  console.error("❌ 依賴安裝失敗", err);
}

console.log("清理完成! 現在執行 npm run dev 啟動開發伺服器");
