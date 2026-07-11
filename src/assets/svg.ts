import type { ExportContext } from '../types';
import { roundDim } from '../utils/color';
import { sanitizeName } from '../utils/names';

export const decodeSvgBytes = (svgBytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < svgBytes.length; i += chunkSize) {
    const chunk = svgBytes.subarray(i, i + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return result;
};

export const encodeSvgText = (svg: string): Uint8Array => {
  // UTF-8 without relying on TextEncoder (not in Figma plugin typings)
  const encoded = unescape(encodeURIComponent(svg));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  return bytes;
};

/** Force root SVG to node size so masked/full shape exports use correct dimensions (not half/tight bounds). Only replaces width, height, viewBox — no scale transform. Fixes circles missing cx/cy (Figma export sometimes omits them; default would be 0 and misplace the circle). */
export const normalizeSvgToNodeSize = (svg: string, width: number, height: number): string => {
  const w = roundDim(width);
  const h = roundDim(height);
  let out = svg.replace(/\bwidth=["'][^"']*["']/i, `width="${w}"`);
  out = out.replace(/\bheight=["'][^"']*["']/i, `height="${h}"`);
  if (/\bviewBox\s*=/i.test(out)) {
    out = out.replace(/\bviewBox\s*=\s*["'][^"']*["']/i, `viewBox="0 0 ${w} ${h}"`);
  } else {
    out = out.replace(/<svg\s/i, `<svg viewBox="0 0 ${w} ${h}" `);
  }
  const cxCenter = roundDim(w / 2);
  const cyCenter = roundDim(h / 2);
  // Match cx=/cy= with optional spaces around = (Figma uses cx="…" without space before =)
  out = out.replace(/<circle(\s)(?![^>]*\bcx\s*=)/i, `<circle cx="${cxCenter}"$1`);
  out = out.replace(/<circle(\s)(?![^>]*\bcy\s*=)/i, `<circle cy="${cyCenter}"$1`);
  return out;
};

export const registerSvgAsset = (
  nodeName: string,
  svgText: string,
  context: ExportContext
): string => {
  const base = sanitizeName(nodeName) || 'svg';
  const next = (context.assetNameCounts.get(base) ?? 0) + 1;
  context.assetNameCounts.set(base, next);
  const fileName = next === 1 ? `${base}.svg` : `${base}-${next}.svg`;
  const path = `assets/${fileName}`;
  context.assets.push({
    fileName,
    bytes: encodeSvgText(svgText),
    mimeType: 'image/svg+xml',
  });
  return path;
};

export const buildSvgImgHtml = (src: string, indentSpaces: string): string =>
  `${indentSpaces}<img src="${src}" alt="" style="display: block; width: 100%; height: 100%" />`;
