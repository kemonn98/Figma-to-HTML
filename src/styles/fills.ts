import { toCssColor, roundDim } from '../utils/color';
import type { ExportContext, FigmaGradientPaint } from '../types';
import { imagePaintToBgLayer, registerImageByHash } from '../assets/images';
import { solidPaintToCssWithVariable } from './variables';

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

type GradPoint = { x: number; y: number };

const EPS = 1e-8;

/** Invert Figma 2×3 affine transform (as 3×3 with bottom row [0,0,1]). */
const invertTransform = (t: Transform): Transform | null => {
  const a = t[0][0];
  const b = t[0][1];
  const tx = t[0][2];
  const c = t[1][0];
  const d = t[1][1];
  const ty = t[1][2];
  const det = a * d - b * c;
  if (Math.abs(det) < EPS) return null;
  const invDet = 1 / det;
  return [
    [d * invDet, -b * invDet, (b * ty - d * tx) * invDet],
    [-c * invDet, a * invDet, (c * tx - a * ty) * invDet],
  ];
};

const applyTransform = (t: Transform, x: number, y: number): GradPoint => ({
  x: t[0][0] * x + t[0][1] * y + t[0][2],
  y: t[1][0] * x + t[1][1] * y + t[1][2],
});

/**
 * Figma gradientTransform maps object space → gradient space.
 * Invert it and map identity handles (0,0.5)→(1,0.5) to get start/end in normalized object space.
 */
export const extractLinearGradientHandles = (
  t: Transform,
  width: number,
  height: number
): { start: GradPoint; end: GradPoint } | null => {
  const inv = invertTransform(t);
  if (!inv) return null;
  const sn = applyTransform(inv, 0, 0.5);
  const en = applyTransform(inv, 1, 0.5);
  return {
    start: { x: sn.x * width, y: sn.y * height },
    end: { x: en.x * width, y: en.y * height },
  };
};

/** CSS angle: 0deg = to top, 90deg = to right (clockwise). */
const cssAngleFromPoints = (start: GradPoint, end: GradPoint): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return 0;
  // atan2: 0 = right; CSS 0 = top → add 90
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  return deg === 360 ? 0 : deg;
};

/** CSS Images: gradient line length for a box at a given CSS angle. */
const cssGradientLineLength = (width: number, height: number, cssAngleDeg: number): number => {
  const rad = (cssAngleDeg * Math.PI) / 180;
  return Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
};

const cssGradientLineEndpoints = (
  width: number,
  height: number,
  cssAngleDeg: number,
  length: number
): { cssStart: GradPoint; cssEnd: GradPoint } => {
  const center = { x: width / 2, y: height / 2 };
  // Math angle: 0 = right (CSS angle − 90°)
  const mathRad = ((cssAngleDeg - 90) * Math.PI) / 180;
  const half = length / 2;
  const ux = Math.cos(mathRad);
  const uy = Math.sin(mathRad);
  return {
    cssStart: { x: center.x - half * ux, y: center.y - half * uy },
    cssEnd: { x: center.x + half * ux, y: center.y + half * uy },
  };
};

const projectOntoLine = (point: GradPoint, lineStart: GradPoint, lineEnd: GradPoint): GradPoint => {
  const lx = lineEnd.x - lineStart.x;
  const ly = lineEnd.y - lineStart.y;
  const lenSq = lx * lx + ly * ly;
  if (lenSq < EPS) return { ...lineStart };
  const t =
    ((point.x - lineStart.x) * lx + (point.y - lineStart.y) * ly) / lenSq;
  return { x: lineStart.x + t * lx, y: lineStart.y + t * ly };
};

const formatStopPct = (position: number): string => {
  const pct = Math.round(position * 10000) / 100;
  if (Math.abs(pct - Math.round(pct)) < 0.005) return `${Math.round(pct)}%`;
  return `${pct}%`;
};

/**
 * Convert Figma linear gradient to CSS, remapping stops onto the CSS gradient line
 * so custom handle positions (not just rotation) are preserved.
 */
