// foliate-js 的 PDF 支援在其 pdf.js 裡使用了 Vite 不相容的 glob（以及 top-level await）。
// 讓我們能正常使用 foliate-js 的 EPUB 渲染能力。

export const makePDF = async () => {
  throw new Error("foliate-js PDF preview is disabled in CloudHarbor (use built-in PDF preview instead).");
};

