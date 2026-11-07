<template>
  <div class="sync-task-config-form">
    <!-- 路徑對列表 -->
    <div class="space-y-4">
      <TransitionGroup name="path-pair-list" tag="div" class="space-y-4">
        <div
          v-for="(pair, index) in pathPairs"
          :key="pair.id"
          class="path-pair-container"
        >
          <!-- 路徑對標題行 - 可點選展開/收縮 -->
          <div
            class="flex items-center justify-between cursor-pointer select-none group/header py-1.5 px-1"
            :class="pair.collapsed ? 'mb-0' : 'mb-3'"
            @click="togglePairCollapsed(pair)"
          >
            <div class="flex items-center gap-2">
              <!-- 展開/收縮箭頭 -->
              <button
                type="button"
                class="p-0.5 rounded transition-all"
                :class="darkMode ? 'text-gray-400 group-hover/header:text-gray-300' : 'text-gray-500 group-hover/header:text-gray-600'"
                :title="pair.collapsed ? $t('admin.scheduledJobs.syncTask.expandPair', '展開路徑對') : $t('admin.scheduledJobs.syncTask.collapsePair', '收起路徑對')"
              >
                <IconChevronRight size="sm" class="transition-transform duration-200" :class="{ 'rotate-90': !pair.collapsed }" />
              </button>
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold"
                :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'"
              >
                {{ index + 1 }}
              </span>
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                {{ $t('admin.scheduledJobs.syncTask.pairNumber', '路徑對 {n}', { n: index + 1 }) }}
              </span>
              <!-- 配置完成標記 -->
              <IconCheckCircle v-if="pair.sourcePath && pair.targetPath" size="sm" :class="darkMode ? 'text-green-400' : 'text-green-500'" />

              <!-- 收縮狀態下顯示路徑摘要 -->
              <div
                v-if="pair.collapsed && (pair.sourcePath || pair.targetPath)"
                class="flex items-center gap-2 ml-2 text-xs font-mono truncate max-w-[300px] xl:max-w-[500px]"
                :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
              >
                <span class="truncate" :title="pair.sourcePath">{{ pair.sourcePath || '...' }}</span>
                <IconChevronRight size="xs" class="flex-shrink-0" />
                <span class="truncate" :title="pair.targetPath">{{ pair.targetPath || '...' }}</span>
              </div>
            </div>
            <button
              v-if="pathPairs.length > 1"
              @click.stop="removePathPair(pair.id)"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="darkMode ? 'text-gray-500 hover:text-red-400 hover:bg-gray-800' : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'"
            >
              <IconClose size="sm" />
            </button>
          </div>

          <!-- 雙面板佈局 - FreeFileSync 風格 (可摺疊) -->
          <Transition name="pair-content">
            <div v-show="!pair.collapsed" class="dual-panel-container">
            <!-- 源路徑面板 -->
            <div class="path-panel" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
              <!-- 面板標題 -->
              <div
                class="panel-header"
                :class="darkMode ? 'bg-blue-900/30 border-gray-700' : 'bg-blue-50 border-gray-200'"
              >
                <div class="flex items-center gap-2">
                  <IconFolder size="sm" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" />
                  <span class="text-sm font-medium" :class="darkMode ? 'text-blue-300' : 'text-blue-700'">
                    {{ $t('admin.scheduledJobs.syncTask.sourcePath', '源路徑') }}
                  </span>
                </div>
              </div>

              <!-- 路徑輸入 -->
              <div class="panel-input">
                <div class="flex items-center gap-2">
                  <input
                    v-model="pair.sourcePathInput"
                    type="text"
                    :placeholder="$t('admin.scheduledJobs.syncTask.quickInputPlaceholder', '輸入路徑後按回車...')"
                    class="flex-1 px-3 py-2 text-sm font-mono border-0 bg-transparent focus:outline-none focus:ring-0"
                    :class="darkMode ? 'text-gray-200 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'"
                    @keyup.enter="applyQuickPath(pair, 'source')"
                    @blur="applyQuickPath(pair, 'source')"
                  />
                  <!-- 複製路徑按鈕 -->
                  <button
                    v-if="pair.sourcePath"
                    @click="copyPath(pair.sourcePath)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-primary-400' : 'hover:bg-gray-100 text-gray-400 hover:text-primary-500'"
                    :title="$t('admin.scheduledJobs.syncTask.copyPath', '複製路徑')"
                  >
                    <IconCopy size="sm" />
                  </button>
                  <button
                    @click="toggleSourceExpand(pair)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
                    :title="pair.sourceExpanded ? $t('admin.scheduledJobs.syncTask.collapse', '收起') : $t('admin.scheduledJobs.syncTask.expand', '展開')"
                  >
                    <IconList size="sm" />
                  </button>
                  <button
                    v-if="pair.sourcePath"
                    @click="clearPath(pair, 'source')"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'"
                    :title="$t('admin.scheduledJobs.syncTask.clearPath', '清除')"
                  >
                    <IconClose size="sm" />
                  </button>
                </div>
              </div>

              <!-- 路徑選擇器 -->
              <div
                v-show="pair.sourceExpanded"
                class="panel-selector"
              >
                <PathTreeSelector
                  v-model="pair.sourcePath"
                  :dark-mode="darkMode"
                  :allow-files="true"
                  max-height="280px"
                  @update:model-value="onPathSelected(pair, 'source', $event)"
                />
              </div>

              <!-- 路徑提示 -->
              <div class="panel-hint" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.sourcePathHint', '可以是檔案或資料夾路徑') }}
              </div>
            </div>

            <!-- 中間同步方向指示 -->
            <div class="sync-direction-indicator">
              <!-- 桌面端 - 專業連線線設計 -->
              <div class="hidden xl:flex flex-col items-center justify-center h-full py-8">
                <!-- 連線線上段 -->
                <div
                  class="w-px flex-1 min-h-[20px]"
                  :class="darkMode ? 'bg-gradient-to-b from-transparent via-gray-600 to-gray-600' : 'bg-gradient-to-b from-transparent via-gray-300 to-gray-300'"
                ></div>
                <!-- 箭頭圓圈 -->
                <div
                  class="relative w-9 h-9 rounded-full flex items-center justify-center my-2 transition-all duration-200"
                  :class="[
                    pair.sourcePath && pair.targetPath
                      ? (darkMode ? 'bg-primary-600/20 ring-2 ring-primary-500/50' : 'bg-primary-50 ring-2 ring-primary-200')
                      : (darkMode ? 'bg-gray-800 ring-1 ring-gray-700' : 'bg-gray-50 ring-1 ring-gray-200')
                  ]"
                >
                  <IconChevronRight
                    size="sm"
                    class="transition-colors"
                    :class="pair.sourcePath && pair.targetPath ? (darkMode ? 'text-primary-400' : 'text-primary-500') : (darkMode ? 'text-gray-500' : 'text-gray-400')"
                  />
                </div>
                <!-- 連線線下段 -->
                <div
                  class="w-px flex-1 min-h-[20px]"
                  :class="darkMode ? 'bg-gradient-to-b from-gray-600 via-gray-600 to-transparent' : 'bg-gradient-to-b from-gray-300 via-gray-300 to-transparent'"
                ></div>
              </div>
              <!-- 移動端 - 簡潔橫條 -->
              <div class="flex xl:hidden items-center justify-center py-3">
                <div
                  class="flex items-center gap-3"
                  :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                >
                  <div class="h-px w-8" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"></div>
                  <IconArrowUp size="md" class="rotate-180" />
                  <div class="h-px w-8" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"></div>
                </div>
              </div>
            </div>

            <!-- 目標路徑面板 -->
            <div class="path-panel" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
              <!-- 面板標題 -->
              <div
                class="panel-header"
                :class="darkMode ? 'bg-green-900/30 border-gray-700' : 'bg-green-50 border-gray-200'"
              >
                <div class="flex items-center gap-2">
                  <IconFolder size="sm" :class="darkMode ? 'text-green-400' : 'text-green-600'" />
                  <span class="text-sm font-medium" :class="darkMode ? 'text-green-300' : 'text-green-700'">
                    {{ $t('admin.scheduledJobs.syncTask.targetPath', '目標路徑') }}
                  </span>
                </div>
              </div>

              <!-- 路徑輸入 -->
              <div class="panel-input">
                <div class="flex items-center gap-2">
                  <input
                    v-model="pair.targetPathInput"
                    type="text"
                    :placeholder="$t('admin.scheduledJobs.syncTask.quickInputPlaceholder', '輸入路徑後按回車...')"
                    class="flex-1 px-3 py-2 text-sm font-mono border-0 bg-transparent focus:outline-none focus:ring-0"
                    :class="darkMode ? 'text-gray-200 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'"
                    @keyup.enter="applyQuickPath(pair, 'target')"
                    @blur="applyQuickPath(pair, 'target')"
                  />
                  <!-- 複製路徑按鈕 -->
                  <button
                    v-if="pair.targetPath"
                    @click="copyPath(pair.targetPath)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-primary-400' : 'hover:bg-gray-100 text-gray-400 hover:text-primary-500'"
                    :title="$t('admin.scheduledJobs.syncTask.copyPath', '複製路徑')"
                  >
                    <IconCopy size="sm" />
                  </button>
                  <button
                    @click="toggleTargetExpand(pair)"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
                    :title="pair.targetExpanded ? $t('admin.scheduledJobs.syncTask.collapse', '收起') : $t('admin.scheduledJobs.syncTask.expand', '展開')"
                  >
                    <IconList size="sm" />
                  </button>
                  <button
                    v-if="pair.targetPath"
                    @click="clearPath(pair, 'target')"
                    class="p-1.5 rounded transition-colors"
                    :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'"
                    :title="$t('admin.scheduledJobs.syncTask.clearPath', '清除')"
                  >
                    <IconClose size="sm" />
                  </button>
                </div>
              </div>

              <!-- 路徑選擇器 -->
              <div
                v-show="pair.targetExpanded"
                class="panel-selector"
              >
                <PathTreeSelector
                  v-model="pair.targetFolder"
                  :dark-mode="darkMode"
                  :allow-files="false"
                  max-height="280px"
                  @update:model-value="onTargetFolderSelected(pair, $event)"
                />
              </div>

              <!-- 路徑提示 -->
              <div class="panel-hint" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.targetPathHint', '可以是資料夾路徑（自動拼接原始檔名），也可手動重新命名檔案路徑') }}
              </div>
            </div>
          </div>
          </Transition>

          <!-- 分隔線 (多個路徑對時) -->
          <div
            v-if="index < pathPairs.length - 1"
            class="mt-4 border-t"
            :class="darkMode ? 'border-gray-800' : 'border-gray-100'"
          ></div>
        </div>
      </TransitionGroup>

      <!-- 新增路徑對按鈕 -->
      <button
        @click="addPathPair"
        :disabled="pathPairs.length >= 100"
        class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors border-2 border-dashed flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        :class="darkMode
          ? 'border-gray-700 hover:border-gray-600 text-gray-500 hover:text-gray-400 hover:bg-gray-800/50'
          : 'border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-500 hover:bg-gray-50'"
      >
        <IconFolderPlus size="sm" />
        {{ $t('admin.scheduledJobs.syncTask.addPathPair', '新增路徑對') }}
        <span class="text-xs opacity-60">({{ pathPairs.length }}/100)</span>
      </button>

      <!-- 高階選項 -->
      <details class="mt-4">
        <summary
          class="flex items-center gap-2 text-sm cursor-pointer select-none py-2"
          :class="darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'"
        >
          <IconChevronRight size="sm" class="transition-transform details-chevron" />
          {{ $t('admin.scheduledJobs.syncTask.advancedOptions', '高階選項') }}
        </summary>

        <div
          class="mt-3 p-4 rounded-lg border grid grid-cols-1 md:grid-cols-2 gap-6"
          :class="darkMode ? 'bg-gray-800/30 border-gray-700' : 'bg-gray-50 border-gray-200'"
        >
          <!-- 跳過已存在檔案 -->
          <label class="flex items-start cursor-pointer">
            <input
              v-model="options.skipExisting"
              type="checkbox"
              class="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div class="ml-3">
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ $t('admin.scheduledJobs.syncTask.skipExisting', '跳過已存在檔案') }}
              </span>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ $t('admin.scheduledJobs.syncTask.skipExistingHint', '啟用後僅複製目標位置不存在的檔案（增量同步）') }}
              </p>
            </div>
          </label>

          <!-- 複製併發數 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ $t('admin.scheduledJobs.syncTask.maxConcurrency', '複製併發數') }}
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model.number="options.maxConcurrency"
                type="range"
                min="1"
                max="32"
                class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
              />
              <input
                v-model.number="options.maxConcurrency"
                type="number"
                min="1"
                max="32"
                class="w-14 px-2 py-1 rounded text-sm text-center border"
                :class="darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'"
              />
            </div>
            <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ $t('admin.scheduledJobs.syncTask.concurrencyHint', 'Workers 環境建議使用 1') }}
            </p>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import PathTreeSelector from './PathTreeSelector.vue'
