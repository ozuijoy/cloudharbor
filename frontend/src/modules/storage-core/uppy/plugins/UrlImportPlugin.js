/**
 * URL匯入外掛 - Uppy UIPlugin
 *
 * 功能：
 * - 在Dashboard中新增URL匯入觸發器
 * - 提供addFromUrl API用於從URL下載並新增檔案到Uppy
 * - 支援進度追蹤和錯誤處理
 * - 與現有上傳流程無縫整合
 */

import { UIPlugin } from '@uppy/core';
import { h } from 'preact';
import { createLogger } from '@/utils/logger.js';

const log = createLogger('UrlImportPlugin');

export default class UrlImportPlugin extends UIPlugin {
  constructor(uppy, opts) {
    super(uppy, opts);

    this.id = this.opts.id || 'UrlImport';
    this.type = 'acquirer';

    // 預設配置
    this.defaultOptions = {
      // API服務函式
      validateUrlInfo: null,    // URL驗證和元資訊獲取: (url) => Promise<{filename, size, contentType, ...}>
      fetchUrlContent: null,    // URL內容下載: ({url, onProgress, setXhr}) => Promise<Blob>
    };

    // 設定預設語言包
    this.defaultLocale = {
      strings: {
        pluginName: 'URL匯入',
        importFromUrl: '從URL匯入',
        enterUrl: '輸入檔案URL',
        analyzing: '分析中...',
        downloading: '下載中...',
        analyzeUrl: '分析 URL',
        download: '下載',
        fileInfoReady: '檔案資訊已獲取',
        unknownFile: '未知檔案',
        reInput: '重新輸入',
        cannotGetUrlInfo: '無法獲取URL資訊',
        analysisFailed: 'URL分析失敗',
        missingFileInfo: '缺少檔案資訊',
        downloadFailed: '下載失敗',
        downloadComplete: '下載完成',
        progressPercent: '%{progress}%',
        cancelDownload: '取消下載',
        downloadCancelled: '下載已取消',
      }
    };

    // 初始化 i18n（必須在使用 this.i18n() 之前呼叫）
    this.i18nInit();

    // 設定標題（使用 i18n）
    this.title = this.i18n('pluginName');

    // 當前下載的XHR引用（用於取消）
    this.activeXhr = null;

    // 下載狀態
    this.isDownloading = false;

    // 初始化外掛狀態（用於UI更新）
    const defaultState = {
      stage: 'input',        // 'input' | 'ready'
      loading: false,
      loadingText: '',
      error: null,
      progress: 0,
      fileInfo: null,
      currentUrl: '',
    };
    this.setPluginState(defaultState);
  }

  /**
   * 外掛安裝
   */
  install() {
    const { target } = this.opts;

    // 如果指定了目標，則掛載UI
    if (target) {
      this.mount(target, this);
    }

    // 註冊為Dashboard的acquirer（如果Dashboard存在）
    const dashboard = this.uppy.getPlugin('Dashboard');
    if (dashboard) {
      dashboard.addTarget(this);
    }

    // 監聽Dashboard關閉事件，重置外掛狀態
    this.uppy.on('dashboard:modal-closed', () => {
      this.cancelDownload();
      this.resetToInput();
    });
  }

  /**
   * 外掛解除安裝
   */
  uninstall() {
    this.cancelDownload();
    this.unmount();
  }

