type ExportResult =
  | { format: 'html'; html: string; css: string }
  | { format: 'react'; jsx: string; css: string };

type ExportMessage =
  | { type: 'export'; format?: 'html' | 'react' }
  | { type: 'cancel' };

type ExportNode = { html: string };

type OutputFormat = 'html' | 'react';

const getClassAttr = (classes: string[], format: OutputFormat) =>
  format === 'react' ? `className="${classes.join(' ')}"` : `class="${classes.join(' ')}"`;

const getStyleAttr = (styles: string[], format: OutputFormat) =>
  format === 'react' ? buildReactStyleAttr(styles) : buildInlineStyle(styles);

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
  fontFamiliesUsed: Set<string>;
  usedBaseClasses: Set<string>;
  svgIdCounter: number;
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

const escapeJsxText = (text: string) =>
  text.replace(/[&<>{}]/g, (match) => {
    const table: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '{': '&#123;',
      '}': '&#125;',
    };
    return table[match];
  });

const cssPropToCamel = (prop: string) =>
  prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

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

const roundAlpha = (a: number) => Math.round((a ?? 1) * 100) / 100;

const getSolidFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((paint) => paint.type === 'SOLID') as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = roundAlpha(fill.opacity ?? 1);
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
  const a = roundAlpha(fill.opacity ?? 1);
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
  const a = roundAlpha(fill.opacity ?? 1);
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

const makeSvgIdsUnique = (svg: string, suffix: string): string => {
  const idRegex = /\bid=(["'])([^"']+)\1/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(svg)) !== null) {
    if (ids.indexOf(m[2]) < 0) ids.push(m[2]);
  }
  let result = svg;
  for (const id of ids) {
    const newId = `${id}_${suffix}`;
    result = result.split(`id="${id}"`).join(`id="${newId}"`);
    result = result.split(`id='${id}'`).join(`id='${newId}'`);
    result = result.split(`url(#${id})`).join(`url(#${newId})`);
  }
  return result;
};

const hasImageFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return node.fills.some((paint) => paint.type === 'IMAGE');
};

const hasInvisibleStrokesOnly = (node: GeometryMixin): boolean => {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return false;
  const hasVisibleStroke = node.strokes.some((p) => {
    if (p.visible === false) return false;
    const opacity = p.opacity ?? 1;
    return opacity > 0;
  });
  return !hasVisibleStroke;
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

const roundPx = (n: number) => Math.round(n * 100) / 100;
const roundDim = (n: number) => Math.round(n);
const isMeaningfulRotation = (r: number) => Math.abs(r) >= 0.01;

const getCornerRadiusStyle = (node: SceneNode) => {
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed && typeof node.cornerRadius === 'number') {
    return `border-radius: ${roundDim(node.cornerRadius)}px`;
  }
  return null;
};

const getStrokeStyles = (node: GeometryMixin): string[] => {
  const styles: string[] = [];
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return styles;
  const stroke = node.strokes.find((p) => p.type === 'SOLID' && p.visible !== false) as SolidPaint | undefined;
  if (!stroke) return styles;
  const w = roundDim('strokeWeight' in node && node.strokeWeight !== figma.mixed ? node.strokeWeight : 1);
  const align = 'strokeAlign' in node && typeof (node as { strokeAlign?: string }).strokeAlign === 'string'
    ? (node as { strokeAlign: string }).strokeAlign
    : 'INSIDE';
  const { r, g, b } = stroke.color;
  const a = Math.round((stroke.opacity ?? 1) * 100) / 100;
  const color = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
  if (align === 'INSIDE') {
    styles.push(`box-shadow: inset 0 0 0 ${w}px ${color}`);
  } else if (align === 'OUTSIDE') {
    styles.push(`outline: ${w}px solid ${color}`);
    styles.push('outline-offset: 0');
  } else {
    styles.push(`border: ${w}px solid ${color}`);
  }
  return styles;
};