import { IconArrowUp, IconCheckCircle, IconChevronRight, IconClose, IconCopy, IconFolder, IconFolderPlus, IconList } from '@/components/icons'
import { copyToClipboard } from '@/utils/clipboard'
import { createLogger } from '@/utils/logger.js'

const log = createLogger('SyncTaskConfigForm')

// ====== 目標路徑輔助：從“檔案路徑/目錄路徑”推匯出“目錄路徑” ======
function deriveTargetFolder(targetPath) {
  const raw = String(targetPath || '').trim()
  if (!raw) return ''

  let p = raw
    .replace(/\\\\/g, '/')
    .replace(/\/{2,}/g, '/')

  if (!p.startsWith('/')) p = `/${p}`
  if (p === '/') return '/'

  // 已經是目錄
  if (p.endsWith('/')) {
    return p.replace(/\/+$/g, '/') // 收斂到單個 /
  }

  // 檔案：取父目錄
  const lastSlash = p.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return p.slice(0, lastSlash + 1) || '/'
}

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  },
  darkMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

// ========== 核心狀態 ==========
const pathPairs = ref([])
const options = ref({
  skipExisting: true,
  maxConcurrency: 1
})

// ========== 狀態控制標誌 ==========
let isInitialized = false
let isInternalUpdate = false
let lastEmittedConfigStr = null

