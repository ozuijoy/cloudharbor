<script setup>
import { reactive, watch } from "vue";
// 編輯文字屬性的彈窗
import { IconClose } from "@/components/icons";

// 元件接收的屬性定義
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  showEdit: {
    type: Boolean,
    required: true,
  },
  paste: {
    type: Object,
    default: null,
  },
});

// 定義元件要觸發的事件
const emit = defineEmits(["close", "save"]);

// 編輯文字屬性的彈窗
/**
 * 編輯表單資料物件，用於儲存使用者修改的內容
 * 使用reactive使其具有響應性
 */
const editForm = reactive({
  title: "", // 標題
  remark: "", // 備註資訊
  password: "", // 不回顯密碼，如果填寫則更新密碼
  clearPassword: false, // 是否清除密碼的標記
  expiry_time: "0", // 過期時間（小時），0表示永不過期
  max_views: 0, // 最大檢視次數，0表示無限制
  slug: "", // 連結字尾，為空則系統自動生成
  is_public: true, // 是否公開訪問
});

/**
 * 監聽paste屬性變化，當要編輯的paste物件變化時，更新表單資料
 * immediate設為true確保一開始就執行一次
 */
watch(
  () => props.paste,
  (newPaste) => {
    if (!newPaste) return;

    // 填充表單資料，但密碼不回顯（出於安全考慮）
    editForm.title = newPaste.title || "";
    editForm.remark = newPaste.remark || "";
    editForm.password = ""; // 密碼不回顯
    editForm.clearPassword = false;
    editForm.slug = newPaste.slug || ""; // 設定當前slug

    // 處理過期時間 - 根據剩餘小時數選擇最接近的選項
    if (newPaste.expires_at) {
      const expiryDate = new Date(newPaste.expires_at);
      const now = new Date();
      const diffHours = Math.round((expiryDate - now) / (1000 * 60 * 60));

      if (diffHours <= 1) {
        editForm.expiry_time = "1";
      } else if (diffHours <= 24) {
        editForm.expiry_time = "24";
      } else if (diffHours <= 168) {
        editForm.expiry_time = "168";
      } else if (diffHours <= 720) {
        editForm.expiry_time = "720";
      } else {
        editForm.expiry_time = "0"; // 設定為永不過期
      }
    } else {
      editForm.expiry_time = "0"; // 永不過期
    }

    // 設定最大檢視次數
    editForm.max_views = newPaste.max_views || 0;

    // 設定公開性
    editForm.is_public = Boolean(newPaste.is_public);
  },
  { immediate: true }
);

/**
 * 驗證並處理可開啟次數的輸入
 * 確保輸入的是有效的非負整數
 * @param {Event} event - 輸入事件物件
 */
const validateMaxViews = (event) => {
  // 獲取輸入的值
  const value = event.target.value;

  // 如果是負數，則設定為0
  if (value < 0) {
    editForm.max_views = 0;
    return;
  }

  // 如果包含小數點，擷取整數部分
  if (value.toString().includes(".")) {
    editForm.max_views = parseInt(value);
  }

  // 確保值為有效數字
  if (isNaN(value) || value === "") {
    editForm.max_views = 0;
  } else {
    // 確保是整數
    editForm.max_views = parseInt(value);
  }
};

/**
 * 關閉修改彈窗
 * 觸發close事件通知父元件
 */
const closeEditModal = () => {
  emit("close");
};

/**
 * 儲存修改
 * 收集表單資料，進行驗證，然後觸發save事件將資料傳遞給父元件
 */
const saveEdit = () => {
  // 驗證可開啟次數不能為負數
  if (editForm.max_views < 0) {
    // 透過emit傳遞錯誤資訊
    emit("save", { error: "可開啟次數不能為負數" });
    return;
  }

  // 準備更新資料
  const updateData = {
    id: props.paste?.id, // 新增ID
    slug: props.paste?.slug, // 當前slug（用於API請求路徑）
    content: props.paste?.content, // 使用原內容
    title: editForm.title || null,
    remark: editForm.remark || null,
    max_views: editForm.max_views === 0 ? null : parseInt(editForm.max_views),
    is_public: editForm.is_public,
  };

  // 只有當使用者修改了slug時，才包含newSlug引數
  if (editForm.slug !== props.paste?.slug) {
    updateData.newSlug = editForm.slug || null; // 新的slug（為空則系統自動生成）
  }

  // 處理密碼 - 三種情況：不變、更新、清除
  if (editForm.password) {
    updateData.password = editForm.password;
  } else if (editForm.clearPassword) {
    updateData.clearPassword = true;
  }

  // 處理過期時間 - 將小時數轉換為ISO日期字串
  if (editForm.expiry_time !== "0") {
    const hours = parseInt(editForm.expiry_time);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);
    updateData.expires_at = expiresAt.toISOString();
  } else {
    updateData.expires_at = null; // 永不過期
  }

  // 傳遞更新資料給父元件
  emit("save", updateData);
};
</script>

