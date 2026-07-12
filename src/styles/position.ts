import type { ParentGroupLike } from '../types';
import { roundPx, roundPx4 } from '../utils/color';
import { getNodeTransformParts, leftTopCenteredOnAabb } from '../utils/transform';

export const isAbsoluteChild = (node: SceneNode, parentFrame: FrameNode | null) =>
  !!parentFrame &&
  'layoutPositioning' in node &&
  node.layoutPositioning === 'ABSOLUTE';

/** True if styles already set a non-static position (absolute creates a containing block). */
export const hasPositionedStyle = (styles: string[]): boolean =>
  styles.some((s) => /^position:\s*(absolute|fixed|relative|sticky)\b/i.test(s));

/** Position styles for children of a Group. Group children use explicit x,y (and optional constraints). */
export const getGroupChildPositionStyles = (
  node: SceneNode,
  parentGroup: ParentGroupLike
): string[] => {
  const styles: string[] = ['position: absolute'];
  const zIndex = parentGroup.children.indexOf(node);
  if (zIndex >= 0) styles.push(`z-index: ${zIndex}`);

  const { parts: nodeTransformParts, hasRotation, hasFlip } = getNodeTransformParts(node);
  const transformed = hasRotation || hasFlip;
  const parentBounds = parentGroup.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;

  // Prefer AABB relative to parent. For rotated/flipped nodes, place CSS box so its center
  // matches the AABB center, then rotate/flip around center (Figma UI pivot).
  let left: number;
  let top: number;
  if (parentBounds && nodeBounds) {
    if (transformed) {
      const c = leftTopCenteredOnAabb(node, parentBounds, nodeBounds);
      left = c.left;
      top = c.top;
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

  if (transformed) {
    styles.push('transform-origin: center center');
    transformParts.push(...nodeTransformParts);
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

  const { parts: nodeTransformParts, hasRotation, hasFlip } = getNodeTransformParts(node);
  const transformed = hasRotation || hasFlip;

  // Flipped/rotated: prefer AABB so top/left match the visual box (node.x/y are matrix translation)
  const parentBounds = parentFrame.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;
  let posX = node.x;
  let posY = node.y;
  const boxW = node.width;
  const boxH = node.height;
  if (transformed && parentBounds && nodeBounds) {
    const c = leftTopCenteredOnAabb(node, parentBounds, nodeBounds);
    posX = c.left;
    posY = c.top;
  }

  const left = roundPx(posX);
  const top = roundPx(posY);
  const right = roundPx(parentFrame.width - (posX + boxW));
  const bottom = roundPx(parentFrame.height - (posY + boxH));

  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = posX + boxW / 2;
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
    case 'SCALE': {
      if (parentFrame.width > 0) {
        const leftPct = roundPx((posX / parentFrame.width) * 100);
        const widthPct = roundPx((boxW / parentFrame.width) * 100);
        styles.push(`left: ${leftPct}%`);
        styles.push(`width: ${widthPct}%`);
      } else {
        styles.push(`left: ${left}px`);
      }
      break;
    }
    default:
      styles.push(`left: ${left}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = posY + boxH / 2;
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
    case 'SCALE': {
      if (parentFrame.height > 0) {
        const topPct = roundPx((posY / parentFrame.height) * 100);
        const heightPct = roundPx((boxH / parentFrame.height) * 100);
        styles.push(`top: ${topPct}%`);
        styles.push(`height: ${heightPct}%`);
      } else {
        styles.push(`top: ${top}px`);
      }
      break;
    }
    default:
      styles.push(`top: ${top}px`);
      break;
  }

  if (transformed) {
    styles.push('transform-origin: center center');
    transformParts.push(...nodeTransformParts);
  }

  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }

  return styles;
};

/** Position styles relative to a container. When container is a mask node, offset into the mask. decimals: 2 = roundPx, 4 = higher precision for rotated vectors. */
export const getPositionStylesRelativeToContainer = (
  node: SceneNode,
  container: { absoluteBoundingBox?: { x: number; y: number } | null; x?: number; y?: number },
  zIndex: number,
  decimals: 2 | 4 = 2
): string[] => {
  const round = decimals === 4 ? roundPx4 : roundPx;
  const styles = ['position: absolute', `z-index: ${zIndex}`];
  const isMaskContainer =
    !!container &&
    'isMask' in container &&
    (container as { isMask?: boolean }).isMask === true &&
    typeof (container as { x?: number }).x === 'number' &&
    typeof (container as { y?: number }).y === 'number';

  if (isMaskContainer) {
    const mask = container as SceneNode & { x: number; y: number };
    const { hasRotation, hasFlip } = getNodeTransformParts(node);
    const nodeBounds = node.absoluteBoundingBox;
    const maskBounds = mask.absoluteBoundingBox;

    // Flipped/rotated: node.x/y are transform translation, not visual top-left.
    // Place CSS box centered on AABB (relative to mask), then apply scale/rotate around center.
    if ((hasRotation || hasFlip) && nodeBounds && maskBounds) {
      const c = leftTopCenteredOnAabb(node, maskBounds, nodeBounds);
      styles.push(`left: ${round(c.left)}px`, `top: ${round(c.top)}px`);
      return styles;
    }

    styles.push(
      `left: ${round(node.x - mask.x)}px`,
      `top: ${round(node.y - mask.y)}px`
    );
    return styles;
  }

  const containerBounds = container.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;
  if (containerBounds && nodeBounds) {
    const { hasRotation, hasFlip } = getNodeTransformParts(node);
    if (hasRotation || hasFlip) {
      const c = leftTopCenteredOnAabb(node, containerBounds, nodeBounds);
      styles.push(`left: ${round(c.left)}px`, `top: ${round(c.top)}px`);
    } else {
      const left = round(nodeBounds.x - containerBounds.x);
      const top = round(nodeBounds.y - containerBounds.y);
      styles.push(`left: ${left}px`, `top: ${top}px`);
    }
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
