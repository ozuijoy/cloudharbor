import { resolveDriverByConfigId, resolveDriverByType } from "@/modules/storage-core/drivers/registry.js";
import { DRIVER_TYPES, STORAGE_STRATEGIES, STORAGE_SOURCES, DEFAULT_DRIVER_CAPABILITIES } from "@/modules/storage-core/drivers/types.js";
import { useUploaderClient } from "@/modules/storage-core/useUploaderClient.js";

/**
 * storage-core 模組入口
 *
 * - 作為儲存驅動與上傳管線的領域入口
 * - 對外暴露 driver registry 與 uploader client
 *
 */

export {
  // driver registry
  resolveDriverByConfigId,
  resolveDriverByType,

  // driver 常量
  DRIVER_TYPES,
  STORAGE_STRATEGIES,
  STORAGE_SOURCES,
  DEFAULT_DRIVER_CAPABILITIES,

  // uploader client
  useUploaderClient,
};
