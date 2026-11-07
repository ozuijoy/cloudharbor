/**
 * GitHub API 驅動 tester
 *
 * 目標：
 * - 驗證 token + repo 可訪問
 * - 驗證 ref（分支）可解析
 * - 驗證讀能力（Contents API 列目錄）
 * - 驗證寫能力（對同一 sha 執行一次 refs PATCH 作為“無副作用寫許可權探測”）
 *
 * 說明：
 * - Git commit 無法像物件儲存那樣“寫入後無痕清理”，因此避免建立 commit。
 * - 如果分支受保護或 token 許可權不足，PATCH ref 可能失敗，此時驅動實際寫入也會失敗，故應明確提示。
 */

import { ValidationError } from "../../../../http/errors.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

const DEFAULT_API_BASE = "https://api.github.com";

const parseRefInput = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return { kind: "empty", value: null };
  if (raw.startsWith("refs/heads/")) return { kind: "branch", value: raw.slice("refs/heads/".length) };
  if (raw.startsWith("heads/")) return { kind: "branch", value: raw.slice("heads/".length) };
  if (raw.startsWith("refs/tags/")) return { kind: "tag", value: raw.slice("refs/tags/".length) };
  if (raw.startsWith("tags/")) return { kind: "tag", value: raw.slice("tags/".length) };
  if (raw.startsWith("refs/")) return { kind: "unsupported", value: raw };
  return { kind: "any", value: raw };
};

const encodeGitRefPath = (refName) =>
  String(refName || "")
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");

const normalizeFolderPrefix = (folder) => {
  if (!folder) return "";
  let f = String(folder).trim().replace(/\\+/g, "/");
  f = f.replace(/\/+/g, "/");
  f = f.replace(/^\/+/, "").replace(/\/+$/, "");
  if (f.includes("..")) {
    throw new ValidationError("default_folder 不允許包含 .. 段");
  }
  return f;
};

