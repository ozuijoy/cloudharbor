/**
 * Sha256PreprocessPlugin - 在上傳前計算檔案 sha256（用於預簽名、秒傳/去重）
 *
 * 小檔案：走 WebCrypto（快但要讀全量記憶體）
 * 大檔案：走 Worker + hash-wasm（增量 update，不阻塞 UI）
 *
 * 這裡只負責“算 hash + 顯示進度 + 寫入 file.meta”，不負責請求後端。
 */

import { BasePlugin } from "@uppy/core";
import { sha256HexFromBlob } from "@/utils/sha256.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("Sha256PreprocessPlugin");

export default class Sha256PreprocessPlugin extends BasePlugin {
  static VERSION = "1.0.0";

  constructor(uppy, opts) {
    super(uppy, {
      enabled: true,
      // 10MB
      maxWebCryptoSize: 10_000_000,
      // 寫入到 file.meta 的欄位名
      metaKey: "cloudharborSha256",
      ...opts,
    });

    this.type = "modifier";
    this.id = this.opts.id || "Sha256PreprocessPlugin";

    this.prepareUpload = this.prepareUpload.bind(this);

    this.defaultLocale = {
      strings: {
        hashingSha256: "計算 SHA-256（用於預簽名/秒傳準備）...",
      },
    };

    this.i18nInit();
  }

  install() {
    this.uppy.addPreProcessor(this.prepareUpload);
    log.debug("外掛已安裝");
  }

  uninstall() {
    this.uppy.removePreProcessor(this.prepareUpload);
    log.debug("外掛已解除安裝");
  }

  async prepareUpload(fileIDs) {
    const enabled =
      typeof this.opts.enabled === "function" ? await this.opts.enabled() : this.opts.enabled !== false;
    if (!enabled) {
      return Promise.resolve();
    }

    const promises = fileIDs.map(async (fileID) => {
      const file = this.uppy.getFile(fileID);
      if (!file) return;

      const metaKey = this.opts.metaKey || "cloudharborSha256";
      const existing = file?.meta?.[metaKey];
      if (typeof existing === "string" && existing.length > 0) {
        this.uppy.emit("preprocess-complete", file);
        return;
      }

      const blob = file?.data instanceof Blob ? file.data : null;
      if (!blob) {
        this.uppy.emit("preprocess-complete", file);
        return;
      }

      const message = this.i18n("hashingSha256");

      // 先給一個“開始計算”的提示（大檔案會有 determinate 進度）
      this.uppy.emit("preprocess-progress", file, {
        mode: blob.size >= this.opts.maxWebCryptoSize ? "determinate" : "indeterminate",
        message,
        value: 0,
      });

      try {
        const sha256 = await sha256HexFromBlob(blob, {
          maxWebCryptoSize: this.opts.maxWebCryptoSize,
          useWebWorker: true,
          onProgress: (progress) => {
            // Uppy 的 progress 是 0~1
            if (typeof progress === "number") {
              this.uppy.emit("preprocess-progress", file, {
                mode: "determinate",
                message,
                value: progress,
              });
            }
          },
        });

        this.uppy.setFileMeta(fileID, { [metaKey]: sha256 });
      } catch (error) {
        log.error("[Sha256PreprocessPlugin] sha256 計算失敗:", error);
        throw error;
      } finally {
        this.uppy.emit("preprocess-complete", file);
      }
    });

    return Promise.all(promises);
  }
}
