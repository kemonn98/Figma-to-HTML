type ExportResult = {
  html: string;
  css: string;
};

type ExportMessage =
  | { type: 'export' }
  | { type: 'cancel' };

type ExportNode = {
  html: string;
};

type ExportContext = {
  nameCounts: Map<string, number>;
  styleMap: Map<string, string>;
  styleCss: string[];
};

figma.showUI(__html__);

const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (match) => {
    const table: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return table[match];
  });

const mapPrimaryAxis = (val: FrameNode['primaryAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'SPACE_BETWEEN':
      return 'space-between';
    default:
      return 'flex-start';
  }
};

const mapCounterAxis = (val: FrameNode['counterAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'BASELINE':
      return 'baseline';
    default:
      return 'stretch';
  }
};

const getSolidFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((paint) => paint.type === 'SOLID') as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${a})`;
};

const formatLineHeight = (lineHeight: TextNode['lineHeight']) => {
  if (lineHeight === figma.mixed) return 'normal';
  if (lineHeight.unit === 'AUTO') return 'normal';
  if (lineHeight.unit === 'PERCENT') return `${lineHeight.value}%`;
  return `${lineHeight.value}px`;
};

const formatLetterSpacing = (letterSpacing: TextNode['letterSpacing']) => {
  if (letterSpacing === figma.mixed) return 'normal';
  if (letterSpacing.unit === 'PERCENT') return `${letterSpacing.value}%`;
  return `${letterSpacing.value}px`;
};

const formatFontFamily = (fontName: TextNode['fontName']) => {
  if (fontName === figma.mixed) return 'inherit';
  return `"${fontName.family}"`;
};

const getUniqueClassName = (base: string, context: ExportContext) => {
  const nextCount = (context.nameCounts.get(base) ?? 0) + 1;
  context.nameCounts.set(base, nextCount);
  return nextCount === 1 ? base : `${base}-${nextCount}`;
};

const getClassForStyle = (
  baseName: string,
  lines: string[],
  context: ExportContext
) => {
  const signature = lines.join('\n');
  const existing = context.styleMap.get(signature);
  if (existing) return existing;

  const className = getUniqueClassName(baseName, context);
  context.styleMap.set(signature, className);
  context.styleCss.push(`.${className} {\n${lines.join('\n')}\n}\n\n`);
  return className;
};

const nodeToHtmlCss = (node: SceneNode, context: ExportContext): ExportNode => {
  const baseName =
    sanitizeName(node.name) || `node-${node.id.replace(':', '-')}`;
  let className = baseName;
  let html = '';

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    const styleLines: string[] = [];
    if (frame.layoutMode !== 'NONE') {
      styleLines.push('  display: flex;');
      styleLines.push(
        `  flex-direction: ${
          frame.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
        };`
      );
      styleLines.push(`  gap: ${frame.itemSpacing}px;`);
      styleLines.push(
        `  padding: ${frame.paddingTop}px ${frame.paddingRight}px ${frame.paddingBottom}px ${frame.paddingLeft}px;`
      );
      styleLines.push(
        `  justify-content: ${mapPrimaryAxis(frame.primaryAxisAlignItems)};`
      );
      styleLines.push(
        `  align-items: ${mapCounterAxis(frame.counterAxisAlignItems)};`
      );
    }

    const fill = getSolidFill(frame);
    if (fill) styleLines.push(`  background: ${fill};`);
    className = getClassForStyle(baseName, styleLines, context);
    html += `<div class="${className}">`;

    for (const child of frame.children) {
      const childExport = nodeToHtmlCss(child, context);
      html += childExport.html;
    }

    html += `</div>`;
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    const styleLines: string[] = [];
    styleLines.push(`  font-size: ${String(text.fontSize)}px;`);
    styleLines.push(`  line-height: ${formatLineHeight(text.lineHeight)};`);
    styleLines.push(
      `  letter-spacing: ${formatLetterSpacing(text.letterSpacing)};`
    );
    styleLines.push(`  font-family: ${formatFontFamily(text.fontName)};`);
    styleLines.push(
      `  text-align: ${text.textAlignHorizontal.toLowerCase()};`
    );
    if (text.layoutGrow) styleLines.push(`  flex: ${text.layoutGrow};`);
    className = getClassForStyle(baseName, styleLines, context);
    html += `<p class="${className}">${escapeHtml(text.characters)}</p>\n`;
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    const styleLines: string[] = [];
    styleLines.push(`  width: ${rect.width}px;`);
    styleLines.push(`  height: ${rect.height}px;`);
    const fill = getSolidFill(rect);
    if (fill) styleLines.push(`  background: ${fill};`);
    if (rect.cornerRadius !== figma.mixed) {
      styleLines.push(`  border-radius: ${rect.cornerRadius}px;`);
    }
    if (rect.layoutGrow) styleLines.push(`  flex: ${rect.layoutGrow};`);
    className = getClassForStyle(baseName, styleLines, context);
    html += `<div class="${className}"></div>\n`;
  }

  return { html };
};

const exportSelection = (): ExportResult => {
  const selection = figma.currentPage.selection[0];
  if (!selection || selection.type !== 'FRAME') {
    throw new Error('Select a frame with auto-layout.');
  }

  const frame = selection as FrameNode;
  if (frame.layoutMode === 'NONE') {
    throw new Error('Selected frame must use auto-layout.');
  }

  const context: ExportContext = {
    nameCounts: new Map<string, number>(),
    styleMap: new Map<string, string>(),
    styleCss: [],
  };

  const { html } = nodeToHtmlCss(frame, context);
  const css = context.styleCss.join('');
  return { html, css };
};

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'export') {
    try {
      const { html, css } = exportSelection();
      figma.ui.postMessage({ type: 'export-result', html, css });
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Export failed.',
      });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
