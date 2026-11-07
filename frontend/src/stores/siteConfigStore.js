/**
 * 站點配置狀態管理Store
 * 管理站點級別的配置資訊，如站點標題等
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

// 配置常量
const STORAGE_KEY = "cloudharbor_site_config";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小時快取時間
const log = createLogger("SiteConfig");

// ===== Favicon 工具函式 =====

/**
 * 根據URL獲取favicon MIME型別
 * @param {string} url - favicon URL
 * @returns {string} MIME型別
 */
const getFaviconType = (url) => {
  if (url.startsWith("data:")) {
    if (url.includes("image/svg")) return "image/svg+xml";
    if (url.includes("image/png")) return "image/png";
    if (url.includes("image/x-icon")) return "image/x-icon";
    if (url.includes("image/jpeg")) return "image/jpeg";
    return "image/x-icon"; // 預設
  }

  const ext = url.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "image/x-icon";
  }
};

/**
 * 更新頁面favicon
 * @param {string} faviconUrl - favicon URL，空字串表示使用預設圖示
 */
const updatePageFavicon = (faviconUrl) => {
  try {
    // 查詢現有的favicon link標籤
    let faviconLink = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');

    // 如果沒有找到，建立一個新的
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.rel = "icon";
      document.head.appendChild(faviconLink);
    }

    // 設定favicon URL和型別
    if (faviconUrl && faviconUrl.trim()) {
      const finalUrl = faviconUrl.trim();
      faviconLink.href = finalUrl;
      faviconLink.type = getFaviconType(finalUrl);
    } else {
      // 使用預設favicon
      faviconLink.href = "/cloudharbor.svg";
      faviconLink.type = "image/svg+xml";
    }

    log.debug("頁面favicon已更新:", faviconLink.href);
  } catch (error) {
    log.error("更新頁面favicon失敗:", error);
    // 失敗時設定預設favicon
    try {
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink) {
        faviconLink.href = "/cloudharbor.svg";
        faviconLink.type = "image/svg+xml";
      }
    } catch (fallbackError) {
      log.error("設定預設favicon也失敗:", fallbackError);
    }
  }
};

