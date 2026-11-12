# CloudHarbor 修改說明（正體中文版）

本文件記錄本次針對 `CloudHarbor-main` 的三項修改：套件安全升級、上傳失敗／斷線修正、
簡體中文轉正體中文（語言標識 zh-CN → zh-TW）。

---

## 一、套件升級（安全性）

### 後端 `backend/package.json`

| 套件 | 原版本 | 新版本 | 說明 |
| --- | --- | --- | --- |
| `hono` | 4.10.6 | ^4.13.16 | 修補多個路由／中介軟體安全問題 |
| `@hono/node-server` | 1.19.6 | ^2.1.6 | 修補 `serveStatic` 路徑二次解碼等問題（本專案僅用 `serve`，一併升級） |
| `fast-xml-parser` | 5.2.5 | ^5.12.0 | **Critical**：XML 解析記憶體耗盡弱點 |
| `file-type` | 21.0.0 | ^21.3.4 | 檔案類型偵測邊界問題 |
| `webdav` | 5.8.0 | ^5.11.0 | 依賴鏈安全更新 |
| `@aws-sdk/client-s3` / `lib-storage` / `s3-request-presigner` | 3.726.1 | 3.1163.0 | 含 `fast-xml-parser` 等間接依賴修補 |
| `@smithy/util-retry` | （間接依賴） | ^4.6.2 | **改為顯式依賴**：新版 AWS SDK 不再帶入，但 `s3Utils.js` 直接 import |
| `better-sqlite3` | 12.4.1 | ^12.11.1 | 原生模組更新 |
| `sqlite3` | 5.1.7 | ^6.0.1 | 舊版 `node-gyp`／`tar` 依賴鏈弱點（僅安裝期，仍一併升級） |
| `wrangler` | 4.42.2 | ^4.158.0 | 開發／部署工具更新（需搭配 `@cloudflare/workers-types` 5.x） |

另加入 `overrides`：`tar-fs ^2.1.4`、`minimatch ^11.0.1`。

**結果：`npm audit` → 0 vulnerabilities。**

### 前端 `frontend/package.json`

| 套件 | 原版本 | 新版本 | 說明 |
| --- | --- | --- | --- |
| `vue` | 3.5.13 | 3.5.45 | `@vue/server-renderer` XSS（屬性名稱黑名單） |
| `vue-i18n` | 9.14.5 | **^11.4.18** | `@intlify/*` 翻譯訊息 XSS／原型污染（跨大版本，已同步調整程式碼） |
| `exifreader` | 4.33.1 | 4.54.0 | 惡意 ICC／中繼資料解壓縮 DoS |
| `postcss` | 8.4.35 | 8.5.32 | `</style>` 未轉義 XSS、sourceMappingURL 任意檔案讀取 |
| `preact` | 10.24.0 | 10.29.8 | JSON VNode 注入 |
| `vite-plugin-pwa` | 1.0.0 | 1.3.0 | `workbox-build` 依賴鏈更新 |
| `vitest`（新增 devDependency） | — | ^3.2.7 | 為上傳逾時邏輯補上可重複執行的單元測試（`npm test`） |

另加入 `overrides`：`glob ^14.0.4`、`minimatch ^11.0.5`、`deepmerge ^4.3.1`、
`serialize-javascript ^7.1.4`、`@rollup/plugin-node-resolve ^16.0.3`、`@rollup/plugin-terser ^1.0.2`。

**結果：`npm audit` 由 31 項（22 high）降至 4 項 low**（`deepmerge` 透由
`workbox-build` → `@rollup/plugin-node-resolve`，建置期使用、上游尚無修正版本）。

### 程式碼配合調整

- `frontend/src/i18n/index.js`：`vue-i18n` v10+ 已移除 `silentTranslationWarn` /
  `silentFallbackWarn`，改為 `missingWarn: false, fallbackWarn: false`。
- `backend/src/storage/drivers/s3/utils/s3Utils.js`：改用的 `@smithy/util-retry`
  已列入 `dependencies`（見上表）。
- `docker/frontend/Dockerfile`：`nginx:1.25-alpine` → `nginx:1.29-alpine`。

---

## 二、上傳失敗／斷線修正

