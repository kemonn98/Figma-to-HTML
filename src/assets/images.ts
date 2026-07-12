import type { ExportContext } from '../types';
import { sanitizeName } from '../utils/names';
import { truncateLabel, reportExportProgress, overallPercentFromLayers } from '../export/progress';

export const hasImageFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return node.fills.some((paint) => paint.type === 'IMAGE' && paint.visible !== false);
};

export const getFirstImagePaint = (node: GeometryMixin): ImagePaint | null => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const paint = node.fills.find((p) => p.type === 'IMAGE' && p.visible !== false) as ImagePaint | undefined;
  return paint ?? null;
};

export const registerImageByHash = async (
  imageHash: string,
  nameHint: string,
  context: ExportContext
): Promise<string | null> => {
  const existing = context.imageHashToFile.get(imageHash);
  if (existing) return existing;
  try {
    const image = figma.getImageByHash(imageHash);
    if (!image) return null;
    context.imageDone += 1;
    const imageIndex = context.imageDone;
    const imageTotal = Math.max(context.imageTotal, imageIndex);
    const label = truncateLabel(nameHint || 'image');
    const pct = overallPercentFromLayers(context);
    await reportExportProgress(`Exporting image ${imageIndex}/${imageTotal}… ${label}`, pct);
    const bytes = await image.getBytesAsync();
    await reportExportProgress(`Processing image ${imageIndex}/${imageTotal}… ${label}`, pct);
    const base = sanitizeName(nameHint) || 'img';
    const next = (context.assetNameCounts.get(base) ?? 0) + 1;
    context.assetNameCounts.set(base, next);
    const fileName = next === 1 ? `${base}.png` : `${base}-${next}.png`;
    const path = `assets/${fileName}`;
    context.assets.push({ fileName, bytes, mimeType: 'image/png' });
    context.imageHashToFile.set(imageHash, path);
    return path;
  } catch {
    return null;
  }
};

export const registerImageAsset = async (
  node: SceneNode & GeometryMixin,
  context: ExportContext
): Promise<string | null> => {
  const paint = getFirstImagePaint(node);
  if (!paint || !paint.imageHash) return null;
  return registerImageByHash(paint.imageHash, node.name || 'img', context);
};

export type ImageBgLayer = {
  image: string;
  size: string;
  position: string;
  repeat: string;
};

/** Map ImagePaint scaleMode (+ crop/tile) to CSS background layer parts. */
export const imagePaintToBgLayer = (paint: ImagePaint, url: string): ImageBgLayer => {
  const image = `url("${url}")`;
  switch (paint.scaleMode) {
    case 'FIT':
      return { image, size: 'contain', position: 'center', repeat: 'no-repeat' };
    case 'TILE': {
      const scale = typeof paint.scalingFactor === 'number' && paint.scalingFactor > 0 ? paint.scalingFactor : 1;
      const pct = Math.max(1, Math.round(scale * 100));
      return { image, size: `${pct}%`, position: '0 0', repeat: 'repeat' };
    }
    case 'CROP': {
      const t = paint.imageTransform;
      if (t && t.length >= 2) {
        const a = t[0][0];
        const d = t[1][1];
        const tx = t[0][2];
        const ty = t[1][2];
        const scaleX = Math.abs(a) > 1e-6 ? Math.abs(a) : 1;
        const scaleY = Math.abs(d) > 1e-6 ? Math.abs(d) : 1;
        // imageTransform maps image → layer; invert for background-size/position approx
        const sizeX = Math.round((1 / scaleX) * 10000) / 100;
        const sizeY = Math.round((1 / scaleY) * 10000) / 100;
        const posX = Math.round(-tx * (1 / scaleX) * 10000) / 100;
        const posY = Math.round(-ty * (1 / scaleY) * 10000) / 100;
        return {
          image,
          size: `${sizeX}% ${sizeY}%`,
          position: `${posX}% ${posY}%`,
          repeat: 'no-repeat',
        };
      }
      return { image, size: 'cover', position: 'center', repeat: 'no-repeat' };
    }
    case 'FILL':
    default:
      return { image, size: 'cover', position: 'center', repeat: 'no-repeat' };
  }
};

/** object-fit for <img> from scaleMode (CROP/TILE approx as cover). */
export const scaleModeToObjectFit = (scaleMode: ImagePaint['scaleMode']): string => {
  if (scaleMode === 'FIT') return 'contain';
  return 'cover';
};
