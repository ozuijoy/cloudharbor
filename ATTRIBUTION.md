# Attribution / 來源聲明

本專案（以下稱 **CloudHarbor**）是 **CloudPaste** 的衍生版本（fork / derivative work）。

- 上游專案：CloudPaste
- 上游原始碼：https://github.com/ling-drag0n/CloudPaste （Copyright 2023-present CloudPaste Contributors）
- 授權條款：Apache License 2.0（見 `LICENSE`）

CloudPaste 已停止維護，本專案在其基礎上進行了以下改造後以新名稱發佈：

1. **套件安全升級**：後端 `npm audit` 由 39 項弱點降為 0；前端由 31 項（22 high）降為 4 項 low。
2. **上傳失敗／斷線修正**：見 `CHANGELOG-zhTW.md` 第二節。
3. **簡體中文 → 正體中文（台灣）**：650+ 檔，語言標識 `zh-CN` → `zh-TW`。
4. **專案更名**：`CloudPaste` / `cloudpaste` → `CloudHarbor` / `cloudharbor`（含 DB 檔名、
   Docker 映像與網路名稱、Cloudflare 資源名、localStorage 鍵、CSS class、User-Agent 等）。

## 遷移注意事項（重要）

因為更名涉及**持久化識別字**，從舊版升級時請注意：

| 項目 | 舊值 | 新值 | 影響 |
| --- | --- | --- | --- |
| SQLite 資料庫檔名 | `data/cloudpaste.db` | `data/cloudharbor.db` | 需把舊檔案改名，或在 `DATA_DIR` 下建立連結，否則會以空資料庫啟動 |
| localStorage 鍵 | `cloudpaste_*`、`cloudpaste-*`、`cloudpaste.*` | `cloudharbor*` | 使用者端偏好設定（語言、主題、除錯旗標等）會回到預設值 |
| Docker 映像 | `dragon730/cloudpaste-*` | `cloudharbor-*`（請改成自己的 registry） | `docker-compose.yml` 需同步修改 |
| Docker 網路 | `cloudpaste-network` | `cloudharbor-network` | 舊網路會殘留，需手動移除 |
| Cloudflare 資源 | `cloudpaste-db` / `cloudpaste-spa` / `cloudpaste-frontend` / `cloudpaste-backend` | `cloudharbor-*` | 若沿用既有資源，請改回原名或先在 CF 後台改名 |
| 資料庫 / 應用顯示名稱 | `CloudPaste` | `CloudHarbor` | 可在「站點設定」調整，`site_title` 預設值已更新 |

## 對外連結設定

- README（中／英）、Star History、Contributors 徽章、`git clone` 指令與 Discord 驅動的
  `User-Agent` 皆指向 `https://github.com/ozuijoy/cloudharbor`。
- Docker 映像統一為 `ozuijoy/cloudharbor-backend`、`ozuijoy/cloudharbor-frontend`；若改用其他
  Docker Hub 帳號，請全域替換 `ozuijoy/` 並同步 `.github/workflows` 的 `DOCKERHUB_USERNAME`。
- `frontend/src/App.vue` 的 `githubUrl` 指向本專案倉庫；`AdminSidebar.vue` 的 `DOC_URL`
  指向本專案 `README_zh-TW.md`，如有獨立文件站可自行替換。
- 已移除上游作者的贊助／收款碼區塊（含 `images/PayQrcode.png`），避免與本專案混淆；
  上游授權與版權聲明仍保留於 `LICENSE` 與本文件。
