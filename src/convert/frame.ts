import type { ConvertParams, ExportNode } from '../types';
import { roundPx, roundDim } from '../utils/color';
import { appendNodeTransformStyles } from '../utils/transform';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getClipsContentStyles, getCornerRadiusStyle, appendStackedFillStyles } from '../styles/fills';
import { getStrokeStyles } from '../styles/strokes';
import { getEffectsStyles, mapBlendMode } from '../styles/effects';
import { isMaskNode, appendMaskWrapperStyles } from '../styles/mask';
import { registerSizingUtilities, registerGridUtilities, registerFlexUtilities } from '../styles/layout';
import {
  getGroupChildPositionStyles,
  getAbsolutePositionStyles,
  getPositionStylesRelativeToContainer,
  shouldAddRelativeStacking,
  hasPositionedStyle,
} from '../styles/position';
import { assignStyleClasses, registerUtilityClass, splitInlineVsClassStyles } from '../styles/classes';
import { hasImageFill } from '../assets/images';
import { semanticContainerTag, semanticContainerOpenAttrs } from './semantics';

export const convertFrame = async ({
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
  convertNode,
}: ConvertParams): Promise<ExportNode> => {
  let html = '';
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
      const sizing = registerSizingUtilities(frame, parentLayoutMode, context, parentFrame);
      classes.push(...sizing.classes);

      const inlineStyles = [...sizing.styles];
      let hasPositioningTransform = false;
      if (positionContainer) {
        inlineStyles.push(...getPositionStylesRelativeToContainer(frame, positionContainer, flattenedZIndex));
        hasPositioningTransform = true;
      } else if (parentGroup) {
        inlineStyles.push(...getGroupChildPositionStyles(frame, parentGroup));
        hasPositioningTransform = true;
      } else {
        const absoluteStyles = getAbsolutePositionStyles(frame, parentFrame);
        inlineStyles.push(...absoluteStyles);
        hasPositioningTransform = absoluteStyles.length > 0;
        if (shouldAddRelativeStacking(frame, parentFrame)) {
          inlineStyles.push('position: relative');
          const idx = parentFrame!.children.indexOf(frame);
          const z = parentFrame!.itemReverseZIndex
            ? parentFrame!.children.length - 1 - idx
            : idx + 1;
          inlineStyles.push(`z-index: ${z}`);
        }
      }
      const isRoot = context.rootNode !== null && frame.id === context.rootNode.id;
      let imageSrc: string | null = null;
      if (!isMaskNode(frame)) {
        const stacked = await appendStackedFillStyles(frame, inlineStyles, context, {
          asImgIfSoleImage: frame.children.length === 0,
          nameHint: frame.name,
        });
        imageSrc = stacked.imageSrcForImgTag;
        if (
          !imageSrc &&
          !inlineStyles.some((s) => s.startsWith('background')) &&
          hasImageFill(frame)
        ) {
          inlineStyles.push('background: #e5e7eb');
        }
      }
      if (isRoot) {
        // Replace fixed artboard width/height with responsive root constraints
        for (let i = inlineStyles.length - 1; i >= 0; i--) {
          if (inlineStyles[i].startsWith('width:') || inlineStyles[i].startsWith('height:')) {
            inlineStyles.splice(i, 1);
          }
        }
        inlineStyles.push(
          'width: 100%',
          `max-width: ${roundDim(frame.width)}px`,
          'margin-inline: auto',
          `min-height: ${roundDim(frame.height)}px`
        );
      }
      const radius = getCornerRadiusStyle(frame);
      if (radius) inlineStyles.push(radius);
      inlineStyles.push(...getStrokeStyles(frame));
      inlineStyles.push(...getEffectsStyles(frame));
      if (frame.opacity < 1) inlineStyles.push(`opacity: ${roundPx(frame.opacity)}`);
      const blend = 'blendMode' in frame ? mapBlendMode(frame.blendMode) : null;
      if (blend && blend !== 'normal') inlineStyles.push(`mix-blend-mode: ${blend}`);
      inlineStyles.push(...getClipsContentStyles(frame));
      // Figma frame dimensions include padding; use border-box so width/height match
      if (frame.layoutMode !== 'NONE') inlineStyles.push('box-sizing: border-box');
      if (!hasPositioningTransform) {
        appendNodeTransformStyles(inlineStyles, frame);
      }
      const { inline: keepInline, classLines: visualClassLines } = splitInlineVsClassStyles(inlineStyles);
      inlineStyles.length = 0;
      inlineStyles.push(...keepInline);
      if (visualClassLines.length > 0) {
        classes.push(...assignStyleClasses(baseName || 'box', visualClassLines, context));
      }
      if (classes.length === 0) {
        // Avoid empty PascalCase class with no CSS — only add if we register a minimal rule
        if (baseName && baseName !== 'frame') {
          /* skip bare name */
        } else {
          context.usedBaseClasses.add(baseName);
          if (baseName === 'frame') {
            registerUtilityClass(baseName, ['  display: block;'], context);
            classes.push(baseName);
          }
        }
      }
      // Containing block for absolute children — skip if already positioned
      // (absolute/fixed already create a containing block; relative would overwrite absolute).
      if (
        !hasPositionedStyle(inlineStyles) &&
        (frame.layoutMode === 'NONE'
          ? frame.children.length > 0
          : frame.children.some(
              (child) =>
                'layoutPositioning' in child && child.layoutPositioning === 'ABSOLUTE'
            ))
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
      const tag = semanticContainerTag(node.name || baseName || '');
      const tagAttrs = semanticContainerOpenAttrs(tag);
      html += openPrefix + `<${tag} ${tagAttrs}${dataLayer}${getClassAttr(finalClasses)}${getStyleAttr(inlineStyles)}>`;
      if (imageSrc) {
        const imgIndent = '  '.repeat(baseIndent + indent + 1);
        html +=
          '\n' +
          imgIndent +
          `<img src="${imageSrc}" alt="" style="display: block; width: 100%; height: 100%; object-fit: cover" />`;
      }

      const childParentLayoutMode =
        frame.layoutMode === 'NONE' ? null : frame.layoutMode;
      const childParentFrame =
        frame.layoutMode === 'NONE' ? null : frame;
      const childParentGroup =
        frame.layoutMode === 'NONE' ? frame : null;
      const frameChildren = Array.from(frame.children);
      const runFrameChild = async (c: SceneNode, posContainer: SceneNode | null, z: number) => {
        const out = await convertNode(
          c,
          context,
          childParentLayoutMode,
          childParentFrame,
          childParentGroup,
          indent + 1,
          baseIndent,
          posContainer,
          z
        );
        return out.html;
      };
      let i = 0;
      while (i < frameChildren.length) {
        const child = frameChildren[i];
        const isGroup = child.type === 'GROUP' || child.type === 'TRANSFORM_GROUP';
        if (frame.layoutMode === 'NONE' && isGroup) {
          const group = child as GroupNode;
          const groupChildren = Array.from(group.children);
          let j = 0;
          while (j < groupChildren.length) {
            const gc = groupChildren[j] as SceneNode;
            if (isMaskNode(gc)) {
              let k = j + 1;
              while (k < groupChildren.length && !isMaskNode(groupChildren[k] as SceneNode)) k++;
              const maskedCount = k - j - 1;
              // Skip empty mask source node; only emit the masked wrapper
              if (maskedCount > 0) {
                const wrapperStyles: string[] = [
                  `width: ${roundDim(gc.width)}px`,
                  `height: ${roundDim(gc.height)}px`,
                  'position: absolute',
                  'overflow: hidden',
                ];
                await appendMaskWrapperStyles(gc, wrapperStyles, context);
                wrapperStyles.push(...getPositionStylesRelativeToContainer(gc, frame, j + 1));
                const innerIndent = '  '.repeat(baseIndent + indent + 1);
                html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
                for (let m = j + 1; m < k; m++) {
                  html += await runFrameChild(groupChildren[m] as SceneNode, gc, m - j - 1);
                }
                html += '\n' + innerIndent + '</div>';
              }
              j = k;
            } else {
              html += await runFrameChild(gc, frame, j);
              j++;
            }
          }
          i++;
        } else if (isMaskNode(child)) {
          let k = i + 1;
          while (k < frameChildren.length && !isMaskNode(frameChildren[k])) k++;
          const maskedCount = k - i - 1;
          // Skip empty mask source node; only emit the masked wrapper
          if (maskedCount > 0) {
            const wrapperStyles: string[] = [
              `width: ${roundDim(child.width)}px`,
              `height: ${roundDim(child.height)}px`,
              'position: absolute',
              'overflow: hidden',
            ];
            await appendMaskWrapperStyles(child, wrapperStyles, context);
            const idx = i + 1;
            const z = frame.itemReverseZIndex ? frameChildren.length - 1 - idx : idx + 1;
            wrapperStyles.push(...getPositionStylesRelativeToContainer(child, frame, z));
            const innerIndent = '  '.repeat(baseIndent + indent + 1);
            html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
            for (let m = i + 1; m < k; m++) {
              html += await runFrameChild(frameChildren[m], child, m - i - 1);
            }
            html += '\n' + innerIndent + '</div>';
          }
          i = k;
        } else {
          html += await runFrameChild(child, null, 0);
          i++;
        }
      }

      html += closePrefix + `</${tag}>`;
  return { html };
};