<template>
  <!-- 編輯彈窗 - 僅在showEdit為true時顯示 -->
  <div v-if="showEdit" class="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="edit-modal-title" role="dialog" aria-modal="true">
    <div class="flex items-center justify-center min-h-screen pt-20 sm:pt-2 px-2 sm:px-4 pb-4 sm:pb-20 text-center sm:p-0">
      <!-- 背景蒙層 - 點選時關閉彈窗 -->
      <div class="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75 transition-opacity" aria-hidden="true" @click="closeEditModal"></div>

      <!-- 使對話方塊居中的輔助元素 -->
      <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

      <!-- 彈窗主體內容 -->
      <div
        class="inline-block align-middle sm:align-middle bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-sm sm:max-w-lg max-h-[95vh] sm:max-h-[85vh] my-1 sm:my-8"
        :class="darkMode ? 'dark' : ''"
      >
        <!-- 彈窗頭部帶關閉按鈕 -->
        <div class="bg-white dark:bg-gray-800 px-4 py-3 sm:py-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h3 class="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100" id="edit-modal-title">修改文字分享屬性</h3>
          <button
            type="button"
            @click="closeEditModal"
            class="rounded-md p-1 inline-flex items-center justify-center text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none"
          >
            <span class="sr-only">關閉</span>
            <IconClose class="h-5 w-5" />
          </button>
        </div>

        <!-- 彈窗內容區 - 帶捲軸 -->
        <div class="bg-white dark:bg-gray-800 px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto" style="max-height: calc(95vh - 160px); min-height: 200px">
          <!-- 修改表單 -->
          <form @submit.prevent="saveEdit" class="space-y-4">
            <!-- 標題 -->
            <div class="mb-4 text-left">
              <label for="title" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">標題</label>
              <input
                id="title"
                type="text"
                v-model="editForm.title"
                class="mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
                placeholder="為文字分享新增一個標題（可選）"
              />
            </div>
            <!-- 連結字尾（slug）欄位 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">連結字尾</label>
              <div class="flex items-center">
                <span class="text-sm mr-1 text-gray-600 dark:text-gray-400">/paste/</span>
                <input
                  type="text"
                  v-model="editForm.slug"
                  class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
                  placeholder="留空則自動生成"
                />
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">當前連結：{{ props.paste?.slug }}，留空則自動生成新連結</p>
            </div>

            <!-- 備註 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">備註資訊</label>
              <textarea
                v-model="editForm.remark"
                rows="2"
                class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
                placeholder="新增備註資訊..."
              ></textarea>
            </div>
            <!-- 可開啟次數輸入區域 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">可開啟次數</label>
              <input
                type="number"
                v-model.number="editForm.max_views"
                min="0"
                step="1"
                class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
                placeholder="0表示無限制"
                @input="validateMaxViews"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">0表示無限制</p>
            </div>

            <!-- 過期時間選擇器 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">過期時間</label>
              <select
                v-model="editForm.expiry_time"
                class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
              >
                <option value="1">1小時</option>
                <option value="24">1天</option>
                <option value="168">7天</option>
                <option value="720">30天</option>
                <option value="0">永不過期</option>
              </select>
            </div>
            <!-- 可見性設定 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">訪問可見性</label>
              <div class="flex items-center">
                <input
                  id="is_public"
                  type="checkbox"
                  v-model="editForm.is_public"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
                />
                <label for="is_public" class="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  公開訪問（關閉時僅管理員和建立者可訪問）
                </label>
              </div>
            </div>

            <!-- 密碼保護設定區域 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">密碼保護</label>
              <!-- 密碼輸入框 -->
              <input
                type="password"
                autocomplete="new-password"
                v-model="editForm.password"
                class="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
                placeholder="留空則不修改密碼"
                :disabled="editForm.clearPassword"
              />
              <!-- 清除密碼核取方塊 -->
              <div class="mt-2 flex items-center">
                <input
                  type="checkbox"
                  id="clearPassword"
                  v-model="editForm.clearPassword"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
                  :disabled="editForm.password.length > 0"
                />
                <label for="clearPassword" class="ml-2 block text-sm text-gray-700 dark:text-gray-300"> 清除密碼保護 </label>
              </div>
              <p v-if="props.paste?.has_password && !editForm.password && !editForm.clearPassword" class="mt-1 text-xs text-yellow-500">留空將保持原密碼不變</p>
              <p v-if="editForm.clearPassword" class="mt-1 text-xs text-red-500">警告：勾選此項將移除密碼保護</p>
            </div>
          </form>
        </div>

        <!-- 彈窗底部按鈕區 -->
        <div class="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 flex flex-col sm:flex-row-reverse sm:space-x-reverse space-y-2 sm:space-y-0 sm:space-x-3">
          <!-- 儲存按鈕 -->
          <button
            type="button"
            class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:w-auto sm:text-sm"
            @click="saveEdit"
          >
            儲存修改
          </button>
          <!-- 取消按鈕 -->
          <button
            type="button"
            class="w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-800 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:w-auto sm:text-sm"
            @click="closeEditModal"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
