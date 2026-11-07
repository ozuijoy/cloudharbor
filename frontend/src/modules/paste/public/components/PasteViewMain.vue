<script setup>
// PasteViewMain元件 - 主元件，整合各個功能模組
// 負責協調預覽、大綱和編輯功能，管理全域性狀態和資料流
import { ref, computed, onMounted, onBeforeUnmount, watch, defineAsyncComponent } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useEventListener } from "@vueuse/core";

import PasteViewPreview from "./PasteViewPreview.vue";
// 效能最佳化：大綱 / 編輯器只有在使用者點選時才需要，改為按需載入
const PasteViewOutline = defineAsyncComponent(() => import("./PasteViewOutline.vue"));
const PasteViewEditor = defineAsyncComponent(() => import("./PasteViewEditor.vue"));
import { formatExpiry, debugLog } from "./PasteViewUtils";
import { usePasteService } from "@/modules/paste";
import { isExpired } from "@/utils/timeUtils.js";
import { ApiStatus } from "@/api/ApiStatus";
import { copyToClipboard } from "@/utils/clipboard";
import { useAuthStore } from "@/stores/authStore.js";
import { IconExclamation, IconEye, IconEyeOff, IconRefresh, IconUser } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PasteViewMain");

// 定義環境變數
const isDev = import.meta.env.DEV;
// 是否啟用除錯 - 預設禁用，即使在開發環境
const enableDebug = ref(false);
// 開發模式下的特殊選項 - 強制顯示編輯按鈕用於測試
const forceShowEditButton = ref(false);

// 接收父元件傳遞的屬性
const props = defineProps({
  // 是否為暗色模式
  darkMode: {
    type: Boolean,
    required: true,
  },
  // 文字分享的唯一識別符號
  slug: {
    type: String,
    required: true,
  },
});

const router = useRouter();
const route = useRoute();

// 領域 service 例項（公開檢視使用僅訪問公開介面）
const pasteService = usePasteService();

// 主要狀態變數
const paste = ref(null); // 文字分享資料
const loading = ref(true); // 載入狀態
const error = ref(""); // 錯誤資訊
const passwordInput = ref(""); // 密碼輸入框的值
const needPassword = ref(false); // 是否需要密碼
const showPassword = ref(false); // 是否顯示密碼
let mounted = false; // 元件是否已掛載
const previewRef = ref(null); // 預覽元件引用
const editContent = ref(""); // 編輯內容

// 檢視模式設定
const viewMode = ref("preview"); // 'preview', 'outline', 'edit'
// 純文字模式標誌 - 控制是否顯示為純文字而非渲染的Markdown
const isPlainTextMode = ref(false);
// 記錄是否手動選擇過顯示模式
const hasUserSelectedTextMode = ref(false);

// 使用認證Store
const authStore = useAuthStore();

// 從Store獲取許可權狀態的計算屬性
const isAdmin = computed(() => authStore.isAdmin);
const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
// 這裡的“文字許可權”用於管理（編輯/刪除），對應後端 TEXT_MANAGE 位
const hasTextPermission = computed(() => authStore.hasTextManagePermission);
const isCreator = ref(false); // 這個需要根據具體文字分享的建立者資訊判斷
// 大綱相關資料
const outlineData = ref([]); // 扁平結構大綱資料
const outlineTreeData = ref([]); // 樹形結構大綱資料

// 標記是否透過取消按鈕退出編輯模式
const isCancelling = ref(false);

// 許可權檢查邏輯已移至認證Store，這裡只需要檢查建立者狀態

