import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";
import Components from "unplugin-vue-components/vite";
import IconsResolver from "unplugin-icons/resolver";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // 載入環境變數
  const env = loadEnv(mode, process.cwd(), "");

  // 統一版本管理
  const APP_VERSION = "1.9.1";
  const isDev = command === "serve";
  const enablePwa = command === "build";

  // 列印構建資訊（僅在顯式開啟時）
  if (env.VITE_PRINT_BUILD_INFO === "1" || env.VITE_PRINT_BUILD_INFO === "true") {
    console.log("Vite構建資訊:", {
      VITE_BACKEND_URL: env.VITE_BACKEND_URL || "未設定",
      VITE_APP_ENV: env.VITE_APP_ENV || "未設定",
      APP_VERSION: APP_VERSION,
      MODE: mode,
      COMMAND: command,
    });
  }

  const foliatePdfStubPath = fileURLToPath(new URL("./src/vendor/foliate-js/pdf.js", import.meta.url));

  // foliate-js 的 view.js 會動態 import('./pdf.js')，但其 pdf.js 使用了 Vite 不相容的 glob。
  // CloudHarbor 自身已有 PDF 預覽，不需要 foliate-js 的 PDF 支援，因此把它替換為 stub，避免構建失敗。
  const foliatePdfStubPlugin = () => ({
    name: "cloudharbor-foliate-pdf-stub",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "./pdf.js") return null;
      if (!importer) return null;
      if (importer.replaceAll("\\\\", "/").includes("/node_modules/foliate-js/view.js")) {
        return foliatePdfStubPath;
      }
      return null;
    },
  });

  return {
    base: '/',
    // vitest 配置（僅執行 npm test 時使用，不影響 vite build 產物）
    test: {
      environment: "node",
      include: ["src/**/__tests__/**/*.spec.js"],
    },
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __APP_ENV__: JSON.stringify(env.VITE_APP_ENV || "production"),
      __BACKEND_URL__: JSON.stringify(env.VITE_BACKEND_URL || ""),
    },
    plugins: [
      vue(),
      foliatePdfStubPlugin(),
      Components({
        dts: false,
        resolvers: [
          IconsResolver({
            prefix: "i",
            enabledCollections: ["mdi", "heroicons-outline", "heroicons-solid"],
          }),
        ],
      }),
      Icons({
        compiler: "vue3",
      }),
      enablePwa &&
        VitePWA({
          registerType: "autoUpdate",
          injectRegister: "auto", //自動注入更新檢測程式碼
          devOptions: {
            enabled: false, //開發環境PWA啟用
          },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallback: "index.html",
          navigateFallbackAllowlist: [/^\/$/, /^\/upload$/, /^\/admin/, /^\/paste\/.+/, /^\/file\/.+/, /^\/mount-explorer/],

          // 整合自定義Service Worker程式碼以支援Background Sync API
          importScripts: ["/sw-background-sync.js"],

          // PWA快取策略
          runtimeCaching: [
            // 應用靜態資源 - StaleWhileRevalidate
            {
              urlPattern: ({ request }) => request.destination === "style" || request.destination === "script" || request.destination === "worker",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "app-static-resources",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 字型檔案 - CacheFirst（字型很少變化，可長期快取）
            {
              urlPattern: ({ request }) => request.destination === "font",
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 30 * 24 * 60 * 60, 
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 第三方CDN資源 - StaleWhileRevalidate
            {
              urlPattern: ({ url }) =>
                url.origin !== self.location.origin &&
                (url.hostname.includes("cdn") ||
                  url.hostname.includes("googleapis") ||
                  url.hostname.includes("gstatic") ||
                  url.hostname.includes("jsdelivr") ||
                  url.hostname.includes("unpkg") ||
                  url.hostname.includes("elemecdn") ||
                  url.hostname.includes("bootcdn") ||
                  url.hostname.includes("staticfile")),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "external-cdn-resources",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60, 
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
                plugins: [
                  {
                    cacheWillUpdate: async ({ response }) => {
                      return response && response.status === 200;
                    },
                    handlerDidError: async ({ request, error }) => {
                      console.warn(`CDN資源處理失敗: ${request.url}`, error);
                      return null; // 優雅降級
                    },
                  },
                ],
              },
            },

            // 圖廊圖片 - StaleWhileRevalidate
            {
              urlPattern: ({ request, url }) =>
                request.destination === "image" && (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "gallery-images",
                expiration: {
                  maxEntries: 300,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7天
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 使用者媒體檔案 - NetworkOnly
            {
              urlPattern: ({ request, url }) =>
                (request.destination === "video" || request.destination === "audio" || /\.(mp4|webm|ogg|mp3|wav|flac|aac)$/i.test(url.pathname)) &&
                (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "NetworkOnly",
            },

            // 使用者文件檔案 - NetworkFirst（文件快速更新）
            {
              urlPattern: ({ url }) =>
                /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md)$/i.test(url.pathname) &&
                (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "NetworkFirst",
              options: {
                cacheName: "user-documents",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 2 * 60 * 60,
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 應用內建圖片 - CacheFirst（應用資源穩定）
            {
              urlPattern: ({ request, url }) => request.destination === "image" && url.origin === self.location.origin && !url.pathname.includes("/api/"),
              handler: "CacheFirst",
              options: {
                cacheName: "app-images",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30天（應用圖片穩定）
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 系統API快取 - NetworkFirst
            {
              urlPattern: /^.*\/api\/(system\/max-upload-size|health|version).*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "system-api",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 30 * 60,
                },
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 檔案系統動態操作API - NetworkOnly（不快取，確保實時性）
            {
              urlPattern: /^.*\/api\/fs\/(get|list|upload|batch-remove|batch-copy|mkdir|multipart|download|update|create-share).*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "fs-dynamic-operations",
              },
            },

            // 檔案系統預簽名URL - NetworkOnly（每次生成新URL和fileId）
            {
              urlPattern: /^.*\/api\/fs\/(presign|file-link).*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "fs-presign-operations",
              },
            },

            // 文字分享API - NetworkOnly
            {
              urlPattern: /^.*\/api\/(pastes|paste|raw)\/.*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "pastes-realtime",
              },
            },

            // 搜尋API - NetworkOnly（後端已有快取，前端不應再快取）
            {
              urlPattern: /^.*\/api\/fs\/search.*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "search-realtime",
              },
            },

            // 上傳相關API - NetworkOnly（操作性API，不應快取）
            {
              urlPattern: /^.*\/api\/(upload|url)\/.*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "upload-operations",
              },
            },

            // 公共API快取 - StaleWhileRevalidate（公共內容後臺更新）
            {
              urlPattern: /^.*\/api\/public\/.*$/,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "public-api",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // WebDAV API - NetworkOnly（實時性要求高）
            {
              urlPattern: /^.*\/dav\/.*$/,
              handler: "NetworkOnly",
              options: {
                cacheName: "webdav-realtime",
              },
            },

            // S3預簽名URL - NetworkOnly（避免URL過期問題）
            {
              urlPattern: ({ url }) => url.searchParams.has("X-Amz-Algorithm") || url.searchParams.has("Signature") || url.pathname.includes("/presigned/"),
              handler: "NetworkOnly",
              options: {
                cacheName: "presigned-urls-realtime",
              },
            },

            // 管理員配置讀取API - 短期快取（僅GET請求）
            {
              urlPattern: ({ request, url }) => request.method === "GET" && /^.*\/api\/(mount\/list|admin\/api-keys|admin\/system-settings).*$/.test(url.href),
              handler: "NetworkFirst",
              options: {
                cacheName: "admin-config-read",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 5 * 60, // 5分鐘（配置讀取短期快取）
                },
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 管理員配置寫入API - NetworkOnly（POST/PUT/DELETE操作）
            {
              urlPattern: ({ request, url }) =>
                ["POST", "PUT", "DELETE"].includes(request.method) &&
                /^.*\/api\/(mount\/(create|[^\/]+)|admin\/api-keys|admin\/system-settings|admin\/login|admin\/change-password|admin\/cache).*$/.test(url.href),
              handler: "NetworkOnly",
              options: {
                cacheName: "admin-config-write",
              },
            },
          ],
        },
        includeAssets: ["favicon.ico", "apple-touch-icon.png", "robots.txt", "dist/**/*"],
        manifest: {
          name: "CloudHarbor",
          short_name: "CloudHarbor",
          description: "安全分享您的內容，支援 Markdown 編輯和檔案上傳",
          theme_color: "#0ea5e9",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait-primary",
          scope: "/",
          start_url: "/",
          lang: "zh-TW",
          categories: ["productivity", "utilities"],
          icons: [
            {
              src: "icons/icons-32.png",
              sizes: "32x32",
              type: "image/png",
            },
            {
              src: "icons/icon-96.png",
              sizes: "96x96",
              type: "image/png",
            },
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "icons/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          shortcuts: [
            {
              name: "檔案上傳",
              short_name: "上傳",
              description: "快速上傳檔案",
              url: "/upload",
              icons: [
                {
                  src: "icons/shortcut-upload-96.png",
                  sizes: "96x96",
                },
              ],
            },
          ],
        },
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 3000,
      open: true,
      // 設定代理 - 僅在本地開發模式下使用
      proxy: {
        // 當 VITE_BACKEND_URL 為本地地址時，將請求代理到本地worker
        "/api": {
          target: env.VITE_BACKEND_URL || "http://localhost:8787",
          changeOrigin: true,
          secure: false,
          // 列印代理日誌
          configure: (proxy, _options) => {
            proxy.on("error", (err, _req, _res) => {
              console.log("代理錯誤", err);
            });
            proxy.on("proxyReq", (_proxyReq, req, _res) => {
              console.log("代理請求:", req.method, req.url);
            });
            proxy.on("proxyRes", (proxyRes, req, _res) => {
              console.log("代理響應:", req.method, req.url, proxyRes.statusCode);
            });
          },
        },
      },
    },
    // foliate-js 的部分模組（例如 pdf.js）使用了 top-level await。
    // 為了讓 Vite/esbuild 在 dev 與 build 階段都能正常處理，我們將 target 提升到 ES2022。
    esbuild: {
      target: "es2022",
    },
    optimizeDeps: {
      include: ["vue-i18n", "chart.js", "qrcode", "mime-db", "docx-preview"],
      // 跳過預構建，讓 Vite 按原始 ESM 處理
      exclude: ["foliate-js"],
      esbuildOptions: {
        target: "es2022",
      },
    },
    build: {
      outDir: 'dist', // 顯式指定輸出目錄
      target: "es2022",
      minify: "terser",
      terserOptions: {
        compress: {
          pure_funcs: ["console.log"],
        },
      },
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            // 將大型庫分離到單獨的 chunk
            "vendor-vue": ["vue", "vue-router", "vue-i18n"],
            "vendor-charts": ["chart.js", "vue-chartjs"],
            "vendor-utils": ["qrcode", "file-saver", "docx", "@zumer/snapdom"],
            "office-viewer": ["docx-preview", "@vue-office/excel/lib/v3/index.js", "@vue-office/pptx/lib/v3/index.js"],
          },
        },
      },
    },
  };
});
