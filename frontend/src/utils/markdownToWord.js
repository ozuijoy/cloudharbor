// 匯入docx庫元件用於建立Word文件
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Tab,
  VerticalAlign,
  ExternalHyperlink,
  UnderlineType,
  ShadingType,
  Header,
  Footer,
  Math as MathElement,
  MathRun,
} from "docx";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("MarkdownToWord");

/**
 * 將Markdown轉換為Word文件並返回Blob物件
 * @param {string} markdownContent - Markdown格式的內容
 * @param {Object} options - 轉換選項
 * @returns {Promise<Blob>} - 返回包含Word文件的Blob物件
 */
export async function markdownToWord(markdownContent, options = {}) {
  // 預設文件標題
  const title = options.title || "匯出文件";

  // 解析Markdown內容，生成文件元件
  const docElements = await parseMarkdownToDocElements(markdownContent);

  // 建立Word文件
  const doc = new Document({
    title: title,
    description: "由Markdown匯出的文件",
    sections: [
      {
        properties: {},
        children: docElements,
      },
    ],
  });

  // 將文件轉換為Blob
  return await Packer.toBlob(doc);
}

/**
 * 解析Markdown內容，生成Word文件元素陣列
 * @param {string} markdown - Markdown內容
 * @returns {Promise<Array>} - 返回Word文件元素陣列
 */
