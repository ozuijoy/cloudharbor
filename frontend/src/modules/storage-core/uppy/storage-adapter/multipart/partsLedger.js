/**
 * Multipart PartsLedger（分片賬本）
 *
 * - client_keeps 才做 localStorage 持久化
 * - server_can_list / server_records 只做“記憶體賬本”（頁面內夠用；重新整理後回源 list-parts）
 */

const GLOBAL_FLUSH_BIND_KEY = Symbol.for("cloudharbor.multipart.partsLedger.flushBind");

function nowMs() {
  return Date.now();
}

export function normalizeStorageKey(storageKey) {
  return String(storageKey || "").replace(/^\/+/, "");
}

function toFinitePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function normalizeEtag(value) {
  if (value == null) return null;
  const s = String(value);
  return s ? s : null;
}

function normalizeSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 0 ? n : 0;
}

/**
 * 允許輸入：
 * - AWS 格式：{ PartNumber, ETag, Size }
 * - 業務格式：{ partNumber, etag, size }
 */
function normalizePartLike(part) {
  const partNumber = toFinitePositiveInt(part?.PartNumber ?? part?.partNumber);
  const etag = normalizeEtag(part?.ETag ?? part?.etag);
  const size = normalizeSize(part?.Size ?? part?.size);
  if (!partNumber) return null;
  return { PartNumber: partNumber, ETag: etag, Size: size };
}

function ensureGlobalFlushBinding() {
  if (typeof window === "undefined") return;
  if (window[GLOBAL_FLUSH_BIND_KEY]) return;
  window[GLOBAL_FLUSH_BIND_KEY] = true;
  const flushAll = () => {
    try {
      const ledgers = window.__cloudharborMultipartLedgers;
      if (!Array.isArray(ledgers)) return;
      ledgers.forEach((ledger) => {
        try {
          ledger?.flushNow?.();
        } catch {}
      });
    } catch {}
  };

  try {
    window.addEventListener("pagehide", flushAll, { capture: true });
  } catch {}
  try {
    window.addEventListener("beforeunload", flushAll, { capture: true });
  } catch {}
  try {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") flushAll();
      },
      { capture: true },
    );
  } catch {}
}

class BasePartsLedger {
  constructor({ storageKey, policy, storagePrefix, cacheExpiry }) {
    this.storageKey = normalizeStorageKey(storageKey);
    this.policy = policy || null;
    this.storagePrefix = String(storagePrefix || "uppy_multipart_");
    this.cacheExpiry = Number(cacheExpiry) || 24 * 60 * 60 * 1000;

    this._parts = new Map(); // PartNumber -> { PartNumber, ETag, Size }
    this._loaded = false;
  }

  get ledgerPolicy() {
    const p = this.policy || null;
    const raw = p?.partsLedgerPolicy ?? p?.parts_ledger_policy ?? null;
    return String(raw || "");
  }

  async load() {
    this._loaded = true;
  }

  isLoaded() {
    return this._loaded === true;
  }

  clearInMemory() {
    this._parts.clear();
  }

  /**
   * 直接覆蓋當前賬本（通常用於：從伺服器 list-parts 初始化）
   */
  replaceAll(parts) {
    this._parts.clear();
    const list = Array.isArray(parts) ? parts : [];
    for (const p of list) {
      const normalized = normalizePartLike(p);
      if (!normalized) continue;
      this._parts.set(normalized.PartNumber, normalized);
    }
  }

  /**
   * 合併分片（通常用於：uploadPartBytes 成功後記錄）
   */
  recordPart(part) {
    const normalized = normalizePartLike(part);
    if (!normalized) return;
    const prev = this._parts.get(normalized.PartNumber);
    this._parts.set(normalized.PartNumber, { ...prev, ...normalized });
  }

  hasPart(partNumber) {
    const pn = toFinitePositiveInt(partNumber);
    if (!pn) return false;
    return this._parts.has(pn);
  }

  getPart(partNumber) {
    const pn = toFinitePositiveInt(partNumber);
    if (!pn) return null;
    return this._parts.get(pn) || null;
  }

  /**
   * 返回 AWS 風格陣列（用於 Uppy / complete / skip）
   */
  toAwsPartsArray() {
    return Array.from(this._parts.values()).sort((a, b) => a.PartNumber - b.PartNumber);
  }

