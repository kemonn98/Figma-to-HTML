import type { ConvertParams, ExportNode } from '../types';
import { roundPx, roundDim } from '../utils/color';
import { appendNodeTransformStyles, getNodeTransformParts } from '../utils/transform';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getSolidFill, getLayerBlurRadius, getCornerRadiusStyle, appendStackedFillStyles } from '../styles/fills';
import { getStrokeStyles } from '../styles/strokes';
import { getEffectsStyles, mapBlendMode, figmaBlurToCssPx } from '../styles/effects';
import { isMaskNode } from '../styles/mask';
import { registerSizingUtilities } from '../styles/layout';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
} from '../styles/position';
import { getUniqueClassName, assignStyleClasses, splitInlineVsClassStyles } from '../styles/classes';
import { hasImageFill, getFirstImagePaint, scaleModeToObjectFit } from '../assets/images';

export const convertRectangle = async ({
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
  pascalName,
  baseName,
  dataLayer,
  convertNode: _convertNode,
}: ConvertParams): Promise<ExportNode> => {
  let html = '';
      const rect = node as RectangleNode;
      const isInvisibleSpacer =
        rect.height < 1 && roundPx(rect.opacity) < 0.01;
      if (isInvisibleSpacer) {
        return { html: '' };
      }
      const fill = getSolidFill(rect);
      const rectBlurRadius = getLayerBlurRadius(rect as BlendMixin);
      if (fill && rectBlurRadius > 0) {
        const classes: string[] = [getUniqueClassName(pascalName, context)];
        const container = positionContainer || parentGroup || parentFrame;
        const z = positionContainer
          ? flattenedZIndex
          : parentGroup
            ? parentGroup.children.indexOf(rect)
            : parentFrame
              ? parentFrame.children.indexOf(rect)
              : 0;
        const { parts: xfParts, hasRotation, hasFlip } = getNodeTransformParts(rect);
        const transformed = hasRotation || hasFlip;
        const aabb = rect.absoluteBoundingBox;
        const blurPx = figmaBlurToCssPx(rectBlurRadius);
        const radiusStyle = getCornerRadiusStyle(rect);
        const borderRadius = radiusStyle ? radiusStyle.replace('border-radius: ', '').trim() : null;

        if (transformed && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number') {
          const outerStyles: string[] = [
            `width: ${roundPx(aabb.width)}px`,
            `height: ${roundPx(aabb.height)}px`,
          ];
          if (container) {
            outerStyles.push(...getPositionStylesRelativeToContainer(rect, container, z));
          }
          const innerStyles: string[] = [
            `width: ${roundPx(rect.width)}px`,
            `height: ${roundPx(rect.height)}px`,
            'position: absolute',
            'left: 50%',
            'top: 50%',
            `transform: translate(-50%, -50%)${xfParts.length ? ` ${xfParts.join(' ')}` : ''}`,
            `filter: blur(${blurPx}px)`,
          ];
          if (!isMaskNode(rect)) innerStyles.push(`background: ${fill}`);
          if (borderRadius) innerStyles.push(`border-radius: ${borderRadius}`);
          const innerIndent = '  '.repeat(baseIndent + indent + 1);
          html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>`;
          html += '\n' + innerIndent + `<div ${getStyleAttr(innerStyles)}></div>`;
          html += closePrefix + `</div>`;
        } else {
          const inlineStyles: string[] = [
            `width: ${roundPx(rect.width)}px`,
            `height: ${roundPx(rect.height)}px`,
          ];
          if (container) {
            inlineStyles.push(...getPositionStylesRelativeToContainer(rect, container, z));
          }
          if (!isMaskNode(rect)) inlineStyles.push(`background: ${fill}`);
          if (borderRadius) inlineStyles.push(`border-radius: ${borderRadius}`);
          inlineStyles.push(`filter: blur(${blurPx}px)`);
          appendNodeTransformStyles(inlineStyles, rect);
          html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}></div>`;
        }
        return { html };
      }

      const classes: string[] = [];
      const styleLines: string[] = [];
      if (rect.cornerRadius !== figma.mixed && typeof rect.cornerRadius === 'number' && rect.cornerRadius > 0) {
        styleLines.push(`  border-radius: ${roundDim(rect.cornerRadius)}px;`);
      }
      if (styleLines.length > 0) {
        classes.push(...assignStyleClasses(baseName || 'rect', styleLines, context));
      }
      const sizing = registerSizingUtilities(rect, parentLayoutMode, context, parentFrame);
      classes.push(...sizing.classes);
      const inlineStyles = [...sizing.styles];
      if (positionContainer) {
        inlineStyles.push(...getPositionStylesRelativeToContainer(rect, positionContainer, flattenedZIndex));
      } else if (parentGroup) {
        inlineStyles.push(...getGroupChildPositionStyles(rect, parentGroup));
      } else {
        inlineStyles.push(...getAbsolutePositionStyles(rect, parentFrame));
        if (shouldAddRelativeStacking(rect, parentFrame)) {
          inlineStyles.push('position: relative');
          const idx = parentFrame!.children.indexOf(rect);
          const z = parentFrame!.itemReverseZIndex
            ? parentFrame!.children.length - 1 - idx
            : idx + 1;
          inlineStyles.push(`z-index: ${z}`);
        }
      }
      let rectImageSrc: string | null = null;
      let objectFit = 'cover';
      if (!isMaskNode(rect)) {
        const stacked = await appendStackedFillStyles(rect, inlineStyles, context, {
          asImgIfSoleImage: true,
          nameHint: rect.name,
        });
        rectImageSrc = stacked.imageSrcForImgTag;
        if (rectImageSrc) {
          const ip = getFirstImagePaint(rect);
          if (ip) objectFit = scaleModeToObjectFit(ip.scaleMode);
        } else if (
          !inlineStyles.some((s) => s.startsWith('background')) &&
          hasImageFill(rect)
        ) {
          inlineStyles.push('background: #e5e7eb');
        }
      }
      const radius = getCornerRadiusStyle(rect);
      if (radius) inlineStyles.push(radius);
      inlineStyles.push(...getStrokeStyles(rect));
      inlineStyles.push(...getEffectsStyles(rect));
      if (rect.opacity < 1) inlineStyles.push(`opacity: ${roundPx(rect.opacity)}`);
      const rectBlend = 'blendMode' in rect ? mapBlendMode(rect.blendMode) : null;
      if (rectBlend && rectBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${rectBlend}`);
      appendNodeTransformStyles(inlineStyles, rect);
      const rectSplit = splitInlineVsClassStyles(inlineStyles);
      const rectInline = rectSplit.inline;
      if (rectSplit.classLines.length > 0) {
        classes.push(...assignStyleClasses(baseName || 'rect', rectSplit.classLines, context));
      }
      if (rectImageSrc) {
        if (!rectInline.some((s) => s.startsWith('overflow:'))) rectInline.push('overflow: hidden');
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(rectInline)}>`;
        const imgIndent = '  '.repeat(baseIndent + indent + 1);
        html +=
          '\n' +
          imgIndent +
          `<img src="${rectImageSrc}" alt="" style="display: block; width: 100%; height: 100%; object-fit: ${objectFit}" />`;
        html += closePrefix + `</div>`;
      } else {
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(rectInline)}></div>`;
      }
  return { html };
};
