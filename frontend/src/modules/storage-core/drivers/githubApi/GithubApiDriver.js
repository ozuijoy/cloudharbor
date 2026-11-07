import { LocalDriver } from "../local/LocalDriver.js";

/**
 * GITHUB_API 儲存驅動（前端）
 *
 * - GitHub API 儲存的上傳/刪除/改名等動作全部由後端驅動實現
 * - 前端僅需要複用“後端中轉上傳”能力（流式/表單）即可
 * - 因此直接繼承 LocalDriver 的 uploader 適配邏輯，避免重複實現
 */
export class GithubApiDriver extends LocalDriver {
  constructor(config = {}) {
    super(config);
  }
}