// ========== 輔助函式 ==========

function createNewPair() {
  return {
    id: Date.now() + Math.random(),
    sourcePath: '',
    targetPath: '',
    targetFolder: '',
    sourcePathInput: '',
    targetPathInput: '',
    sourceExpanded: true,
    targetExpanded: true,
    collapsed: false  // 路徑對整體是否收縮
  }
}

function parseConfigToPairs(config) {
  if (!config || Object.keys(config).length === 0) {
    return [createNewPair()]
  }

  if (Array.isArray(config.pairs) && config.pairs.length > 0) {
    return config.pairs.map((pair, index) => ({
      id: Date.now() + index + Math.random(),
      sourcePath: pair.sourcePath || '',
      targetPath: pair.targetPath || '',
      targetFolder: deriveTargetFolder(pair.targetPath || ''),
      sourcePathInput: pair.sourcePath || '',
      targetPathInput: pair.targetPath || '',
      sourceExpanded: !pair.sourcePath,
      targetExpanded: !pair.targetPath,
      collapsed: !!(pair.sourcePath && pair.targetPath)  // 已配置的路徑對預設收縮
    }))
  }

  if (config.sourcePath || config.targetPath) {
    return [{
      id: Date.now(),
      sourcePath: config.sourcePath || '',
      targetPath: config.targetPath || '',
      targetFolder: deriveTargetFolder(config.targetPath || ''),
      sourcePathInput: config.sourcePath || '',
      targetPathInput: config.targetPath || '',
      sourceExpanded: !config.sourcePath,
      targetExpanded: !config.targetPath,
      collapsed: !!(config.sourcePath && config.targetPath)  // 已配置的路徑對預設收縮
    }]
  }

  return [createNewPair()]
}

