# 構建階段
FROM node:22-alpine AS build

WORKDIR /app

# 複製依賴（利用 Docker layer cache）
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./

# 安裝依賴
RUN npm ci --cache /tmp/npm-cache --no-audit --no-fund

# 複製前端原始碼
COPY frontend/ ./

# 設定API地址環境變數 - 使用通用佔位符，實際值將在執行時由entrypoint.sh設定
ARG VITE_BACKEND_URL=http://localhost:8787
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# 新增Docker構建環境標識
ENV VITE_IS_DOCKER=true

# 構建應用
RUN npm run build

# 部署階段
FROM nginx:1.29-alpine

# 複製構建產物
COPY --from=build /app/dist /usr/share/nginx/html

# 複製Nginx配置
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# 複製啟動指令碼
COPY docker/frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh


# 暴露埠
EXPOSE 80

# 使用啟動指令碼
CMD ["/entrypoint.sh"]
