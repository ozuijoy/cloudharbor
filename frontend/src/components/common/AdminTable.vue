<template>
  <div class="w-full">
    <!-- 桌面端表格 -->
    <div class="hidden md:block flex-1 overflow-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
        <thead class="bg-gray-50 dark:bg-gray-700">
          <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              scope="col"
              class="px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
              :class="[props.columnClasses[header.column.id] || 'text-left']"
            >
              <div v-if="!header.isPlaceholder" :class="getSortHeaderClass(header.column)" @click="handleSort(header.column)">
                <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                <!-- 排序指示器 -->
                <span v-if="header.column.getCanSort()" class="ml-1 text-xs">
                  <span v-if="header.column.getIsSorted() === 'asc'" class="text-blue-600 dark:text-blue-400">↑</span>
                  <span v-else-if="header.column.getIsSorted() === 'desc'" class="text-blue-600 dark:text-blue-400">↓</span>
                  <span v-else class="text-gray-400 opacity-50">↕</span>
                </span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          <tr v-if="props.data.length === 0">
            <td class="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center" :colspan="table.getAllColumns().length">
              {{ props.emptyText }}
            </td>
          </tr>
          <tr v-for="row in table.getRowModel().rows" :key="row.id" class="hover:bg-gray-50 dark:hover:bg-gray-700">
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              class="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100"
              :class="props.columnClasses[cell.column.id]"
            >
              <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 移動端插槽 -->
    <div class="md:hidden flex-1 overflow-auto">
      <div v-if="props.data.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
        {{ props.emptyText }}
      </div>
      <slot name="mobile" :data="props.data" />
    </div>
  </div>
</template>

<script setup>
import { computed, h } from "vue";
import { useVueTable, getCoreRowModel, getSortedRowModel, FlexRender, createColumnHelper } from "@tanstack/vue-table";

const props = defineProps({
  data: {
    type: Array,
    required: true,
  },
  columns: {
    type: Array,
    required: true,
  },
  columnClasses: {
    type: Object,
    default: () => ({}),
  },
  emptyText: {
    type: String,
    default: "暫無資料",
  },
  manualSorting: {
    type: Boolean,
    default: false,
  },
  sorting: {
    type: Array,
    default: () => [],
  },
  // 新增：選擇相關配置
  selectable: {
    type: Boolean,
    default: false,
  },
  selectedItems: {
    type: Array,
    default: () => [],
  },
  // 新增：行標識欄位
  rowIdField: {
    type: String,
    default: "id",
  },
});

const emit = defineEmits(["sort-change", "selection-change"]);

// 建立列定義助手
const columnHelper = createColumnHelper();

// 將簡化配置轉換為TanStack列定義
const tanstackColumns = computed(() => {
  const columns = [];

  // 如果啟用選擇，新增選擇列
  if (props.selectable) {
    columns.push(
      columnHelper.display({
        id: "select",
        header: () =>
          h("input", {
            type: "checkbox",
            checked: props.data.length > 0 && (props.selectedItems || []).length === props.data.length,
            onClick: () => emit("selection-change", { type: "toggle-all" }),
            class: "h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer",
          }),
        cell: ({ row }) =>
          h("input", {
            type: "checkbox",
            checked: (props.selectedItems || []).includes(row.original[props.rowIdField]),
            onClick: () =>
              emit("selection-change", {
                type: "toggle-item",
                id: row.original[props.rowIdField],
                item: row.original,
              }),
            class: "h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer",
          }),
        enableSorting: false,
      })
    );
  }

  // 處理業務列
  props.columns.forEach((col) => {
    if (col.type === "accessor") {
      // 簡單欄位列
      const columnDef = {
        id: col.key,
        header: col.header,
        cell: ({ getValue, row }) => {
          if (col.render) {
            return col.render(getValue(), row.original);
          }
          return getValue();
        },
        enableSorting: col.sortable !== false,
      };

      // 新增自定義排序函式支援
      if (col.sortingFn) {
        columnDef.sortingFn = col.sortingFn;
      }

      columns.push(columnHelper.accessor(col.key, columnDef));
    } else if (col.type === "display") {
      // 自定義顯示列
      const columnDef = {
        id: col.key,
        header: col.header,
        cell: ({ row }) => {
          if (col.render) {
            return col.render(row.original);
          }
          return "";
        },
        enableSorting: col.sortable === true,
      };

      // 新增自定義排序函式支援
      if (col.sortingFn) {
        columnDef.sortingFn = col.sortingFn;
      }

      columns.push(columnHelper.display(columnDef));
    }
  });

  return columns;
});

// 建立TanStack表格例項
const table = useVueTable({
  get data() {
    return props.data;
  },
  get columns() {
    return tanstackColumns.value;
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  // 移除客戶端過濾，因為我們使用服務端搜尋
  manualSorting: props.manualSorting,
  manualFiltering: true, // 明確宣告使用手動過濾（服務端搜尋）
  ...(props.manualSorting && {
    state: {
      get sorting() {
        return props.sorting || [];
      },
    },
    onSortingChange: (updater) => {
      const newSorting = typeof updater === "function" ? updater(props.sorting || []) : updater;
      emit("sort-change", newSorting);
    },
  }),
  enableSorting: true,
  enableMultiSort: true,
});

// 工具函式
const getSortHeaderClass = (column) => {
  const baseClass = column.getCanSort()
    ? "cursor-pointer select-none flex items-center hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    : "flex items-center";

  // 根據 columnClasses 中的對齊設定，新增對應的 justify 類
  const columnClass = props.columnClasses[column.id] || "";
  let justifyClass = "";
  if (columnClass.includes("text-center")) {
    justifyClass = "justify-center";
  } else if (columnClass.includes("text-right")) {
    justifyClass = "justify-end";
  }

  return `${baseClass} ${justifyClass}`.trim();
};

const handleSort = (column) => {
  if (column.getCanSort()) {
    column.toggleSorting();
  }
};
</script>
