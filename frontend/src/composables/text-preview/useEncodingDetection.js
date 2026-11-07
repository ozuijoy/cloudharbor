/**
 * 編碼檢測 Composable
 * 提供編碼檢測和管理功能
 */

import { ref, computed } from 'vue';
import { 
  detectEncodingFromUrl, 
  smartDetectEncoding, 
  SUPPORTED_ENCODINGS,
  isEncodingSupported,
  getEncodingInfo,
  normalizeEncoding
} from '@/utils/encodingDetector.js';
import { createLogger } from '@/utils/logger.js';

export function useEncodingDetection() {
  const log = createLogger('EncodingDetection');
  // 狀態
  const selectedEncoding = ref('utf-8');
  const detectionResult = ref(null);
  const isDetecting = ref(false);
  const detectionError = ref(null);
  
  // 計算屬性
  const hasDetectionResult = computed(() => !!detectionResult.value);
  
  const detectionConfidence = computed(() => {
    return detectionResult.value?.confidence || 0;
  });
  
  const isDetectionReliable = computed(() => {
    return detectionConfidence.value >= 70;
  });
  
  const availableEncodings = computed(() => {
    return SUPPORTED_ENCODINGS;
  });
  
  const selectedEncodingInfo = computed(() => {
    return getEncodingInfo(selectedEncoding.value);
  });
  
  /**
   * 檢測檔案編碼
   * @param {string} url - 檔案URL
   * @param {string} filename - 檔名（可選）
   * @param {Object} options - 檢測選項
   * @returns {Promise<Object>} 檢測結果
   */
  const detectEncoding = async (url, filename = '', options = {}) => {
    if (!url) {
      throw new Error('URL不能為空');
    }
    
    try {
      isDetecting.value = true;
      detectionError.value = null;
      
      // 使用智慧檢測
      const result = await smartDetectEncoding(url, filename, options);
      
      detectionResult.value = result;
      
      if (result.success) {
        // 自動選擇檢測到的編碼
        selectEncoding(result.encoding);
      } else {
        detectionError.value = result.error;
      }
      
      return result;
      
    } catch (error) {
      log.error('編碼檢測失敗:', error);
      detectionError.value = error.message;
      
      return {
        success: false,
        encoding: 'utf-8',
        confidence: 0,
        allResults: [],
        error: error.message
      };
    } finally {
      isDetecting.value = false;
    }
  };
  
  /**
   * 選擇編碼
   * @param {string} encoding - 編碼名稱
   */
  const selectEncoding = (encoding) => {
    if (!encoding) return;
    
    const normalized = normalizeEncoding(encoding);
    
    if (isEncodingSupported(normalized)) {
      selectedEncoding.value = normalized;
    } else {
      log.warn(`不支援的編碼: ${encoding}，使用預設編碼 utf-8`);
      selectedEncoding.value = 'utf-8';
    }
  };
  
  /**
   * 重置檢測狀態
   */
  const resetDetection = () => {
    selectedEncoding.value = 'utf-8';
    detectionResult.value = null;
    isDetecting.value = false;
    detectionError.value = null;
  };
  
  /**
   * 獲取編碼建議
   * 基於檢測結果提供編碼選擇建議
   * @returns {Array} 編碼建議列表
   */
  const getEncodingSuggestions = () => {
    if (!detectionResult.value || !detectionResult.value.allResults) {
      return [
        { encoding: 'utf-8', confidence: 100, reason: '預設編碼' }
      ];
    }
    
    const suggestions = detectionResult.value.allResults
      .filter(result => result.confidence > 20) // 過濾低置信度結果
      .slice(0, 5) // 最多5個建議
      .map(result => ({
        encoding: result.encoding,
        confidence: result.confidence,
        reason: getConfidenceReason(result.confidence),
        language: result.language
      }));
    
    // 確保UTF-8總是在列表中
    if (!suggestions.find(s => s.encoding === 'utf-8')) {
      suggestions.push({
        encoding: 'utf-8',
        confidence: 50,
        reason: '通用編碼',
        language: null
      });
    }
    
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  };
  
  /**
   * 獲取置信度描述
   * @param {number} confidence - 置信度
   * @returns {string} 描述
   */
  const getConfidenceReason = (confidence) => {
    if (confidence >= 90) return '非常可能';
    if (confidence >= 70) return '很可能';
    if (confidence >= 50) return '可能';
    if (confidence >= 30) return '不太確定';
    return '不確定';
  };
  
  /**
   * 驗證編碼選擇
   * @param {string} encoding - 編碼名稱
   * @returns {Object} 驗證結果
   */
  const validateEncoding = (encoding) => {
    const normalized = normalizeEncoding(encoding);
    const isSupported = isEncodingSupported(normalized);
    const info = getEncodingInfo(normalized);
    
    return {
      isValid: isSupported,
      normalized,
      info,
      message: isSupported ? '編碼有效' : `不支援的編碼: ${encoding}`
    };
  };
  
  return {
    // 狀態
    selectedEncoding,
    detectionResult,
    isDetecting,
    detectionError,
    
    // 計算屬性
    hasDetectionResult,
    detectionConfidence,
    isDetectionReliable,
    availableEncodings,
    selectedEncodingInfo,
    
    // 方法
    detectEncoding,
    selectEncoding,
    resetDetection,
    getEncodingSuggestions,
    validateEncoding
  };
}
