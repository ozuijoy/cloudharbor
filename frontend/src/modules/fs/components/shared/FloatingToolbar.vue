<template>
  <!-- Speed Dial 浮動工具欄 - Glassmorphism 風格 -->
  <Teleport to="body">
    <div
      class="fixed z-50 right-4 bottom-4 group"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <!-- Speed Dial 選單項 -->
      <Transition name="speed-dial">
        <div
          v-show="isExpanded"
          class="flex flex-col-reverse items-center mb-2.5 space-y-reverse space-y-1.5"
        >
          <!-- 設定按鈕 -->
          <SpeedDialItem
            :delay="0"
            :tooltip="t('mount.toolbar.settings')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleSettings"
          >
            <IconSettings size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 切換勾選框按鈕 -->
          <SpeedDialItem
            :delay="25"
            :tooltip="showCheckboxes ? t('mount.toolbar.hideCheckboxes') : t('mount.toolbar.showCheckboxes')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            :active="showCheckboxes"
            @click="handleToggleCheckboxes"
          >
            <IconCheckbox size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 檔案籃按鈕 - 開啟檔案籃列表 -->
          <SpeedDialItem
            :delay="50"
            :tooltip="t('fileBasket.title')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleOpenBasket"
          >
            <IconShoppingCart size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 任務列表按鈕 -->
          <SpeedDialItem
            :delay="75"
            :tooltip="t('mount.toolbar.tasks')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleOpenTasks"
          >
            <IconTaskList size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 上傳按鈕 -->
          <SpeedDialItem
            v-if="canWrite"
            :delay="100"
            :tooltip="t('mount.toolbar.upload')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleUpload"
          >
            <IconUpload size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 新建資料夾按鈕 -->
          <SpeedDialItem
            v-if="canWrite"
            :delay="125"
            :tooltip="t('mount.toolbar.newFolder')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleNewFolder"
          >
            <IconFolderPlus size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>

          <!-- 重新整理按鈕 -->
          <SpeedDialItem
            :delay="150"
            :tooltip="t('mount.toolbar.refresh')"
            :dark-mode="darkMode"
            :expanded="isExpanded"
            @click="handleRefresh"
          >
            <IconRefresh size="sm" class="w-[18px] h-[18px]" />
          </SpeedDialItem>
        </div>
      </Transition>

      <!-- 主觸發按鈕 - 簡潔優雅設計 -->
      <button
        type="button"
        @click="toggleExpand"
        class="speed-dial-trigger flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 focus:outline-none"
        :class="triggerButtonClass"
        :aria-expanded="isExpanded"
        :aria-label="t('mount.toolbar.more')"
      >
        <!-- 三點選單圖示 / 關閉圖示 -->
        <component 
          :is="isExpanded ? IconClose : IconMenu"
          size="md"
          class="transition-transform duration-200"
          :class="{ 'rotate-180': isExpanded }"
        />
      </button>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, h } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import {
  IconSettings,
  IconCheckbox,
  IconShoppingCart,
  IconTaskList,
  IconUpload,
  IconFolderPlus,
  IconRefresh,
  IconMenu,
  IconClose
} from '@/components/icons'