部署後「上傳到一半失敗」「連線中斷」「大檔案上傳失敗」通常是**多層逾時與記憶體緩衝**
疊加造成，本次修正五處：

1. **前端一般請求的 30 秒逾時**（`frontend/src/api/client.js`）
   原本所有 `fetch` 都套用 `AbortSignal.timeout(30000)`，包含 FormData／Blob 上傳。
   → 上傳類請求不再套用 30 秒限制；呼叫端可用 `timeout: 0` 明確關閉。

2. **Uppy XHRUpload 的 30 秒「無進度即中止」**（新增
   `frontend/src/modules/storage-core/uppy/xhrUploadDefaults.js`，套用到 7 個驅動、
   共 28 處 `uppy.use(XHRUpload, …)`）
   Uppy 預設 `timeout: 30000`，且檔案傳到 100% 後若後端仍在處理（中轉 S3／Telegram／
   寫入慢速磁碟），30 秒沒進度就會被前端自行中止。
   → 改為 10 分鐘（可用 `window.appConfig.uploadTimeoutMs` 覆寫，`0` 表示不限）。

3. **Node HTTP 伺服器 5 分鐘請求逾時**（`backend/unified-entry.js`）
   Node 預設 `server.requestTimeout = 300000ms`，限制「整個請求」的接收時間。
   → 預設改為 `0`（不限），`headersTimeout` 60s、`keepAliveTimeout` 65s；
   可用 `HTTP_REQUEST_TIMEOUT_MS`、`HTTP_HEADERS_TIMEOUT_MS`、
   `HTTP_KEEP_ALIVE_TIMEOUT_MS` 覆寫。

4. **本機儲存驅動把整個檔案讀進記憶體**（`backend/src/storage/drivers/local/LocalStorageDriver.js`）
   Web `ReadableStream` 原本以 `Buffer.concat` 全部讀入再寫檔；Docker 容器記憶體有限時，
   上傳大檔會 OOM 被 kill，前端即「連線中斷」。
   → 新增 `_pipeWebStreamToFile()`，以 `Readable.fromWeb()` 邊讀邊寫，記憶體佔用恆定；
   串流失敗／客戶端斷線時會刪除寫了一半的檔案，避免留下損壞的半截檔。

5. **`BACKEND_URL` 結尾斜線造成 404**（`frontend/src/api/config.js`、
   `docker/frontend/entrypoint.sh`）
   `https://host/` + `/api/...` 會拼成 `https://host//api/...`，部分反向代理不合併雙斜線。
   → 前端與容器啟動腳本都會移除結尾斜線。

### 反向代理設定（README 已同步更新）

`location /api` 區塊建議加入：

```nginx
client_max_body_size 0;
proxy_request_buffering off;   # 直接串流給後端，不先整包緩衝到磁碟
proxy_buffering off;
client_body_timeout 3600s;
proxy_connect_timeout 3600s;
proxy_send_timeout 3600s;
proxy_read_timeout 3600s;
```

`docker/frontend/nginx.conf` 亦已加入 `client_max_body_size 0` 與 `client_body_timeout`。

### 驗證結果（本機實測）

**第一輪（回歸測試腳本，15 項全過）**

| 情境 | 結果 |
| --- | --- |
| 同一 keep-alive 連線連續兩次上傳 8MB | PASS |
| 每次新連線 cold 上傳 8MB（×2） | PASS |
| 64MB 上傳後緊接小檔 | PASS |
| chunked（無 Content-Length）上傳 | PASS |
| `Expect: 100-continue` 上傳 | PASS |
| 3 個 64MB 併發上傳 | PASS |
| curl 中途斷線（3 秒後中止）→ 不留半截檔、服務存活 | PASS |
| socket 層 RST 硬斷 → 不留半截檔、服務存活 | PASS |
| 同一連線閒置 30 秒後重用再上傳（keepAliveTimeout=65s） | PASS |
| 慢速上傳 64MB（限速 1MB/s，耗時 64 秒） | PASS |
| 斷線後立刻恢復上傳 | PASS |
| 15 個檔案大小／MD5 全部一致 | PASS |
| 後端日誌中 ECONNRESET / EPIPE / uncaughtException 等關鍵字 | 0 筆 |

