import type { ConvertParams, ExportNode } from '../types';
import { roundPx, isMeaningfulRotation, cssRotationDeg } from '../utils/color';
import { getClassAttr, getStyleAttr } from '../utils/html';
import { getSolidFill, getLayerBlurRadius } from '../styles/fills';
import { isMaskNode } from '../styles/mask';
import { getPositionStylesRelativeToContainer } from '../styles/position';
import { getUniqueClassName } from '../styles/classes';

export const convertEllipse = async ({
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
  pascalName,
  baseName: _baseName,
  dataLayer,
  convertNode: _convertNode,
}: ConvertParams): Promise<ExportNode | null> => {
  let html = '';
      const ellipse = node as EllipseNode;
      const fill = getSolidFill(ellipse);
      const blurRadius = getLayerBlurRadius(ellipse as BlendMixin);
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
        const rotated = isMeaningfulRotation(ellipse.rotation);
        const aabb = ellipse.absoluteBoundingBox;
        const blurPx = roundPx(blurRadius / 2);

        if (rotated && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number') {
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
            `transform: translate(-50%, -50%) rotate(${cssRotationDeg(ellipse.rotation)}deg)`,
            'border-radius: 9999px',
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
          inlineStyles.push('border-radius: 9999px');
          inlineStyles.push(`filter: blur(${blurPx}px)`);
          html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}></div>`;
        }
        return { html };
      }
  return html ? { html } : null;
};