export const useSiteConfigStore = defineStore("siteConfig", () => {
  // ===== 狀態定義 =====

  // 站點配置
  const siteTitle = ref("CloudHarbor"); // 預設站點標題
  const siteFaviconUrl = ref(""); // 站點圖示URL
  const siteFooterMarkdown = ref("© 2025 CloudHarbor. 保留所有權利。"); // 頁尾Markdown內容
  const siteCustomHead = ref(""); // 自定義頭部
  const siteCustomBody = ref(""); // 自定義body

  // 前臺頁面入口開關
  const siteHomeEditorEnabled = ref(true);
  const siteUploadPageEnabled = ref(true);
  const siteMountExplorerEnabled = ref(true);

  // 公告
  const siteAnnouncementEnabled = ref(false);
  const siteAnnouncementContent = ref("");

  const isLoading = ref(false);
  const lastUpdated = ref(null);
  const isInitialized = ref(false);

  // 快取：只在需要時寫入，避免首次載入就佔用 localStorage
  const storedConfig = useLocalStorage(STORAGE_KEY, null, { writeDefaults: false });

  // ===== 計算屬性 =====

  /**
   * 檢查快取是否有效
   */
  const isCacheValid = computed(() => {
    if (!lastUpdated.value) return false;
    const now = Date.now();
    return now - lastUpdated.value < CACHE_TTL;
  });

  /**
   * 獲取完整的站點配置物件
   */
  const siteConfig = computed(() => ({
    title: siteTitle.value,
    faviconUrl: siteFaviconUrl.value,
    announcementEnabled: siteAnnouncementEnabled.value,
    announcementContent: siteAnnouncementContent.value,
    footerMarkdown: siteFooterMarkdown.value,
    customHead: siteCustomHead.value,
    customBody: siteCustomBody.value,
    homeEditorEnabled: siteHomeEditorEnabled.value,
    uploadPageEnabled: siteUploadPageEnabled.value,
    mountExplorerEnabled: siteMountExplorerEnabled.value,
    lastUpdated: lastUpdated.value,
    isInitialized: isInitialized.value,
  }));

  // ===== 私有方法 =====

  /**
   * 從localStorage載入快取的配置
   */
  const loadFromStorage = () => {
    try {
      const config = storedConfig.value;
      if (config && typeof config === "object") {
        if (config.title) {
          siteTitle.value = config.title;
        }
        if (config.faviconUrl !== undefined) {
          siteFaviconUrl.value = config.faviconUrl || "";
        }
        if (config.footerMarkdown !== undefined) {
          siteFooterMarkdown.value = config.footerMarkdown; // 直接使用快取值，包括空字串
        }
        if (config.customHead !== undefined) {
          siteCustomHead.value = config.customHead || "";
        }
        if (config.customBody !== undefined) {
          siteCustomBody.value = config.customBody || "";
        }
        if (config.homeEditorEnabled !== undefined) {
          siteHomeEditorEnabled.value = !!config.homeEditorEnabled;
        }
        if (config.uploadPageEnabled !== undefined) {
          siteUploadPageEnabled.value = !!config.uploadPageEnabled;
        }
        if (config.mountExplorerEnabled !== undefined) {
          siteMountExplorerEnabled.value = !!config.mountExplorerEnabled;
        }
        if (config.announcementEnabled !== undefined) {
          siteAnnouncementEnabled.value = !!config.announcementEnabled;
        }
        if (config.announcementContent !== undefined) {
          siteAnnouncementContent.value = config.announcementContent || "";
        }
        if (config.lastUpdated) {
          lastUpdated.value = config.lastUpdated;
        }

        // 相容舊快取：如果快取裡沒有公告欄位，則強制視為“快取不新鮮”，讓初始化階段走一次 API 拉取
        if (config.announcementEnabled === undefined && config.announcementContent === undefined) {
          lastUpdated.value = null;
        }
        log.debug("從快取載入站點配置:", config);
        return true;
      }
    } catch (error) {
      log.warn("載入站點配置快取失敗:", error);
      // 清除損壞的快取
      storedConfig.remove?.();
    }
    return false;
  };

  /**
   * 儲存配置到localStorage
   */
  const saveToStorage = () => {
    try {
      const config = {
        title: siteTitle.value,
        faviconUrl: siteFaviconUrl.value,
        announcementEnabled: siteAnnouncementEnabled.value,
        announcementContent: siteAnnouncementContent.value,
        footerMarkdown: siteFooterMarkdown.value,
        customHead: siteCustomHead.value,
        customBody: siteCustomBody.value,
        homeEditorEnabled: siteHomeEditorEnabled.value,
        uploadPageEnabled: siteUploadPageEnabled.value,
        mountExplorerEnabled: siteMountExplorerEnabled.value,
        lastUpdated: lastUpdated.value,
      };
      storedConfig.value = config;
      log.debug("站點配置已儲存到快取:", config);
    } catch (error) {
      log.error("儲存站點配置到快取失敗:", error);
    }
  };

  /**
   * 從API獲取站點配置
   */
  const fetchFromAPI = async () => {
    try {
      // 獲取站點設定分組（分組ID = 4）
      const response = await api.system.getSettingsByGroup(4, false);

      if (response && response.success && response.data) {
        // 查詢站點標題設定
        const titleSetting = response.data.find((setting) => setting.key === "site_title");
        if (titleSetting && titleSetting.value) {
          siteTitle.value = titleSetting.value;
        } else {
          // 如果沒有找到設定或值為空，使用預設值
          siteTitle.value = "CloudHarbor";
        }

        // 查詢站點圖示設定
        const faviconSetting = response.data.find((setting) => setting.key === "site_favicon_url");
        if (faviconSetting) {
          siteFaviconUrl.value = faviconSetting.value || "";
        } else {
          siteFaviconUrl.value = "";
        }

        // 查詢公告設定（站點級：用於全域性 Header 顯示入口）
        const announcementEnabledSetting = response.data.find((setting) => setting.key === "site_announcement_enabled");
        if (announcementEnabledSetting) {
          siteAnnouncementEnabled.value = announcementEnabledSetting.value === "true";
        } else {
          siteAnnouncementEnabled.value = false;
        }

        const announcementContentSetting = response.data.find((setting) => setting.key === "site_announcement_content");
        if (announcementContentSetting) {
          siteAnnouncementContent.value = announcementContentSetting.value || "";
        } else {
          siteAnnouncementContent.value = "";
        }

        // 查詢頁尾Markdown設定
        const footerSetting = response.data.find((setting) => setting.key === "site_footer_markdown");
        if (footerSetting) {
          // 直接使用API返回的值，不填充預設值（保持使用者的清空狀態）
          siteFooterMarkdown.value = footerSetting.value;
        } else {
          // 如果API中沒有這個設定，保持當前值（通常是初始預設值）
          // 不強制設定為空，讓首次安裝時保持預設值
        }

        // 查詢自定義頭部設定
        const customHeadSetting = response.data.find((setting) => setting.key === "site_custom_head");
        if (customHeadSetting) {
          siteCustomHead.value = customHeadSetting.value || "";
        } else {
          siteCustomHead.value = "";
        }

        // 查詢自定義body設定
        const customBodySetting = response.data.find((setting) => setting.key === "site_custom_body");
        if (customBodySetting) {
          siteCustomBody.value = customBodySetting.value || "";
        } else {
          siteCustomBody.value = "";
        }

        // 前臺頁面入口開關
        const homeEditorEnabledSetting = response.data.find((setting) => setting.key === "site_home_editor_enabled");
        if (homeEditorEnabledSetting) {
          siteHomeEditorEnabled.value = homeEditorEnabledSetting.value === "true";
        } else {
          siteHomeEditorEnabled.value = true;
        }

        const uploadPageEnabledSetting = response.data.find((setting) => setting.key === "site_upload_page_enabled");
        if (uploadPageEnabledSetting) {
          siteUploadPageEnabled.value = uploadPageEnabledSetting.value === "true";
        } else {
          siteUploadPageEnabled.value = true;
        }

        const mountExplorerEnabledSetting = response.data.find((setting) => setting.key === "site_mount_explorer_enabled");
        if (mountExplorerEnabledSetting) {
          siteMountExplorerEnabled.value = mountExplorerEnabledSetting.value === "true";
        } else {
          siteMountExplorerEnabled.value = true;
        }

        lastUpdated.value = Date.now();
        saveToStorage();

        log.debug("從API載入站點配置成功:", {
          title: siteTitle.value,
          faviconUrl: siteFaviconUrl.value,
          announcementEnabled: siteAnnouncementEnabled.value,
          announcementContent: siteAnnouncementContent.value ? "已設定" : "未設定",
          footerMarkdown: siteFooterMarkdown.value,
          customHead: siteCustomHead.value ? "已設定" : "未設定",
          customBody: siteCustomBody.value ? "已設定" : "未設定",
          homeEditorEnabled: siteHomeEditorEnabled.value,
          uploadPageEnabled: siteUploadPageEnabled.value,
          mountExplorerEnabled: siteMountExplorerEnabled.value,
        });
        return true;
      } else {
        throw new Error(response?.message || "獲取站點配置失敗");
      }
    } catch (error) {
      log.error("從API獲取站點配置失敗:", error);
      // API失敗時保持當前值或使用預設值
      if (!siteTitle.value || siteTitle.value === "") {
        siteTitle.value = "CloudHarbor";
      }
      return false;
    }
  };

  // ===== 公共方法 =====

  /**
   * 初始化站點配置
   * 優先使用快取，快取無效時從API獲取
   */
  const initialize = async () => {
    if (isInitialized.value) {
      log.debug("站點配置已初始化，跳過重複初始化");
      return;
    }

    log.debug("初始化站點配置...");
    isLoading.value = true;

    try {
      // 1. 嘗試從快取載入
      const cacheLoaded = loadFromStorage();

      // 2. 如果快取有效，直接使用快取
      if (cacheLoaded && isCacheValid.value) {
        log.debug("使用有效的快取配置");
      } else {
        // 3. 快取無效或不存在，從API獲取
        log.debug("快取無效或不存在，從API獲取站點配置");
        await fetchFromAPI();
      }

      // 統一應用配置（避免重複程式碼）
      updatePageFavicon(siteFaviconUrl.value);
      injectCustomContent();
      isInitialized.value = true;
    } catch (error) {
      log.error("初始化站點配置失敗:", error);
      // 初始化失敗時使用預設值
      siteTitle.value = "CloudHarbor";
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 重新整理站點配置
   * 強制從API重新獲取配置
   */
  const refresh = async () => {
    log.debug("重新整理站點配置...");
    isLoading.value = true;

    try {
      await fetchFromAPI();
      log.debug("站點配置重新整理成功");
    } catch (error) {
      log.error("重新整理站點配置失敗:", error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 更新站點標題
   * 用於管理員修改設定後立即更新快取
   */
  const updateSiteTitle = (newTitle) => {
    if (newTitle && typeof newTitle === "string") {
      siteTitle.value = newTitle.trim() || "CloudHarbor";
      lastUpdated.value = Date.now();
      saveToStorage();
      log.debug("站點標題已更新:", siteTitle.value);
    }
  };

  /**
   * 更新站點圖示
   * 用於管理員修改設定後立即更新快取和頁面favicon
   */
  const updateSiteFavicon = (newFaviconUrl) => {
    if (typeof newFaviconUrl === "string") {
      siteFaviconUrl.value = newFaviconUrl.trim();
      lastUpdated.value = Date.now();
      saveToStorage();

      // 立即更新頁面favicon
      updatePageFavicon(siteFaviconUrl.value);

      log.debug("站點圖示已更新:", siteFaviconUrl.value);
    }
  };

  /**
   * 更新頁尾Markdown內容
   * 用於管理員修改設定後立即更新快取
   */
  const updateSiteFooter = (newFooterMarkdown) => {
    if (typeof newFooterMarkdown === "string") {
      siteFooterMarkdown.value = newFooterMarkdown;
      lastUpdated.value = Date.now();
      saveToStorage();
      log.debug("頁尾內容已更新:", siteFooterMarkdown.value);
    }
  };

  /**
   * 注入自定義頭部內容到頁面頭部
   */
  const injectCustomHead = () => {
    // 清理舊的注入內容（相容舊實現：#cloudharbor-custom-head）
    document.querySelectorAll("[data-cloudharbor-custom-head='true']").forEach((node) => node.remove());
    document.getElementById("cloudharbor-custom-head")?.remove();

    const raw = siteCustomHead.value || "";
    if (!raw.trim()) return;

    // 用 template 解析字串為 DOM 節點
    const template = document.createElement("template");
    template.innerHTML = raw;

    // 放到 head 的開頭，且保持使用者輸入順序
    const anchor = document.head.firstChild;
    const children = Array.from(template.content.children);

    children.forEach((node, index) => {
      try {
        const tag = node.tagName?.toLowerCase?.() || "";

        // script 需要“重新建立”才會執行
        if (tag === "script") {
          const newScript = document.createElement("script");
          newScript.setAttribute("data-cloudharbor-custom-head", "true");

          // 複製所有屬性（src/async/defer/type/crossorigin 等）
          Array.from(node.attributes || []).forEach((attr) => {
            try {
              newScript.setAttribute(attr.name, attr.value);
            } catch (e) {
              // 忽略單個屬性複製失敗
            }
          });

          // 內聯指令碼內容
          if (!newScript.src) {
            newScript.textContent = node.textContent || "";
          }

          document.head.insertBefore(newScript, anchor);
          return;
        }

        // 其它標籤（style/link/meta 等）直接插入 head
        node.setAttribute("data-cloudharbor-custom-head", "true");
        document.head.insertBefore(node, anchor);
      } catch (error) {
        log.error(`自定義頭部注入失敗 (${index + 1}):`, error);
      }
    });

    log.debug("自定義頭部內容已注入");
  };

  // ===== DOM查詢快取和效能最佳化 =====

  // DOM查詢快取
  let appContainerCache = null;
  let injectTimeout = null;
  let pendingBodyInjectRetries = 0;

  /**
   * 獲取Vue應用容器（帶快取）
   */
  const getAppContainer = () => {
    if (!appContainerCache || !document.contains(appContainerCache)) {
      appContainerCache = document.querySelector(".app-container");
    }
    return appContainerCache;
  };

  /**
   * 注入自定義body內容到Vue應用內部
   * 支援JavaScript指令碼執行
   */
  const injectCustomBody = () => {
    // 清理舊內容和指令碼
    document.getElementById("cloudharbor-custom-body")?.remove();
    document.querySelectorAll('script[data-cloudharbor-custom="true"]').forEach((script) => script.remove());

    if (!siteCustomBody.value) return;

    const targetContainer = getAppContainer();
    if (!targetContainer) {
      if (pendingBodyInjectRetries < 30) {
        pendingBodyInjectRetries += 1;
        clearTimeout(injectTimeout);
        injectTimeout = setTimeout(() => {
          injectCustomBody();
        }, 100);
        return;
      }

      // 兜底：重試多次仍找不到容器時，退回插入到 body，至少保證內容不丟
      log.warn("未找到 .app-container，已退回把自定義 body 內容插入到 document.body");
      pendingBodyInjectRetries = 0;
    } else {
      pendingBodyInjectRetries = 0;
    }

    // 建立並注入容器
    const container = document.createElement("div");
    container.id = "cloudharbor-custom-body";
    container.innerHTML = siteCustomBody.value;

    // 注入到Vue應用容器；兜底時才插入 body
    (targetContainer || document.body).appendChild(container);

    // 執行指令碼
    container.querySelectorAll("script").forEach((script, index) => {
      try {
        const newScript = document.createElement("script");
        newScript.setAttribute("data-cloudharbor-custom", "true");

        if (script.src) {
          // 外部指令碼
          newScript.src = script.src;
          if (script.async) newScript.async = true;
          if (script.defer) newScript.defer = true;
          if (script.type) newScript.type = script.type;
        } else {
          // 內聯指令碼
          newScript.textContent = script.textContent;
          if (script.type) newScript.type = script.type;
        }

        document.head.appendChild(newScript);
        script.remove(); // 移除原指令碼標籤
      } catch (error) {
        log.error(`指令碼執行失敗 (${index + 1}):`, error);
      }
    });

    log.debug("自定義body內容已注入並執行");
  };

  /**
   * 防抖版本的自定義內容注入
   */
  const debouncedInjectCustomContent = () => {
    clearTimeout(injectTimeout);
    injectTimeout = setTimeout(() => {
      injectCustomHead();
      injectCustomBody();
    }, 100);
  };

  /**
   * 注入所有自定義內容
   */
  const injectCustomContent = () => {
    injectCustomHead();
    injectCustomBody();
  };

  /**
   * 更新自定義頭部內容並立即注入
   */
  const updateCustomHead = (newHead) => {
    siteCustomHead.value = newHead || "";
    injectCustomHead();
    saveToStorage();
  };

  /**
   * 更新自定義body內容並立即注入
   */
  const updateCustomBody = (newBody) => {
    siteCustomBody.value = newBody || "";
    injectCustomBody();
    saveToStorage();
  };

  /**
   * 清理所有自定義DOM內容
   */
  const cleanupCustomContent = () => {
    // 清理自定義頭部內容（相容舊實現：#cloudharbor-custom-head）
    document.querySelectorAll("[data-cloudharbor-custom-head='true']").forEach((node) => node.remove());
    document.getElementById("cloudharbor-custom-head")?.remove();

    // 清理自定義body內容
    const existingBody = document.getElementById("cloudharbor-custom-body");
    if (existingBody) existingBody.remove();

    // 清理自定義指令碼
    const existingScripts = document.querySelectorAll('script[data-cloudharbor-custom="true"]');
    existingScripts.forEach((script) => script.remove());

    // 清理DOM快取
    appContainerCache = null;
  };

  /**
   * 重置配置
   */
  const reset = () => {
    siteTitle.value = "CloudHarbor";
    siteFaviconUrl.value = "";
    siteAnnouncementEnabled.value = false;
    siteAnnouncementContent.value = "";
    siteFooterMarkdown.value = "© 2025 CloudHarbor. 保留所有權利。";
    siteCustomHead.value = "";
    siteCustomBody.value = "";
    siteHomeEditorEnabled.value = true;
    siteUploadPageEnabled.value = true;
    siteMountExplorerEnabled.value = true;
    lastUpdated.value = null;
    isInitialized.value = false;
    storedConfig.remove?.();

    // 重置favicon為預設
    updatePageFavicon("");

    // 清理所有自定義內容
    cleanupCustomContent();

    log.debug("站點配置已重置");
  };

  /**
   * 獲取快取統計資訊
   */
  const getCacheStats = () => {
    return {
      isInitialized: isInitialized.value,
      isCacheValid: isCacheValid.value,
      lastUpdated: lastUpdated.value,
      cacheAge: lastUpdated.value ? Date.now() - lastUpdated.value : null,
      title: siteTitle.value,
      faviconUrl: siteFaviconUrl.value,
      announcementEnabled: siteAnnouncementEnabled.value,
      announcementContent: siteAnnouncementContent.value,
      footerMarkdown: siteFooterMarkdown.value,
      homeEditorEnabled: siteHomeEditorEnabled.value,
      uploadPageEnabled: siteUploadPageEnabled.value,
      mountExplorerEnabled: siteMountExplorerEnabled.value,
    };
  };

  // 返回store的狀態和方法
  return {
    // 狀態
    siteTitle,
    siteFaviconUrl,
    siteAnnouncementEnabled,
    siteAnnouncementContent,
    siteFooterMarkdown,
    siteCustomHead,
    siteCustomBody,
    siteHomeEditorEnabled,
    siteUploadPageEnabled,
    siteMountExplorerEnabled,
    isLoading,
    lastUpdated,
    isInitialized,

    // 計算屬性
    isCacheValid,
    siteConfig,

    // 方法
    initialize,
    refresh,
    updateSiteTitle,
    updateSiteFavicon,
    updateSiteFooter,
    updateCustomHead,
    updateCustomBody,
    injectCustomContent,
    debouncedInjectCustomContent,
    reset,
    getCacheStats,
  };
});