  /**
   * per_part_url complete 需要的最小欄位
   */
  toCompletePartsArray() {
    return this.toAwsPartsArray()
      .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag }))
      .filter((p) => typeof p.ETag === "string" && p.ETag.length > 0);
  }

  /**
   * 把“Uppy 本次傳進來的 parts”也並進賬本，然後返回完整 parts（用於重新整理後續傳）
   */
  mergeIncomingParts(incomingParts) {
    const list = Array.isArray(incomingParts) ? incomingParts : [];
    for (const p of list) {
      this.recordPart(p);
    }
    return this.toAwsPartsArray();
  }

  // 持久化相關：預設什麼都不做
  flushNow() {}
  clearPersistent() {}
}

class MemoryPartsLedger extends BasePartsLedger {
  // 記憶體賬本：不需要額外實現
}

class LocalStoragePartsLedger extends BasePartsLedger {
  constructor(opts) {
    super(opts);
    this._dirty = false;
    this._flushTimer = null;
    this._flushDebounceMs = 250;

    ensureGlobalFlushBinding();
    try {
      if (!Array.isArray(window.__cloudharborMultipartLedgers)) {
        window.__cloudharborMultipartLedgers = [];
      }
      window.__cloudharborMultipartLedgers.push(this);
    } catch {}
  }

  _storageKeyName() {
    return `${this.storagePrefix}${this.storageKey}`;
  }

  async load() {
    if (this._loaded) return;
    this._loaded = true;
    if (!this.storageKey) return;

    try {
      const raw = localStorage.getItem(this._storageKeyName());
      if (!raw) return;
      const data = JSON.parse(raw);
      const ts = Number(data?.timestamp) || 0;
      if (ts > 0 && nowMs() - ts > this.cacheExpiry) {
        // 過期就當不存在（不在這裡刪除，避免意外寫放大；真正需要可在 clearPersistent 執行）
        return;
      }
      const parts = Array.isArray(data?.parts) ? data.parts : [];
      this.replaceAll(parts);
    } catch {
      // 本地快取損壞：當作空賬本即可
    }
  }

  recordPart(part) {
    super.recordPart(part);
    this._markDirty();
  }

  replaceAll(parts) {
    super.replaceAll(parts);
    this._markDirty();
  }

  _markDirty() {
    this._dirty = true;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flushNow();
    }, this._flushDebounceMs);
  }

  flushNow() {
    if (!this._dirty) return;
    this._dirty = false;
    if (!this.storageKey) return;
    try {
      const data = {
        parts: this.toAwsPartsArray(),
        timestamp: nowMs(),
      };
      localStorage.setItem(this._storageKeyName(), JSON.stringify(data));
    } catch {
      // localStorage 滿了/禁用：只能放棄持久化，但不影響當前頁面繼續上傳
    }
  }

  clearPersistent() {
    try {
      if (!this.storageKey) return;
      localStorage.removeItem(this._storageKeyName());
    } catch {}
  }
}

export function createPartsLedger({ policy, storageKey, storagePrefix, cacheExpiry }) {
  const p = policy || null;
  const ledgerPolicyRaw = p?.partsLedgerPolicy ?? p?.parts_ledger_policy ?? null;
  const ledgerPolicy = String(ledgerPolicyRaw || "");

  const opts = { policy: p, storageKey, storagePrefix, cacheExpiry };

  // 只有 client_keeps 才需要持久化
  if (ledgerPolicy === "client_keeps") {
    return new LocalStoragePartsLedger(opts);
  }
  return new MemoryPartsLedger(opts);
}

export function readClientLedgerParts({ storageKey, storagePrefix, cacheExpiry }) {
  const ledger = new LocalStoragePartsLedger({
    storageKey,
    storagePrefix,
    cacheExpiry,
    policy: { partsLedgerPolicy: "client_keeps" },
  });
  // 同步讀取（這裡 load 其實是 sync 的，但為了介面一致返回 Promise）
  return ledger
    .load()
    .then(() => ledger.toAwsPartsArray())
    .catch(() => []);
}

export function clearAllClientLedgers({ storagePrefix }) {
  const prefix = String(storagePrefix || "uppy_multipart_");
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    return keysToRemove.length;
  } catch {
    return 0;
  }
}