**第二輪（針對「超過 Node 預設 5 分鐘」的極端情境）**

| 情境 | 結果 |
| --- | --- |
| 64MB 限速 200KB/s，實際耗時 **328 秒**（> 300 秒） | PASS，MD5 一致（證明 `requestTimeout=0` 生效） |
| 表單上傳（`POST /api/fs/upload`，multipart 64MB） | PASS，MD5 一致；後端 RSS 增量 218MB（Hono `formData()` 解析 + 落盤各佔一份，屬該路徑固有行為） |

**第三輪（靜態檢查，14 項全過）**

- 28 處 `uppy.use(XHRUpload, …)` **全部**都設定了 `timeout: getUploadTimeoutMs()`，無一遺漏
- 7 個驅動檔案都正確 import `xhrUploadDefaults.js`
- `client.js`：上傳類請求不套 30 秒硬逾時；XHR 二進位預設 `timeout=0`；Blob／ArrayBuffer／ReadableStream 皆判定為上傳；二進位 body 不再被 `JSON.stringify`
- `unified-entry.js`：`requestTimeout` 預設 0、headers/keepAlive 可覆寫
- `LocalStorageDriver.js`：`Readable.fromWeb` 串流落盤、失敗時刪除半截檔
- `nginx.conf` / README 反代設定 / entrypoint 斜線正規化

**第四輪（`xhrUploadDefaults` 單元測試，8 項全過）**

預設 600000ms、`uploadTimeoutMs = 0` 完全停用、字串數字可接受、負值／未設定回退預設、
`withUploadTimeout` 不覆寫呼叫端明確指定的 `timeout`。

> 說明：`getUploadTimeoutMs()` 讀的是**瀏覽器端** `window.appConfig.uploadTimeoutMs`。
> 若只想在 Docker 層調整、不想改資料庫／前端設定，可改用環境變數（見下節）。

**第五輪（`npm test` 單元測試，已納入專案）**

新增 `vitest` 與 `frontend/src/modules/storage-core/__tests__/uploadTimeout.spec.js`，
執行 `npm test` 的結果：

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

覆蓋：預設 10 分鐘、`uploadTimeoutMs = 0` 停用、字串數字、非法值回退、
`withUploadTimeout` 不覆寫呼叫端指定值，以及 `client.js` 的
「一般 API 30 秒／上傳不設逾時／呼叫端明確指定優先／可被 `window.appConfig` 覆寫」
決策等價邏輯（含 `0` 不被視為 falsy 而誤回退）。

順帶再次確認：加入 `test` 配置後 `vite build` 仍正常完成（3m46s，同樣產出），
且 `npm ci --dry-run` 通過、`npm audit` 維持 4 項 low。


- 後端啟動正常，`GET /api/health` 回 `{"status":"ok"}`。
- `PUT /api/fs/upload` 上傳 60 MB：成功，MD5 與原檔一致；後端 RSS 僅增加約 10 MB
  （修正前會增加約等於檔案大小的記憶體）。
- 130 MB 上傳：成功。
- 上傳中途由客戶端斷線（`curl --limit-rate` 3 秒後中止）：伺服器持續正常運作，
  且**不再留下半截檔案**。
- 表單上傳（`POST /api/fs/upload`，multipart）：成功。

---

## 三、簡體中文 → 正體中文

- 以 OpenCC `s2twp`（臺灣正體＋用語）轉換 **651 個檔案**：後端原始碼／註解／API 訊息、
  前端 `.vue`／`.js`、i18n 語系檔、Docker 設定、`README_zh-TW.md`、API 文件等。
  已排除第三方 vendor（`frontend/public/assets/**`、`frontend/public/libarchive.js`）。
