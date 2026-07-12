import { isMeaningfulRotation, cssRotationDeg } from './color';

export type NodeFlip = {
  horizontal: boolean;
  vertical: boolean;
};

/**
 * Detect Figma Flip Horizontal / Flip Vertical from `relativeTransform`.
 * Plugin API has no flipH/flipV flags — flips are reflections in the 2×2 matrix.
 * Decompose as M ≈ R(rotation) · S(±1, ±1) and read local scale signs.
 */
export const getNodeFlip = (node: SceneNode): NodeFlip => {
  if (!('relativeTransform' in node)) {
    return { horizontal: false, vertical: false };
  }
  const t = node.relativeTransform;
  const a = t[0][0];
  const b = t[0][1];
  const c = t[1][0];
  const d = t[1][1];

  const rotDeg = 'rotation' in node ? (node as { rotation: number }).rotation : 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  // Peel rotation: S ≈ Rᵀ · M (Figma linear part ≈ R · S with unit axes)
  const scaleX = a * cos - c * sin;
  const scaleY = b * sin + d * cos;

  return {
    horizontal: scaleX < -0.1,
    vertical: scaleY < -0.1,
  };
};

export const isMeaningfulFlip = (flip: NodeFlip): boolean =>
  flip.horizontal || flip.vertical;

export const nodeHasFlip = (node: SceneNode): boolean => isMeaningfulFlip(getNodeFlip(node));

export const nodeHasTransform = (node: SceneNode): boolean => {
  const { hasRotation, hasFlip } = getNodeTransformParts(node);
  return hasRotation || hasFlip;
};

/**
 * Place the CSS box so its center matches the visual AABB center (parent-relative).
 * Use with `transform-origin: center` for rotate/flip — matches Figma UI pivot.
 */
export const leftTopCenteredOnAabb = (
  node: { width: number; height: number },
  parentBounds: { x: number; y: number },
  nodeBounds: { x: number; y: number; width: number; height: number }
): { left: number; top: number } => ({
  left: nodeBounds.x - parentBounds.x + (nodeBounds.width - node.width) / 2,
  top: nodeBounds.y - parentBounds.y + (nodeBounds.height - node.height) / 2,
});

/**
 * CSS rotate / scaleX(-1) / scaleY(-1) fragments for a node.
 * Caller prepends translate* as needed; apply as `transform: …` (scale after rotate in the list
 * = scale in local space first, matching Figma R·S).
 */
export const getNodeTransformParts = (
  node: SceneNode
): { parts: string[]; hasRotation: boolean; hasFlip: boolean; flip: NodeFlip } => {
  const flip = getNodeFlip(node);
  const rot = 'rotation' in node ? (node as { rotation: number }).rotation : 0;
  const hasRotation = isMeaningfulRotation(rot);
  const hasFlip = isMeaningfulFlip(flip);
  const parts: string[] = [];
  if (hasRotation) parts.push(`rotate(${cssRotationDeg(rot)}deg)`);
  if (flip.horizontal) parts.push('scaleX(-1)');
  if (flip.vertical) parts.push('scaleY(-1)');
  return { parts, hasRotation, hasFlip, flip };
};

/**
 * Append transform-origin (always center) + transform for rotation and/or flip.
 * Skips if a `transform:` is already present (position helpers win).
 * Pair with AABB-centered left/top when the node is absolutely positioned.
 */
export const appendNodeTransformStyles = (styles: string[], node: SceneNode): void => {
  if (styles.some((s) => s.startsWith('transform:'))) return;
  const { parts } = getNodeTransformParts(node);
  if (parts.length === 0) return;
  if (!styles.some((s) => s.startsWith('transform-origin:'))) {
    styles.push('transform-origin: center center');
  }
  styles.push(`transform: ${parts.join(' ')}`);
};