async function parseMarkdownToDocElements(markdown) {
  // 將Markdown按行分割
  const lines = markdown.split("\n");
  const elements = [];

  // 狀態變數
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLanguage = "";
  let inBlockQuote = false;
  let blockQuoteLines = [];
  let inList = false;
  let listItems = [];
  let listType = ""; // 'ul' 或 'ol'
  let listLevel = 0;
  let inTable = false;
  let tableRows = [];
  let headerSeparatorLine = "";
  let inMathBlock = false; // 是否在數學公式塊中
  let mathBlockContent = []; // 數學公式塊內容

  // 逐行處理Markdown內容
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i < lines.length - 1 ? lines[i + 1] : "";

    // 處理程式碼塊
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        // 程式碼塊開始
        inCodeBlock = true;
        codeBlockContent = [];
        // 提取語言（去除前面可能的空格）
        codeBlockLanguage = line.trim().slice(3).trim();
      } else {
        // 程式碼塊結束
        inCodeBlock = false;
        // 檢查是否有內容，然後建立程式碼塊
        if (codeBlockContent.length > 0) {
          elements.push(...createCodeBlockAlternative(codeBlockContent.join("\n"), codeBlockLanguage));
        } else {
          // 空程式碼塊，新增一個佔位符
          elements.push(...createCodeBlockAlternative(" ", codeBlockLanguage));
        }
        codeBlockContent = [];
        codeBlockLanguage = "";
      }
      continue;
    }

    if (inCodeBlock) {
      // 收集程式碼塊內容 - 保持原始格式不變
      codeBlockContent.push(line);
      continue;
    }

    // 處理表格
    // 識別表格行（以|開頭或結尾的行，並且不是分隔行）
    const isTableRow = (line.trim().startsWith("|") || line.trim().endsWith("|")) && line.trim().length > 1;
    // 識別表格分隔行（由|-和:組成）
    const isTableSeparator =
      isTableRow &&
      line
        .replace(/\|/g, "")
        .trim()
        .split("")
        .every((char) => char === "-" || char === ":" || char === " ");

    if (isTableRow) {
      if (!inTable) {
        // 表格開始
        inTable = true;
        tableRows = [];
      }

      // 如果是表格分隔行，儲存用於確定對齊方式
      if (isTableSeparator) {
        headerSeparatorLine = line;
      } else {
        // 否則，新增為常規的表格行
        tableRows.push(line);
      }

      // 如果沒有下一行，或下一行不是表格行，則結束表格處理
      if ((!nextLine.trim().startsWith("|") && !nextLine.trim().endsWith("|")) || i === lines.length - 1) {
        inTable = false;

        // 如果有有效的表格行和分隔符，建立表格
        if (tableRows.length > 0 && headerSeparatorLine) {
          elements.push(createTable(tableRows, headerSeparatorLine));
          tableRows = [];
          headerSeparatorLine = "";
        } else {
          // 如果缺少分隔符，按普通段落處理
          for (const row of tableRows) {
            elements.push(createParagraph(row));
          }
          tableRows = [];
          headerSeparatorLine = "";
        }
      }
      continue;
    }

    // 處理引用塊
    if (line.startsWith(">")) {
      if (!inBlockQuote) {
        inBlockQuote = true;
        blockQuoteLines = [];
      }

      // 計算引用的巢狀級別
      let quoteLevel = 0;
      let trimmedLine = line;

      // 計算巢狀級別，每個 > 符號增加一級
      while (trimmedLine.startsWith(">")) {
        quoteLevel++;
        trimmedLine = trimmedLine.slice(1).trim();
      }

      // 新增內容，保留巢狀資訊
      blockQuoteLines.push({
        content: trimmedLine,
        level: quoteLevel,
      });

      // 如果下一行不是引用，或者已經是最後一行
      if (!nextLine.startsWith(">") || i === lines.length - 1) {
        inBlockQuote = false;
        elements.push(createBlockQuote(blockQuoteLines));
        blockQuoteLines = [];
      }
      continue;
    }

    // 處理列表
    if (line.match(/^(\s*)([-*+]|\d+\.)\s/)) {
      if (!inList) {
        inList = true;
        listItems = [];
        listType = line.match(/^\s*[-*+]\s/) ? "ul" : "ol";
      }

      // 識別普通列表項
      let isTask = false;
      let checked = false;

      // 檢查是否是任務列表項 - 匹配 [x], [X], [ ] 格式
      const taskMatch = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s(.*)/);

      if (taskMatch) {
        // 這是一個任務列表項
        const indent = taskMatch[1].length;
        const marker = taskMatch[3].toLowerCase(); // 'x' 或 ' '
        const content = taskMatch[4];
        const level = Math.floor(indent / 2); // 每兩個空格增加一個縮排級別

        checked = marker === "x";
        isTask = true;

        listItems.push({ content, level, isTask, checked });
      } else {
        // 普通列表項處理
        const match = line.match(/^(\s*)([-*+]|\d+\.)\s(.*)/);
        if (match) {
          const indent = match[1].length;
          const content = match[3];
          const level = Math.floor(indent / 2); // 每兩個空格增加一個縮排級別

          listItems.push({ content, level, isTask, checked });
        }
      }

      // 如果下一行不是列表，或者已經是最後一行
      if (nextLine.trim() === "" || !nextLine.match(/^(\s*)([-*+]|\d+\.)\s/) || i === lines.length - 1) {
        inList = false;
        elements.push(...createListItems(listItems, listType));
        listItems = [];
      }
      continue;
    }

    // 處理標題
    if (line.startsWith("#")) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        elements.push(createHeading(text, level));
      }
      continue;
    }

    // 處理水平線
    if (line.match(/^(\*{3,}|-{3,}|_{3,})$/)) {
      elements.push(createHorizontalRule());
      continue;
    }

    // 處理空行
    if (line.trim() === "") {
      // 如果不是連續空行，新增一個空段落
      if (elements.length > 0 && !(elements[elements.length - 1] instanceof Paragraph && elements[elements.length - 1].text === "")) {
        elements.push(new Paragraph({}));
      }
      continue;
    }

    // 處理數學公式塊 (獨立的$$行)
    if (line.trim() === "$$") {
      if (!inMathBlock) {
        // 數學公式塊開始
        inMathBlock = true;
        mathBlockContent = [];
      } else {
        // 數學公式塊結束
        inMathBlock = false;
        // 合併公式內容並建立公式塊
        if (mathBlockContent.length > 0) {
          const formula = mathBlockContent.join("\n").trim();
          const mathParagraph = new Paragraph({
            children: [createMathEquation(formula, true)],
            alignment: AlignmentType.CENTER,
            spacing: {
              before: 240,
              after: 240,
            },
          });
          elements.push(mathParagraph);
        } else {
          // 空公式塊，新增一個佔位符
          elements.push(new Paragraph({}));
        }
        mathBlockContent = [];
      }
      continue;
    }

    if (inMathBlock) {
      // 收集數學公式塊內容
      mathBlockContent.push(line);
      continue;
    }

    // 處理單行塊級數學公式 ($$...$$ 格式)
    if (line.trim().startsWith("$$") && line.trim().endsWith("$$") && line.trim() !== "$$") {
      // 提取公式內容，去除首尾的$$
      const formula = line.trim().slice(2, -2).trim();
      if (formula) {
        // 建立數學公式段落
        const mathParagraph = new Paragraph({
          children: [createMathEquation(formula, true)],
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 240,
            after: 240,
          },
        });
        elements.push(mathParagraph);
      } else {
        // 空公式，新增一個佔位符
        elements.push(new Paragraph({}));
      }
      continue;
    }

    // 處理普通段落
    elements.push(createParagraph(line));
  }

  return elements;
}

