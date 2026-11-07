<script setup>
// PasteViewOutline元件 - 實現文件大綱及分欄佈局功能
// 該元件負責顯示文件的標題結構，並允許使用者透過拖動分隔線調整大綱與內容的比例
import { ref, computed, onBeforeUnmount, watch } from "vue";
import { useEventListener, useBreakpoints, breakpointsTailwind } from "@vueuse/core";
import { debugLog } from "./PasteViewUtils";
import { IconChevronDown } from "@/components/icons";

// 定義元件接收的屬性
const props = defineProps({
  // 是否為暗色模式
  darkMode: {
    type: Boolean,
    required: true,
  },
  // 扁平化的大綱資料陣列
  outlineData: {
    type: Array,
    default: () => [],
  },
  // 樹形結構的大綱資料
  outlineTreeData: {
    type: Array,
    default: () => [],
  },
  // 原始Markdown內容
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
});

// 定義元件可觸發的事件
const emit = defineEmits(["heading-click"]);

// 分欄比例控制
const leftPanelWidth = ref(25); // 預設左側面板寬度佔比，單位為百分比
const isDragging = ref(false); // 是否正在拖動分隔線
const startX = ref(0); // 拖動開始時的X座標
const startWidth = ref(0); // 拖動開始時的寬度
let stopDragMouseMove = null;
let stopDragMouseUp = null;

// 移動端適配和控制
const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobile = breakpoints.smaller("md"); // < 768px
const isOutlineExpanded = ref(false); // 移動端下大綱是否展開

// 點選大綱項跳轉到對應標題位置
const scrollToHeading = (id) => {
  if (!id) return;
  emit("heading-click", id);
};

// 切換大綱項的展開/摺疊狀態
const toggleOutlineItem = (item, event) => {
  // 阻止事件冒泡，防止觸發點選跳轉
  if (event) {
    event.stopPropagation();
  }

  // 如果該項有子項，切換展開/摺疊狀態
  if (item.children && item.children.length > 0) {
    item.expanded = !item.expanded;
  }
};

// 計算大綱項的縮排樣式，根據層級設定不同的縮排
const getIndentStyle = (level) => {
  return {
    paddingLeft: `${(level - 1) * 1}rem`,
  };
};

// 開始拖動處理 - 分隔線拖動的核心實現
const startDrag = (e) => {
  isDragging.value = true;
  startX.value = e.clientX;
  startWidth.value = leftPanelWidth.value;

  // 新增全域性事件監聽，使拖動可以在整個視窗範圍內進行
  if (typeof stopDragMouseMove === "function") stopDragMouseMove();
  if (typeof stopDragMouseUp === "function") stopDragMouseUp();
  stopDragMouseMove = useEventListener(document, "mousemove", onDrag, { passive: false });
  stopDragMouseUp = useEventListener(document, "mouseup", stopDrag);

  // 修改游標樣式，提高使用者體驗
  document.body.style.cursor = "col-resize";
  // 防止選擇文字，避免干擾拖動過程
  document.body.style.userSelect = "none";

  // 禁用右側內容區域的滾動功能，避免拖動過程中內容滾動
  const contentScrollEl = document.querySelector(".content-scroll");
  if (contentScrollEl) {
    // 儲存當前滾動位置，以便後續恢復
    contentScrollEl.setAttribute("data-scroll-top", contentScrollEl.scrollTop);
    contentScrollEl.classList.add("no-scroll");
    contentScrollEl.style.overflowY = "hidden";
  }

  // 禁用動畫以避免拖動時出現延遲
  document.querySelector(".outline-grid-container")?.classList.add("dragging");
};

