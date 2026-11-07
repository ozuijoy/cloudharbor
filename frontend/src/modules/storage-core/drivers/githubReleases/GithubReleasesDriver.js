import { createCapabilities } from "../types.js";

/**
 * GITHUB_RELEASES 儲存驅動
 *
 * - GitHub Releases 在後端是“只讀渠道”（主要用於掛載瀏覽/下載）
 * - 提供任何上傳能力，避免誤操作
 */
export class GithubReleasesDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: false,
        backendForm: false,
        presigned: false,
        url: false,
      },
      fs: {
        backendStream: false,
        backendForm: false,
        presignedSingle: false,
        multipart: false,
      },
    });

    const readonlyError = () => {
      throw new Error("GitHub Releases 是隻讀儲存，不支援上傳/寫入操作");
    };

    this.share = {
      applyShareUploader: readonlyError,
      applyDirectShareUploader: readonlyError,
      applyUrlUploader: readonlyError,
    };

    this.fs = {
      applyFsUploader: readonlyError,
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }
}

