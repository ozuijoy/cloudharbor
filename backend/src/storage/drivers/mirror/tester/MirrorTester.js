/**
 * MIRROR 驅動 tester（只讀）
 *
 */

import { ValidationError } from "../../../../http/errors.js";
import { MirrorStorageDriver } from "../MirrorStorageDriver.js";

export async function mirrorTestConnection(config, _encryptionSecret, _requestOrigin = null) {
  const info = {
    preset: String(config?.preset || "").trim().toLowerCase(),
    endpoint_url: String(config?.endpoint_url || "").trim(),
  };
  const readState = {
    success: false,
    note: "只讀測試：抓取上游根目錄並解析條目",
    itemCount: 0,
    sampleNames: [],
    error: null,
  };

  try {
    const driver = new MirrorStorageDriver(config, _encryptionSecret);
    await driver.initialize();

    const mount = { id: "mirror_tester", mount_path: "/", storage_type: "MIRROR" };
    const listing = await driver.listDirectory("/", { path: "/", mount, subPath: "/", db: null });

    const items = Array.isArray(listing?.items) ? listing.items : [];
    info.preset = driver.preset;
    info.endpoint_url = driver.endpointUrl;

    readState.sampleNames = items
      .slice(0, 20)
      .map((it) => it?.name)
      .filter(Boolean);
    readState.itemCount = items.length;
    readState.success = items.length > 0;

    const checks = [
      {
        key: "read",
        label: "讀許可權",
        success: readState.success === true,
        note: readState.note,
        items: [
          { key: "itemCount", label: "條目數量", value: readState.itemCount },
          { key: "sampleNames", label: "目錄樣本", value: readState.sampleNames },
        ],
      },
      {
        key: "write",
        label: "寫許可權",
        success: true,
        skipped: true,
        note: "MIRROR 為只讀儲存，跳過寫測試",
      },
    ];

    return {
      success: readState.success === true,
      message: readState.success === true
        ? "MIRROR 連通性測試成功（已抓到目錄條目）"
        : "MIRROR 連通性測試部分成功（可訪問，但未解析到條目）",
      result: { info, checks },
    };
  } catch (e) {
    // 配置錯誤：直接拋給上層（與其它 tester 行為一致）
    if (e instanceof ValidationError) throw e;
    readState.success = false;
    readState.error = e?.message || String(e);
    const checks = [
      { key: "read", label: "讀許可權", success: false, error: readState.error, note: readState.note },
      { key: "write", label: "寫許可權", success: true, skipped: true, note: "MIRROR 為只讀儲存，跳過寫測試" },
    ];
    return { success: false, message: `MIRROR 連通性測試失敗：${readState.error}`, result: { info, checks } };
  }
}