// 拖動過程處理 - 計算並更新面板寬度
const onDrag = (e) => {
  if (!isDragging.value) return;

  // 阻止預設行為和事件傳播
  e.preventDefault();
  e.stopPropagation();

  // 計算拖動的距離，轉換為百分比
  const containerWidth = document.querySelector(".outline-grid-container")?.clientWidth || 1000;
  const deltaX = e.clientX - startX.value;
  const deltaPercent = (deltaX / containerWidth) * 100;

  // 計算新的寬度，限制在10%~50%之間，避免面板過窄或過寬
  let newWidth = startWidth.value + deltaPercent;
  newWidth = Math.max(10, Math.min(50, newWidth));

  leftPanelWidth.value = newWidth;

  // 強制內容面板保持在正確位置
  const contentPanel = document.querySelector(".content-panel");
  if (contentPanel) {
    contentPanel.style.width = `${100 - newWidth}%`;
  }
};

// 停止拖動處理 - 清理事件監聽和恢復原有狀態
const stopDrag = () => {
  isDragging.value = false;
  if (typeof stopDragMouseMove === "function") stopDragMouseMove();
  if (typeof stopDragMouseUp === "function") stopDragMouseUp();
  stopDragMouseMove = null;
  stopDragMouseUp = null;

  // 恢復游標樣式
  document.body.style.cursor = "";
  document.body.style.userSelect = "";

  // 恢復右側內容區域的滾動功能
  const contentScrollEl = document.querySelector(".content-scroll");
  if (contentScrollEl) {
    contentScrollEl.classList.remove("no-scroll");
    contentScrollEl.style.overflowY = "auto";

    // 恢復原來的滾動位置
    const savedScrollTop = contentScrollEl.getAttribute("data-scroll-top");
    if (savedScrollTop) {
      contentScrollTop = parseInt(savedScrollTop);
      contentScrollEl.scrollTop = contentScrollTop;
    }
  }

  // 移除拖動狀態
  document.querySelector(".outline-grid-container")?.classList.remove("dragging");
};

// 計算左側面板樣式 - 使用計算屬性動態更新樣式
const leftPanelStyle = computed(() => {
  return {
    width: `${leftPanelWidth.value}%`,
  };
});

// 計算右側面板樣式 - 確保兩側面板寬度之和為100%
const rightPanelStyle = computed(() => {
  return {
    width: `${100 - leftPanelWidth.value}%`,
  };
});

// 移動端時預設收起大綱，避免擠佔空間
watch(
  isMobile,
  (mobile) => {
    if (mobile) isOutlineExpanded.value = false;
  },
  { immediate: true }
);

// 切換移動端大綱展開狀態
const toggleOutlineOnMobile = () => {
  if (isMobile.value) {
    isOutlineExpanded.value = !isOutlineExpanded.value;
    debugLog(props.enableDebug, props.isDev, "切換移動端大綱狀態:", isOutlineExpanded.value ? "展開" : "收起");
  }
};

// 元件解除安裝時清理事件監聽，避免記憶體洩漏
onBeforeUnmount(() => {
  if (isDragging.value) {
    stopDrag();
  } else {
    if (typeof stopDragMouseMove === "function") stopDragMouseMove();
    if (typeof stopDragMouseUp === "function") stopDragMouseUp();
  }
  stopDragMouseMove = null;
  stopDragMouseUp = null;
});
</script>

