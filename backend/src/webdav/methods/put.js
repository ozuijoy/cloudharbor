/**
 * 處理WebDAV PUT請求
 * 用於上傳檔案內容
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEffectiveMimeType } from "../../utils/fileUtils.js";
import { withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { ValidationError } from "../../http/errors.js";
import { getSettingsByGroup } from "../../services/systemService.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

/**
 * 獲取WebDAV上傳模式設定
 * @param {D1Database} db - 資料庫例項
 * @returns {Promise<string>} 上傳模式 ('single' 或 'chunked')
 */
async function getWebDAVUploadMode(db) {
  try {
    // WebDAV設定組ID為3
    const settings = await getSettingsByGroup(db, 3, false);
    const uploadModeSetting = settings.find((setting) => setting.key === "webdav_upload_mode");
    const raw = uploadModeSetting ? uploadModeSetting.value : "chunked";
    // 僅接受 single / chunked，其它一律按 single 處理
    if (raw === "chunked") return "chunked";
    return "single";
  } catch (error) {
    console.warn("獲取WebDAV上傳模式設定失敗，使用預設值:", error);
    return "single";
  }
}

/**
 * 智慧檢測是否為真正的空檔案
 * @param {number} contentLength - Content-Length頭部值
 * @param {string|null} transferEncoding - Transfer-Encoding頭部值
 * @returns {boolean} 是否為真正的空檔案
 */
function isReallyEmptyFile(contentLength, transferEncoding) {
  // 如果Content-Length大於0，肯定不是空檔案
  if (contentLength > 0) {
    return false;
  }

  // 如果有Transfer-Encoding: chunked，不能僅依賴Content-Length判斷
  if (transferEncoding && transferEncoding.toLowerCase().includes("chunked")) {
    return false; // 分塊傳輸時，使用流式分片上傳
  }

  // Content-Length為0且沒有分塊傳輸，才是真正的空檔案
  return true;
}

/**
 * 處理PUT請求
 * @param {Object} c - Hono上下文
 * @param {string} path - 請求路徑
 * @param {string} userId - 使用者ID
 * @param {string} userType - 使用者型別 (admin 或 apiKey)
 * @param {D1Database} db - D1資料庫例項
 */