function parseConfigToOptions(config) {
  return {
    skipExisting: config?.skipExisting !== undefined ? config.skipExisting : true,
    maxConcurrency: config?.maxConcurrency || 1
  }
}

const toBackendConfig = () => {
  const allPairs = pathPairs.value.map(p => {
    const sourcePath = (p.sourcePathInput || p.sourcePath || '').trim()
    const targetPath = (p.targetPathInput || p.targetPath || '').trim()
    return { sourcePath, targetPath }
  })

  if (allPairs.length === 1) {
    return {
      sourcePath: allPairs[0].sourcePath,
      targetPath: allPairs[0].targetPath,
      ...options.value
    }
  }

  return {
    pairs: allPairs,
    ...options.value
  }
}

function isConfigEquivalent(config1, config2) {
  const getPairsCount = (cfg) => {
    if (!cfg) return 0
    if (Array.isArray(cfg.pairs)) return cfg.pairs.length
    if (cfg.sourcePath !== undefined || cfg.targetPath !== undefined) return 1
    return 0
  }

  const count1 = getPairsCount(config1)
  const count2 = getPairsCount(config2)

  if (count1 !== count2) return false

  const normalize = (cfg) => {
    if (!cfg) return '{}'
    const { skipExisting, maxConcurrency, pairs, sourcePath, targetPath } = cfg
    return JSON.stringify({ skipExisting, maxConcurrency, pairs, sourcePath, targetPath })
  }

  return normalize(config1) === normalize(config2)
}