<template>
  <!-- 大綱容器 - 主要佈局結構，包含大綱和內容兩個部分 -->
  <div class="outline-grid-container flex flex-col md:flex-row select-none outline-container-height" :class="{ dragging: isDragging }">
    <!-- 大綱區域 - 在手機端預設收起 -->
    <div
      class="outline-panel md:p-4 border-b md:border-b-0 md:border-r overflow-hidden flex flex-col transition-all duration-300"
      :class="[darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-gray-50', isMobile ? (isOutlineExpanded ? 'h-[300px]' : 'h-[48px]') : 'h-full']"
      :style="!isMobile ? leftPanelStyle : {}"
    >
      <!-- 大綱標題欄 - 在手機端可點選展開/收起 -->
      <div class="flex items-center justify-between p-3 md:p-0 md:mb-4 cursor-pointer md:cursor-default" @click="toggleOutlineOnMobile">
        <h3 class="text-lg font-medium" :class="[darkMode ? 'text-white' : 'text-gray-900']">文件大綱</h3>
        <!-- 手機端展開/收起按鈕 -->
        <button class="md:hidden p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
          <IconChevronDown size="md" class="w-5 h-5 transform transition-transform duration-300" :class="{ 'rotate-180': isOutlineExpanded }" />
        </button>
      </div>

      <!-- 大綱內容區域 - 使用v-show在移動端控制顯示/隱藏 -->
      <div v-show="isOutlineExpanded || !isMobile" class="outline-container flex-1 overflow-y-auto pr-2 hide-scrollbar">
        <div v-if="outlineTreeData.length === 0" class="py-8 text-center text-gray-500">
          <p>無大綱資訊</p>
        </div>

        <!-- 大綱樹形結構 - 使用巢狀列表展示層級關係 -->
        <ul v-else class="space-y-1">
          <!-- 使用普通的巢狀列表替代遞迴元件，確保相容性 -->
          <li v-for="(item, index) in outlineTreeData" :key="index" class="outline-item">
            <div class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors" @click="scrollToHeading(item.id)">
              <!-- 展開/摺疊按鈕 -->
              <button
                v-if="item.children && item.children.length > 0"
                @click.stop="toggleOutlineItem(item, $event)"
                class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                aria-label="展開或摺疊子項"
              >
                <span v-if="item.expanded">▼</span>
                <span v-else>▶</span>
              </button>
              <span v-else class="w-5"></span>

              <!-- 標題文字 - 樣式根據標題級別不同而不同 -->
              <span class="block truncate" :class="[item.level === 1 ? 'font-bold' : '', item.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']">{{
                item.text
              }}</span>
            </div>

            <!-- 第二層 - 子標題列表 -->
            <ul v-if="item.children && item.children.length > 0 && item.expanded" class="pl-4 space-y-1 mt-1">
              <li v-for="(child, childIndex) in item.children" :key="`${index}-${childIndex}`" class="outline-item">
                <div class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors" @click="scrollToHeading(child.id)">
                  <button
                    v-if="child.children && child.children.length > 0"
                    @click.stop="toggleOutlineItem(child, $event)"
                    class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    aria-label="展開或摺疊子項"
                  >
                    <span v-if="child.expanded">▼</span>
                    <span v-else>▶</span>
                  </button>
                  <span v-else class="w-5"></span>

                  <span
                    class="block truncate"
                    :class="[child.level === 1 ? 'font-bold' : '', child.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']"
                    >{{ child.text }}</span
                  >
                </div>

                <!-- 第三層 -->
                <ul v-if="child.children && child.children.length > 0 && child.expanded" class="pl-4 space-y-1 mt-1">
                  <li v-for="(grandChild, grandChildIndex) in child.children" :key="`${index}-${childIndex}-${grandChildIndex}`" class="outline-item">
                    <div
                      class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                      @click="scrollToHeading(grandChild.id)"
                    >
                      <button
                        v-if="grandChild.children && grandChild.children.length > 0"
                        @click.stop="toggleOutlineItem(grandChild, $event)"
                        class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        aria-label="展開或摺疊子項"
                      >
                        <span v-if="grandChild.expanded">▼</span>
                        <span v-else>▶</span>
                      </button>
                      <span v-else class="w-5"></span>

                      <span
                        class="block truncate"
                        :class="[grandChild.level === 1 ? 'font-bold' : '', grandChild.level === 2 ? 'font-semibold' : '', darkMode ? 'text-gray-200' : 'text-gray-800']"
                        >{{ grandChild.text }}</span
                      >
                    </div>

                    <!-- 第四層 -->
                    <ul v-if="grandChild.children && grandChild.children.length > 0 && grandChild.expanded" class="pl-4 space-y-1 mt-1">
                      <li
                        v-for="(greatGrandChild, greatGrandChildIndex) in grandChild.children"
                        :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}`"
                        class="outline-item"
                      >
                        <div
                          class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                          @click="scrollToHeading(greatGrandChild.id)"
                        >
                          <button
                            v-if="greatGrandChild.children && greatGrandChild.children.length > 0"
                            @click.stop="toggleOutlineItem(greatGrandChild, $event)"
                            class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            aria-label="展開或摺疊子項"
                          >
                            <span v-if="greatGrandChild.expanded">▼</span>
                            <span v-else>▶</span>
                          </button>
                          <span v-else class="w-5"></span>

                          <span
                            class="block truncate"
                            :class="[
                              greatGrandChild.level === 1 ? 'font-bold' : '',
                              greatGrandChild.level === 2 ? 'font-semibold' : '',
                              darkMode ? 'text-gray-200' : 'text-gray-800',
                            ]"
                            >{{ greatGrandChild.text }}</span
                          >
                        </div>

                        <!-- 第五層 -->
                        <ul v-if="greatGrandChild.children && greatGrandChild.children.length > 0 && greatGrandChild.expanded" class="pl-4 space-y-1 mt-1">
                          <li
                            v-for="(lvl5Child, lvl5Index) in greatGrandChild.children"
                            :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}-${lvl5Index}`"
                            class="outline-item"
                          >
                            <div
                              class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                              @click="scrollToHeading(lvl5Child.id)"
                            >
                              <button
                                v-if="lvl5Child.children && lvl5Child.children.length > 0"
                                @click.stop="toggleOutlineItem(lvl5Child, $event)"
                                class="mr-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                aria-label="展開或摺疊子項"
                              >
                                <span v-if="lvl5Child.expanded">▼</span>
                                <span v-else>▶</span>
                              </button>
                              <span v-else class="w-5"></span>

                              <span class="block truncate" :class="[darkMode ? 'text-gray-300' : 'text-gray-700']">{{ lvl5Child.text }}</span>
                            </div>

                            <!-- 第六層 - 最後一層，不再提供摺疊功能 -->
                            <ul v-if="lvl5Child.children && lvl5Child.children.length > 0 && lvl5Child.expanded" class="pl-4 space-y-1 mt-1">
                              <li
                                v-for="(lvl6Child, lvl6Index) in lvl5Child.children"
                                :key="`${index}-${childIndex}-${grandChildIndex}-${greatGrandChildIndex}-${lvl5Index}-${lvl6Index}`"
                                class="outline-item"
                              >
                                <div
                                  class="flex items-center cursor-pointer rounded hover:bg-gray-200 dark:hover:bg-gray-700 py-1.5 px-2 transition-colors"
                                  @click="scrollToHeading(lvl6Child.id)"
                                >
                                  <span class="w-5"></span>
                                  <span class="block truncate" :class="[darkMode ? 'text-gray-400' : 'text-gray-600']">{{ lvl6Child.text }}</span>
                                </div>
                              </li>
                            </ul>
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </div>

    <!-- 可拖動分隔線 - 僅在桌面端顯示，實現分欄拖拽調整 -->
    <div class="resizer-handle hidden md:block" @mousedown.prevent="startDrag" :class="darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'"></div>

    <!-- 右側內容區域 - 使用slot接收實際內容 -->
    <div
      class="content-panel h-full md:relative flex-grow flex flex-col overflow-hidden"
      :class="[isMobile ? 'w-full' : '', isOutlineExpanded ? 'h-[calc(100%-300px)] md:h-full' : 'h-[calc(100%-48px)] md:h-full', isDragging ? 'dragging' : '']"
      :style="isMobile ? {} : rightPanelStyle"
    >
      <!-- 內容區域，使用slot允許父元件插入具體內容 -->
      <slot name="content"></slot>
    </div>
  </div>