const getEffectsStyles = (node: BlendMixin): string[] => {
  const styles: string[] = [];
  if (!('effects' in node) || node.effects.length === 0) return styles;
  const shadows: string[] = [];
  let blur = 0;
  for (const e of node.effects) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      const { r, g, b } = e.color;
      const a = roundAlpha('a' in e.color ? e.color.a : 1);
      const color = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'INNER_SHADOW') {
      const { r, g, b } = e.color;
      const a = roundAlpha('a' in e.color ? e.color.a : 1);
      const color = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`inset ${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'LAYER_BLUR') {
      blur = roundDim(e.radius);
    }
  }
  if (shadows.length > 0) styles.push(`box-shadow: ${shadows.join(', ')}`);
  if (blur > 0) styles.push(`filter: blur(${roundDim(blur)}px)`);
  return styles;
};

const mapBlendMode = (mode: BlendMode): string | null => {
  const m: Record<string, string> = {
    PASS_THROUGH: 'normal',
    NORMAL: 'normal',
    DARKEN: 'darken',
    MULTIPLY: 'multiply',
    LINEAR_BURN: 'color-burn',
    COLOR_BURN: 'color-burn',
    LIGHTEN: 'lighten',
    SCREEN: 'screen',
    LINEAR_DODGE: 'color-dodge',
    COLOR_DODGE: 'color-dodge',
    OVERLAY: 'overlay',
    SOFT_LIGHT: 'soft-light',
    HARD_LIGHT: 'hard-light',
    DIFFERENCE: 'difference',
    EXCLUSION: 'exclusion',
    HUE: 'hue',
    SATURATION: 'saturation',
    COLOR: 'color',
    LUMINOSITY: 'luminosity',
  };
  return m[mode] ?? null;
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

  const addClass = (cls: string) => {
    if (classes.indexOf(cls) === -1) classes.push(cls);
  };

  if (parentLayoutMode && layoutGrow > 0 && !isAbsolute) {
    registerUtilityClass('flex-1', ['  flex: 1;'], context);
    addClass('flex-1');
  }

  if (parentLayoutMode && layoutAlign === 'STRETCH' && !isAbsolute) {
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    addClass('self-stretch');
  }

  if (hasLayoutSizing && parentLayoutMode && !isAbsolute) {
    if (sizingHorizontal === 'FILL') {
      if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
      }
    }
    if (sizingVertical === 'FILL') {
      if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
      }
    }
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(text.height)}px`);
      }
    } else {
      if (text.textAutoResize === 'NONE') {
        styles.push(`width: ${roundDim(text.width)}px`);
        styles.push(`height: ${roundDim(text.height)}px`);
      } else if (text.textAutoResize === 'HEIGHT') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
    }
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(rect.height)}px`);
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
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (!counterFill) {
        styles.push(`height: ${roundDim(rect.height)}px`);
      }
    }
  }

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(frame.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(frame.height)}px`);
      }
    } else {
      if (frame.layoutMode === 'NONE') {
        styles.push(`width: ${roundDim(frame.width)}px`);
        styles.push(`height: ${roundDim(frame.height)}px`);
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
          `${primaryIsWidth ? 'width' : 'height'}: ${roundDim(
            primaryIsWidth ? frame.width : frame.height
          )}px`
        );
      }
      if (counterFixed && !counterFill) {
        styles.push(
          `${primaryIsWidth ? 'height' : 'width'}: ${roundDim(
            primaryIsWidth ? frame.height : frame.width
          )}px`
        );
      }
    }
  }

  return { classes, styles };
};

