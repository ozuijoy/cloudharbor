<template>
  <div class="html-display" :class="{ 'html-display-dark': darkMode }">
    <!-- HTML渲染區域 -->
    <div class="html-rendered">
      <iframe ref="htmlFrame" class="html-iframe" sandbox="allow-scripts allow-same-origin" :srcdoc="wrappedContent"></iframe>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";

// Props
const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 響應式資料
const htmlFrame = ref(null);

// 包裝HTML內容，新增內邊距樣式
const wrappedContent = computed(() => {
  if (!props.content) return "";

  // 檢查是否已經是完整的HTML文件
  const isFullDocument = props.content.toLowerCase().includes("<!doctype") || props.content.toLowerCase().includes("<html");

  if (isFullDocument) {
    // 如果是完整文件，在body標籤中新增樣式
    let modifiedContent = props.content.replace(
      /<body([^>]*)>/i,
      `<body$1 style="padding: 1.5rem; margin: 0; box-sizing: border-box; background-color: ${props.darkMode ? "#1f2937" : "#ffffff"}; color: ${
        props.darkMode ? "#d4d4d4" : "#374151"
      }; min-height: 100vh; overflow-x: auto; overflow-y: auto; position: relative; min-width: 800px;">`
    );

    // 如果沒有找到body標籤，在head中新增樣式
    if (!modifiedContent.includes('style="')) {
      modifiedContent = modifiedContent.replace(
        /<\/head>/i,
        `<style>
          html, body {
            margin: 0;
            padding: 1.5rem;
            box-sizing: border-box;
            background-color: ${props.darkMode ? "#1f2937" : "#ffffff"};
            color: ${props.darkMode ? "#d4d4d4" : "#374151"};
            min-height: 100vh;
            overflow-x: auto;
            overflow-y: auto;
            position: relative;
            min-width: 800px;
          }

          /* 自定義捲軸樣式 - 與其他預覽模式保持一致 */
          ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }

          ::-webkit-scrollbar-track {
            background-color: ${props.darkMode ? "#374151" : "#f3f4f6"};
          }

          ::-webkit-scrollbar-thumb {
            background-color: ${props.darkMode ? "#6b7280" : "#d1d5db"};
            border-radius: 4px;
          }

          ::-webkit-scrollbar-thumb:hover {
            background-color: #9ca3af;
          }
        </style>
        </head>`
      );
    }

    return modifiedContent;
  } else {
    // 如果是HTML片段，包裝在完整的HTML文件中
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      margin: 0;
      padding: 1.5rem;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
      background-color: ${props.darkMode ? "#1f2937" : "#ffffff"};
      color: ${props.darkMode ? "#d4d4d4" : "#374151"};
      line-height: 1.6;
      min-height: 100vh;
      overflow-x: auto;
      overflow-y: auto;
    }

    /* 確保絕對定位元素不會被截斷 */
    body {
      position: relative;
      min-width: 800px;
    }

    /* 自定義捲軸樣式 - 與其他預覽模式保持一致 */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background-color: ${props.darkMode ? "#374151" : "#f3f4f6"};
    }

    ::-webkit-scrollbar-thumb {
      background-color: ${props.darkMode ? "#6b7280" : "#d1d5db"};
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background-color: #9ca3af;
    }
  </style>
</head>
<body>
  ${props.content}
</body>
</html>`;
  }
});
</script>

<style scoped>
.html-display {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.html-rendered {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.html-iframe {
  width: 100%;
  height: 100%;
  min-height: 400px;
  border: 0;
  overflow: auto;
}
</style>