export const linearGradientToCss = (
  g: FigmaGradientPaint,
  width: number,
  height: number
): string => {
  const w = Math.max(width, EPS);
  const h = Math.max(height, EPS);
  const handles = extractLinearGradientHandles(g.gradientTransform, w, h);
  if (!handles || !g.gradientStops.length) {
    const fallbackStops = gradientStopsToCss(g.gradientStops);
    if (!fallbackStops) return '';
    return `linear-gradient(${gradientTransformToLinearCss(g.gradientTransform)}, ${fallbackStops})`;
  }

  const { start, end } = handles;
  const angle = cssAngleFromPoints(start, end);
  const lineLen = cssGradientLineLength(w, h, angle);
  if (lineLen < EPS) {
    const c = g.gradientStops[0].color;
    return toCssColor(c.r, c.g, c.b, 'a' in c ? c.a : 1);
  }
  const { cssStart, cssEnd } = cssGradientLineEndpoints(w, h, angle, lineLen);
  const cssVx = cssEnd.x - cssStart.x;
  const cssVy = cssEnd.y - cssStart.y;
  const cssLenSq = cssVx * cssVx + cssVy * cssVy;

  const mapped = g.gradientStops.map((stop) => {
    const px = start.x + (end.x - start.x) * stop.position;
    const py = start.y + (end.y - start.y) * stop.position;
    const projected = projectOntoLine({ x: px, y: py }, cssStart, cssEnd);
    const pvx = projected.x - cssStart.x;
    const pvy = projected.y - cssStart.y;
    const signed = (pvx * cssVx + pvy * cssVy) / cssLenSq;
    const color = toCssColor(stop.color.r, stop.color.g, stop.color.b, 'a' in stop.color ? stop.color.a : 1);
    return `${color} ${formatStopPct(signed)}`;
  });

  return `linear-gradient(${Math.round(angle)}deg, ${mapped.join(', ')})`;
};

/** Linear fallback: direction only (no custom handle remapping). */
export const gradientTransformToLinearCss = (t: Transform): string => {
  const a = t[0][0];
  const c = t[1][0];
  const angleDeg = Math.round((Math.atan2(a, -c) * 180) / Math.PI) + 180;
  const normalized = ((angleDeg % 360) + 360) % 360;
  return `${normalized}deg`;
};

/**
 * Radial: invert gradientTransform to place center + radii in normalized object space.
 * Falls back to translation/scale magnitudes when invert fails.
 */
export const gradientTransformToRadialCss = (t: Transform): string => {
  const inv = invertTransform(t);
  if (inv) {
    const center = applyTransform(inv, 0.5, 0.5);
    const edgeX = applyTransform(inv, 1, 0.5);
    const edgeY = applyTransform(inv, 0.5, 1);
    const rx = Math.hypot(edgeX.x - center.x, edgeX.y - center.y);
    const ry = Math.hypot(edgeY.x - center.x, edgeY.y - center.y);
    const cx = Math.round(center.x * 100);
    const cy = Math.round(center.y * 100);
    const rxPct = Math.max(1, Math.round(rx * 100));
    const ryPct = Math.max(1, Math.round(ry * 100));
    if (Math.abs(rxPct - ryPct) < 5) return `circle ${rxPct}% at ${cx}% ${cy}%`;
    return `ellipse ${rxPct}% ${ryPct}% at ${cx}% ${cy}%`;
  }
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

export type GradientSize = { width: number; height: number };

const nodeGradientSize = (node: { width?: number; height?: number }): GradientSize => ({
  width: typeof node.width === 'number' && node.width > 0 ? node.width : 100,
  height: typeof node.height === 'number' && node.height > 0 ? node.height : 100,
});

export const paintToCssBackground = (
  paint: SolidPaint | FigmaGradientPaint,
  size?: GradientSize
): string => {
  if (paint.type === 'SOLID') {
    const p = paint as SolidPaint;
    return toCssColor(p.color.r, p.color.g, p.color.b, p.opacity ?? 1);
  }
  const g = paint as FigmaGradientPaint;
  if (g.visible === false) return '';
  const dim = size ?? { width: 100, height: 100 };
  switch (g.type) {
    case 'GRADIENT_LINEAR':
      return linearGradientToCss(g, dim.width, dim.height);
    case 'GRADIENT_RADIAL': {
      const stops = gradientStopsToCss(g.gradientStops);
      if (!stops) return '';
      return `radial-gradient(${gradientTransformToRadialCss(g.gradientTransform)}, ${stops})`;
    }
    case 'GRADIENT_ANGULAR': {
      const stops = gradientStopsToCss(g.gradientStops);
      if (!stops) return '';
      return `conic-gradient(${gradientTransformToConicCss(g.gradientTransform)}, ${stops})`;
    }
    case 'GRADIENT_DIAMOND': {
      const stops = gradientStopsToCss(g.gradientStops);
      if (!stops) return '';
      return `radial-gradient(${gradientTransformToRadialCss(g.gradientTransform)}, ${stops})`;
    }
    default:
      return '';
  }
};

/** First visible fill as CSS background: solid or gradient (no images). Prefer appendStackedFillStyles for full fidelity. */
export const getFillStyle = (node: GeometryMixin): string | null => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill) return null;
  const size = nodeGradientSize(node as { width?: number; height?: number });
  if (fill.type === 'SOLID') return paintToCssBackground(fill as SolidPaint);
  if (
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  ) {
    return paintToCssBackground(fill as FigmaGradientPaint, size);
  }
  return null;
};