// ========== 初始化 ==========
onMounted(() => {
  if (!isInitialized) {
    isInitialized = true
    pathPairs.value = parseConfigToPairs(props.modelValue)
    options.value = parseConfigToOptions(props.modelValue)
    lastEmittedConfigStr = JSON.stringify(toBackendConfig())
  }
})

// ========== 使用者操作 ==========

const addPathPair = () => {
  if (pathPairs.value.length < 100) {
    isInternalUpdate = true
    pathPairs.value.push(createNewPair())
    emitConfigChange()
    setTimeout(() => {
      isInternalUpdate = false
    }, 50)
  }
}

const removePathPair = (id) => {
  if (pathPairs.value.length > 1) {
    isInternalUpdate = true
    pathPairs.value = pathPairs.value.filter(p => p.id !== id)
    emitConfigChange()
    setTimeout(() => {
      isInternalUpdate = false
    }, 50)
  }
}

const toggleSourceExpand = (pair) => {
  pair.sourceExpanded = !pair.sourceExpanded
}

const toggleTargetExpand = (pair) => {
  pair.targetExpanded = !pair.targetExpanded
}

// 切換路徑對整體展開/收縮
const togglePairCollapsed = (pair) => {
  const willCollapse = !pair.collapsed
  if (willCollapse) {
    applyQuickPath(pair, 'source')
    applyQuickPath(pair, 'target')
  }
  pair.collapsed = willCollapse
}

const applyQuickPath = (pair, type) => {
  if (type === 'source') {
    const input = pair.sourcePathInput?.trim()
    if (input) {
      pair.sourcePath = input
      pair.sourceExpanded = false
    }
  } else {
    const input = pair.targetPathInput?.trim()
    if (input) {
      pair.targetPath = input
      pair.targetFolder = deriveTargetFolder(input)
      pair.targetExpanded = false
    }
  }
}

const onPathSelected = (pair, type, path) => {
  if (type === 'source') {
    pair.sourcePathInput = path
  } else {
    pair.targetPathInput = path
  }
}

const onTargetFolderSelected = (pair, folderPath) => {
  const folder = String(folderPath || '').trim()
  if (!folder) return
  // 選擇器用於選“資料夾”，所以同步把 targetPath 設定成資料夾路徑
  pair.targetFolder = folder
  pair.targetPath = folder
  pair.targetPathInput = folder
}

