import type { ConvertParams, ExportNode } from '../types';
import { pxToRem, roundPx } from '../utils/color';
import { appendNodeTransformStyles } from '../utils/transform';
import { sanitizeName, formatNegativeClassValue } from '../utils/names';
import { getClassAttr, getStyleAttr, textToHtml } from '../utils/html';
import { getSolidTextFill, getFillStyleFromPaints } from '../styles/fills';
import { registerSizingUtilities } from '../styles/layout';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
} from '../styles/position';
import { assignStyleClasses, registerUtilityClass, splitInlineVsClassStyles } from '../styles/classes';
import { decodeSvgBytes, normalizeSvgToNodeSize, registerSvgAsset, buildSvgImgHtml } from '../assets/svg';
import { truncateLabel, reportExportProgress, overallPercentFromLayers } from '../export/progress';
import { withExportSlot } from '../utils/async';

const SEGMENT_FIELDS = [
  'fills',
  'fontSize',
  'fontName',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textDecoration',
  'textCase',
  'listOptions',
  'openTypeFeatures',
] as const;

type TextSegment = {
  characters: string;
  start: number;
  end: number;
  fills?: Paint[];
  fontSize?: number;
  fontName?: FontName;
  fontWeight?: number;
  letterSpacing?: LetterSpacing;
  lineHeight?: LineHeight;
  textDecoration?: TextDecoration;
  textCase?: TextCase;
  listOptions?: TextListOptions;
  openTypeFeatures?: { readonly [feature: string]: boolean };
};

export const isFontAwesomeFamily = (family: string) => /font\s*awesome/i.test(family);

export const isLikelyIconFontFamily = (family: string) =>
  /font\s*awesome|icon|glyph|symbol|material icons|feather|phosphor|lucide/i.test(family);

export const isIconSlugText = (characters: string) => {
  const t = characters.trim();
  if (!t || t.length > 48) return false;
  if (/\s/.test(t) && !/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(t)) return false;
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t);
};

/** Font Awesome always → SVG asset; other icon fonts when text looks like a slug. */
export const shouldExportTextAsIconSvg = (text: TextNode): boolean => {
  if (text.fontName === figma.mixed) return false;
  const family = text.fontName.family;
  if (isFontAwesomeFamily(family)) return true;
  return isLikelyIconFontFamily(family) && isIconSlugText(text.characters);
};

export const formatFontFamily = (fontName: FontName | PluginAPI['mixed']) => {
  if (fontName === figma.mixed) return 'inherit';
  return `"${fontName.family}"`;
};