  /**
   * 自定義圖示（連結圖示）
   */
  icon() {
    return h('svg', {
      'aria-hidden': 'true',
      focusable: 'false',
      width: '32',
      height: '32',
      viewBox: '0 0 32 32'
    }, [
      h('path', {
        d: 'M23.637 15.312l-2.474 2.464a3.582 3.582 0 01-.577.491c-.907.657-1.897.986-2.968.986a4.925 4.925 0 01-3.959-1.971c-.248-.329-.164-.902.165-1.149.33-.247.907-.164 1.155.164 1.072 1.478 3.133 1.724 4.618.656a.642.642 0 00.33-.328l2.473-2.463c1.238-1.313 1.238-3.366-.082-4.597a3.348 3.348 0 00-4.618 0l-1.402 1.395a.799.799 0 01-1.154 0 .79.79 0 010-1.15l1.402-1.394a4.843 4.843 0 016.843 0c2.062 1.805 2.144 5.007.248 6.896zm-8.081 5.664l-1.402 1.395a3.348 3.348 0 01-4.618 0c-1.319-1.23-1.319-3.365-.082-4.596l2.475-2.464.328-.328c.743-.492 1.567-.739 2.475-.657.906.165 1.648.574 2.143 1.314.248.329.825.411 1.155.165.33-.248.412-.822.165-1.15-.825-1.068-1.98-1.724-3.216-1.888-1.238-.247-2.556.082-3.628.902l-.495.493-2.474 2.464c-1.897 1.969-1.814 5.09.083 6.977.99.904 2.226 1.396 3.463 1.396s2.473-.492 3.463-1.395l1.402-1.396a.79.79 0 000-1.15c-.33-.328-.908-.41-1.237-.082z',
        fill: '#FF753E',
        'fill-rule': 'nonzero'
      })
    ]);
  }