- 語系目錄 `frontend/src/i18n/locales/zh-CN/` → **`zh-TW/`**。
- 網頁語言標識 `zh-CN` → **`zh-TW`**：
  - `frontend/index.html` `<html lang="zh-TW">`
  - `frontend/public/manifest.json` `"lang": "zh-TW"`
  - `frontend/vite.config.js` PWA manifest `lang`
  - `frontend/src/i18n/index.js`（locale key、fallbackLocale、瀏覽器語言偵測）
  - `frontend/src/components/LanguageSwitcher.vue`、`frontend/src/utils/timeUtils.js`
  - `frontend/src/composables/uppy/useUppyCore.js`、`UppyPluginManager.js`
    （改為 `zh*` 皆視為中文，較寬鬆）
  - `frontend/src/components/paste-view/preview/HtmlPreviewModal.vue` 預覽頁 `lang`
  - `backend/src/utils/httpMasquerade.js` `Accept-Language: zh-TW,...`
- **外部套件語系**：`@uppy/locales` 與 `cronstrue` 均內建 `zh_TW`，已改用正體中文語系；
  Vditor 介面文案改以 `lang: "zh_TW"` 載入 `assets/vditor/.../i18n/zh_TW.js`。

---

## 四、部署注意事項

1. `.env`／`docker-compose.yml` 的 `BACKEND_URL` 建議填寫不含結尾斜線的完整網址。
2. 反向代理請套用上方 `/api` 的上傳設定，否則大檔案仍可能被代理層攔截。
3. 若使用自訂前端設定，可加入 `window.appConfig.uploadTimeoutMs = 0;` 完全停用上傳逾時。
   若不想改前端，可改用環境變數 `UPLOAD_TIMEOUT_MS`（毫秒，`0` 表示不限，容器啟動時注入到 `config.js`）。
4. 前端可執行 `npm test` 驗證上傳逾時相關邏輯（vitest）。
5. 本專案 `sqlite3@6` 的預編譯檔需要較新的 glibc；官方 `node:22-alpine` 映像（musl）
   會取得對應的預編譯檔，不受影響。若在很舊的 glibc 主機上以裸機安裝，可能需自行編譯。

---

## 五、建置驗證

前端已在實際環境完整跑過 `vite build`：

```
vite v5.4.19 building for production...
✓ 1217 modules transformed.
...
✓ built in 4m 8s

PWA v1.3.0
mode      generateSW
precache  591 entries (40206.35 KiB)
files generated
  dist/sw.js
  dist/workbox-2ed0ca99.js
```

產出 `dist/`（約 44 MB，154 個 assets chunk），`index.html` 為 `<html lang="zh-TW">`、
`manifest.webmanifest` 為 `"lang":"zh-TW"`，i18n 語系鍵與正體中文文案均已進入 bundle。

> 註：本機可用記憶體約 2.1 GB（機器總量 3.9 GB），**含 esbuild 壓縮的
> `npm run build`**（預設 minify）在最後的壓縮階段會被 OOM Killer 終止——
> 該階段需要額外約 0.4 GB 的 esbuild 子行程，總需求超過可用記憶體。
> 上述驗證是以 `vite build --minify false` 執行（轉譯、打包、PWA 產生全部相同，
> 僅省略壓縮）。在 8 GB 以上的機器直接執行 `npm ci && npm run build` 即可正常完成。

其他靜態檢查（全部通過）：477 個 `.js` 檔 `node --check`、167 個 `.vue` 檔以
`@vue/compiler-sfc` 解析與編譯、i18n 語系鍵對齊、`manifest.json` / `package.json` JSON 合法。

## 六、專案更名（CloudPaste → CloudHarbor）

原專案已停止維護，本版以新名稱 **CloudHarbor**（slug `cloudharbor`）重新發佈。

- 文字替換：`CloudPaste` → `CloudHarbor`、`cloudpaste` → `cloudharbor`，
  共 **104 個檔案**（含變數名 `cloudPasteLightTheme` → `cloudHarborLightTheme`、
  localStorage 鍵、CSS class `pswp__cloudharbor-caption`、User-Agent、
  資料庫檔名 `cloudharbor.db`、Docker 映像／網路名、Cloudflare 資源名等）。
- 檔名重命名：`cloudpaste.svg` → `cloudharbor.svg`、
  `Cloudpaste-Proxy.js` → `Cloudharbor-Proxy.js`、`.idea/cloudpaste.iml` → `.idea/cloudharbor.iml`。
- 套件／產品識別：`backend/package.json` name `cloudharbor-api`、
  前端標題／PWA manifest 名稱、後端預設站點標題與頁尾皆為 `CloudHarbor`。
