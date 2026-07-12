import type { ConvertParams, ExportNode } from '../types';
import { roundPx } from '../utils/color';
import { appendNodeTransformStyles, getNodeTransformParts } from '../utils/transform';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getSolidFill, getLayerBlurRadius, appendStackedFillStyles } from '../styles/fills';
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

/** Full closed ellipse (not arc / donut) can use CSS border-radius: 50%. */
export const isFullEllipse = (ellipse: EllipseNode): boolean => {
  if (!('arcData' in ellipse) || !ellipse.arcData) return true;
  const { startingAngle, endingAngle, innerRadius } = ellipse.arcData;
  if (innerRadius > 0.001) return false;
  const sweep = Math.abs(endingAngle - startingAngle);
  return sweep >= Math.PI * 2 - 0.02;
};

/** Prefer CSS when shape is a full ellipse without complex stroke needing SVG dash fidelity alone. */
export const canExportEllipseAsCss = (ellipse: EllipseNode): boolean => isFullEllipse(ellipse);

export const convertEllipse = async ({
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
}: ConvertParams): Promise<ExportNode | null> => {
  const ellipse = node as EllipseNode;
  if (!canExportEllipseAsCss(ellipse)) return null;

  let html = '';
  const fill = getSolidFill(ellipse);
  const blurRadius = getLayerBlurRadius(ellipse as BlendMixin);

  // Blurred solid ellipse (legacy fast path)
  if (fill && blurRadius > 0) {
    const classes: string[] = [getUniqueClassName(pascalName, context)];
    const container = positionContainer || parentGroup || parentFrame;
    const z = positionContainer
      ? flattenedZIndex
      : parentGroup
        ? parentGroup.children.indexOf(ellipse)
        : parentFrame
          ? parentFrame.children.indexOf(ellipse)
          : 0;
    const { parts: xfParts, hasRotation, hasFlip } = getNodeTransformParts(ellipse);
    const transformed = hasRotation || hasFlip;
    const aabb = ellipse.absoluteBoundingBox;
    const blurPx = figmaBlurToCssPx(blurRadius);

    if (transformed && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number') {
      const outerStyles: string[] = [
        `width: ${roundPx(aabb.width)}px`,
        `height: ${roundPx(aabb.height)}px`,
      ];
      if (container) {
        outerStyles.push(...getPositionStylesRelativeToContainer(ellipse, container, z));
      }
      const innerStyles: string[] = [
        `width: ${roundPx(ellipse.width)}px`,
        `height: ${roundPx(ellipse.height)}px`,
        'position: absolute',
        'left: 50%',
        'top: 50%',
        `transform: translate(-50%, -50%)${xfParts.length ? ` ${xfParts.join(' ')}` : ''}`,
        'border-radius: 50%',
        `filter: blur(${blurPx}px)`,
      ];
      if (!isMaskNode(ellipse)) innerStyles.push(`background: ${fill}`);
      const innerIndent = '  '.repeat(baseIndent + indent + 1);
      html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>`;
      html += '\n' + innerIndent + `<div ${getStyleAttr(innerStyles)}></div>`;
      html += closePrefix + `</div>`;
    } else {
      const inlineStyles: string[] = [
        `width: ${roundPx(ellipse.width)}px`,
        `height: ${roundPx(ellipse.height)}px`,
      ];
      if (container) {
        inlineStyles.push(...getPositionStylesRelativeToContainer(ellipse, container, z));
      }
      if (!isMaskNode(ellipse)) inlineStyles.push(`background: ${fill}`);
      inlineStyles.push('border-radius: 50%');
      inlineStyles.push(`filter: blur(${blurPx}px)`);
      appendNodeTransformStyles(inlineStyles, ellipse);
      html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}></div>`;
    }
    return { html };
  }

  const classes: string[] = [];
  const sizing = registerSizingUtilities(ellipse, parentLayoutMode, context, parentFrame);
  classes.push(...sizing.classes);
  const inlineStyles = [...sizing.styles];
  if (positionContainer) {
    inlineStyles.push(...getPositionStylesRelativeToContainer(ellipse, positionContainer, flattenedZIndex));
  } else if (parentGroup) {
    inlineStyles.push(...getGroupChildPositionStyles(ellipse, parentGroup));
  } else {
    inlineStyles.push(...getAbsolutePositionStyles(ellipse, parentFrame));
    if (shouldAddRelativeStacking(ellipse, parentFrame)) {
      inlineStyles.push('position: relative');
      const idx = parentFrame!.children.indexOf(ellipse);
      const z = parentFrame!.itemReverseZIndex
        ? parentFrame!.children.length - 1 - idx
        : idx + 1;
      inlineStyles.push(`z-index: ${z}`);
    }
  }

  let imageSrc: string | null = null;
  let objectFit = 'cover';
  if (!isMaskNode(ellipse)) {
    const stacked = await appendStackedFillStyles(ellipse, inlineStyles, context, {
      asImgIfSoleImage: true,
      nameHint: ellipse.name,
    });
    imageSrc = stacked.imageSrcForImgTag;
    if (imageSrc) {
      const ip = getFirstImagePaint(ellipse);
      if (ip) objectFit = scaleModeToObjectFit(ip.scaleMode);
    } else if (
      !inlineStyles.some((s) => s.startsWith('background')) &&
      hasImageFill(ellipse)
    ) {
      inlineStyles.push('background: #e5e7eb');
    }
  }

  inlineStyles.push('border-radius: 50%');
  inlineStyles.push(...getStrokeStyles(ellipse));
  inlineStyles.push(...getEffectsStyles(ellipse));
  if (ellipse.opacity < 1) inlineStyles.push(`opacity: ${roundPx(ellipse.opacity)}`);
  const blend = 'blendMode' in ellipse ? mapBlendMode(ellipse.blendMode) : null;
  if (blend && blend !== 'normal') inlineStyles.push(`mix-blend-mode: ${blend}`);
  appendNodeTransformStyles(inlineStyles, ellipse);

  const split = splitInlineVsClassStyles(inlineStyles);
  if (split.classLines.length > 0) {
    classes.push(...assignStyleClasses(baseName || 'ellipse', split.classLines, context));
  }
  if (classes.length === 0) {
    classes.push(getUniqueClassName(pascalName, context));
  }

  if (imageSrc) {
    if (!split.inline.some((s) => s.startsWith('overflow:'))) split.inline.push('overflow: hidden');
    html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(split.inline)}>`;
    const imgIndent = '  '.repeat(baseIndent + indent + 1);
    html +=
      '\n' +
      imgIndent +
      `<img src="${imageSrc}" alt="" style="display: block; width: 100%; height: 100%; object-fit: ${objectFit}; border-radius: 50%" />`;
    html += closePrefix + `</div>`;
  } else {
    html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(split.inline)}></div>`;
  }
  return { html };
};
