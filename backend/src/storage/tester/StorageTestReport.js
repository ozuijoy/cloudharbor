const TEST_REPORT_VERSION = "storage_test_v1";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function asBoolean(value) {
  return value === true;
}

function buildCheck({ key, label, raw, fallback = {} }) {
  const source = isPlainObject(raw) ? raw : isPlainObject(fallback) ? fallback : {};
  const success = asBoolean(source.success);
  const skipped = asBoolean(source.skipped);
  const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : null;
  const error = typeof source.error === "string" && source.error.trim() ? source.error.trim() : null;

  const details = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "success" || k === "skipped" || k === "note" || k === "error") continue;
    details[k] = v;
  }

  return {
    key,
    label,
    success,
    ...(skipped ? { skipped: true } : {}),
    ...(note ? { note } : {}),
    ...(error ? { error } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
}

function normalizeInfo(storageType, rawResult) {
  const info = {};

  const infoBlock = isPlainObject(rawResult?.info) ? rawResult.info : null;
  const connectionInfo = isPlainObject(rawResult?.connectionInfo) ? rawResult.connectionInfo : null;

  if (infoBlock) Object.assign(info, infoBlock);
  if (connectionInfo) Object.assign(info, connectionInfo);

  // 端點欄位統一：只認 info.endpoint_url
  const rawEndpointUrl = info.endpoint_url;
  if (typeof rawEndpointUrl === "string" && rawEndpointUrl.trim()) {
    info.endpoint_url = rawEndpointUrl.trim().replace(/\/+$/, "");
  } else {
    delete info.endpoint_url;
  }

  // 這些欄位在專案裡已經廢棄
  const removedEndpointKeys = [
    "endpointUrl",
    "endpoint",
    "endpoint_base",
    "endpointBase",
    "apiBase",
    "apiBaseUrl",
    "apiAddress",
    "api_base_url",
    "api_base",
  ];
  for (const key of removedEndpointKeys) {
    if (Object.prototype.hasOwnProperty.call(info, key)) {
      delete info[key];
    }
  }

  // 兜底：記錄 storageType，便於前端展示
  if (storageType) info.storageType = storageType;

  return info;
}

function normalizeChecks(storageType, rawResult) {
  const rawChecks = Array.isArray(rawResult?.checks) ? rawResult.checks : null;
  if (!rawChecks) {
    return [
      buildCheck({
        key: "contract",
        label: "測試輸出契約",
        raw: {
          success: false,
          error:
            "tester 未輸出 result.checks（此專案已要求 tester 直接輸出 checks[]，新增/修改驅動 tester 時無需再改中心程式碼）",
          expected: { "result.checks": "Array<{key,label,success,skipped?,note?,error?,details?,items?}>" },
          storageType: storageType || "",
        },
      }),
    ];
  }

  const checks = [];
  for (const entry of rawChecks) {
    if (!isPlainObject(entry)) continue;
    const key = typeof entry.key === "string" && entry.key.trim() ? entry.key.trim() : "check";
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : key;

    const success = asBoolean(entry.success);
    const skipped = asBoolean(entry.skipped);
    const note = typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : null;
    const error = typeof entry.error === "string" && entry.error.trim() ? entry.error.trim() : null;

    const out = { key, label, success, ...(skipped ? { skipped: true } : {}) };
    if (note) out.note = note;
    if (error) out.error = error;

    if (Array.isArray(entry.items) && entry.items.length) {
      const items = entry.items
        .filter((i) => isPlainObject(i))
        .map((i) => ({
          ...(typeof i.key === "string" && i.key.trim() ? { key: i.key.trim() } : {}),
          label: typeof i.label === "string" && i.label.trim() ? i.label.trim() : (typeof i.key === "string" ? i.key : ""),
          value: i.value,
        }))
        .filter((i) => typeof i.label === "string" && i.label.trim());
      if (items.length) out.items = items;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "details")) {
      out.details = entry.details;
    }

    checks.push(out);
  }

  return checks.length
    ? checks
    : [
        buildCheck({
          key: "contract",
          label: "測試輸出契約",
          raw: { success: false, error: "result.checks 為空或格式不正確" },
        }),
      ];
}

function normalizeDiagnostics(rawResult) {
  if (!isPlainObject(rawResult)) return null;
  const diagnostics = isPlainObject(rawResult?.diagnostics) ? rawResult.diagnostics : null;
  return diagnostics || null;
}

export function normalizeStorageTestResult({ storageType, testerResult, durationMs }) {
  const message =
    typeof testerResult?.message === "string" && testerResult.message.trim()
      ? testerResult.message.trim()
      : testerResult?.success
      ? "連線測試成功"
      : "連線測試失敗";

  const rawResult = isPlainObject(testerResult?.result) ? testerResult.result : {};
  const info = normalizeInfo(storageType, rawResult);
  const checks = normalizeChecks(storageType, rawResult);
  const diagnostics = normalizeDiagnostics(rawResult);

  return {
    success: asBoolean(testerResult?.success),
    message,
    report: {
      version: TEST_REPORT_VERSION,
      storageType: storageType || "",
      info,
      checks,
      ...(diagnostics ? { diagnostics } : {}),
      ...(typeof durationMs === "number" && Number.isFinite(durationMs) ? { timing: { durationMs } } : {}),
    },
  };
}

export function summarizeTestReportForLog(testData) {
  const report = isPlainObject(testData?.report) ? testData.report : null;
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const failed = checks
    .filter((c) => c && c.success === false && c.skipped !== true)
    .slice(0, 6)
    .map((c) => ({
      key: c.key || "",
      label: c.label || "",
      error: typeof c.error === "string" ? c.error.slice(0, 200) : null,
    }));
  return {
    success: testData?.success === true,
    message: typeof testData?.message === "string" ? testData.message : "",
    version: report?.version || "",
    storageType: report?.storageType || "",
    durationMs: report?.timing?.durationMs ?? null,
    failedChecks: failed,
  };
}