// 檢查建立者狀態
const checkCreatorStatus = () => {
  // 檢查是否是建立者 - 如果文字分享已載入
  if (paste.value && hasApiKey.value) {
    try {
      debugLog(enableDebug.value, isDev, "檢查API金鑰使用者是否為建立者，文字created_by:", paste.value.created_by);

      if (!paste.value.created_by) {
        debugLog(enableDebug.value, isDev, "文字沒有建立者資訊");
        isCreator.value = false;
        return;
      }

      // 從認證Store獲取API金鑰資訊
      const keyInfo = authStore.apiKeyInfo;
      if (keyInfo) {
        debugLog(enableDebug.value, isDev, "API金鑰資訊:", keyInfo);

        // 處理created_by欄位，後端返回的格式是"apikey:金鑰ID"
        const createdBy = paste.value.created_by;

        // 如果created_by以"apikey:"開頭，提取實際的ID部分
        if (typeof createdBy === "string" && createdBy.startsWith("apikey:")) {
          const actualKeyId = createdBy.substring(7); // 移除"apikey:"字首
          isCreator.value = keyInfo.id === actualKeyId;
          debugLog(enableDebug.value, isDev, `比較建立者ID "${actualKeyId}" 與當前API金鑰ID "${keyInfo.id}": ${isCreator.value ? "匹配" : "不匹配"}`);
        } else {
          // 直接比較(相容其他格式)
          isCreator.value = keyInfo.id === createdBy;
          debugLog(enableDebug.value, isDev, `直接比較建立者 "${createdBy}" 與API金鑰ID "${keyInfo.id}": ${isCreator.value ? "匹配" : "不匹配"}`);
        }
        return;
      }

      // 如果沒有金鑰資訊，但有文字許可權，放寬條件
      if (hasTextPermission.value) {
        debugLog(enableDebug.value, isDev, "嘗試使用API金鑰直接驗證建立者身份");

        const createdBy = paste.value.created_by;
        if (typeof createdBy === "string" && createdBy.startsWith("apikey:")) {
          // 沒有足夠資訊時，簡單假設有許可權的API金鑰使用者可以編輯API金鑰建立的內容
          isCreator.value = true;
          debugLog(enableDebug.value, isDev, "放寬條件: 允許API金鑰使用者編輯任何API金鑰建立的內容");
        } else {
          isCreator.value = false;
        }
      } else {
        isCreator.value = false;
      }
    } catch (e) {
      log.error("檢查建立者狀態失敗:", e);
      isCreator.value = false;
    }
  } else {
    isCreator.value = false;
  }

  debugLog(enableDebug.value, isDev, "API金鑰使用者最終狀態:", {
    hasApiKey: hasApiKey.value,
    hasTextPermission: hasTextPermission.value,
    isCreator: isCreator.value,
  });
};

// 監聽slug的變化，當它變化時重新載入內容
watch(
  () => props.slug,
  (newSlug) => {
    if (mounted && newSlug) {
      debugLog(enableDebug.value, isDev, "PasteView: 檢測到slug變化，重新載入", newSlug);
      loadPaste();
    }
  }
);

