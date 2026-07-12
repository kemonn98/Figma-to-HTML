import { toCssColor, roundDim, roundPx } from '../utils/color';
import type { ExportContext, FigmaGradientPaint, FigmaMaskType } from '../types';
import { gradientTransformToRadialCss, gradientTransformToConicCss, linearGradientToCss } from './fills';
import { decodeSvgBytes, normalizeSvgToNodeSize, registerSvgAsset } from '../assets/svg';

/** Figma mask: a node with isMask=true masks all of its subsequent siblings. */
export const isMaskNode = (node: SceneNode): boolean =>
  'isMask' in node && (node as { isMask?: boolean }).isMask === true;

export const getMaskType = (node: SceneNode): FigmaMaskType | null =>
  ('maskType' in node && typeof (node as { maskType?: FigmaMaskType }).maskType === 'string')
    ? (node as { maskType: FigmaMaskType }).maskType
    : null;

/** Gradient stops as CSS for use in mask-image. LUMINANCE: use luminance as mask alpha (black=0, white=1); ALPHA/default: use rgba as-is. */
export const gradientStopsToCssForMask = (
  stops: ReadonlyArray<{ position: number; color: RGBA }>,
  maskType: FigmaMaskType | null
): string => {
  if (!stops.length) return '';
  const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const parts = stops.map((s) => {
    const c = s.color;
    const a = 'a' in c ? c.a : 1;
    const pct = Math.round(s.position * 100);
    if (maskType === 'LUMINANCE') {
      const lum = luminance(c.r, c.g, c.b) * a;
      const maskAlpha = roundPx(lum);
      const color = toCssColor(0, 0, 0, maskAlpha);
      return `${color} ${pct}%`;
    }
    const color = toCssColor(c.r, c.g, c.b, a);
    return `${color} ${pct}%`;
  });
  return parts.join(', ');
};

/** CSS gradient string for mask-image when the mask node has a gradient fill (linear/radial/conic). Returns null for solid or no fill. */
export const getMaskImageFromMaskNode = (node: SceneNode): string | null => {
  if (!('fills' in node) || node.fills === figma.mixed || !node.fills.length) return null;
  const fill = node.fills.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill || fill.type === 'SOLID') return null;
  const g = fill as FigmaGradientPaint;
  const maskType = getMaskType(node);
  const w = 'width' in node ? (node as { width: number }).width : 100;
  const h = 'height' in node ? (node as { height: number }).height : 100;
  if (g.type === 'GRADIENT_LINEAR') {
    const paintForCss =
      maskType === 'LUMINANCE'
        ? ({
            ...g,
            gradientStops: g.gradientStops.map((s) => {
              const c = s.color;
              const a = 'a' in c ? c.a : 1;
              const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * a;
              return { position: s.position, color: { r: 0, g: 0, b: 0, a: lum } };
            }),
          } as FigmaGradientPaint)
        : g;
    return linearGradientToCss(paintForCss, w, h) || null;
  }
  const stops = gradientStopsToCssForMask(g.gradientStops, maskType);
  if (!stops) return null;
  const t = g.gradientTransform;
  switch (g.type) {
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
      return null;
  }
};

/** Style lines for CSS mask-image when the mask node has a gradient fill (for gradient masking). */
export const getMaskImageStyles = (maskNode: SceneNode): string[] => {
  const maskImage = getMaskImageFromMaskNode(maskNode);
  if (!maskImage) return [];
  return [
    `mask-image: ${maskImage}`,
    `-webkit-mask-image: ${maskImage}`,
    'mask-size: 100% 100%',
    'mask-position: 0 0',
    'mask-repeat: no-repeat',
    '-webkit-mask-size: 100% 100%',
    '-webkit-mask-position: 0 0',
    '-webkit-mask-repeat: no-repeat',
  ];
};

/** CSS clip-path for a mask node (in local coordinates, so wrapper must match node size). Returns null for unsupported shapes. */
export const getClipPathFromMaskNode = (node: SceneNode): string | null => {
  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    const r = rect.cornerRadius;
    if (r !== figma.mixed && typeof r === 'number' && r > 0) {
      return `inset(0 round ${roundDim(r)}px)`;
    }
    if (r === figma.mixed && 'topLeftRadius' in rect) {
      const tl = roundDim((rect as { topLeftRadius?: number }).topLeftRadius ?? 0);
      const tr = roundDim((rect as { topRightRadius?: number }).topRightRadius ?? 0);
      const br = roundDim((rect as { bottomRightRadius?: number }).bottomRightRadius ?? 0);
      const bl = roundDim((rect as { bottomLeftRadius?: number }).bottomLeftRadius ?? 0);
      if (tl || tr || br || bl) return `inset(0 round ${tl}px ${tr}px ${br}px ${bl}px)`;
    }
    return 'inset(0)';
  }
  if (node.type === 'ELLIPSE') {
    return 'ellipse(50% 50% at 50% 50%)';
  }
  if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const n = node as { cornerRadius?: number | symbol };
    if (n.cornerRadius !== figma.mixed && typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      return `inset(0 round ${roundDim(n.cornerRadius)}px)`;
    }
    return 'inset(0)';
  }
  return null;
};

const isVectorLikeMask = (node: SceneNode): boolean =>
  node.type === 'VECTOR' ||
  node.type === 'BOOLEAN_OPERATION' ||
  node.type === 'STAR' ||
  node.type === 'POLYGON' ||
  node.type === 'LINE';

/**
 * Apply mask shape to wrapper styles: clip-path for rect/ellipse/frames,
 * gradient mask-image when present, and SVG mask-image for vector/boolean masks.
 */
export const appendMaskWrapperStyles = async (
  maskNode: SceneNode,
  styles: string[],
  context: ExportContext
): Promise<void> => {
  const clipPath = getClipPathFromMaskNode(maskNode);
  if (clipPath) styles.push(`clip-path: ${clipPath}`);
  styles.push(...getMaskImageStyles(maskNode));

  if (clipPath || getMaskImageFromMaskNode(maskNode)) return;
  if (!isVectorLikeMask(maskNode)) return;

  try {
    const exportable = maskNode as SceneNode & ExportMixin;
    const svgBytes = await exportable.exportAsync({ format: 'SVG' });
    let svgText = decodeSvgBytes(svgBytes);
    svgText = normalizeSvgToNodeSize(svgText, maskNode.width, maskNode.height);
    const svgPath = registerSvgAsset(`${maskNode.name || 'mask'}-mask`, svgText, context);
    const url = `url("${svgPath}")`;
    styles.push(
      `mask-image: ${url}`,
      `-webkit-mask-image: ${url}`,
      'mask-size: 100% 100%',
      'mask-position: 0 0',
      'mask-repeat: no-repeat',
      '-webkit-mask-size: 100% 100%',
      '-webkit-mask-position: 0 0',
      '-webkit-mask-repeat: no-repeat'
    );
  } catch {
    // overflow:hidden on wrapper remains as fallback
  }
};
