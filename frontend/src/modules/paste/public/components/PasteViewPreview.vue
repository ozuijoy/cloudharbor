<script setup>
// PasteViewPreview元件 - 用於渲染Markdown內容並提供預覽功能
// 該元件使用Vditor庫渲染複雜的Markdown內容，支援程式碼高亮、數學公式等高階特性
import { h, ref, onMounted, watch, nextTick, onBeforeUnmount, render } from "vue";
import { useEventListener, useMutationObserver, useScroll, useWindowScroll } from "@vueuse/core";
import { debugLog } from "./PasteViewUtils";
import HtmlPreviewModal from "@/components/paste-view/preview/HtmlPreviewModal.vue"; // 引入HTML預覽彈窗元件
import { ensureMermaidPatchedForVditor, loadVditor, mightContainMermaid, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { IconChevronDown, IconEye, IconRefresh } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PasteViewPreview");

// 定義元件接收的屬性
const props = defineProps({
  // 是否為暗色模式，控制渲染主題
  darkMode: {
    type: Boolean,
    required: true,
  },
  // 要渲染的Markdown內容
  content: {
    type: String,
    default: "",
  },
  // 是否為開發環境
  isDev: {
    type: Boolean,
    default: false,
  },
  // 是否啟用除錯日誌
  enableDebug: {
    type: Boolean,
    default: false,
  },
  // 是否為純文字模式（不渲染Markdown）
  isPlainTextMode: {
    type: Boolean,
    default: false,
  },
});

// HTML 預覽相關的狀態變數
const showHtmlPreview = ref(false);
const previewHtmlContent = ref("");
// SVG 預覽相關的狀態變數
const showSvgPreview = ref(false);
const previewSvgContent = ref("");

// 定義元件可觸發的事件
const emit = defineEmits(["rendered"]);
// 用於儲存預覽元素的引用
const previewElement = ref(null);
const { y: windowScrollY } = useWindowScroll();
const { y: contentScrollY } = useScroll(previewElement);
// 跟蹤內容是否已經渲染
const contentRendered = ref(false);
// 儲存滾動位置
const savedScrollPosition = ref({ window: 0, content: 0 });
// MutationObserver stop（VueUse 管理），用於清理
let stopMutationObserver = null;
// 儲存定時器ID，用於清理
const timeoutIds = new Set();
let stopPreviewImageClickListener = null;

// 將 Vue 圖示元件渲染到指定 DOM 容器（用於非 Vue 管理的動態 DOM）
const renderIconInto = (container, IconComponent, props = {}) => {
  render(h(IconComponent, props), container);
};

// 安全的setTimeout，會自動清理
const safeSetTimeout = (callback, delay) => {
  const id = setTimeout(() => {
    timeoutIds.delete(id);
    callback();
  }, delay);
  timeoutIds.add(id);
  return id;
};

// 清理所有定時器
const clearAllTimeouts = () => {
  timeoutIds.forEach((id) => clearTimeout(id));
  timeoutIds.clear();
};

// 儲存當前滾動位置
const saveScrollPosition = () => {
  savedScrollPosition.value = {
    window: windowScrollY.value,
    content: previewElement.value ? contentScrollY.value : 0,
  };
  debugLog(props.enableDebug, props.isDev, "儲存滾動位置:", savedScrollPosition.value);
};

// 恢復儲存的滾動位置
const restoreScrollPosition = () => {
  nextTick(() => {
    // 恢復視窗滾動位置
    windowScrollY.value = savedScrollPosition.value.window;

    // 恢復內容滾動位置（如果預覽元素有滾動）
    if (previewElement.value) {
      contentScrollY.value = savedScrollPosition.value.content;
    }

    debugLog(props.enableDebug, props.isDev, "恢復滾動位置:", savedScrollPosition.value);
  });
};

// 監聽暗色模式變化，當主題改變時重新渲染內容
watch(
  () => props.darkMode,
  () => {
    if (props.content) {
      // 在重新渲染前儲存滾動位置
      saveScrollPosition();

      // 暗色模式變化時重新渲染
      nextTick(() => {
        renderContent(props.content);
      });
    }
  }
);

// 快取上次渲染的內容，避免重複渲染
let lastRenderedContent = "";
// DOM查詢快取
let diagramContainersCache = null;
let checkboxesCache = null;
let imagesCache = null;
let codeBlocksCache = null;

// ===== 內容特徵檢測：避免無意義地載入大指令碼 =====
const mightContainCodeFence = (text) => /(^|\n)\s*```|(^|\n)\s*~~~/m.test(String(text || ""));
const mightContainFlowchart = (text) => /(^|\n)\s*```+\s*flowchart\b|(^|\n)\s*~~~+\s*flowchart\b/im.test(String(text || ""));
const mightContainGraphviz = (text) => /(^|\n)\s*```+\s*(graphviz|dot|viz)\b|(^|\n)\s*~~~+\s*(graphviz|dot|viz)\b/im.test(String(text || ""));
const mightContainAbc = (text) => /(^|\n)\s*```+\s*abc\b|(^|\n)\s*~~~+\s*abc\b/im.test(String(text || ""));
const mightContainEcharts = (text) => /(^|\n)\s*```+\s*(echarts|chart|mindmap)\b|(^|\n)\s*~~~+\s*(echarts|chart|mindmap)\b/im.test(String(text || ""));

// 監聽內容變化，當內容改變時重新渲染
watch(
  () => props.content,
  (newContent, oldContent) => {
    // 避免重複渲染相同內容
    if (newContent && newContent !== lastRenderedContent && newContent !== oldContent) {
      lastRenderedContent = newContent;
      contentRendered.value = false;
      nextTick(() => {
        renderContent(newContent);
      });
    }
  }
);

// 監聽純文字模式變化
watch(
  () => props.isPlainTextMode,
  (newMode) => {
    // 如果從純文字模式切換到Markdown模式，需要重新渲染
    if (!newMode && props.content) {
      contentRendered.value = false;
      nextTick(() => {
        renderContent(props.content);
      });
    }
    debugLog(props.enableDebug, props.isDev, `顯示模式切換: ${newMode ? "純文字模式" : "Markdown渲染模式"}`);
  }
);

// 渲染內容的方法，處理DOM可用性和相容性問題
const renderContent = (content) => {
  // 如果是純文字模式，不需要渲染
  if (props.isPlainTextMode) {
    contentRendered.value = true; // 標記為已渲染，避免顯示載入動畫
    emit("rendered"); // 觸發渲染完成事件
    return;
  }

  if (!content) {
    log.warn("沒有內容可渲染");
    return;
  }

  // 延遲檢查預覽元素，確保DOM已掛載
  if (!previewElement.value) {
    debugLog(props.enableDebug, props.isDev, "預覽元素尚未準備好，將在下一個渲染週期嘗試");
    // 使用nextTick等待DOM更新後再嘗試渲染
    nextTick(() => {
      if (previewElement.value) {
        debugLog(props.enableDebug, props.isDev, "預覽元素已就緒，現在開始渲染");
        renderContentInternal(content);
      } else {
        log.error("預覽元素始終不可用，無法渲染內容");
      }
    });
    return;
  }

  renderContentInternal(content);
};

// 內部渲染實現，使用Vditor的API渲染Markdown
const renderContentInternal = async (content) => {
  // 清空之前的內容，避免重複渲染
  if (previewElement.value) {
    // 完全清除之前的內容和樣式
    previewElement.value.innerHTML = "";
    // 移除可能殘留的主題相關類
    previewElement.value.classList.remove("vditor-reset--dark", "vditor-reset--light");

    // 清理DOM快取，強制重新查詢
    diagramContainersCache = null;
    checkboxesCache = null;
    imagesCache = null;
    codeBlocksCache = null;

      try {
        const hasMermaid = mightContainMermaid(content);
        const hasFlowchart = mightContainFlowchart(content);
        const hasGraphviz = mightContainGraphviz(content);
        const hasAbc = mightContainAbc(content);
        const hasEcharts = mightContainEcharts(content);
        const hasCodeFence = mightContainCodeFence(content);
        const hasAnyDiagram = hasMermaid || hasFlowchart || hasGraphviz || hasAbc || hasEcharts;

        // 如果內容確實包含 Mermaid，先打補丁避免 foreignObject 報錯
        if (hasMermaid) {
          try {
            await ensureMermaidPatchedForVditor();
          } catch (e) {
            log.warn("[PasteViewPreview] Mermaid 補丁載入失敗（將繼續渲染）:", e);
          }
        }

        // 懶載入Vditor
        const VditorConstructor = await loadVditor();

      // 安全的預覽渲染
      safeSetTimeout(() => {
        try {
          // 使用 Vditor 的預覽 API 渲染內容
          // 配置了主題、程式碼高亮、數學公式等渲染選項
          VditorConstructor.preview(previewElement.value, content, {
            mode: "dark-light", // 支援明暗主題
            theme: {
              current: props.darkMode ? "dark" : "light", // 根據darkMode設定主題
              path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
            },
            cdn: VDITOR_ASSETS_BASE,
            hljs: {
              // 效能最佳化：只有確實存在程式碼塊時才顯示行號，避免無意義的行號計算
              lineNumber: hasCodeFence,
              style: props.darkMode ? "vs2015" : "github", // 程式碼高亮樣式
            },
            markdown: {
              toc: true, // 啟用目錄
              mark: true, // 啟用標記
              footnotes: true, // 啟用腳註
              autoSpace: true, // 自動空格
              media: true, // 啟用媒體連結解析（影片、音訊等）
              listStyle: true, // 啟用列表樣式支援
              // 新增任務列表支援
              task: true, // 啟用任務列表
              // 圖表渲染相關配置
              mermaid: hasMermaid
                ? {
                    theme: "default", // 使用固定的主題，不跟隨暗色模式變化
                    useMaxWidth: false, // 不使用最大寬度限制
                  }
                : false,
              flowchart: hasFlowchart
                ? {
                    theme: "default", // 使用固定的主題
                  }
                : false,
              graphviz: hasGraphviz,
              abc: hasAbc,
              chart: hasEcharts,
              mindmap: hasEcharts,
              fixDiagramTheme: hasAnyDiagram, // 自定義屬性，用於CSS選擇器中識別
            },
            math: {
              engine: "KaTeX", // 數學公式渲染引擎
              inlineDigit: true, // 啟用行內數學公式
            },
            after: () => {
              // 渲染完成後的回撥
              debugLog(props.enableDebug, props.isDev, "Markdown 內容渲染完成");

              // 強制新增對應主題的類
              if (props.darkMode) {
                previewElement.value.classList.add("vditor-reset--dark");
                previewElement.value.classList.remove("vditor-reset--light");
              } else {
                previewElement.value.classList.add("vditor-reset--light");
                previewElement.value.classList.remove("vditor-reset--dark");
              }

              // 為所有圖表容器新增固定樣式類 - 使用快取最佳化
              if (!diagramContainersCache || diagramContainersCache.length === 0) {
                diagramContainersCache = previewElement.value.querySelectorAll(".language-mermaid, .language-flow, .language-plantuml, .language-gantt");
              }
              diagramContainersCache.forEach((container) => {
                container.classList.add("diagram-fixed-theme");
              });

              // 新增任務列表的互動功能
              const setupTaskListInteraction = () => {
                // 新增非空檢查，如果預覽元素不存在則直接返回
                if (!previewElement.value) {
                  log.warn("setupTaskListInteraction: 預覽元素不存在，跳過任務列表互動設定");
                  return;
                }

                // 根據使用者反饋，使用已知有效的選擇器 - 使用快取最佳化
                if (!checkboxesCache || checkboxesCache.length === 0) {
                  checkboxesCache = previewElement.value.querySelectorAll('.vditor-task input[type="checkbox"]');
                }

                // 處理所有找到的核取方塊
                checkboxesCache.forEach((checkbox) => {
                  // 強制確保可互動性
                  checkbox.disabled = false;
                  checkbox.style.pointerEvents = "auto";
                  checkbox.style.cursor = "pointer";

                  // 找到父級li元素
                  const parentLi = checkbox.closest("li");
                  if (parentLi) {
                    // 如果已經勾選，新增樣式屬性
                    if (checkbox.checked) {
                      parentLi.setAttribute("data-task-checked", "true");
                    }

                    // 新增change事件處理
                    checkbox.addEventListener("change", (e) => {
                      const isChecked = e.target.checked;
                      // 更新父元素的資料屬性，啟用樣式
                      parentLi.setAttribute("data-task-checked", isChecked.toString());
                    });
                  }
                });
              };

              // 執行初始設定
              setupTaskListInteraction();

              // 清理之前的觀察器
              if (typeof stopMutationObserver === "function") {
                stopMutationObserver();
                stopMutationObserver = null;
              }

              // 設定DOM觀察器，處理動態變化 - 最佳化效能
              // 監聽DOM變化 - 只監聽必要的變化
              if (previewElement.value) {
                const { stop } = useMutationObserver(
                  previewElement,
                  (mutations) => {
                    // 只在有相關變化時才處理
                    const hasRelevantChanges = mutations.some(
                      (mutation) => mutation.type === "childList" && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
                    );

                    if (hasRelevantChanges) {
                      // 清理快取，強制重新查詢
                      checkboxesCache = null;
                      diagramContainersCache = null;
                      codeBlocksCache = null;
                      // 延遲短暫時間後執行，確保DOM更新完成
                      safeSetTimeout(setupTaskListInteraction, 50);
                    }
                  },
                  {
                    childList: true,
                    subtree: true,
                    attributes: false, // 不監聽屬性變化
                    characterData: false, // 不監聽文字變化
                  }
                );
                stopMutationObserver = stop;
              } else {
                log.warn("無法設定MutationObserver：預覽元素不存在");
              }

              // 新增程式碼塊摺疊功能
              setupCodeBlockCollapse();

              // 自定義圖片點選放大功能 - 使用事件委託最佳化效能
              setupImagePreview();

              // 標記內容已渲染，並觸發渲染完成事件
              contentRendered.value = true;
              emit("rendered");

              // 恢復滾動位置
              restoreScrollPosition();
            },
          });
        } catch (previewError) {
          log.error("Vditor預覽渲染失敗:", previewError);
          // 降級到基本文字顯示
          if (previewElement.value) {
            const safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            previewElement.value.innerHTML = `<pre class="whitespace-pre-wrap">${safeContent}</pre>`;
            contentRendered.value = true;
            emit("rendered");
            restoreScrollPosition();
          }
        }
      }, 100); // 增加延遲確保DOM穩定
    } catch (e) {
      log.error("渲染 Markdown 內容時發生錯誤:", e);
      // 回退到基本的文字顯示
      if (previewElement.value) {
        // 內容轉義，避免XSS風險
        const safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        previewElement.value.innerHTML = `<pre class="whitespace-pre-wrap">${safeContent}</pre>`;
        // 即使是回退渲染，也標記為已渲染
        contentRendered.value = true;
        emit("rendered");

        // 恢復滾動位置
        restoreScrollPosition();
      }
    }
  } else {
    debugLog(props.enableDebug, props.isDev, "renderContentInternal: 預覽元素不存在");
    // 在DOM可用時重試（僅重試一次，避免無限迴圈）
    safeSetTimeout(() => {
      if (previewElement.value && !contentRendered.value) {
        debugLog(props.enableDebug, props.isDev, "延遲後重試渲染");
        renderContentInternal(content);
      }
    }, 150);
  }
};

// 檢查內容是否已渲染，提供多種判斷方法確保準確性
const isContentRendered = () => {
  // 優先使用明確的渲染狀態標記
  if (contentRendered.value) {
    return true;
  }

  // 以下是備用檢查邏輯
  if (!previewElement.value) return false;

  // 檢查預覽元素是否有內容
  const innerHTML = previewElement.value.innerHTML || "";
  // 更可靠的渲染檢測 - 檢查是否包含vditor特有的元素或類
  const hasVditorContent = innerHTML.includes('class="vditor') || previewElement.value.querySelectorAll(".vditor-reset").length > 0;

  // 如果有內容，也標記為已渲染
  if (hasVditorContent || innerHTML.trim().length > 50) {
    contentRendered.value = true;
    return true;
  }

  return false;
};

// 對外暴露方法，允許父元件呼叫
defineExpose({
  renderContent,
  isContentRendered,
});

// 元件掛載時嘗試渲染內容
onMounted(() => {
  if (props.content) {
    renderContent(props.content);
  }
});

// 設定圖片預覽功能 - 使用事件委託最佳化效能
const setupImagePreview = () => {
  if (!previewElement.value) return;

  // 先停掉舊的監聽，避免重複繫結
  if (typeof stopPreviewImageClickListener === "function") {
    stopPreviewImageClickListener();
    stopPreviewImageClickListener = null;
  }

  // 新增事件委託（自動清理）
  stopPreviewImageClickListener = useEventListener(previewElement, "click", handleImageClick);

  // 為所有圖片新增可點選樣式
  const images = previewElement.value.querySelectorAll("img");
  images.forEach((img) => {
    img.style.cursor = "pointer";
  });
};

// 處理圖片點選事件
const handleImageClick = (e) => {
  if (e.target.tagName === "IMG") {
    e.preventDefault();

    const img = e.target;

    // 建立圖片預覽容器
    const previewContainer = document.createElement("div");
    previewContainer.className = "image-preview-container";
    previewContainer.style.position = "fixed";
    previewContainer.style.top = "0";
    previewContainer.style.left = "0";
    previewContainer.style.width = "100%";
    previewContainer.style.height = "100%";
    previewContainer.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
    previewContainer.style.zIndex = "10000";
    previewContainer.style.display = "flex";
    previewContainer.style.justifyContent = "center";
    previewContainer.style.alignItems = "center";
    previewContainer.style.cursor = "zoom-out";

    // 建立圖片元素
    const previewImg = document.createElement("img");
    previewImg.src = img.src;
    previewImg.style.maxWidth = "90%";
    previewImg.style.maxHeight = "90%";
    previewImg.style.objectFit = "contain";
    previewImg.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";
    previewImg.style.transition = "transform 0.3s ease";

    // 新增點選關閉功能
    previewContainer.addEventListener("click", () => {
      document.body.removeChild(previewContainer);
    });

    // 防止點選圖片時冒泡事件關閉預覽
    previewImg.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // 新增到DOM
    previewContainer.appendChild(previewImg);
    document.body.appendChild(previewContainer);
  }
};

// 元件解除安裝時清理資源
onBeforeUnmount(() => {
  // 清理所有定時器
  clearAllTimeouts();

  // 清理MutationObserver
  if (typeof stopMutationObserver === "function") {
    stopMutationObserver();
    stopMutationObserver = null;
  }

  // 清理圖片預覽事件監聽器
  if (typeof stopPreviewImageClickListener === "function") {
    stopPreviewImageClickListener();
    stopPreviewImageClickListener = null;
  }

  // 清理DOM快取
  diagramContainersCache = null;
  checkboxesCache = null;
  imagesCache = null;
  codeBlocksCache = null;
});

// 設定程式碼塊摺疊功能
const setupCodeBlockCollapse = () => {
  if (!previewElement.value) return;

  // 查詢所有程式碼塊 - 使用快取最佳化效能
  if (!codeBlocksCache || codeBlocksCache.length === 0) {
    codeBlocksCache = previewElement.value.querySelectorAll('pre code[class*="language-"]');
  }
  const codeBlocks = codeBlocksCache;

  codeBlocks.forEach((codeBlock) => {
    // 避免重複處理
    if (codeBlock.parentElement.getAttribute("data-collapsible") === "true") {
      return;
    }

    // 標記已處理
    codeBlock.parentElement.setAttribute("data-collapsible", "true");

    // 獲取語言類名
    const languageClass = Array.from(codeBlock.classList).find((cls) => cls.startsWith("language-"));

    // 提取語言名稱
    const language = languageClass ? languageClass.replace("language-", "") : "程式碼";

    // 計算程式碼行數，如果超過一定行數或長度則預設摺疊
    const codeText = codeBlock.textContent || "";
    const lineCount = (codeText.match(/\n/g) || []).length + 1;
    const isLargeCodeBlock = lineCount > 15 || codeText.length > 2000;

    // 建立details和summary元素
    const details = document.createElement("details");
    details.className = "code-block-collapsible";
    // 根據大小決定是否預設展開
    details.open = !isLargeCodeBlock; // 小程式碼塊預設展開，大程式碼塊預設摺疊

    const summary = document.createElement("summary");
    summary.className = "code-block-summary";

    // 建立語言標籤
    const langLabel = document.createElement("span");
    langLabel.className = "code-block-language";
    langLabel.textContent = language;

    // 新增程式碼行數資訊
    const lineInfo = document.createElement("span");
    lineInfo.className = "code-block-line-info";
    lineInfo.textContent = `${lineCount}行`;

    // 建立操作文字
    const actionText = document.createElement("span");
    actionText.className = "code-block-action-text";
    actionText.textContent = "摺疊";

    // 建立摺疊提示
    const collapseHint = document.createElement("span");
    collapseHint.className = "code-block-collapse-hint";
    renderIconInto(collapseHint, IconChevronDown, { size: "sm" });

    // 將左側資訊（語言和行數）新增到summary
    const leftContainer = document.createElement("div");
    leftContainer.className = "code-block-info";
    leftContainer.appendChild(langLabel);
    leftContainer.appendChild(lineInfo);
    summary.appendChild(leftContainer);

    // 將右側操作（摺疊文字和圖示）新增到summary
    const actionsContainer = document.createElement("div");
    actionsContainer.className = "code-block-actions";

    // 為 HTML 程式碼塊新增預覽按鈕
    if (language.toLowerCase() === "html") {
      const previewButton = document.createElement("button");
      previewButton.className = "code-block-preview-button";
      renderIconInto(previewButton, IconEye, { size: "sm" });
      previewButton.title = "預覽 HTML";

      // 新增點選事件
      previewButton.addEventListener("click", (e) => {
        e.stopPropagation(); // 阻止事件冒泡

        // 獲取 HTML 程式碼內容並設定到預覽變數
        previewHtmlContent.value = codeText;
        showHtmlPreview.value = true;
      });

      actionsContainer.appendChild(previewButton);
    }

    // 為 SVG 程式碼塊新增預覽按鈕
    if (language.toLowerCase() === "svg") {
      const previewButton = document.createElement("button");
      previewButton.className = "code-block-preview-button";
      renderIconInto(previewButton, IconEye, { size: "sm" });
      previewButton.title = "預覽 SVG";

      // 新增點選事件
      previewButton.addEventListener("click", (e) => {
        e.stopPropagation(); // 阻止事件冒泡

        // 獲取 SVG 程式碼內容並設定到預覽變數
        previewSvgContent.value = codeText;
        showSvgPreview.value = true;
      });

      actionsContainer.appendChild(previewButton);
    }

    actionsContainer.appendChild(actionText);
    actionsContainer.appendChild(collapseHint);
    summary.appendChild(actionsContainer);

    // 獲取程式碼塊的父元素(pre標籤)
    const preElement = codeBlock.parentElement;
    const preParent = preElement.parentElement;

    // 將pre放入details中
    details.appendChild(summary);
    preParent.replaceChild(details, preElement);
    details.appendChild(preElement);

    // 新增點選事件處理
    summary.addEventListener("click", (e) => {
      // 阻止事件冒泡，避免影響其他點選行為
      e.stopPropagation();

      // 更新操作文字
      safeSetTimeout(() => {
        actionText.textContent = details.open ? "摺疊" : "展開";
      }, 0);
    });

    // 設定初始文字
    actionText.textContent = details.open ? "摺疊" : "展開";
  });
};

// 在外部瀏覽器中開啟 HTML
const openHtmlInExternalBrowser = (htmlContent) => {
  // 建立包含完整 HTML 結構的文件
  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HTML 預覽</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 0;
          }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `;

  // 使用 Blob 建立 URL
  const blob = new Blob([htmlTemplate], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  // 在新視窗中開啟
  window.open(url, "_blank");

  // 清理 Blob URL
  safeSetTimeout(() => URL.revokeObjectURL(url), 100);
};

// 在外部瀏覽器中開啟 SVG
const openSvgInExternalBrowser = (svgContent) => {
  // 建立包含完整 SVG 結構的文件
  const svgTemplate = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SVG 預覽</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-color: ${props.darkMode ? "#1a1a1a" : "#ffffff"};
          }
          svg {
            max-width: 100%;
            max-height: 100vh;
          }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `;

  // 使用 Blob 建立 URL
  const blob = new Blob([svgTemplate], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  // 在新視窗中開啟
  window.open(url, "_blank");

  // 清理 Blob URL
  safeSetTimeout(() => URL.revokeObjectURL(url), 100);
};
</script>

<template>
  <div class="paste-view-preview">
    <!-- 內容渲染中的載入動畫 -->
    <div v-if="props.content && !contentRendered && !props.isPlainTextMode" class="py-10 flex justify-center items-center">
      <IconRefresh class="animate-spin h-8 w-8" :class="props.darkMode ? 'text-blue-400' : 'text-primary-500'" />
      <span class="ml-3 text-sm" :class="props.darkMode ? 'text-gray-300' : 'text-gray-500'">正在渲染內容...</span>
    </div>

    <!-- 純文字模式顯示 -->
    <div v-if="props.isPlainTextMode && props.content" class="plain-text-container">
      <pre class="whitespace-pre-wrap p-4 font-mono text-base overflow-auto min-h-[300px]" :class="props.darkMode ? 'text-gray-200' : 'text-gray-800'">{{ props.content }}</pre>
    </div>

    <!-- Markdown渲染模式顯示 -->
    <div v-else>
      <!-- Vditor 預覽容器 - 這裡是實際的Markdown渲染區域 -->
      <div ref="previewElement" class="vditor-reset markdown-body min-h-[300px]" :class="{ 'opacity-0': !contentRendered }"></div>

      <!-- 後備內容顯示 - 當預覽元素為空或渲染失敗時顯示原始Markdown -->
      <div
        v-if="props.content && !isContentRendered() && previewElement && contentRendered === false"
        class="mt-4 p-3 border rounded"
        :class="props.darkMode ? 'border-yellow-600 bg-yellow-900/20' : 'border-yellow-500 bg-yellow-50'"
      >
        <p class="text-sm mb-2" :class="props.darkMode ? 'text-yellow-300' : 'text-yellow-700'">Markdown 渲染失敗，顯示原始內容：</p>
        <pre class="whitespace-pre-wrap overflow-auto max-h-[600px] p-3 rounded" :class="props.darkMode ? 'text-gray-200 bg-gray-800' : 'text-gray-800 bg-gray-100'">{{
          props.content
        }}</pre>
      </div>
    </div>

    <!-- 無內容提示 -->
    <p v-if="!props.content" :class="props.darkMode ? 'text-gray-400' : 'text-gray-500'">無內容</p>

    <!-- HTML 預覽彈窗元件 -->
    <HtmlPreviewModal
      :show="showHtmlPreview"
      :html-content="previewHtmlContent"
      :dark-mode="props.darkMode"
      :content-type="'html'"
      @close="showHtmlPreview = false"
      @open-external="openHtmlInExternalBrowser"
    />

    <!-- SVG 預覽彈窗元件 -->
    <HtmlPreviewModal
      :show="showSvgPreview"
      :html-content="previewSvgContent"
      :dark-mode="props.darkMode"
      :content-type="'svg'"
      @close="showSvgPreview = false"
      @open-external="openSvgInExternalBrowser"
    />
  </div>
</template>

<style scoped>
/* Vditor預覽樣式定製 */
/* 這些樣式會被應用到Vditor渲染的內容上，使其更美觀並適應暗色/亮色模式 */
:deep(.vditor-reset) {
  font-size: 16px;
  line-height: 1.7;
  padding: 0.5rem;
  transition: all 0.3s ease; /* 增加所有屬性的過渡效果 */
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"'); /* 顯式設定文字顏色 */
  background-color: v-bind('props.darkMode ? "transparent" : "transparent"'); /* 確保背景透明 */
}

/* 確保暗色模式下的特定樣式 */
:deep(.vditor-reset--dark) {
  color: #d4d4d4;
  background-color: transparent;
}

/* 確保亮色模式下的特定樣式 */
:deep(.vditor-reset--light) {
  color: #374151;
  background-color: transparent;
}

/* 標題樣式 */
:deep(.vditor-reset h1, .vditor-reset h2) {
  border-bottom: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  padding-bottom: 0.3em;
  margin-top: 1.8em;
  margin-bottom: 1em;
}

:deep(.vditor-reset h1) {
  font-size: 2em;
}

:deep(.vditor-reset h2) {
  font-size: 1.6em;
}

:deep(.vditor-reset h3) {
  font-size: 1.4em;
  margin-top: 1.5em;
  margin-bottom: 0.75em;
}

/* 段落樣式 */
:deep(.vditor-reset p) {
  margin-top: 0.75em;
  margin-bottom: 0.75em;
}

/* 行內程式碼樣式 */
:deep(.vditor-reset code:not(.hljs)) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f3f4f6"');
  color: v-bind('props.darkMode ? "#ce9178" : "#ef4444"');
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* 引用塊樣式 */
:deep(.vditor-reset blockquote) {
  border-left: 4px solid v-bind('props.darkMode ? "#4b5563" : "#e5e7eb"');
  padding: 0.5em 1em;
  margin-left: 0;
  margin-right: 0;
  margin-top: 1em;
  margin-bottom: 1em;
  color: v-bind('props.darkMode ? "#9ca3af" : "#6b7280"');
  background-color: v-bind('props.darkMode ? "#1a1a1a" : "#f9fafb"');
  border-radius: 0.25rem;
}

/* 連結樣式 */
:deep(.vditor-reset a) {
  color: v-bind('props.darkMode ? "#3b82f6" : "#2563eb"');
  text-decoration: none;
}

:deep(.vditor-reset a:hover) {
  text-decoration: underline;
}

/* 表格樣式 */
:deep(.vditor-reset table) {
  border-collapse: collapse;
  margin: 1.25em 0;
  width: 100%;
}

/* 新增表格容器，確保在小螢幕上可以滾動 */
:deep(.vditor-reset div:has(> table)) {
  overflow-x: auto;
  max-width: 100%;
}

:deep(.vditor-reset table th, .vditor-reset table td) {
  border: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  padding: 0.6em 1em;
}

:deep(.vditor-reset table th) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f3f4f6"');
  font-weight: 600;
  color: v-bind('props.darkMode ? "#e2e8f0" : "#374151"');
}

:deep(.vditor-reset table td) {
  background-color: v-bind('props.darkMode ? "#1e1e1e" : "#ffffff"');
}

:deep(.vditor-reset table tr:nth-child(even) td) {
  background-color: v-bind('props.darkMode ? "#252526" : "#f9fafb"');
}

:deep(.vditor-reset table tr:hover td) {
  background-color: v-bind('props.darkMode ? "#2c2c2d" : "#f3f4f6"');
}

/* 程式碼塊樣式 */
:deep(.vditor-reset pre) {
  margin: 1.25em 0;
  padding: 1.25em;
  border-radius: 0; /* 移除圓角 */
  background-color: transparent; /* 移除背景色，使用透明背景 */
  overflow-x: auto;
  line-height: 1.5;
  border: none; /* 確保沒有邊框 */
  box-shadow: none; /* 移除陰影 */
}

/* 列表樣式 */
:deep(.vditor-reset ul, .vditor-reset ol) {
  padding-left: 2em;
  margin: 1em 0;
}

/* 多級列表樣式 */
/* 有序列表樣式 */
:deep(.vditor-reset ol) {
  list-style-type: decimal;
}

:deep(.vditor-reset ol ol) {
  list-style-type: decimal;
}

:deep(.vditor-reset ol ol ol) {
  list-style-type: decimal;
}

/* 無序列表樣式 - 確保普通無序列表顯示圓點 */
:deep(.vditor-reset ul) {
  list-style-type: disc;
}

:deep(.vditor-reset ul ul) {
  list-style-type: circle;
}

:deep(.vditor-reset ul ul ul) {
  list-style-type: square;
}

/* 圖片樣式 */
:deep(.vditor-reset img) {
  max-width: 100%;
  margin: 1.25em 0;
  border-radius: 0.25rem;
}

/* 圖表樣式固定 - 不受暗色模式影響 */
:deep(.diagram-fixed-theme) {
  background-color: white !important; /* 強制使用白色背景 */
  color: #333 !important; /* 強制使用深色文字 */
  filter: none !important; /* 移除任何可能的過濾器效果 */
}

/* 確保mermaid圖表使用固定樣式 */
:deep(.language-mermaid) {
  background-color: white !important;
  padding: 10px !important;
  border-radius: 4px !important;
  border: 1px solid #e5e7eb !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05) !important;
}

/* 流程圖樣式固定 */
:deep(.language-flow) {
  background-color: white !important;
  padding: 10px !important;
  border-radius: 4px !important;
  border: 1px solid #e5e7eb !important;
}

/* PlantUML圖表樣式固定 */
:deep(.language-plantuml) {
  background-color: white !important;
  padding: 10px !important;
  border-radius: 4px !important;
  border: 1px solid #e5e7eb !important;
}

/* 甘特圖樣式固定 */
:deep(.language-gantt) {
  background-color: white !important;
  padding: 10px !important;
  border-radius: 4px !important;
  border: 1px solid #e5e7eb !important;
}

/* 圖表內的SVG元素樣式固定 */
:deep(.diagram-fixed-theme svg) {
  background-color: white !important;
}

/* HTML 預覽按鈕樣式 */
:deep(.code-block-preview-button) {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 4px;
  margin-right: 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

:deep(.code-block-preview-button:hover) {
  background-color: v-bind('props.darkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)"');
}

:deep(.code-block-preview-button svg) {
  width: 16px;
  height: 16px;
}

/* 針對手機螢幕的響應式調整 */
@media (max-width: 640px) {
  :deep(.vditor-reset) {
    font-size: 15px;
    padding: 0.25rem;
  }

  :deep(.vditor-reset pre) {
    padding: 0.5em;
  }

  :deep(.code-block-collapsible pre) {
    padding: 0.5em !important; /* 在移動裝置上使用更小的padding */
  }

  :deep(.vditor-reset table) {
    font-size: 14px;
  }
}

/* 中等螢幕 */
@media (min-width: 641px) and (max-width: 1024px) {
  :deep(.vditor-reset) {
    padding: 0.75rem;
  }
}

/* 大螢幕額外最佳化 */
@media (min-width: 1280px) {
  :deep(.vditor-reset) {
    font-size: 17px;
    padding: 1rem;
  }

  :deep(.vditor-reset pre) {
    margin: 1.5em 0;
    padding: 1.5em;
  }
}

/* 任務列表樣式增強 */
:deep(.vditor-reset ul li input[type="checkbox"]) {
  cursor: pointer !important;
  pointer-events: auto !important;
  margin-right: 0.5em;
  width: 1.2em;
  height: 1.2em;
  vertical-align: middle;
  position: relative;
  top: -0.1em;
}

/* 只對任務列表項應用list-style-type: none */
:deep(.vditor-reset ul li.vditor-task) {
  list-style-type: none !important;
}

/* 確保高優先順序覆蓋所有巢狀級別的任務列表 */
:deep(.vditor-reset ul li.vditor-task),
:deep(.vditor-reset ul ul li.vditor-task),
:deep(.vditor-reset ul ul ul li.vditor-task) {
  list-style-type: none !important;
}

/* 確保普通列表項的樣式不受影響 */
:deep(.vditor-reset ul li:not(.vditor-task)) {
  list-style-type: disc;
}

:deep(.vditor-reset ul ul li:not(.vditor-task)) {
  list-style-type: circle;
}

:deep(.vditor-reset ul ul ul li:not(.vditor-task)) {
  list-style-type: square;
}

/* 確保任務列表項互動狀態更明顯 */
:deep(.vditor-reset ul li[data-task-checked="true"]) {
  text-decoration: line-through;
  color: v-bind('props.darkMode ? "#6b7280" : "#9ca3af"');
}

:deep(.vditor-reset ul li input[type="checkbox"]:hover),
:deep(.vditor-reset ul li input[type="checkbox"]:focus) {
  outline: 1px solid v-bind('props.darkMode ? "#3b82f6" : "#2563eb"');
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

/* 確保任務列表在暗色模式下有正確的顏色 */
:deep(.vditor-reset--dark ul li input[type="checkbox"]) {
  background-color: #1e1e1e;
  border-color: #4b5563;
}

:deep(.vditor-reset--light ul li input[type="checkbox"]) {
  background-color: #ffffff;
  border-color: #d1d5db;
}

/* 程式碼塊摺疊功能相關樣式 */
:deep(.code-block-collapsible) {
  width: 100%;
  margin: 1.25em 0;
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  background-color: v-bind('props.darkMode ? "#1a1a1a" : "#f8f9fa"');
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

:deep(.code-block-summary) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid v-bind('props.darkMode ? "#30363d" : "#e5e7eb"');
  background-color: v-bind('props.darkMode ? "#252526" : "#f1f3f5"');
  color: v-bind('props.darkMode ? "#e2e8f0" : "#4b5563"');
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

:deep(.code-block-summary:hover) {
  background-color: v-bind('props.darkMode ? "#2c2c2d" : "#e9ecef"');
}

:deep(.code-block-language) {
  font-weight: 600;
  color: v-bind('props.darkMode ? "#3b82f6" : "#2563eb"');
}

:deep(.code-block-info) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

:deep(.code-block-line-info) {
  font-size: 0.75rem;
  color: v-bind('props.darkMode ? "#9ca3af" : "#6b7280"');
  opacity: 0.8;
}

:deep(.code-block-actions) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

:deep(.code-block-action-text) {
  font-size: 0.75rem;
  opacity: 0.8;
}

:deep(.code-block-collapse-hint) {
  display: flex;
  align-items: center;
  transition: transform 0.2s ease;
}

:deep(.code-block-collapsible[open] .code-block-collapse-hint) {
  transform: rotate(180deg);
}

/* 強制調整程式碼塊內部的樣式 */
:deep(.code-block-collapsible pre) {
  margin: 0 !important; /* 移除margins，因為我們現在有外部容器 */
  padding: 0.75em !important; /* 減小padding值，縮小內容與容器間距 */
  border-radius: 0 !important; /* 移除圓角，讓它與外部容器融合 */
  border: none !important; /* 移除邊框 */
}

/* 增強程式碼塊內部捲軸樣式 */
:deep(.code-block-collapsible pre::-webkit-scrollbar) {
  height: 8px;
}

:deep(.code-block-collapsible pre::-webkit-scrollbar-track) {
  background: v-bind('props.darkMode ? "#1e1e1e" : "#f1f1f1"');
}

:deep(.code-block-collapsible pre::-webkit-scrollbar-thumb) {
  background-color: v-bind('props.darkMode ? "#4b5563" : "#c1c9d6"');
  border-radius: 4px;
}

:deep(.code-block-collapsible pre::-webkit-scrollbar-thumb:hover) {
  background-color: v-bind('props.darkMode ? "#6b7280" : "#a1a9b6"');
}

/* 移動端適配 */
@media (max-width: 640px) {
  :deep(.code-block-summary) {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
  }

  :deep(.code-block-action-text) {
    font-size: 0.7rem;
  }

  :deep(.code-block-collapse-hint svg) {
    width: 14px;
    height: 14px;
  }
}

/* 純文字容器樣式 - 與Markdown渲染風格保持一致 */
.plain-text-container pre {
  font-size: 16px;
  line-height: 1.7;
  transition: all 0.3s ease;
  background-color: transparent;
}

/* 針對手機螢幕的響應式調整 */
@media (max-width: 640px) {
  .plain-text-container pre {
    font-size: 15px;
    padding: 0.25rem;
  }
}

/* 中等螢幕 */
@media (min-width: 641px) and (max-width: 1024px) {
  .plain-text-container pre {
    padding: 0.75rem;
  }
}

/* 大螢幕額外最佳化 */
@media (min-width: 1280px) {
  .plain-text-container pre {
    font-size: 17px;
    padding: 1rem;
  }
}
</style>
