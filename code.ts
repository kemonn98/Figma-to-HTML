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
  utilityClasses: Set<string>;
  styleEntries: {
    className: string;
    baseName: string;
    suffix: number;
    cssText: string;
  }[];
};

figma.showUI(__html__);
figma.ui.resize(370, 500);

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

const getSolidTextFill = (text: TextNode) => {
  if (text.fills === figma.mixed) return null;
  const fill = text.fills.find((paint) => paint.type === 'SOLID') as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${a})`;
};

const getSolidFillFromPaints = (paints: ReadonlyArray<Paint>) => {
  const fill = paints.find((paint) => paint.type === 'SOLID') as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${a})`;
};

const isVectorNode = (node: SceneNode) =>
  node.type === 'VECTOR' ||
  node.type === 'LINE' ||
  node.type === 'ELLIPSE' ||
  node.type === 'POLYGON' ||
  node.type === 'STAR' ||
  node.type === 'BOOLEAN_OPERATION';

const decodeSvgBytes = (svgBytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < svgBytes.length; i += chunkSize) {
    const chunk = svgBytes.subarray(i, i + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return result;
};

const hasImageFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return node.fills.some((paint) => paint.type === 'IMAGE');
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

const getFontWeightFromStyle = (fontName: TextNode['fontName']) => {
  if (fontName === figma.mixed) return null;
  const style = fontName.style.toLowerCase();
  if (style.includes('thin')) return 100;
  if (style.includes('extra light') || style.includes('ultra light')) return 200;
  if (style.includes('light')) return 300;
  if (style.includes('regular') || style.includes('normal')) return 400;
  if (style.includes('medium')) return 500;
  if (style.includes('semi bold') || style.includes('demi bold')) return 600;
  if (style.includes('bold')) return 700;
  if (style.includes('extra bold') || style.includes('ultra bold')) return 800;
  if (style.includes('black') || style.includes('heavy')) return 900;
  return null;
};

const getUniqueClassName = (base: string, context: ExportContext) => {
  const nextCount = (context.nameCounts.get(base) ?? 0) + 1;
  context.nameCounts.set(base, nextCount);
  return nextCount === 1 ? base : `${base}-${nextCount}`;
};

const getBaseNameAndSuffix = (className: string) => {
  const match = className.match(/^(.*?)-(\d+)$/);
  if (match) {
    return { baseName: match[1], suffix: Number(match[2]) };
  }
  return { baseName: className, suffix: 0 };
};

const registerUtilityClass = (
  className: string,
  lines: string[],
  context: ExportContext
) => {
  if (context.utilityClasses.has(className)) return;
  const { baseName, suffix } = getBaseNameAndSuffix(className);
  context.utilityClasses.add(className);
  context.styleEntries.push({
    className,
    baseName,
    suffix,
    cssText: `.${className} {\n${lines.join('\n')}\n}\n\n`,
  });
};

const formatNegativeClassValue = (value: number) => {
  const absValue = Math.round(Math.abs(value));
  return value < 0 ? `neg-${absValue}` : `${absValue}`;
};

const getCornerRadiusStyle = (node: SceneNode) => {
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed) {
    return `border-radius: ${node.cornerRadius}px`;
  }
  return null;
};

