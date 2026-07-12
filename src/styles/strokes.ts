import { toCssColor, roundDim } from '../utils/color';
import { paintToCssBackground } from './fills';
import type { FigmaGradientPaint } from '../types';

export type SideStrokeWeights = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const hasInvisibleStrokesOnly = (node: GeometryMixin): boolean => {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return false;
  const hasVisibleStroke = node.strokes.some((p) => {
    if (p.visible === false) return false;
    const opacity = p.opacity ?? 1;
    return opacity > 0;
  });
  return !hasVisibleStroke;
};

export const getStrokePaint = (node: GeometryMixin): SolidPaint | FigmaGradientPaint | null => {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return null;
  const p = node.strokes.find((paint) => paint.visible !== false);
  if (!p || (p.type !== 'SOLID' && p.type !== 'GRADIENT_LINEAR' && p.type !== 'GRADIENT_RADIAL' && p.type !== 'GRADIENT_ANGULAR' && p.type !== 'GRADIENT_DIAMOND')) return null;
  const opacity = p.opacity ?? 1;
  if (opacity <= 0) return null;
  return p as SolidPaint | FigmaGradientPaint;
};

/** CSS value for stroke paint (color string or gradient). */
export const strokePaintToCss = (
  paint: SolidPaint | FigmaGradientPaint,
  size?: { width: number; height: number }
): string => {
  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color;
    return toCssColor(r, g, b, paint.opacity ?? 1);
  }
  return paintToCssBackground(paint as FigmaGradientPaint, size);
};

/** Whether the node has a dashed stroke (dashPattern / strokeDashes). Plugin API may use strokeDashes. */
export const getStrokeDashPattern = (node: SceneNode): number[] | null => {
  const dashes = (node as { strokeDashes?: number[]; dashPattern?: number[] }).strokeDashes ?? (node as { dashPattern?: number[] }).dashPattern;
  if (!Array.isArray(dashes) || dashes.length === 0) return null;
  return dashes;
};

/** strokeAlign: INSIDE | CENTER | OUTSIDE. */
export const getStrokeAlign = (node: SceneNode): 'INSIDE' | 'CENTER' | 'OUTSIDE' => {
  if (!('strokeAlign' in node)) return 'INSIDE';
  const v = (node as { strokeAlign?: string }).strokeAlign;
  if (v === 'CENTER' || v === 'OUTSIDE') return v;
  return 'INSIDE';
};

/**
 * Individual stroke weights (Figma IndividualStrokesMixin on frames/rectangles).
 * Returns null when the node does not support per-side strokes.
 */
export const getSideStrokeWeights = (node: SceneNode): SideStrokeWeights | null => {
  if (!('strokeTopWeight' in node)) return null;
  const n = node as SceneNode & {
    strokeTopWeight?: number;
    strokeRightWeight?: number;
    strokeBottomWeight?: number;
    strokeLeftWeight?: number;
  };
  return {
    top: roundDim(typeof n.strokeTopWeight === 'number' ? n.strokeTopWeight : 0),
    right: roundDim(typeof n.strokeRightWeight === 'number' ? n.strokeRightWeight : 0),
    bottom: roundDim(typeof n.strokeBottomWeight === 'number' ? n.strokeBottomWeight : 0),
    left: roundDim(typeof n.strokeLeftWeight === 'number' ? n.strokeLeftWeight : 0),
  };
};

const isUniformSideWeights = (sides: SideStrokeWeights): boolean =>
  sides.top === sides.right && sides.right === sides.bottom && sides.bottom === sides.left;

/** True when per-side weights differ (or strokeWeight is mixed). */
export const hasIndividualStrokes = (node: SceneNode): boolean => {
  const sides = getSideStrokeWeights(node);
  if (!sides) return false;
  if (!isUniformSideWeights(sides)) return true;
  if ('strokeWeight' in node && (node as { strokeWeight?: number | symbol }).strokeWeight === figma.mixed) {
    return true;
  }
  return false;
};

/** Uniform strokeWeight in px; prefers side weights when mixed/individual. */
export const getStrokeWeight = (node: SceneNode): number => {
  const sides = getSideStrokeWeights(node);
  if (sides && (hasIndividualStrokes(node) || ('strokeWeight' in node && (node as { strokeWeight?: number | symbol }).strokeWeight === figma.mixed))) {
    return Math.max(sides.top, sides.right, sides.bottom, sides.left);
  }
  if (!('strokeWeight' in node) || (node as { strokeWeight?: number | symbol }).strokeWeight === figma.mixed) {
    if (sides) return Math.max(sides.top, sides.right, sides.bottom, sides.left);
    return 1;
  }
  const w = (node as { strokeWeight: number }).strokeWeight;
  return roundDim(typeof w === 'number' ? w : 1);
};