</template>

<style scoped>
/* 大綱容器高度 - 響應式設計，根據螢幕高度調整 */
.outline-container-height {
  height: calc(80vh - 150px);
  min-height: 600px;
  max-height: 1000px;
}

/* 小螢幕裝置的大綱容器高度 */
@media (max-height: 800px) {
  .outline-container-height {
    height: calc(85vh - 120px);
    min-height: 500px;
  }
}

/* 大螢幕裝置的大綱容器高度 */
@media (min-height: 1000px) {
  .outline-container-height {
    height: calc(75vh - 150px);
    min-height: 700px;
    max-height: 1200px;
  }
}

/* 可拖動分隔線樣式 */
.outline-grid-container {
  position: relative;
  /* 防止拖動過程中文字被選中 */
  user-select: none;
  width: 100%;
  overflow: hidden; /* 防止內容溢位 */
}

/* 拖動狀態下的特殊處理 */
.outline-grid-container.dragging {
  pointer-events: none; /* 拖動時禁用所有指標事件 */
  cursor: col-resize !important; /* 確保整個容器顯示拖動游標 */
}

.outline-grid-container.dragging .resizer-handle {
  pointer-events: auto !important; /* 確保分隔線仍可拖動 */
  z-index: 30;
}

/* 左右面板基本樣式 */
.outline-panel,
.content-panel {
  transition: none; /* 移除過渡動畫，避免拖動時的延遲感 */
  position: relative; /* 確保定位上下文 */
}