- 對外連結：README 徽章、`git clone` 指令、Star History 與 Discord 驅動 `User-Agent` 統一指向
  `https://github.com/ozuijoy/cloudharbor`，Docker 映像為 `ozuijoy/cloudharbor-*`；
  `App.vue` 的 `githubUrl`、`AdminSidebar.vue` 的 `DOC_URL` 已填入本專案位址。
- 來源聲明：新增 `ATTRIBUTION.md`，載明衍生自 CloudPaste（Apache-2.0）、
  上游位址與本專案的四項改造；`LICENSE` 末尾同時保留兩段版權聲明。
- 更名工具：`rename_project.py`（含 `--check / --dry-run / --apply`，內建上游連結白名單）、
  `rename_project_stage2.py`、`rename_project_stage3.py`，可稽核／重跑。

驗證：`vite build --minify false` 仍為 exit 0（4m05s、1217 modules、PWA 591 筆）、
`npm test` 10 項全過、後端啟動後 `/api/health` OK 且資料庫檔為 `cloudharbor.db`、
`dist/` 內已無任何 `cloudpaste` 字串。

> ⚠️ 從舊版升級請注意持久化識別字變更（DB 檔名、localStorage 鍵、Docker 網路／映像、
> Cloudflare 資源名），詳見 `ATTRIBUTION.md` 的遷移對照表。

## 七、已知限制

- 前端仍有 4 項 low 等級 audit 警告（`deepmerge` 透由 `workbox-build` →
  `@rollup/plugin-node-resolve`，僅建置期使用，上游尚無修正版本）。
- `dist/` 內第三方 vendor（vditor、mobi reader）仍帶有 `zh-CN` 字串，屬套件自帶資源，
  未納入本次轉換範圍（不影響介面語言）。

## 八、交付內容修正（依回饋）

- `README.md` / `README_zh-TW.md`：`YOUR_GITHUB/YOUR_REPO`（15 處）、`YOUR_DOCKERHUB`（8 處）與
  失效的 `ling-drag0n/cloudharbor.git` clone 連結，全部改為實際倉庫 `ozuijoy/cloudharbor`；
  Contributors / Star History / Docker Pulls 徽章同步修正（含 `/graphs` 缺少斜線的舊錯誤）。
- 移除上游作者的贊助／收款碼區塊與 `images/PayQrcode.png`。
- `App.vue` 的 `githubUrl`、`AdminSidebar.vue` 的 `DOC_URL` 填入本專案位址。
- 從交付內容移除 `rename_project*.py`（3 檔）：僅為開發期一次性更名工具，非部署或執行所需。

## 九、命名一致性收尾（README / 語系識別碼）

- `README_CN.md` → **`README_zh-TW.md`**：檔名不再帶 `CN`。`README.md`、`README_zh-TW.md` 互相連結、
  `ATTRIBUTION.md`、`CHANGELOG-zhTW.md` 與 `AdminSidebar.vue` 的 `DOC_URL` 全部同步改指新檔名，
  語言切換標籤改為「繁體中文 / English」。
- 程式碼內的語系識別碼全面改為 `zh-TW` / `zh_TW`：
  - `@uppy/locales/lib/zh_CN` → `zh_TW`
  - `cronstrue` locale `zh_CN` → `zh_TW`（`ScheduledJobForm.vue`、`ScheduledJobFormContent.vue`）
  - Vditor `lang: "zh_TW"`（`VditorUnified.vue`、`AnnouncementModal.vue`、
    `FooterMarkdownRenderer.vue`、`MarkdownDisplay.vue`）
- 現況：專案內已無任何 `README_CN`、`zh_CN` 引用；僅 `node_modules` 與 Vditor 套件自帶的
  `i18n/zh_CN.js` 保留原樣（第三方資產，已不再被載入）。

## 十、交付前全面複查與收尾修正

- 修正簡繁誤轉：`zh-TW/admin/storage.js` 的「檔案會被髮送到」→「發送」。
- i18n 補齊：`zh-TW/admin/storage.js` 的 `display.onedrive.oauth_status.{authorized,missing}` 已與 en-US
  對齊（`✅ 已授權` / `⚠️ 未設定`）；比對後 zh-TW 只多不少。
