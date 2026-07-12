import type { ConvertParams, ExportNode } from '../types';
import { roundPx, roundDim } from '../utils/color';
import { appendNodeTransformStyles } from '../utils/transform';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getCornerRadiusStyle, appendStackedFillStyles } from '../styles/fills';
import { getStrokeStyles } from '../styles/strokes';
import { getEffectsStyles, mapBlendMode } from '../styles/effects';
import { isMaskNode, appendMaskWrapperStyles } from '../styles/mask';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
} from '../styles/position';
import { assignStyleClasses, splitInlineVsClassStyles } from '../styles/classes';
import { hasImageFill } from '../assets/images';
import { semanticContainerTag, semanticContainerOpenAttrs } from './semantics';

export const convertGroup = async ({
  node,
  context,
  parentLayoutMode: _parentLayoutMode,
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
  convertNode,
}: ConvertParams): Promise<ExportNode> => {
  let html = '';
  const group = node as GroupNode;
  const isInvisibleSpacer =
    group.height < 1 &&
    roundPx(group.opacity) < 0.01 &&
    group.children.length === 0;
  if (isInvisibleSpacer) {
    return { html: '' };
  }

  const groupChildren = Array.from(group.children).filter((c): c is SceneNode => 'type' in c);

  const classes: string[] = [];
  const inlineStyles: string[] = [];
  inlineStyles.push(
    `width: ${roundDim(group.width)}px`,
    `height: ${roundDim(group.height)}px`
  );
  if (positionContainer) {
    inlineStyles.push(...getPositionStylesRelativeToContainer(group, positionContainer, flattenedZIndex));
  } else if (parentGroup) {
    inlineStyles.push(...getGroupChildPositionStyles(group, parentGroup));
  } else if (parentFrame) {
    if ('layoutPositioning' in group && group.layoutPositioning === 'ABSOLUTE') {
      inlineStyles.push(...getAbsolutePositionStyles(group, parentFrame));
    } else if (shouldAddRelativeStacking(group, parentFrame)) {
      inlineStyles.push('position: relative');
      const idx = parentFrame.children.indexOf(group);
      const z = parentFrame.itemReverseZIndex
        ? parentFrame.children.length - 1 - idx
        : idx + 1;
      inlineStyles.push(`z-index: ${z}`);
    }
  }
  if (!inlineStyles.some((s) => s.startsWith('position:'))) {
    inlineStyles.push('position: relative');
  }
  if ('fills' in group && group.fills !== figma.mixed && !isMaskNode(group)) {
    await appendStackedFillStyles(group as unknown as SceneNode & GeometryMixin, inlineStyles, context, {
      nameHint: group.name,
    });
    if (
      !inlineStyles.some((s) => s.startsWith('background')) &&
      hasImageFill(group as unknown as GeometryMixin)
    ) {
      inlineStyles.push('background: #e5e7eb');
    }
  }
  if ('strokes' in group && Array.isArray((group as { strokes?: unknown }).strokes)) {
    inlineStyles.push(...getStrokeStyles(group as unknown as GeometryMixin));
  }
  if ('cornerRadius' in group && (group as SceneNode & { cornerRadius?: unknown }).cornerRadius !== figma.mixed) {
    const radius = getCornerRadiusStyle(group as SceneNode);
    if (radius) inlineStyles.push(radius);
  }
  if ('effects' in group && (group as BlendMixin).effects?.length) {
    inlineStyles.push(...getEffectsStyles(group as BlendMixin));
  }
  if (group.opacity < 1) inlineStyles.push(`opacity: ${roundPx(group.opacity)}`);
  const groupBlend = 'blendMode' in group ? mapBlendMode(group.blendMode) : null;
  if (groupBlend && groupBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${groupBlend}`);
  appendNodeTransformStyles(inlineStyles, group);

  const split = splitInlineVsClassStyles(inlineStyles);
  inlineStyles.length = 0;
  inlineStyles.push(...split.inline);
  if (split.classLines.length > 0) {
    classes.push(...assignStyleClasses(baseName || 'group', split.classLines, context));
  }

  inlineStyles.push('overflow: visible');
  const seen = new Set<string>();
  const finalClasses = classes.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
  const tag = semanticContainerTag(node.name || baseName || '');
  const tagAttrs = semanticContainerOpenAttrs(tag);
  html += openPrefix + `<${tag} ${tagAttrs}${dataLayer}${getClassAttr(finalClasses)}${getStyleAttr(inlineStyles)}>`;

  let gi = 0;
  while (gi < groupChildren.length) {
    const child = groupChildren[gi];
    if (isMaskNode(child)) {
      let k = gi + 1;
      while (k < groupChildren.length && !isMaskNode(groupChildren[k])) k++;
      const maskedCount = k - gi - 1;
      // Skip empty mask source; only emit wrapper
      if (maskedCount > 0) {
        const wrapperStyles: string[] = [
          `width: ${roundDim(child.width)}px`,
          `height: ${roundDim(child.height)}px`,
          'position: absolute',
          'overflow: hidden',
        ];
        await appendMaskWrapperStyles(child, wrapperStyles, context);
        wrapperStyles.push(...getPositionStylesRelativeToContainer(child, group, gi + 1));
        const innerIndent = '  '.repeat(baseIndent + indent + 1);
        html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
        for (let m = gi + 1; m < k; m++) {
          const sibExport = await convertNode(
            groupChildren[m],
            context,
            null,
            null,
            group,
            indent + 1,
            baseIndent,
            child,
            m - gi - 1
          );
          html += sibExport.html;
        }
        html += '\n' + innerIndent + '</div>';
      }
      gi = k;
    } else {
      const childExport = await convertNode(child, context, null, null, group, indent + 1, baseIndent);
      html += childExport.html;
      gi++;
    }
  }

  html += closePrefix + `</${tag}>`;
  return { html };
};