const clearPath = (pair, type) => {
  if (type === 'source') {
    pair.sourcePath = ''
    pair.sourcePathInput = ''
    pair.sourceExpanded = true
  } else {
    pair.targetPath = ''
    pair.targetFolder = ''
    pair.targetPathInput = ''
    pair.targetExpanded = true
  }
}

// 複製路徑到剪貼簿
const copyPath = async (path) => {
  if (!path) return
  const success = await copyToClipboard(path)
  if (!success) {
    log.error('複製路徑失敗:', path)
  }
}

// ========== 資料同步 ==========

function emitConfigChange() {
  const newConfig = toBackendConfig()
  const newConfigStr = JSON.stringify(newConfig)

  if (newConfigStr !== lastEmittedConfigStr) {
    lastEmittedConfigStr = newConfigStr
    emit('update:modelValue', newConfig)
  }
}

watch(() => props.modelValue, (newVal) => {
  if (isInternalUpdate) return
  if (!isInitialized) return

  const currentConfig = toBackendConfig()
  if (isConfigEquivalent(newVal, currentConfig)) return

  pathPairs.value = parseConfigToPairs(newVal)
  options.value = parseConfigToOptions(newVal)
  lastEmittedConfigStr = JSON.stringify(toBackendConfig())
}, { deep: true })

let updateTimer = null
watch([pathPairs, options], () => {
  if (isInternalUpdate) return

  if (updateTimer) {
    clearTimeout(updateTimer)
  }
  updateTimer = setTimeout(() => {
    emitConfigChange()
  }, 150)
}, { deep: true })
</script>

<style scoped>
.sync-task-config-form {
  @apply w-full;
}

/* 路徑對容器 */
.path-pair-container {
  @apply relative;
}

/* 雙面板佈局 */
.dual-panel-container {
  @apply grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-0;
  align-items: start; /* 讓兩個面板各自獨立高度，而不是等高拉伸 */
}

/* 路徑面板 - 提升質感 */
.path-panel {
  @apply border rounded-xl overflow-hidden;
  @apply shadow-sm;
  @apply transition-all duration-200; /* 新增高度變化動畫 */
}

.path-panel:focus-within {
  @apply shadow-md;
}

.panel-header {
  @apply px-4 py-2.5 border-b;
  @apply flex items-center justify-between;
}

.panel-input {
  @apply px-1 py-1;
  @apply border-gray-200 dark:border-gray-700;
}

.panel-selector {
  @apply p-3;
  @apply bg-gray-50/50 dark:bg-gray-900/30;
}

.panel-hint {
  @apply px-4 py-2 text-xs;
  @apply border-t border-gray-100 dark:border-gray-800;
  @apply bg-gray-50/30 dark:bg-gray-900/20;
}

/* 同步方向指示器 */
.sync-direction-indicator {
  @apply flex items-stretch justify-center;
  @apply xl:px-3 xl:min-w-[60px];
  align-self: stretch; /* 指示器保持拉伸以居中顯示 */
}

/* 列表動畫 */
.path-pair-list-enter-active,
.path-pair-list-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.path-pair-list-enter-from,
.path-pair-list-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}

.path-pair-list-move {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 路徑對內容展開/收縮動畫 */
.pair-content-enter-active,
.pair-content-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.pair-content-enter-from,
.pair-content-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-8px);
}

.pair-content-enter-to,
.pair-content-leave-from {
  opacity: 1;
  max-height: 1000px;
}

/* 高階選項箭頭旋轉 */
details[open] .details-chevron {
  transform: rotate(90deg);
}

/* 滑塊樣式 */
input[type="range"]::-webkit-slider-thumb {
  @apply appearance-none w-4 h-4 rounded-full bg-primary-500 cursor-pointer;
  @apply shadow-sm;
  @apply transition-transform duration-150;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

input[type="range"]::-moz-range-thumb {
  @apply w-4 h-4 rounded-full bg-primary-500 cursor-pointer border-0;
  @apply shadow-sm;
}

/* 暗色模式邊框覆蓋 */
.dark .panel-input {
  @apply border-gray-700;
}

/* 新增路徑對按鈕懸停效果 */
.path-pair-container + button:hover {
  @apply scale-[1.01];
}
</style>
