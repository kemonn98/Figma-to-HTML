import type { ExportContext } from '../types';
import { sanitizeName } from '../utils/names';
import { truncateLabel, reportExportProgress, overallPercentFromLayers } from '../export/progress';
import { withExportSlot } from '../utils/async';

/** Cap long edge of exported bitmaps (retina-friendly, anti-crash). */
export const IMAGE_MAX_EXPORT_EDGE = 1920;

export const hasImageFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return node.fills.some((paint) => paint.type === 'IMAGE' && paint.visible !== false);
};

export const getFirstImagePaint = (node: GeometryMixin): ImagePaint | null => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const paint = node.fills.find((p) => p.type === 'IMAGE' && p.visible !== false) as ImagePaint | undefined;
  return paint ?? null;
};

const clampExportEdge = (plannedEdge: number, sourceLongEdge: number): number =>
  Math.max(1, Math.min(IMAGE_MAX_EXPORT_EDGE, plannedEdge, sourceLongEdge));

/**
 * Re-encode an IMAGE fill via a temporary rectangle + exportAsync (PNG + size cap).
 * Always PNG so alpha/transparency is preserved (JPG fills transparent pixels with white).
 * Temp node is always removed.
 */
export const exportCompressedImageBytes = async (
  imageHash: string,
  plannedEdge: number
): Promise<{ bytes: Uint8Array; mimeType: string; ext: string }> => {
  const image = figma.getImageByHash(imageHash);
  if (!image) {
    throw new Error('Image not found');
  }
  const size = await image.getSizeAsync();
  const sourceLong = Math.max(size.width, size.height);
  const targetLong = clampExportEdge(plannedEdge, sourceLong);

  const landscape = size.width >= size.height;
  const exportW = landscape
    ? targetLong
    : Math.max(1, Math.round((size.width / size.height) * targetLong));
  const exportH = landscape
    ? Math.max(1, Math.round((size.height / size.width) * targetLong))
    : targetLong;
  const constraint: ExportSettingsConstraints = landscape
    ? { type: 'WIDTH', value: exportW }
    : { type: 'HEIGHT', value: exportH };

  const rect = figma.createRectangle();
  try {
    rect.name = '__figma_to_html_img_export__';
    rect.x = -100000;
    rect.y = -100000;
    rect.resize(exportW, exportH);
    rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash }];
    const bytes = await withExportSlot(() =>
      rect.exportAsync({
        format: 'PNG',
        constraint,
      })
    );
    return { bytes, mimeType: 'image/png', ext: 'png' };
  } finally {
    rect.remove();
  }
};

export const registerImageByHash = async (
  imageHash: string,
  nameHint: string,
  context: ExportContext,
  neededEdgeHint?: number
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

    const plannedFromScan = context.imageHashMaxEdge.get(imageHash) ?? 0;
    let plannedEdge = Math.max(neededEdgeHint ?? 0, plannedFromScan);
    if (plannedEdge < 1) plannedEdge = IMAGE_MAX_EXPORT_EDGE;

    let bytes: Uint8Array;
    let mimeType: string;
    let ext: string;
    try {
      const compressed = await exportCompressedImageBytes(imageHash, plannedEdge);
      bytes = compressed.bytes;
      mimeType = compressed.mimeType;
      ext = compressed.ext;
    } catch {
      // Fallback: original bytes if temp export fails
      bytes = await image.getBytesAsync();
      mimeType = 'image/png';
      ext = 'png';
    }

    await reportExportProgress(`Processing image ${imageIndex}/${imageTotal}… ${label}`, pct);
    const base = sanitizeName(nameHint) || 'img';
    const next = (context.assetNameCounts.get(base) ?? 0) + 1;
    context.assetNameCounts.set(base, next);
    const fileName = next === 1 ? `${base}.${ext}` : `${base}-${next}.${ext}`;
    const path = `assets/${fileName}`;
    context.assets.push({ fileName, bytes, mimeType });
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
  const neededEdge = Math.max(1, Math.round(Math.max(node.width, node.height) * 2));
  return registerImageByHash(paint.imageHash, node.name || 'img', context, neededEdge);
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
