# 第一階段：安裝依賴並編譯原生模組（構建階段）
FROM node:22-alpine AS deps

WORKDIR /app

# 可選：設定 npm registry（國內環境可改成 https://registry.npmmirror.com/）
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry ${NPM_REGISTRY}

# 先複製依賴清單，利用 Docker layer cache
COPY backend/package.json backend/package-lock.json ./

# 構建期依賴：用於編譯 sqlite3/better-sqlite3 等原生模組
RUN apk add --no-cache --virtual .build-deps python3 make g++ sqlite-dev && \
    npm ci --omit=dev --include=optional --no-audit --no-fund --cache /tmp/npm-cache && \
    rm -rf /tmp/npm-cache && \
    find node_modules -type f \( -name "*.d.ts" -o -name "*.map" -o -name "*.md" -o -name "*.markdown" \) -delete && \
    apk del .build-deps

# 第二階段：建立最終映象
FROM node:22-alpine

WORKDIR /app

# 執行時 sqlite 動態庫
RUN apk add --no-cache sqlite-libs

# 複製構建階段產物
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

# 建立資料目錄
RUN mkdir -p /data

# 設定環境變數
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787
ENV TASK_WORKER_POOL_SIZE=2
# 除錯驅動快取 (預設 false)
#- DEBUG_DRIVER_CACHE=false
# 注意：這個金鑰應該在執行時透過環境變數傳入，這裡只是設定預設值
ENV ENCRYPTION_SECRET=default-encryption-key

# 暴露埠
EXPOSE 8787

# 啟動命令
CMD ["node", "--expose-gc", "--import", "tsx", "unified-entry.js"]
