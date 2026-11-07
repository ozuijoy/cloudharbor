/**
 * GithubReleasesStorageDriver
 *
 * 設計目標：
 * - 將 GitHub Releases 對映為只讀的檔案系統檢視；
 * - 支援多倉庫掛載（repo_structure），按掛載路徑劃分“虛擬目錄”；
 * - 提供 READER 能力（listDirectory/getFileInfo/downloadFile/exists/stat）；
 * - 提供可選的 DIRECT_LINK 能力（generateDownloadUrl）和 PROXY 能力（generateProxyUrl），方便直鏈與本地代理訪問。
 *
 * 非目標（當前不實現）：
 * - 不支援上傳 / 刪除 / 修改 Releases 或 Release 資產（不宣告 WRITER/MULTIPART/ATOMIC 能力）；
 * - 不做複雜快取策略，優先保證語義清晰與實現簡單，如有需要後續可按需加快取。
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { DriverError, NotFoundError, AppError } from "../../../http/errors.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor, createWebStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";

const RELEASE_NOTES_FILENAME = "RELEASE_NOTES.md";

/**
 * @typedef {Object} GithubRepoMapping
 * @property {string} point           掛載內路徑字首（以 / 開頭）
 * @property {string} owner           GitHub 倉庫 owner
 * @property {string} repo            GitHub 倉庫名
 */

