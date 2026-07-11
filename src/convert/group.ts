import type { ConvertParams, ExportNode } from '../types';
import { roundPx, roundDim, isMeaningfulRotation, cssRotationDeg } from '../utils/color';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getFillStyle, getCornerRadiusStyle } from '../styles/fills';
import { getStrokeStyles } from '../styles/strokes';
import { getEffectsStyles, mapBlendMode } from '../styles/effects';
import { isMaskNode, getClipPathFromMaskNode, getMaskImageStyles } from '../styles/mask';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
} from '../styles/position';
import { registerUtilityClass } from '../styles/classes';
import { hasImageFill, registerImageAsset } from '../assets/images';

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
      // Groups always position children absolutely — establish a containing block
      // even when the group itself sits in normal flex/flow layout.
      if (!inlineStyles.some((s) => s.startsWith('position:'))) {
        inlineStyles.push('position: relative');
      }
      if ('fills' in group && group.fills !== figma.mixed && !isMaskNode(group)) {
        const fill = getFillStyle(group as unknown as GeometryMixin);
        if (fill) inlineStyles.push(`background: ${fill}`);
        else if (hasImageFill(group as unknown as GeometryMixin)) {
          const gImg = await registerImageAsset(group as unknown as SceneNode & GeometryMixin, context);
          if (gImg) {
            inlineStyles.push(
              `background-image: url("${gImg}")`,
              'background-size: cover',
              'background-position: center',
              'background-repeat: no-repeat'
            );
          } else {
            inlineStyles.push('background: #e5e7eb');
          }
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
      if (isMeaningfulRotation(group.rotation) && !inlineStyles.some((s) => s.startsWith('transform:'))) {
        inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(group.rotation)}deg)`);
      }

      if (classes.length === 0) {
        context.usedBaseClasses.add(baseName);
        registerUtilityClass('group', ['  display: block;'], context);
        classes.push('group');
      } else if (baseName && baseName.toLowerCase() !== 'group') {
        classes.unshift(baseName);
      }
      const seen = new Set<string>();
      const finalClasses = classes.filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });
      inlineStyles.push('overflow: visible');
      html += openPrefix + `<div ${dataLayer}${getClassAttr(finalClasses)}${getStyleAttr(inlineStyles)}>`;

      const groupChildren = Array.from(group.children).filter((c): c is SceneNode => 'type' in c);
      let gi = 0;
      while (gi < groupChildren.length) {
        const child = groupChildren[gi];
        if (isMaskNode(child)) {
          const clipPath = getClipPathFromMaskNode(child);
          let k = gi + 1;
          while (k < groupChildren.length && !isMaskNode(groupChildren[k])) k++;
          const maskedCount = k - gi - 1;
          const childExport = await convertNode(child, context, null, null, group, indent + 1, baseIndent);
          html += childExport.html;
          if (maskedCount > 0) {
            const wrapperStyles: string[] = [
              `width: ${roundDim(child.width)}px`,
              `height: ${roundDim(child.height)}px`,
              'position: absolute',
              'overflow: hidden',
            ];
            if (clipPath) wrapperStyles.push(`clip-path: ${clipPath}`);
            wrapperStyles.push(...getMaskImageStyles(child));
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

      html += closePrefix + `</div>`;
  return { html };
};
