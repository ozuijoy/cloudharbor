<template>
  <div class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div class="relative rounded-lg max-w-sm sm:max-w-lg w-full mx-auto shadow-xl overflow-hidden bg-white dark:bg-gray-800 max-h-[95vh] sm:max-h-[85vh]">
      <!-- 標題欄 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="text-base sm:text-lg font-medium text-gray-900 dark:text-white">編輯檔案資訊</h3>
      </div>

      <!-- 表單內容 -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 overflow-y-auto" style="max-height: calc(95vh - 160px)">
        <div v-if="error" class="mb-4 p-3 rounded bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400">
          {{ error }}
        </div>

        <form @submit.prevent="saveChanges">
          <!-- 檔名(只讀) -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 檔名 </label>
            <input
              type="text"
              class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-70 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              disabled
              :value="fileData.filename"
            />
          </div>

          <!-- 短連結 -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 自定義短連結 </label>
            <div class="flex items-center">
              <span class="text-sm mr-1 text-gray-600 dark:text-gray-400">/</span>
              <input
                type="text"
                class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                v-model="fileData.slug"
                placeholder="例如: my-file"
              />
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">留空則系統自動生成</p>
          </div>

          <!-- 備註 -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 備註資訊 </label>
            <textarea
              class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              v-model="fileData.remark"
              rows="2"
              placeholder="檔案的描述資訊"
            ></textarea>
          </div>

          <!-- 最大檢視次數 -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 最大檢視次數 </label>
            <input
              type="number"
              class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              v-model="fileData.max_views"
              min="0"
              placeholder="留空表示無限制"
            />
          </div>

          <!-- 過期時間 -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 過期時間 </label>
            <select
              v-model="expiryOption"
              class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
            >
              <option value="1">1小時</option>
              <option value="24">1天</option>
              <option value="168">7天</option>
              <option value="720">30天</option>
              <option value="0">永不過期</option>
            </select>
          </div>

          <!-- 訪問密碼 -->
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300"> 訪問密碼 </label>
            <input
              type="text"
              class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              v-model="fileData.password"
              placeholder="留空則不修改密碼"
              :disabled="clearPassword"
            />
            <!-- 新增清除密碼功能 -->
            <div class="mt-2 flex items-center">
              <input
                type="checkbox"
                id="clear_password"
                v-model="clearPassword"
                class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50 dark:border-gray-600 dark:bg-gray-700"
                :disabled="fileData.password.length > 0"
              />
              <label for="clear_password" class="ml-2 block text-sm text-gray-700 dark:text-gray-300"> 清除密碼保護 </label>
            </div>
            <p v-if="file.has_password && !fileData.password && !clearPassword" class="mt-1 text-xs text-yellow-500">留空將保持原密碼不變</p>
            <p v-if="clearPassword" class="mt-1 text-xs text-red-500">警告：勾選此項將移除密碼保護</p>
          </div>

          <!-- 使用Worker代理 -->
          <div class="mb-4">
            <div class="flex items-center">
              <input
                type="checkbox"
                id="use_proxy"
                v-model="fileData.use_proxy"
                class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50 dark:border-gray-600 dark:bg-gray-700"
              />
              <label for="use_proxy" class="ml-2 block text-sm text-gray-700 dark:text-gray-300"> 使用Worker代理訪問 </label>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">啟用後，預覽頁將透過Worker代理，否則使用S3直鏈</p>
          </div>

          <!-- 按鈕組 -->
          <div class="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              @click="$emit('close')"
              class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white"
            >
              取消
            </button>
            <button type="submit" class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white" :disabled="saving">
              {{ saving ? "儲存中..." : "儲存" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from "vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FileEditModal");

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "save"]);

// 錯誤資訊
const error = ref("");
// 儲存中狀態
const saving = ref(false);
// 新增清除密碼標記
const clearPassword = ref(false);

/**
 * 格式化日期為input[type=datetime-local]所需的格式
 * @param {Date} date - 日期物件
 * @returns {string} 格式化後的日期字串
 */
const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// 檔案編輯資料
const fileData = reactive({
  id: "",
  filename: "",
  slug: "",
  remark: "",
  max_views: null,
  expires_at: null,
  password: "",
  use_proxy: false,
});

// 過期時間選項
const expiryOption = ref("0"); // 預設為永不過期

// 監聽檔案資料變化，初始化編輯表單
watch(
  () => props.file,
  (newFile) => {
    if (newFile) {
      // 複製檔案資料
      fileData.id = newFile.id;
      fileData.filename = newFile.filename;
      fileData.slug = newFile.slug || "";
      fileData.remark = newFile.remark || "";
      fileData.max_views = newFile.max_views || null;
      fileData.expires_at = newFile.expires_at || null;
      fileData.password = ""; // 出於安全考慮不回顯密碼
      // 確保 use_proxy 值正確轉換為布林值，資料庫中可能儲存為 0 或 1
      fileData.use_proxy = newFile.use_proxy === 1 || newFile.use_proxy === true;

      // 如果有過期時間，根據到期日期計算最接近的選項
      if (newFile.expires_at) {
        const now = new Date();
        const expiresAt = new Date(newFile.expires_at);

        // 計算小時差
        const hoursDiff = Math.round((expiresAt - now) / (1000 * 60 * 60));

        // 根據小時差選擇最接近的選項
        if (hoursDiff <= 0) {
          // 如果已經過期，預設設定為1小時
          expiryOption.value = "1";
        } else if (hoursDiff <= 12) {
          expiryOption.value = "1"; // 1小時
        } else if (hoursDiff <= 96) {
          expiryOption.value = "24"; // 1天
        } else if (hoursDiff <= 336) {
          expiryOption.value = "168"; // 7天
        } else if (hoursDiff <= 1440) {
          expiryOption.value = "720"; // 30天
        } else {
          expiryOption.value = "720"; // 預設為30天，如果超過30天
        }
      } else {
        expiryOption.value = "0"; // 永不過期
      }
    }
  },
  { immediate: true }
);

/**
 * 儲存更改
 * 將表單資料提交給父元件
 */
const saveChanges = () => {
  // 清除錯誤
  error.value = "";
  saving.value = true;

  try {
    // 準備提交的資料
    const updatedFile = {
      id: fileData.id,
      slug: fileData.slug.trim() || null,
      remark: fileData.remark.trim() || null,
      max_views: fileData.max_views !== null ? parseInt(fileData.max_views, 10) : null,
      use_proxy: fileData.use_proxy,
    };

    // 處理密碼 - 三種情況：不變、更新、清除
    if (fileData.password) {
      updatedFile.password = fileData.password;
    } else if (clearPassword.value) {
      updatedFile.password = ""; // 明確設定為空字串表示清除密碼
    }
    // 如果既沒有新密碼也沒有勾選清除密碼，則不修改密碼

    // 處理過期時間
    const expiryHours = parseInt(expiryOption.value);

    if (expiryHours > 0) {
      // 計算過期日期
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);
      updatedFile.expires_at = expiresAt.toISOString();
    } else {
      // 永不過期
      updatedFile.expires_at = null;
    }

    // 提交到父元件
    emit("save", updatedFile);
  } catch (err) {
    log.error("處理表單資料出錯:", err);
    error.value = "資料處理錯誤，請檢查輸入";
  } finally {
    saving.value = false;
  }
};
</script>