  /**
   * 渲染外掛UI（Dashboard面板中的內容）
   */
  render() {
    const state = this.getPluginState();
    const { stage, loading, loadingText, error, progress, fileInfo } = state;

    const children = [];

    // URL 輸入框
    children.push(
      h('input', {
        ref: (el) => { this.inputEl = el; },
        className: 'uppy-u-reset uppy-c-textInput uppy-Url-input',
        type: 'url',
        placeholder: this.i18n('enterUrl'),
        'aria-label': this.i18n('enterUrl'),
        disabled: loading || stage === 'ready',
        style: {
          width: '100%',
          padding: '12px 16px',
          fontSize: '14px',
          border: '2px solid #e5e7eb',
          borderRadius: '8px',
          outline: 'none',
          transition: 'all 0.2s',
          marginBottom: '12px',
          boxSizing: 'border-box',
        },
        onfocus: (e) => {
          e.target.style.borderColor = '#3b82f6';
          e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
        },
        onblur: (e) => {
          e.target.style.borderColor = '#e5e7eb';
          e.target.style.boxShadow = 'none';
        },
        onkeyup: (e) => {
          if (e.key === 'Enter' && e.target.value.trim() && !loading && stage === 'input') {
            this.handleAnalyzeUrl(e.target.value.trim());
          }
        }
      })
    );

    // 檔案資訊展示（分析成功後顯示）
    if (stage === 'ready' && fileInfo) {
      children.push(
        h('div', {
          style: {
            marginBottom: '12px',
            padding: '12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '8px',
          }
        }, [
          // 成功提示
          h('div', {
            style: {
              fontSize: '13px',
              fontWeight: '500',
              color: '#166534',
              marginBottom: '8px',
            }
          }, '✓ ' + this.i18n('fileInfoReady')),

          // 檔案資訊
          h('div', {
            style: {
              fontSize: '12px',
              color: '#6b7280',
            }
          }, `${fileInfo.filename || this.i18n('unknownFile')} (${this.formatFileSize(fileInfo.size)})`),
        ])
      );
    }

    // 進度條（下載時顯示）
    if (loading && progress > 0) {
      children.push(
        h('div', {
          style: {
            width: '100%',
            maxWidth: '480px',
            margin: '0 auto',
            marginBottom: '12px',
          }
        }, [
          // 進度條容器
          h('div', {
            style: {
              width: '100%',
              height: '6px',
              backgroundColor: '#e5e7eb',
              borderRadius: '3px',
              overflow: 'hidden',
            }
          }, [
            h('div', {
              style: {
                width: `${progress}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                transition: 'width 0.3s ease',
              }
            })
          ]),
          // 數字進度顯示
          h('div', {
            style: {
              marginTop: '6px',
              fontSize: '13px',
              fontWeight: '500',
              color: '#3b82f6',
              textAlign: 'center',
            }
          }, `${progress}%`)
        ])
      );
    }

    // 按鈕組
    const buttons = [];

    if (stage === 'ready') {
      // 重新輸入按鈕 / 取消下載按鈕（根據loading狀態切換）
      const isCancel = loading;
      const cancelButtonText = isCancel ? this.i18n('cancelDownload') : this.i18n('reInput');
      const cancelButtonColor = isCancel ? '#ef4444' : '#374151';
      const cancelButtonBg = isCancel ? '#fef2f2' : '#ffffff';
      const cancelButtonBorder = isCancel ? '#fecaca' : '#d1d5db';
      const cancelButtonHoverBg = isCancel ? '#fee2e2' : '#f9fafb';

      buttons.push(
        h('button', {
          className: 'uppy-u-reset uppy-c-btn',
          type: 'button',
          onclick: () => {
            if (isCancel) {
              this.handleCancelDownload();
            } else {
              this.resetToInput();
            }
          },
          style: {
            flex: '1',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: '500',
            backgroundColor: cancelButtonBg,
            color: cancelButtonColor,
            border: `1px solid ${cancelButtonBorder}`,
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          },
          onmouseover: (e) => {
            e.target.style.backgroundColor = cancelButtonHoverBg;
          },
          onmouseout: (e) => {
            e.target.style.backgroundColor = cancelButtonBg;
          },
        }, cancelButtonText)
      );
    }

    // 主按鈕（分析/新增到佇列）
    const isAnalyzeStage = stage === 'input';
    const buttonText = loading ? loadingText : (isAnalyzeStage ? this.i18n('analyzeUrl') : this.i18n('download'));
    const buttonColor = isAnalyzeStage ? '#3b82f6' : '#10b981';
    const buttonHoverColor = isAnalyzeStage ? '#2563eb' : '#059669';

    buttons.push(
      h('button', {
        className: 'uppy-u-reset uppy-c-btn uppy-c-btn-primary uppy-Url-actionButton',
        type: 'button',
        disabled: loading,
        onclick: () => {
          if (loading) return;
          if (stage === 'input') {
            const url = this.inputEl?.value.trim();
            if (url) {
              this.handleAnalyzeUrl(url);
            }
          } else if (stage === 'ready') {
            this.handleDownload();
          }
        },
        style: {
          flex: stage === 'ready' ? '2' : '1',
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: '500',
          backgroundColor: loading ? '#9ca3af' : buttonColor,
          color: '#ffffff',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        },
        onmouseover: (e) => {
          if (!loading) {
            e.target.style.backgroundColor = buttonHoverColor;
          }
        },
        onmouseout: (e) => {
          if (!loading) {
            e.target.style.backgroundColor = buttonColor;
          }
        },
      }, [
        loading && h('span', {
          style: {
            width: '16px',
            height: '16px',
            border: '2px solid #ffffff',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }
        }),
        buttonText,
      ])
    );

    children.push(
      h('div', {
        style: {
          display: 'flex',
          gap: '8px',
        }
      }, buttons)
    );

    // 錯誤提示
    if (error) {
      children.push(
        h('div', {
          style: {
            marginTop: '12px',
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }
        }, [
          h('svg', {
            width: '20',
            height: '20',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: '#dc2626',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            style: {
              flexShrink: '0',
              marginTop: '2px',
            }
          }, [
            h('circle', { cx: '12', cy: '12', r: '10' }),
            h('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
            h('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }),
          ]),
          h('span', {
            style: {
              fontSize: '13px',
              color: '#dc2626',
              flex: '1',
            }
          }, error),
        ])
      );
    }

    // 新增旋轉動畫樣式
    children.push(
      h('style', {}, `
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `)
    );

    return h(
      'div',
      {
        className: 'uppy-Url',
        style: { padding: '16px 12px' }
      },
      children
    );
  }

  /**
   * 格式化檔案大小
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '未知大小';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * 階段1：分析URL
   */
  async handleAnalyzeUrl(url) {
    // 清除之前的錯誤
    this.setPluginState({ error: null });

    try {
      // 顯示分析狀態
      this.setPluginState({
        loading: true,
        loadingText: this.i18n('analyzing'),
        progress: 0,
      });

      const fileInfo = await this.validateUrl(url);
      if (!fileInfo) {
        this.setPluginState({
          loading: false,
          loadingText: '',
          error: this.i18n('cannotGetUrlInfo'),
        });
        return;
      }

      // 分析成功，切換到ready階段
      this.setPluginState({
        loading: false,
        loadingText: '',
        stage: 'ready',
        fileInfo,
        currentUrl: url,
        error: null,
      });

      this.uppy.emit('url-analyzed', { url, fileInfo });
    } catch (error) {
      this.uppy.log('[UrlImportPlugin] Analysis failed:', error);

      this.setPluginState({
        loading: false,
        loadingText: '',
        error: error.message || this.i18n('analysisFailed'),
      });

      this.uppy.emit('url-analyze-error', {
        url,
        error,
      });
    }
  }

  /**
   * 階段2：下載檔案並新增到Uppy
   */
  async handleDownload() {
    const state = this.getPluginState();
    const { currentUrl, fileInfo } = state;

    if (!fileInfo || !currentUrl) {
      this.setPluginState({ error: this.i18n('missingFileInfo') });
      return;
    }

    try {
      // 顯示下載狀態
      this.setPluginState({
        loading: true,
        loadingText: this.i18n('downloading'),
        progress: 0,
        error: null,
      });

      this.uppy.emit('url-import-start', { url: currentUrl });

      // 下載檔案
      const blob = await this.downloadFromUrl(currentUrl, (progress) => {
        this.setPluginState({ progress: Math.round(progress) });
        this.uppy.emit('url-import-progress', {
          url: currentUrl,
          progress,
        });
      });

      // 新增到Uppy（使用原生介面展示，支援縮圖、編輯等）
      const filename = fileInfo.filename || 'downloaded-file';
      const fileType = fileInfo.contentType || blob.type || 'application/octet-stream';

      // 顯示100%完成狀態
      this.setPluginState({
        progress: 100,
        loadingText: this.i18n('downloadComplete'),
      });

      this.uppy.addFile({
        name: filename,
        type: fileType,
        data: blob,
        source: this.id,
        meta: {
          sourceUrl: currentUrl,
          originalFilename: fileInfo.filename,
          originalSize: fileInfo.size,
        },
      });

      this.uppy.emit('url-import-success', {
        url: currentUrl,
        filename,
      });

      // 延遲重置到初始狀態，讓使用者看到完成狀態
      await new Promise((resolve) => setTimeout(resolve, 800));
      this.resetToInput();
    } catch (error) {
      this.uppy.log('[UrlImportPlugin] Download failed:', error);

      // 使用者主動取消下載時
      const isCancelled = error.message === '下載已取消';
      if (isCancelled) {
        // 顯示Uppy官方取消提示，但不顯示自定義錯誤框
        this.uppy.info(this.i18n('downloadCancelled'), 'info', 3000);
        // 狀態已由 handleCancelDownload() 處理，不需要重新設定
      } else {
        // 其他錯誤：顯示錯誤提示和錯誤框
        this.uppy.info(error.message || this.i18n('downloadFailed'), 'error', 4000);
        this.setPluginState({
          loading: false,
          loadingText: '',
          progress: 0,
          error: error.message || this.i18n('downloadFailed'),
        });

        this.uppy.emit('url-import-error', {
          url: currentUrl,
          error,
        });
      }
    }
  }

  /**
   * 重置到輸入階段
   */
  resetToInput() {
    this.setPluginState({
      stage: 'input',
      loading: false,
      loadingText: '',
      error: null,
      progress: 0,
      fileInfo: null,
      currentUrl: '',
    });

    // 清空輸入框
    if (this.inputEl) {
      this.inputEl.value = '';
    }
  }


  /**
   * 驗證URL並獲取檔案資訊
   * @param {string} url - 要驗證的URL
   * @returns {Promise<Object>} 檔案元資訊
   */
  async validateUrl(url) {
    if (!this.opts.validateUrlInfo) {
      throw new Error('[UrlImportPlugin] 缺少validateUrlInfo配置');
    }

    try {
      const response = await this.opts.validateUrlInfo(url);
      if (!response?.success) {
        throw new Error(response?.message || '無法獲取URL資訊');
      }
      return response.data || null;
    } catch (error) {
      throw new Error(error.message || 'URL驗證失敗');
    }
  }

  /**
   * 從URL下載內容
   * @param {string} url - 要下載的URL
   * @param {Function} onProgress - 進度回撥
   * @returns {Promise<Blob>} 下載的內容
   */
  async downloadFromUrl(url, onProgress) {
    if (!this.opts.fetchUrlContent) {
      throw new Error('[UrlImportPlugin] 缺少fetchUrlContent配置');
    }

    this.isDownloading = true;

    try {
      const blob = await this.opts.fetchUrlContent({
        url,
        onProgress: (progress, loaded, total) => {
          if (onProgress) {
            onProgress(progress, loaded, total);
          }
          // 傳送Uppy事件
          this.uppy.emit('url-import-progress', {
            url,
            progress,
            loaded,
            total,
          });
        },
        setXhr: (xhr) => {
          this.activeXhr = xhr;
        },
      });

      return blob;
    } finally {
      this.isDownloading = false;
      this.activeXhr = null;
    }
  }

  /**
   * 取消當前下載
   */
  cancelDownload() {
    if (this.activeXhr) {
      try {
        this.activeXhr.abort();
      } catch (error) {
        log.warn('[UrlImportPlugin] 取消下載失敗', error);
      }
      this.activeXhr = null;
    }
    this.isDownloading = false;
  }

  /**
   * 處理使用者點選取消下載按鈕
   * 取消後返回到ready狀態（保留fileInfo），而不是重置到input狀態
   */
  handleCancelDownload() {
    this.cancelDownload();
    // 返回到ready狀態，保留fileInfo和currentUrl
    this.setPluginState({
      stage: 'ready',
      loading: false,
      loadingText: '',
      progress: 0,
      error: null,
      // fileInfo和currentUrl保持不變
    });
    this.uppy.emit('url-import-cancelled', {
      url: this.getPluginState().currentUrl,
    });
  }

  /**
   * 從URL新增檔案到Uppy
   * @param {string} url - 檔案URL
   * @param {Object} options - 選項
   * @param {string} options.customFilename - 自定義檔名（可選）
   * @param {Function} options.onProgress - 進度回撥（可選）
   * @returns {Promise<string>} 新增的檔案ID
   */
  async addFromUrl(url, options = {}) {
    const { customFilename, onProgress } = options;

    try {
      // 1. 驗證URL並獲取元資訊
      this.uppy.emit('url-import-start', { url });

      const fileInfo = await this.validateUrl(url);
      if (!fileInfo) {
        throw new Error('無法獲取檔案資訊');
      }

      // 2. 下載內容
      const blob = await this.downloadFromUrl(url, onProgress);

      // 3. 新增到Uppy
      const filename = customFilename || fileInfo.filename || 'downloaded-file';
      const fileType = fileInfo.contentType || blob.type || 'application/octet-stream';

      const fileId = this.uppy.addFile({
        name: filename,
        type: fileType,
        data: blob,
        source: this.id,
        meta: {
          sourceUrl: url,
          originalFilename: fileInfo.filename,
          originalSize: fileInfo.size,
        },
      });

      this.uppy.emit('url-import-success', {
        url,
        fileId,
        filename,
      });

      return fileId;
    } catch (error) {
      this.uppy.emit('url-import-error', {
        url,
        error,
      });
      throw error;
    }
  }

  /**
   * 獲取外掛顯示名稱
   */
  getPluginName() {
    return this.opts.locale?.strings?.pluginName || 'URL匯入';
  }
}
