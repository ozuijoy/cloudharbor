import { Hono } from "hono";
import { ValidationError } from "../http/errors.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { FileShareService } from "../services/fileShareService.js";
import { LinkService } from "../storage/link/LinkService.js";
import { getFileBySlug, getPublicFileInfo } from "../services/fileService.js";
import { useRepositories } from "../utils/repositories.js";
import { getQueryBool, getQueryInt, jsonOk } from "../utils/common.js";

const requireFilesCreate = usePolicy("files.create");

const router = new Hono();


const parseFormData = async (c, next) => {
  const formData = await c.req.formData();
  c.set("formData", formData);
  await next();
};

// “直傳即分享”（storage-first，S3 直傳）
router.put("/api/upload-direct/:filename", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const { filename } = c.req.param();
  if (!filename) {
    throw new ValidationError("缺少 filename 引數");
  }

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const bodyStream = c.req.raw?.body;
  if (!bodyStream) {
    throw new ValidationError("請求體為空");
  }

  const declaredLengthHeader = c.req.header("content-length");
  const declaredLength = declaredLengthHeader ? parseInt(declaredLengthHeader, 10) : 0;

  const storageConfigId = c.req.query("storage_config_id") || null;
  const uploadId = c.req.query("upload_id") || null;

  const shareParams = {
    storage_config_id: storageConfigId,
    path: c.req.query("path") || null,
    slug: c.req.query("slug") || null,
    remark: c.req.query("remark") || "",
    password: c.req.query("password") || null,
    expiresIn: getQueryInt(c, "expires_in", 0),
    maxViews: getQueryInt(c, "max_views", 0),
    override: getQueryBool(c, "override", false),
    useProxy: c.req.query("use_proxy") != null ? getQueryBool(c, "use_proxy", true) : undefined,
    originalFilename: getQueryBool(c, "original_filename", false),
    contentType: c.req.header("content-type") || undefined,
    request: c.req.raw,
  };

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.uploadDirectToStorageAndShare(
    filename,
    bodyStream,
    declaredLength,
    userIdOrInfo,
    userType,
    { ...shareParams, uploadId: uploadId || null }
  );

  // 對齊 /api/share/get/:slug：統一返回公開檔案資訊（含 previewUrl/downloadUrl/linkType/previewSelection），不再返回分享頁 URL
  // upload-direct 屬於受信任呼叫場景：
  // - 即使設定了密碼，這裡也視為“已透過校驗”，始終返回 preview/download 入口，方便呼叫方直接使用
  // - 對於代理模式（share 內容路由），自動在預覽/下載 URL 上附加 password 查詢引數
  try {
    const file = await getFileBySlug(db, result.slug, encryptionSecret);
    const hasPassword = !!file.password;
    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getShareExternalLink(file, null);
    const requestUrl = new URL(c.req.url);
    const publicInfo = await getPublicFileInfo(
      db,
      file,
      false,
      link,
      encryptionSecret,
      { baseOrigin: requestUrl.origin },
    );

    // 如果是代理模式且本次上傳提供了密碼，為預覽/下載 URL 附加 password 查詢引數
    let previewUrl = publicInfo.previewUrl || null;
    let downloadUrl = publicInfo.downloadUrl || null;
    const linkType = publicInfo.linkType || null;
    const password = shareParams.password || null;
    if (password && (linkType === "proxy" || file.use_proxy)) {
      if (previewUrl && !previewUrl.includes("password=")) {
        const separator = previewUrl.includes("?") ? "&" : "?";
        previewUrl = `${previewUrl}${separator}password=${encodeURIComponent(password)}`;
      }
      if (downloadUrl && !downloadUrl.includes("password=")) {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        downloadUrl = `${downloadUrl}${separator}password=${encodeURIComponent(password)}`;
      }
    }

    const response = {
      ...publicInfo,
      previewUrl,
      downloadUrl,
      requires_password: hasPassword,
    };

    return jsonOk(c, response, "檔案上傳成功");
  } catch (error) {
    // 兜底：生成公開資訊失敗時，返回基礎分享記錄但移除 url 欄位，避免洩露分享頁 URL
    console.warn("upload-direct: 生成公開檔案資訊失敗，將返回基礎分享記錄：", error);
    const { url, ...rest } = result || {};
    return jsonOk(c, rest, "檔案上傳成功");
  }
});