export class GithubReleasesStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  儲存配置物件
   * @param {string} encryptionSecret 加密金鑰（本驅動當前不使用，僅為介面一致）
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GITHUB_RELEASES";
    this.encryptionSecret = encryptionSecret;

    // 只讀 + 直鏈 + 代理能力
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.DIRECT_LINK,
      CAPABILITIES.PROXY,
    ];

    /** @type {GithubRepoMapping[]} */
    this.repos = [];
    this.showReadme = this._toBool(config?.show_readme, false);
    this.showAllVersion = this._toBool(config?.show_all_version, false);
    this.showSourceCode = this._toBool(config?.show_source_code, false);
    this.showReleaseNotes = this._toBool(config?.show_release_notes, false);
    this.token = config?.token || null;
    this.ghProxy = config?.gh_proxy || null;
    this.perPage = Number.isFinite(config?.per_page) && config.per_page > 0 ? config.per_page : 20;

    /**
     * 記憶體快取（按 repoKey）
     * @type {Map<string, {
     *   latest?: any,
     *   latestFetchedAt?: number,
     *   releases?: any[],
     *   releasesFetchedAt?: number,
     *   readme?: any,
     *   readmeFetchedAt?: number,
     *   license?: any,
     *   licenseFetchedAt?: number
     * }>}
     */
    this._releaseCache = new Map();
    // 倉庫元資訊快取（用於判定 private/public，避免頻繁請求 /repos/{owner}/{repo}）
    // key: "owner/repo" -> { meta: any|null, fetchedAt: number }
    this._repoMetaCache = new Map();

    this.apiBase = "https://api.github.com";

    // 瀏覽器偽裝客戶端
    this._masqueradeClient = new MasqueradeClient({
      deviceCategory: "desktop",
      rotateIP: false,
      rotateUA: false,
    });
  }

  /**
   * 獲取 UTF-8 位元組長度（用於虛擬文字檔案 size）
   * @param {string} text
   * @returns {number}
   */
  _getUtf8ByteLength(text) {
    if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
      return Buffer.byteLength(text, "utf8");
    }
    // Worker / Web runtime
    return new TextEncoder().encode(text).length;
  }

  /**
   * 初始化驅動：
   * - 解析 repo_structure 為內部的 repos 對映表；
   */
  async initialize() {
    // token 可能以 encrypted:* 存在（由儲存配置 CRUD 統一加密寫入）
    const decryptedToken = await decryptIfNeeded(this.token, this.encryptionSecret);
    this.token = typeof decryptedToken === "string" ? decryptedToken.trim() : decryptedToken;

    this._parseRepoStructure();
    this.initialized = true;
  }

  /**
   * 容錯布林解析：相容 0/1、"0"/"1"、"true"/"false" 等歷史/跨端寫入形態
   * @param {any} value
   * @param {boolean} defaultValue
   * @returns {boolean}
   */
  _toBool(value, defaultValue = false) {
    if (value === true) return true;
    if (value === false) return false;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true" || lowered === "yes" || lowered === "on") return true;
      if (lowered === "false" || lowered === "no" || lowered === "off") return false;
    }
    return defaultValue;
  }

  /**
   * GitHub API 拉取結果的記憶體快取 TTL
   * - refresh=true 時強制繞過快取
   * - 預設 60s；如 mount.cache_ttl 有效則使用 mount.cache_ttl
   * @param {{ mount?: any }} options
   * @returns {number} 毫秒
   */
  _getCacheTtlMs(options = {}) {
    const raw = options?.mount?.cache_ttl;
    const seconds = Number(raw);
    const normalizedSeconds = Number.isFinite(seconds) ? seconds : 60;
    if (normalizedSeconds <= 0) {
      return 0;
    }
    // 上限 1h，避免超長快取導致“重新整理不更新”的錯覺
    return Math.min(normalizedSeconds, 3600) * 1000;
  }

  /**
   * 解析 repo_structure 配置為內部結構
   * 配置格式（每行一條，忽略空行與以 # 開頭的行）：
   *   owner/repo                    （推薦，目錄名自動使用 repo）
   *   alias:owner/repo              （自定義目錄名 alias）
   *   https://github.com/owner/repo （可帶 /releases 等字尾）
   *
   * 示例：
   *   ling-drag0n/CloudHarbor
   *   cloudharbor:ling-drag0n/CloudHarbor
   *   https://github.com/owner/repo
   */
  _parseRepoStructure() {
    const raw = this.config?.repo_structure;
    if (!raw || typeof raw !== "string") {
      throw new DriverError("GitHub Releases 配置缺少 repo_structure 欄位", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
        expose: true,
      });
    }

    /** @type {GithubRepoMapping[]} */
    const mappings = [];

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    if (lines.length === 0) {
      throw new DriverError("GitHub Releases 配置 repo_structure 不能為空", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
        expose: true,
      });
    }

    /** @type {Array<{ owner: string, repo: string, alias: string|null, raw: string }>} */
    const parsed = [];

    for (const line of lines) {
      let displayNamePart = null;
      let repoPart = line;

      // 支援三種顯式格式：
      // 1）owner/repo（推薦）
      // 2）alias:owner/repo
      // 3）https://github.com/owner/repo（可帶 /releases 等字尾）
      // URL 形式（https://github.com/...）不參與別名分割，避免將 "https:" 誤判為別名
      if (!/^https?:\/\/github\.com\//i.test(line)) {
        const idx = line.indexOf(":");
        if (idx >= 0) {
          displayNamePart = line.slice(0, idx).trim();
          repoPart = line.slice(idx + 1).trim();
          if (!repoPart) {
            throw new DriverError(
              `GitHub Releases 配置行格式無效，應為 owner/repo、別名:owner/repo 或 https://github.com/owner/repo，當前為: ${line}`,
              {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
                expose: true,
              },
            );
          }
        }
      }

      let normalized = repoPart;
      if (/^https?:\/\/github\.com\//i.test(repoPart)) {
        normalized = repoPart.replace(/^https?:\/\/github\.com\//i, "");
      }

      // 為了規範輸入，不允許以 / 開頭的 owner/repo（例如 /owner/repo）
      if (normalized.startsWith("/")) {
        throw new DriverError(
          `GitHub Releases 配置行格式無效，不支援以 / 開頭的 owner/repo，請使用 owner/repo、別名:owner/repo 或完整倉庫 URL，當前為: ${line}`,
          {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
            expose: true,
          },
        );
      }

      const segments = normalized.split("/").filter((seg) => seg.length > 0);
      if (segments.length < 2) {
        throw new DriverError(`GitHub Releases 配置行缺少 owner/repo 資訊: ${line}`, {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
          expose: true,
        });
      }

      const owner = segments[0];
      const repo = segments[1];

      const alias = displayNamePart && displayNamePart.length > 0 ? displayNamePart : null;
      parsed.push({ owner, repo, alias, raw: line });
    }


    // - 單倉庫：允許使用 `owner/repo`（無別名）直接掛載到倉庫根目錄（point = "/"），不會額外產生一層 repo 目錄；
    // - 多倉庫：必須為每行配置別名（alias:owner/repo），避免多個倉庫在 "/" 下相互覆蓋。
    if (parsed.length > 1) {
      const noAlias = parsed.filter((item) => !item.alias);
      if (noAlias.length > 0) {
        const examples = noAlias.map((item) => `${item.owner}/${item.repo}`).join(", ");
        throw new DriverError(
          `GitHub Releases 多倉庫配置必須為每行指定別名（alias:owner/repo），當前存在無別名項: ${examples}`,
          {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
            expose: true,
          },
        );
      }
    }

    for (const item of parsed) {
      let point = "/";
      if (item.alias) {
        point = item.alias;
        if (!point.startsWith("/")) {
          point = "/" + point;
        }
        if (point.length > 1 && point.endsWith("/")) {
          point = point.replace(/\/+$/, "");
        }
      }

      mappings.push({ point, owner: item.owner, repo: item.repo });
    }

    this.repos = mappings;
  }

  /**
   * 規範化子路徑：保證以 / 開頭；根路徑統一為 "/"
   * @param {string} subPath
   * @returns {string}
   */
  _normalizeSubPath(subPath) {
    let value = subPath || "/";
    if (typeof value !== "string") {
      value = String(value);
    }
    if (!value.startsWith("/")) {
      value = "/" + value;
    }
    // 根路徑保持為 "/"
    if (value.length > 1 && value.endsWith("/")) {
      value = value.replace(/\/+$/, "");
      if (value === "") {
        value = "/";
      }
    }
    return value;
  }

  /**
   * 獲取下一級目錄名
   * @param {string} wholePath 目標路徑（如 /a/b）
   * @param {string} basePath  基礎路徑（如 /a）
   * @returns {string} nextDir（如 b），無則返回空串
   */
  _getNextDir(wholePath, basePath) {
    const whole = this._normalizeSubPath(wholePath);
    const base = this._normalizeSubPath(basePath);

    const basePrefix = base === "/" ? "/" : `${base.replace(/\/+$/, "")}/`;
    if (!whole.startsWith(basePrefix)) {
      return "";
    }
    const remaining = whole.slice(basePrefix.length).replace(/^\/+/, "");
    if (!remaining) return "";
    return remaining.split("/")[0] || "";
  }

  /**
   * 根據子路徑解析命中的倉庫及倉庫內相對路徑
   * @param {string} subPath 已規範化子路徑
   * @returns {{ repo: GithubRepoMapping, repoRelative: string } | null}
   */
  _resolveRepoPath(subPath) {
    const normalized = this._normalizeSubPath(subPath);
    let best = null;

    for (const repoMapping of this.repos) {
      const prefix = this._normalizeSubPath(repoMapping.point);

      // point = "/"：匹配所有路徑（更具體的 point 優先）
      if (prefix === "/") {
        const candidate = { repo: repoMapping, repoRelative: normalized, score: 1 };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        continue;
      }

      if (normalized === prefix) {
        const candidate = { repo: repoMapping, repoRelative: "/", score: prefix.length };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        continue;
      }

      if (normalized.startsWith(prefix + "/")) {
        const rest = normalized.slice(prefix.length);
        const repoRelative = rest.length > 0 ? rest : "/";
        const candidate = { repo: repoMapping, repoRelative, score: prefix.length };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    }

    return best ? { repo: best.repo, repoRelative: best.repoRelative } : null;
  }

  /**
   * 構建 GitHub API 請求頭
   * @param {Object} extra - 額外的請求頭
   * @param {string} targetUrl - 目標 URL，用於生成 Referer
   * @returns {Record<string,string>}
   */
  _buildHeaders(extra = {}, targetUrl = null) {
    const browserHeaders = this._masqueradeClient.buildHeaders({}, targetUrl);
    const headers = {
      ...browserHeaders,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token && typeof this.token === "string" && this.token.trim().length > 0) {
      headers.Authorization = `Bearer ${this.token.trim()}`;
    }
    return { ...headers, ...(extra || {}) };
  }

  /**
   * 呼叫 GitHub API 並返回 JSON 結果
   * @param {string} url
   * @returns {Promise<any>}
   */
  async _fetchJson(url) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: this._buildHeaders(),
      });

      if (resp.status === 404) {
        return null;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new DriverError(`GitHub API 請求失敗: ${resp.status}`, {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.GITHUB_API",
          expose: false,
          details: { url, status: resp.status, body: text },
        });
      }

      return await resp.json();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new DriverError("GitHub API 請求異常", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API",
        expose: false,
        details: { url, cause: error?.message },
      });
    }
  }

  /**
   * 拉取倉庫元資訊（用於判定私有倉庫），帶 TTL 快取
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchRepoMeta(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._repoMetaCache.get(key) || {};
    const now = Date.now();

    if (
      !refresh &&
      cacheTtlMs > 0 &&
      typeof entry.fetchedAt === "number" &&
      now - entry.fetchedAt < cacheTtlMs
    ) {
      return entry.meta ?? null;
    }

    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}`;
    const meta = await this._fetchJson(url);
    this._repoMetaCache.set(key, { meta: meta ?? null, fetchedAt: now });
    return meta ?? null;
  }

  /**
   * 獲取 repoKey 標識
   * @param {GithubRepoMapping} repo
   * @returns {string}
   */
  _getRepoKey(repo) {
    return `${repo.owner}/${repo.repo}`;
  }

  /**
   * 獲取最新 Release
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchLatestRelease(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const now = Date.now();
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      entry.latest &&
      typeof entry.latestFetchedAt === "number" &&
      now - entry.latestFetchedAt < cacheTtlMs
    ) {
      return entry.latest;
    }
    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/releases/latest`;
    const data = await this._fetchJson(url);
    const updated = { ...entry, latest: data, latestFetchedAt: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 獲取所有 Releases
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any[]>}
   */
  async _fetchReleases(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const now = Date.now();
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      Array.isArray(entry.releases) &&
      typeof entry.releasesFetchedAt === "number" &&
      now - entry.releasesFetchedAt < cacheTtlMs
    ) {
      return entry.releases;
    }
    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/releases?per_page=${this.perPage}`;
    const data = (await this._fetchJson(url)) || [];
    const updated = { ...entry, releases: data, releasesFetchedAt: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 獲取倉庫級文字檔案（README 或 LICENSE）後設資料
   * - kind = \"readme\" 呼叫 /repos/{owner}/{repo}/readme
   * - kind = \"license\" 呼叫 /repos/{owner}/{repo}/license
   * - 結果會快取在 _releaseCache 中，避免重複請求
   * @param {GithubRepoMapping} repo
   * @param {\"readme\"|\"license\"} kind
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchRepoTextFile(repo, kind, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const cacheKey = kind === 'readme' ? 'readme' : 'license';

    const now = Date.now();
    const fetchedAtKey = cacheKey === "readme" ? "readmeFetchedAt" : "licenseFetchedAt";
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      Object.prototype.hasOwnProperty.call(entry, cacheKey) &&
      typeof entry[fetchedAtKey] === "number" &&
      now - entry[fetchedAtKey] < cacheTtlMs
    ) {
      return entry[cacheKey] ?? null;
    }

    let url;
    if (kind === 'readme') {
      url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/readme`;
    } else {
      url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/license`;
    }

    const data = await this._fetchJson(url);
    const updated = { ...entry, [cacheKey]: data, [fetchedAtKey]: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 根據 tagName 獲取指定 Release
   * @param {GithubRepoMapping} repo
   * @param {string} tagName
   * @returns {Promise<any|null>}
   */
  async _fetchReleaseByTag(repo, tagName, options = {}) {
    const releases = await this._fetchReleases(repo, options);
    const found = releases.find((item) => item.tag_name === tagName);
    return found || null;
  }

  /**
   * 如配置了 gh_proxy，則對下載 URL 進行簡單代理替換
   * 約定：僅對以 https://github.com 開頭的 URL 進行 host 替換。
   * @param {string} url
   * @returns {string}
   */
  _applyProxy(url) {
    if (!this.ghProxy || typeof this.ghProxy !== "string") {
      return url;
    }
    const trimmed = this.ghProxy.trim().replace(/\/+$/, "");
    if (!trimmed) {
      return url;
    }
    return url.replace(/^https:\/\/github\.com/, trimmed);
  }

  /**
   * 構造子檔案路徑
   * @param {string} baseFsPath 當前目錄的掛載檢視路徑
   * @param {string} name      子項名稱
   * @returns {string}
   */
  _joinChildPath(baseFsPath, name) {
    const base = baseFsPath.endsWith("/") ? baseFsPath.replace(/\/+$/, "") : baseFsPath;
    return `${base}/${name}`;
  }

  /**
   * 列出目錄內容
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/db/...）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db, refresh = false } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const currentFsPath = ctx?.path;
    const cacheTtlMs = this._getCacheTtlMs({ mount });

    /** @type {Array<Object>} */
    const items = [];

    // 目錄去重：同一路徑下不同 repo 可能需要共同建立同名的中間目錄
    const dirNameSet = new Set();

    // 記錄是否命中任何 repo / 中間目錄 / tag 目錄（用於 NotFound 判定）
    let matched = false;

    const basePrefix = normalizedSubPath === "/" ? "/" : `${normalizedSubPath.replace(/\/+$/, "")}/`;

    const addVirtualDirectory = async (name) => {
      if (!name || dirNameSet.has(name)) {
        return;
      }
      dirNameSet.add(name);
      const dirPath = this._joinChildPath(currentFsPath, name);
      const info = await buildFileInfo({
        fsPath: dirPath,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      items.push({
        ...info,
        isVirtual: true,
      });
    };

    for (const repoMapping of this.repos) {
      const point = this._normalizeSubPath(repoMapping.point);

      // 1) 當前目錄是 repo 根目錄：輸出 repo 內容
      if (point === normalizedSubPath) {
        matched = true;

        if (this.showAllVersion) {
          const releases = await this._fetchReleases(repoMapping, { refresh, cacheTtlMs });
          const promises = releases.map(async (release) => {
            const dirName = release.tag_name || release.name || `release-${release.id}`;
            const dirPath = this._joinChildPath(currentFsPath, dirName);
            const modified = release.published_at ? new Date(release.published_at) : null;
            const info = await buildFileInfo({
              fsPath: dirPath,
              name: dirName,
              isDirectory: true,
              size: null,
              modified,
              mimetype: "application/x-directory",
              mount,
              storageType: mount?.storage_type,
              db,
            });
            return {
              ...info,
              isVirtual: true,
            };
          });

          for (const item of await Promise.all(promises)) {
            items.push(item);
          }
        } else {
          // 關閉 show_all_version：只展示最新版本的資產列表（扁平檔案列表）
          const latest = await this._fetchLatestRelease(repoMapping, { refresh, cacheTtlMs });
          if (latest) {
            const assetInfos = await this._buildAssetsFileInfos(latest, currentFsPath, mount, db);
            for (const entry of assetInfos) {
              items.push(entry);
            }
          }
        }

        if (this.showReadme) {
          const extra = await this._buildReadmeAndLicenseEntries(repoMapping, currentFsPath, mount, db, {
            refresh,
            cacheTtlMs,
          });
          for (const entry of extra) {
            items.push(entry);
          }
        }

        continue;
      }

      // 2) 當前目錄是 repo 掛載點的祖先目錄：建立中間目錄
      if (point.startsWith(basePrefix)) {
        const nextDir = this._getNextDir(point, normalizedSubPath);
        if (nextDir) {
          matched = true;
          await addVirtualDirectory(nextDir);
        }
        continue;
      }

      // 3) showAllVersion 模式：當前目錄可能是 tag 目錄（repoPoint 的子目錄）
      if (this.showAllVersion) {
        const pointPrefix = point === "/" ? "/" : `${point.replace(/\/+$/, "")}/`;
        if (!normalizedSubPath.startsWith(pointPrefix)) {
          continue;
        }
        const repoRelative = point === "/" ? normalizedSubPath : normalizedSubPath.slice(point.length);
        const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
        const segments = relativeWithoutSlash.split("/").filter(Boolean);
        if (segments.length !== 1) {
          continue;
        }

        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repoMapping, tagName, { refresh, cacheTtlMs });
        if (!release) {
          continue;
        }

        matched = true;
        const assetInfos = await this._buildAssetsFileInfos(release, currentFsPath, mount, db);
        for (const entry of assetInfos) {
          items.push(entry);
        }
      }
    }

    if (!matched) {
      throw new NotFoundError("目錄不存在");
    }

    return {
      path: currentFsPath,
      type: "directory",
      isRoot: normalizedSubPath === "/",
      isVirtual: true,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  /**
   * 構造指定 Release 的資產 FileInfo 列表
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildAssetsFileInfos(release, baseFsPath, mount, db) {
    const items = [];

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const assetPromises = assets.map(async (asset) => {
      const name = asset.name || "asset";
      const fsPath = this._joinChildPath(baseFsPath, name);
      const size = typeof asset.size === "number" ? asset.size : 0;
      const modified = asset.updated_at ? new Date(asset.updated_at) : null;
      const info = await buildFileInfo({
        fsPath,
        name,
        isDirectory: false,
        size,
        modified,
        mimetype: getMimeTypeFromFilename(name),
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: false,
        // 為後續生成直鏈提供後設資料（不在契約內，但有用）
        _github: {
          downloadUrl: asset.browser_download_url,
        },
      };
    });

    for (const item of await Promise.all(assetPromises)) {
      items.push(item);
    }

    // 可選：將 Source code (zip/tar.gz) 作為虛擬檔案掛入目錄
    if (this.showSourceCode) {
      const srcItems = await this._buildSourceCodeEntries(release, baseFsPath, mount, db);
      for (const entry of srcItems) {
        items.push(entry);
      }
    }

    // 可選：將 Release Notes 作為虛擬檔案掛入目錄（避免與同名資產衝突）
    if (this.showReleaseNotes && !assets.some((a) => a && a.name === RELEASE_NOTES_FILENAME)) {
      const notes = await this._buildReleaseNotesEntry(release, baseFsPath, mount, db);
      if (notes) {
        items.push(notes);
      }
    }

    return items;
  }

  /**
   * 構造 Release Notes 偽檔案條目
   * - 僅當 release.body 非空時生成，避免出現“空殼檔案”造成困惑
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Object|null>}
   */
  async _buildReleaseNotesEntry(release, baseFsPath, mount, db) {
    const body = typeof release?.body === "string" ? release.body : "";
    if (!body || body.trim().length === 0) {
      return null;
    }

    const name = RELEASE_NOTES_FILENAME;
    const fsPath = this._joinChildPath(baseFsPath, name);
    const modified = release?.published_at
      ? new Date(release.published_at)
      : release?.created_at
      ? new Date(release.created_at)
      : null;
    const size = this._getUtf8ByteLength(body);

    const info = await buildFileInfo({
      fsPath,
      name,
      isDirectory: false,
      size,
      modified,
      mimetype: "text/markdown",
      mount,
      storageType: mount?.storage_type,
      db,
    });

    return {
      ...info,
      isVirtual: true,
    };
  }

  /**
   * 構造 Source code 偽檔案條目
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildSourceCodeEntries(release, baseFsPath, mount, db) {
    const results = [];
    const createdAt = release.created_at ? new Date(release.created_at) : null;

    const entries = [
      { name: "Source code (zip)", url: release.zipball_url },
      { name: "Source code (tar.gz)", url: release.tarball_url },
    ].filter((item) => typeof item.url === "string" && item.url.length > 0);

    const promises = entries.map(async (entry) => {
      const fsPath = this._joinChildPath(baseFsPath, entry.name);
      const isZip = entry.name.includes("(zip)");
      const mimetype = isZip ? "application/zip" : "application/gzip";
      const info = await buildFileInfo({
        fsPath,
        name: entry.name,
        isDirectory: false,
        // 無法獲得準確大小，統一標記為 1
        size: 1,
        modified: createdAt,
        mimetype,
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
        _github: {
          downloadUrl: entry.url,
        },
      };
    });

    for (const item of await Promise.all(promises)) {
      results.push(item);
    }

    return results;
  }

  /**
   * 構造 README / LICENSE 偽檔案條目（倉庫級別）
   * @param {GithubRepoMapping} repo
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildReadmeAndLicenseEntries(repo, baseFsPath, mount, db, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const results = [];

    const [readmeMeta, licenseMeta] = await Promise.all([
      this._fetchRepoTextFile(repo, "readme", { refresh, cacheTtlMs }),
      this._fetchRepoTextFile(repo, "license", { refresh, cacheTtlMs }),
    ]);

    const pushFromMeta = async (meta, fallbackName, mimetype) => {
      if (!meta || typeof meta !== "object" || typeof meta.download_url !== "string") {
        return;
      }
      const name = typeof meta.name === "string" && meta.name.length > 0 ? meta.name : fallbackName;
      const fsPath = this._joinChildPath(baseFsPath, name);
      const size = typeof meta.size === "number" ? meta.size : 0;
      const modified = meta.updated_at ? new Date(meta.updated_at) : null;

      const info = await buildFileInfo({
        fsPath,
        name,
        isDirectory: false,
        size,
        modified,
        mimetype,
        mount,
        storageType: mount?.storage_type,
        db,
      });

      results.push({
        ...info,
        isVirtual: true,
      });
    };

    await pushFromMeta(readmeMeta, "README.md", "text/markdown");
    await pushFromMeta(licenseMeta, "LICENSE", "text/plain");

    return results;
  }

  /**
   * 根據路徑解析資產資訊（用於 getFileInfo / exists / downloadFile / generateDownloadUrl）
   * @param {string} subPath
   * @param {{ mount?: any, refresh?: boolean }} [options]
   * @returns {Promise<{ repo: GithubRepoMapping, release: any, assetName: string, asset: any|null, isSourceCode: boolean, isReleaseNotes: boolean } | null>}
   */
  async _resolveAssetBySubPath(subPath, options = {}) {
    const { mount, refresh = false } = options;
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      return null;
    }
    const { repo, repoRelative } = resolved;

    const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
    if (!relativeWithoutSlash) {
      // 指向倉庫根目錄，而不是具體檔案
      return null;
    }

    const segments = relativeWithoutSlash.split("/").filter(Boolean);

    // 倉庫根目錄下的 README / LICENSE 虛擬檔案解析
    if (this.showReadme && segments.length === 1) {
      const candidate = segments[0];
      const [readmeMeta, licenseMeta] = await Promise.all([
        this._fetchRepoTextFile(repo, "readme", { refresh, cacheTtlMs }),
        this._fetchRepoTextFile(repo, "license", { refresh, cacheTtlMs }),
      ]);

      const matchMeta =
        (readmeMeta && readmeMeta.name === candidate && readmeMeta) ||
        (licenseMeta && licenseMeta.name === candidate && licenseMeta) ||
        null;

      if (matchMeta && typeof matchMeta.download_url === "string") {
        const assetLike = {
          name: candidate,
          browser_download_url: matchMeta.download_url,
          size: typeof matchMeta.size === "number" ? matchMeta.size : 0,
          updated_at: matchMeta.updated_at || null,
        };

        return {
          repo,
          release: null,
          assetName: candidate,
          asset: assetLike,
          isSourceCode: false,
          isReleaseNotes: false,
        };
      }
    }

    let assetName = "";
    let release = null;

    if (this.showAllVersion) {
      // show_all_version：/<tag>/<asset>
      if (segments.length < 2) {
        return null;
      }
      const tagName = segments[0];
      const rest = segments.slice(1);

      assetName = rest.join("/");
      if (!assetName) {
        return null;
      }
      release = await this._fetchReleaseByTag(repo, tagName, { refresh, cacheTtlMs });
      if (!release) {
        return null;
      }
    } else {
      assetName = segments.join("/");
      if (!assetName) {
        return null;
      }
      release = await this._fetchLatestRelease(repo, { refresh, cacheTtlMs });
      if (!release) {
        return null;
      }
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item.name === assetName) || null;

    // Release Notes 偽檔案（優先於 Source code 邏輯，避免被誤判為“不存在”）
    if (!asset && this.showReleaseNotes && assetName === RELEASE_NOTES_FILENAME) {
      const body = typeof release?.body === "string" ? release.body : "";
      if (!body || body.trim().length === 0) {
        return null;
      }
      return {
        repo,
        release,
        assetName,
        asset: null,
        isSourceCode: false,
        isReleaseNotes: true,
      };
    }

    // Source code 偽檔案
    let isSourceCode = false;
    if (!asset && this.showSourceCode) {
      if (assetName === "Source code (zip)" && release.zipball_url) {
        isSourceCode = true;
      } else if (assetName === "Source code (tar.gz)" && release.tarball_url) {
        isSourceCode = true;
      } else {
        return null;
      }
    }

    return {
      repo,
      release,
      assetName,
      asset,
      isSourceCode,
      isReleaseNotes: false,
    };
  }

  /**
   * 獲取檔案或目錄資訊
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/db/...）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const path = ctx?.path;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    // 根目錄：作為目錄處理
    if (normalizedSubPath === "/") {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    // repo_structure 中間目錄 / repo 根目錄：作為虛擬目錄處理
    const structuralPrefix = `${normalizedSubPath.replace(/\/+$/, "")}/`;
    const isStructuralDir = this.repos.some((repoMapping) => {
      const point = this._normalizeSubPath(repoMapping.point);
      if (point === normalizedSubPath) return true;
      if (normalizedSubPath !== "/" && point.startsWith(structuralPrefix)) return true;
      return false;
    });

    if (isStructuralDir) {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      throw new NotFoundError("檔案或目錄不存在");
    }

    const { repo, repoRelative } = resolved;
    const isRepoRoot = repoRelative === "/" || repoRelative === "";
    if (isRepoRoot) {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    // showAllVersion 模式：tag 目錄視為虛擬目錄（按 tagName 命名）
    if (this.showAllVersion) {
      const cacheTtlMs = this._getCacheTtlMs({ mount });
      const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
      const segments = relativeWithoutSlash.split("/").filter(Boolean);

      if (segments.length === 1) {
        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repo, tagName, { cacheTtlMs });
        if (release) {
          const modified = release?.published_at ? new Date(release.published_at) : null;
          const info = await buildFileInfo({
            fsPath: path,
            name: tagName,
            isDirectory: true,
            size: null,
            modified,
            mimetype: "application/x-directory",
            mount,
            storageType: mount?.storage_type,
            db,
          });
          return {
            ...info,
            isVirtual: true,
          };
        }
      }
    }

    // 嘗試解析為資產
    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("檔案不存在");
    }

    const { assetName, asset, release, isSourceCode, isReleaseNotes } = assetResolved;
    const isDirectory = false;
    const size = isReleaseNotes
      ? this._getUtf8ByteLength(typeof release?.body === "string" ? release.body : "")
      : asset && typeof asset.size === "number"
      ? asset.size
      : 0;
    const modified = asset?.updated_at
      ? new Date(asset.updated_at)
      : release?.published_at
      ? new Date(release.published_at)
      : null;

    const info = await buildFileInfo({
      fsPath: path,
      name: assetName,
      isDirectory,
      size,
      modified,
      mimetype: isReleaseNotes ? "text/markdown" : isSourceCode ? (assetName.includes("(zip)") ? "application/zip" : "application/gzip") : getMimeTypeFromFilename(assetName),
      mount,
      storageType: mount?.storage_type,
      db,
    });

    return {
      ...info,
      isVirtual: isSourceCode || isReleaseNotes,
    };
  }

  /**
   * stat 語義與 getFileInfo 保持一致
   * @param {string} subPath
   * @param {Object} ctx
   */
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  /**
   * 檢查檔案或目錄是否存在
   * @param {string} subPath
   * @param {Object} ctx
   * @returns {Promise<boolean>}
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    if (normalizedSubPath === "/") {
      return true;
    }

    // repo_structure 中間目錄 / repo 根目錄：視為存在
    const structuralPrefix = `${normalizedSubPath.replace(/\/+$/, "")}/`;
    const isStructuralDir = this.repos.some((repoMapping) => {
      const point = this._normalizeSubPath(repoMapping.point);
      if (point === normalizedSubPath) return true;
      if (normalizedSubPath !== "/" && point.startsWith(structuralPrefix)) return true;
      return false;
    });
    if (isStructuralDir) {
      return true;
    }

    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      return false;
    }

    const { repo, repoRelative } = resolved;
    if (repoRelative === "/" || repoRelative === "") {
      return true;
    }

    if (this.showAllVersion) {
      const cacheTtlMs = this._getCacheTtlMs({ mount });
      const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
      const segments = relativeWithoutSlash.split("/").filter(Boolean);

      // tag 目錄：/<tag>
      if (segments.length === 1) {
        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repo, tagName, { cacheTtlMs });
        if (release) {
          return true;
        }
      }
    }

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    return !!assetResolved;
  }

  /**
   * 下載檔案，返回 StorageStreamDescriptor
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/...）
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount } = ctx;
    const path = ctx?.path;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("檔案不存在");
    }

    const { repo, assetName, asset, release, isSourceCode, isReleaseNotes } = assetResolved;

    if (isReleaseNotes) {
      const body = typeof release?.body === "string" ? release.body : "";
      const encoder = new TextEncoder();
      const bytes = encoder.encode(body);
      const lastModified = release?.published_at ? new Date(release.published_at) : null;

      return createWebStreamDescriptor({
        openStream: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        size: bytes.length,
        contentType: "text/markdown; charset=utf-8",
        etag: null,
        lastModified,
      });
    }

    let rawUrl = "";
    // 私有倉庫：資產的 browser_download_url 需要登入態（不支援 Bearer token），必須使用 API 資產下載端點
    // - Releases API：GET /repos/{owner}/{repo}/releases/assets/{asset_id}（Accept: application/octet-stream）
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const repoMeta = await this._fetchRepoMeta(repo, { refresh: false, cacheTtlMs });
    const isPrivateRepo = !!(repoMeta && repoMeta.private === true);

    const hasToken = !!(this.token && typeof this.token === "string" && this.token.trim().length > 0);

    if (asset) {
      // 優先使用 API url（私庫必須；公庫在有 token 時也可用，但會增加 API 壓力，因此預設仍用 browser_download_url）
      if ((isPrivateRepo || hasToken) && asset.url) {
        rawUrl = asset.url;
      } else if (asset.browser_download_url) {
        rawUrl = asset.browser_download_url;
      }
    } else if (isSourceCode) {
      if (assetResolved.assetName === "Source code (zip)" && release.zipball_url) {
        rawUrl = release.zipball_url;
      } else if (assetResolved.assetName === "Source code (tar.gz)" && release.tarball_url) {
        rawUrl = release.tarball_url;
      }
    }

    if (!rawUrl) {
      throw new DriverError("找不到可用的 GitHub 下載地址", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_DOWNLOAD_URL_MISSING",
        expose: false,
      });
    }

    const finalUrl = this._applyProxy(rawUrl);
    const size = asset && typeof asset.size === "number" ? asset.size : null;

    const contentType = isSourceCode
      ? assetName.includes("(zip)")
        ? "application/zip"
        : "application/gzip"
      : getMimeTypeFromFilename(assetName);
    const lastModified = release?.published_at ? new Date(release.published_at) : null;

    const downloadHeaders = (extra = {}) => {
      // 使用 API 資產下載端點時必須 Accept octet-stream，否則會返回 JSON 元資訊
      const isAssetApiUrl = /^https?:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+/i.test(finalUrl);
      if (isAssetApiUrl) {
        return this._buildHeaders({ Accept: "application/octet-stream", ...extra });
      }
      return this._buildHeaders(extra);
    };

    return createHttpStreamDescriptor({
      fetchResponse: async (signal) => {
        const resp = await fetch(finalUrl, {
          method: "GET",
          headers: downloadHeaders(),
          signal,
        });
        return resp;
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        const resp = await fetch(finalUrl, {
          method: "GET",
          headers: downloadHeaders({ Range: rangeHeader }),
          signal,
        });
        return resp;
      },
      fetchHeadResponse: async (signal) => {
        const resp = await fetch(finalUrl, {
          method: "HEAD",
          headers: downloadHeaders(),
          signal,
        });
        return resp;
      },
      size,
      contentType,
      etag: null,
      lastModified,
      supportsRange: true,
    });
  }

  /**
   * 生成下載直鏈（DIRECT_LINK 能力）
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/subPath/mount/request/forceDownload/...）
   * @returns {Promise<{url:string,type:string,expiresIn?:number|null}>}
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const { mount } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("檔案不存在");
    }

    const { repo, asset, release, isSourceCode, isReleaseNotes } = assetResolved;

    // 私有倉庫：瀏覽器側無法攜帶 GitHub token（也不應洩露），因此直鏈不可用，強制走本地 /api/p 代理
    // - 對公共倉庫仍保留直鏈能力，減少後端流量
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const repoMeta = await this._fetchRepoMeta(repo, { refresh: false, cacheTtlMs });
    if (repoMeta && repoMeta.private === true) {
      // generateDownloadUrl 只能返回瀏覽器可用直鏈（custom_host/native_direct）
      // 私有倉庫無法給出瀏覽器可用直鏈（需要 token），這裡必須 fail-fast，交給上層降級到 proxy。
      throw new DriverError("GitHub 私有倉庫無法生成瀏覽器可用直鏈，請走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_RELEASES_DIRECT_LINK_NOT_AVAILABLE",
        expose: true,
        details: { path: fsPath, subPath: normalizedSubPath, owner: repo.owner, repo: repo.repo },
      });
    }

    // Release Notes 屬於虛擬檔案：不具備 GitHub 側可用直鏈
    // - FsLinkStrategy 會捕獲異常並自動降級到 PROXY 能力（/api/p）
    if (isReleaseNotes) {
      // 虛擬檔案沒有上游可直出的 URL：必須 fail-fast，交給上層統一走 proxy
      throw new DriverError("Release Notes 為虛擬檔案：無法生成瀏覽器可用直鏈，請走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_RELEASES_VIRTUAL_FILE_NO_DIRECT_LINK",
        expose: true,
        details: { path: fsPath, subPath: normalizedSubPath },
      });
    }

    let rawUrl = "";
    if (asset && asset.browser_download_url) {
      rawUrl = asset.browser_download_url;
    } else if (isSourceCode) {
      if (assetResolved.assetName === "Source code (zip)" && release.zipball_url) {
        rawUrl = release.zipball_url;
      } else if (assetResolved.assetName === "Source code (tar.gz)" && release.tarball_url) {
        rawUrl = release.tarball_url;
      }
    }

    if (!rawUrl) {
      throw new DriverError("找不到可用的 GitHub 下載地址", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_DOWNLOAD_URL_MISSING",
        expose: false,
      });
    }

    const finalUrl = this._applyProxy(rawUrl);

    return {
      url: finalUrl,
      type: "native_direct",
      expiresIn: ctx.expiresIn || null,
    };
  }

  /**
   * 生成本地 /api/p 代理 URL（PROXY 能力）
   * @param {string} subPath 掛載內子路徑（subPath-only）
   * @param {Object} ctx     上下文選項（path/request/download/channel/...）
   * @returns {Promise<{url:string,type:string,channel:string}>}
   */
  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    const proxyUrl = buildFullProxyUrl(request || null, fsPath, download);
    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * 推斷倉庫目錄展示名稱：
   * - 優先使用 point 的最後一段；
   * - 若 point 為根（/），退化為 owner/repo。
   * @param {GithubRepoMapping} repo
   * @returns {string}
   */
  _inferRepoName(repo) {
    if (repo.point && repo.point !== "/") {
      const segments = repo.point.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[segments.length - 1];
      }
    }
    return `${repo.owner}/${repo.repo}`;
  }

  /**
   * 從掛載檢視路徑推斷目錄名稱
   * @param {string} fsPath
   * @param {boolean} isDirectory
   * @returns {string}
   */
  _inferNameFromFsPath(fsPath, isDirectory) {
    if (!fsPath || typeof fsPath !== "string") {
      return isDirectory ? "" : "file";
    }
    let normalized = fsPath;
    if (isDirectory && normalized.endsWith("/")) {
      normalized = normalized.replace(/\/+$/, "");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      return isDirectory ? "" : "file";
    }
    return segments[segments.length - 1];
  }
}