- `frontend/.gitignore` 補 `dist`（原本只有 `dev-dist`，clone 後建置會留下未追蹤檔案）。
- 移除非部署檔案：`.idea/`（4 檔）與 `frontend/.vscode/`（1 檔）；其中 `.idea/.gitignore`
  原本仍是簡體中文。
- `frontend/package.json`、`frontend/package-lock.json` 套件名稱改為 `cloudharbor-frontend`
  （後端為 `cloudharbor-api`）。
- `wrangler.toml`、`wrangler.spa.toml`：Cloudflare Workflows 的 `name` 由 `job-workflow` 改為
  `cloudharbor-job-workflow`；`binding` 仍為 `JOB_WORKFLOW`，程式端無須修改（雲端既有 workflow
  需同步改名或讓其重新建立）。
- `UppyPluginManager.js` 的註解用語改寫，不再出現 `zh-CN` 字樣。
- 後端新增 `test/utils.test.js`（8 項，涵蓋 `utils/common.js` 與 `http/errors.js`），
  `npm test` 從「0 個測試」變成可實際驗證。

## 十一、上傳通道全面改為「能直連就直連」

**原則**：HuggingFace、OneDrive、Google Drive、S3 四個渠道預設由瀏覽器直連雲端供應商，
不經 Cloudflare Workers／後端中轉（Workers 有大請求與 CPU 限制，大檔必失敗）；
其餘渠道（WebDAV、本機儲存、Telegram、Discord、GitHub 等沒有預簽名/斷點續傳機制的）
維持後端代理。

### 11.1 HuggingFace（分片維持啟用，移除無用開關）

- LFS batch 固定宣告 `transfers: ["basic", "multipart"]`，HF 會依檔案大小自行回傳
  basic 或 multipart 指令；**分片功能預設啟用、且不提供關閉開關**（大檔沒有分片不可能成功）。
- 上一版曾加入的「只宣告 basic」開關、以及 `/api/fs/multipart/relay-part` 後端中轉端點，
  已全部移除（等於無用程式碼，且會讓大檔被迫走 Workers）。
- 前端保留兩項強化：
  - 分片遇到沒有 HTTP 狀態碼的網路層失敗（連線重置）時，會重新簽名後再試，
    而不是拿同一個失效 URL 連試三次。
  - 錯誤訊息附上目標主機名：`Upload failed (host)`，方便判斷是哪個端點被重置。

### 11.2 OneDrive（原本就是直連，修正標頭）

- OneDrive 的 `single_session` 會話本來就把 Graph 的 `uploadUrl` 回給前端直傳；
  但前端一律附加本站的 `Authorization: Bearer <CloudHarbor token>`，對 Graph 而言是無效憑證。
- 修正：前端只在 uploadUrl **同源（本站後端）** 時才附帶登入憑證；跨域直連時完全不送
  Authorization，避免 `401 InvalidAuthenticationToken`。

### 11.3 Google Drive（改為預設直連）

- 原本 `initializeFrontendMultipartUpload` 回傳 `/api/fs/multipart/upload-chunk`，
  由後端代傳到 Google；現改為預設回傳 Google 的 resumable session URL，
  瀏覽器以 `Content-Range` 直接 PUT（`session.channel = "direct"`）。
- `signMultipartParts`（斷點續傳重新整理）同步維持直連通道。
- 保留退路：儲存設定 `upload_channel: "proxy"` 或環境變數 `GD_UPLOAD_CHANNEL=proxy`
  可切回後端中轉（適用瀏覽器端被 CORS／網路策略限制的環境）。

### 11.4 S3

- 本來就是預簽名 URL 直連，無需修改；確認 `presignedUrls` 仍由後端簽發、
  瀏覽器直接 PUT 到 S3/R2。

**驗證**：後端 4 個改動檔 `node --check` 全過；`frontend` `vitest run` 10 項全過；
HuggingFace 以 mock 服務端到端（LFS batch → 分片 PUT → complete → commit）驗證分片流程正常。

### 11.5 大檔自動切換分片（修正 ERR_CONNECTION_RESET）

