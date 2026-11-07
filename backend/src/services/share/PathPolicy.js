export const PathPolicy = {
  // 僅保留儲存直傳所需的目錄合成功能
  composeDirectory(defaultFolder, customPath) {
    const def = PathPolicy.normalizeFragment(defaultFolder);
    const cus = PathPolicy.normalizeFragment(customPath);
    return [def, cus].filter(Boolean).join("/");
  },

  normalizeFragment(fragment) {
    if (!fragment) return "";
    return String(fragment).replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
  },
};

