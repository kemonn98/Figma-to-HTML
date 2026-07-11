import type { ConvertParams, ExportNode } from '../types';
import { pxToRem, roundPx, isMeaningfulRotation, cssRotationDeg } from '../utils/color';
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
import { getClassForStyle, registerUtilityClass, splitInlineVsClassStyles } from '../styles/classes';
import { decodeSvgBytes, normalizeSvgToNodeSize, registerSvgAsset, buildSvgImgHtml } from '../assets/svg';
import { truncateLabel, reportExportProgress, overallPercentFromLayers } from '../export/progress';

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

export const formatFontFamily = (fontName: TextNode['fontName']) => {
  if (fontName === figma.mixed) return 'inherit';
  return `"${fontName.family}"`;
};

export const getFontWeightFromStyle = (fontName: TextNode['fontName']) => {
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

export const getTextCaseClass = (textCase: TextNode['textCase']) => {
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

export const getTextDecorationClass = (decoration: TextNode['textDecoration']) => {
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

      if (text.fontName !== figma.mixed && !shouldExportTextAsIconSvg(text)) {
        const family = text.fontName.family;
        const familyName = sanitizeName(family);
        if (familyName) {
          context.fontFamiliesUsed.add(family);
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
          const svgBytes = await text.exportAsync({ format: 'SVG' });
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

      let textContent = textToHtml(text.characters);
      if (text.fills === figma.mixed) {
        try {
          const segments = text.getStyledTextSegments(['fills']);
          textContent = segments
            .map((segment) => {
              const paints = segment.fills as ReadonlyArray<Paint>;
              const segmentFill = Array.isArray(paints)
                ? getFillStyleFromPaints(paints)
                : null;
              const segmentText = textToHtml(segment.characters);
              if (!segmentFill) return segmentText;
              const isGradient = /^(linear|radial|conic)-gradient\(/.test(segmentFill);
              const spanStyle = isGradient
                ? `background: ${segmentFill}; color: transparent; background-clip: text; -webkit-background-clip: text`
                : `color: ${segmentFill}`;
              return `<span style="${spanStyle}">${segmentText}</span>`;
            })
            .join('');
        } catch {
          const textFill = getSolidTextFill(text) || getFillStyleFromPaints((text.fills as unknown) as ReadonlyArray<Paint>);
          if (textFill) {
            const isGradient = /^(linear|radial|conic)-gradient\(/.test(textFill);
            if (isGradient) inlineStyles.push(`background: ${textFill}`, 'color: transparent', 'background-clip: text', '-webkit-background-clip: text');
            else inlineStyles.push(`color: ${textFill}`);
          }
        }
      } else {
        const textFill = getSolidTextFill(text) || getFillStyleFromPaints(text.fills as ReadonlyArray<Paint>);
        if (textFill) {
          const isGradient = /^(linear|radial|conic)-gradient\(/.test(textFill);
          if (isGradient) inlineStyles.push(`background: ${textFill}`, 'color: transparent', 'background-clip: text', '-webkit-background-clip: text');
          else inlineStyles.push(`color: ${textFill}`);
        }
      }
      if (text.paragraphSpacing > 0) inlineStyles.push(`margin-bottom: ${pxToRem(text.paragraphSpacing)}`);
      if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
      if (isMeaningfulRotation(text.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
        inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(text.rotation)}deg)`);
      }

      const textSplit = splitInlineVsClassStyles(inlineStyles);
      if (textSplit.classLines.length > 0) {
        const vc = getClassForStyle(baseName || 'text', textSplit.classLines, context);
        if (vc) classes.push(vc);
      }

      if (classes.length === 0) {
        registerUtilityClass('text', [], context);
        classes.push('text');
      }
      const tag = context.heroHeadingNodeId === text.id ? 'h1' : 'p';
      html +=
        openPrefix +
        `<${tag} ${dataLayer}${getClassAttr(classes)}${getStyleAttr(textSplit.inline)}>${textContent}</${tag}>`;
  return { html };
};
