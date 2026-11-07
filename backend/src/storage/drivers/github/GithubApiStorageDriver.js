/**
 * GithubApiStorageDriver
 * - GitHub 倉庫對映為可讀寫檔案系統（全 CRUD）
 * - 讀：Contents API
 * - 寫：Git Database API（blobs/trees/commits/refs）
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { DriverError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";
import { Buffer } from "buffer";
import { decryptIfNeeded } from "../../../utils/crypto.js";

const DEFAULT_API_BASE = "https://api.github.com";
// GitHub Contents API 本身不提供“最後修改時間”，目錄列表階段不額外請求 commits（避免 N 次請求導致限流）
const DEFAULT_FILE_MODE = "100644";
const GITKEEP_FILENAME = ".gitkeep";
// GitHub Git Database API 單個 blob 上限（官方限制）：100MB
const MAX_GITHUB_BLOB_BYTES = 100 * 1024 * 1024;
const MODIFIED_CACHE_LIMIT = 1000;
const SUBMODULE_MIMETYPE = "application/x-git-submodule";

export class GithubApiStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GITHUB_API";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK];

    this.owner = config?.owner || "";
    this.repo = config?.repo || "";
    this.token = config?.token || null;
    this.ref = config?.ref || null;
    this.defaultFolder = config?.default_folder || "";
    this.apiBase = config?.endpoint_url || DEFAULT_API_BASE;
    this.ghProxy = config?.gh_proxy || null;

    this.committerName = config?.committer_name || null;
    this.committerEmail = config?.committer_email || null;
    this.authorName = config?.author_name || null;
    this.authorEmail = config?.author_email || null;

    //不在 Schema 中暴露，使用預設值
    this.writeThrottleMs = Number.isFinite(Number(config?.write_throttle_ms)) ? Number(config.write_throttle_ms) : 1000;
    this.retryMaxAttempts = Number.isFinite(Number(config?.retry_max_attempts)) ? Math.max(1, Number(config.retry_max_attempts)) : 4;
    this.retryBaseDelayMs = Number.isFinite(Number(config?.retry_base_delay_ms)) ? Math.max(0, Number(config.retry_base_delay_ms)) : 500;
    this.retryMaxDelayMs = Number.isFinite(Number(config?.retry_max_delay_ms)) ? Math.max(0, Number(config.retry_max_delay_ms)) : 10_000;

    this._resolvedRef = null; // Contents API / raw 直鏈使用（branch/tag/commit sha 均可）
    this._branchName = null; // 僅當 ref 解析為分支時存在
    this._isOnBranch = false;
    this._repoIsEmpty = false;
    this._repoPrivate = false;
    this._commitQueue = Promise.resolve();
    /** @type {Map<string, string>} */
    this._modifiedCache = new Map();
    this._lastWriteAtMs = 0;
    /** @type {Map<string, string>} */
    this._treeShaCache = new Map();

    // 瀏覽器偽裝客戶端
    this._masqueradeClient = new MasqueradeClient({
      deviceCategory: "desktop",
      rotateIP: false,
      rotateUA: false,
    });
  }

  async initialize() {
    // token 可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
    const decryptedToken = await decryptIfNeeded(this.token, this.encryptionSecret);
    this.token = typeof decryptedToken === "string" ? decryptedToken.trim() : decryptedToken;

    const errors = [];
    if (!this.owner) errors.push("GitHub API 配置缺少必填欄位: owner");
    if (!this.repo) errors.push("GitHub API 配置缺少必填欄位: repo");
    if (!this.token) errors.push("GitHub API 配置缺少必填欄位: token（寫入必須）");
    // endpoint_url 可選：未配置時預設 https://api.github.com
    // - 若使用者顯式配置了 endpoint_url，則校驗 URL 合法性
    if (this.config?.endpoint_url) {
      try {
        const parsed = new URL(String(this.config.endpoint_url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必須以 http:// 或 https:// 開頭");
        }
      } catch {
        errors.push("endpoint_url 不是合法的 URL");
      }
    }
    if (this.defaultFolder) {
      const folder = String(this.defaultFolder).trim();
      if (folder.includes("..")) {
        errors.push("default_folder 不允許包含 .. 段");
      }
    }
    if (errors.length) {
      throw new DriverError(errors.join("；"), {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    const repoMeta = await this._fetchJson(this._buildRepoApiUrl());
    this._repoPrivate = !!repoMeta?.private;
    const defaultBranch = repoMeta?.default_branch || null;
    const refName = this.ref && String(this.ref).trim().length > 0 ? String(this.ref).trim() : defaultBranch;
    if (!refName) {
      throw new DriverError("無法解析 GitHub 倉庫預設分支，請顯式配置 ref", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    const parsedRef = this._parseRefInput(refName);
    if (!parsedRef.value) {
      throw new DriverError("ref 不能為空", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }
    if (parsedRef.kind === "unsupported") {
      throw new DriverError("ref 僅支援分支/標籤/commit sha（refs/heads/*、heads/*、refs/tags/*、tags/* 或直接填寫值）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    this._resolvedRef = parsedRef.value;
    this._modifiedCache.clear();
    this._repoIsEmpty = false;

    // ref 可為 branch/tag/commit sha；僅分支可寫
    if (parsedRef.kind === "branch") {
      const exists = await this._branchExists(parsedRef.value);
      if (!exists) {
        const isEmpty = await this._isRepoEmpty();
        if (!isEmpty) {
          throw new DriverError(`分支不存在：${parsedRef.value}`, {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
            expose: true,
          });
        }
        // 空倉庫：允許“分支尚未建立”，寫入時自動初始化（建立首個 commit + refs）
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
        this._repoIsEmpty = true;
      }
      if (!this._branchName) {
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
      }
    } else if (parsedRef.kind === "any") {
      const exists = await this._branchExists(parsedRef.value);
      if (exists) {
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
      } else {
        // 空倉庫：任何 ref（無 tags/sha 可用）預設按“將要建立的分支名”處理
        const isEmpty = await this._isRepoEmpty();
        if (isEmpty) {
          this._branchName = parsedRef.value;
          this._isOnBranch = true;
          this._repoIsEmpty = true;
        }
      }
    }

    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK];
    if (this._isOnBranch) {
      this.capabilities.push(CAPABILITIES.WRITER, CAPABILITIES.ATOMIC);
    }

    this.initialized = true;
  }

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, db } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoPath = this._toRepoPath(normalizedSubPath);
    let listing = null;
    try {
      listing = await this._getDirectoryListing(repoPath);
    } catch (e) {
      // 空倉庫：根目錄視為“空目錄”，不報 404
      if (
        this._repoIsEmpty &&
        normalizedSubPath === "/" &&
        (e instanceof NotFoundError || (e instanceof DriverError && e?.details?.status === 409))
      ) {
        listing = { sha: null, entries: [] };
      } else {
        throw e;
      }
    }
    const basePath = path;
    /** @type {any[]} */
    let entries = Array.isArray(listing?.entries) ? listing.entries : [];

    // 大目錄最佳化：當 entries 達到上限（>=1000）時優先走 git/trees，避免 Contents API 列表過大或被截斷
    // 說明：object+json 目錄響應通常包含 sha（tree sha），可直接作為 trees/{sha} 的輸入
    if (entries.length >= 1000) {
      const treeSha = listing?.sha || (await this._resolveTreeShaByRepoPath(repoPath));
      const tree = await this._getTree(treeSha, { recursive: false });
      const trees = Array.isArray(tree?.tree) ? tree.tree : [];
      entries = trees
        .filter((t) => t && typeof t.path === "string" && !t.path.includes("/"))
        .map((t) => ({
          name: t.path,
          type: t.type === "tree" ? "dir" : t.type === "commit" ? "submodule" : "file",
          sha: t.sha,
          size: typeof t.size === "number" ? t.size : 0,
        }));
    }

    const items = await Promise.all(
      entries
        .filter((item) => item?.name && item.name !== GITKEEP_FILENAME)
        .map(async (item) => {
          const isDirectory = item.type === "dir";
          const isSubmodule = item.type === "submodule";
          const name = item.name;
          // 約定：目錄列表不拉取 modified（避免 N 次 commits 請求導致效能/限流問題）
          // modified 在 getFileInfo（右側詳情/單檔案資訊）中按需 best-effort 獲取；這裡返回 null，讓前端顯示 "-"
          const modified = null;
          const mimetype = isSubmodule ? SUBMODULE_MIMETYPE : isDirectory ? "application/x-directory" : getMimeTypeFromFilename(name);
          const fsPath = this._joinMountPath(basePath, name, isDirectory);
          const info = await buildFileInfo({
            fsPath,
            name,
            isDirectory,
            // 目錄/子模組大小通常無法可靠獲取；未知就返回 null（前端顯示 “-”，由上層按需 index/compute 兜底）
            size: isDirectory || isSubmodule ? null : Number(item.size) || 0,
            modified,
            mimetype,
            mount,
            storageType: mount?.storage_type,
            db,
          });
          return { ...info, etag: item.sha || undefined, isVirtual: false };
        }),
    );

    return {
      path,
      type: "directory",
      isRoot: normalizedSubPath === "/" || normalizedSubPath === "",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, db } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    // 空倉庫：根目錄視為存在的“空目錄”
    if (this._repoIsEmpty && normalizedSubPath === "/") {
      const info = await buildFileInfo({
        fsPath: path,
        name: this._basename(path, true),
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: null,
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return { ...info, etag: undefined };
    }
    const repoPath = this._toRepoPath(normalizedSubPath);
    const content = await this._getContents(repoPath, { asObjectList: true, allowArray: true });
    const isDirectory = Array.isArray(content);
    if (!isDirectory && content?.type === "submodule") {
      throw new DriverError("不支援訪問 Git submodule（子模組）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { subPath: normalizedSubPath },
      });
    }
    const name = this._basename(path, isDirectory);
    const repoRelPath = this._toRepoRelPath(normalizedSubPath);
    const modified = !isDirectory && repoRelPath ? await this._getLastModifiedIso(repoRelPath) : null;
    const mimetype = isDirectory ? "application/x-directory" : getMimeTypeFromFilename(name);
    const info = await buildFileInfo({
      fsPath: path,
      name,
      isDirectory,
      size: isDirectory ? null : Number(content?.size) || 0,
      modified,
      mimetype: content?.type === "submodule" ? SUBMODULE_MIMETYPE : mimetype,
      mount,
      storageType: mount?.storage_type,
      db,
    });
    return { ...info, etag: isDirectory ? undefined : content?.sha || undefined };
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoPath = this._toRepoPath(normalizedSubPath);
    const contentsUrl = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const rel = this._toRepoRelPath(normalizedSubPath);
    const encodedRef = this._encodeGitRefPath(this._resolvedRef);
    const rawUrl = rel ? this._applyProxy(`https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodedRef}/${this._encodeRawPath(rel)}`) : null;
    const filename = this._basename(path, false) || (rel ? rel.split("/").filter(Boolean).pop() : "") || "file";
    const contentType = getMimeTypeFromFilename(filename);
    let knownSize = null;

    // 私有倉庫：提前拉取元資訊用於 submodule 判定 + size 推斷（避免 Range 時 size=null 導致降級為 200）
    if (this._repoPrivate || !rawUrl) {
      const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
      if (meta?.type === "submodule") {
        throw new DriverError("不支援下載 Git submodule（子模組）", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
          expose: true,
          details: { subPath: normalizedSubPath },
        });
      }
      if (meta && typeof meta.size === "number" && Number.isFinite(meta.size) && meta.size >= 0) {
        knownSize = meta.size;
      }
    }

    return createHttpStreamDescriptor({
      fetchResponse: async (signal) => {
        // 私有倉庫：必須走 Contents API（raw.githubusercontent.com 不帶鑑權）
        if (this._repoPrivate || !rawUrl) {
          return await fetch(contentsUrl, {
            method: "GET",
            headers: this._buildHeaders({ Accept: "application/vnd.github.raw" }),
            signal,
          });
        }

        // 公共倉庫：優先走 raw.githubusercontent.com
        const resp = await fetch(rawUrl, { method: "GET", signal });
        if (resp.status === 404) {
          // raw 的 404：再用 Contents 元資訊區分“檔案不存在”還是“submodule”
          try {
            const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
            if (meta?.type === "submodule") {
              throw new DriverError("不支援下載 Git submodule（子模組）", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
                expose: true,
                details: { subPath: normalizedSubPath },
              });
            }
          } catch (e) {
            if (e instanceof DriverError && e.code === "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED") {
              throw e;
            }
          }
        }
        return resp;
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        // 私有倉庫：Range 走 Contents raw
        if (this._repoPrivate || !rawUrl) {
          return await fetch(contentsUrl, {
            method: "GET",
            headers: this._buildHeaders({ Accept: "application/vnd.github.raw", Range: rangeHeader }),
            signal,
          });
        }

        // 公共倉庫：Range 走 raw.githubusercontent.com
        const resp = await fetch(rawUrl, { method: "GET", headers: { Range: rangeHeader }, signal });
        if (resp.status === 404) {
          // raw 的 404：再用 Contents 元資訊區分“檔案不存在”還是“submodule”
          try {
            const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
            if (meta?.type === "submodule") {
              throw new DriverError("不支援下載 Git submodule（子模組）", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
                expose: true,
                details: { subPath: normalizedSubPath },
              });
            }
          } catch (e) {
            if (e instanceof DriverError && e.code === "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED") {
              throw e;
            }
          }
        }
        return resp;
      },
      fetchHeadResponse: async (signal) => {
        // 優先對“最終下載 URL”執行 HEAD，用於 Range 場景探測 size
        if (this._repoPrivate || !rawUrl) {
          try {
            return await fetch(contentsUrl, {
              method: "HEAD",
              headers: this._buildHeaders({ Accept: "application/vnd.github.raw" }),
              signal,
            });
          } catch {
            return null;
          }
        }
        try {
          return await fetch(rawUrl, { method: "HEAD", signal });
        } catch {
          return null;
        }
      },
      size: knownSize,
      contentType,
      supportsRange: true,
    });
  }

  async exists(subPath, ctx = {}) {
    try {
      await this.getFileInfo(subPath, ctx);
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      return false;
    }
  }

  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath, filename, contentLength, mount } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    const targetSubPath = this._resolveTargetSubPath(normalizedSubPath, fsPath, filename);
    const repoRelPath = this._toRepoRelPath(targetSubPath);

    // 上傳：優先走“邊讀邊寫”的 blob 建立，降低記憶體峰值
    this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });
    const sha = await this._createBlobFromInput(fileOrStream, { contentLength, filename: filename || null });

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: repoRelPath, sha }],
        `upload: ${repoRelPath}`,
      );
    });

    // storagePath 語義對齊：
    // - FS（mount 檢視）：返回掛載路徑（/mount/.../file）
    // - storage-first（ObjectStore/分享上傳/直傳）：返回傳入的 subPath（避免出現 file/file）
    const storagePath = mount
      ? this._buildMountPath(mount, targetSubPath)
      : typeof subPath === "string" && subPath
        ? subPath
        : targetSubPath;

    return { success: true, storagePath, message: "GITHUB_API_UPLOAD" };
  }

  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoRelPath = this._toRepoRelPath(normalizedSubPath);
    const bytes = await this._readAllBytes(content);
    this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: null });

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: repoRelPath, bytes }],
        `update: ${repoRelPath}`,
      );
    });

    return { success: true, path: fsPath, message: "檔案更新成功" };
  }

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    if (normalizedSubPath === "/" || normalizedSubPath === "") {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const dirRel = this._toRepoRelPath(normalizedSubPath);
    if (!dirRel) {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const keepPath = `${dirRel}/${GITKEEP_FILENAME}`;

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: keepPath, bytes: Buffer.from("", "utf8") }],
        `mkdir: ${dirRel}`,
      );
    });

    return { success: true, path: fsPath, alreadyExists: false };
  }

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    const { oldPath, newPath } = ctx;

    const fromSub = this._normalizeSubPath(oldSubPath);
    const toSub = this._normalizeSubPath(newSubPath);

    // 禁止對掛載根執行重新命名（可能導致整庫移動）
    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支援重新命名掛載根目錄", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const fromRel = this._toRepoRelPath(fromSub);
    const toRel = this._toRepoRelPath(toSub);

    await this._withCommitLock(async () => {
      const planned = await this._planMoveOrCopy({ fromRel, toRel, mode: "move" });
      await this._commitPlannedChanges(planned, `rename: ${fromRel} -> ${toRel}`);
    });

    return { success: true, source: oldPath, target: newPath };
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    const { sourcePath, targetPath, skipExisting = false, _skipExistingChecked = false } = ctx;

    const fromSub = this._normalizeSubPath(sourceSubPath);
    const toSub = this._normalizeSubPath(targetSubPath);

    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支援複製掛載根目錄", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const fromRel = this._toRepoRelPath(fromSub);
    const toRel = this._toRepoRelPath(toSub);

    // 單檔案複製的 skipExisting：入口層未檢查時，做一次輕量存在性判斷（失敗則繼續）
    if (skipExisting && !_skipExistingChecked) {
      try {
        const exists = await this._pathExists(toRel);
        if (exists) {
          return {
            status: "skipped",
            skipped: true,
            reason: "target_exists",
            source: sourcePath,
            target: targetPath,
            contentLength: 0,
          };
        }
      } catch {}
    }

    await this._withCommitLock(async () => {
      const planned = await this._planMoveOrCopy({ fromRel, toRel, mode: "copy" });
      await this._commitPlannedChanges(planned, `copy: ${fromRel} -> ${toRel}`);
    });

    return { status: "success", source: sourcePath, target: targetPath };
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    const { paths } = ctx;

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    const results = [];

    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);

    const deleteSet = new Set();

    for (let i = 0; i < subPaths.length; i++) {
      const fsPath = Array.isArray(paths) ? paths[i] : subPaths[i];
      const sub = this._normalizeSubPath(subPaths[i]);
      if (sub === "/") {
        results.push({ path: fsPath, success: false, error: "不支援刪除掛載根目錄" });
        continue;
      }

      const rel = this._toRepoRelPath(sub);
      const direct = index.get(rel);
      if (direct && direct.type === "commit") {
        results.push({ path: fsPath, success: false, error: "不支援刪除 Git submodule（子模組）" });
        continue;
      }
      if (direct && direct.type === "blob") {
        deleteSet.add(rel);
        results.push({ path: fsPath, success: true });
        continue;
      }

      // 目錄：刪除其下全部 blob（包括 .gitkeep）
      const prefix = `${rel}/`;
      const blobs = (tree.tree || []).filter((e) => e?.type === "blob" && typeof e.path === "string" && e.path.startsWith(prefix));
      const commits = (tree.tree || []).filter((e) => e?.type === "commit" && typeof e.path === "string" && e.path.startsWith(prefix));
      if (commits.length > 0) {
        results.push({ path: fsPath, success: false, error: "不支援刪除包含 Git submodule（子模組）的目錄" });
        continue;
      }
      if (blobs.length === 0) {
        results.push({ path: fsPath, success: false, error: "路徑不存在" });
        continue;
      }

      for (const e of blobs) {
        deleteSet.add(e.path);
      }
      results.push({ path: fsPath, success: true });
    }

    const deletePaths = Array.from(deleteSet).filter((p) => index.has(p));
    if (deletePaths.length > 0) {
      await this._withCommitLock(async () => {
        await this._commitTreeChanges(
          deletePaths.map((p) => ({ kind: "delete", path: p })),
          `remove: ${deletePaths.length} item(s)`,
        );
      });
    }

    const failed = results.filter((r) => !r.success);
    const success = results.filter((r) => r.success).length;
    return { success, failed, results };
  }

  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const { request, forceDownload = false } = ctx;
    const rel = this._toRepoRelPath(this._normalizeSubPath(subPath || "/"));
    if (this._repoPrivate) {
      throw new DriverError("GitHub 私有倉庫無法生成瀏覽器可用的直鏈，請走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_DIRECT_LINK_NOT_AVAILABLE",
        expose: true,
        details: { path: fsPath, subPath },
      });
    }
    const encodedRef = this._encodeGitRefPath(this._resolvedRef);
    const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodedRef}/${this._encodeRawPath(rel)}`;
    return { url: this._applyProxy(rawUrl), type: "native_direct", expiresIn: ctx.expiresIn || null };
  }

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    return { url: buildFullProxyUrl(request || null, fsPath, download), type: "proxy", channel };
  }

  // ========== Git 提交流程（blobs/trees/commits/refs） ==========

  async _withCommitLock(fn) {
    this._ensureWritable();
    const prev = this._commitQueue;
    let release = null;
    this._commitQueue = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      // 寫入節流：對齊 GitHub Best Practices，降低 secondary rate limit 風險
      await this._applyWriteThrottle();
      return await fn();
    } finally {
      try {
        release?.();
      } catch {}
    }
  }

  async _getHead() {
    this._ensureWritable();
    await this._ensureRepoInitialized();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("當前 ref 非分支（tag/commit sha），僅支援只讀操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }

    const ref = await this._fetchJson(this._buildGitApiUrl(`/ref/heads/${this._encodeGitRefPath(branch)}`));
    const commitSha = ref?.object?.sha || null;
    if (!commitSha) {
      throw new DriverError("無法解析 GitHub 分支 HEAD", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_HEAD_MISSING",
        expose: false,
      });
    }

    const commit = await this._fetchJson(this._buildGitApiUrl(`/commits/${commitSha}`));
    const treeSha = commit?.tree?.sha || null;
    if (!treeSha) {
      throw new DriverError("無法解析 GitHub commit tree", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_MISSING",
        expose: false,
      });
    }

    return { commitSha, treeSha };
  }

  async _getTree(treeSha, { recursive = false } = {}) {
    const suffix = recursive ? `?recursive=1` : "";
    const url = this._buildGitApiUrl(`/trees/${treeSha}${suffix}`);
    const data = await this._fetchJson(url);
    if (!data || !Array.isArray(data.tree)) {
      throw new DriverError("GitHub trees 響應格式異常", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_INVALID",
        expose: false,
        details: { treeSha, recursive },
      });
    }
    // GitHub：遞迴 trees 可能被截斷（truncated=true）。
    // 截斷意味著缺少部分條目，若繼續執行目錄級 copy/move/remove 將導致漏拷/漏刪，必須失敗。
    if (data?.truncated) {
      throw new DriverError("GitHub trees 響應被截斷（truncated=true），無法保證目錄操作一致性", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_TREE_TRUNCATED",
        expose: true,
        details: { treeSha, recursive: !!recursive },
      });
    }
    return data;
  }

  async _getTreeRecursive(treeSha) {
    return await this._getTree(treeSha, { recursive: true });
  }

  _indexTree(tree) {
    const map = new Map();
    for (const entry of tree?.tree || []) {
      if (!entry || typeof entry.path !== "string") continue;
      map.set(entry.path, entry);
    }
    return map;
  }

  async _createBlob(bytes) {
    this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes?.length || 0, filename: null });
    const url = this._buildGitApiUrl("/blobs");
    const payload = {
      content: Buffer.from(bytes).toString("base64"),
      encoding: "base64",
    };
    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("建立 GitHub blob 失敗", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_BLOB_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  /**
   * 邊讀邊寫建立 blob（避免把整個檔案讀入記憶體）
   * - GitHub 要求 JSON body，無法真正“二進位制直傳”，但可透過流式拼接 JSON + base64 來降低記憶體峰值
   */
  async _createBlobFromInput(input, { contentLength, filename } = {}) {
    // 已知大小時先做硬校驗，避免無意義讀取
    this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });

    // 小物件/編輯內容：仍走記憶體路徑，保持簡單
    if (Buffer.isBuffer(input) || input instanceof Uint8Array || input instanceof ArrayBuffer || typeof input === "string") {
      const bytes = await this._readAllBytes(input);
      this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: filename || null });
      return await this._createBlob(bytes);
    }

    // Blob/File：優先 stream()（邊讀邊寫）
    if (input && typeof input.stream === "function") {
      return await this._createBlobFromByteStream(input.stream(), { contentLength, filename: filename || null });
    }

    // Web ReadableStream / Node Readable：邊讀邊寫
    if (
      input &&
      (typeof input.getReader === "function" ||
        typeof input.pipe === "function" ||
        input.readable ||
        typeof input[Symbol.asyncIterator] === "function")
    ) {
      return await this._createBlobFromByteStream(input, { contentLength, filename: filename || null });
    }

    // 兜底：最後嘗試 arrayBuffer（可能會把資料讀入記憶體）
    if (input && typeof input.arrayBuffer === "function") {
      const bytes = await this._readAllBytes(input);
      this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: filename || null });
      return await this._createBlob(bytes);
    }

    throw new DriverError("不支援的上傳資料型別", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.GITHUB_API_UNSUPPORTED_BODY",
      expose: true,
    });
  }

  async _createBlobFromByteStream(streamLike, { contentLength, filename } = {}) {
    const url = this._buildGitApiUrl("/blobs");

    const encoder = new TextEncoder();
    const prefix = encoder.encode(`{"content":"`);
    const suffix = encoder.encode(`","encoding":"base64"}`);

    const base64Iter = this._encodeBase64Stream(streamLike, {
      maxBytes: MAX_GITHUB_BLOB_BYTES,
      filename: filename || null,
      contentLength,
    });

    const iter = (async function* () {
      yield prefix;
      for await (const s of base64Iter) {
        yield encoder.encode(s);
      }
      yield suffix;
    })();

    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iter.next();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (e) {
          controller.error(e);
        }
      },
    });

    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!data?.sha) {
      throw new DriverError("建立 GitHub blob 失敗", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_BLOB_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async *_iterateBytes(input) {
    // Web ReadableStream
    if (input && typeof input.getReader === "function") {
      const reader = input.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value == null) continue;
        yield Buffer.isBuffer(value) ? value : Buffer.from(value);
      }
      return;
    }

    // Node Readable / async iterator
    if (input && (typeof input.pipe === "function" || input.readable || typeof input[Symbol.asyncIterator] === "function")) {
      for await (const chunk of input) {
        if (chunk == null) continue;
        if (Buffer.isBuffer(chunk)) yield chunk;
        else if (chunk instanceof Uint8Array) yield Buffer.from(chunk);
        else if (chunk instanceof ArrayBuffer) yield Buffer.from(new Uint8Array(chunk));
        else yield Buffer.from(chunk);
      }
      return;
    }

    // 其他：兜底為一次性 Buffer
    const bytes = await this._readAllBytes(input);
    yield bytes;
  }

  async *_encodeBase64Stream(input, { maxBytes, filename, contentLength } = {}) {
    // 已知大小時先校驗（減少無意義讀取）
    if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength > 0) {
      this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });
    }

    let carry = Buffer.alloc(0);
    let total = 0;

    for await (const chunk of this._iterateBytes(input)) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (typeof maxBytes === "number" && Number.isFinite(maxBytes) && total > maxBytes) {
        throw new DriverError(`檔案過大，GitHub 單檔案上限為 ${Math.floor(MAX_GITHUB_BLOB_BYTES / (1024 * 1024))}MB`, {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || null, bytesLength: total, limit: MAX_GITHUB_BLOB_BYTES },
        });
      }

      const combined = carry.length ? Buffer.concat([carry, buf]) : buf;
      const usableLen = combined.length - (combined.length % 3);
      if (usableLen > 0) {
        yield combined.subarray(0, usableLen).toString("base64");
      }
      carry = combined.subarray(usableLen);
    }

    if (carry.length) {
      yield carry.toString("base64");
    }
  }

  async _createTree(baseTreeSha, treeEntries) {
    const url = this._buildGitApiUrl("/trees");
    const payload = { tree: treeEntries };
    if (baseTreeSha) payload.base_tree = baseTreeSha;
    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("建立 GitHub tree 失敗", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_TREE_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async _createCommit(message, treeSha, parentSha) {
    const url = this._buildGitApiUrl("/commits");
    const payload = {
      message,
      tree: treeSha,
      parents: parentSha ? [parentSha] : [],
    };

    const now = new Date().toISOString();
    if (this.committerName && this.committerEmail) {
      payload.committer = { name: this.committerName, email: this.committerEmail, date: now };
    }
    if (this.authorName && this.authorEmail) {
      payload.author = { name: this.authorName, email: this.authorEmail, date: now };
    }

    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("建立 GitHub commit 失敗", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_COMMIT_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async _updateRef(commitSha) {
    this._ensureWritable();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("當前 ref 非分支（tag/commit sha），僅支援只讀操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }

    const url = this._buildGitApiUrl(`/refs/heads/${this._encodeGitRefPath(branch)}`);
    const payload = { sha: commitSha, force: false };
    await this._fetchJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async _createBranchRef(commitSha) {
    this._ensureWritable();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("當前 ref 非分支（tag/commit sha），僅支援只讀操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }
    const url = this._buildGitApiUrl("/refs");
    const payload = { ref: `refs/heads/${branch}`, sha: commitSha };
    await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async _ensureRepoInitialized() {
    if (!this._repoIsEmpty) return;
    const branch = this._branchName;
    if (!branch) return;

    // 空倉庫：Git Database API（/git/blobs 等）在 GitHub 上可能直接返回 409（Git Repository is empty）
    // 因此初始化提交使用 Contents API 建立首個檔案來引導生成首個 commit + 分支引用。
    // 空倉庫初始化應儘量“不汙染使用者預設上傳目錄選擇”，因此總是在倉庫根目錄寫入 .gitkeep
    const rel = GITKEEP_FILENAME;
    const repoPath = `/${rel}`;
    const url = this._buildContentsApiUrl(repoPath);
    const payload = {
      message: `init: ${rel}`,
      // 避免空字串在部分實現中被視為無效內容，寫入一個換行作為 .gitkeep 內容
      content: Buffer.from("\n", "utf8").toString("base64"),
      branch,
    };
    const now = new Date().toISOString();
    if (this.committerName && this.committerEmail) {
      payload.committer = { name: this.committerName, email: this.committerEmail, date: now };
    }
    if (this.authorName && this.authorEmail) {
      payload.author = { name: this.authorName, email: this.authorEmail, date: now };
    }
    await this._fetchJson(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    this._repoIsEmpty = false;
    this._modifiedCache.clear();
  }

  async _isRepoEmpty() {
    const url = this._buildCommitsApiUrl({ perPage: 1 });
    const resp = await fetch(url, { method: "GET", headers: this._buildHeaders() });
    // GitHub：空倉庫常見返回 409（Git Repository is empty）
    if (resp.status === 409) return true;
    if (!resp.ok) return false;
    try {
      const data = await resp.json();
      return Array.isArray(data) && data.length === 0;
    } catch {
      return false;
    }
  }

  async _commitTreeChanges(changes, message) {
    const head = await this._getHead();

    const treeEntries = [];
    for (const change of changes || []) {
      if (!change) continue;
      if (change.kind === "upsert") {
        const sha = change.sha || (await this._createBlob(change.bytes));
        treeEntries.push({ path: change.path, mode: DEFAULT_FILE_MODE, type: "blob", sha });
      } else if (change.kind === "delete") {
        treeEntries.push({ path: change.path, mode: DEFAULT_FILE_MODE, type: "blob", sha: null });
      }
    }

    if (treeEntries.length === 0) return { success: true, skipped: true };

    const newTreeSha = await this._createTree(head.treeSha, treeEntries);
    const commitSha = await this._createCommit(message, newTreeSha, head.commitSha);
    await this._updateRef(commitSha);
    // 寫入後：清空 modified cache，避免目錄/檔案時間滯後
    this._modifiedCache.clear();
    return { success: true, commitSha };
  }

  async _pathExists(relPath) {
    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);
    return index.has(relPath);
  }

  async _planMoveOrCopy({ fromRel, toRel, mode }) {
    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);

    const direct = index.get(fromRel);
    if (direct && direct.type === "commit") {
      throw new DriverError("不支援複製/移動 Git submodule（子模組）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { fromRel, toRel, mode },
      });
    }
    if (direct && direct.type === "blob") {
      return {
        head,
        actions: [
          ...(mode === "move" ? [{ kind: "delete", path: fromRel }] : []),
          { kind: "reuse", from: fromRel, to: toRel, sha: direct.sha },
        ],
      };
    }

    const prefix = `${fromRel}/`;
    const blobs = (tree.tree || []).filter((e) => e?.type === "blob" && typeof e.path === "string" && e.path.startsWith(prefix));
    const commits = (tree.tree || []).filter((e) => e?.type === "commit" && typeof e.path === "string" && e.path.startsWith(prefix));
    if (commits.length > 0) {
      throw new DriverError("不支援複製/移動包含 Git submodule（子模組）的目錄", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { fromRel, toRel, mode, count: commits.length },
      });
    }
    if (blobs.length === 0) {
      throw new NotFoundError("路徑不存在");
    }

    const actions = [];
    for (const entry of blobs) {
      const rest = entry.path.slice(prefix.length);
      const target = `${toRel}/${rest}`;
      if (mode === "move") {
        actions.push({ kind: "delete", path: entry.path });
      }
      actions.push({ kind: "reuse", from: entry.path, to: target, sha: entry.sha });
    }

    return { head, actions };
  }

  async _commitPlannedChanges(planned, message) {
    const head = planned?.head;
    const actions = planned?.actions || [];
    if (!head) {
      throw new DriverError("內部錯誤：缺少 head", { status: ApiStatus.INTERNAL_ERROR, expose: false });
    }

    const treeEntries = [];
    for (const action of actions) {
      if (action.kind === "delete") {
        treeEntries.push({ path: action.path, mode: DEFAULT_FILE_MODE, type: "blob", sha: null });
      } else if (action.kind === "reuse") {
        treeEntries.push({ path: action.to, mode: DEFAULT_FILE_MODE, type: "blob", sha: action.sha });
      }
    }

    if (treeEntries.length === 0) return { success: true, skipped: true };

    const newTreeSha = await this._createTree(head.treeSha, treeEntries);
    const commitSha = await this._createCommit(message, newTreeSha, head.commitSha);
    await this._updateRef(commitSha);
    this._modifiedCache.clear();
    return { success: true, commitSha };
  }

  _buildRepoApiUrl() {
    return `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}`;
  }

  _buildCommitsApiUrl({ path, sha, perPage = 1 } = {}) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/commits`;
    const url = new URL(base);
    if (path) url.searchParams.set("path", path);
    if (sha) url.searchParams.set("sha", sha);
    url.searchParams.set("per_page", String(perPage));
    return url.toString();
  }

  _buildRepoCommitApiUrl(ref) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/commits`;
    const encoded = encodeURIComponent(String(ref || ""));
    return `${base}/${encoded}`;
  }

  async _sleep(ms) {
    const delay = Number(ms) || 0;
    if (delay <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async _applyWriteThrottle() {
    const ms = Number(this.writeThrottleMs) || 0;
    if (ms <= 0) return;
    const now = Date.now();
    const elapsed = now - (Number(this._lastWriteAtMs) || 0);
    if (elapsed < ms) {
      await this._sleep(ms - elapsed);
    }
    this._lastWriteAtMs = Date.now();
  }

  _setModifiedCache(key, value) {
    this._modifiedCache.set(key, value);
    if (this._modifiedCache.size <= MODIFIED_CACHE_LIMIT) return;
    const firstKey = this._modifiedCache.keys().next().value;
    if (firstKey) {
      this._modifiedCache.delete(firstKey);
    }
  }

  async _getLastModifiedIso(repoRelPath) {
    const rel = String(repoRelPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!rel) return null;

    const cacheKey = `${this._resolvedRef || ""}|${rel}`;
    const cached = this._modifiedCache.get(cacheKey) || null;
    if (cached) return cached;

    try {
      const url = this._buildCommitsApiUrl({ path: rel, sha: this._resolvedRef || undefined, perPage: 1 });
      const data = await this._fetchJson(url);
      const first = Array.isArray(data) ? data[0] : null;
      const iso = first?.commit?.committer?.date || first?.commit?.author?.date || null;
      const finalIso = iso ? String(iso) : null;
      if (finalIso) {
        this._setModifiedCache(cacheKey, finalIso);
      }
      return finalIso;
    } catch {
      // best-effort：時間獲取失敗不影響目錄展示
      return null;
    }
  }

  _getTreeShaCache(key) {
    if (!key) return null;
    return this._treeShaCache.get(key) || null;
  }

  _setTreeShaCache(key, value) {
    if (!key) return;
    if (value == null) return;
    this._treeShaCache.set(key, String(value));
    // 簡單 FIFO 限制，避免無界增長
    if (this._treeShaCache.size <= 500) return;
    const firstKey = this._treeShaCache.keys().next().value;
    if (firstKey) this._treeShaCache.delete(firstKey);
  }

  async _getRootTreeShaForResolvedRef() {
    const cacheKey = `${this._resolvedRef || ""}|/`;
    const cached = this._getTreeShaCache(cacheKey);
    if (cached) return cached;

    // 使用 Repo Commits API：ref 可為 branch/tag/sha，避免額外 ref 解析
    const url = this._buildRepoCommitApiUrl(this._resolvedRef);
    const data = await this._fetchJson(url);
    const sha = data?.commit?.tree?.sha || data?.tree?.sha || null;
    if (!sha) {
      throw new DriverError("無法解析 GitHub 倉庫根 tree sha", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_MISSING",
        expose: false,
        details: { url },
      });
    }
    this._setTreeShaCache(cacheKey, sha);
    return sha;
  }

  async _resolveTreeShaByRepoPath(repoPath) {
    const normalized = String(repoPath || "/");
    const rel = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
    const cacheKey = `${this._resolvedRef || ""}|/${rel}`;
    const cached = this._getTreeShaCache(cacheKey);
    if (cached) return cached;

    let currentSha = await this._getRootTreeShaForResolvedRef();
    if (!rel) {
      this._setTreeShaCache(cacheKey, currentSha);
      return currentSha;
    }

    const segments = rel.split("/").filter(Boolean);
    for (const seg of segments) {
      const tree = await this._getTree(currentSha, { recursive: false });
      const entry = Array.isArray(tree?.tree) ? tree.tree.find((t) => t && t.path === seg) : null;
      if (!entry || !entry.sha) {
        throw new NotFoundError("資源不存在", { repoPath: normalized });
      }
      if (entry.type === "commit") {
        throw new DriverError("不支援訪問 Git submodule（子模組）", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
          expose: true,
          details: { repoPath: normalized },
        });
      }
      if (entry.type !== "tree") {
        throw new ValidationError("目標不是目錄");
      }
      currentSha = entry.sha;
    }

    this._setTreeShaCache(cacheKey, currentSha);
    return currentSha;
  }

  _joinRepoRelPath(baseRel, name) {
    const b = String(baseRel || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const n = String(name || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!b) return n;
    if (!n) return b;
    return `${b}/${n}`;
  }

  _buildContentsApiUrl(repoPath, { ref } = {}) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/contents`;
    const encoded = this._encodePath(repoPath);
    // GitHub Contents API 端點為 /contents/{path}
    // 根目錄需要顯式以 `/contents/` 訪問，避免 `/contents` 在部分場景下返回 404
    const url = new URL(encoded ? `${base}${encoded}` : `${base}/`);
    if (ref) url.searchParams.set("ref", ref);
    return url.toString();
  }

  _buildGitApiUrl(pathname) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/git`;
    return `${base}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  }

  _buildHeaders(extra = {}, targetUrl = null) {
    const browserHeaders = this._masqueradeClient.buildHeaders({}, targetUrl);
    const headers = {
      ...browserHeaders,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async _fetchJson(url, init = {}) {
    const method = String(init?.method || "GET").toUpperCase();
    const maxAttempts = this.retryMaxAttempts || 1;

    // 寫請求不做“網路錯誤重試/5xx重試”，避免重複提交導致多 commit；僅對“明確未執行”的限流響應做等待重試
    const isSafeToRetryNetwork = method === "GET";
    const isSafeToRetry5xx = method === "GET";

    const readRetryHeaders = (resp) => {
      const retryAfterRaw = resp.headers?.get?.("retry-after") || resp.headers?.get?.("Retry-After") || null;
      const resetRaw = resp.headers?.get?.("x-ratelimit-reset") || resp.headers?.get?.("X-RateLimit-Reset") || null;
      const remainingRaw = resp.headers?.get?.("x-ratelimit-remaining") || resp.headers?.get?.("X-RateLimit-Remaining") || null;
      const retryAfter = retryAfterRaw != null && String(retryAfterRaw).trim() !== "" ? Number(retryAfterRaw) : null;
      const reset = resetRaw != null && String(resetRaw).trim() !== "" ? Number(resetRaw) : null;
      const remaining = remainingRaw != null && String(remainingRaw).trim() !== "" ? Number(remainingRaw) : null;
      return { retryAfter, reset, remaining };
    };

    const computeDelayMs = ({ attempt, retryAfterSeconds, resetEpochSeconds }) => {
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.max(0, retryAfterSeconds * 1000);
      }
      if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
        const until = resetEpochSeconds * 1000 - Date.now();
        // GitHub 可能提前/延後，給一個小緩衝
        return Math.max(0, until + 250);
      }
      const base = Number(this.retryBaseDelayMs) || 0;
      const max = Number(this.retryMaxDelayMs) || 0;
      const exp = base > 0 ? base * Math.pow(2, Math.max(0, attempt - 1)) : 0;
      const capped = max > 0 ? Math.min(exp, max) : exp;
      return Math.max(0, capped);
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let resp = null;
      try {
        resp = await fetch(url, { ...init, headers: this._buildHeaders(init.headers || {}) });
      } catch (e) {
        if (attempt < maxAttempts && isSafeToRetryNetwork) {
          const delay = computeDelayMs({ attempt });
          await this._sleep(delay);
          continue;
        }
        throw new DriverError("GitHub API 請求失敗: 網路錯誤", {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
          expose: false,
          details: { url, cause: e?.message || String(e) },
        });
      }

      if (resp.status === 404) throw new NotFoundError("資源不存在", { url });

      if (resp.ok) {
        try {
          return await resp.json();
        } catch {
          // 極少數場景下上游返回空 body
          return null;
        }
      }

      const { retryAfter, reset, remaining } = readRetryHeaders(resp);
      const rateLimited = resp.status === 429 || (resp.status === 403 && (retryAfter != null || remaining === 0));
      const retryable5xx = resp.status === 502 || resp.status === 503 || resp.status === 504;
      const canRetry =
        attempt < maxAttempts &&
        (rateLimited || (retryable5xx && isSafeToRetry5xx));

      if (canRetry) {
        const delay = computeDelayMs({ attempt, retryAfterSeconds: retryAfter, resetEpochSeconds: reset });
        await this._sleep(delay);
        continue;
      }

      let text = null;
      try {
        text = await resp.text();
      } catch {
        text = null;
      }

      throw new DriverError(`GitHub API 請求失敗: HTTP ${resp.status}`, {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
        expose: false,
        details: {
          url,
          status: resp.status,
          body: text,
          retryAfter,
          rateLimitRemaining: remaining,
          rateLimitReset: reset,
        },
      });
    }

    throw new DriverError("GitHub API 請求失敗: 超出重試次數", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
      expose: false,
      details: { url, method, maxAttempts },
    });
  }

  async _getContents(repoPath, { asObjectList = true, allowArray = false } = {}) {
    const url = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const accept = asObjectList ? "application/vnd.github.object+json" : "application/vnd.github+json";
    const data = await this._fetchJson(url, { headers: { Accept: accept } });
    // object+json 在不同文件版本中可能返回兩種形態：
    // 1) 目錄：直接返回陣列
    // 2) 目錄：返回 { entries: [...] }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.entries)) return data.entries;
    if (allowArray) return data;
    if (data && data.type && data.type !== "dir") {
      throw new ValidationError("目標不是目錄");
    }
    return data;
  }

  async _getDirectoryListing(repoPath) {
    const url = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const data = await this._fetchJson(url, { headers: { Accept: "application/vnd.github.object+json" } });

    // object+json 在不同文件版本中可能返回兩種形態：
    // 1) 目錄：直接返回陣列（無目錄 sha）
    // 2) 目錄：返回 { sha, entries: [...] }
    if (Array.isArray(data)) {
      return { sha: null, entries: data };
    }

    if (data && Array.isArray(data.entries)) {
      return { sha: data.sha || null, entries: data.entries };
    }

    if (data && data.type && data.type !== "dir") {
      throw new ValidationError("目標不是目錄");
    }

    return { sha: data?.sha || null, entries: [] };
  }

  _parseRefInput(input) {
    const raw = String(input || "").trim();
    if (!raw) return { kind: "empty", value: null };
    if (raw.startsWith("refs/heads/")) return { kind: "branch", value: raw.slice("refs/heads/".length) };
    if (raw.startsWith("heads/")) return { kind: "branch", value: raw.slice("heads/".length) };
    if (raw.startsWith("refs/tags/")) return { kind: "tag", value: raw.slice("refs/tags/".length) };
    if (raw.startsWith("tags/")) return { kind: "tag", value: raw.slice("tags/".length) };
    if (raw.startsWith("refs/")) return { kind: "unsupported", value: raw };
    return { kind: "any", value: raw };
  }

  _encodeGitRefPath(refName) {
    return String(refName || "")
      .split("/")
      .filter((seg) => seg.length > 0)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  async _branchExists(branchName) {
    try {
      await this._fetchJson(this._buildGitApiUrl(`/ref/heads/${this._encodeGitRefPath(branchName)}`));
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      // 空倉庫：GitHub 對 refs/heads/* 可能返回 409 "Git Repository is empty."
      // 視為“分支尚不存在”，後續由初始化邏輯建立首個 commit + refs
      if (e instanceof DriverError && e?.details?.status === 409) return false;
      throw e;
    }
  }

  _ensureWritable() {
    this._ensureInitialized();
    if (!this._isOnBranch) {
      throw new DriverError("當前 ref 非分支（tag/commit sha），僅支援只讀操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }
  }

  _applyProxy(url) {
    if (!this.ghProxy || typeof this.ghProxy !== "string") return url;
    const trimmed = this.ghProxy.trim().replace(/\/+$/, "");
    if (!trimmed) return url;
    return url.replace(/^https:\/\/raw\.githubusercontent\.com/, trimmed);
  }

  _encodePath(repoPath) {
    if (!repoPath || repoPath === "/") return "";
    const normalized = String(repoPath).replace(/\/+$/, "").replace(/^\/+/, "");
    if (!normalized) return "";
    const encoded = normalized
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `/${encoded}`;
  }

  _encodeRawPath(relPath) {
    if (!relPath) return "";
    return relPath
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  _normalizeSubPath(subPath) {
    const raw = subPath == null ? "/" : String(subPath);
    let p = raw.trim();
    if (!p) p = "/";
    if (!p.startsWith("/")) p = `/${p}`;
    // 相容 Windows 反斜槓路徑，併合並重復的 /
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    if (p.includes("..")) {
      throw new DriverError("路徑不允許包含 .. 段", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    return p;
  }

  _normalizeFolderPrefix(folder) {
    if (!folder) return "";
    let f = String(folder).trim().replace(/\\+/g, "/");
    f = f.replace(/\/+/g, "/");
    f = f.replace(/^\/+/, "").replace(/\/+$/, "");
    return f;
  }

  _toRepoPath(subPath) {
    const sp = this._normalizeSubPath(subPath);
    // 約定：storage_config.default_folder 僅用於“檔案上傳頁/分享上傳”的預設目錄，不影響掛載瀏覽根目錄。
    // 因此 GitHub FS 驅動的 repoPath 對映不應用 default_folder 字首。
    return sp;
  }

  _toRepoRelPath(subPath) {
    const repoPath = this._toRepoPath(subPath);
    return repoPath.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  _buildMountPath(mount, subPath) {
    const mountPath = mount?.mount_path || "";
    const sp = this._normalizeSubPath(subPath);
    if (!mountPath) return sp;
    if (sp === "/" || sp === "") return mountPath;
    return `${mountPath.replace(/\/+$/, "")}${sp}`;
  }

  _joinMountPath(baseFsPath, name, isDirectory) {
    const base = baseFsPath.endsWith("/") ? baseFsPath.replace(/\/+$/, "") : baseFsPath;
    const next = `${base}/${name}`;
    return isDirectory ? `${next}/` : next;
  }

  _basename(fsPath, isDirectory) {
    let p = String(fsPath || "");
    if (isDirectory) p = p.replace(/\/+$/, "");
    const segs = p.split("/").filter(Boolean);
    return segs.length ? segs[segs.length - 1] : "";
  }

  _resolveTargetSubPath(subPath, fsPath, filename) {
    const sp = this._normalizeSubPath(subPath);
    const name = filename || null;

    // 後端 /api/fs/upload（流式與表單）預設將 path 作為“目標目錄”，檔名透過 filename 傳入
    // 因此只要帶 filename，就一律按“目錄 + 檔名”語義拼接
    if (name) {
      const base = sp === "/" ? "" : sp.replace(/\/+$/, "");
      return `${base}/${name}`.replace(/\/+/g, "/");
    }

    // 無 filename：認為 subPath 已是完整檔案路徑
    return sp;
  }

  async _readAllBytes(input) {
    if (input == null) {
      return Buffer.from("", "utf8");
    }

    if (Buffer.isBuffer(input)) {
      return input;
    }
    if (input instanceof Uint8Array) {
      return Buffer.from(input);
    }
    if (input instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(input));
    }

    if (typeof input === "string") {
      return Buffer.from(input, "utf8");
    }

    // Blob/File：瀏覽器/Worker/Node18+ fetch 的 File/Blob 都支援 arrayBuffer()
    if (typeof input.arrayBuffer === "function") {
      const ab = await input.arrayBuffer();
      return Buffer.from(new Uint8Array(ab));
    }

    // Web ReadableStream
    if (typeof input.getReader === "function") {
      const reader = input.getReader();
      const chunks = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        chunks.push(buf);
        total += buf.length;
      }
      return Buffer.concat(chunks, total);
    }

    // Node.js Readable（async iterator）
    if (typeof input.pipe === "function" || input.readable) {
      const chunks = [];
      let total = 0;
      for await (const chunk of input) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        total += buf.length;
      }
      return Buffer.concat(chunks, total);
    }

    throw new DriverError("不支援的上傳資料型別", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.GITHUB_API_UNSUPPORTED_BODY",
      expose: true,
    });
  }

  _resolveMountForPath(fsPath, mount, findMountPointByPath) {
    if (!mount) return null;

    // 注意：此處不可直接呼叫後端的 findMountPointByPath(db, path, ...)。
    // batchRemoveItems 的 paths 是“掛載檢視路徑”，因此只需基於 mount.mount_path 做純字串解析即可（避免簽名不一致導致誤判跨掛載）。
    const normalizedFsPath = this._normalizeFullFsPath(fsPath);
    const normalizedMountPath = this._normalizeMountPath(mount?.mount_path || "");
    if (!normalizedMountPath) {
      return { mount, subPath: normalizedFsPath || "/" };
    }

    if (normalizedFsPath === normalizedMountPath || normalizedFsPath === `${normalizedMountPath}/`) {
      return { mount, subPath: "/" };
    }
    if (normalizedFsPath.startsWith(`${normalizedMountPath}/`)) {
      const subPath = normalizedFsPath.slice(normalizedMountPath.length) || "/";
      return { mount, subPath };
    }

    return null;
  }

  _normalizeMountPath(mountPath) {
    let p = String(mountPath || "").trim();
    if (!p) return "";
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (!p.startsWith("/")) p = `/${p}`;
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p;
  }

  _normalizeFullFsPath(fsPath) {
    let p = String(fsPath || "").trim();
    if (!p) return "/";
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (!p.startsWith("/")) p = `/${p}`;
    return p;
  }

  _assertBlobSizeAllowed({ contentLength, bytesLength, filename }) {
    const len = Number.isFinite(contentLength) ? Number(contentLength) : null;
    if (len != null && len > MAX_GITHUB_BLOB_BYTES) {
      throw new DriverError(
        `檔案過大：GitHub 單檔案最大 100MB（當前約 ${(len / 1024 / 1024).toFixed(2)}MB）。請改用更小檔案、Git LFS，或更換儲存型別。`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || undefined, contentLength: len, maxBytes: MAX_GITHUB_BLOB_BYTES },
        },
      );
    }

    const actual = Number.isFinite(bytesLength) ? Number(bytesLength) : null;
    if (actual != null && actual > MAX_GITHUB_BLOB_BYTES) {
      throw new DriverError(
        `檔案過大：GitHub 單檔案最大 100MB（當前約 ${(actual / 1024 / 1024).toFixed(2)}MB）。請改用更小檔案、Git LFS，或更換儲存型別。`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || undefined, contentLength: actual, maxBytes: MAX_GITHUB_BLOB_BYTES },
        },
      );
    }
  }
}