/**
 * 建立標題
 * @param {string} text - 標題文字
 * @param {number} level - 標題級別 (1-6)
 * @returns {Paragraph} - 標題段落
 */
function createHeading(text, level) {
  let headingLevel;

  switch (level) {
    case 1:
      headingLevel = HeadingLevel.HEADING_1;
      break;
    case 2:
      headingLevel = HeadingLevel.HEADING_2;
      break;
    case 3:
      headingLevel = HeadingLevel.HEADING_3;
      break;
    case 4:
      headingLevel = HeadingLevel.HEADING_4;
      break;
    case 5:
      headingLevel = HeadingLevel.HEADING_5;
      break;
    case 6:
      headingLevel = HeadingLevel.HEADING_6;
      break;
    default:
      headingLevel = HeadingLevel.HEADING_1;
  }

  return new Paragraph({
    text: text,
    heading: headingLevel,
  });
}

/**
 * 建立段落，處理內聯樣式如粗體、斜體、連結
 * @param {string} text - 段落文字
 * @returns {Paragraph} - 格式化的段落
 */
function createParagraph(text) {
  const children = [];

  // 處理文字中的內聯樣式
  let remainingText = text;
  let position = 0;

  // 查詢Markdown內聯樣式
  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, type: "bold" },
    { regex: /\*(.+?)\*/g, type: "italic" },
    { regex: /_(.+?)_/g, type: "italic" },
    { regex: /~~(.+?)~~/g, type: "strikethrough" },
    { regex: /`(.+?)`/g, type: "code" },
    { regex: /\[(.+?)\]\((.+?)\)/g, type: "link" },
    { regex: /!\[(.+?)\]\((.+?)\)/g, type: "image" },
    { regex: /\$(.+?)\$/g, type: "math" },
  ];

  // 用於臨時儲存所有匹配項
  const matches = [];

  // 找出所有匹配項
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        innerContent: match[1],
        type: pattern.type,
        url: pattern.type === "link" || pattern.type === "image" ? match[2] : null,
      });
    }
  });

  // 按開始位置排序匹配項
  matches.sort((a, b) => a.start - b.start);

  // 檢查重疊並拆分匹配項
  const cleanMatches = [];
  for (let i = 0; i < matches.length; i++) {
    let current = matches[i];
    let isOverlapping = false;

    for (let j = 0; j < cleanMatches.length; j++) {
      const existing = cleanMatches[j];

      // 檢查是否重疊
      if (!(current.end <= existing.start || current.start >= existing.end)) {
        isOverlapping = true;
        break;
      }
    }

    if (!isOverlapping) {
      cleanMatches.push(current);
    }
  }

  // 再次按開始位置排序
  cleanMatches.sort((a, b) => a.start - b.start);

  // 處理普通文字和匹配項
  let lastEnd = 0;

  for (const match of cleanMatches) {
    // 新增匹配前的普通文字
    if (match.start > lastEnd) {
      children.push(
        new TextRun({
          text: text.substring(lastEnd, match.start),
        })
      );
    }

    // 新增特殊格式文字
    switch (match.type) {
      case "bold":
        children.push(
          new TextRun({
            text: match.innerContent,
            bold: true,
          })
        );
        break;
      case "italic":
        children.push(
          new TextRun({
            text: match.innerContent,
            italics: true,
          })
        );
        break;
      case "strikethrough":
        children.push(
          new TextRun({
            text: match.innerContent,
            strike: true,
          })
        );
        break;
      case "code":
        children.push(
          new TextRun({
            text: match.innerContent,
            font: "Consolas, 'Courier New', monospace",
            size: 20, // 10pt
            color: "7A3E9D", // 紫色，常用於程式碼字元
            shading: {
              type: ShadingType.SOLID,
              color: "F5F5F5", // 淺灰色背景
            },
          })
        );
        break;
      case "math":
        // 處理行內數學公式
        children.push(createMathEquation(match.innerContent, false));
        break;
      case "link":
        children.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: match.innerContent,
                style: "Hyperlink",
                color: "0000FF",
                underline: {
                  type: UnderlineType.SINGLE,
                },
              }),
            ],
            link: match.url,
          })
        );
        break;
      case "image":
        // 圖片需要特殊處理，因為無法直接在TextRun中使用
        // 這裡只新增一個佔位符，實際圖片處理需要在上層進行
        children.push(
          new TextRun({
            text: `[圖片: ${match.innerContent}]`,
            italics: true,
          })
        );
        break;
    }

    lastEnd = match.end;
  }

  // 新增剩餘的普通文字
  if (lastEnd < text.length) {
    children.push(
      new TextRun({
        text: text.substring(lastEnd),
      })
    );
  }

  // 如果沒有特殊格式，直接返回普通文字段落
  if (children.length === 0) {
    return new Paragraph({
      children: [
        new TextRun({
          text: text,
        }),
      ],
    });
  }

  return new Paragraph({
    children: children,
  });
}