const registerGridUtilities = (frame: FrameNode, context: ExportContext): string[] => {
  if (frame.layoutMode !== 'GRID') return [];
  const classes: string[] = [];
  registerUtilityClass('grid', ['  display: grid;'], context);
  classes.push('grid');
  const rows = 'gridRowCount' in frame ? frame.gridRowCount : 1;
  const cols = 'gridColumnCount' in frame ? frame.gridColumnCount : 1;
  const rowsClass = `grid-rows-${rows}`;
  const colsClass = `grid-cols-${cols}`;
  registerUtilityClass(rowsClass, [`  grid-template-rows: repeat(${rows}, minmax(0, 1fr));`], context);
  registerUtilityClass(colsClass, [`  grid-template-columns: repeat(${cols}, minmax(0, 1fr));`], context);
  classes.push(rowsClass, colsClass);
  const gapValue = formatNegativeClassValue(frame.itemSpacing);
  const gapClass = `gap-${gapValue}`;
  registerUtilityClass(gapClass, [`  gap: ${frame.itemSpacing}px;`], context);
  classes.push(gapClass);
  return classes;
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

  if (frame.layoutWrap === 'WRAP') {
    registerUtilityClass('flex-wrap', ['  flex-wrap: wrap;'], context);
    classes.push('flex-wrap');
    if (frame.counterAxisAlignContent === 'SPACE_BETWEEN') {
      registerUtilityClass('content-between', ['  align-content: space-between;'], context);
      classes.push('content-between');
    }
    const counterSpacing = frame.counterAxisSpacing ?? frame.itemSpacing;
    if (counterSpacing != null && counterSpacing > 0) {
      if (frame.layoutMode === 'HORIZONTAL') {
        const rowGapClass = `row-gap-${formatNegativeClassValue(counterSpacing)}`;
        registerUtilityClass(rowGapClass, [`  row-gap: ${counterSpacing}px;`], context);
        classes.push(rowGapClass);
      } else {
        const colGapClass = `column-gap-${formatNegativeClassValue(counterSpacing)}`;
        registerUtilityClass(colGapClass, [`  column-gap: ${counterSpacing}px;`], context);
        classes.push(colGapClass);
      }
    }
  }

  // When SPACE_BETWEEN, Figma distributes space—don't add fixed gap (handles AUTO spacing)
  const isAutoGap = frame.primaryAxisAlignItems === 'SPACE_BETWEEN';
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

const getTextCaseClass = (textCase: TextNode['textCase']) => {
  if (textCase === figma.mixed) return null;
  switch (textCase) {
    case 'UPPER':
      return 'uppercase';
    case 'LOWER':
      return 'lowercase';
    case 'TITLE':
      return 'capitalize';
    case 'SMALL_CAPS':
    case 'SMALL_CAPS_FORCED':
      return 'small-caps';
    default:
      return null;
  }
};

const getTextDecorationClass = (decoration: TextNode['textDecoration']) => {
  if (decoration === figma.mixed) return null;
  switch (decoration) {
    case 'UNDERLINE':
      return 'underline';
    case 'STRIKETHROUGH':
      return 'line-through';
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

  const left = roundPx(node.x);
  const top = roundPx(node.y);
  const right = roundPx(parentFrame.width - (node.x + node.width));
  const bottom = roundPx(parentFrame.height - (node.y + node.height));

  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = node.x + node.width / 2;
      const offsetX = roundPx(centerX - parentFrame.width / 2);
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
      const offsetY = roundPx(centerY - parentFrame.height / 2);
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

  if (isMeaningfulRotation(node.rotation)) {
    transformParts.push(`rotate(${roundPx(node.rotation)}deg)`);
  }

  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }

  return styles;
};

const buildInlineStyle = (styles: string[]) => {
  if (styles.length === 0) return '';
  const seen = new Map<string, string>();
  for (const s of styles) {
    const colon = s.indexOf(':');
    if (colon > 0) {
      const prop = s.substring(0, colon).trim();
      seen.set(prop, s.trim());
    }
  }
  const deduped = Array.from(seen.values());
  return ` style="${deduped.join('; ')};"`;
};

const buildReactStyleAttr = (styles: string[]) => {
  if (styles.length === 0) return '';
  const seen = new Map<string, string>();
  for (const s of styles) {
    const colon = s.indexOf(':');
    if (colon > 0) {
      const prop = s.substring(0, colon).trim();
      const value = s.substring(colon + 1).trim();
      seen.set(prop, value);
    }
  }
  const entries = Array.from(seen.entries())
    .map(([k, v]) => `${cssPropToCamel(k)}: '${v.replace(/'/g, "\\'")}'`)
    .join(', ');
  return entries ? ` style={{ ${entries} }}` : '';
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
  parentFrame: FrameNode | null = null,
  outputFormat: OutputFormat = 'html'
): Promise<ExportNode> => {
  let baseName = sanitizeName(node.name) || `node-${node.id.replace(':', '-')}`;
  let className = baseName;
  let html = '';

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    const isInvisibleSpacer =
      frame.height < 1 &&
      roundPx(frame.opacity) < 0.01 &&
      frame.children.length === 0;
    if (isInvisibleSpacer) {
      return { html: '' };
    }
    const classes: string[] = [];
    if (frame.layoutMode === 'GRID') {
      classes.push(...registerGridUtilities(frame, context));
    } else if (frame.layoutMode !== 'NONE') {
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
      const idx = parentFrame.children.indexOf(frame);
      const z = parentFrame.itemReverseZIndex
        ? parentFrame.children.length - 1 - idx
        : 1;
      inlineStyles.push(`z-index: ${z}`);
    }
    if (fill) inlineStyles.push(`background: ${fill}`);
    if (!fill && hasImageFill(frame)) inlineStyles.push('background: #e5e7eb');
    const radius = getCornerRadiusStyle(frame);
    if (radius) inlineStyles.push(radius);
    inlineStyles.push(...getStrokeStyles(frame));
    inlineStyles.push(...getEffectsStyles(frame));
    if (frame.opacity < 1) inlineStyles.push(`opacity: ${roundPx(frame.opacity)}`);
    const blend = 'blendMode' in frame ? mapBlendMode(frame.blendMode) : null;
    if (blend && blend !== 'normal') inlineStyles.push(`mix-blend-mode: ${blend}`);
    if (frame.clipsContent) inlineStyles.push('overflow: hidden');
    // Figma frame dimensions include padding; use border-box so width/height match
    if (frame.layoutMode !== 'NONE') inlineStyles.push('box-sizing: border-box');
    if (isMeaningfulRotation(frame.rotation) && absoluteStyles.length === 0) {
      inlineStyles.push(`transform: rotate(${roundPx(frame.rotation)}deg)`);
    }
    if (styleLines.length > 0) {
      className = getClassForStyle(baseName, styleLines, context);
      classes.push(className);
    }
    if (classes.length === 0) {
      context.usedBaseClasses.add(baseName);
      if (baseName === 'frame') {
        registerUtilityClass(baseName, ['  display: block;'], context);
      }
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
    const seen = new Set<string>();
    const finalClasses = classes.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    const hasFlexDir = finalClasses.indexOf('flex-col') >= 0 || finalClasses.indexOf('flex-row') >= 0;
    if (hasFlexDir && finalClasses.indexOf('flex') < 0) {
      finalClasses.unshift('flex');
    }
    html += `<div ${getClassAttr(finalClasses, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}>`;

    const childParentLayoutMode =
      frame.layoutMode === 'NONE' ? null : frame.layoutMode;
    const childParentFrame =
      frame.layoutMode === 'NONE' ? null : frame;
    for (const child of frame.children) {
      const childExport = await nodeToHtmlCss(
        child,
        context,
        childParentLayoutMode,
        childParentFrame,
        outputFormat
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
      const value = text.letterSpacing.value;
      const trackingClass = `tracking-${formatNegativeClassValue(Math.round(value))}`;
      const cssValue = text.letterSpacing.unit === 'PERCENT'
        ? `${value / 100}em`
        : `${Math.round(value)}px`;
      registerUtilityClass(
        trackingClass,
        [`  letter-spacing: ${cssValue};`],
        context
      );
      classes.push(trackingClass);
    }

    if (text.fontName !== figma.mixed) {
      const familyName = sanitizeName(text.fontName.family);
      if (familyName) {
        context.fontFamiliesUsed.add(text.fontName.family);
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

    const textCaseVal = getTextCaseClass(text.textCase);
    if (textCaseVal) {
      const caseClass = `tt-${textCaseVal}`;
      registerUtilityClass(caseClass, [`  text-transform: ${textCaseVal};`], context);
      classes.push(caseClass);
    }

    const textDeco = getTextDecorationClass(text.textDecoration);
    if (textDeco) {
      const decoClass = `decoration-${textDeco}`;
      registerUtilityClass(decoClass, [`  text-decoration: ${textDeco};`], context);
      classes.push(decoClass);
    }

    const sizing = registerSizingUtilities(text, parentLayoutMode, context);
    classes.push(...sizing.classes);
    inlineStyles.push(...sizing.styles);
    inlineStyles.push(...getAbsolutePositionStyles(text, parentFrame));
    if (!isAbsoluteChild(text, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      const idx = parentFrame.children.indexOf(text);
      const z = parentFrame.itemReverseZIndex
        ? parentFrame.children.length - 1 - idx
        : 1;
      inlineStyles.push(`z-index: ${z}`);
    }
    const escapeText = outputFormat === 'react' ? escapeJsxText : escapeHtml;
    let textContent = escapeText(text.characters);
    if (text.fills === figma.mixed) {
      try {
        const segments = text.getStyledTextSegments(['fills']);
        textContent = segments
          .map((segment) => {
            const paints = segment.fills as ReadonlyArray<Paint>;
            const segmentFill = Array.isArray(paints)
              ? getSolidFillFromPaints(paints)
              : null;
            const segmentText = escapeText(segment.characters);
            if (!segmentFill) return segmentText;
            if (outputFormat === 'react') {
              return `<span style={{ color: '${segmentFill.replace(/'/g, "\\'")}' }}>${segmentText}</span>`;
            }
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
    if (text.paragraphSpacing > 0) inlineStyles.push(`margin-bottom: ${text.paragraphSpacing}px`);
    if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
    if (isMeaningfulRotation(text.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${roundPx(text.rotation)}deg)`);
    }

    if (classes.length === 0) {
      registerUtilityClass('text', [], context);
      classes.push('text');
    }
    html += `<p ${getClassAttr(classes, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}>${textContent}</p>\n`;
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    const isInvisibleSpacer =
      rect.height < 1 && roundPx(rect.opacity) < 0.01;
    if (isInvisibleSpacer) {
      return { html: '' };
    }
    const classes: string[] = [];
    const styleLines: string[] = [];
    const fill = getSolidFill(rect);
    if (rect.cornerRadius !== figma.mixed) {
      styleLines.push(`  border-radius: ${roundDim(rect.cornerRadius)}px;`);
    }
    className = getClassForStyle(baseName, styleLines, context);
    classes.push(className);
    const sizing = registerSizingUtilities(rect, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const inlineStyles = [...sizing.styles];
    inlineStyles.push(...getAbsolutePositionStyles(rect, parentFrame));
    if (!isAbsoluteChild(rect, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      const idx = parentFrame.children.indexOf(rect);
      const z = parentFrame.itemReverseZIndex
        ? parentFrame.children.length - 1 - idx
        : 1;
      inlineStyles.push(`z-index: ${z}`);
    }
    if (fill) inlineStyles.push(`background: ${fill}`);
    if (!fill && hasImageFill(rect)) inlineStyles.push('background: #e5e7eb');
    const radius = getCornerRadiusStyle(rect);
    if (radius) inlineStyles.push(radius);
    inlineStyles.push(...getStrokeStyles(rect));
    inlineStyles.push(...getEffectsStyles(rect));
    if (rect.opacity < 1) inlineStyles.push(`opacity: ${roundPx(rect.opacity)}`);
    const rectBlend = 'blendMode' in rect ? mapBlendMode(rect.blendMode) : null;
    if (rectBlend && rectBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${rectBlend}`);
    if (isMeaningfulRotation(rect.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${roundPx(rect.rotation)}deg)`);
    }
    html += `<div ${getClassAttr(classes, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}></div>\n`;
  }

  if (isVectorNode(node)) {
    const classes: string[] = [];
    const sizing = registerSizingUtilities(node, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const inlineStyles = [...sizing.styles];
    inlineStyles.push(...getAbsolutePositionStyles(node, parentFrame));
    if (!isAbsoluteChild(node, parentFrame) && parentFrame) {
      inlineStyles.push('position: relative');
      const idx = parentFrame.children.indexOf(node);
      const z = parentFrame.itemReverseZIndex
        ? parentFrame.children.length - 1 - idx
        : 1;
      inlineStyles.push(`z-index: ${z}`);
    }
    inlineStyles.push(...getEffectsStyles(node as BlendMixin));
    const vecBlend = 'blendMode' in node ? mapBlendMode(node.blendMode) : null;
    if (vecBlend && vecBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${vecBlend}`);
    if (isMeaningfulRotation(node.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push(`transform: rotate(${roundPx(node.rotation)}deg)`);
    }

    const usePlaceholder = hasInvisibleStrokesOnly(node as GeometryMixin);
    if (usePlaceholder) {
      if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
        inlineStyles.push(`width: ${Math.round(node.width)}px`, `height: ${Math.round(node.height)}px`);
      }
      inlineStyles.push('background: #e5e7eb');
      if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
      html += `<div ${getClassAttr(classes, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}></div>\n`;
    } else {
      try {
        const svgBytes = await node.exportAsync({ format: 'SVG' });
        let svgText = decodeSvgBytes(svgBytes);
        context.svgIdCounter += 1;
        svgText = makeSvgIdsUnique(svgText, `s${context.svgIdCounter}`);
        html += `<div ${getClassAttr(classes, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}>${svgText}</div>\n`;
      } catch (vectorErr) {
        if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
          inlineStyles.push(`width: ${roundDim(node.width)}px`, `height: ${roundDim(node.height)}px`);
        }
        inlineStyles.push('background: #e5e7eb');
        if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
        html += `<div ${getClassAttr(classes, outputFormat)}${getStyleAttr(inlineStyles, outputFormat)}></div>\n`;
      }
    }
  }

  return { html };
};

const exportSelection = async (format: 'html' | 'react' = 'html'): Promise<ExportResult> => {
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
    fontFamiliesUsed: new Set<string>(),
    usedBaseClasses: new Set<string>(),
    svgIdCounter: 0,
  };

  const outputFormat: OutputFormat = format;
  const { html: bodyContent } = await nodeToHtmlCss(frame, context, null, null, outputFormat);
  const googleFonts = Array.from(context.fontFamiliesUsed)
    .filter((f) => !/font awesome|awesome/i.test(f))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  const fontImport =
    googleFonts.length > 0
      ? `@import url('https://fonts.googleapis.com/css2?${googleFonts}&display=swap');\n\n`
      : '';
  const css = fontImport + `body, p { margin: 0; }\n\n` + context.styleEntries
    .sort((a, b) => {
      const baseCompare = a.baseName.localeCompare(b.baseName);
      if (baseCompare !== 0) return baseCompare;
      return a.suffix - b.suffix;
    })
    .map((entry) => entry.cssText)
    .join('');

  if (format === 'react') {
    const indented = '    ' + bodyContent.replace(/\n/g, '\n    ');
    const jsx = `import './styles.css';\n\nexport default function ExportedComponent() {\n  return (\n${indented}\n  );\n}\n`;
    return { format: 'react', jsx, css };
  }

  const fontsLink =
    googleFonts.length > 0
      ? `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${googleFonts}&display=swap" rel="stylesheet">
`
      : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Figma Export</title>
${fontsLink}    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
${bodyContent}
  </body>
</html>`;
  return { format: 'html', html, css };
};

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'export') {
    (async () => {
      try {
        const format = msg.format ?? 'html';
        const result = await exportSelection(format);
        if (result.format === 'html') {
          figma.ui.postMessage({ type: 'export-result', format: 'html', html: result.html, css: result.css });
        } else {
          figma.ui.postMessage({ type: 'export-result', format: 'react', jsx: result.jsx, css: result.css });
        }
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
