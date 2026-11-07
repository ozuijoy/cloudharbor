#!/bin/sh

# 生成執行時配置
echo "生成執行時配置..."

# 確保靜態檔案目錄存在
CONFIG_DIR=/usr/share/nginx/html
CONFIG_FILE=${CONFIG_DIR}/config.js

# 檢查目錄存在
if [ ! -d "$CONFIG_DIR" ]; then
  echo "錯誤: 靜態檔案目錄不存在: $CONFIG_DIR"
  exit 1
fi

# 正規化 BACKEND_URL：移除結尾的斜線
# 否則前端會拼出 https://host//api/... ，部分反向代理不會合併雙斜線而直接 404，
# 表現為「部署後所有請求（含上傳）都失敗」。同時允許留空表示「與前端同源」。
BACKEND_URL_RAW="${BACKEND_URL:-http://localhost:8787}"
while [ "${BACKEND_URL_RAW%/}" != "${BACKEND_URL_RAW}" ]; do
  BACKEND_URL_RAW="${BACKEND_URL_RAW%/}"
done
BACKEND_URL="${BACKEND_URL_RAW}"

# 上傳/一般請求逾時（毫秒）：
# - UPLOAD_TIMEOUT_MS：上傳進度逾時，0 表示不限制（預設 600000 = 10 分鐘，由前端保底）
# - API_TIMEOUT_MS   ：一般 API 請求逾時（預設 30000）
UPLOAD_TIMEOUT_MS="${UPLOAD_TIMEOUT_MS:-}"
API_TIMEOUT_MS="${API_TIMEOUT_MS:-}"

# 生成配置檔案
cat > ${CONFIG_FILE} << EOF
// 執行時配置 - 由Docker容器啟動指令碼生成
window.appConfig = {
  backendUrl: '${BACKEND_URL}'${UPLOAD_TIMEOUT_MS:+,
  uploadTimeoutMs: ${UPLOAD_TIMEOUT_MS}}${API_TIMEOUT_MS:+,
  apiTimeoutMs: ${API_TIMEOUT_MS}}
};
EOF

# 驗證檔案生成
if [ -f "$CONFIG_FILE" ]; then
  echo "配置檔案已成功生成: $CONFIG_FILE"
  echo "配置已更新: BACKEND_URL=${BACKEND_URL}"
  echo "配置檔案內容:"
  cat ${CONFIG_FILE}
else
  echo "錯誤: 配置檔案未成功生成: $CONFIG_FILE"
fi

# 檢視靜態目錄中的檔案列表，幫助除錯
echo "靜態目錄檔案列表:"
ls -la ${CONFIG_DIR}

# 啟動nginx
echo "啟動Nginx..."
exec nginx -g 'daemon off;' 