實際抓到的失敗請求為：

```
PUT https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/repos/...&x-id=PutObject
net::ERR_CONNECTION_RESET
uploadPartBytes → uploadSingleFile
```

`uploadSingleFile` 表示當時走的是「整檔一次 PUT」（presigned 單次上傳），不是分片。
`hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com` 在多數中國大陸／受限網路的連線上，
大檔案長時間上傳會被中間設備重置；一旦重置，單次 PUT 就是整檔白傳。

修正（`UppyUploadModal.vue`）：

- 上傳開始前檢查檔案大小，**超過 16MB 且驅動支援分片時，自動切換為分片上傳（直連）**；
  分片把大檔切成小請求，單片失敗只重試該片，不必整檔重來。
- 分片重試加入退避（800ms × 次數），避免連線被重置後立刻重試又被打斷。

**注意**：這是網路層限制，程式只能降低失敗機率（小分片 + 重試 + 續傳）；
若該網路對 `*.s3-accelerate.amazonaws.com` 直接封鎖，仍需要換網路或改用支援中轉的部署。

## 十二、大檔上傳全渠道複查（直連 + Workers 中轉）

逐一檢查 S3、HuggingFace、OneDrive、Google Drive、Telegram、Discord、WebDAV、本機、GitHub 的大檔上傳路徑，修正以下問題。

### 12.1 前端（所有分片渠道共用）

| 問題 | 影響渠道 | 修正 |
| --- | --- | --- |
| 「超過 16MB 自動切分片」實際沒生效：舊上傳外掛沒移除，新的 AwsS3 外掛因 id 重複安裝失敗，仍用整檔單次 PUT；中轉模式下甚至可能同時存在兩個上傳外掛 | S3、HuggingFace、OneDrive、Telegram、Discord… | `configureUploadMethod` 記錄每次安裝的外掛 id，切換前精準移除；`StorageAdapter.destroy()` 一併移除預初始化前處理器；切換失敗直接報錯不再默默沿用舊方式 |
| single_session（OneDrive / Google Drive 直連、Telegram / Discord / GD 中轉）**任何一次連線重置或 5xx 就整檔失敗**，完全沒有重試 | OneDrive、Google Drive、Telegram、Discord | 網路錯誤、408/416/429/5xx 一律指數退避重試（至少 6 次）；直連第三方時先向後端查詢上游已收到的位元組，**只補傳缺少的後半段**，已收到則直接視為成功 |
| Google Drive 直連中間分片回 `308 Resume Incomplete` 被當成錯誤 | Google Drive | 308 視為成功 |
| OneDrive / Google Drive 分片未設定 `getChunkSize`，前端切片大小與後端 `partSize` 不一致 → Content-Range 錯位 | OneDrive、Google Drive | 啟用分片預初始化，以後端回傳的 partSize 切片 |
| Telegram / Discord 前端分片大小可能與後端 clamp 後的值不同 → 分片編號錯位 | Telegram、Discord | 同上，啟用預初始化 |
| per_part_url 只重試 3 次、503 SlowDown 不重試 | S3、HuggingFace | 至少 6 次、指數退避（上限 15 秒）；408/429/5xx 同 URL 重送，網路錯誤重新簽名 |

### 12.2 後端

- **Google Drive 直連根本無法使用**：resumable session 在後端建立時沒帶瀏覽器 `Origin`，Google 不回 CORS 標頭，瀏覽器 PUT 全被擋。
  → `/api/fs/multipart/init` 把請求的 Origin 傳給驅動，建立 session 時帶上；拿不到 Origin 時自動改走後端中轉。
  通道記錄在 `upload_sessions.provider_meta`，續傳沿用同一通道（舊 session 預設中轉）。
- Google Drive 狀態查詢：`308` 沒有 `Range` 標頭代表已收到 0 位元組（原本回 null，續傳判斷失準）；同步回傳 `done` / `bytesUploaded`。
- **OneDrive 後端串流上傳 > 60MiB 必定失敗**（Graph 單次 PUT 上限 60MiB，原本整檔一次 PUT）
  → 新增 `uploadSessionChunked`：每段 10MiB（320KiB 對齊），邊讀邊傳、記憶體恆定，5xx/429 自動重試。
