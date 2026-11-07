/**
 * 全域性刪除設定狀態管理
 * 管理刪除模式的全域性狀態，支援持久化儲存
 */

import { defineStore } from "pinia";
import { computed } from "vue";
import { useLocalStorage } from "@vueuse/core";

export const useDeleteSettingsStore = defineStore("deleteSettings", () => {
  const storedSettings = useLocalStorage("cloudharbor_delete_settings", { deleteRecordOnly: false });

  // 刪除模式狀態：false = 同時刪除檔案和記錄，true = 僅刪除記錄
  const deleteRecordOnly = computed({
    get: () => !!storedSettings.value?.deleteRecordOnly,
    set: (value) => {
      storedSettings.value = { ...(storedSettings.value || {}), deleteRecordOnly: !!value };
    },
  });

  // 從localStorage載入設定
  const loadSettings = () => {
    // VueUse 已自動載入，這裡保留方法名用於相容舊呼叫
    deleteRecordOnly.value = !!storedSettings.value?.deleteRecordOnly;
  };

  // 儲存設定到localStorage
  const saveSettings = () => {
    // VueUse 會自動儲存，這裡保留方法名用於相容舊呼叫
    storedSettings.value = { ...(storedSettings.value || {}), deleteRecordOnly: !!deleteRecordOnly.value };
  };

  // 切換刪除模式
  const toggleDeleteMode = () => {
    deleteRecordOnly.value = !deleteRecordOnly.value;
    saveSettings();
  };

  // 獲取刪除模式字串（用於API呼叫）
  const getDeleteMode = () => {
    return deleteRecordOnly.value ? "record_only" : "both";
  };

  // 初始化時載入設定
  loadSettings();

  return {
    deleteRecordOnly,
    toggleDeleteMode,
    getDeleteMode,
    loadSettings,
    saveSettings,
  };
});