// 流式分享上傳：透過 PUT /api/share/upload 使用原始 body 直傳
router.put("/api/share/upload", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const bodyStream = c.req.raw?.body;
  if (!bodyStream) {
    throw new ValidationError("請求體為空");
  }

  const declaredLengthHeader = c.req.header("content-length");
  const declaredLength = declaredLengthHeader ? parseInt(declaredLengthHeader, 10) : 0;

  const filenameHeaderRaw = c.req.header("x-share-filename");
  if (!filenameHeaderRaw) {
    throw new ValidationError("缺少 x-share-filename 頭部");
  }

  let filenameHeader = filenameHeaderRaw;
  try {
    filenameHeader = decodeURIComponent(filenameHeaderRaw);
  } catch {
    // 解碼失敗時回退到原始值，避免影響相容性
    filenameHeader = filenameHeaderRaw;
  }

  let options = {};
  const optionsHeader = c.req.header("x-share-options");
  if (optionsHeader) {
    try {
      const decoded = Buffer.from(optionsHeader, "base64").toString("utf8");
      options = JSON.parse(decoded) || {};
    } catch {
      options = {};
    }
  }

  const storageConfigId = options.storage_config_id || null;
  const uploadId = options.upload_id || null;

  const shareParams = {
    storage_config_id: storageConfigId,
    path: options.path || null,
    slug: options.slug || null,
    remark: options.remark || "",
    password: options.password || null,
    expiresIn: Number(options.expires_in || 0),
    maxViews: Number(options.max_views || 0),
    override: false,
    useProxy: options.use_proxy !== undefined ? !!options.use_proxy : undefined,
    originalFilename: !!options.original_filename,
    contentType: c.req.header("content-type") || undefined,
    request: c.req.raw,
    uploadId: uploadId || null,
  };

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.uploadDirectToStorageAndShare(
    filenameHeader,
    bodyStream,
    declaredLength,
    userIdOrInfo,
    userType,
    shareParams
  );

  return jsonOk(c, result, "檔案上傳成功");
});

// 通用分享上傳：透過 ObjectStore + File，多儲存通用
router.post("/api/share/upload", requireFilesCreate, parseFormData, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const formData = c.get("formData");
  const file = formData.get("file");
  if (!file) {
    throw new ValidationError("缺少檔案引數");
  }

  const storageConfigId = formData.get("storage_config_id") || null;
  const path = formData.get("path") || null;
  const slug = formData.get("slug") || null;
  const remark = formData.get("remark") || "";
  const password = formData.get("password") || null;
  const expiresIn = Number(formData.get("expires_in") || 0);
  const maxViews = Number(formData.get("max_views") || 0);
  const useProxyRaw = formData.get("use_proxy");
  const originalFilenameRaw = formData.get("original_filename");
  const uploadId = formData.get("upload_id") || null;

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const shareParams = {
    storage_config_id: storageConfigId,
    path: path || null,
    slug: slug || null,
    remark,
    password,
    expiresIn,
    maxViews,
    override: false,
    useProxy:useProxyRaw === "true"? true: useProxyRaw === "false"? false: undefined,
    originalFilename: originalFilenameRaw === "true",
    contentType: file.type || undefined,
    request: c.req.raw,
    uploadId: uploadId || null,
  };

  const result = await shareService.uploadFileViaObjectStoreAndShare(
    file,
    userIdOrInfo,
    userType,
    shareParams
  );

  return jsonOk(c, result, "檔案上傳成功");
});

// 預簽名上傳（上傳即分享）的初始化
router.post("/api/share/presign", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { filename, fileSize, contentType, path, storage_config_id, sha256, multipart } = body || {};
  if (!filename) {
    throw new ValidationError("缺少 filename");
  }

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const presign = await shareService.createPresignedShareUpload({
    filename,
    fileSize,
    contentType,
    path: path || null,
    storage_config_id: storage_config_id || null,
    sha256: sha256 || null,
    multipart: multipart === true,
    userIdOrInfo,
    userType,
  });

  return jsonOk(c, presign, "生成預簽名成功");
});

// 預簽名提交（建立分享記錄）
router.post("/api/share/commit", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { key, storage_config_id, filename, size, etag, sha256, slug, remark, password, expires_in, max_views, use_proxy, original_filename, multipart } =
    body || {};
  if (!filename) {
    throw new ValidationError("缺少 filename");
  }

  // 新協議：必須 key + storage_config_id
  const finalKey = key || null;
  const finalStorageConfigId = storage_config_id || null;
  if (!finalKey || !finalStorageConfigId) {
    throw new ValidationError("缺少 key 或 storage_config_id");
  }

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.commitPresignedShareUpload({
    key: finalKey,
    storage_config_id: finalStorageConfigId,
    filename,
    size,
    etag,
    sha256: sha256 || null,
    slug: slug || null,
    remark: remark || "",
    password: password || null,
    expiresIn: Number(expires_in) || 0,
    maxViews: Number(max_views) || 0,
    useProxy: use_proxy !== undefined ? !!use_proxy : undefined,
    originalFilename: !!original_filename,
    userIdOrInfo,
    userType,
    request: c.req.raw,
    multipart: multipart && typeof multipart === "object" ? multipart : null,
  });

  return jsonOk(c, result, "預簽名上傳提交成功");
});

// =============== URL 資訊/代理（併入分享上傳模組） ===============
const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

router.post("/api/share/url/info", requireFilesCreate, parseJsonBody, async (c) => {
  const db = c.env.DB;
  const body = c.get("jsonBody") || {};

  if (!body.url) {
    throw new ValidationError("缺少URL引數");
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  const metadata = await shareService.validateUrlMetadata(body.url);
  return jsonOk(c, metadata, "URL驗證成功");
});

router.get("/api/share/url/proxy", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const url = c.req.query("url");
  if (!url) {
    throw new ValidationError("缺少URL引數");
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  return await shareService.proxyUrlContent(url);
});

// URL → 預簽名：根據URL元資訊生成上傳預簽名
export default router;
