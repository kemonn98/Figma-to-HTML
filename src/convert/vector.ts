import type { ConvertParams, ExportNode } from '../types';
import { roundPx, roundPx4, roundDim } from '../utils/color';
import { appendNodeTransformStyles, getNodeTransformParts } from '../utils/transform';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getFillStyle } from '../styles/fills';
import {
  getStrokePaint,
  getStrokeWeight,
  strokePaintToCss,
  getStrokeDashPattern,
  getStrokeStyles,
  hasInvisibleStrokesOnly,
} from '../styles/strokes';
import { getEffectsStyles, mapBlendMode } from '../styles/effects';
import { isMaskNode } from '../styles/mask';
import { registerSizingUtilities } from '../styles/layout';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
} from '../styles/position';
import { hasImageFill } from '../assets/images';
import { decodeSvgBytes, normalizeSvgToNodeSize, registerSvgAsset, buildSvgImgHtml } from '../assets/svg';
import { truncateLabel, reportExportProgress, overallPercentFromLayers } from '../export/progress';

export const isVectorNode = (node: SceneNode) =>
  node.type === 'VECTOR' ||
  node.type === 'LINE' ||
  node.type === 'ELLIPSE' ||
  node.type === 'POLYGON' ||
  node.type === 'STAR' ||
  node.type === 'BOOLEAN_OPERATION';

/** Rotation is 0° / 90° / 180° (axis-aligned), so a line can be a CSS border. */
export const isAxisAlignedRotation = (rotation: number): boolean => {
  const r = ((rotation % 180) + 180) % 180;
  return r < 0.5 || Math.abs(r - 90) < 0.5 || Math.abs(r - 180) < 0.5;
};

/**
 * Detect simple dividers (LINE or 2-point VECTOR) that should be CSS borders,
 * not SVG assets. Heuristic:
 * - type LINE, or VECTOR with one straight segment / two vertices
 * - axis-aligned (including 90° rotation)
 * - solid stroke (gradients stay SVG)
 * - thin in one axis (height≈0 / width≈0 or ≤ ~2× stroke)
 */
export const isCssDividerLine = (node: SceneNode): boolean => {
  if (node.type !== 'LINE' && node.type !== 'VECTOR') return false;
  if (!isAxisAlignedRotation('rotation' in node ? node.rotation : 0)) return false;

  const stroke = getStrokePaint(node as GeometryMixin);
  if (!stroke || stroke.type !== 'SOLID') return false;

  // Exact dash patterns stay on SVG (stroke-dasharray); CSS borders only get generic dashed
  const dash = getStrokeDashPattern(node);
  if (dash && dash.length > 0) return false;

  const strokeW = Math.max(getStrokeWeight(node), 0.5);
  const boxW = Math.abs(node.width);
  const boxH = Math.abs(node.height);
  const thinLimit = Math.max(strokeW * 2, 2);

  if (node.type === 'VECTOR') {
    const vn = (node as VectorNode).vectorNetwork;
    if (vn && Array.isArray(vn.vertices) && Array.isArray(vn.segments)) {
      if (vn.segments.length !== 1 || vn.vertices.length !== 2) return false;
      const v0 = vn.vertices[0];
      const v1 = vn.vertices[1];
      const dx = Math.abs(v0.x - v1.x);
      const dy = Math.abs(v0.y - v1.y);
      if (!(dx < 0.51 || dy < 0.51)) return false;
    }
  }

  const isHorizontal = boxH <= thinLimit && boxW > thinLimit;
  const isVertical = boxW <= thinLimit && boxH > thinLimit;
  // LINE often reports height 0 with length in width
  if (node.type === 'LINE') return boxW > 0 || boxH > 0;
  return isHorizontal || isVertical;
};

export const getDividerOrientation = (node: SceneNode): 'horizontal' | 'vertical' => {
  const rot = (('rotation' in node ? node.rotation : 0) % 180 + 180) % 180;
  const near90 = Math.abs(rot - 90) < 0.5;
  const boxW = Math.abs(node.width);
  const boxH = Math.abs(node.height);
  const baseHorizontal = boxW >= boxH;
  if (near90) return baseHorizontal ? 'vertical' : 'horizontal';
  return baseHorizontal ? 'horizontal' : 'vertical';
};