- OneDrive 前端分片 `partSize` 對齊 320KiB 且 ≤ 60MiB。
- **Node/Docker：串流 body 的 fetch 缺 `duplex: "half"` 直接 TypeError**（Google Drive 中轉、OneDrive、HF、GitHub…）
  → Node 入口安裝全域補丁（`src/utils/streamBody.js`）。
- **Workers 中轉：串流 PUT 一律變成 chunked 傳輸**，不少 WebDAV 服務（堅果雲、部分 nginx/Apache、Alist 等）與 Google 會回 411/400 或斷線
  → WebDAV、Google Drive 改用 `FixedLengthStream` 送出明確 Content-Length。
- Telegram：官方 Bot API 分片上限 clamp 到 20MB（getFile 只能下載 ≤20MB）；partCount 依實際 partSize 重算。
- Discord：未設定時預設分片改 8MB（剛好 10MiB 加表單開銷偶爾 413）；partCount 依實際 partSize 重算。

### 12.3 Workers 部署的已知限制（無法用程式解決）

- Cloudflare Workers 單一請求體上限：Free/Pro 100MB、Business 200MB、Enterprise 500MB。
  不支援分片的渠道（**WebDAV、本機、GitHub**）走 `PUT /api/fs/upload` 整檔經過 Worker，超過上限必失敗；
  這些渠道的大檔請改用 Docker/Node 部署，或改存到支援分片的渠道。
- Telegram / Discord / Google Drive（中轉）每片只有 5~20MB，經 Workers 沒有大小問題。
- S3 / HuggingFace / OneDrive / Google Drive（直連）不經 Workers。

### 驗證

- 前端 `vitest`：19 項全過（新增 `multipartRetry.spec.js` 9 項：308、斷點補傳、上游已收到、4xx 不重試、中轉重送、重新簽名、503 退避）。
- 後端 `node --test`：16 項全過（新增 `upload-channels.test.js` 8 項：分塊讀取、duplex 補丁、FixedLengthStream、OneDrive 130MiB 分段與 503 重試、GD Origin、308 狀態解析）。
- `vite build` 成功；`wrangler deploy --dry-run` 打包成功。
- 未在真實雲端帳號上實測（沙箱沒有各渠道憑證），部署後建議各渠道用 200MB 以上檔案實測一次。

## 十三、分享上傳（上傳即分享）HuggingFace 大檔改為分片直傳

回報的失敗來自**分享上傳頁**（`UppyShareUploader`），不是掛載目錄上傳：

```
PUT https://hf-hub-lfs-us-east-1.s3-accelerate.amazonaws.com/...&X-Amz-Expires=900&x-id=PutObject
net::ERR_CONNECTION_RESET（重試 3 次）→ 403 Forbidden
```

- 分享上傳原本對 HuggingFace 一律「整檔單次 PUT」，第十二節的「>16MB 自動分片」只作用在掛載目錄上傳。
- 整檔 PUT 在連線會被重置的網路上必定失敗；而且這個 URL 只有 15 分鐘效期（`X-Amz-Expires=900`），
  大檔傳超過 15 分鐘後再重試，URL 已過期 → 403。

修正：

- 後端 `POST /api/share/presign` 新增 `multipart: true`：向 HF LFS batch 宣告 `["basic","multipart"]`，
  回傳每片 presigned URL、`partSize`、`completionUrl`（HF 回 basic 時退化為單片）。
- 後端 `POST /api/share/commit` 新增 `multipart: { completionUrl, parts }`：先呼叫 HF completionUrl 合併分片，
  再照原流程登記到倉庫並建立分享記錄。completionUrl 只接受 HuggingFace 網域。
- 前端分享上傳：檔案 > 16MB 自動走分片（在 sha256 計算之後預先取得分片指令），每片失敗只重送該片（至少 6 次、指數退避）；
  上傳失敗後清掉舊的分片指令，重試時重新取得新 URL。
- 新增後端測試 `hf-share-multipart.test.js`（3 項）。

注意：如果所在網路對 `*.s3-accelerate.amazonaws.com` 連小分片也持續重置，仍會失敗，只能換網路／代理。
