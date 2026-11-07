/**
 * zip.js（@zip.js/zip.js 2.8+）
 * - 將 Worker/WASM 資源作為標準 exports 暴露出來
 * - 透過 `configure({ workerURI, wasmURI })` 明確資源地址，避免構建器/部署路徑導致的隱式載入問題
 *
 */

import zipWorkerUri from "@zip.js/zip.js/dist/zip-web-worker.js?url";
import zipWasmUri from "@zip.js/zip.js/dist/zip-module.wasm?url";

export const ZIPJS_RUNTIME_URIS = Object.freeze({
  workerURI: zipWorkerUri,
  wasmURI: zipWasmUri,
});

/**
 * 獲取 zip.js 的全域性預設配置（按需在業務入口呼叫一次 configure）
 * - 避免在模組載入階段訪問 navigator（相容 SSR/構建期執行）
 */
export function getZipJsDefaultConfig() {
  const hardwareConcurrency = typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 2;

  return {
    ...ZIPJS_RUNTIME_URIS,
    chunkSize: 64 * 1024,
    maxWorkers: hardwareConcurrency,
    terminateWorkerTimeout: 5000, // 5秒
    useWebWorkers: true,
    useCompressionStream: true,
  };
}