const registerSizingUtilities = (
  node: SceneNode,
  parentLayoutMode: FrameNode['layoutMode'] | null,
  context: ExportContext
): { classes: string[]; styles: string[] } => {
  const classes: string[] = [];
  const styles: string[] = [];
  const sizingHorizontal =
    'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : null;
  const sizingVertical =
    'layoutSizingVertical' in node ? node.layoutSizingVertical : null;
  const hasLayoutSizing =
    sizingHorizontal !== null || sizingVertical !== null;
  const isAbsolute =
    parentLayoutMode !== null &&
    'layoutPositioning' in node &&
    node.layoutPositioning === 'ABSOLUTE';
  const layoutGrow =
    'layoutGrow' in node && typeof node.layoutGrow === 'number'
      ? node.layoutGrow
      : 0;
  const layoutAlign =
    'layoutAlign' in node ? node.layoutAlign : null;

  if (parentLayoutMode && layoutGrow > 0 && !isAbsolute) {
    registerUtilityClass('flex-1', ['  flex: 1;'], context);
    classes.push('flex-1');
  }

  if (parentLayoutMode && layoutAlign === 'STRETCH' && !isAbsolute) {
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    classes.push('self-stretch');
  }

  if (hasLayoutSizing && parentLayoutMode && !isAbsolute) {
    if (sizingHorizontal === 'FILL') {
      if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        classes.push('flex-1');
      } else if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        classes.push('self-stretch');
      }
    }
    if (sizingVertical === 'FILL') {
      if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        classes.push('flex-1');
      } else if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        classes.push('self-stretch');
      }
    }
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${text.width}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${text.height}px`);
      }
    } else {
      if (text.textAutoResize === 'NONE') {
        styles.push(`width: ${text.width}px`);
        styles.push(`height: ${text.height}px`);
      } else if (text.textAutoResize === 'HEIGHT') {
        styles.push(`width: ${text.width}px`);
      }
    }
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${rect.width}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${rect.height}px`);
      }
    } else {
      const primaryFill =
        parentLayoutMode === 'HORIZONTAL'
          ? layoutGrow > 0
          : parentLayoutMode === 'VERTICAL'
          ? layoutGrow > 0
          : false;
      const counterFill = layoutAlign === 'STRETCH';

      if (!primaryFill) {
        styles.push(`width: ${rect.width}px`);
      }
      if (!counterFill) {
        styles.push(`height: ${rect.height}px`);
      }
    }
  }

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${frame.width}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${frame.height}px`);
      }
    } else {
      if (frame.layoutMode === 'NONE') {
        styles.push(`width: ${frame.width}px`);
        styles.push(`height: ${frame.height}px`);
        return { classes, styles };
      }

      const primaryIsWidth = frame.layoutMode === 'HORIZONTAL';
      const primaryFixed = frame.primaryAxisSizingMode === 'FIXED';
      const counterFixed = frame.counterAxisSizingMode === 'FIXED';
      const primaryFill =
        parentLayoutMode && layoutGrow > 0;
      const counterFill = layoutAlign === 'STRETCH';

      if (primaryFixed && !primaryFill) {
        styles.push(
          `${primaryIsWidth ? 'width' : 'height'}: ${
            primaryIsWidth ? frame.width : frame.height
          }px`
        );
      }
      if (counterFixed && !counterFill) {
        styles.push(
          `${primaryIsWidth ? 'height' : 'width'}: ${
            primaryIsWidth ? frame.height : frame.width
          }px`
        );
      }
    }
  }

  return { classes, styles };
};

const registerFlexUtilities = (
  frame: FrameNode,
  context: ExportContext
): string[] => {
  const classes: string[] = [];
  registerUtilityClass('flex', ['  display: flex;'], context);
  classes.push('flex');

  const directionClass = frame.layoutMode === 'HORIZONTAL' ? 'flex-row' : 'flex-col';
  registerUtilityClass(
    directionClass,
    [`  flex-direction: ${frame.layoutMode === 'HORIZONTAL' ? 'row' : 'column'};`],
    context
  );
  classes.push(directionClass);

  const isAutoGap =
    frame.primaryAxisAlignItems === 'SPACE_BETWEEN' && frame.itemSpacing === 0;
  if (!isAutoGap) {
    const gapValue = formatNegativeClassValue(frame.itemSpacing);
    const gapClass = `gap-${gapValue}`;
    registerUtilityClass(gapClass, [`  gap: ${frame.itemSpacing}px;`], context);
    classes.push(gapClass);
  }

  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = frame;
  const allSame =
    paddingTop === paddingRight &&
    paddingTop === paddingBottom &&
    paddingTop === paddingLeft;

  if (allSame) {
    const padValue = formatNegativeClassValue(paddingTop);
    const padClass = `p-${padValue}`;
    registerUtilityClass(
      padClass,
      [`  padding: ${paddingTop}px;`],
      context
    );
    classes.push(padClass);
  } else {
    if (paddingTop !== 0) {
      const value = formatNegativeClassValue(paddingTop);
      const className = `pt-${value}`;
      registerUtilityClass(className, [`  padding-top: ${paddingTop}px;`], context);
      classes.push(className);
    }
    if (paddingRight !== 0) {
      const value = formatNegativeClassValue(paddingRight);
      const className = `pr-${value}`;
      registerUtilityClass(
        className,
        [`  padding-right: ${paddingRight}px;`],
        context
      );
      classes.push(className);
    }
    if (paddingBottom !== 0) {
      const value = formatNegativeClassValue(paddingBottom);
      const className = `pb-${value}`;
      registerUtilityClass(
        className,
        [`  padding-bottom: ${paddingBottom}px;`],
        context
      );
      classes.push(className);
    }
    if (paddingLeft !== 0) {
      const value = formatNegativeClassValue(paddingLeft);
      const className = `pl-${value}`;
      registerUtilityClass(
        className,
        [`  padding-left: ${paddingLeft}px;`],
        context
      );
      classes.push(className);
    }
  }

  const justifyClass = (() => {
    switch (frame.primaryAxisAlignItems) {
      case 'MIN':
        return 'justify-start';
      case 'MAX':
        return 'justify-end';
      case 'CENTER':
        return 'justify-center';
      case 'SPACE_BETWEEN':
        return 'justify-between';
      default:
        return 'justify-start';
    }
  })();
  registerUtilityClass(
    justifyClass,
    [`  justify-content: ${mapPrimaryAxis(frame.primaryAxisAlignItems)};`],
    context
  );
  classes.push(justifyClass);

  const itemsClass = (() => {
    switch (frame.counterAxisAlignItems) {
      case 'MIN':
        return 'items-start';
      case 'MAX':
        return 'items-end';
      case 'CENTER':
        return 'items-center';
      case 'BASELINE':
        return 'items-baseline';
      default:
        return 'items-stretch';
    }
  })();
  registerUtilityClass(
    itemsClass,
    [`  align-items: ${mapCounterAxis(frame.counterAxisAlignItems)};`],
    context
  );
  classes.push(itemsClass);

  return classes;
};

const getTextAlignClass = (align: TextNode['textAlignHorizontal']) => {
  switch (align) {
    case 'LEFT':
      return 'text-left';
    case 'CENTER':
      return 'text-center';
    case 'RIGHT':
      return 'text-right';
    case 'JUSTIFIED':
      return 'text-justify';
    default:
      return null;
  }
};

const isAbsoluteChild = (node: SceneNode, parentFrame: FrameNode | null) =>
  !!parentFrame &&
  'layoutPositioning' in node &&
  node.layoutPositioning === 'ABSOLUTE';

const getAbsolutePositionStyles = (
  node: SceneNode,
  parentFrame: FrameNode | null
) => {
  const styles: string[] = [];
  if (
    !parentFrame ||
    !('layoutPositioning' in node) ||
    node.layoutPositioning !== 'ABSOLUTE'
  ) {
    return styles;
  }

  styles.push('position: absolute');
  const zIndex = parentFrame.children.indexOf(node);
  if (zIndex >= 0) {
    styles.push(`z-index: ${zIndex}`);
  }
  const constraints =
    'constraints' in node
      ? node.constraints
      : { horizontal: 'MIN', vertical: 'MIN' };

  const left = node.x;
  const top = node.y;
  const right = parentFrame.width - (node.x + node.width);
  const bottom = parentFrame.height - (node.y + node.height);

  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = node.x + node.width / 2;
      const offsetX = centerX - parentFrame.width / 2;
      styles.push('left: 50%');
      transformParts.push('translateX(-50%)');
      if (Math.round(offsetX) !== 0) {
        transformParts.push(`translateX(${offsetX}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`left: ${left}px`);
      styles.push(`right: ${right}px`);
      break;
    default:
      styles.push(`left: ${left}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = node.y + node.height / 2;
      const offsetY = centerY - parentFrame.height / 2;
      styles.push('top: 50%');
      transformParts.push('translateY(-50%)');
      if (Math.round(offsetY) !== 0) {
        transformParts.push(`translateY(${offsetY}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`top: ${top}px`);
      styles.push(`bottom: ${bottom}px`);
      break;
    default:
      styles.push(`top: ${top}px`);
      break;
  }

  if (node.rotation !== 0) {
    transformParts.push(`rotate(${node.rotation}deg)`);
  }

  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }

  return styles;
};

