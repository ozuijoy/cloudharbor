/**
 * HuggingFace Datasets（Hub）驅動 tester
 *
 * 1) 能不能訪問到資料集（read）
 * 2) 如果配置了 token：token 是否有效、refs 能不能查（輔助判斷是否可寫）
 *
 */

import { ValidationError } from "../../../../http/errors.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";
import { normalizeBaseUrl, normalizeFolderPath, normalizeRepoId, splitRepoId } from "../hfUtils.js";
import { buildAuthHeaders, buildRefsApiUrl, buildTreeApiUrlWithQuery, getRevisionKind } from "../hfHubApi.js";

async function fetchJson(url, token, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: buildAuthHeaders(token, init?.headers || {}),
  });
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

export async function huggingFaceDatasetsTestConnection(config, encryptionSecret, _requestOrigin = null) {
  // endpoint_url 是可選的：
  // - 使用者沒填：預設走 https://huggingface.co
  // - 這裡會在測試結果裡展示“實際使用的端點地址”，方便排查代理/映象問題
  const endpointConfiguredRaw = config?.endpoint_url ? String(config.endpoint_url).trim() : "";
  const endpointBase = normalizeBaseUrl(endpointConfiguredRaw);
  const repo = normalizeRepoId(config?.repo);
  const repoParts = splitRepoId(repo);
  const revision = String(config?.revision || "main").trim() || "main";
  const tokenEncrypted = config?.hf_token;
  const tokenRaw = await decryptIfNeeded(tokenEncrypted, encryptionSecret);
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() || null : null;
  const defaultFolder = normalizeFolderPath(config?.default_folder);
  const expand = config?.hf_use_paths_info === true;
  const limitRaw = config?.hf_tree_limit;
  const limit = limitRaw != null && limitRaw !== "" && Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : null;

  if (!repo) {
    throw new ValidationError("HuggingFace Datasets 配置缺少 repo（例如 Open-Orca/OpenOrca）");
  }
  if (!repoParts?.namespace || !repoParts?.repo) {
    throw new ValidationError("repo 格式無效，應為 owner/name（例如 Open-Orca/OpenOrca）");
  }

  const result = {
    info: {
      endpoint_url: endpointBase,
      repo,
      revision,
      defaultFolder: defaultFolder || "",
      hasToken: !!token,
    },
    read: { success: false, error: null, note: "讀取測試：獲取資料集資訊 + tree 列目錄" },
    write: {
      success: false,
      error: null,
      note: "寫入測試：這裡只做“可寫可能性判斷”",
      likelyWritable: false,
      revisionKind: null,
      skipped: false,
    },
  };

  const finalize = ({ success, message }) => {
    const checks = [
      {
        key: "read",
        label: "讀許可權",
        success: result.read.success === true,
        ...(result.read.note ? { note: result.read.note } : {}),
        ...(result.read.error ? { error: result.read.error } : {}),
        items: [
          ...(typeof result.read.objectCount === "number" ? [{ key: "objectCount", label: "物件數量", value: result.read.objectCount }] : []),
          ...(Array.isArray(result.read.sample) && result.read.sample.length ? [{ key: "sample", label: "目錄樣本", value: result.read.sample }] : []),
        ],
      },
      {
        key: "write",
        label: "寫許可權",
        success: result.write.success === true,
        ...(result.write.skipped ? { skipped: true } : {}),
        ...(result.write.note ? { note: result.write.note } : {}),
        ...(result.write.error ? { error: result.write.error } : {}),
        items: [
          ...(typeof result.write.likelyWritable === "boolean" ? [{ key: "likelyWritable", label: "可能可寫", value: result.write.likelyWritable === true }] : []),
          ...(result.write.revisionKind ? [{ key: "revisionKind", label: "版本型別", value: result.write.revisionKind }] : []),
        ],
      },
    ];

    return { success, message, result: { info: result.info, checks } };
  };

  // 1) 資料集資訊：驗證 repo 可訪問 + 判斷是否 private/gated
  const repoEncoded = repo
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const infoUrl = `${endpointBase}/api/datasets/${repoEncoded}`;
  const infoRes = await fetchJson(infoUrl, token, { method: "GET", headers: { Accept: "application/json" } });

  if (infoRes.resp.status === 404) {
    result.read.success = false;
    result.read.error = "資料集不存在，或你沒有許可權訪問（404）";
    return finalize({ success: false, message: "HuggingFace 測試失敗：資料集不存在或無許可權訪問" });
  }

  // 沒 token 的情況下，如果是 private/gated，常見會 401/403
  if ((infoRes.resp.status === 401 || infoRes.resp.status === 403) && !token) {
    result.read.success = false;
    result.read.error = "資料集需要 token 才能訪問（private/gated）";
    return finalize({ success: false, message: "HuggingFace 測試失敗：該資料集需要配置 HF_TOKEN 才能讀取" });
  }

  if (!infoRes.resp.ok) {
    const msg = infoRes.json?.error || infoRes.json?.message || infoRes.text || `HTTP ${infoRes.resp.status}`;
    result.read.success = false;
    result.read.error = msg;
    return finalize({ success: false, message: `HuggingFace 測試失敗：無法讀取資料集資訊（HTTP ${infoRes.resp.status}）` });
  }

  const isPrivate = infoRes.json?.private === true;
  const isGated =
    infoRes.json?.gated === true ||
    infoRes.json?.gated_dataset === true ||
    infoRes.json?.gatedRepo === true ||
    infoRes.json?.gated_repo === true;
  result.info.isPrivate = isPrivate;
  result.info.isGated = isGated;

  // 2) tree 列目錄：驗證“讀鏈路”能跑通（預設不強行指定 limit，避免誤報）
  const repoPath = defaultFolder || "";
  const treeUrl = buildTreeApiUrlWithQuery(
    { endpointBase, repoId: repo, revision, repoPath },
    { expand, recursive: false, limit, cursor: null },
  );
  const treeRes = await fetchJson(treeUrl, token, { method: "GET", headers: { Accept: "application/json" } });

  if (treeRes.resp.status === 401 || treeRes.resp.status === 403) {
    result.read.success = false;
    result.read.error = token ? "token 可能無許可權，或 gated 未透過" : "需要 token（private/gated）";
    return finalize({ success: false, message: "HuggingFace 測試失敗：tree 列目錄被拒絕（401/403）" });
  }
  if (!treeRes.resp.ok) {
    result.read.success = false;
    result.read.error = treeRes.json?.error || treeRes.text || `HTTP ${treeRes.resp.status}`;
    return finalize({ success: false, message: `HuggingFace 測試失敗：tree 列目錄失敗（HTTP ${treeRes.resp.status}）` });
  }

  const entries = Array.isArray(treeRes.json) ? treeRes.json : [];
  result.read.success = true;
  result.read.objectCount = entries.length;
  result.read.sample = entries.slice(0, 3).map((it) => ({
    type: it?.type || null,
    path: it?.path || null,
    size: typeof it?.size === "number" ? it.size : null,
  }));

  // 3) “可寫可能性判斷”（不做真實寫入）
  if (!token) {
    result.write.skipped = true;
    result.write.likelyWritable = false;
    result.write.revisionKind = null;
    return finalize({ success: true, message: "HuggingFace 測試成功（讀可用；未配置 token，寫入會被禁用）" });
  }

  // refs：用於判斷 revision 是 branch/tag/commit（commit sha 明確不可寫）
  try {
    const kind = await getRevisionKind(
      {
        _endpointBase: endpointBase,
        _repo: repo,
        _repoParts: repoParts,
        _revision: revision,
        _token: token,
        _refsCache: { expiresAt: 0, branches: new Set(), tags: new Set(), fetchedAt: null },
        _refsInflight: null,
        _fetchJson: async (url, init = {}) => {
          const res = await fetchJson(url, token, init);
          if (!res.resp.ok) {
            throw new Error(res.json?.error || res.text || `HTTP ${res.resp.status}`);
          }
          return res.json;
        },
      },
      revision,
    );

    result.write.revisionKind = kind;
    result.write.likelyWritable = kind === "branch";
    result.write.success = kind === "branch";
    if (kind !== "branch") {
      result.write.error = "當前 revision 不是分支（tag/commit 只能讀不能寫）";
    }
  } catch (e) {
    // refs 失敗不算致命：你真正寫入時，HF 上游會給明確錯誤
    result.write.success = false;
    result.write.likelyWritable = false;
    result.write.error = `無法判斷 revision 型別（refs 請求失敗）：${e?.message || String(e)}`;
  }

  return finalize({
    success: true,
    message: result.write.likelyWritable
      ? "HuggingFace 測試成功（讀可用；revision 看起來是分支，可嘗試寫入）"
      : "HuggingFace 測試成功（讀可用；寫入許可權未確認或不可寫）",
  });
}

export default { huggingFaceDatasetsTestConnection };