// Speed Dial 子項元件 - 簡潔風格，與主按鈕一致大小
const SpeedDialItem = (props, { slots, emit }) => {
  // 外層容器作為 group，讓 tooltip 可以響應 hover
  const wrapperClass = 'relative group/item'
  
  // 按鈕尺寸：40px (w-10 h-10)，與主按鈕一致
  const baseClass = 'speed-dial-item flex items-center justify-center w-10 h-10 rounded-full transition-all cursor-pointer'
  
  // 簡潔風格：白色/深色背景 + 細邊框
  const colorClass = props.darkMode
    ? props.active
      ? 'bg-primary-600 text-white hover:bg-primary-500'
      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
    : props.active
      ? 'bg-primary-500 text-white hover:bg-primary-600'
      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-800'
  
  // 陰影
  const shadowClass = 'shadow-lg'
  
  // Stagger 動畫延遲
  const style = {
    transitionDelay: props.expanded ? `${props.delay}ms` : '0ms',
    opacity: props.expanded ? 1 : 0,
    transform: props.expanded ? 'scale(1) translateY(0)' : 'scale(0.6) translateY(8px)',
  }

  return h('div', { class: wrapperClass, style }, [
    h('button', {
      type: 'button',
      class: `${baseClass} ${colorClass} ${shadowClass}`,
      onClick: () => emit('click'),
      'aria-label': props.tooltip,
    }, slots.default?.()),
    // Tooltip - 現在是 group/item 的子元素，可以正確響應 hover
    h('div', {
      class: `absolute right-full mr-2.5 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium rounded whitespace-nowrap pointer-events-none transition-all duration-150 ${
        props.darkMode 
          ? 'bg-gray-800 text-gray-100' 
          : 'bg-gray-800 text-white'
      } opacity-0 group-hover/item:opacity-100 shadow-md`,
    }, props.tooltip)
  ])
}
SpeedDialItem.props = ['delay', 'tooltip', 'darkMode', 'expanded', 'active']
SpeedDialItem.emits = ['click']

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false
  },
  canWrite: {
    type: Boolean,
    default: true
  },
  showCheckboxes: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'refresh',
  'new-folder',
  'upload',
  'toggle-checkboxes',
  'open-basket',
  'open-tasks',
  'settings'
])

const { t } = useI18n()

// 展開/收起狀態
const isExpanded = useLocalStorage('floating-toolbar-expanded', false)
let hoverTimeout = null

// 保留生命週期鉤子，方便未來擴充套件
onMounted(() => {})

// 元件解除安裝時清理 timeout
onBeforeUnmount(() => {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout)
    hoverTimeout = null
  }
})

// 觸發按鈕樣式 - 簡潔中性風格，無藍色
const triggerButtonClass = computed(() => {
  return props.darkMode
    ? 'bg-gray-700 text-gray-200 shadow-lg hover:bg-gray-600'
    : 'bg-white text-gray-600 shadow-lg border border-gray-200 hover:bg-gray-50'
})

// 切換展開/收起
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// Hover 觸發（可選）
function handleMouseEnter() {
  if (hoverTimeout) clearTimeout(hoverTimeout)
  // 可以啟用 hover 展開，取消下面註釋
  // hoverTimeout = setTimeout(() => { isExpanded.value = true }, 100)
}

function handleMouseLeave() {
  if (hoverTimeout) clearTimeout(hoverTimeout)
  // 可以啟用 hover 收起，取消下面註釋
  // hoverTimeout = setTimeout(() => { isExpanded.value = false }, 300)
}

// 事件處理
function handleRefresh() {
  emit('refresh')
}

function handleNewFolder() {
  emit('new-folder')
}

function handleUpload() {
  emit('upload')
}

function handleToggleCheckboxes() {
  emit('toggle-checkboxes')
}

function handleOpenBasket() {
  emit('open-basket')
}

function handleOpenTasks() {
  emit('open-tasks')
}

function handleSettings() {
  emit('settings')
}
</script>

<style scoped>
/* 主觸發按鈕動畫 - 更細膩的互動 */
.speed-dial-trigger {
  transition: 
    transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
    background 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;
}

.speed-dial-trigger:hover {
  transform: scale(1.06);
}

.speed-dial-trigger:active {
  transform: scale(0.94);
}

/* Speed Dial 選單整體動畫 */
.speed-dial-enter-active,
.speed-dial-leave-active {
  transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.speed-dial-enter-from,
.speed-dial-leave-to {
  opacity: 0;
}

/* 子項按鈕動畫 - 彈性效果 */
.speed-dial-item {
  transition: 
    opacity 180ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.speed-dial-item:hover {
  transform: scale(1.1) !important;
}

.speed-dial-item:active {
  transform: scale(0.92) !important;
}
</style>