const buildHeaders = (token, extra = {}) => {
  const headers = {
    "User-Agent": "CloudHarbor-GithubApiTester",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

async function fetchJsonWithHeaders(url, token, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: buildHeaders(token, init.headers || {}),
  });

  let bodyText = null;
  let json = null;
  try {
    bodyText = await resp.text();
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  return { resp, json, bodyText };
}

export async function githubApiTestConnection(config, encryptionSecret, requestOrigin = null) {
  const owner = config?.owner;
  const repo = config?.repo;
  const tokenEncrypted = config?.token;
  const token = await decryptIfNeeded(tokenEncrypted, encryptionSecret);
  const apiBase = (config?.endpoint_url || DEFAULT_API_BASE).toString().replace(/\/+$/, "");
  const defaultFolder = config?.default_folder || "";

  if (!owner || !repo || !token) {
    throw new ValidationError("GitHub API 配置缺少必填欄位: owner/repo/token");
  }

  /** @type {{ read: any, write: any, info: any }} */
  const result = {
    repoAccess: { success: false, status: null, error: null, private: null },
    read: { success: false, error: null, prefix: "/", objectCount: 0, firstObjects: [] },
    write: { success: false, error: null, note: "透過 PATCH refs 到同一 sha 進行無副作用寫許可權探測" },
    info: {
      endpoint_url: apiBase,
      owner,
      repo,
      ref: config?.ref || null,
      defaultFolder: defaultFolder || "",
      ghProxy: config?.gh_proxy || null,
      repoPrivate: null,
      permissions: null,
      rateLimit: null,
      repoEmpty: null,
    },
  };

  const finalize = ({ success, message, extraChecks = [] }) => {
    const checks = [];

    // 1) 倉庫訪問
    if (result.repoAccess) {
      checks.push({
        key: "repo",
        label: "倉庫訪問",
        success: result.repoAccess.success === true,
        ...(result.repoAccess.error ? { error: result.repoAccess.error } : {}),
        items: [
          { key: "owner", label: "Owner", value: owner || "" },
          { key: "repo", label: "Repo", value: repo || "" },
          { key: "status", label: "狀態碼", value: result.repoAccess.status },
          ...(result.repoAccess.private != null ? [{ key: "private", label: "私有倉庫", value: result.repoAccess.private === true }] : []),
        ],
      });
    }

    // 2) 額外檢查（例如 ref 檢查）
    if (Array.isArray(extraChecks) && extraChecks.length) {
      checks.push(...extraChecks);
    }

    // 3) 讀寫
    checks.push({
      key: "read",
      label: "讀許可權",
      success: result.read.success === true,
      ...(result.read.error ? { error: result.read.error } : {}),
      items: [
        ...(result.read.prefix ? [{ key: "prefix", label: "目錄字首", value: result.read.prefix }] : []),
        ...(typeof result.read.objectCount === "number" ? [{ key: "objectCount", label: "物件數量", value: result.read.objectCount }] : []),
        ...(Array.isArray(result.read.firstObjects) && result.read.firstObjects.length
          ? [{ key: "sample", label: "示例物件", value: result.read.firstObjects }]
          : []),
      ],
    });
    checks.push({
      key: "write",
      label: "寫許可權",
      success: result.write.success === true,
      ...(result.write.skipped ? { skipped: true } : {}),
      ...(result.write.note ? { note: result.write.note } : {}),
      ...(result.write.error ? { error: result.write.error } : {}),
      items: [
        ...(result.write.headSha ? [{ key: "headSha", label: "HEAD SHA", value: result.write.headSha }] : []),
      ],
    });

    return { success, message, result: { info: result.info, checks } };
  };

  // 1) 倉庫元資訊（驗證 token & repo 可訪問）
  const repoUrl = `${apiBase}/repos/${owner}/${repo}`;
  const repoRes = await fetchJsonWithHeaders(repoUrl, token);
  if (!repoRes.resp.ok) {
    const msg = repoRes.json?.message || repoRes.bodyText || `HTTP ${repoRes.resp.status}`;
    result.repoAccess = { success: false, status: repoRes.resp.status, error: msg, private: null };
    result.read.success = false;
    result.read.error = msg;
    result.write.success = false;
    result.write.error = "倉庫不可訪問，跳過寫許可權探測";
    return finalize({ success: false, message: `GitHub API 配置測試失敗（倉庫不可訪問）: ${msg}` });
  }

  const repoMeta = repoRes.json || {};
  result.repoAccess = {
    success: true,
    status: repoRes.resp.status,
    error: null,
    private: typeof repoMeta.private === "boolean" ? repoMeta.private : null,
  };
  result.info.repoPrivate = !!repoMeta.private;
  if (repoMeta.permissions && typeof repoMeta.permissions === "object") {
    result.info.permissions = {
      admin: !!repoMeta.permissions.admin,
      maintain: !!repoMeta.permissions.maintain,
      push: !!repoMeta.permissions.push,
      triage: !!repoMeta.permissions.triage,
      pull: !!repoMeta.permissions.pull,
    };
  }

  const rl = {
    limit: repoRes.resp.headers.get("x-ratelimit-limit"),
    remaining: repoRes.resp.headers.get("x-ratelimit-remaining"),
    reset: repoRes.resp.headers.get("x-ratelimit-reset"),
  };
  if (rl.limit || rl.remaining || rl.reset) {
    result.info.rateLimit = rl;
  }

  // 1.5) 空倉庫判定（空倉庫常見返回 409: Git Repository is empty）
  try {
    const commitsUrl = new URL(`${apiBase}/repos/${owner}/${repo}/commits`);
    commitsUrl.searchParams.set("per_page", "1");
    const commitsRes = await fetchJsonWithHeaders(commitsUrl.toString(), token);
    const isEmpty =
      commitsRes.resp.status === 409 ||
      (commitsRes.resp.ok && Array.isArray(commitsRes.json) && commitsRes.json.length === 0);
    result.info.repoEmpty = isEmpty;
  } catch {
    result.info.repoEmpty = null;
  }

  // 2) 解析 ref：branch/tag/commit sha 均可；僅分支可寫
  const refRaw = config?.ref ? String(config.ref).trim() : String(repoMeta.default_branch || "").trim();
  const parsedRef = parseRefInput(refRaw);
  if (!parsedRef.value) {
    return finalize({
      success: false,
      message: "GitHub API 配置測試失敗：ref 不能為空",
      extraChecks: [{ key: "ref", label: "Ref 檢查", success: false, error: "ref 不能為空" }],
    });
  }
  if (parsedRef.kind === "unsupported") {
    return finalize({
      success: false,
      message: "GitHub API 配置測試失敗：ref 僅支援 refs/heads/*、heads/*、refs/tags/*、tags/* 或直接填寫值",
      extraChecks: [{ key: "ref", label: "Ref 檢查", success: false, error: "ref 字首不受支援" }],
    });
  }

  const resolvedRef = parsedRef.value;
  let isOnBranch = false;
  let resolvedBranch = null;

  // 嘗試把 ref 識別為分支（存在分支時啟用寫許可權探測；tag 明確保持只讀）
  if (parsedRef.kind !== "tag") {
    try {
      const headRefUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeGitRefPath(resolvedRef)}`;
      const headRefRes = await fetchJsonWithHeaders(headRefUrl, token);
      if (headRefRes.resp.ok) {
        isOnBranch = true;
        resolvedBranch = resolvedRef;
      } else if (parsedRef.kind === "branch") {
        // 空倉庫：refs/heads/<branch> 尚未建立，允許後續寫入時初始化
        if (result.info.repoEmpty === true) {
          isOnBranch = true;
          resolvedBranch = resolvedRef;
        } else {
          const msg = headRefRes.json?.message || headRefRes.bodyText || `HTTP ${headRefRes.resp.status}`;
          return finalize({
            success: false,
            message: `GitHub API 配置測試失敗：分支不存在或不可訪問: ${msg}`,
            extraChecks: [{ key: "ref", label: "Ref 檢查", success: false, error: msg }],
          });
        }
      } else if (result.info.repoEmpty === true) {
        // 空倉庫：無法透過 refs 判斷，預設按“分支名”處理（tags/sha 在空倉庫中不可用）
        isOnBranch = true;
        resolvedBranch = resolvedRef;
      }
    } catch (e) {
      if (parsedRef.kind === "branch") {
        if (result.info.repoEmpty === true) {
          isOnBranch = true;
          resolvedBranch = resolvedRef;
        } else {
          return finalize({
            success: false,
            message: `GitHub API 配置測試失敗：分支檢查異常: ${e?.message || String(e)}`,
            extraChecks: [{ key: "ref", label: "Ref 檢查", success: false, error: e?.message || String(e) }],
          });
        }
      }
    }
  }

  result.info.resolvedRef = resolvedRef;
  result.info.isOnBranch = isOnBranch;
  result.info.resolvedBranch = resolvedBranch;

  // 3) 讀測試：列出 default_folder 根目錄內容（Contents API）
  try {
    const folder = normalizeFolderPrefix(defaultFolder);
    const repoPath = folder ? `/${folder}` : "/";
    const contentsUrl = new URL(`${apiBase}/repos/${owner}/${repo}/contents${repoPath === "/" ? "" : repoPath}`);
    contentsUrl.searchParams.set("ref", resolvedRef);

    const contentsRes = await fetchJsonWithHeaders(contentsUrl.toString(), token, {
      headers: { Accept: "application/vnd.github.object+json" },
    });

    if (contentsRes.resp.ok) {
      const payload = contentsRes.json;
      const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.entries) ? payload.entries : [];
      result.read.success = true;
      result.read.prefix = repoPath;
      result.read.objectCount = entries.length;
      result.read.firstObjects = entries.slice(0, 3).map((item) => ({
        key: item?.name || "",
        size: typeof item?.size === "number" ? item.size : 0,
        lastModified: new Date(0).toISOString(),
        type: item?.type || "",
      }));
    } else {
      // 空倉庫：Contents 根目錄返回 404，視為“空目錄”
      if (result.info.repoEmpty === true && (contentsRes.resp.status === 404 || contentsRes.resp.status === 409)) {
        result.read.success = true;
        result.read.prefix = repoPath;
        result.read.objectCount = 0;
        result.read.firstObjects = [];
      } else {
        const msg = contentsRes.json?.message || contentsRes.bodyText || `HTTP ${contentsRes.resp.status}`;
        result.read.success = false;
        result.read.error = msg;
      }
    }
  } catch (error) {
    result.read.success = false;
    result.read.error = error?.message || String(error);
  }

  // 4) 寫測試：僅分支可做“無副作用寫許可權探測”
  if (!isOnBranch) {
    result.write.success = true;
    result.write.skipped = true;
    result.write.note = "ref 非分支（tag/commit sha），Git 引用不可移動，跳過寫許可權探測";
  } else if (result.info.repoEmpty === true) {
    result.write.success = true;
    result.write.skipped = true;
    result.write.note = "倉庫為空：無法對 refs 做“同 sha PATCH”探測；實際寫入將觸發初始化提交（建立首個 commit + refs/heads）";
  } else {
    try {
      const refUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeGitRefPath(resolvedBranch)}`;
      const refRes = await fetchJsonWithHeaders(refUrl, token);
      if (!refRes.resp.ok) {
        const msg = refRes.json?.message || refRes.bodyText || `HTTP ${refRes.resp.status}`;
        result.write.success = false;
        result.write.error = `讀取分支 HEAD 失敗: ${msg}`;
      } else {
        const headSha = refRes.json?.object?.sha || null;
        if (!headSha) {
          result.write.success = false;
          result.write.error = "讀取分支 HEAD 失敗：響應缺少 object.sha";
        } else {
          const patchUrl = `${apiBase}/repos/${owner}/${repo}/git/refs/heads/${encodeGitRefPath(resolvedBranch)}`;
          const patchRes = await fetchJsonWithHeaders(patchUrl, token, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sha: headSha, force: false }),
          });

          if (patchRes.resp.ok) {
            result.write.success = true;
            result.write.headSha = headSha;
          } else {
            const msg = patchRes.json?.message || patchRes.bodyText || `HTTP ${patchRes.resp.status}`;
            result.write.success = false;
            result.write.error = `寫許可權探測失敗: ${msg}`;
          }
        }
      }
    } catch (error) {
      result.write.success = false;
      result.write.error = error?.message || String(error);
    }
  }

  const basicConnectSuccess = result.read.success === true;
  const writeSuccess = result.write.success === true;
  const overallSuccess = basicConnectSuccess && writeSuccess;

  let message = "GitHub API 配置測試";
  if (basicConnectSuccess) {
    if (result.write?.skipped) {
      message += "成功 (已跳過寫許可權探測)";
    } else if (writeSuccess) {
      message += "成功 (讀寫許可權均可用)";
    } else {
      message += "部分成功 (僅讀許可權可用或分支寫入被限制)";
    }
  } else {
    message += "失敗 (讀取許可權不可用)";
  }

  return finalize({ success: overallSuccess, message });
}
