/**
 * Mount配置的Schema定義
 * 為前端動態表單渲染提供後設資料
 */

/**
 * WebDAV代理策略選項
 */
export const WebDavPolicyOptions = [
  {
    value: "302_redirect",
    labelKey: "admin.mount.form.webdavPolicyOptions.302_redirect",
    // 僅支援 DirectLink 能力的驅動（如 S3）
    requiresCapability: "directLink",
  },
  {
    value: "use_proxy_url",
    labelKey: "admin.mount.form.webdavPolicyOptions.use_proxy_url",
    // 需要儲存配置中設定了 url_proxy
    requiresCapability: "urlProxy",
  },
  {
    value: "native_proxy",
    labelKey: "admin.mount.form.webdavPolicyOptions.native_proxy",
    // 所有儲存型別都支援
    requiresCapability: null,
  },
];

/**
 * Mount配置Schema
 */
export const MountConfigSchema = {
  fields: [
    // === 基本資訊 ===
    {
      name: "name",
      type: "string",
      required: true,
      labelKey: "admin.mount.form.name",
      ui: {
        placeholderKey: "admin.mount.form.namePlaceholder",
        maxLength: 50,
      },
      validation: {
        maxLength: 50,
        pattern: "^[\\u4e00-\\u9fa5a-zA-Z0-9_-]+$",
        patternMessageKey: "admin.mount.validation.namePattern",
      },
    },
    {
      name: "remark",
      type: "textarea",
      required: false,
      labelKey: "admin.mount.form.remark",
      ui: {
        placeholderKey: "admin.mount.form.remarkPlaceholder",
        rows: 2,
      },
    },

    // === 儲存關聯 ===
    {
      name: "storage_type",
      type: "select",
      required: false,
      labelKey: "admin.mount.form.storageType",
      ui: {
        placeholderKey: "admin.mount.form.selectStorageType",
        descriptionKey: "admin.mount.form.storageTypeHint",
        // 動態選項：從已有儲存配置中提取可用型別
        dynamicOptions: "storageTypes",
      },
    },
    {
      name: "storage_config_id",
      type: "select",
      required: true,
      labelKey: "admin.mount.form.storageConfig",
      ui: {
        placeholderKey: "admin.mount.form.storageConfigPlaceholder",
        descriptionKey: "admin.mount.form.storageConfigHint",
        // 動態選項：從API獲取儲存配置列表
        dynamicOptions: "storageConfigs",
        // 顯示儲存型別標籤
        showTypeLabel: true,
      },
    },
    {
      name: "mount_path",
      type: "string",
      required: true,
      labelKey: "admin.mount.form.mountPath",
      ui: {
        placeholderKey: "admin.mount.form.mountPathPlaceholder",
        descriptionKey: "admin.mount.form.mountPathHint",
      },
      // 驗證在前端元件中進行更復雜的邏輯判斷（支援中文、斜槓等）
      // 這裡只做基本的長度限制
      validation: {
        maxLength: 128,
      },
    },

    // === 高階設定 ===
    {
      name: "cache_ttl",
      type: "number",
      required: false,
      defaultValue: 300,
      labelKey: "admin.mount.form.cacheTtl",
      ui: {
        descriptionKey: "admin.mount.form.cacheTtlHint",
        suffix: "admin.mount.seconds",
        min: 0,
        max: 86400,
      },
      validation: {
        min: 0,
        max: 86400,
      },
    },
    {
      name: "sort_order",
      type: "number",
      required: false,
      defaultValue: 0,
      labelKey: "admin.mount.form.sortOrder",
      ui: {
        descriptionKey: "admin.mount.form.sortOrderHint",
      },
    },
    {
      name: "enable_folder_summary_compute",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.enableFolderSummaryCompute",
      ui: {
        descriptionKey: "admin.mount.form.enableFolderSummaryComputeHint",
      },
    },

    // === 代理設定 ===
    {
      name: "web_proxy",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.webProxy",
      ui: {
        descriptionKey: "admin.mount.form.webProxyHint",
      },
    },
    {
      name: "enable_sign",
      type: "boolean",
      required: false,
      defaultValue: false,
      labelKey: "admin.mount.form.proxySign.enableSign",
      ui: {
        descriptionKey: "admin.mount.form.proxySign.enableSignHint",
      },
      dependsOn: {
        field: "web_proxy",
        value: true,
      },
    },
    {
      name: "sign_expires",
      type: "number",
      required: false,
      labelKey: "admin.mount.form.proxySign.signExpires",
      ui: {
        placeholderKey: "admin.mount.form.proxySign.signExpiresPlaceholder",
        descriptionKey: "admin.mount.form.proxySign.signExpiresHint",
        suffix: "admin.mount.seconds",
        min: 60,
        max: 604800,
      },
      validation: {
        min: 60,
        max: 604800,
      },
      dependsOn: {
        field: "enable_sign",
        value: true,
      },
    },
    {
      name: "webdav_policy",
      type: "select",
      required: false,
      defaultValue: "302_redirect",
      labelKey: "admin.mount.form.webdavPolicy",
      ui: {
        descriptionKey: "admin.mount.form.webdavPolicyDescription",
        // 選項基於儲存能力動態過濾
        dynamicOptions: "webdavPolicies",
      },
    },

    // === 狀態 ===
    {
      name: "is_active",
      type: "boolean",
      required: false,
      defaultValue: true,
      labelKey: "admin.mount.form.isActive",
      ui: {
        descriptionKey: "admin.mount.form.isActiveHint",
      },
    },
  ],

  // 表單佈局分組（支援雙列和卡片佈局）
  layout: {
    groups: [
      {
        id: "basic",
        // 不顯示標題，作為預設首組
        titleKey: null,
        fields: ["name", "storage_type", "storage_config_id", "mount_path"],
      },
      {
        id: "advanced",
        titleKey: "admin.mount.groups.advanced",
        // 使用 { row: [...] } 標記雙列布局
        fields: ["remark", { row: ["cache_ttl", "sort_order"] }, "enable_folder_summary_compute"],
      },
      {
        id: "proxy",
        titleKey: "admin.mount.groups.proxy",
        fields: [
          "web_proxy",
          // 代理簽名配置卡片：依賴 web_proxy 啟用時顯示
          {
            card: "proxy_sign",
            titleKey: "admin.mount.groups.proxySign",
            dependsOn: { field: "web_proxy", value: true },
            fields: ["enable_sign", "sign_expires"],
          },
          "webdav_policy",
          "is_active",
        ],
      },
    ],
  },

  // 提供給前端的WebDAV策略選項後設資料
  webdavPolicies: WebDavPolicyOptions,
};

/**
 * 獲取Mount配置Schema
 * @returns {Object} Schema物件
 */
export function getMountConfigSchema() {
  return MountConfigSchema;
}