/** First visible fill from paints array (e.g. text segment). */
export const getFillStyleFromPaints = (
  paints: ReadonlyArray<Paint>,
  size?: GradientSize
): string | null => {
  const fill = paints.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill) return null;
  if (fill.type === 'SOLID') return paintToCssBackground(fill as SolidPaint);
  if (
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  ) {
    return paintToCssBackground(fill as FigmaGradientPaint, size);
  }
  return null;
};

export const getCornerRadiusStyle = (node: SceneNode): string | null => {
  if (!('cornerRadius' in node) && !('topLeftRadius' in node)) return null;
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed && typeof node.cornerRadius === 'number') {
    if (node.cornerRadius > 0) return `border-radius: ${roundDim(node.cornerRadius)}px`;
    return null;
  }
  if ('topLeftRadius' in node) {
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
      if (tl === tr && tr === br && br === bl) return `border-radius: ${tl}px`;
      return `border-radius: ${tl}px ${tr}px ${br}px ${bl}px`;
    }
  }
  return null;
};

/**
 * Stack all visible fills (Figma bottom→top) as CSS backgrounds (CSS first = top → reverse array).
 * When asImgIfSoleImage and only one IMAGE fill, returns path for an <img> instead.
 */
export const appendStackedFillStyles = async (
  node: SceneNode & GeometryMixin,
  inlineStyles: string[],
  context: ExportContext,
  opts?: { asImgIfSoleImage?: boolean; nameHint?: string }
): Promise<{ imageSrcForImgTag: string | null }> => {
  if (!('fills' in node) || node.fills === figma.mixed || !node.fills.length) {
    return { imageSrcForImgTag: null };
  }
  const visible = node.fills.filter((p) => p.visible !== false);
  if (visible.length === 0) return { imageSrcForImgTag: null };

  const soleImage =
    !!opts?.asImgIfSoleImage &&
    visible.length === 1 &&
    visible[0].type === 'IMAGE' &&
    !!(visible[0] as ImagePaint).imageHash;

  if (soleImage) {
    const paint = visible[0] as ImagePaint;
    const path = await registerImageByHash(
      paint.imageHash!,
      opts?.nameHint || node.name || 'img',
      context
    );
    return { imageSrcForImgTag: path };
  }

  const size = nodeGradientSize(node);
  const cssOrder = [...visible].reverse();
  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];

  for (const paint of cssOrder) {
    if (paint.type === 'SOLID') {
      const color = await solidPaintToCssWithVariable(paint as SolidPaint, node, context);
      images.push(`linear-gradient(${color}, ${color})`);
      sizes.push('auto');
      positions.push('0 0');
      repeats.push('no-repeat');
    } else if (
      paint.type === 'GRADIENT_LINEAR' ||
      paint.type === 'GRADIENT_RADIAL' ||
      paint.type === 'GRADIENT_ANGULAR' ||
      paint.type === 'GRADIENT_DIAMOND'
    ) {
      const g = paintToCssBackground(paint as FigmaGradientPaint, size);
      if (!g) continue;
      images.push(g);
      sizes.push('auto');
      positions.push('0 0');
      repeats.push('no-repeat');
    } else if (paint.type === 'IMAGE') {
      const ip = paint as ImagePaint;
      if (!ip.imageHash) continue;
      const path = await registerImageByHash(
        ip.imageHash,
        opts?.nameHint || node.name || 'img',
        context
      );
      if (!path) {
        images.push('linear-gradient(#e5e7eb, #e5e7eb)');
        sizes.push('auto');
        positions.push('0 0');
        repeats.push('no-repeat');
        continue;
      }
      const layer = imagePaintToBgLayer(ip, path);
      images.push(layer.image);
      sizes.push(layer.size);
      positions.push(layer.position);
      repeats.push(layer.repeat);
    }
  }

  if (images.length === 0) return { imageSrcForImgTag: null };

  const solidOnly = visible.length === 1 && visible[0].type === 'SOLID';
  if (solidOnly) {
    const color = await solidPaintToCssWithVariable(visible[0] as SolidPaint, node, context);
    inlineStyles.push(`background: ${color}`);
    return { imageSrcForImgTag: null };
  }

  const gradientOnly =
    visible.length === 1 &&
    (visible[0].type === 'GRADIENT_LINEAR' ||
      visible[0].type === 'GRADIENT_RADIAL' ||
      visible[0].type === 'GRADIENT_ANGULAR' ||
      visible[0].type === 'GRADIENT_DIAMOND');
  if (gradientOnly) {
    inlineStyles.push(`background: ${images[0]}`);
    return { imageSrcForImgTag: null };
  }

  inlineStyles.push(`background-image: ${images.join(', ')}`);
  inlineStyles.push(`background-size: ${sizes.join(', ')}`);
  inlineStyles.push(`background-position: ${positions.join(', ')}`);
  inlineStyles.push(`background-repeat: ${repeats.join(', ')}`);
  return { imageSrcForImgTag: null };
};
