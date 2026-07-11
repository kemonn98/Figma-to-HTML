import { toCssColor, roundDim } from '../utils/color';
import { paintToCssBackground } from './fills';
import type { FigmaGradientPaint } from '../types';

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
export const strokePaintToCss = (paint: SolidPaint | FigmaGradientPaint): string => {
  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color;
    return toCssColor(r, g, b, paint.opacity ?? 1);
  }
  return paintToCssBackground(paint as FigmaGradientPaint);
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

/** strokeWeight in px; can be figma.mixed. */
export const getStrokeWeight = (node: SceneNode): number => {
  if (!('strokeWeight' in node) || (node as { strokeWeight?: number | symbol }).strokeWeight === figma.mixed) return 1;
  const w = (node as { strokeWeight: number }).strokeWeight;
  return roundDim(typeof w === 'number' ? w : 1);
};

export const getStrokeStyles = (node: GeometryMixin): string[] => {
  const styles: string[] = [];
  const stroke = getStrokePaint(node);
  if (!stroke) return styles;

  const w = getStrokeWeight(node as SceneNode);
  if (w <= 0) return styles;
  const align = getStrokeAlign(node as SceneNode);
  const dashPattern = getStrokeDashPattern(node as SceneNode);
  const isDashed = dashPattern !== null && dashPattern.length > 0;

  const isGradient = stroke.type !== 'SOLID';
  const strokeCss = strokePaintToCss(stroke);

  if (isGradient) {
    // Gradient stroke: use border-image (position is effectively center). Note: border-image ignores border-radius in CSS.
    styles.push(`border: ${w}px solid transparent`);
    styles.push(`border-image: ${strokeCss} 1`);
    styles.push('border-image-slice: 1');
  } else {
    if (align === 'INSIDE') {
      styles.push(`box-shadow: inset 0 0 0 ${w}px ${strokeCss}`);
    } else if (align === 'OUTSIDE') {
      styles.push(`outline: ${w}px solid ${strokeCss}`);
      styles.push('outline-offset: 0');
    } else {
      styles.push(`border: ${w}px solid ${strokeCss}`);
    }
  }

  if (isDashed) {
    // For divs, border-style: dashed is the only option; exact dash pattern is SVG-only (stroke-dasharray).
    styles.push('border-style: dashed');
  }

  return styles;
};
