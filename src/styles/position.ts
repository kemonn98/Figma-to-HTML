import type { ParentGroupLike } from '../types';
import { roundPx, roundPx4, isMeaningfulRotation, cssRotationDeg } from '../utils/color';

export const isAbsoluteChild = (node: SceneNode, parentFrame: FrameNode | null) =>
  !!parentFrame &&
  'layoutPositioning' in node &&
  node.layoutPositioning === 'ABSOLUTE';

/** Position styles for children of a Group. Group children use explicit x,y (and optional constraints). */
export const getGroupChildPositionStyles = (
  node: SceneNode,
  parentGroup: ParentGroupLike
): string[] => {
  const styles: string[] = ['position: absolute'];
  const zIndex = parentGroup.children.indexOf(node);
  if (zIndex >= 0) styles.push(`z-index: ${zIndex}`);

  const rot = 'rotation' in node ? (node as { rotation: number }).rotation : 0;
  const rotated = isMeaningfulRotation(rot);
  const parentBounds = parentGroup.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;

  // Prefer AABB relative to parent. For rotated nodes, node.x/y can be far off
  // (e.g. thousands of px); place the box so its center matches the AABB center,
  // then rotate around center so the visual matches Figma.
  let left: number;
  let top: number;
  let useCenterOrigin = false;
  if (parentBounds && nodeBounds) {
    if (rotated) {
      left = nodeBounds.x - parentBounds.x + (nodeBounds.width - node.width) / 2;
      top = nodeBounds.y - parentBounds.y + (nodeBounds.height - node.height) / 2;
      useCenterOrigin = true;
    } else {
      left = nodeBounds.x - parentBounds.x;
      top = nodeBounds.y - parentBounds.y;
    }
  } else {
    left = node.x;
    top = node.y;
  }
  const rawLeft = left;
  const rawTop = top;
  const leftPx = roundPx(left);
  const topPx = roundPx(top);
  const right = roundPx(parentGroup.width - (rawLeft + node.width));
  const bottom = roundPx(parentGroup.height - (rawTop + node.height));
  const constraints =
    'constraints' in node ? node.constraints : { horizontal: 'MIN', vertical: 'MIN' };
  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = rawLeft + node.width / 2;
      const offsetX = roundPx(centerX - parentGroup.width / 2);
      styles.push('left: 50%');
      transformParts.push('translateX(-50%)');
      if (Math.round(offsetX) !== 0) transformParts.push(`translateX(${offsetX}px)`);
      break;
    }
    case 'STRETCH':
      styles.push(`left: ${leftPx}px`, `right: ${right}px`);
      break;
    default:
      styles.push(`left: ${leftPx}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = rawTop + node.height / 2;
      const offsetY = roundPx(centerY - parentGroup.height / 2);
      styles.push('top: 50%');
      transformParts.push('translateY(-50%)');
      if (Math.round(offsetY) !== 0) transformParts.push(`translateY(${offsetY}px)`);
      break;
    }
    case 'STRETCH':
      styles.push(`top: ${topPx}px`, `bottom: ${bottom}px`);
      break;
    default:
      styles.push(`top: ${topPx}px`);
      break;
  }

  if (rotated) {
    styles.push(useCenterOrigin ? 'transform-origin: center center' : 'transform-origin: 0 0');
    transformParts.push(`rotate(${cssRotationDeg(rot)}deg)`);
  }
  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }
  return styles;
};

export const getAbsolutePositionStyles = (
  node: SceneNode,
  parentFrame: FrameNode | null
) => {
  const styles: string[] = [];
  if (
    !parentFrame ||
    !('layoutPositioning' in node) ||
    node.layoutPositioning !== 'ABSOLUTE'
  ) {
    return styles;
  }

  styles.push('position: absolute');
  const zIndex = parentFrame.children.indexOf(node);
  if (zIndex >= 0) {
    styles.push(`z-index: ${zIndex}`);
  }
  const constraints =
    'constraints' in node
      ? node.constraints
      : { horizontal: 'MIN', vertical: 'MIN' };

  const left = roundPx(node.x);
  const top = roundPx(node.y);
  const right = roundPx(parentFrame.width - (node.x + node.width));
  const bottom = roundPx(parentFrame.height - (node.y + node.height));

  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = node.x + node.width / 2;
      const offsetX = roundPx(centerX - parentFrame.width / 2);
      styles.push('left: 50%');
      transformParts.push('translateX(-50%)');
      if (Math.round(offsetX) !== 0) {
        transformParts.push(`translateX(${offsetX}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`left: ${left}px`);
      styles.push(`right: ${right}px`);
      break;
    default:
      styles.push(`left: ${left}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = node.y + node.height / 2;
      const offsetY = roundPx(centerY - parentFrame.height / 2);
      styles.push('top: 50%');
      transformParts.push('translateY(-50%)');
      if (Math.round(offsetY) !== 0) {
        transformParts.push(`translateY(${offsetY}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`top: ${top}px`);
      styles.push(`bottom: ${bottom}px`);
      break;
    default:
      styles.push(`top: ${top}px`);
      break;
  }

  if (isMeaningfulRotation(node.rotation)) {
    styles.push('transform-origin: 0 0');
    transformParts.push(`rotate(${cssRotationDeg(node.rotation)}deg)`);
  }

  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }

  return styles;
};

/** Position styles relative to a container. When container is a mask node, use parent-relative (node.x - container.x, node.y - container.y). decimals: 2 = roundPx, 4 = higher precision for rotated vectors. */
export const getPositionStylesRelativeToContainer = (
  node: SceneNode,
  container: { absoluteBoundingBox?: { x: number; y: number } | null; x?: number; y?: number },
  zIndex: number,
  decimals: 2 | 4 = 2
): string[] => {
  const round = decimals === 4 ? roundPx4 : roundPx;
  const styles = ['position: absolute', `z-index: ${zIndex}`];
  if (container && 'isMask' in container && (container as { isMask?: boolean }).isMask === true && typeof (container as { x?: number }).x === 'number' && typeof (container as { y?: number }).y === 'number') {
    const left = round(node.x - (container as { x: number }).x);
    const top = round(node.y - (container as { y: number }).y);
    styles.push(`left: ${left}px`, `top: ${top}px`);
    return styles;
  }
  const containerBounds = container.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;
  if (containerBounds && nodeBounds) {
    const left = round(nodeBounds.x - containerBounds.x);
    const top = round(nodeBounds.y - containerBounds.y);
    styles.push(`left: ${left}px`, `top: ${top}px`);
  } else {
    styles.push(`left: ${round(node.x)}px`, `top: ${round(node.y)}px`);
  }
  return styles;
};

export const parentHasAbsoluteChildren = (parent: FrameNode | null): boolean => {
  if (!parent || !('children' in parent)) return false;
  return parent.children.some(
    (c) => 'layoutPositioning' in c && c.layoutPositioning === 'ABSOLUTE'
  );
};

export const shouldAddRelativeStacking = (
  node: SceneNode,
  parentFrame: FrameNode | null
): boolean => {
  if (!parentFrame || isAbsoluteChild(node, parentFrame)) return false;
  return parentHasAbsoluteChildren(parentFrame);
};