export const getFontWeightFromStyle = (fontName: FontName | PluginAPI['mixed']) => {
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

export const getTextAlignClass = (align: TextNode['textAlignHorizontal']) => {
  switch (align) {
    case 'LEFT':
      return null; // default — omit
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

export const getTextCaseCss = (textCase: TextCase | PluginAPI['mixed']): string | null => {
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

export const getTextCaseClass = (textCase: TextNode['textCase']) => getTextCaseCss(textCase);

export const getTextDecorationCss = (
  decoration: TextDecoration | PluginAPI['mixed']
): string | null => {
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

export const getTextDecorationClass = (decoration: TextNode['textDecoration']) =>
  getTextDecorationCss(decoration);

/** Resolve effective line height in px for estimating clamp lines from fixed height. */
export const resolveLineHeightPx = (text: TextNode): number => {
  const fontSize = typeof text.fontSize === 'number' ? text.fontSize : 16;
  if (text.lineHeight === figma.mixed) return fontSize * 1.2;
  if (text.lineHeight.unit === 'AUTO') return fontSize * 1.2;
  if (text.lineHeight.unit === 'PERCENT') return (fontSize * text.lineHeight.value) / 100;
  return text.lineHeight.value;
};

/** Whether Figma will show an ending ellipsis for this text node. */
export const isTextTruncating = (text: TextNode): boolean => {
  if (text.textAutoResize === 'TRUNCATE') return true;
  return text.textTruncation === 'ENDING';
};

/**
 * CSS truncation for Figma textTruncation / maxLines / fixed-height truncate.
 * 1 line → overflow ellipsis + nowrap; 2+ → -webkit-line-clamp.
 */
export const registerTextTruncationClasses = (
  text: TextNode,
  context: ConvertParams['context']
): string[] => {
  if (!isTextTruncating(text)) return [];

  let lines: number | null =
    typeof text.maxLines === 'number' && text.maxLines >= 1 ? text.maxLines : null;

  if (lines == null) {
    // Fixed box: estimate lines from height / line-height (Figma clips by box)
    const lh = resolveLineHeightPx(text);
    if (lh > 0 && text.height > 0) {
      lines = Math.max(1, Math.floor(text.height / lh + 1e-6));
    } else {
      lines = 1;
    }
  }

  if (lines === 1) {
    registerUtilityClass(
      'truncate',
      [
        '  overflow: hidden;',
        '  text-overflow: ellipsis;',
        '  white-space: nowrap;',
      ],
      context
    );
    return ['truncate'];
  }

  const clampClass = `line-clamp-${lines}`;
  registerUtilityClass(
    clampClass,
    [
      '  overflow: hidden;',
      '  display: -webkit-box;',
      '  -webkit-box-orient: vertical;',
      `  -webkit-line-clamp: ${lines};`,
      `  line-clamp: ${lines};`,
    ],
    context
  );
  return [clampClass];
};

const openTypeFeaturesToCss = (
  features: { readonly [feature: string]: boolean } | PluginAPI['mixed'] | undefined
): string | null => {
  if (!features || features === figma.mixed) return null;
  const parts: string[] = [];
  for (const key of Object.keys(features)) {
    const on = (features as Record<string, boolean>)[key];
    parts.push(`"${key.toLowerCase()}" ${on ? '1' : '0'}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
};

const letterSpacingToCss = (ls: LetterSpacing): string | null => {
  const rounded = Math.round(ls.value);
  if (rounded === 0 && ls.unit !== 'PERCENT') return null;
  if (ls.unit === 'PERCENT') {
    if (ls.value === 0) return null;
    return `${ls.value / 100}em`;
  }
  return `${rounded}px`;
};

const lineHeightToCss = (lh: LineHeight, fontSize: number): string | null => {
  if (lh.unit === 'AUTO') return null;
  if (lh.unit === 'PERCENT') return `${Math.round(lh.value)}%`;
  if (lh.unit === 'PIXELS') return `${Math.round(lh.value)}px`;
  void fontSize;
  return null;
};

/** Build inline style overrides for a segment vs node-level defaults (empty = no span needed for that prop). */
const segmentOverrideStyles = (
  segment: TextSegment,
  text: TextNode,
  size: { width: number; height: number }
): string[] => {
  const styles: string[] = [];

  const paints = segment.fills as ReadonlyArray<Paint> | undefined;
  if (paints && Array.isArray(paints)) {
    const segmentFill = getFillStyleFromPaints(paints, size);
    if (segmentFill) {
      const isGradient = /^(linear|radial|conic)-gradient\(/.test(segmentFill);
      if (isGradient) {
        styles.push(
          `background: ${segmentFill}`,
          'color: transparent',
          'background-clip: text',
          '-webkit-background-clip: text'
        );
      } else {
        styles.push(`color: ${segmentFill}`);
      }
    }
  }

  if (typeof segment.fontSize === 'number') {
    const baseSize = typeof text.fontSize === 'number' ? text.fontSize : null;
    if (baseSize == null || Math.round(segment.fontSize) !== Math.round(baseSize)) {
      styles.push(`font-size: ${pxToRem(Math.round(segment.fontSize))}`);
    }
  }

  if (segment.fontName) {
    const baseFam =
      text.fontName !== figma.mixed ? text.fontName.family : null;
    if (!baseFam || segment.fontName.family !== baseFam) {
      styles.push(`font-family: ${formatFontFamily(segment.fontName)}`);
    }
    const segWeight =
      typeof segment.fontWeight === 'number'
        ? segment.fontWeight
        : getFontWeightFromStyle(segment.fontName);
    const baseWeight = getFontWeightFromStyle(text.fontName);
    if (segWeight && segWeight !== (baseWeight ?? 400)) {
      styles.push(`font-weight: ${segWeight}`);
    }
  } else if (typeof segment.fontWeight === 'number') {
    const baseWeight = getFontWeightFromStyle(text.fontName) ?? 400;
    if (segment.fontWeight !== baseWeight) {
      styles.push(`font-weight: ${segment.fontWeight}`);
    }
  }

  if (segment.letterSpacing) {
    const css = letterSpacingToCss(segment.letterSpacing);
    if (css) {
      const base =
        text.letterSpacing !== figma.mixed ? letterSpacingToCss(text.letterSpacing) : null;
      if (css !== base) styles.push(`letter-spacing: ${css}`);
    }
  }

  if (segment.lineHeight) {
    const fs = typeof segment.fontSize === 'number' ? segment.fontSize : 16;
    const css = lineHeightToCss(segment.lineHeight, fs);
    if (css) {
      const baseFs = typeof text.fontSize === 'number' ? text.fontSize : 16;
      const base =
        text.lineHeight !== figma.mixed ? lineHeightToCss(text.lineHeight, baseFs) : null;
      if (css !== base) styles.push(`line-height: ${css}`);
    }
  }

  const deco = segment.textDecoration != null ? getTextDecorationCss(segment.textDecoration) : null;
  if (deco) {
    const baseDeco = getTextDecorationCss(text.textDecoration);
    if (deco !== baseDeco) styles.push(`text-decoration: ${deco}`);
  }

  const tcase = segment.textCase != null ? getTextCaseCss(segment.textCase) : null;
  if (tcase) {
    const baseCase = getTextCaseCss(text.textCase);
    if (tcase !== baseCase) {
      if (tcase === 'small-caps') styles.push('font-variant: small-caps');
      else styles.push(`text-transform: ${tcase}`);
    }
  }

  const ot = openTypeFeaturesToCss(segment.openTypeFeatures);
  if (ot) {
    const baseOt =
      text.openTypeFeatures !== figma.mixed
        ? openTypeFeaturesToCss(text.openTypeFeatures)
        : null;
    if (ot !== baseOt) styles.push(`font-feature-settings: ${ot}`);
  }

  return styles;
};

const wrapSegmentHtml = (segment: TextSegment, text: TextNode): string => {
  const size = { width: text.width, height: text.height };
  const overrides = segmentOverrideStyles(segment, text, size);
  const body = textToHtml(segment.characters);
  if (overrides.length === 0) return body;
  return `<span style="${overrides.join('; ')}">${body}</span>`;
};

const segmentsHaveStyleMix = (text: TextNode, segments: TextSegment[]): boolean => {
  if (
    text.fills === figma.mixed ||
    text.fontSize === figma.mixed ||
    text.fontName === figma.mixed ||
    text.letterSpacing === figma.mixed ||
    text.lineHeight === figma.mixed ||
    text.textDecoration === figma.mixed ||
    text.textCase === figma.mixed ||
    text.openTypeFeatures === figma.mixed
  ) {
    return true;
  }
  return segments.length > 1;
};

const listTypeAt = (segments: TextSegment[], charIndex: number): 'ORDERED' | 'UNORDERED' | 'NONE' => {
  for (const s of segments) {
    if (charIndex >= s.start && charIndex < s.end) {
      const t = s.listOptions?.type;
      if (t === 'ORDERED' || t === 'UNORDERED') return t;
      return 'NONE';
    }
  }
  return 'NONE';
};

/**
 * Build text HTML: mixed style spans; consecutive list lines → ul/ol + li.
 */
export const buildTextContentHtml = (text: TextNode): string => {
  let segments: TextSegment[];
  try {
    segments = text.getStyledTextSegments([...SEGMENT_FIELDS]) as TextSegment[];
  } catch {
    return textToHtml(text.characters);
  }

  const hasList = segments.some(
    (s) => s.listOptions?.type === 'ORDERED' || s.listOptions?.type === 'UNORDERED'
  );
  const needsSpans = segmentsHaveStyleMix(text, segments);

  if (!hasList && !needsSpans) {
    return textToHtml(text.characters);
  }

  if (!hasList) {
    return segments.map((s) => wrapSegmentHtml(s, text)).join('');
  }

  // Split into lines; group consecutive list items
  const lines = text.characters.split('\n');
  let charPos = 0;
  type LineInfo = { start: number; end: number; list: 'ORDERED' | 'UNORDERED' | 'NONE'; text: string };
  const lineInfos: LineInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = charPos;
    const end = charPos + line.length;
    lineInfos.push({
      start,
      end,
      list: listTypeAt(segments, start < text.characters.length ? start : Math.max(0, start - 1)),
      text: line,
    });
    charPos = end + 1; // +1 for newline
  }

  const segmentsForRange = (start: number, end: number): TextSegment[] => {
    const out: TextSegment[] = [];
    for (const s of segments) {
      if (s.end <= start || s.start >= end) continue;
      const sliceStart = Math.max(s.start, start);
      const sliceEnd = Math.min(s.end, end);
      out.push({
        ...s,
        characters: text.characters.slice(sliceStart, sliceEnd),
        start: sliceStart,
        end: sliceEnd,
      });
    }
    return out;
  };

  const lineInnerHtml = (info: LineInfo): string => {
    const segs = segmentsForRange(info.start, info.end);
    if (segs.length === 0) return textToHtml(info.text);
    if (!needsSpans && segs.length === 1) return textToHtml(info.text);
    return segs.map((s) => wrapSegmentHtml(s, text)).join('');
  };

  let html = '';
  let i = 0;
  while (i < lineInfos.length) {
    const list = lineInfos[i].list;
    if (list === 'NONE') {
      html += lineInnerHtml(lineInfos[i]);
      if (i < lineInfos.length - 1) html += '<br>';
      i++;
      continue;
    }
    const tag = list === 'ORDERED' ? 'ol' : 'ul';
    html += `<${tag}>`;
    while (i < lineInfos.length && lineInfos[i].list === list) {
      html += `<li>${lineInnerHtml(lineInfos[i])}</li>`;
      i++;
    }
    html += `</${tag}>`;
  }
  return html;
};

export const convertText = async ({
  node,
  context,
  parentLayoutMode,
  parentFrame,
  parentGroup,
  indent,
  baseIndent,
  positionContainer,
  flattenedZIndex,
  openPrefix,
  closePrefix,
  pascalName: _pascalName,
  baseName,
  dataLayer,
  convertNode: _convertNode,
}: ConvertParams): Promise<ExportNode> => {
  let html = '';
  const text = node as TextNode;
  const classes: string[] = [];
  const inlineStyles: string[] = [];
  const fontSize = typeof text.fontSize === 'number' ? Math.round(text.fontSize) : null;
  if (fontSize) {
    const sizeClass = `text-${fontSize}`;
    registerUtilityClass(sizeClass, [`  font-size: ${pxToRem(fontSize)};`], context);
    classes.push(sizeClass);
  }

  const fontWeight = getFontWeightFromStyle(text.fontName);
  if (fontWeight && fontWeight !== 400) {
    const weightClass = `font-${fontWeight}`;
    registerUtilityClass(weightClass, [`  font-weight: ${fontWeight};`], context);
    classes.push(weightClass);
  }

  if (text.lineHeight !== figma.mixed && text.lineHeight.unit !== 'AUTO') {
    const value = Math.round(text.lineHeight.value);
    const lineClass = `leading-${formatNegativeClassValue(value)}`;
    const unit = text.lineHeight.unit === 'PERCENT' ? '%' : 'px';
    registerUtilityClass(lineClass, [`  line-height: ${value}${unit};`], context);
    classes.push(lineClass);
  }

  if (text.letterSpacing !== figma.mixed) {
    const value = text.letterSpacing.value;
    const rounded = Math.round(value);
    if (rounded !== 0) {
      const trackingClass = `tracking-${formatNegativeClassValue(rounded)}`;
      const cssValue =
        text.letterSpacing.unit === 'PERCENT' ? `${value / 100}em` : `${rounded}px`;
      registerUtilityClass(trackingClass, [`  letter-spacing: ${cssValue};`], context);
      classes.push(trackingClass);
    }
  }

  if (text.fontName !== figma.mixed && !shouldExportTextAsIconSvg(text)) {
    const family = text.fontName.family;
    const familyName = sanitizeName(family);
    if (familyName) {
      context.fontFamiliesUsed.add(family);
      const familyClass = `fontfam-${familyName}`;
      registerUtilityClass(familyClass, [`  font-family: ${formatFontFamily(text.fontName)};`], context);
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
    if (textCaseVal === 'small-caps') {
      registerUtilityClass(caseClass, ['  font-variant: small-caps;'], context);
    } else {
      registerUtilityClass(caseClass, [`  text-transform: ${textCaseVal};`], context);
    }
    classes.push(caseClass);
  }

  const textDeco = getTextDecorationClass(text.textDecoration);
  if (textDeco) {
    const decoClass = `decoration-${textDeco}`;
    registerUtilityClass(decoClass, [`  text-decoration: ${textDeco};`], context);
    classes.push(decoClass);
  }

  const otCss =
    text.openTypeFeatures !== figma.mixed
      ? openTypeFeaturesToCss(text.openTypeFeatures)
      : null;
  if (otCss) inlineStyles.push(`font-feature-settings: ${otCss}`);

  const sizing = registerSizingUtilities(text, parentLayoutMode, context, parentFrame);
  classes.push(...sizing.classes);
  inlineStyles.push(...sizing.styles);
  const truncating = isTextTruncating(text);
  classes.push(...registerTextTruncationClasses(text, context));
  if (positionContainer) {
    inlineStyles.push(...getPositionStylesRelativeToContainer(text, positionContainer, flattenedZIndex));
  } else if (parentGroup) {
    inlineStyles.push(...getGroupChildPositionStyles(text, parentGroup));
  } else {
    inlineStyles.push(...getAbsolutePositionStyles(text, parentFrame));
    if (shouldAddRelativeStacking(text, parentFrame)) {
      inlineStyles.push('position: relative');
      const idx = parentFrame!.children.indexOf(text);
      const z = parentFrame!.itemReverseZIndex
        ? parentFrame!.children.length - 1 - idx
        : idx + 1;
      inlineStyles.push(`z-index: ${z}`);
    }
  }

  // Icon fonts (including Font Awesome) → SVG asset + <img>
  if (shouldExportTextAsIconSvg(text)) {
    try {
      const iconLabel = text.name || text.characters || 'icon';
      await reportExportProgress(
        `Exporting icon SVG… ${truncateLabel(iconLabel)}`,
        overallPercentFromLayers(context)
      );
      const svgBytes = await withExportSlot(() => text.exportAsync({ format: 'SVG' }));
      let svgText = decodeSvgBytes(svgBytes);
      svgText = normalizeSvgToNodeSize(svgText, text.width, text.height);
      const svgPath = registerSvgAsset(iconLabel, svgText, context);
      if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
      const imgIndent = '  '.repeat(baseIndent + indent + 1);
      html +=
        openPrefix +
        `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}>` +
        '\n' +
        buildSvgImgHtml(svgPath, imgIndent) +
        closePrefix +
        `</div>`;
      return { html };
    } catch {
      // fall through to normal text
    }
  }

  // Node-level fill when not mixed (segment spans handle mixed)
  if (text.fills !== figma.mixed) {
    const textFill =
      getSolidTextFill(text) ||
      getFillStyleFromPaints(text.fills as ReadonlyArray<Paint>, {
        width: text.width,
        height: text.height,
      });
    if (textFill) {
      const isGradient = /^(linear|radial|conic)-gradient\(/.test(textFill);
      if (isGradient) {
        inlineStyles.push(
          `background: ${textFill}`,
          'color: transparent',
          'background-clip: text',
          '-webkit-background-clip: text'
        );
      } else {
        inlineStyles.push(`color: ${textFill}`);
      }
    }
  }

  const textContent = buildTextContentHtml(text);

  if (text.paragraphSpacing > 0) inlineStyles.push(`margin-bottom: ${pxToRem(text.paragraphSpacing)}`);
  if (typeof text.paragraphIndent === 'number' && text.paragraphIndent > 0) {
    inlineStyles.push(`text-indent: ${pxToRem(text.paragraphIndent)}`);
  }

  // Vertical align for fixed-height boxes (skip when truncating — line-clamp conflicts with flex)
  const fixedHeight = text.textAutoResize === 'NONE' || text.textAutoResize === 'TRUNCATE';
  if (fixedHeight && !truncating && text.textAlignVertical !== 'TOP') {
    inlineStyles.push('display: flex', 'flex-direction: column');
    if (text.textAlignVertical === 'CENTER') inlineStyles.push('justify-content: center');
    else if (text.textAlignVertical === 'BOTTOM') inlineStyles.push('justify-content: flex-end');
  }

  if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
  appendNodeTransformStyles(inlineStyles, text);

  const textSplit = splitInlineVsClassStyles(inlineStyles);
  if (textSplit.classLines.length > 0) {
    classes.push(...assignStyleClasses(baseName || 'text', textSplit.classLines, context));
  }

  if (classes.length === 0) {
    registerUtilityClass('text', [], context);
    classes.push('text');
  }
  html +=
    openPrefix +
    `<p ${dataLayer}${getClassAttr(classes)}${getStyleAttr(textSplit.inline)}>${textContent}</p>`;
  return { html };
};
