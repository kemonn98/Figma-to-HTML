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

export const registerImageAsset = async (
  node: SceneNode & GeometryMixin,
  context: ExportContext
): Promise<string | null> => {
  const paint = getFirstImagePaint(node);
  if (!paint || !paint.imageHash) return null;
  const existing = context.imageHashToFile.get(paint.imageHash);
  if (existing) return existing;
  try {
    const image = figma.getImageByHash(paint.imageHash);
    if (!image) return null;
    context.imageDone += 1;
    const imageIndex = context.imageDone;
    const imageTotal = Math.max(context.imageTotal, imageIndex);
    const label = truncateLabel(node.name || 'image');
    const pct = overallPercentFromLayers(context);
    await reportExportProgress(`Exporting image ${imageIndex}/${imageTotal}… ${label}`, pct);
    const bytes = await image.getBytesAsync();
    await reportExportProgress(`Processing image ${imageIndex}/${imageTotal}… ${label}`, pct);
    const base = sanitizeName(node.name) || 'img';
    const next = (context.assetNameCounts.get(base) ?? 0) + 1;
    context.assetNameCounts.set(base, next);
    const fileName = next === 1 ? `${base}.png` : `${base}-${next}.png`;
    const path = `assets/${fileName}`;
    context.assets.push({ fileName, bytes, mimeType: 'image/png' });
    context.imageHashToFile.set(paint.imageHash, path);
    return path;
  } catch {
    return null;
  }
};
