import type { ConvertParams, ExportContext, ExportNode, ConvertNodeFn } from '../types';
import { toCssClassBase, ensureValidCssClassName, getDataLayerAttr } from '../utils/names';
import { isMaskNode, getMaskType } from '../styles/mask';
import { tickNodeProgress } from '../export/progress';
import { convertFrame } from './frame';
import { convertGroup } from './group';
import { convertText } from './text';
import { convertRectangle } from './rectangle';
import { convertEllipse } from './ellipse';
import { convertVector, isVectorNode } from './vector';

export const findHeroHeadingNodeId = (root: SceneNode): string | null => {
  const rootH = 'height' in root ? root.height : 0;
  const band = Math.min(900, rootH * 0.2);
  let bestId: string | null = null;
  let bestSize = -1;
  let bestY = Infinity;

  const walk = (n: SceneNode) => {
    if (n.visible === false) return;
    if (n.type === 'TEXT') {
      const t = n as TextNode;
      const size = typeof t.fontSize === 'number' ? t.fontSize : 0;
      const y = t.y;
      if (size >= 40 && y < band) {
        if (size > bestSize || (size === bestSize && y < bestY)) {
          bestId = t.id;
          bestSize = size;
          bestY = y;
        }
      }
    }
    if ('children' in n) {
      for (const c of n.children) walk(c as SceneNode);
    }
  };
  walk(root);
  return bestId;
};

const buildConvertParams = (
  node: SceneNode,
  context: ExportContext,
  parentLayoutMode: FrameNode['layoutMode'] | null,
  parentFrame: FrameNode | null,
  parentGroup: GroupNode | FrameNode | null,
  indent: number,
  baseIndent: number,
  positionContainer: SceneNode | null,
  flattenedZIndex: number,
  convertNode: ConvertNodeFn
): ConvertParams => {
  const openPrefix = (indent === 0 && baseIndent === 0 ? '' : '\n') + '  '.repeat(baseIndent + indent);
  const closePrefix = '\n' + '  '.repeat(baseIndent + indent);
  const pascalName = toCssClassBase(node.name) || ensureValidCssClassName(`Node${node.id.replace(/[^a-zA-Z0-9]/g, '')}`);
  const baseName = pascalName;
  let dataLayer = getDataLayerAttr(node.name);
  if (isMaskNode(node)) {
    const mt = getMaskType(node);
    dataLayer += ` data-figma-mask="true"${mt ? ` data-figma-mask-type="${mt}"` : ''}`;
  }
  return {
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
    convertNode,
  };
};

export const nodeToHtmlCss: ConvertNodeFn = async (
  node,
  context,
  parentLayoutMode = null,
  parentFrame = null,
  parentGroup = null,
  indent = 0,
  baseIndent = 0,
  positionContainer = null,
  flattenedZIndex = 0
): Promise<ExportNode> => {
  if (node.visible === false) {
    return { html: '' };
  }

  tickNodeProgress(context, node);

  const params = buildConvertParams(
    node,
    context,
    parentLayoutMode,
    parentFrame,
    parentGroup,
    indent,
    baseIndent,
    positionContainer ?? null,
    flattenedZIndex ?? 0,
    nodeToHtmlCss
  );

  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    return convertFrame(params);
  }

  if (node.type === 'GROUP' || node.type === 'TRANSFORM_GROUP') {
    return convertGroup(params);
  }

  if (node.type === 'TEXT') {
    return convertText(params);
  }

  if (node.type === 'RECTANGLE') {
    return convertRectangle(params);
  }

  if (node.type === 'ELLIPSE') {
    const ellipseResult = await convertEllipse(params);
    if (ellipseResult) return ellipseResult;
  }

  if (isVectorNode(node)) {
    return convertVector(params);
  }

  return { html: '' };
};
