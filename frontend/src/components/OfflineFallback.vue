<template>
  <div class="offline-fallback">
    <div class="container">
      <div class="content">
        <!-- 離線圖示 -->
        <div class="icon">
          <IconExclamation class="w-16 h-16 text-yellow-500" />
        </div>

        <!-- 標題 -->
        <h1 :class="['title', darkMode ? 'text-white' : 'text-gray-900']">頁面暫時無法訪問</h1>

        <!-- 描述 -->
        <p :class="['description', darkMode ? 'text-gray-300' : 'text-gray-600']">您當前處於離線狀態，此頁面尚未快取。請檢查網路連線後重試，或訪問其他已快取的頁面。</p>

        <!-- 操作按鈕 -->
        <div class="actions">
          <button @click="goHome" :class="['btn-primary', darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600']">返回首頁</button>

          <button
            @click="goBack"
            :class="[
              'btn-secondary',
              darkMode ? 'text-gray-300 hover:text-white border-gray-600 hover:border-gray-500' : 'text-gray-600 hover:text-gray-800 border-gray-300 hover:border-gray-400',
            ]"
          >
            返回上頁
          </button>

          <button
            @click="retry"
            :class="[
              'btn-secondary',
              darkMode ? 'text-gray-300 hover:text-white border-gray-600 hover:border-gray-500' : 'text-gray-600 hover:text-gray-800 border-gray-300 hover:border-gray-400',
            ]"
          >
            重新嘗試
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { IconExclamation } from "@/components/icons";

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  targetRoute: {
    type: String,
    default: "",
  },
});

const router = useRouter();

// 返回首頁
const goHome = () => {
  router.push("/");
};

// 返回上一頁
const goBack = () => {
  if (window.history.length > 1) {
    router.go(-1);
  } else {
    goHome();
  }
};

// 重新嘗試訪問目標頁面
const retry = () => {
  if (props.targetRoute) {
    router.push(props.targetRoute);
  } else {
    window.location.reload();
  }
};
</script>

<style scoped>
.offline-fallback {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.container {
  max-width: 28rem;
  width: 100%;
}

.content {
  text-align: center;
}

.icon {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: center;
}

.title {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.description {
  font-size: 1rem;
  line-height: 1.5;
  margin-bottom: 2rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.btn-primary,
.btn-secondary {
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 500;
  transition: all 0.2s;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary {
  color: white;
  border: none;
}

.btn-secondary {
  background: transparent;
  border: 1px solid;
}

@media (min-width: 640px) {
  .actions {
    flex-direction: row;
    justify-content: center;
  }
}
</style>