/**
 * 建立程式碼塊的備選實現 - 使用多行段落表示程式碼塊
 * 此函式解決了原始createCodeBlock函式中程式碼行被擠在一起的問題。
 * 透過為每行程式碼建立獨立的段落，確保在Word文件中正確保留格式和換行。
 *
 * 實現原理：
 * 1. 不同於原始實現在單個段落中使用TextRun的break屬性
 * 2. 此實現為每行程式碼建立單獨的段落，可以更精確地控制每行的格式
 * 3. 透過精細控制段落間距和邊框，使多個段落在視覺上形成一個整體程式碼塊
 * 4. 對前導空格使用非斷行空格，確保程式碼縮排正確顯示
 *
 * @param {string} code - 程式碼內容
 * @param {string} language - 程式語言
 * @returns {Array<Paragraph>} - 格式化的程式碼段落陣列
 */
function createCodeBlockAlternative(code, language) {
  // 標準化語言名稱
  const normalizedLanguage = language ? language.toLowerCase() : "";

  // 將程式碼分割為行
  const codeLines = code.split("\n");

  // 確定背景顏色 - 根據不同語言可以使用不同顏色
  let backgroundColor = "F5F5F5"; // 預設淺灰色背景
  if (["javascript", "js", "typescript", "ts"].includes(normalizedLanguage)) {
    backgroundColor = "FFFDF0";
  } else if (["html", "xml", "svg"].includes(normalizedLanguage)) {
    backgroundColor = "FFF0F0";
  } else if (["css", "scss", "sass", "less"].includes(normalizedLanguage)) {
    backgroundColor = "F0FFFF";
  } else if (["python", "py"].includes(normalizedLanguage)) {
    backgroundColor = "F0F8FF";
  }

  // 準備程式碼樣式
  const codeStyle = {
    font: "Consolas, 'Courier New', monospace",
    size: 20,
    color: "333333",
  };

  // 準備要返回的段落陣列
  const paragraphs = [];

  // 建立通用段落屬性（所有程式碼行共享的屬性）
  const paragraphProperties = {
    shading: {
      type: ShadingType.SOLID,
      color: backgroundColor,
    },
    spacing: {
      before: 0,
      after: 0,
      line: 240, // 標準行距
      lineRule: "exact",
    },
    border: {
      left: { style: BorderStyle.SINGLE, size: 3, color: "A0A0A0" },
    },
    indent: {
      left: 360,
    },
  };

  // 新增語言標題段落（如果有）
  if (language) {
    const displayLanguage = language.toUpperCase();
    paragraphs.push(
      new Paragraph({
        ...paragraphProperties,
        border: {
          ...paragraphProperties.border,
          top: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
        },
        spacing: {
          ...paragraphProperties.spacing,
          before: 240, // 第一行前額外空間
        },
        children: [
          new TextRun({
            text: displayLanguage,
            bold: true,
            color: "606060",
            font: codeStyle.font,
            size: codeStyle.size,
          }),
        ],
      })
    );
  }

  // 處理每一行程式碼
  codeLines.forEach((line, index) => {
    // 處理前導空格
    let formattedLine = "";
    let nonSpaceFound = false;

    // 逐字元處理，確保前導空格被替換為非斷行空格
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (!nonSpaceFound && char === " ") {
        formattedLine += "\u00A0"; // 非斷行空格
      } else {
        nonSpaceFound = true;
        formattedLine += char;
      }
    }

    // 如果是空行，確保至少有一個非斷行空格保持行高
    if (formattedLine === "") {
      formattedLine = "\u00A0";
    }

    // 建立當前行的段落
    const isLastLine = index === codeLines.length - 1;
    const isFirstCode = index === 0;

    paragraphs.push(
      new Paragraph({
        ...paragraphProperties,
        // 邊框處理 - 為首尾行新增特殊邊框，所有行都有左右邊框
        border: {
          ...paragraphProperties.border,
          // 頂部邊框只在沒有語言標題或第一行時顯示
          ...(isFirstCode && !language ? { top: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" } } : {}),
          // 底部邊框只在最後一行顯示
          ...(isLastLine ? { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" } } : {}),
          // 所有行都有右邊框
          right: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
        },
        // 只在首尾行新增額外間距
        spacing: {
          ...paragraphProperties.spacing,
          before: isFirstCode && !language ? 240 : 0, // 首行額外上間距（如果沒有語言標題）
          after: isLastLine ? 240 : 0, // 尾行額外下間距
        },
        children: [
          new TextRun({
            text: formattedLine,
            font: codeStyle.font,
            size: codeStyle.size,
            color: codeStyle.color,
            noProof: true,
          }),
        ],
      })
    );
  });

  return paragraphs;
}

/**
 * 建立塊引用
 * @param {Array} quoteLines - 引用內容陣列，每項包含內容和巢狀級別
 * @returns {Paragraph} - 格式化的引用段落
 */
function createBlockQuote(quoteLines) {
  // 處理巢狀引用
  let processedText = "";
  let currentLevel = 1;

  // 處理每一行，根據巢狀級別新增縮排和引用符號
  quoteLines.forEach((line, index) => {
    // 根據巢狀級別新增額外縮排和引用符號
    const indentPrefix = "    ".repeat(line.level - 1); // 每增加一級縮排4個空格
    const quotePrefix = line.level > 1 ? "» " : ""; // 巢狀引用使用特殊符號

    processedText += indentPrefix + quotePrefix + line.content;

    // 如果不是最後一行，新增換行符
    if (index < quoteLines.length - 1) {
      processedText += "\n";
    }
  });

  // 找到最大巢狀級別，用於確定左邊框顏色
  const maxLevel = Math.max(...quoteLines.map((line) => line.level));

  // 為巢狀級別選擇不同的邊框顏色
  let borderColor = "CCCCCC"; // 預設顏色
  if (maxLevel > 1) {
    // 根據巢狀深度，使邊框顏色更深
    const colorDepth = Math.min(maxLevel - 1, 3); // 最多支援4級巢狀顏色變化
    const colors = ["CCCCCC", "AAAAAA", "888888", "666666"];
    borderColor = colors[colorDepth];
  }

  return new Paragraph({
    indent: {
      left: 720, // 基礎左側縮排
    },
    border: {
      left: { style: BorderStyle.SINGLE, size: 3, color: borderColor },
    },
    children: [
      new TextRun({
        text: processedText,
        italics: true,
        color: "666666",
      }),
    ],
  });
}

/**
 * 建立列表項
 * @param {Array} items - 列表項陣列，每項包含內容和縮排級別，以及任務相關屬性
 * @param {string} type - 列表型別 ('ul'或'ol')
 * @returns {Array<Paragraph>} - 格式化的列表段落陣列
 */
function createListItems(items, type) {
  return items.map((item, index) => {
    const bulletChar = type === "ul" ? "•" : `${index + 1}.`;

    // 定義段落子元素
    const children = [];

    // 如果是任務列表項，新增任務核取方塊
    if (item.isTask) {
      const checkboxChar = item.checked ? "☑" : "☐";

      // 新增核取方塊
      children.push(
        new TextRun({
          text: checkboxChar + " ",
          bold: true,
        })
      );

      // 如果已完成，新增刪除線效果
      if (item.checked) {
        children.push(
          new TextRun({
            text: item.content,
            strike: true,
            color: "909090", // 灰色文字表示已完成
          })
        );
      } else {
        children.push(
          new TextRun({
            text: item.content,
          })
        );
      }
    } else {
      // 普通列表項
      children.push(
        new TextRun({
          text: item.content,
        })
      );
    }

    return new Paragraph({
      indent: {
        left: item.level * 720 + 720, // 根據級別增加縮排
      },
      bullet: {
        level: item.level,
      },
      children: children,
    });
  });
}

/**
 * 建立水平分隔線
 * @returns {Paragraph} - 格式化的水平線段落
 */
function createHorizontalRule() {
  return new Paragraph({
    thematicBreak: true,
    spacing: {
      before: 240,
      after: 240,
    },
  });
}

/**
 * 處理圖片轉換
 * 注意：此功能受限於docx庫和瀏覽器API的限制
 * @param {string} imageUrl - 圖片URL
 * @param {string} altText - 替代文字
 * @returns {Promise<ImageRun>} - 圖片物件
 */
async function processImage(imageUrl, altText) {
  try {
    // 獲取圖片資料
    const response = await fetch(imageUrl);
    const blob = await response.blob();

    // 將Blob轉換為ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();

    // 建立圖片物件
    return new ImageRun({
      data: arrayBuffer,
      transformation: {
        width: 400, // 設定預設寬度
        height: 300, // 設定預設高度
      },
      altText: altText,
    });
  } catch (error) {
    log.error("處理圖片時出錯:", error);
    // 返回一個文字作為替代
    return new TextRun({
      text: `[無法載入圖片: ${altText}]`,
      italics: true,
    });
  }
}

/**
 * 建立表格
 * @param {Array<string>} rows - 表格行陣列
 * @param {string} separatorLine - 表格分隔行，用於確定對齊方式
 * @returns {Table} - Word表格物件
 */
function createTable(rows, separatorLine) {
  // 解析表格行
  const tableRows = parseTableRows(rows);
  // 獲取列對齊資訊
  const alignments = getColumnAlignments(separatorLine);

  // 建立表格
  const table = new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
    },
    rows: tableRows.map((row, rowIndex) => {
      // 建立表格行
      return new TableRow({
        tableHeader: rowIndex === 0, // 第一行是表頭
        children: row.map((cell, colIndex) => {
          // 獲取單元格對齊方式
          const alignment = colIndex < alignments.length ? alignments[colIndex] : AlignmentType.LEFT;

          // 建立表格單元格
          return new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cell,
                    bold: rowIndex === 0, // 表頭加粗
                  }),
                ],
                alignment: alignment, // 應用對齊方式
              }),
            ],
            shading:
              rowIndex === 0
                ? {
                    fill: "F2F2F2", // 表頭背景色
                    val: "clear",
                    color: "auto",
                  }
                : undefined,
            margins: {
              top: 100,
              bottom: 100,
              left: 150,
              right: 150,
            },
            verticalAlign: VerticalAlign.CENTER,
          });
        }),
      });
    }),
  });

  return table;
}