.outline-panel {
  min-width: 0;
}

.content-panel.dragging {
  overflow: hidden;
}

/* 拖動手柄樣式 */
.resizer-handle {
  width: 14px; /* 增加手柄寬度，更容易抓取 */
  margin: 0 -7px; /* 負邊距使手柄偏移，防止拖動時影響內容區域 */
  cursor: col-resize;
  height: 100%;
  z-index: 20; /* 提高z-index確保在最上層 */
  transition: background-color 0.2s;
  position: relative;
  flex-shrink: 0; /* 防止手柄被壓縮 */
}

.resizer-handle:hover {
  opacity: 1;
  background-color: v-bind('darkMode ? "rgba(75, 85, 99, 0.4)" : "rgba(229, 231, 235, 0.6)"');
}

.resizer-handle:active {
  opacity: 1;
  background-color: v-bind('darkMode ? "rgba(75, 85, 99, 0.6)" : "rgba(229, 231, 235, 0.8)"');
}

/* 拖動手柄中間的線條 */
.resizer-handle::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  height: 4rem;
  width: 2px;
  background-color: currentColor;
  opacity: 0.7;
}

/* 隱藏大綱區域的捲軸，但保留滾動功能，提升UI美觀度 */
.hide-scrollbar {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.hide-scrollbar::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera*/
  width: 0;
  height: 0;
}

/* 解決大綱模式下的內容佈局問題 */
@media (min-width: 768px) {
  .outline-grid-container .content-panel ::v-deep(.content-scroll) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
}

/* 大綱模式樣式 */
:deep(.vditor-outline) {
  background-color: v-bind('darkMode ? "#1F2937" : "#F9FAFB"');
  border-right: 1px solid v-bind('darkMode ? "#374151" : "#E5E7EB"');
}

:deep(.outline-item) {
  margin-bottom: 2px;
}

/* 移動端大綱樣式最佳化 */
@media (max-width: 768px) {
  /* 移動端響應式設計，調整高度和過渡效果 */
  .outline-container-height {
    height: auto;
    min-height: auto;
    max-height: none;
  }

  .outline-panel {
    transition: height 0.3s ease-in-out;
    min-width: 0; /* 移動端最小寬度 */
    width: 100% !important;
  }

  .outline-container {
    max-height: 250px;
    overflow-y: auto;
  }

  .content-panel {
    transition: height 0.3s ease-in-out;
    width: 100% !important;
  }
}
</style>
