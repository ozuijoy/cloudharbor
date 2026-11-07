/**
 * FS 目錄 Meta 解析服務
 *
 * 職責：
 * - 從 fs_meta 表按路徑鏈獲取原始配置
 * - 按繼承規則摺疊為最終有效的 meta 結果
 *
 * 注意：
 * - 繼承規則遵循設計文件，避免前端重複實現
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";

const normalizePath = (path) => {
  if (!path || path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "") || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const buildPathChain = (path) => {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return ["/"];
  }

  const segments = normalized.split("/").filter(Boolean);
  const chain = ["/"];
  let current = "";

  for (const segment of segments) {
    current = `${current}/${segment}`;
    chain.push(current === "" ? "/" : current);
  }

  return Array.from(new Set(chain));
};

export class FsMetaService {
  /**
   * @param {D1Database} db
   * @param {import("../repositories").RepositoryFactory} [repositoryFactory]
   */
  constructor(db, repositoryFactory = null) {
    this.db = db;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
  }

  /**
   * 解析指定路徑的聚合 Meta
   * @param {string} path
   * @returns {Promise<{headerMarkdown?: string|null, footerMarkdown?: string|null, hidePatterns: string[], password?: string|null, passwordOwnerPath?: string|null}>}
   */
  async resolveMetaForPath(path) {
    const fsMetaRepository = this.repositoryFactory.getFsMetaRepository();
    const chain = buildPathChain(path);

    const records = await fsMetaRepository.findByPaths(chain);
    if (!records || records.length === 0) {
      return {
        headerMarkdown: null,
        footerMarkdown: null,
        hidePatterns: [],
        password: null,
      };
    }

    // 以路徑升序（從根到子目錄）摺疊
    const recordMap = new Map();
    for (const record of records) {
      if (record?.path) {
        recordMap.set(normalizePath(record.path), record);
      }
    }

    let effectiveHeader = null;
    let effectiveFooter = null;
    let effectivePassword = null;
    let passwordOwnerPath = null;
    /** @type {string[]} */
    let hidePatterns = [];

    for (const currentPath of chain) {
      const meta = recordMap.get(currentPath);
      if (!meta) {
        continue;
      }

      const isSelf = normalizePath(path) === normalizePath(currentPath);

      // header/footer：只要欄位非 null，則認為當前節點顯式宣告，遵循 inherit 規則
      if (typeof meta.header_markdown === "string") {
        if (isSelf || meta.header_inherit) {
          effectiveHeader = meta.header_markdown;
        }
      }

      if (typeof meta.footer_markdown === "string") {
        if (isSelf || meta.footer_inherit) {
          effectiveFooter = meta.footer_markdown;
        }
      }

      // hidePatterns：在繼承鏈上累積（父級 + 子級）
      if (meta.hide_patterns && (isSelf || meta.hide_inherit)) {
        try {
          const parsed = JSON.parse(meta.hide_patterns);
          if (Array.isArray(parsed)) {
            hidePatterns = [...hidePatterns, ...parsed.filter((x) => typeof x === "string")];
          }
        } catch {
          // 忽略解析錯誤，保持已有配置
        }
      }

      // password：僅在當前節點顯式提供非空值時覆蓋，並記錄密碼所屬路徑
      if (meta.password && (isSelf || meta.password_inherit)) {
        effectivePassword = meta.password;
        passwordOwnerPath = normalizePath(currentPath);
      }
    }

    // 去重 hidePatterns
    const uniquePatterns = [...new Set(hidePatterns.filter(Boolean))];

    return {
      headerMarkdown: effectiveHeader ?? null,
      footerMarkdown: effectiveFooter ?? null,
      hidePatterns: uniquePatterns,
      password: effectivePassword ?? null,
      passwordOwnerPath: effectivePassword ? passwordOwnerPath ?? normalizePath(path) : null,
    };
  }
}