// 獲取文字分享內容 - 主要資料載入函式
const loadPaste = async (password = null) => {
  if (!mounted) return;

  loading.value = true;
  error.value = "";

  try {
    debugLog(enableDebug.value, isDev, "PasteView: 開始載入內容", props.slug);
    // 呼叫API獲取文字分享資料
    const result = await pasteService.getPasteBySlug(props.slug, password);
    paste.value = result;

    // 檢查返回的完整資料用於除錯
    debugLog(enableDebug.value, isDev, "文字分享載入成功", {
      slug: result.slug,
      title: result.title || "",
      is_public: result.is_public,
      hasPassword: result.hasPassword,
      created_by: result.created_by || "無",
      contentLength: result.content?.length || 0,
    });

    if (!result.created_by) {
      debugLog(enableDebug.value, isDev, "警告: 文字分享沒有建立者資訊");
    }

    // 檢查是否需要密碼訪問
    if (result.requiresPassword) {
      needPassword.value = true;
      loading.value = false;
      return;
    }

    needPassword.value = false;

    // 儲存編輯內容原始值，用於編輯模式
    editContent.value = result.content || "";

    // 效能最佳化：如果內容看起來不像 Markdown，預設用純文字模式展示
    if (!hasUserSelectedTextMode.value) {
      const contentText = String(result.content || "");
      const looksLikeMarkdown =
        /(?:```|~~~)|\[[^\]]+\]\([^)]+\)|(^|\n)\s{0,3}#{1,6}\s|\*\*|__|[*_-]{3,}/m.test(contentText);
      isPlainTextMode.value = !looksLikeMarkdown;
    }

    // 如果需要重新驗證認證狀態，則進行驗證
    if (authStore.needsRevalidation) {
      await authStore.validateAuth();
    }

    // 由於文字載入完成，此時可以正確檢查建立者狀態
    checkCreatorStatus();
  } catch (err) {
    log.error("獲取文字分享失敗:", err);
    // 優先使用HTTP狀態碼判斷錯誤型別，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - 密碼錯誤
      error.value = "密碼驗證失敗，請重試";
      // 確保密碼輸入框仍然顯示
      needPassword.value = true;
    } else if (err.status === ApiStatus.GONE || err.response?.status === ApiStatus.GONE || err.code === ApiStatus.GONE) {
      // 410 Gone - 資源已過期或達到最大檢視次數
      error.value = "此文字分享已不可訪問：達到最大檢視次數或已過期";
      needPassword.value = false;
    } else if (err.status === ApiStatus.NOT_FOUND || err.response?.status === ApiStatus.NOT_FOUND || err.code === ApiStatus.NOT_FOUND) {
      // 404 Not Found - 資源不存在
      error.value = "此文字分享不存在或已被刪除";
      needPassword.value = false;
    } else {
      // 後備判斷：基於錯誤訊息內容判斷錯誤型別（保持相容性）
      if (err.message && (err.message.includes("密碼錯誤") || err.message.includes("密碼不正確") || err.message.includes("401"))) {
        error.value = "密碼驗證失敗，請重試";
        // 確保密碼輸入框仍然顯示
        needPassword.value = true;
      } else if (err.message && (err.message.includes("文字分享已過期") || err.message.includes("最大檢視次數") || err.message.includes("410"))) {
        error.value = "此文字分享已不可訪問：達到最大檢視次數或已過期";
        needPassword.value = false;
      } else if (err.message && (err.message.includes("找不到") || err.message.includes("不存在") || err.message.includes("404"))) {
        error.value = "此文字分享不存在或已被刪除";
        needPassword.value = false;
      } else {
        error.value = err.message || "獲取文字分享失敗";
        // 除非明確知道是401密碼錯誤，其他錯誤預設不顯示密碼輸入框
        needPassword.value = false;
      }
    }
  } finally {
    loading.value = false;
  }
};

// 提取文件大綱 - 由預覽元件渲染完成後呼叫
// 分析DOM結構生成大綱資料
const extractOutline = () => {
  // 使用更安全的DOM查詢，避免在元件解除安裝時出錯
  if (!mounted) return;

  const previewElement = document.querySelector(".vditor-reset");
  if (!previewElement) return;

  // 獲取所有標題元素
  const headings = previewElement.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const outline = [];

  // 構建巢狀大綱結構
  const outlineTree = [];
  let currentParents = []; // 用於儲存每個級別的當前父項

  headings.forEach((heading) => {
    // 獲取標題級別、文字和ID
    const level = parseInt(heading.tagName.substring(1));
    const text = heading.textContent;
    const id = heading.id;

    // 建立大綱項物件
    const item = {
      level,
      text,
      id,
      children: [],
      expanded: true, // 預設展開
    };

    // 確定此標題在大綱中的位置 - 構建層級關係
    if (level === 1) {
      // 一級標題直接新增到大綱樹根
      outlineTree.push(item);
      currentParents = [item]; // 重置所有父級
    } else {
      // 找到當前標題的父標題
      let parentLevel = level - 1;
      while (parentLevel >= 1) {
        if (currentParents[parentLevel - 1]) {
          // 將當前項新增到找到的父項的子項中
          currentParents[parentLevel - 1].children.push(item);
          break;
        }
        parentLevel--;
      }

      // 如果沒有找到合適的父級，則新增到根級
      if (parentLevel < 1) {
        outlineTree.push(item);
      }

      // 更新當前級別的父項
      currentParents[level - 1] = item;
      // 清除所有更高階別的父項
      for (let i = level; i < 6; i++) {
        currentParents[i] = null;
      }
    }

    // 同時保留扁平結構用於相容性
    outline.push(item);
  });

  // 更新大綱資料狀態
  outlineData.value = outline;
  outlineTreeData.value = outlineTree;
  debugLog(enableDebug.value, isDev, "提取大綱資料:", outline.length, "項");
};

// 處理預覽元件內容渲染完成事件
const handlePreviewRendered = () => {
  extractOutline();
};

// 切換大綱/預覽/編輯模式
const switchViewMode = (mode) => {
  // 如果當前是編輯模式，只能透過儲存或取消按鈕切換到預覽模式
  if (viewMode.value === "edit" && mode !== "preview") {
    return;
  }

  if (viewMode.value === mode) return;

  // 從編輯模式切換到預覽模式時
  if (viewMode.value === "edit" && mode === "preview") {
    // 如果是點選取消按鈕，設定標記
    isCancelling.value = true;
  }

  viewMode.value = mode;
};

// 點選大綱項時滾動到對應位置
const scrollToHeading = (id) => {
  if (!id) return;

  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

// 儲存編輯內容 - 呼叫API更新文字分享
const saveEdit = async (updateData) => {
  if (!paste.value) return;

  loading.value = true;
  error.value = "";

  try {
    // 檢查編輯許可權
    if (!isAdmin.value && !(hasApiKey.value && hasTextPermission.value && isCreator.value)) {
      throw new Error("您沒有編輯許可權");
    }

    // 獲取文字分享的唯一標識
    const slug = paste.value.slug;
    if (!slug) {
      throw new Error("無法獲取文字分享的唯一標識");
    }

    // 檢查是否修改了密碼
    const passwordChanged = updateData.password || updateData.clearPassword;

    // 使用統一API更新內容（自動根據認證資訊處理許可權）
    const updateResult = await pasteService.updatePaste(slug, updateData);
    const updatedSlug = updateResult && typeof updateResult === "object" && updateResult.slug ? updateResult.slug : paste.value.slug;
    const slugChanged = updatedSlug && updatedSlug !== paste.value.slug;

    // 更新本地內容和後設資料狀態
    paste.value.content = updateData.content;
    // 儲存成功後，更新編輯內容的原始值，這樣取消按鈕可以恢復到最新儲存的內容
    editContent.value = updateData.content;
    if (Object.prototype.hasOwnProperty.call(updateData, "title")) {
      paste.value.title = updateData.title;
    }
    paste.value.remark = updateData.remark;
    paste.value.max_views = updateData.max_views;
    paste.value.expires_at = updateData.expires_at;
    if (Object.prototype.hasOwnProperty.call(updateData, "is_public")) {
      paste.value.is_public = updateData.is_public;
    }
    if (slugChanged) {
      paste.value.slug = updatedSlug;
    }

    // 切換回預覽模式
    switchViewMode("preview");

    // 顯示成功訊息
    error.value = "儲存成功";
    setTimeout(() => {
      error.value = "";
    }, 3000);

    if (slugChanged) {
      try {
        const currentQuery = { ...route.query };
        const currentHash = route.hash;
        await router.replace({
          name: "PasteView",
          params: { slug: updatedSlug },
          query: currentQuery,
          hash: currentHash,
        });
      } catch (replaceError) {
        log.warn("重定向到新連結失敗", replaceError);
      }
    }

    // 如果修改了密碼，需要重新載入內容以獲取新的驗證狀態
    if (passwordChanged) {
      // 清空密碼輸入框
      passwordInput.value = "";

      // 顯示正在重新整理狀態
      setTimeout(() => {
        // 清空當前內容，重新載入
        debugLog(enableDebug.value, isDev, "密碼已修改，重新載入內容以更新驗證狀態");
        loadPaste(); // 重新載入會觸發密碼驗證介面（如果需要）
      });
    }
  } catch (err) {
    log.error("儲存內容失敗:", err);
    error.value = err.message || "儲存失敗，請重試";
  } finally {
    loading.value = false;
  }
};

// 取消編輯 - 恢復原始內容並返回預覽模式
const cancelEdit = () => {
  isCancelling.value = true;
  switchViewMode("preview");
  isCancelling.value = false;
};

// 提交密碼 - 處理密碼保護的文字分享
const submitPassword = async () => {
  if (!passwordInput.value) {
    error.value = "請輸入密碼";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await loadPaste(passwordInput.value);

    // 如果驗證透過（沒有觸發requiresPassword），清空密碼欄位
    if (!needPassword.value) {
      passwordInput.value = "";
    }
  } catch (err) {
    // 錯誤處理已在loadPaste中完成，不需要額外處理
    // 但為了確保介面體驗良好，在這裡結束loading狀態
    loading.value = false;
  }
};

// 複製內容到剪貼簿 - 提供兩種實現方式以確保相容性
const copyContentToClipboard = async () => {
  if (!paste.value || !paste.value.content) {
    error.value = "沒有可複製的內容";
    return;
  }

  try {
    const success = await copyToClipboard(paste.value.content);

    if (success) {
      error.value = "複製成功：內容已複製到剪貼簿";
      setTimeout(() => {
        error.value = "";
      }, 3000);
    } else {
      throw new Error("複製失敗");
    }
  } catch (e) {
    log.error("複製失敗:", e);
    error.value = "複製失敗，請手動選擇內容複製";
  }
};

// 複製原始文字連結到剪貼簿
const copyRawLink = async () => {
  if (!paste.value || !paste.value.slug) {
    error.value = "沒有可複製的原始連結";
    return;
  }

  try {
    // 從getRawPasteUrl獲取原始連結
    const rawLink = pasteService.getRawPasteUrl(paste.value.slug, paste.value.plain_password || null);

    // 複製連結到剪貼簿
    const success = await copyToClipboard(rawLink);

    if (success) {
      error.value = "複製成功：原始連結已複製到剪貼簿";
      setTimeout(() => {
        error.value = "";
      }, 3000);
    } else {
      throw new Error("複製失敗");
    }
  } catch (e) {
    log.error("複製失敗:", e);
    error.value = "複製失敗，請手動複製原始連結";
  }
};

// 切換除錯資訊顯示 - 開發輔助功能
const toggleDebug = () => {
  enableDebug.value = !enableDebug.value;
  debugLog(true, isDev, enableDebug.value ? "除錯模式已開啟" : "除錯模式已關閉");
};

// 切換強制顯示編輯按鈕選項 - 僅開發模式使用
const toggleForceEditButton = () => {
  if (isDev) {
    forceShowEditButton.value = !forceShowEditButton.value;
    debugLog(true, isDev, forceShowEditButton.value ? "已強制顯示編輯按鈕" : "已禁用強制顯示編輯按鈕");
  }
};

// 切換密碼可見性
const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

// 切換純文字/Markdown渲染模式
const toggleTextMode = (isPlainText) => {
  hasUserSelectedTextMode.value = true;
  isPlainTextMode.value = isPlainText;
  debugLog(enableDebug.value, isDev, isPlainText ? "切換到TXT模式" : "切換到MD渲染模式");
};

// 元件掛載時載入文字分享
onMounted(async () => {
  debugLog(enableDebug.value, isDev, "PasteView: 元件掛載", props.slug);
  mounted = true;

  // 延遲載入以確保DOM已準備就緒
  setTimeout(async () => {
    await loadPaste();
  }, 150);
});

// 處理認證狀態變化
function handleAuthStateChange(event) {
  debugLog(enableDebug.value, isDev, "PasteViewMain: 認證狀態變化", event.detail);
  // 重新檢查建立者狀態
  checkCreatorStatus();
}

// 監聽認證狀態變化（自動清理）
useEventListener(window, "auth-state-changed", handleAuthStateChange);

// 元件解除安裝時清理資源
onBeforeUnmount(() => {
  debugLog(enableDebug.value, isDev, "PasteView: 元件解除安裝");
  mounted = false;
  paste.value = null;
});
</script>

<template>
  <div class="paste-view max-w-6xl mx-auto px-3 sm:px-6 flex-1 flex flex-col pt-6 sm:pt-8">
    <div class="mb-6">
      <!-- 將原來的大標題替換為更簡潔的麵包屑樣式導航 -->
      <div class="py-3 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 mb-4">
        <a href="/" class="hover:text-primary-600 dark:hover:text-primary-400">首頁</a>
        <span class="mx-2">/</span>
        <span class="text-gray-700 dark:text-gray-300">文字分享</span>
      </div>

      <!-- 標題與可見性資訊 - 僅在非密碼保護狀態下顯示 -->
      <div v-if="paste && !needPassword" class="mb-3">
        <div class="flex items-center flex-wrap gap-2">
          <h1 class="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
            {{ paste.title || paste.slug || '未命名文字' }}
          </h1>
          <span
            v-if="paste.is_public === false"
            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          >
            <IconUser size="xs" class="h-3.5 w-3.5 mr-1" />
            僅內部可見
          </span>
        </div>
      </div>

      <!-- 載入中狀態顯示 -->
      <div v-if="loading" class="py-16 flex justify-center">
        <IconRefresh class="animate-spin h-12 w-12 text-primary-500" />
      </div>

      <!-- 錯誤資訊顯示區域 - 僅在有錯誤且不是密碼錯誤時顯示 -->
      <div v-else-if="error && !needPassword && !error.includes('成功')" class="error-container py-12 px-4 max-w-4xl mx-auto text-center">
        <IconExclamation class="h-16 w-16 mx-auto mb-4 text-red-600 dark:text-red-500" />
        <h2 class="text-2xl font-bold mb-2 text-gray-900 dark:text-white">文字訪問錯誤</h2>
        <p class="text-lg mb-6 text-gray-600 dark:text-gray-300">{{ error }}</p>
        <a
          href="/"
          class="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          返回首頁
        </a>
      </div>

      <!-- 密碼輸入區域 - 用於訪問受密碼保護的內容 -->
      <div v-else-if="needPassword" class="py-6 px-4 flex justify-center">
        <div class="max-w-sm w-full p-5 border rounded-lg shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <h3 class="text-lg font-medium mb-4" :class="darkMode ? 'text-white' : 'text-gray-900'">此內容需要密碼訪問</h3>
          <p class="mb-4 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">此文字分享已被密碼保護，請輸入密碼檢視內容</p>

          <div class="mb-4">
            <label for="password" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">密碼</label>
            <div class="relative">
              <input
                :type="showPassword ? 'text' : 'password'"
                id="password"
                autocomplete="current-password"
                v-model="passwordInput"
                @keyup.enter="submitPassword"
                class="block w-full px-3 py-2 rounded-md shadow-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 password-input"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white focus:ring-offset-gray-800' : 'border-gray-300 text-gray-900 focus:ring-offset-white'"
                placeholder="請輸入密碼"
              />
              <button
                type="button"
                @click="togglePasswordVisibility"
                class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
              >
                <IconEyeOff v-if="showPassword" size="md" class="h-5 w-5" />
                <IconEye v-else size="md" class="h-5 w-5" />
              </button>
            </div>
            <!-- 顯示密碼錯誤訊息 -->
            <p v-if="error" class="mt-2 text-sm text-red-500 dark:text-red-400">{{ error }}</p>
          </div>

          <button
            @click="submitPassword"
            class="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            :class="darkMode ? 'focus:ring-offset-gray-800' : 'focus:ring-offset-white'"
          >
            提交
          </button>
        </div>
      </div>

      <!-- 成功訊息顯示 - 獨立顯示，不影響內容區域 -->
      <div v-if="error && error.includes('成功')" class="mt-4 p-4 rounded-md" :class="darkMode ? 'bg-green-900/30' : 'bg-green-50'">
        <div class="text-sm" :class="darkMode ? 'text-green-200' : 'text-green-700'">{{ error }}</div>
      </div>

      <!-- 文字內容顯示區域 - 主要內容容器 -->
      <div v-if="paste && !needPassword && !(error && !error.includes('成功') && !needPassword)" class="mt-6">
        <!-- 元資訊顯示區域 - 顯示過期時間和剩餘檢視次數 -->
        <div class="mb-6 p-5 border rounded-lg" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="grid grid-cols-1 gap-4 text-sm">
            <div v-if="paste.expires_at">
              <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">過期時間:</span>
              <span class="ml-2" :class="[darkMode ? 'text-white' : 'text-gray-900', isExpired(paste.expires_at) ? 'text-red-500' : '']">{{ formatExpiry(paste.expires_at) }}</span>
            </div>
            <div v-if="paste.max_views">
              <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">剩餘檢視次數:</span>
              <span
                class="ml-2"
                :class="[
                  darkMode ? 'text-white' : 'text-gray-900',
                  paste.max_views - paste.views <= 5 ? 'text-amber-500' : '',
                  paste.max_views - paste.views <= 1 ? 'text-red-500' : '',
                ]"
              >
                {{ paste.max_views - paste.views }}
              </span>
            </div>
          </div>
        </div>

        <!-- 檢視模式切換和操作按鈕區域 -->
        <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
          <!-- 檢視模式切換按鈕組 - 在編輯模式下隱藏 -->
          <div v-if="viewMode !== 'edit'" class="flex border rounded-md overflow-hidden" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
            <button
              @click="switchViewMode('preview')"
              class="px-3 py-1.5 text-sm font-medium"
              :class="[
                viewMode === 'preview'
                  ? darkMode
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : darkMode
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50',
              ]"
            >
              預覽
            </button>
            <button
              @click="switchViewMode('outline')"
              class="px-3 py-1.5 text-sm font-medium"
              :class="[
                viewMode === 'outline'
                  ? darkMode
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : darkMode
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50',
              ]"
            >
              大綱
            </button>
            <!-- 純文字/Markdown切換按鈕組 -->
            <button
              @click="toggleTextMode(false)"
              class="px-3 py-1.5 text-sm font-medium"
              :class="[
                !isPlainTextMode
                  ? darkMode
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : darkMode
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50',
              ]"
            >
              MD
            </button>
            <button
              @click="toggleTextMode(true)"
              class="px-3 py-1.5 text-sm font-medium"
              :class="[
                isPlainTextMode
                  ? darkMode
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : darkMode
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50',
              ]"
            >
              TXT
            </button>
          </div>
          <!-- 編輯模式下顯示固定標題 -->
          <div v-else class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">編輯模式 - 請使用下方按鈕儲存或取消</div>

          <!-- 管理員編輯按鈕和複製按鈕 - 在編輯模式下隱藏 -->
          <div v-if="viewMode !== 'edit'" class="flex items-center gap-2">
            <!-- 複製內容按鈕 -->
            <button
              v-if="paste && paste.content"
              @click="copyContentToClipboard"
              class="px-4 py-1.5 text-sm font-medium border rounded-md"
              :class="darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
            >
              複製內容
            </button>

            <!-- 複製原始連結按鈕 -->
            <button
              v-if="paste && paste.slug"
              @click="copyRawLink"
              class="px-4 py-1.5 text-sm font-medium border rounded-md"
              :class="darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
            >
              raw
            </button>

            <!-- 編輯按鈕 - 管理員和有許可權的API金鑰建立者可見 -->
            <button
              v-if="isAdmin || (hasApiKey && hasTextPermission && isCreator) || (isDev && forceShowEditButton)"
              @click="switchViewMode('edit')"
              class="px-4 py-1.5 text-sm font-medium border rounded-md"
              :class="darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
            >
              編輯內容
            </button>
          </div>

          <!-- 除錯按鈕 (僅在開發模式顯示) -->
          <div v-if="isDev" class="ml-auto">
            <button
              @click="toggleDebug"
              class="text-xs px-2 py-1 mr-2 rounded transition-colors"
              :class="enableDebug ? 'bg-yellow-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'"
            >
              {{ enableDebug ? "隱藏除錯" : "除錯" }}
            </button>
            <button
              @click="toggleForceEditButton"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="forceShowEditButton ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'"
            >
              {{ forceShowEditButton ? "取消強制編輯" : "強制編輯" }}
            </button>
          </div>
        </div>

        <!-- 除錯資訊區域 (僅在明確啟用除錯時顯示) -->
        <div v-if="enableDebug && paste && paste.content" class="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 text-xs rounded">
          <details open>
            <summary class="cursor-pointer text-yellow-700 dark:text-yellow-300">除錯資訊</summary>
            <div class="mt-2 whitespace-pre-wrap text-gray-700 dark:text-gray-300 break-all">
              <div>內容長度: {{ paste.content?.length || 0 }}字元</div>
              <div>預覽元件: {{ previewRef ? "已引用" : "未引用" }}</div>
              <div>大綱項數: {{ outlineData.length }}</div>
              <div>是否管理員: {{ isAdmin ? "是" : "否" }}</div>
              <div>是否有API金鑰: {{ hasApiKey ? "是" : "否" }}</div>
              <div>是否有文字許可權: {{ hasTextPermission ? "是" : "否" }}</div>
              <div>是否為建立者: {{ isCreator ? "是" : "否" }}</div>
              <div>強制顯示編輯按鈕: {{ forceShowEditButton ? "是" : "否" }}</div>
              <div>當前模式: {{ viewMode }}</div>
              <div>顯示格式: {{ isPlainTextMode ? "TXT模式" : "MD渲染模式" }}</div>
              <div>內容前20字元: {{ paste.content?.substring(0, 20) }}...</div>
              <div>建立者資訊: {{ paste.created_by || "無" }}</div>
            </div>
          </details>
        </div>

        <!-- 內容區域 - 根據不同模式顯示不同的內容 -->
        <div class="border rounded-lg shadow-sm overflow-hidden" :class="darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'">
          <!-- 常規預覽模式 - 顯示Markdown渲染結果 -->
          <div v-if="viewMode === 'preview'" class="p-6">
            <PasteViewPreview
              ref="previewRef"
              :dark-mode="darkMode"
              :content="paste.content"
              :is-dev="isDev"
              :enable-debug="enableDebug"
              :is-plain-text-mode="isPlainTextMode"
              @rendered="handlePreviewRendered"
            />
          </div>

          <!-- 大綱預覽模式 - 左側顯示大綱，右側顯示內容 -->
          <div v-else-if="viewMode === 'outline'">
            <PasteViewOutline
              :dark-mode="darkMode"
              :outline-data="outlineData"
              :outline-tree-data="outlineTreeData"
              :content="paste.content"
              :is-dev="isDev"
              :enable-debug="enableDebug"
              @heading-click="scrollToHeading"
            >
              <template #content>
                <div class="content-scroll flex-1 p-4 overflow-y-auto md:absolute md:inset-0">
                  <PasteViewPreview
                    :dark-mode="darkMode"
                    :content="paste.content"
                    :is-dev="isDev"
                    :enable-debug="enableDebug"
                    :is-plain-text-mode="isPlainTextMode"
                    @rendered="handlePreviewRendered"
                  />
                </div>
              </template>
            </PasteViewOutline>
          </div>

          <!-- 編輯模式 - 顯示編輯器和相關配置表單 -->
          <div v-else-if="viewMode === 'edit'" class="flex flex-col p-6">
            <PasteViewEditor
              :dark-mode="darkMode"
              :content="editContent"
              :paste="paste"
              :loading="loading"
              :error="error"
              :is-dev="isDev"
              :enable-debug="enableDebug"
              @save="saveEdit"
              @cancel="cancelEdit"
              @update:error="(val) => (error = val)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 主容器樣式 */
.paste-view {
  min-height: 500px;
  width: 100%;
}

/* 隱藏密碼框的瀏覽器自帶眼睛圖示 */
.password-input::-ms-reveal,
.password-input::-ms-clear {
  display: none !important;
}

/* 大螢幕額外最佳化 - 增加內容區域高度 */
@media (min-width: 1280px) {
  .paste-view {
    min-height: 600px;
  }
}
</style>