const buildInlineStyle = (styles: string[]) => {
  if (styles.length === 0) return '';
  return ` style="${styles.join('; ')};"`;
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
  const suffixMatch = className.match(/-(\d+)$/);
  const suffix = suffixMatch ? Number(suffixMatch[1]) : 0;
  context.styleEntries.push({
    className,
    baseName,
    suffix,
    cssText: `.${className} {\n${lines.join('\n')}\n}\n\n`,
  });
  return className;
};

const nodeToHtmlCss = async (
  node: SceneNode,
  context: ExportContext,
  parentLayoutMode: FrameNode['layoutMode'] | null = null,
  parentFrame: FrameNode | null = null
): Promise<ExportNode> => {
  let baseName = sanitizeName(node.name) || `node-${node.id.replace(':', '-')}`;
  let className = baseName;
  let html = '';

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    const classes: string[] = [];
    if (frame.layoutMode !== 'NONE') {
      classes.push(...registerFlexUtilities(frame, context));
    }
    const sizing = registerSizingUtilities(frame, parentLayoutMode, context);
    classes.push(...sizing.classes);

    const styleLines: string[] = [];
    const fill = getSolidFill(frame);
    const inlineStyles = [...sizing.styles];
    const absoluteStyles = getAbsolutePositionStyles(frame, parentFrame);
    inlineStyles.push(...absoluteStyles);
    if (!isAbsoluteChild(frame, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      inlineStyles.push('z-index: 1');
    }
    if (fill) inlineStyles.push(`background: ${fill}`);
    if (!fill && hasImageFill(frame)) inlineStyles.push('background: #e5e7eb');
    const radius = getCornerRadiusStyle(frame);
    if (radius) inlineStyles.push(radius);
    if (frame.rotation !== 0 && absoluteStyles.length === 0) {
      inlineStyles.push(`transform: rotate(${frame.rotation}deg)`);
    }
    if (styleLines.length > 0) {
      className = getClassForStyle(baseName, styleLines, context);
      classes.push(className);
    }
    if (classes.length === 0) {
      classes.push(baseName);
    }
    if (
      frame.layoutMode !== 'NONE' &&
      frame.children.some(
        (child) =>
          'layoutPositioning' in child && child.layoutPositioning === 'ABSOLUTE'
      )
    ) {
      inlineStyles.push('position: relative');
    }
    const inlineStyle = buildInlineStyle(inlineStyles);
    html += `<div class="${classes.join(' ')}"${inlineStyle}>`;

    const childParentLayoutMode =
      frame.layoutMode === 'NONE' ? null : frame.layoutMode;
    const childParentFrame =
      frame.layoutMode === 'NONE' ? null : frame;
    for (const child of frame.children) {
      const childExport = await nodeToHtmlCss(
        child,
        context,
        childParentLayoutMode,
        childParentFrame
      );
      html += childExport.html;
    }

    html += `</div>`;
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    const classes: string[] = [];
    const inlineStyles: string[] = [];
    const fontSize = typeof text.fontSize === 'number' ? Math.round(text.fontSize) : null;
    if (fontSize) {
      const sizeClass = `text-${fontSize}`;
      registerUtilityClass(sizeClass, [`  font-size: ${fontSize}px;`], context);
      classes.push(sizeClass);
    }

    const fontWeight = getFontWeightFromStyle(text.fontName);
    if (fontWeight) {
      const weightClass = `font-${fontWeight}`;
      registerUtilityClass(weightClass, [`  font-weight: ${fontWeight};`], context);
      classes.push(weightClass);
    }

    if (text.lineHeight !== figma.mixed && text.lineHeight.unit !== 'AUTO') {
      const value = Math.round(text.lineHeight.value);
      const lineClass = `leading-${formatNegativeClassValue(value)}`;
      const unit = text.lineHeight.unit === 'PERCENT' ? '%' : 'px';
      registerUtilityClass(
        lineClass,
        [`  line-height: ${value}${unit};`],
        context
      );
      classes.push(lineClass);
    }

    if (text.letterSpacing !== figma.mixed) {
      const value = Math.round(text.letterSpacing.value);
      const trackingClass = `tracking-${formatNegativeClassValue(value)}`;
      const unit = text.letterSpacing.unit === 'PERCENT' ? '%' : 'px';
      registerUtilityClass(
        trackingClass,
        [`  letter-spacing: ${value}${unit};`],
        context
      );
      classes.push(trackingClass);
    }

    if (text.fontName !== figma.mixed) {
      const familyName = sanitizeName(text.fontName.family);
      if (familyName) {
        const familyClass = `fontfam-${familyName}`;
        registerUtilityClass(
          familyClass,
          [`  font-family: ${formatFontFamily(text.fontName)};`],
          context
        );
        classes.push(familyClass);
      }
    }

    const alignClass = getTextAlignClass(text.textAlignHorizontal);
    if (alignClass) {
      registerUtilityClass(
        alignClass,
        [`  text-align: ${text.textAlignHorizontal.toLowerCase()};`],
        context
      );
      classes.push(alignClass);
    }

    const sizing = registerSizingUtilities(text, parentLayoutMode, context);
    classes.push(...sizing.classes);
    inlineStyles.push(...sizing.styles);
    inlineStyles.push(...getAbsolutePositionStyles(text, parentFrame));
    if (!isAbsoluteChild(text, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      inlineStyles.push('z-index: 1');
    }
    let textContent = escapeHtml(text.characters);
    if (text.fills === figma.mixed) {
      try {
        const segments = text.getStyledTextSegments(['fills']);
        textContent = segments
          .map((segment) => {
            const paints = segment.fills as ReadonlyArray<Paint>;
            const segmentFill = Array.isArray(paints)
              ? getSolidFillFromPaints(paints)
              : null;
            const segmentText = escapeHtml(segment.characters);
            if (!segmentFill) return segmentText;
            return `<span style="color: ${segmentFill}">${segmentText}</span>`;
          })
          .join('');
      } catch {
        const textFill = getSolidTextFill(text);
        if (textFill) inlineStyles.push(`color: ${textFill}`);
      }
    } else {
      const textFill = getSolidTextFill(text);
      if (textFill) inlineStyles.push(`color: ${textFill}`);
    }
    if (text.rotation !== 0 && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${text.rotation}deg)`);
    }

    if (classes.length === 0) {
      registerUtilityClass('text', [], context);
      classes.push('text');
    }
    const inlineStyle = buildInlineStyle(inlineStyles);
    html += `<p class="${classes.join(' ')}"${inlineStyle}>${textContent}</p>\n`;
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    const classes: string[] = [];
    const styleLines: string[] = [];
    const fill = getSolidFill(rect);
    if (rect.cornerRadius !== figma.mixed) {
      styleLines.push(`  border-radius: ${rect.cornerRadius}px;`);
    }
    className = getClassForStyle(baseName, styleLines, context);
    classes.push(className);
    const sizing = registerSizingUtilities(rect, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const inlineStyles = [...sizing.styles];
    inlineStyles.push(...getAbsolutePositionStyles(rect, parentFrame));
    if (!isAbsoluteChild(rect, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      inlineStyles.push('z-index: 1');
    }
    if (fill) inlineStyles.push(`background: ${fill}`);
    if (!fill && hasImageFill(rect)) inlineStyles.push('background: #e5e7eb');
    const radius = getCornerRadiusStyle(rect);
    if (radius) inlineStyles.push(radius);
    if (rect.rotation !== 0 && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${rect.rotation}deg)`);
    }
    const inlineStyle = buildInlineStyle(inlineStyles);
    html += `<div class="${classes.join(' ')}"${inlineStyle}></div>\n`;
  }

  if (isVectorNode(node)) {
    const classes: string[] = [];
    const sizing = registerSizingUtilities(node, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const inlineStyles = [...sizing.styles];
    inlineStyles.push(...getAbsolutePositionStyles(node, parentFrame));
    if (!isAbsoluteChild(node, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      inlineStyles.push('z-index: 1');
    }
    if (node.rotation !== 0 && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${node.rotation}deg)`);
    }
    const inlineStyle = buildInlineStyle(inlineStyles);

    const svgBytes = await node.exportAsync({ format: 'SVG' });
    const svgText = decodeSvgBytes(svgBytes);
    const svgWrapped = `<div class="${classes.join(' ')}"${inlineStyle}>${svgText}</div>`;
    html += `${svgWrapped}\n`;
  }

  return { html };
};

const exportSelection = async (): Promise<ExportResult> => {
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
    utilityClasses: new Set<string>(),
    styleEntries: [],
  };

  const { html: bodyHtml } = await nodeToHtmlCss(frame, context);
  const css = `p { margin: 0; }\n\n` + context.styleEntries
    .sort((a, b) => {
      const baseCompare = a.baseName.localeCompare(b.baseName);
      if (baseCompare !== 0) return baseCompare;
      return a.suffix - b.suffix;
    })
    .map((entry) => entry.cssText)
    .join('');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Figma Export</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
${bodyHtml}
  </body>
</html>`;
  return { html, css };
};

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'export') {
    (async () => {
      try {
        const { html, css } = await exportSelection();
        figma.ui.postMessage({ type: 'export-result', html, css });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Export failed.',
        });
      }
    })();
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
