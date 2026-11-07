# CloudHarbor 檔案伺服器直傳 API 介面文件

## 介面概述

`/api/upload-direct` 介面提供了一種簡單高效的方式，可以將檔案直接上傳到後端配置的物件儲存（如 S3 相容儲存、WebDAV 等具備寫入能力的儲存驅動）。該介面支援多種認證方式，並提供了豐富的引數控制檔案儲存和訪問方式。

## 請求方法

- **HTTP 方法**: `PUT`

## URL 格式

https://{域名}/api/upload-direct/{filename}

## 路徑引數

| 引數名   | 型別   | 必填 | 描述                                                                     |
| -------- | ------ | ---- | ------------------------------------------------------------------------ |
| filename | string | 是   | 要上傳的檔名，包括副檔名。此名稱用於確定檔案型別和生成安全的儲存路徑。 |

## 查詢引數

以下查詢引數可以附加到請求 URL 中:

| 引數名            | 型別   | 必填 | 預設值       | 描述                                                                                                     |
| ----------------- | ------ | ---- | ------------ | -------------------------------------------------------------------------------------------------------- |
| slug              | string | 否   | 自動生成     | 自定義短連結，用於訪問檔案。只能包含字母、數字、下劃線和橫槓。                                         |
| path              | string | 否   | 空           | 自定義路徑，檔案將儲存在這個路徑下。如果提供，會自動新增斜槓作為目錄路徑。                             |
| storage_config_id | string | 否   | 預設配置     | 指定儲存配置 ID。若不提供，系統選擇預設配置（API 金鑰使用者僅可使用公開配置）。                          |
| expires_in        | number | 否   | 0            | 檔案過期時間（小時）。0 表示永不過期。                                                                 |
| max_views         | number | 否   | 0            | 檔案最大檢視次數。0 表示無限制。                                                                       |
| remark            | string | 否   | 空           | 檔案備註資訊。                                                                                         |
| password          | string | 否   | 空           | 訪問密碼。設定後檔案在公共介面中需要密碼才能訪問；upload-direct 響應中始終返回 previewUrl/downloadUrl，便於受信任端使用。 |
| use_proxy         | string | 否   | 系統設定     | 是否使用代理訪問。未提供時按系統設定 `default_use_proxy` 決定（預設直鏈），傳 "1" 強制代理，傳 "0" 強制直鏈。 |
| override          | string | 否   | "false"      | 是否覆蓋同名 slug 的已存在檔案。"true"表示覆蓋，"false"表示不覆蓋。只能覆蓋自己建立的檔案。                  |
| original_filename | string | 否   | "false"      | 是否標記使用原始檔名。直傳場景下具體命名仍由系統策略決定，此引數主要作為後設資料標記。                         |
| upload_id         | string | 否   | 空           | 上傳會話 ID，用於支援續傳/分片等能力的儲存驅動複用同一上傳會話。                                       |

## 請求頭

| 頭名稱            | 必填 | 描述                                                                 |
| ----------------- | ---- | -------------------------------------------------------------------- |
| Content-Type      | 否   | 檔案的 MIME 型別。如果未提供或為通用型別，系統會根據副檔名推斷。 |
| Authorization     | 否\* | 授權頭，支援 Bearer 令牌或 ApiKey 認證。                             |
| X-Custom-Auth-Key | 否\* | 自定義授權金鑰，可用於 API 金鑰認證。                                |

\* 必須提供至少一種授權方式。

## 請求體

請求體應包含原始檔案內容。

## 返回資料

上傳成功後，伺服器將返回 JSON 格式的響應:

```json
{
  "code": 200,
  "message": "檔案上傳成功",
  "data": {
    "id": "file_xxxxx", // 檔案ID
    "slug": "example", // 檔案短連結
    "filename": "example.jpg", // 原始檔名
    "mimetype": "image/jpeg", // MIME型別
    "size": 12345, // 檔案大小(位元組)
    "remark": "示例檔案", // 備註資訊
    "created_at": "2023-01-01T12:00:00.000Z", // 建立時間(ISO格式)
    "requires_password": false, // 是否需要密碼
    "views": 0, // 當前檢視次數
    "max_views": null, // 最大檢視次數限制
    "expires_at": null, // 過期時間

    "previewUrl": "https://cdn.example.com/file/abcd12", // 最終可對外預覽入口（inline 語義；直鏈或基於 `/api/s/:slug` 的代理 URL）
    "downloadUrl": "https://cdn.example.com/file/abcd12", // 最終可對外下載入口（attachment 語義；可能與 previewUrl 相同）
    "linkType": "direct", // "direct" | "proxy" | "url_proxy"
    "use_proxy": 1, // 是否使用代理 (1=代理, 0=直接)
    "created_by": "admin:1" // 建立者資訊 (admin:ID 或 apikey:ID)
  },
  "success": true
}
```


## 授權方式

API 支援以下幾種授權方式:

### 1. Bearer 令牌授權 (管理員)

```
Authorization: Bearer {admin_token}
```

管理員令牌可以透過登入管理後臺獲取。

### 2. API 金鑰授權

```
Authorization: ApiKey {api_key}
```

API 金鑰可以在管理後臺建立。

### 3. 自定義授權頭

```
X-Custom-Auth-Key: {api_key}
```

與 API 金鑰授權相同，但使用自定義頭部。

## 錯誤處理

以下是可能的錯誤響應示例:

- **400 Bad Request**: 請求引數錯誤
- **401 Unauthorized**: 未授權
- **403 Forbidden**: 沒有許可權
- **409 Conflict**: 資源衝突，例如 slug 已存在
- **413 Payload Too Large**: 檔案過大
- **500 Internal Server Error**: 伺服器內部錯誤

錯誤響應格式:

```json
{
  "code": 400,
  "message": "錯誤資訊",
  "success": false
}
```

## 呼叫示例

### 基本上傳示例 (使用 curl)

```bash
curl -X PUT "https://your-domain.com/api/upload-direct/example.txt" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary "這是一個測試檔案內容"
```

### 帶自定義 slug 和密碼保護的上傳

```bash
curl -X PUT "https://your-domain.com/api/upload-direct/confidential.pdf?slug=secret-doc&password=your-password&expires_in=24" \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/local/file.pdf
```

### 使用 API 金鑰上傳圖片並設定檢視次數限制

```bash
curl -X PUT "https://your-domain.com/api/upload-direct/image.jpg?max_views=5&remark=一次性檢視圖片" \
  -H "X-Custom-Auth-Key: YOUR_API_KEY" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/image.jpg
```

### 使用原始檔名上傳檔案

```bash
curl -X PUT "https://your-domain.com/api/upload-direct/important-document.docx?original_filename=true" \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  --data-binary @/path/to/important-document.docx
```

## 注意事項

1. **流式上傳**: 後端統一使用流式上傳管線（`uploadStream`），支援大檔案和長連結上傳，不需要一次性將檔案讀入記憶體。
2. **預簽名 URL**: 返回的直接訪問 URL 是預簽名的，有效期由儲存配置的 `signature_expires_in` 設定，預設為 1 小時（具體取決於儲存型別與配置）。
3. **MIME 型別**: 如果未提供 Content-Type 或提供了通用型別（`application/octet-stream`），系統會根據副檔名推斷 MIME 型別。
4. **多儲存支援**: 只要儲存驅動具備寫入能力（WRITER）且支援流式上傳（`uploadStream`），即可透過此介面完成直傳。目前支援 S3 相容物件儲存、WebDAV 等。
5. **檔案覆蓋**: 使用 `override=true` 引數可以覆蓋已存在的同名 slug 檔案。只能覆蓋自己建立的檔案，覆蓋過程會刪除舊檔案並上傳新檔案，保持相同訪問連結。
6. **原始檔名**: 使用 `original_filename=true` 引數時，系統將使用原始檔名儲存檔案，不新增隨機字首。
7. **儲存空間限制**: 系統會檢查儲存配置的配額，如果上傳後會超出限制則拒絕上傳。
8. **許可權控制**: API 金鑰使用者只能使用公開的儲存配置，管理員可以使用自己建立的所有配置。
9. **路徑處理**: 如果提供了自定義路徑，系統會自動新增斜槓確保作為目錄路徑處理。