export async function handlePut(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("PUT", async () => {
    // 獲取加密金鑰
    const encryptionSecret = getEncryptionSecret(c);
    if (!encryptionSecret) {
      throw new ValidationError("缺少加密金鑰配置");
    }

    // 建立掛載管理器和檔案系統
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    // 在PUT時自動建立父目錄
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    if (parentPath && parentPath !== "/" && parentPath !== "") {
      try {
        console.log(`WebDAV PUT - 確保父目錄存在: ${parentPath}`);
        await fileSystem.createDirectory(parentPath, userId, userType);
        console.log(`WebDAV PUT - 父目錄已確儲存在: ${parentPath}`);
      } catch (error) {
        // 如果目錄已存在（409 Conflict），這是正常情況，繼續上傳
        if (error.status === 409 || error.message?.includes("已存在") || error.message?.includes("exists")) {
          console.log(`WebDAV PUT - 父目錄已存在，繼續上傳: ${parentPath}`);
        } else {
          // 其他錯誤（如許可權不足、儲存空間不足等）應該阻止上傳
          console.error(`WebDAV PUT - 建立父目錄失敗: ${error.message}`);
          throw error;
        }
      }
    }

    // 獲取WebDAV上傳模式設定
    const uploadMode = await getWebDAVUploadMode(db);
    console.log(`WebDAV PUT - 使用配置的上傳模式: ${uploadMode}`);

    // 檢查鎖定狀態
    const ifHeader = c.req.header("If");
    const lockConflict = checkLockPermission(lockManager, path, ifHeader, "PUT");
    if (lockConflict) {
      return new Response(lockConflict.message, {
        status: lockConflict.status,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 獲取請求頭資訊
    const contentLengthHeader = c.req.header("content-length");
    const clientContentType = c.req.header("content-type");
    const transferEncoding = c.req.header("transfer-encoding");
    const declaredContentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    // 智慧MIME型別檢測：優先使用檔名推斷，客戶端型別作為備選
    const contentType = getEffectiveMimeType(clientContentType, path);
    const filename = path.split("/").pop();

    // 使用智慧空檔案檢測（在獲取流之前先依賴頭部資訊判斷）
    const isEmptyFile = isReallyEmptyFile(declaredContentLength, transferEncoding);

    console.log(
      `WebDAV PUT - 開始處理: ${path}, 宣告大小: ${declaredContentLength} 位元組, 型別: ${contentType}, 空檔案: ${
        isEmptyFile ? "是" : "否"
      }`
    );

    if (isEmptyFile) {
      console.log(`WebDAV PUT - 確認為空檔案，使用FileSystem一次性上傳`);

      // 使用 FileSystem 上傳一個空檔案
      const emptyBody = new Uint8Array(0);
      const result = await fileSystem.uploadFile(path, emptyBody, userId, userType, {
        filename,
        contentType,
        contentLength: 0,
      });

      console.log(`WebDAV PUT - 空檔案上傳成功，ETag: ${result.etag}`);

      return new Response(null, {
        status: 201, // Created
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        }),
      });
    }

    // 對於非空檔案，必須拿到底層請求體流；這裡統一使用 raw.body，與 FS 流式上傳保持一致
    const bodyStream = c.req.raw?.body || null;
    if (!bodyStream) {
      throw new ValidationError("請求體為空");
    }

    // 直接使用原始流（WebDAV 客戶端通常是流式 PUT）
    const processedStream = bodyStream;

    // 對分塊傳輸強制使用 chunked 模式
    let finalUploadMode = uploadMode;
    if (transferEncoding && transferEncoding.toLowerCase().includes("chunked")) {
      finalUploadMode = "chunked";
      console.log(`WebDAV PUT - 檢測到分塊傳輸，強制使用分塊上傳模式`);
    }

    // 根據最終決定的上傳模式處理：
    // - single  ：按“表單/一次性”語義處理，先完整緩衝，再走驅動的表單上傳路徑
    // - chunked ：保持真正的流式上傳語義
    if (finalUploadMode === "single") {
      console.log(`WebDAV PUT - 使用單次上傳模式（一次性緩衝後上傳）`);

      try {
        // 將請求體完整讀入記憶體，作為“表單上傳”資料交給 FileSystem
        const buffer = await c.req.arrayBuffer();
        const body = new Uint8Array(buffer);
        const effectiveLength = body.byteLength;

        const startTime = Date.now();
        const result = await fileSystem.uploadFile(path, body, userId, userType, {
          filename,
          contentType,
          contentLength: effectiveLength,
        });
        const duration = Date.now() - startTime;

        const speedMBps = effectiveLength > 0 ? (effectiveLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";
        console.log(`WebDAV PUT - 單次上傳成功，用時: ${duration}ms，速度: ${speedMBps}MB/s，ETag: ${result.etag}`);

        return new Response(null, {
          status: 201, // Created
          headers: getStandardWebDAVHeaders({
            customHeaders: {
              "Content-Type": "text/plain",
              "Content-Length": "0",
              ETag: result.etag || "",
            },
          }),
        });
      } catch (error) {
        console.error(`WebDAV PUT - 單次上傳失敗: ${error.message}`);
        throw error;
      }
    } else {
      // 使用分塊上傳模式：保持真正的流式語義，直接傳遞 Web ReadableStream
      console.log(`WebDAV PUT - 使用分塊上傳模式（流式上傳）`);

      try {
        const startTime = Date.now();
        const result = await fileSystem.uploadFile(path, processedStream, userId, userType, {
          filename,
          contentType,
          contentLength: declaredContentLength,
        });
        const duration = Date.now() - startTime;

        const speedMBps = declaredContentLength > 0 ? (declaredContentLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";
        console.log(`WebDAV PUT - 分塊上傳成功，用時: ${duration}ms，速度: ${speedMBps}MB/s，ETag: ${result.etag}`);

        return new Response(null, {
          status: 201, // Created
          headers: getStandardWebDAVHeaders({
            customHeaders: {
              "Content-Type": "text/plain",
              "Content-Length": "0",
              ETag: result.etag || "",
            },
          }),
        });
      } catch (error) {
        console.error(`WebDAV PUT - 分塊上傳失敗: ${error.message}`);
        throw error;
      }
    }
  }, { includeDetails: true });
}

