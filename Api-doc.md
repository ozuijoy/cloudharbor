# CloudHarbor 後端服務 API 文件

## 目錄

- [1. 基礎資訊](#1-基礎資訊)
- [2. 基礎 API](#2-基礎-api)
- [3. 認證與授權 API](#3-認證與授權-api)
- [4. 系統管理 API](#4-系統管理-api)
- [5. 文字分享 API](#5-文字分享-api)
- [6. 檔案分享 API](#6-檔案分享-api)
- [7. 儲存配置 API](#7-儲存配置-api)
- [8. 掛載管理 API](#8-掛載管理-api)
- [9. 檔案系統 API (FS)](#9-檔案系統-api-fs)
- [10. 目錄元資訊 API (FS Meta)](#10-目錄元資訊-api-fs-meta)
- [11. WebDAV API](#11-webdav-api)
- [12. 代理與連結解析 API](#12-代理與連結解析-api)
- [13. 上傳相關 API](#13-上傳相關-api)
- [附錄](#附錄)

---

## 1. 基礎資訊

### 統一返回格式

所有 API 返回格式統一為：

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "success": true
}
```


### 認證方式

#### 1. 管理員認證

使用 Bearer Token 認證，需要在請求頭中新增：

```
Authorization: Bearer <admin_token>
```

管理員令牌透過 `/api/admin/login` 介面獲取。

#### 2. API 金鑰認證

使用 ApiKey 認證，需要在請求頭中新增：

```
Authorization: ApiKey <api_key>
```

API 金鑰由管理員在後臺建立，使用位標誌許可權系統，支援以下許可權型別：

**許可權位標誌值：**

- **1 (TEXT_SHARE)**: 文字分享許可權 - 允許建立/分享文字
- **2 (FILE_SHARE)**: 檔案分享許可權 - 允許建立/分享檔案
- **4 (TEXT_MANAGE)**: 文字管理許可權 - 允許列出/修改/刪除自己的文字分享
- **8 (FILE_MANAGE)**: 檔案管理許可權 - 允許列出/修改/刪除自己的檔案分享
- **256 (MOUNT_VIEW)**: 掛載頁檢視許可權 - 允許瀏覽掛載頁
- **512 (MOUNT_UPLOAD)**: 上傳許可權 - 允許上傳檔案和建立目錄
- **1024 (MOUNT_COPY)**: 複製許可權 - 允許複製檔案/目錄
- **2048 (MOUNT_RENAME)**: 重新命名許可權 - 允許重新命名檔案/目錄
- **4096 (MOUNT_DELETE)**: 刪除許可權 - 允許刪除檔案/目錄
- **65536 (WEBDAV_READ)**: WebDAV 讀取許可權 - 允許透過 WebDAV 讀取檔案（GET/PROPFIND 等）
- **131072 (WEBDAV_MANAGE)**: WebDAV 管理許可權 - 允許透過 WebDAV 管理檔案（PUT/DELETE/MKCOL 等）

**許可權組合示例：**

- `15` = TEXT_SHARE + TEXT_MANAGE + FILE_SHARE + FILE_MANAGE (1+2+4+8)
- `771` = 基礎許可權 + MOUNT_UPLOAD (1+2+256+512)
- `7939` = 除 WebDAV 外的所有許可權 (1+2+256+512+1024+2048+4096)
- `204559` = ALL_PERMISSIONS - 擁有所有許可權

**路徑限制：**

- **basic_path**: 路徑許可權限制 - 限制 API 金鑰使用者只能訪問指定路徑及其子路徑

#### 3. WebDAV 認證

WebDAV 支援兩種認證方式：

**Basic Auth（推薦）**

```
Authorization: Basic <base64(api_key:api_key)>
```

**Bearer Token**

```
Authorization: Bearer <api_key>
```

#### 4. 自定義授權頭

部分 API 還支援自定義授權頭：

```
X-Custom-Auth-Key: <api_key>
```

### 認證錯誤響應

認證失敗時返回統一的錯誤格式：

```json
{
  "code": 401,
  "message": "需要認證訪問",
  "success": false
}
```

許可權不足時返回：

```json
{
  "code": 403,
  "message": "許可權不足",
  "success": false
}
```

---

## 2. 基礎 API

### 健康檢查

- `GET /api/health`
  - 描述：API 健康檢查端點，用於監控服務狀態
  - 授權：無需授權
  - 響應：
    ```json
    {
      "status": "ok",
      "timestamp": "2023-05-01T12:00:00Z"
    }
    ```

### 版本資訊

- `GET /api/version`
  - 描述：獲取系統版本資訊
  - 授權：無需授權
  - 響應：包含版本號、應用名稱、執行環境、儲存型別、Node.js 版本和執行時間的系統資訊
    ```json
    {
      "code": 200,
      "message": "獲取版本資訊成功",
      "data": {
        "version": "0.8.1",
        "name": "cloudharbor-api",
        "environment": "Docker",
        "storage": "SQLite",
        "nodeVersion": "v18.17.0",
        "uptime": 3600
      },
      "success": true
    }
    ```

### 遊客配置

- `GET /api/public/guest-config`
  - 描述：用於前端獲取 Guest API 金鑰配置，支援"遊客模式"登入
  - 授權：無需授權
  - 響應：
    ```json
    {
      "code": 200,
      "message": "遊客配置獲取成功",
      "success": true,
      "data": {
        "enabled": true,
        "key": "guest",
        "name": "guest",
        "permissions": 768,
        "permissions_detail": {
          "text_share": true,
          "file_share": true,
          "mount_view": true
        },
        "basic_path": "/public",
        "expires_at": "9999-12-31T23:59:59Z"
      }
    }
    ```

---

## 3. 認證與授權 API

### 管理員登入

- `POST /api/admin/login`
  - 描述：管理員登入
  - 授權：無需授權
  - 請求體：
    ```json
    {
      "username": "管理員使用者名稱",
      "password": "管理員密碼"
    }
    ```
  - 響應：
    ```json
    {
      "code": 200,
      "message": "登入成功",
      "data": {
        "username": "admin",
        "token": "abc123def456...",
        "expiresAt": "2025-01-28T10:30:45.123Z"
      }
    }
    ```

### 管理員登出

- `POST /api/admin/logout`
  - 描述：管理員登出
  - 授權：需要管理員令牌
  - 響應：登出結果

### 修改密碼

- `POST /api/admin/change-password`
  - 描述：管理員修改密碼
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "currentPassword": "當前密碼",
      "newPassword": "新密碼",
      "newUsername": "新使用者名稱"
    }
    ```
  - 響應：修改結果

### 令牌測試

- `GET /api/test/admin-token`
  - 描述：測試管理員令牌有效性
  - 授權：需要管理員令牌
  - 響應：
    ```json
    {
      "code": 200,
      "message": "令牌有效",
      "success": true
    }
    ```

- `GET /api/test/api-key`
  - 描述：測試 API 金鑰有效性
  - 授權：需要有效的 API 金鑰
  - 響應：
    ```json
    {
      "code": 200,
      "message": "API金鑰驗證成功",
      "data": {
        "name": "金鑰名稱",
        "basic_path": "/",
        "permissions": {
          "text": true,
          "file_share": true,
          "mount_view": true
        }
      },
      "success": true
    }
    ```

### API 金鑰管理

#### 獲取金鑰列表

- `GET /api/admin/api-keys`
  - 描述：獲取所有 API 金鑰列表
  - 授權：需要管理員令牌
  - 響應：API 金鑰列表，包含每個金鑰的許可權和使用情況

#### 建立金鑰

- `POST /api/admin/api-keys`
  - 描述：建立新的 API 金鑰
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "name": "金鑰名稱",
      "permissions": 7,
      "role": "GENERAL",
      "basic_path": "/",
      "is_guest": false,
      "expires_at": "2023-12-31T23:59:59Z",
      "custom_key": "custom-api-key-123"
    }
    ```
  - 響應：新建立的 API 金鑰資訊，包含完整的金鑰值（僅在建立時返回）

#### 更新金鑰

- `PUT /api/admin/api-keys/:id`
  - 描述：更新 API 金鑰
  - 授權：需要管理員令牌
  - 引數：id - 金鑰 ID
  - 請求體：與建立介面類似，所有欄位均為可選
  - 響應：更新後的金鑰資訊

#### 刪除金鑰

- `DELETE /api/admin/api-keys/:id`
  - 描述：刪除 API 金鑰
  - 授權：需要管理員令牌
  - 引數：id - 金鑰 ID
  - 響應：刪除結果

#### 獲取儲存 ACL

- `GET /api/admin/api-keys/:id/storage-acl`
  - 描述：獲取指定 API 金鑰的儲存 ACL 白名單
  - 授權：需要管理員令牌
  - 引數：id - 金鑰 ID
  - 響應：
    ```json
    {
      "code": 200,
      "message": "獲取儲存 ACL 成功",
      "data": {
        "subject_type": "API_KEY",
        "subject_id": "金鑰ID",
        "storage_config_ids": ["config-id-a", "config-id-b"]
      },
      "success": true
    }
    ```

#### 更新儲存 ACL

- `PUT /api/admin/api-keys/:id/storage-acl`
  - 描述：整體更新指定 API 金鑰的儲存 ACL 白名單
  - 授權：需要管理員令牌
  - 引數：id - 金鑰 ID
  - 請求體：
    ```json
    {
      "storage_config_ids": ["config-id-a", "config-id-b"]
    }
    ```
  - 響應：更新後的儲存 ACL 資訊

---

## 4. 系統管理 API

### 系統設定

#### 獲取系統設定

- `GET /api/admin/settings`
  - 描述：獲取系統設定（支援按分組查詢或獲取所有分組）
  - 授權：無需授權（公開訪問）
  - 查詢引數：
    - `group` - 分組 ID（可選）：1=全域性設定，3=WebDAV 設定
    - `metadata` - 是否包含後設資料（可選，預設 true）
    - `includeSystem` - 是否包含系統內部分組（可選，預設 false）
  - 響應：按分組返回設定列表或所有分組的設定

#### 獲取分組列表

- `GET /api/admin/settings/groups`
  - 描述：獲取分組列表和統計資訊
  - 授權：需要管理員令牌
  - 響應：分組資訊列表

#### 獲取設定後設資料

- `GET /api/admin/settings/metadata`
  - 描述：獲取設定項後設資料
  - 授權：需要管理員令牌
  - 查詢引數：
    - `key` - 設定鍵名（必填）
  - 響應：設定項的詳細後設資料

#### 批次更新設定

- `PUT /api/admin/settings/group/:groupId`
  - 描述：按分組批次更新設定
  - 授權：需要管理員令牌
  - 引數：groupId - 分組 ID
  - 查詢引數：
    - `validate` - 是否進行型別驗證（可選，預設 true）
  - 請求體：設定鍵值對
    ```json
    {
      "max_upload_size": 200,
      "default_paste_expiry": 14
    }
    ```
  - 響應：批次更新結果

#### 獲取最大上傳大小

- `GET /api/system/max-upload-size`
  - 描述：獲取系統允許的最大上傳檔案大小（公共 API）
  - 授權：無需授權
  - 響應：
    ```json
    {
      "code": 200,
      "message": "獲取最大上傳大小成功",
      "data": {
        "max_upload_size": 100
      },
      "success": true
    }
    ```

### 儀表盤統計

- `GET /api/admin/dashboard/stats`
  - 描述：獲取管理員儀表盤統計資料
  - 授權：需要管理員令牌
  - 響應：系統統計資料，包含文字和檔案使用情況、使用者活躍度和系統效能指標

### 快取管理

#### 獲取快取統計

- `GET /api/admin/cache/stats`
  - 描述：獲取系統監控資訊，包括快取統計和系統記憶體資訊
  - 授權：需要管理員令牌
  - 響應：快取統計和系統資訊

#### 清理快取（管理員）

- `POST /api/admin/cache/clear`
  - 描述：清理系統快取（支援目錄快取、URL 快取和搜尋快取）
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "mountId": "掛載點ID",
      "storageConfigId": "儲存配置ID"
    }
    ```
  - 響應：清理結果

#### 清理快取（使用者）

- `POST /api/user/cache/clear`
  - 描述：API 金鑰使用者清理快取（僅限其許可權範圍內的快取）
  - 授權：需要有掛載許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "mountId": "掛載點ID",
      "cacheType": "all"
    }
    ```
  - 響應：清理結果

### FS 搜尋索引管理（管理員）

> 說明：FS 搜尋為 Index-only（不做實時遍歷兜底）。
>
> - `scope=global`：僅搜尋 **索引狀態為 ready 的掛載點**；未就緒/不想索引/暫不可索引的掛載點會被跳過（不會阻塞全域性搜尋），並透過 `indexPartial/skippedMounts` 返回結構化資訊。
> - `scope=mount|directory`：目標掛載點索引未就緒時，返回 `indexReady=false` + `hint`，不返回“看似完整但實際不完整”的結果。

#### 獲取索引狀態

- `GET /api/admin/fs/index/status`
  - 描述：獲取每個掛載點的索引狀態，並返回當前執行中的索引重建作業（若存在）
  - 授權：需要管理員令牌
  - 響應欄位補充：
    - `dirtyCount`：該掛載點待消費的 dirty 條目數（用於判斷是否需要 apply-dirty）
    - `recommendedAction`：後端建議動作（僅建議，不會自動執行）
      - `none`：無需操作
      - `wait`：索引作業執行中，建議等待
      - `apply-dirty`：建議觸發增量應用
      - `rebuild`：建議觸發全量重建
    - `recommendedReason`：建議原因（可選）
      - `indexing` / `index_not_ready` / `dirty_pending` / `dirty_too_large`
  - 響應 hints：
    - `hints.minQueryLength`：索引搜尋最小字元數（當前為 3，trigram contains）
    - `hints.dirtyRebuildThreshold`：dirty 條目過大時建議 rebuild 的閾值（當前為 5000）

#### 觸發索引重建（全量）

- `POST /api/admin/fs/index/rebuild`
  - 描述：建立 `fs_index_rebuild` 非同步作業，遍歷掛載點並重建索引
  - 授權：需要管理員令牌
  - 請求體（可選）：
    ```json
    {
      "mountIds": ["mountId1", "mountId2"],
      "options": { "batchSize": 200, "maxDepth": null, "maxMountsPerRun": null }
    }
    ```

#### 取消索引重建

- `POST /api/admin/fs/index/stop`
  - 描述：取消索引重建作業
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    { "jobId": "fs_index_rebuild_xxx" }
    ```

#### 清空索引（派生資料）

- `POST /api/admin/fs/index/clear`
  - 描述：清空索引派生資料（entries/state/dirty/fts），並將索引視為未就緒（需重建）
  - 授權：需要管理員令牌
  - 請求體（可選）：
    ```json
    { "mountIds": ["mountId1", "mountId2"] }
    ```

#### 應用增量更新（dirty）

- `POST /api/admin/fs/index/apply-dirty`
  - 描述：建立 `fs_index_apply_dirty` 非同步作業，消費 dirty 佇列以更新索引
  - 授權：需要管理員令牌
  - 請求體（可選）：
    ```json
    {
      "mountIds": ["mountId1", "mountId2"],
      "options": { "batchSize": 200, "maxItems": null, "rebuildDirectorySubtree": true, "maxDepth": null }
    }
    ```

### 備份與還原

#### 建立備份

- `POST /api/admin/backup/create`
  - 描述：建立系統資料備份
  - 授權：需要管理員令牌
  - 說明：
    - FS 搜尋索引（`fs_search_index_*`）屬於派生資料，備份預設排除；恢復後需管理員觸發重建。
    - D1/SQLite 的 FTS5 虛表不適合依賴 export/import 作為事實來源，建議按“可重建索引”策略運維。
  - 請求體：
    ```json
    {
      "backup_type": "full",
      "selected_modules": []
    }
    ```
  - 響應：備份檔案（JSON格式），透過 Content-Disposition 頭觸發下載

#### 還原備份

- `POST /api/admin/backup/restore`
  - 描述：從備份檔案還原系統資料
  - 授權：需要管理員令牌
  - 請求體：FormData 格式
    - `backup_file` - 備份檔案（必填）
    - `mode` - 還原模式（可選，預設 overwrite）
  - 響應：還原結果
  - 響應欄位補充：
    - `integrity_issues`：資料完整性問題列表（warning 級別，用於前端“操作日誌”展示；不一定會阻斷 restore）

#### 還原預檢查

- `POST /api/admin/backup/restore/preview`
  - 描述：對備份檔案做“預檢查/預估”，**不會寫入資料庫**；用於避免 overwrite 先清表後失敗
  - 授權：需要管理員令牌
  - 請求體：FormData 格式
    - `backup_file` - 備份檔案（必填）
    - `mode` - 還原模式（可選，預設 overwrite）
    - `skipIntegrityCheck` - 是否跳過跨表依賴檢查（可選，預設 false）
    - `preserveTimestamps` - 是否保留時間戳（可選，預設 false）
  - 響應欄位（關鍵）：
    - `ok`：是否透過（true/false）
    - `preview.issues`：問題列表（level=error 時不建議繼續 restore）
    - `preview.plan.estimated`：預估語句數/批次數（用於判斷大備份耗時）

#### 獲取備份模組

- `GET /api/admin/backup/modules`
  - 描述：獲取可備份的模組列表和資訊
  - 授權：需要管理員令牌
  - 響應：模組資訊列表

### 排程與定時任務（管理員）

#### 獲取排程任務型別（Handler Types）

- `GET /api/admin/scheduled/types`
  - 描述：列出所有可用的定時任務處理器型別（可用於前端下拉/配置引導）
  - 授權：需要管理員令牌
  - 響應：`{ items: [...] }`

- `GET /api/admin/scheduled/types/:taskId`
  - 描述：獲取單個處理器型別詳情
  - 授權：需要管理員令牌
  - 引數：taskId - 處理器型別 ID
  - 響應：處理器詳情

#### 排程作業管理

- `GET /api/admin/scheduled/jobs`
  - 描述：列出排程作業
  - 授權：需要管理員令牌
  - 查詢引數（可選）：
    - `taskId` / `task_id` - 僅返回指定 taskId 的作業
    - `enabled` - 過濾啟用狀態（true/false/1/0/yes/no/on/off）
  - 響應：`{ items: [...] }`

- `GET /api/admin/scheduled/jobs/:taskId`
  - 描述：獲取單個排程作業詳情
  - 授權：需要管理員令牌
  - 引數：taskId - 作業 ID

- `POST /api/admin/scheduled/jobs`
  - 描述：建立排程作業
  - 授權：需要管理員令牌
  - 請求體示例（欄位支援 camelCase 與 snake_case）：
    ```json
    {
      "taskId": "jobId-xxx",
      "handlerId": "handler-xxx",
      "name": "可選",
      "description": "可選",
      "scheduleType": "cron",
      "intervalSec": 60,
      "cronExpression": "*/5 * * * *",
      "enabled": true,
      "config": {}
    }
    ```
  - 響應：建立後的作業詳情

- `PUT /api/admin/scheduled/jobs/:taskId`
  - 描述：更新排程作業（請求體為“部分更新”，只傳需要改的欄位即可）
  - 授權：需要管理員令牌
  - 引數：taskId - 作業 ID

- `DELETE /api/admin/scheduled/jobs/:taskId`
  - 描述：刪除排程作業
  - 授權：需要管理員令牌
  - 引數：taskId - 作業 ID

#### 執行記錄與統計

- `GET /api/admin/scheduled/jobs/:taskId/runs`
  - 描述：獲取某個作業的執行記錄
  - 授權：需要管理員令牌
  - 引數：taskId - 作業 ID
  - 查詢引數（可選）：
    - `limit` - 返回條數（不傳則由後端決定預設值）
  - 響應：`{ items: [...] }`

- `GET /api/admin/scheduled/analytics`
  - 描述：獲取定時任務執行的按小時統計資料
  - 授權：需要管理員令牌
  - 查詢引數（可選）：
    - `windowHours` - 統計視窗（小時）

#### 平臺觸發器（Ticker）

- `GET /api/admin/scheduled/ticker`
  - 描述：獲取“外部觸發器”的狀態（用於管理面板顯示“預計下次觸發時間”）
  - 授權：需要管理員令牌
  - 響應欄位（關鍵）：
    - `runtime`: `cloudflare|docker`
    - `cron.active`: 當前用於計算 next 的 cron（優先使用 lastSeen；Docker 環境會回退到配置值/預設值）
    - `lastTick.ms/at`: 最近一次“真實觸發”的時間（來自 system_settings）
    - `nextTick.at`: 按 cron 規則算出來的“預計下次觸發時間”（注意：不保證精確到秒，平臺可能延遲）
  - 說明：
    - Cloudflare 環境在“首次真實觸發”之前可能無法計算 nextTick，會返回“等待首次觸發”的提示

#### 手動觸發一次

- `POST /api/admin/scheduled/jobs/:taskId/run`
  - 描述：立刻手動執行一次該任務，並寫入執行記錄（triggerType=manual）
  - 授權：需要管理員令牌
  - 引數：taskId - 作業 ID

---

## 5. 文字分享 API

### 建立文字分享

- `POST /api/paste`
  - 描述：建立新的文字分享
  - 授權：需要管理員令牌或有文字許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "content": "要分享的文字內容",
      "title": "文字標題",
      "remark": "備註資訊",
      "expires_at": "2023-12-31T23:59:59Z",
      "max_views": 100,
      "password": "訪問密碼",
      "slug": "custom-slug",
      "is_public": true
    }
    ```
  - 響應：建立的文字分享資訊，包含訪問連結

### 獲取文字分享

- `GET /api/paste/:slug`
  - 描述：獲取文字分享內容
  - 引數：slug - 文字短連結
  - 授權：無需授權（受 is_public、過期時間、最大檢視次數和密碼保護限制）
  - 響應：文字分享內容或元資訊（如設定了密碼）

- `POST /api/paste/:slug`
  - 描述：使用密碼獲取受保護的文字分享
  - 引數：slug - 文字短連結
  - 請求體：
    ```json
    {
      "password": "訪問密碼"
    }
    ```
  - 響應：驗證成功後返回文字分享內容

- `GET /api/raw/:slug`
  - 描述：獲取文字分享的原始內容（純文字格式）
  - 引數：slug - 文字短連結
  - 查詢引數：
    - `password` - 如果文字受密碼保護，需提供密碼
  - 響應：純文字格式的內容

### URL 代理（用於 SnapDOM useProxy）

> 背景：瀏覽器側的 `<img src>` / 資源請求通常無法攜帶 `Authorization` 請求頭。  
> 因此這裡用“短期 ticket”來讓前端能安全地代理拉取 URL 內容。

#### 簽發代理票據（ticket）

- `POST /api/paste/url/proxy-ticket`
  - 描述：簽發一個短期 ticket，供 `/api/paste/url/proxy` 使用
  - 授權：需要管理員令牌或具備文字建立許可權的 API 金鑰（pastes.create）
  - 響應示例：
    ```json
    {
      "ticket": "xxx",
      "expiresIn": 60,
      "expiresAt": "2025-12-20T12:00:00.000Z"
    }
    ```

#### 代理 URL 內容（帶 ticket）

- `GET /api/paste/url/proxy`
  - 描述：代理指定 URL 的內容（通常用於不支援 CORS 的資源）
  - 授權：無需 Authorization，但必須提供有效 ticket
  - 查詢引數：
    - `url` - 要代理的 URL（必填）
    - `ticket` - 代理票據（必填，由 `/api/paste/url/proxy-ticket` 獲取）
  - 響應：原始 URL 的內容流（Content-Type 由上游決定）

### 更新文字分享

- `PUT /api/pastes/:slug`
  - 描述：更新文字資訊
  - 授權：需要管理員令牌或有文字許可權的 API 金鑰
  - 引數：slug - 文字短連結
  - 請求體：
    ```json
    {
      "content": "更新後的文字內容",
      "title": "更新後的標題",
      "remark": "更新後的備註資訊",
      "expires_at": "2024-01-31T23:59:59Z",
      "max_views": 50,
      "password": "新密碼",
      "clearPassword": true,
      "newSlug": "new-slug",
      "is_public": false
    }
    ```
  - 響應：更新後的文字資訊

### 刪除文字分享

- `DELETE /api/pastes/batch-delete`
  - 描述：批次刪除文字
  - 授權：需要管理員令牌或有文字許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "ids": ["文字ID1", "文字ID2", "文字ID3"]
    }
    ```
  - 響應：批次刪除結果

### 查詢文字列表

- `GET /api/pastes`
  - 描述：獲取文字分享列表
  - 授權：需要管理員令牌或有文字許可權的 API 金鑰
  - 查詢引數：
    - `page` - 頁碼（管理員使用者）
    - `limit` - 每頁數量
    - `offset` - 偏移量（API 金鑰使用者）
    - `created_by` - 按建立者篩選（管理員使用者）
  - 響應：文字分享列表和分頁資訊

- `GET /api/pastes/:id`
  - 描述：獲取單個文字詳情
  - 授權：需要管理員令牌或有文字許可權的 API 金鑰
  - 引數：id - 文字 ID
  - 響應：文字分享詳細資訊

### 清理過期文字

- `POST /api/pastes/clear-expired`
  - 描述：清理過期文字（管理員專用）
  - 授權：需要管理員令牌
  - 響應：清理結果

---

## 6. 檔案分享 API

### 公共檔案查詢

- `GET /api/share/get/:slug`
  - 描述：獲取分享檔案公開資訊（控制面 JSON）
  - 引數：slug - 檔案短連結
  - 授權：無需授權
  - 響應：包含檔案基本資訊 + 語義明確的 `previewUrl`/`downloadUrl`/`linkType` 等欄位；若檔案需要密碼且未驗證，則 `previewUrl`/`downloadUrl` 為 null。

- `POST /api/share/verify/:slug`
  - 描述：驗證檔案訪問密碼（成功後返回同 GET 的公開檢視）
  - 引數：slug - 檔案短連結
  - 請求體：
    ```json
    {
      "password": "檔案密碼"
    }
    ```
  - 響應：驗證成功後返回包含 `previewUrl`/`downloadUrl` 的檔案資訊

### 檔案管理

#### 獲取檔案列表

- `GET /api/files`
  - 描述：獲取檔案列表
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `limit` - 每頁數量（預設 30）
    - `offset` - 偏移量（預設 0）
    - `created_by` - 按建立者篩選（管理員使用者）
  - 響應：檔案列表和分頁資訊

#### 獲取檔案詳情

- `GET /api/files/:id`
  - 描述：獲取單個檔案詳情
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 引數：id - 檔案 ID
  - 查詢引數（可選）：
    - `include=links` - 返回連結資訊（`previewUrl`/`downloadUrl`/`linkType`/`documentPreview`）
    - `links=true` - 相容寫法，等價 `include=links`
  - 響應：
    - 預設：僅返回檔案元資訊（不包含任何連結欄位）
    - `include=links` 時：在元資訊基礎上額外返回 `previewUrl`（預覽入口）、`downloadUrl`（下載入口）、`linkType`（direct/url_proxy/proxy）以及 `documentPreview`

#### 更新檔案資訊

- `PUT /api/files/:id`
  - 描述：更新檔案資訊
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 引數：id - 檔案 ID
  - 請求體：可包含 remark, slug, expires_at, max_views, password, use_proxy 等欄位
  - 響應：更新後的檔案資訊

#### 批次刪除檔案

- `DELETE /api/files/batch-delete`
  - 描述：批次刪除檔案
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "ids": ["檔案ID1", "檔案ID2"],
      "delete_mode": "both"
    }
    ```
  - 響應：批次刪除結果

### 檔案分享上傳

#### 預簽名分享上傳

- `POST /api/share/presign`
  - 描述：為"上傳即分享"生成預簽名上傳地址
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "filename": "檔名",
      "fileSize": 123456,
      "contentType": "video/mp4",
      "path": "/share/path",
      "storage_config_id": "uuid"
    }
    ```
  - 響應：預簽名上傳 URL 和相關資訊

- `POST /api/share/commit`
  - 描述：在預簽名 PUT 完成後，建立分享記錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "key": "物件儲存鍵",
      "storage_config_id": "uuid",
      "filename": "檔名",
      "size": 123456,
      "slug": "自定義短鏈",
      "password": "訪問密碼",
      "expires_in": 24,
      "max_views": 100
    }
    ```
  - 響應：完整的分享記錄

#### 表單分享上傳

- `POST /api/share/upload`
  - 描述：透過 multipart/form-data 上傳檔案並立即建立分享記錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - Content-Type：`multipart/form-data`
  - 表單欄位：file, storage_config_id, path, slug, remark, password, expires_in, max_views, use_proxy, original_filename, upload_id
  - 響應：建立好的分享記錄

#### 流式分享上傳

- `PUT /api/share/upload`
  - 描述：透過流式 PUT 上傳檔案並建立分享記錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求頭：
    - `Content-Type` - 檔案 MIME 型別
    - `Content-Length` - 檔案大小
    - `X-Share-Filename` - 檔名（必填）
    - `X-Share-Options` - base64(JSON) 的分享引數
  - 請求體：檔案原始位元組流
  - 響應：建立好的分享記錄

### 檔案分享內容訪問

- `GET /api/s/:slug`
  - 描述：Share 本地代理內容入口（等價 FS 的本地代理語義），用於同源預覽/下載
  - 引數：slug - 檔案短連結
  - 授權：無需授權（受密碼保護、過期時間、瀏覽次數限制）
  - 查詢引數：
    - `password` - 檔案密碼（檔案受密碼保護時必填）
    - `down` - 下載語義開關（`true`/`1` 表示下載；不傳或 `false` 表示預覽）
    - `mode` - 舊版相容引數（`attachment`/`download` 等價 `down=true`，`inline` 等價預覽；新程式碼不推薦使用）
  - 響應：同源 200 檔案內容流（始終後端代理，不做 302 外跳），支援 Range 斷點續傳/媒體流播放
  - 說明：直鏈 / url_proxy / Worker 等決策只體現在 `/api/share/get/:slug` 返回的 `previewUrl`/`downloadUrl`/`linkType` 上；`/api/s/:slug` 永遠走本地代理

- `GET /api/share/content/:slug`
  - 描述：分享檔案同源內容口（文字預覽/編碼檢測專用）
  - 引數：slug - 檔案短連結
  - 授權：無需授權（受密碼保護、過期時間、瀏覽次數限制）
  - 查詢引數：
    - `password` - 檔案密碼（檔案受密碼保護時必填）
  - 響應：同源 200 檔案內容流（預覽語義），支援 Range；不做 302 外跳

---

## 7. 儲存配置 API

### 儲存配置管理

#### 獲取儲存配置列表

- `GET /api/storage`
  - 描述：獲取儲存配置列表
  - 授權：需要管理員令牌或具有 `s3.config.read` 許可權的 API 金鑰
  - 查詢引數：
    - `page` - 頁碼（管理員）
    - `limit` - 每頁數量（管理員，預設 10）
  - 響應：儲存配置列表（管理員獲取全部，API 金鑰使用者僅獲取公開+ACL白名單內的配置）

#### 獲取儲存配置詳情

- `GET /api/storage/:id`
  - 描述：獲取指定儲存配置詳情
  - 授權：需要管理員令牌或具有許可權的 API 金鑰
  - 引數：id - 儲存配置 ID
  - 查詢引數：
    - `reveal` - `plain` / `masked`（僅管理員），控制金鑰欄位顯示方式
  - 響應：儲存配置詳情

#### 建立儲存配置

- `POST /api/storage`
  - 描述：建立新的儲存配置（管理員）
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "name": "配置名稱",
      "storage_type": "S3",
      "provider_type": "Cloudflare R2",
      "endpoint_url": "https://xxxx.r2.cloudflarestorage.com",
      "bucket_name": "my-bucket",
      "access_key_id": "ACCESS_KEY",
      "secret_access_key": "SECRET_KEY",
      "region": "auto",
      "path_style": false,
      "default_folder": "uploads/",
      "is_public": true,
      "total_storage_bytes": 10737418240
    }
    ```
  - 響應：新建立的儲存配置

#### 更新儲存配置

- `PUT /api/storage/:id`
  - 描述：更新儲存配置（管理員）
  - 授權：需要管理員令牌
  - 引數：id - 儲存配置 ID
  - 請求體：與建立介面類似，所有欄位均為可選
  - 響應：更新成功狀態

#### 刪除儲存配置

- `DELETE /api/storage/:id`
  - 描述：刪除儲存配置（管理員）
  - 授權：需要管理員令牌
  - 引數：id - 儲存配置 ID
  - 響應：刪除結果

#### 設定預設儲存

- `PUT /api/storage/:id/set-default`
  - 描述：設定預設儲存配置（管理員）
  - 授權：需要管理員令牌
  - 引數：id - 儲存配置 ID
  - 響應：設定結果

#### 測試儲存連線

- `POST /api/storage/:id/test`
  - 描述：測試儲存配置連線有效性（管理員）
  - 授權：需要管理員令牌
  - 引數：id - 儲存配置 ID
  - 響應：測試結果，包含連線狀態和詳細資訊

### 儲存型別能力查詢

#### 獲取儲存型別能力

- `GET /api/storage-types/:type/capabilities`
  - 描述：獲取指定儲存型別支援的能力列表及後設資料
  - 授權：需要管理員令牌或有掛載許可權的 API 金鑰
  - 引數：type - 儲存型別（如 S3、WEBDAV 等）
  - 響應：儲存型別的能力資訊

#### 獲取所有儲存型別

- `GET /api/storage-types`
  - 描述：獲取所有註冊的儲存型別及其能力與配置後設資料資訊
  - 授權：需要管理員令牌或有掛載許可權的 API 金鑰
  - 響應：所有儲存型別的後設資料列表

#### 獲取掛載點配置Schema

- `GET /api/mount-schema`
  - 描述：獲取掛載點表單的Schema定義，供前端動態渲染表單
  - 授權：需要管理員令牌
  - 響應：掛載點配置的JSON Schema

---

## 8. 掛載管理 API

### 掛載點管理

#### 獲取掛載點列表

- `GET /api/mount/list`
  - 描述：獲取掛載點列表
  - 授權：需要管理員令牌或有掛載許可權的 API 金鑰
  - 響應：掛載點列表和詳細資訊
  - 許可權說明：
    - 管理員使用者：返回所有掛載點（包括禁用的）
    - API 金鑰使用者：只返回 basic_path 許可權範圍內的活躍掛載點

#### 建立掛載點

- `POST /api/mount/create`
  - 描述：建立新的掛載點（僅管理員）
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "name": "掛載點名稱",
      "storage_type": "S3",
      "storage_config_id": "S3配置ID",
      "mount_path": "/mount-path",
      "remark": "掛載點備註",
      "is_active": true,
      "sort_order": 0,
      "cache_ttl": 300,
      "web_proxy": false,
      "webdav_policy": "302_redirect",
      "enable_sign": false,
      "sign_expires": null
    }
    ```
  - 響應：新建立的掛載點資訊

#### 更新掛載點

- `PUT /api/mount/:id`
  - 描述：更新掛載點資訊（僅管理員）
  - 授權：需要管理員令牌
  - 引數：id - 掛載點 ID
  - 請求體：包含需要更新的欄位，格式同建立
  - 響應：更新結果

#### 刪除掛載點

- `DELETE /api/mount/:id`
  - 描述：刪除掛載點（僅管理員）
  - 授權：需要管理員令牌
  - 引數：id - 掛載點 ID
  - 響應：刪除結果

---

## 9. 檔案系統 API (FS)

### 目錄瀏覽

- `GET /api/fs/list`
  - 描述：列出目錄內容
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 要列出內容的目錄路徑，預設為根目錄("/")
    - `path_token` - 路徑密碼驗證令牌（可選；等價請求頭 `X-FS-Path-Token`）
  - 請求頭（可選）：
    - `X-FS-Path-Token` - 路徑密碼驗證令牌（訪問受密碼保護的目錄時需要；也可用 `path_token` 傳遞）
  - 響應：目錄內容列表，包含檔案和子目錄資訊

### 檔案操作

#### 獲取檔案資訊

- `GET /api/fs/get`
  - 描述：獲取檔案資訊
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 檔案路徑
    - `path_token` - 路徑密碼驗證令牌（可選；等價請求頭 `X-FS-Path-Token`）
  - 請求頭（可選）：
    - `X-FS-Path-Token` - 路徑密碼驗證令牌（訪問受密碼保護的目錄時需要；也可用 `path_token` 傳遞）
  - 響應：檔案詳細資訊 + 語義明確的 `previewUrl`/`downloadUrl`/`linkType`/`documentPreview` 欄位

#### 下載檔案

- `GET /api/fs/download`
  - 描述：下載檔案（attachment 語義，優先外部入口）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 檔案路徑
    - `path_token` - 路徑密碼驗證令牌（可選；等價請求頭 `X-FS-Path-Token`）
  - 請求頭（可選）：
    - `X-FS-Path-Token` - 路徑密碼驗證令牌（訪問受密碼保護的目錄時需要；也可用 `path_token` 傳遞）
  - 響應：
    - 若可生成外部下載入口（直鏈 / url_proxy / 本地代理），返回 `302` 重定向到該 URL
    - 否則回退為同源 `200` 流式下載（支援 Range）

#### 獲取檔案內容（同源代理）

- `GET /api/fs/content`
  - 描述：同源返回 FS 檔案原始內容（預覽/文字編碼檢測專用，後端代理）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 檔案路徑（必填）
    - `path_token` - 路徑密碼驗證令牌（可選；等價請求頭 `X-FS-Path-Token`）
  - 請求頭（可選）：
    - `X-FS-Path-Token` - 路徑密碼驗證令牌（訪問受密碼保護的目錄時需要；也可用 `path_token` 傳遞）
  - 響應：同源 `200` 檔案內容流（預覽語義），支援 Range；不做 `302` 外跳

#### 獲取檔案直鏈

- `GET /api/fs/file-link`
  - 描述：獲取檔案外部訪問連結（直鏈 / url_proxy / 代理入口）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 檔案路徑（必填）
    - `expires_in` - 連結有效期（秒），預設為 604800（7 天）
    - `force_download` - 是否強制下載，true 或 false（預設 false）
    - `path_token` - 路徑密碼驗證令牌（可選；等價請求頭 `X-FS-Path-Token`）
  - 請求頭（可選）：
    - `X-FS-Path-Token` - 路徑密碼驗證令牌（訪問受密碼保護的目錄時需要；也可用 `path_token` 傳遞）
  - 響應：
    ```json
    {
      "url": "最終可訪問 URL",
      "linkType": "direct|url_proxy|proxy"
    }
    ```

#### 從檔案系統建立分享

- `POST /api/fs/create-share`
  - 描述：把一個 FS 檔案“轉換成分享連結”（不復制檔案，只建立分享記錄）
  - 授權：需要管理員令牌或有分享建立許可權的 API 金鑰（fs.share.create）
  - 請求體：
    ```json
    {
      "path": "/mount/path/file.ext"
    }
    ```
  - 響應：分享記錄（包含 slug 等資訊）

#### 建立目錄

- `POST /api/fs/mkdir`
  - 描述：建立目錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "要建立的目錄路徑"
    }
    ```
  - 響應：建立結果

#### 上傳檔案（流式）

- `PUT /api/fs/upload`
  - 描述：透過流式方式上傳檔案（推薦）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `path` - 目標檔案路徑（必填）
    - `upload_id` - 上傳進度 ID（可選）
  - 請求頭：
    - `Content-Type` - 檔案 MIME 型別
    - `Content-Length` - 檔案大小
    - `X-FS-Filename` - 檔名（可選）
    - `X-FS-Options` - base64(JSON) 編碼的上傳行為引數
  - 請求體：檔案原始位元組流
  - 響應：上傳結果

#### 上傳檔案（表單）

- `POST /api/fs/upload`
  - 描述：透過 multipart/form-data 表單上傳檔案
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：FormData 格式
    - `file` - 檔案內容（必填）
    - `path` - 上傳目標路徑（必填）
    - `upload_id` - 上傳進度 ID（可選）
    - `overwrite` - 是否覆蓋同名檔案（可選）
    - `original_filename` - 是否保留原始檔名（可選）
  - 響應：上傳結果

#### 更新檔案內容

- `POST /api/fs/update`
  - 描述：更新檔案內容或建立新檔案
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "檔案路徑",
      "content": "檔案內容"
    }
    ```
  - 響應：更新結果

#### 重新命名檔案

- `POST /api/fs/rename`
  - 描述：重新命名檔案或目錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "oldPath": "原路徑",
      "newPath": "新路徑"
    }
    ```
  - 響應：重新命名結果

#### 批次刪除

- `DELETE /api/fs/batch-remove`
  - 描述：批次刪除檔案或目錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "paths": ["路徑1", "路徑2", "..."]
    }
    ```
  - 響應：批次刪除結果

#### 批次複製

- `POST /api/fs/batch-copy`
  - 描述：批次複製檔案或目錄，建立非同步復製作業
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "items": [
        {
          "sourcePath": "源路徑1",
          "targetPath": "目標路徑1"
        }
      ],
      "skipExisting": false
    }
    ```
  - 響應：作業 ID 和初始狀態

### 搜尋

- `GET /api/fs/search`
  - 描述：搜尋檔案和目錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `q` - 搜尋關鍵詞（必填，至少 3 個字元）
    - `scope` - 搜尋範圍（可選，預設為"global"）：global / mount / directory
    - `mount_id` - 掛載點 ID（當 scope 為"mount"時必填）
    - `path` - 搜尋路徑（當 scope 為"directory"時必填）
    - `limit` - 結果數量限制（可選，預設 50，最大 200）
    - `cursor` - 分頁遊標（可選，不透明字串；由上一次響應的 `nextCursor` 提供）
  - 響應：搜尋結果列表（Index-only）
    - `indexReady`：是否存在可用索引並已執行索引檢索
      - `scope=global`：只要有至少一個 `ready` 掛載點即可為 true（未就緒掛載點會跳過）
      - `scope=mount|directory`：目標掛載點未 `ready` 時為 false
    - `indexPartial`：是否為“部分掛載點可搜尋”（僅 `scope=global` 可能為 true）
    - `searchableMountIds`：本次實際參與索引檢索的掛載點 ID 列表
    - `skippedMounts`：本次被跳過的掛載點資訊（僅 `scope=global` 返回非空）
      - `mountId`：掛載點 ID
      - `status`：索引狀態（ready/indexing/error/not_ready）
      - `reason`：跳過原因（當前固定為 `index_not_ready`）
    - `indexNotReadyMountIds`：索引未就緒的掛載點 ID 列表（相容欄位；`scope=global` 等同於 skippedMounts 的 mountId 集合）
    - `hint`：索引不可用時的提示資訊（引導管理員觸發重建）
    - `nextCursor`：下一頁遊標（為 null 表示無更多結果）

### 預簽名上傳

#### 獲取預簽名 URL

- `POST /api/fs/presign`
  - 描述：獲取預簽名上傳 URL
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "fileName": "檔名.jpg",
      "contentType": "檔案MIME型別",
      "fileSize": 1024000
    }
    ```
  - 響應：包含預簽名 URL 和上傳配置的物件

#### 提交預簽名上傳

- `POST /api/fs/presign/commit`
  - 描述：提交預簽名上傳，確認檔案上傳完成
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "targetPath": "上傳目標路徑",
      "mountId": "掛載點ID",
      "fileSize": 1024000
    }
    ```
  - 響應：檔案上傳完成狀態和檔案資訊

### 分片上傳

#### 初始化分片上傳

- `POST /api/fs/multipart/init`
  - 描述：初始化分片上傳
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "contentType": "檔案MIME型別",
      "filename": "檔名.jpg"
    }
    ```
  - 響應：初始化資訊，包含 uploadId 和其他後設資料

#### 上傳分片（中轉端點）

- `PUT /api/fs/multipart/upload-chunk`
  - 描述：前端分片上傳的“中轉端點”（主要用於 Google Drive resumable 會話）。瀏覽器把分片發到這裡，後端再轉發到上游。
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `upload_id` - 上傳會話 ID（必填）
  - 請求頭：
    - `Content-Range` - 分片範圍（必填）
    - `Content-Length` - 分片大小（建議）
  - 請求體：分片內容（二進位制）
  - 響應示例：
    ```json
    {
      "success": true,
      "done": false,
      "status": 200
    }
    ```

#### 完成分片上傳

- `POST /api/fs/multipart/complete`
  - 描述：完成分片上傳
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "uploadId": "分片上傳ID",
      "parts": [
        {
          "PartNumber": 1,
          "ETag": "分片1的ETag"
        }
      ],
      "key": "S3儲存鍵值"
    }
    ```
  - 響應：上傳完成結果

#### 中止分片上傳

- `POST /api/fs/multipart/abort`
  - 描述：中止分片上傳
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "uploadId": "分片上傳ID",
      "key": "S3儲存鍵值"
    }
    ```
  - 響應：中止結果

#### 列出進行中的分片上傳

- `POST /api/fs/multipart/list-uploads`
  - 描述：列出指定路徑下進行中的分片上傳
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "/uploads"
    }
    ```
  - 響應：進行中的分片上傳列表

#### 列出已上傳的分片

- `POST /api/fs/multipart/list-parts`
  - 描述：列出指定上傳任務已上傳的分片
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "uploadId": "upload-uuid-123",
      "fileName": "檔名.mp4"
    }
    ```
  - 響應：已上傳的分片列表

#### 重新整理分片上傳預簽名URL

- `POST /api/fs/multipart/refresh-urls`
  - 描述：重新整理指定分片的預簽名上傳URL（當URL過期時使用）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 請求體：
    ```json
    {
      "path": "上傳目標路徑",
      "uploadId": "upload-uuid-123",
      "partNumbers": [3, 4, 5]
    }
    ```
  - 響應：新的預簽名URL列表

### 作業系統

#### 獲取可用作業型別（給前端做下拉/能力發現）

- `GET /api/fs/job-types`
  - 描述：返回“當前使用者可見”的作業型別清單（用於前端動態展示可建立的任務）
  - 授權：需要管理員令牌或有掛載訪問許可權的 API 金鑰（fs.base）
  - 響應示例：
    ```json
    {
      "types": [
        {
          "taskType": "copy",
          "i18nKey": "fs.jobs.copy",
          "displayName": "複製",
          "category": "fs",
          "capabilities": []
        }
      ]
    }
    ```

#### 建立作業

- `POST /api/fs/jobs`
  - 描述：建立通用作業（任務佇列入口）
  - 授權：
    - `taskType=copy`：需要管理員令牌或有檔案許可權的 API 金鑰
    - `taskType=fs_index_rebuild`：僅管理員令牌（索引重建屬於管理員操作）
  - 請求體（推薦通用格式）：
    ```json
    {
      "taskType": "copy",
      "payload": {
        "items": [
          { "sourcePath": "源路徑1", "targetPath": "目標路徑1" }
        ],
        "options": { "skipExisting": false, "maxConcurrency": 10 }
      }
    }
    ```
  - 請求體（copy 相容格式，舊客戶端）：
    ```json
    {
      "taskType": "copy",
      "items": [
        {
          "sourcePath": "源路徑1",
          "targetPath": "目標路徑1"
        }
      ],
      "skipExisting": false,
      "maxConcurrency": 10
    }
    ```
  - 請求體（fs_index_rebuild，管理員）：
    ```json
    {
      "taskType": "fs_index_rebuild",
      "payload": {
        "mountIds": ["mountId1", "mountId2"],
        "options": { "batchSize": 200, "maxDepth": null, "maxMountsPerRun": null }
      }
    }
    ```
  - 響應：作業描述符

#### 獲取作業狀態

- `GET /api/fs/jobs/:jobId`
  - 描述：獲取指定作業的狀態和進度
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 引數：jobId - 作業 ID
  - 響應：作業狀態詳情

#### 取消作業

- `POST /api/fs/jobs/:jobId/cancel`
  - 描述：取消正在執行的作業
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 引數：jobId - 作業 ID
  - 響應：取消結果

#### 列出作業

- `GET /api/fs/jobs`
  - 描述：列出作業列表（支援篩選）
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 查詢引數：
    - `taskType` - 任務型別（可選）
    - `status` - 作業狀態（可選）
    - `limit` - 每頁數量（可選，預設 20）
    - `offset` - 偏移量（可選，預設 0）
  - 響應：作業列表

#### 刪除作業

- `DELETE /api/fs/jobs/:jobId`
  - 描述：刪除已完成或已取消的作業記錄
  - 授權：需要管理員令牌或有檔案許可權的 API 金鑰
  - 引數：jobId - 作業 ID
  - 響應：刪除結果

---

## 10. 目錄元資訊 API (FS Meta)

### 目錄配置管理

#### 獲取元資訊列表

- `GET /api/fs-meta/list`
  - 描述：獲取所有目錄元資訊配置列表
  - 授權：需要管理員令牌
  - 響應：目錄元資訊配置列表

#### 獲取單條元資訊

- `GET /api/fs-meta/:id`
  - 描述：獲取單條目錄元資訊配置
  - 授權：需要管理員令牌
  - 引數：id - 元資訊記錄 ID
  - 響應：元資訊配置詳情

#### 建立元資訊

- `POST /api/fs-meta/create`
  - 描述：為指定路徑建立新的目錄元資訊配置
  - 授權：需要管理員令牌
  - 請求體：
    ```json
    {
      "path": "/claw",
      "headerMarkdown": "# 目錄說明",
      "headerInherit": true,
      "footerMarkdown": "",
      "footerInherit": false,
      "hidePatterns": ["^README\\.md$"],
      "hideInherit": true,
      "password": "1234",
      "passwordInherit": true
    }
    ```
  - 響應：新建立的元資訊配置

#### 更新元資訊

- `PUT /api/fs-meta/:id`
  - 描述：更新指定 ID 的目錄元資訊配置
  - 授權：需要管理員令牌
  - 引數：id - 元資訊記錄 ID
  - 請求體：與建立介面類似，所有欄位均為可選
  - 響應：更新後的元資訊配置

#### 刪除元資訊

- `DELETE /api/fs-meta/:id`
  - 描述：刪除指定 ID 的目錄元資訊記錄
  - 授權：需要管理員令牌
  - 引數：id - 元資訊記錄 ID
  - 響應：刪除結果

### 路徑密碼驗證

- `POST /api/fs/meta/password/verify`
  - 描述：驗證目錄路徑密碼，獲取訪問令牌
  - 授權：無需授權（公開訪問）
  - 請求體：
    ```json
    {
      "path": "/protected/directory",
      "password": "directory-password"
    }
    ```
  - 響應：驗證成功後返回訪問令牌

---

## 11. WebDAV API

### WebDAV 訪問

- **WebDAV端點**: `/dav`
  - 描述：WebDAV 協議接入點，提供標準 WebDAV 協議訪問
  - 支援的 WebDAV 方法：
    - `GET` - 獲取檔案內容
    - `PUT` - 上傳檔案
    - `DELETE` - 刪除檔案
    - `PROPFIND` - 獲取檔案/目錄屬性
    - `PROPPATCH` - 修改屬性
    - `MKCOL` - 建立目錄
    - `COPY` - 複製檔案/目錄
    - `MOVE` - 移動檔案/目錄
    - `LOCK` - 鎖定資源
    - `UNLOCK` - 解鎖資源
  - 授權：基本 HTTP 認證（Basic Auth）或 Bearer 令牌認證
    - Basic Auth: 使用 API 金鑰（使用者名稱和密碼相同設定為 API 金鑰值）或管理員憑據
    - Bearer Auth: 使用 API 金鑰值或管理員令牌
  - 許可權要求：
    - 管理員賬戶：自動擁有所有操作許可權
    - API 金鑰：需要具有掛載許可權（mount_permission）

---

## 12. 代理與連結解析 API

### 統一儲存連結解析

- `POST /api/proxy/link`
  - 描述：統一儲存連結解析介面
  - 授權：支援管理員令牌、API 金鑰或匿名訪問
  - 請求體：
    ```json
    {
      "type": "fs",
      "path": "/mount/path/file.ext"
    }
    ```
    或
    ```json
    {
      "type": "share",
      "slug": "file-slug"
    }
    ```
  - 響應：
    ```json
    {
      "code": 200,
      "data": {
        "url": "https://storage.example.com/file.ext",
        "header": {
          "Authorization": ["Bearer token"],
          "Content-Type": ["application/octet-stream"]
        }
      }
    }
    ```
  - 說明：
    - `type = "fs"` - 使用 path 解析掛載檢視（包含 WebDAV）
    - `type = "share"` - 使用 slug 解析分享檢視
    - 反向代理/Proxy 服務呼叫此介面獲取 `{ url, header }`，然後直接向 url 發起請求

### 檔案系統代理訪問

- `GET /api/p/*`
  - 描述：檔案系統代理訪問路由（web_proxy 功能）
  - 路徑格式：`/api/p/mount/path/file.ext`
  - 授權：根據掛載點配置決定是否需要簽名驗證
  - 查詢引數：
    - `download` - 是否強制下載（可選，預設 false）
    - `sign` - 簽名引數（當掛載點啟用簽名時必填）
  - 響應：檔案內容流
  - 說明：
    - 專門用於 web_proxy 功能的檔案代理訪問
    - 支援 Range 請求，實現斷點續傳和影片流播放
    - 當掛載點配置 `enable_sign = true` 時，需要提供有效簽名
    - 簽名驗證失敗返回 401 Unauthorized
    - 所有訪問會記錄審計日誌

---

## 13. 上傳相關 API

### 上傳進度查詢

- `GET /api/upload/progress`
  - 描述：查詢指定上傳任務的進度
  - 授權：無需認證
  - 查詢引數：
    - `upload_id` - 上傳任務 ID（推薦）
    - `id` - 相容引數名，與 upload_id 等價
  - 響應：
    ```json
    {
      "code": 200,
      "message": "獲取上傳進度成功",
      "success": true,
      "data": {
        "id": "a4c0e0c8-7e6a-4f21-9a2b-123456789abc",
        "loaded": 25165824,
        "total": 47444227,
        "completed": false,
        "path": "/mount/path/file.webm",
        "storageType": "S3",
        "updatedAt": 1763964944868
      }
    }
    ```

### 直傳即分享（storage-first）

- `PUT /api/upload-direct/:filename`
  - 描述：把檔案資料直接上傳到儲存，並立刻建立分享記錄（一次請求完成“上傳 + 分享”）
  - 授權：需要管理員令牌或具備檔案建立許可權的 API 金鑰（files.create）
  - 路徑引數：
    - `filename` - 檔名（必填）
  - 查詢引數（可選，按需使用）：
    - `storage_config_id` - 指定儲存配置 ID
    - `path` - 指定儲存子路徑/目錄（不同儲存驅動含義可能不同）
    - `slug` - 自定義分享 slug
    - `remark` - 備註
    - `password` - 分享訪問密碼
    - `expires_in` - 過期時間（單位：小時）
    - `max_views` - 最大訪問次數
    - `override` - 是否覆蓋同名（true/false）
    - `use_proxy` - 是否使用代理模式（true/false）
    - `original_filename` - 是否保留原始檔名（true/false）
    - `upload_id` - 上傳進度 ID（可選，用於 `/api/upload/progress`）
  - 請求頭：
    - `Content-Type` - 檔案 MIME 型別（建議提供）
    - `Content-Length` - 檔案大小（建議提供）
  - 請求體：檔案原始位元組流
  - 響應：返回與 `/api/share/get/:slug` 對齊的“公開檔案資訊”（包含 `previewUrl` / `downloadUrl` / `linkType` / `documentPreview` 等欄位）

### URL 上傳

#### 驗證 URL 並獲取元資訊

- `POST /api/share/url/info`
  - 描述：驗證 URL 並獲取檔案元資訊
  - 授權：無需授權
  - 請求體：
    ```json
    {
      "url": "https://example.com/image.jpg"
    }
    ```
  - 響應：包含 URL 檔案的元資訊

#### 代理 URL 內容

- `GET /api/share/url/proxy`
  - 描述：代理 URL 內容，用於不支援 CORS 的資源
  - 授權：無需授權
  - 查詢引數：
    - `url` - 要代理的 URL（必填）
  - 響應：原始 URL 的內容流

---

## 附錄

### 錯誤處理

所有 API 在出錯時返回統一的錯誤格式：

```json
{
  "code": 400,
  "message": "錯誤描述",
  "success": false
}
```

**常見 HTTP 狀態碼：**

- `200` - 成功
- `201` - 建立成功
- `400` - 請求引數錯誤
- `401` - 未授權
- `403` - 許可權不足
- `404` - 資源不存在
- `409` - 資源衝突
- `410` - 資源已過期
- `500` - 伺服器內部錯誤

### 分頁引數

支援分頁的 API 通常使用以下引數：

- `limit` - 每頁數量，預設 30
- `offset` - 偏移量，預設 0
- `page` - 頁碼（部分 API 使用）

### 檔案上傳限制

- 最大檔案大小由系統設定決定，可透過 `/api/system/max-upload-size` 查詢
- 大檔案建議使用分片上傳或預簽名 URL 上傳
- API 金鑰使用者受 basic_path 路徑限制

### 快取機制

- 系統使用目錄快取提高效能
- 管理員和 API 金鑰使用者都可以手動清理快取
- 檔案操作會自動清理相關快取
- 搜尋結果會被快取 5 分鐘

---