export const convertVector = async ({
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
  baseName: _baseName,
  dataLayer,
  convertNode: _convertNode,
}: ConvertParams): Promise<ExportNode> => {
  if (!isVectorNode(node)) {
    return { html: '' };
  }
  let html = '';
      const classes: string[] = [];
      const sizing = registerSizingUtilities(node, parentLayoutMode, context, parentFrame);
      classes.push(...sizing.classes);
      const baseInlineStyles: string[] = [...sizing.styles];
      if (!baseInlineStyles.some((s) => s.startsWith('width:'))) {
        baseInlineStyles.push(`width: ${roundDim(node.width)}px`);
      }
      if (!baseInlineStyles.some((s) => s.startsWith('height:'))) {
        baseInlineStyles.push(`height: ${roundDim(node.height)}px`);
      }
      if (positionContainer) {
        baseInlineStyles.push(...getPositionStylesRelativeToContainer(node, positionContainer, flattenedZIndex));
      } else if (parentGroup) {
        baseInlineStyles.push(...getGroupChildPositionStyles(node, parentGroup));
      } else {
        baseInlineStyles.push(...getAbsolutePositionStyles(node, parentFrame));
        if (shouldAddRelativeStacking(node, parentFrame)) {
          baseInlineStyles.push('position: relative');
          const idx = parentFrame!.children.indexOf(node);
          const z = parentFrame!.itemReverseZIndex
            ? parentFrame!.children.length - 1 - idx
            : idx + 1;
          baseInlineStyles.push(`z-index: ${z}`);
        }
      }
      baseInlineStyles.push(...getEffectsStyles(node as BlendMixin));
      const vecBlend = 'blendMode' in node ? mapBlendMode(node.blendMode) : null;
      if (vecBlend && vecBlend !== 'normal') baseInlineStyles.push(`mix-blend-mode: ${vecBlend}`);

      // Simple H/V dividers → CSS border (not SVG asset)
      if (isCssDividerLine(node)) {
        const stroke = getStrokePaint(node as GeometryMixin);
        const weight = Math.max(getStrokeWeight(node), 1);
        const color = stroke ? strokePaintToCss(stroke) : '#000000';
        const dashed = !!getStrokeDashPattern(node);
        const orient = getDividerOrientation(node);
        const length = roundDim(Math.max(Math.abs(node.width), Math.abs(node.height)));
        const dividerStyles = baseInlineStyles.filter(
          (s) => !s.startsWith('width:') && !s.startsWith('height:') && !s.startsWith('transform:')
        );
        if (orient === 'horizontal') {
          dividerStyles.push(`width: ${length}px`, 'height: 0');
          dividerStyles.push(
            dashed
              ? `border-top: ${weight}px dashed ${color}`
              : `border-top: ${weight}px solid ${color}`
          );
        } else {
          dividerStyles.push('width: 0', `height: ${length}px`);
          dividerStyles.push(
            dashed
              ? `border-left: ${weight}px dashed ${color}`
              : `border-left: ${weight}px solid ${color}`
          );
        }
        if (node.opacity < 1) dividerStyles.push(`opacity: ${roundPx(node.opacity)}`);
        html +=
          openPrefix +
          `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(dividerStyles)}></div>`;
        return { html };
      }

      // SVG exportAsync already bakes rotation/flip into the asset; wrap with AABB only.
      // CSS flip/rotate is for placeholder (non-SVG) fallbacks.
      const { hasRotation, hasFlip } = getNodeTransformParts(node);
      const rotatedOrFlipped = hasRotation || hasFlip;
      const aabb = node.absoluteBoundingBox;
      const useAabbWrapper =
        rotatedOrFlipped && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number';
      const container = positionContainer || parentGroup || parentFrame;
      const z = positionContainer
        ? flattenedZIndex
        : parentGroup
          ? parentGroup.children.indexOf(node)
          : parentFrame
            ? parentFrame.children.indexOf(node)
            : 0;

      const usePlaceholder = hasInvisibleStrokesOnly(node as GeometryMixin);

      const buildVectorContent = (innerStyles: string[], contentHtml: string): string => {
        if (useAabbWrapper && container) {
          const r = roundPx4;
          const outerStyles: string[] = [
            `width: ${r(aabb!.width)}px`,
            `height: ${r(aabb!.height)}px`,
          ];
          outerStyles.push(...getPositionStylesRelativeToContainer(node, container, z, 4));
          const innerWrapperStyles: string[] = [
            `width: ${r(aabb!.width)}px`,
            `height: ${r(aabb!.height)}px`,
            'position: absolute',
            'left: 50%',
            'top: 50%',
            'transform: translate(-50%, -50%)',
          ];
          const innerIndent = '  '.repeat(baseIndent + indent + 1);
          return (
            openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>` +
            '\n' + innerIndent + `<div ${getStyleAttr(innerWrapperStyles)}>` +
            (contentHtml ? '\n' + contentHtml + '\n' + innerIndent : '') +
            `</div>` +
            closePrefix + `</div>`
          );
        }
        return openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(innerStyles)}>` +
          (contentHtml ? '\n' + contentHtml + '\n' + '  '.repeat(baseIndent + indent) : '') +
          `</div>`;
      };

      if (usePlaceholder) {
        const inlineStyles = [...baseInlineStyles];
        if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
          inlineStyles.push(`width: ${Math.round(node.width)}px`, `height: ${Math.round(node.height)}px`);
        }
        if (!isMaskNode(node)) {
          const vecFill = getFillStyle(node as GeometryMixin);
          if (vecFill) inlineStyles.push(`background: ${vecFill}`);
          else if (hasImageFill(node as GeometryMixin)) inlineStyles.push('background: #e5e7eb');
          else inlineStyles.push('background: #e5e7eb');
        }
        inlineStyles.push(...getStrokeStyles(node as GeometryMixin));
        if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
        if (!useAabbWrapper) {
          appendNodeTransformStyles(inlineStyles, node);
        }
        html += buildVectorContent(inlineStyles, '');
      } else {
        try {
          await reportExportProgress(
            `Exporting SVG… ${truncateLabel(node.name || node.type)}`,
            overallPercentFromLayers(context)
          );
          const svgBytes = await node.exportAsync({ format: 'SVG' });
          let svgText = decodeSvgBytes(svgBytes);
          if (!useAabbWrapper) {
            svgText = normalizeSvgToNodeSize(svgText, node.width, node.height);
          }
          const svgPath = registerSvgAsset(node.name || node.type, svgText, context);
          const svgIndent = '  '.repeat(useAabbWrapper ? baseIndent + indent + 2 : baseIndent + indent + 1);
          const inlineStyles = [...baseInlineStyles];
          // Do not CSS-flip SVG — export already includes flip/rotation visually
          html += buildVectorContent(inlineStyles, buildSvgImgHtml(svgPath, svgIndent));
        } catch (vectorErr) {
          const inlineStyles = [...baseInlineStyles];
          if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
            inlineStyles.push(`width: ${roundDim(node.width)}px`, `height: ${roundDim(node.height)}px`);
          }
          if (!isMaskNode(node)) {
            const vecFill = getFillStyle(node as GeometryMixin);
            if (vecFill) inlineStyles.push(`background: ${vecFill}`);
            else if (hasImageFill(node as GeometryMixin)) inlineStyles.push('background: #e5e7eb');
            else inlineStyles.push('background: #e5e7eb');
          }
          inlineStyles.push(...getStrokeStyles(node as GeometryMixin));
          if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
          if (!useAabbWrapper) {
            appendNodeTransformStyles(inlineStyles, node);
          }
          html += buildVectorContent(inlineStyles, '');
        }
      }
  return { html };
};