const pushIndividualSolidBorders = (
  styles: string[],
  sides: SideStrokeWeights,
  color: string,
  dashed: boolean
) => {
  const style = dashed ? 'dashed' : 'solid';
  if (sides.top > 0) styles.push(`border-top: ${sides.top}px ${style} ${color}`);
  if (sides.right > 0) styles.push(`border-right: ${sides.right}px ${style} ${color}`);
  if (sides.bottom > 0) styles.push(`border-bottom: ${sides.bottom}px ${style} ${color}`);
  if (sides.left > 0) styles.push(`border-left: ${sides.left}px ${style} ${color}`);
  if (sides.top > 0 || sides.right > 0 || sides.bottom > 0 || sides.left > 0) {
    styles.push('box-sizing: border-box');
  }
};

const strokesIncludedInLayout = (node: SceneNode): boolean =>
  'strokesIncludedInLayout' in node &&
  (node as { strokesIncludedInLayout?: boolean }).strokesIncludedInLayout === true;

const getVisibleStrokePaints = (
  node: GeometryMixin
): Array<SolidPaint | FigmaGradientPaint> => {
  if (!('strokes' in node) || !Array.isArray(node.strokes)) return [];
  return node.strokes.filter((p) => {
    if (p.visible === false) return false;
    if (
      p.type !== 'SOLID' &&
      p.type !== 'GRADIENT_LINEAR' &&
      p.type !== 'GRADIENT_RADIAL' &&
      p.type !== 'GRADIENT_ANGULAR' &&
      p.type !== 'GRADIENT_DIAMOND'
    ) {
      return false;
    }
    return (p.opacity ?? 1) > 0;
  }) as Array<SolidPaint | FigmaGradientPaint>;
};

export const getStrokeStyles = (node: GeometryMixin): string[] => {
  const styles: string[] = [];
  const paints = getVisibleStrokePaints(node);
  if (paints.length === 0) return styles;

  const stroke = paints[0];
  const scene = node as SceneNode;
  const sides = getSideStrokeWeights(scene);
  const individual = hasIndividualStrokes(scene);
  const w = getStrokeWeight(scene);
  if (w <= 0 && !(sides && (sides.top > 0 || sides.right > 0 || sides.bottom > 0 || sides.left > 0))) {
    return styles;
  }

  const align = getStrokeAlign(scene);
  const included = strokesIncludedInLayout(scene);
  const dashPattern = getStrokeDashPattern(scene);
  const isDashed = dashPattern !== null && dashPattern.length > 0;

  const isGradient = stroke.type !== 'SOLID';
  const size =
    'width' in node && 'height' in node
      ? { width: (node as { width: number }).width, height: (node as { height: number }).height }
      : undefined;
  const strokeCss = strokePaintToCss(stroke, size);
  const shadowParts: string[] = [];

  // Per-side solid borders (Figma individual strokes)
  if (individual && sides && !isGradient) {
    pushIndividualSolidBorders(styles, sides, strokeCss, isDashed);
    return styles;
  }

  if (w <= 0) return styles;

  if (isGradient) {
    if (individual && sides) {
      styles.push(`border-style: solid`);
      styles.push(`border-width: ${sides.top}px ${sides.right}px ${sides.bottom}px ${sides.left}px`);
      styles.push('border-color: transparent');
    } else {
      styles.push(`border: ${w}px solid transparent`);
    }
    styles.push(`border-image: ${strokeCss} 1`);
    styles.push('border-image-slice: 1');
    styles.push('box-sizing: border-box');
  } else if (align === 'INSIDE') {
    shadowParts.push(`inset 0 0 0 ${w}px ${strokeCss}`);
  } else if (align === 'OUTSIDE' || (!included && align === 'CENTER')) {
    // Outside, or center when stroke is excluded from layout → don't grow the box
    styles.push(`outline: ${w}px solid ${strokeCss}`);
    styles.push('outline-offset: 0');
  } else if (included || align === 'CENTER') {
    styles.push(`border: ${w}px solid ${strokeCss}`);
    styles.push('box-sizing: border-box');
  } else {
    shadowParts.push(`0 0 0 ${w}px ${strokeCss}`);
  }

  // Additional solid strokes as outer rings (approx) — merge into one box-shadow
  for (let i = 1; i < paints.length; i++) {
    const p = paints[i];
    if (p.type !== 'SOLID') continue;
    const color = strokePaintToCss(p, size);
    const extraW = w + i;
    shadowParts.push(`0 0 0 ${extraW}px ${color}`);
  }
  if (shadowParts.length > 0) styles.push(`box-shadow: ${shadowParts.join(', ')}`);

  if (isDashed && !individual) {
    styles.push('border-style: dashed');
  }

  return styles;
};