/**
 * 解析表格行
 * @param {Array<string>} rows - 表格行陣列
 * @returns {Array<Array<string>>} - 二維陣列，包含解析後的單元格內容
 */
function parseTableRows(rows) {
  // 處理每一行
  const parsedRows = rows.map((row) => {
    // 移除行首尾的|，然後按|分割
    let cells = row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|");

    // 處理每個單元格
    return cells.map((cell) => cell.trim());
  });

  // 確保所有行的列數相同（使用最大列數）
  const maxColumns = Math.max(...parsedRows.map((row) => row.length));

  // 填充缺少的單元格
  return parsedRows.map((row) => {
    // 如果當前行的列數小於最大列數，補充空單元格
    if (row.length < maxColumns) {
      const paddedRow = [...row];
      while (paddedRow.length < maxColumns) {
        paddedRow.push("");
      }
      return paddedRow;
    }
    return row;
  });
}

/**
 * 獲取列對齊資訊
 * @param {string} separatorLine - 表格分隔行
 * @returns {Array<string>} - 每列的對齊方式
 */
function getColumnAlignments(separatorLine) {
  // 移除行首尾的|，然後按|分割
  const separators = separatorLine
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|");

  return separators.map((separator) => {
    separator = separator.trim();

    // 檢查對齊標記
    if (separator.startsWith(":") && separator.endsWith(":")) {
      return AlignmentType.CENTER;
    } else if (separator.endsWith(":")) {
      return AlignmentType.RIGHT;
    } else {
      return AlignmentType.LEFT;
    }
  });
}

/**
 * 建立數學公式
 * @param {string} formula - LaTeX格式的數學公式
 * @param {boolean} isBlock - 是否為塊級公式
 * @returns {MathElement} - Word數學公式物件
 */
function createMathEquation(formula, isBlock = false) {
  return new MathElement({
    children: [new MathRun(formula)],
    // 塊級公式居中顯示
    alignment: isBlock ? AlignmentType.CENTER : AlignmentType.LEFT,
  });
}

export default markdownToWord;
