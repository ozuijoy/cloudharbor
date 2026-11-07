// Flat ESLint config for ESLint v9+
// 主要規則：
// - 限制 components/* 直接依賴 modules/*
// - 限制隨意 import storage-core 內部實現（drivers/uppy）

const vue = require("eslint-plugin-vue");
const importPlugin = require("eslint-plugin-import");
const vueParser = require("vue-eslint-parser");

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  ...vue.configs['flat/essential'],

  // 通用規則：應用於 src 下所有 JS/Vue 檔案
  {
    files: ["src/**/*.{js,vue}"],
    ignores: ["dist/**"],
    languageOptions: {
      parser: vueParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
      },
    },
    plugins: {
      vue,
      import: importPlugin,
    },
    // 對當前規則不強依賴 import 解析，暫時不配置 import/resolver
    rules: {
      // Vue 推薦規則基礎上關閉多片語件名限制（專案中已有大量單片語件名）
      "vue/multi-word-component-names": "off",

      // 1) components/* 禁止依賴 modules/*
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/components",
              from: "./src/modules",
              message:
                "通用元件層禁止直接依賴 modules/*，請在 modules/<domain> 中封裝領域元件再在上層使用。",
            },
          ],
        },
      ],

      // 2) 禁止直接使用 storage-core 內部實現（drivers/uppy）
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/storage-core/drivers/*",
                "@/modules/storage-core/uppy/*",
              ],
              message:
                "禁止直接依賴 storage-core 內部實現，請透過 modules/storage-core/index 或 modules/upload/shareUploadController 訪問。",
            },
          ],
        },
      ],
    },
  },

  // 特例：允許 storage-core / upload / FS Uppy 彈窗直接使用 storage-core 內部實現
  {
    files: [
      "src/modules/storage-core/**/*.{js,vue}",
      "src/modules/upload/**/*.{js,vue}",
      "src/modules/fs/components/shared/modals/UppyUploadModal.vue",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
