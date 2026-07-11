import { toCssColor, roundDim } from '../utils/color';
import type { FigmaGradientPaint } from '../types';

export const getLayerBlurRadius = (node: BlendMixin): number => {
  if (!('effects' in node) || !node.effects.length) return 0;
  const blur = node.effects.find((e) => e.type === 'LAYER_BLUR' && e.visible !== false);
  return blur && blur.type === 'LAYER_BLUR' ? blur.radius : 0;
};

/**
 * Figma "Clip content" → CSS overflow clipping.
 * Must be honored for frame masking (rounded frames, overflowing children, absolute layers).
 */
export const getClipsContentStyles = (node: SceneNode): string[] => {
  if (!('clipsContent' in node)) return [];
  if ((node as FrameNode).clipsContent !== true) return [];
  const styles: string[] = ['overflow: hidden'];
  // Pair with clip-path when the frame has corner radius so children clip to the rounded shape
  // (overflow + border-radius alone can fail for some absolute/transformed descendants).
  if (
    'cornerRadius' in node &&
    node.cornerRadius !== figma.mixed &&
    typeof node.cornerRadius === 'number' &&
    node.cornerRadius > 0
  ) {
    styles.push(`clip-path: inset(0 round ${roundDim(node.cornerRadius)}px)`);
  } else if ('topLeftRadius' in node) {
    const n = node as SceneNode & {
      topLeftRadius?: number;
      topRightRadius?: number;
      bottomRightRadius?: number;
      bottomLeftRadius?: number;
    };
    const tl = roundDim(n.topLeftRadius ?? 0);
    const tr = roundDim(n.topRightRadius ?? 0);
    const br = roundDim(n.bottomRightRadius ?? 0);
    const bl = roundDim(n.bottomLeftRadius ?? 0);
    if (tl || tr || br || bl) {
      styles.push(`clip-path: inset(0 round ${tl}px ${tr}px ${br}px ${bl}px)`);
    }
  }
  return styles;
};

export const getSolidFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((paint) => paint.type === 'SOLID' && paint.visible !== false) as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return toCssColor(r, g, b, a);
};

export const getSolidTextFill = (text: TextNode) => {
  if (text.fills === figma.mixed) return null;
  const fill = text.fills.find((paint) => paint.type === 'SOLID' && paint.visible !== false) as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return toCssColor(r, g, b, a);
};

/** Transform is 2x3: [[a, b, tx], [c, d, ty]]. Maps (x,y) -> (a*x+b*y+tx, c*x+d*y+ty). */
export const gradientStopsToCss = (stops: ReadonlyArray<{ position: number; color: RGBA }>): string => {
  if (!stops.length) return '';
  const parts = stops.map((s) => {
    const c = s.color;
    const a = 'a' in c ? c.a : 1;
    const color = toCssColor(c.r, c.g, c.b, a);
    const pct = Math.round(s.position * 100);
    return `${color} ${pct}%`;
  });
  return parts.join(', ');
};

/** Linear: transform gives start (tx,ty) and direction (a,c). CSS angle: 0deg=to top, 90deg=to right. Flip +180 to match Figma. */
export const gradientTransformToLinearCss = (t: Transform): string => {
  const a = t[0][0];
  const c = t[1][0];
  const angleDeg = Math.round((Math.atan2(a, -c) * 180) / Math.PI) + 180;
  const normalized = ((angleDeg % 360) + 360) % 360;
  return `${normalized}deg`;
};

/** Radial: transform maps gradient space to layer. Use center (tx,ty) and scale for size. */
export const gradientTransformToRadialCss = (t: Transform): string => {
  const tx = t[0][2];
  const ty = t[1][2];
  const scaleX = Math.sqrt(t[0][0] * t[0][0] + t[1][0] * t[1][0]);
  const scaleY = Math.sqrt(t[0][1] * t[0][1] + t[1][1] * t[1][1]);
  const cx = Math.round(tx * 100);
  const cy = Math.round(ty * 100);
  const rx = Math.round(scaleX * 100);
  const ry = Math.round(scaleY * 100);
  if (Math.abs(rx - ry) < 5) return `circle ${rx}% at ${cx}% ${cy}%`;
  return `ellipse ${rx}% ${ry}% at ${cx}% ${cy}%`;
};

/** Angular (conic): center from translation, start angle from rotation. Flip +180 to match Figma. */
export const gradientTransformToConicCss = (t: Transform): string => {
  const tx = t[0][2];
  const ty = t[1][2];
  const a = t[0][0];
  const c = t[1][0];
  const fromAngle = Math.round((Math.atan2(-c, a) * 180) / Math.PI) + 180;
  const normalized = ((fromAngle % 360) + 360) % 360;
  const cx = Math.round(tx * 100);
  const cy = Math.round(ty * 100);
  return `from ${normalized}deg at ${cx}% ${cy}%`;
};

export const paintToCssBackground = (paint: SolidPaint | FigmaGradientPaint): string => {
  if (paint.type === 'SOLID') {
    const p = paint as SolidPaint;
    return toCssColor(p.color.r, p.color.g, p.color.b, p.opacity ?? 1);
  }
  const g = paint as FigmaGradientPaint;
  if (g.visible === false) return '';
  const stops = gradientStopsToCss(g.gradientStops);
  if (!stops) return '';
  const t = g.gradientTransform;
  switch (g.type) {
    case 'GRADIENT_LINEAR': {
      const angle = gradientTransformToLinearCss(t);
      return `linear-gradient(${angle}, ${stops})`;
    }
    case 'GRADIENT_RADIAL': {
      const shape = gradientTransformToRadialCss(t);
      return `radial-gradient(${shape}, ${stops})`;
    }
    case 'GRADIENT_ANGULAR': {
      const from = gradientTransformToConicCss(t);
      return `conic-gradient(${from}, ${stops})`;
    }
    case 'GRADIENT_DIAMOND': {
      const shape = gradientTransformToRadialCss(t);
      return `radial-gradient(${shape}, ${stops})`;
    }
    default:
      return '';
  }
};

/** First visible fill as CSS background: solid or gradient. */
export const getFillStyle = (node: GeometryMixin): string | null => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill) return null;
  if (fill.type === 'SOLID') return paintToCssBackground(fill as SolidPaint);
  if (
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  ) {
    return paintToCssBackground(fill as FigmaGradientPaint);
  }
  return null;
};

/** First visible fill from paints array (e.g. text segment). */
export const getFillStyleFromPaints = (paints: ReadonlyArray<Paint>): string | null => {
  const fill = paints.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill) return null;
  if (fill.type === 'SOLID') return paintToCssBackground(fill as SolidPaint);
  if (
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  ) {
    return paintToCssBackground(fill as FigmaGradientPaint);
  }
  return null;
};

export const getCornerRadiusStyle = (node: SceneNode) => {
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `border-radius: ${roundDim(node.cornerRadius)}px`;
  }
  return null;
};
