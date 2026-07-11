/// <reference types="@figma/plugin-typings" />

type ExportAsset = {
  fileName: string;
  bytesBase64: string;
  mimeType: string;
};

/** Preview-only FA icon SVG (not written to ZIP / assets). */
type PreviewFaIcon = {
  id: string;
  bytesBase64: string;
  width: number;
  height: number;
};

type ExportResult = {
  html: string;
  css: string;
  frameWidth: number;
  frameHeight: number;
  assets: ExportAsset[];
  previewFaIcons: PreviewFaIcon[];
};

type ExportMessage =
  | { type: 'export' }
  | { type: 'cancel' };

type ExportNode = { html: string };

type ExportAssetInternal = {
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
};

const getClassAttr = (classes: string[]) => {
  const joined = classes.filter(Boolean).join(' ').trim();
  if (!joined) return '';
  return `class="${joined}" `;
};

const getStyleAttr = (styles: string[]) => buildInlineStyle(styles);

type ExportContext = {
  nameCounts: Map<string, number>;
  styleMap: Map<string, string>;
  utilityClasses: Set<string>;
  styleEntries: {
    className: string;
    baseName: string;
    suffix: number;
    cssText: string;
  }[];
  fontFamiliesUsed: Set<string>;
  usedBaseClasses: Set<string>;
  assets: ExportAssetInternal[];
  assetNameCounts: Map<string, number>;
  imageHashToFile: Map<string, string>;
  usesFontAwesome: boolean;
  previewFaIcons: { id: string; bytes: Uint8Array; width: number; height: number }[];
  rootNode: SceneNode | null;
  rootHeight: number;
  heroHeadingNodeId: string | null;
  isRootPass: boolean;
  progressDone: number;
  progressTotal: number;
  progressLastReportAt: number;
  imageTotal: number;
  imageDone: number;
};

const truncateLabel = (text: string, max = 36): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
};

const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Overall export progress 0–100 (single scale for the UI). */
const reportExportProgress = async (message: string, percent: number): Promise<void> => {
  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  figma.ui.postMessage({
    type: 'export-progress',
    message,
    percent: pct,
  });
  await yieldToUi();
};

/** Map layer walk progress into overall % (setup 0–5, layers 5–75). */
const overallPercentFromLayers = (context: ExportContext): number => {
  const total = Math.max(1, context.progressTotal);
  const done = Math.min(context.progressDone, total);
  return 5 + (done / total) * 70;
};

const countExportableNodes = (node: SceneNode): number => {
  if (node.visible === false) return 0;
  let count = 1;
  if ('children' in node && node.children) {
    for (const child of node.children) {
      count += countExportableNodes(child as SceneNode);
    }
  }
  return count;
};

/** Count unique IMAGE fill hashes (each hash is exported once). */
const countUniqueImageHashes = (node: SceneNode, seen: Set<string>): void => {
  if (node.visible === false) return;
  if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
    for (const paint of node.fills) {
      if (paint.type === 'IMAGE' && paint.visible !== false && paint.imageHash) {
        seen.add(paint.imageHash);
      }
    }
  }
  if ('children' in node && node.children) {
    for (const child of node.children) {
      countUniqueImageHashes(child as SceneNode, seen);
    }
  }
};

const tickNodeProgress = (context: ExportContext, node: SceneNode) => {
  context.progressDone += 1;
  const now = Date.now();
  const isFirst = context.progressDone === 1;
  const isLast = context.progressDone >= context.progressTotal;
  if (!isFirst && !isLast && now - context.progressLastReportAt < 200) return;
  context.progressLastReportAt = now;
  const label = truncateLabel(node.name || node.type);
  void reportExportProgress(`Converting layers… ${label}`, overallPercentFromLayers(context));
};

const REM_BASE = 16;

const pxToRem = (px: number): string => {
  if (!Number.isFinite(px) || px === 0) return '0';
  const rem = px / REM_BASE;
  const rounded = Math.round(rem * 10000) / 10000;
  const str = String(rounded).replace(/\.?0+$/, '');
  return `${str || '0'}rem`;
};

const sanitizeExportText = (text: string): string =>
  text
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (match) => {
    const table: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return table[match];
  });

/** Sanitize + escape text, preserving Figma line breaks as <br>. */
const textToHtml = (text: string): string =>
  escapeHtml(sanitizeExportText(text)).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');

const uint8ToBase64 = (bytes: Uint8Array): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    result += chars[(triplet >> 18) & 63];
    result += chars[(triplet >> 12) & 63];
    result += i + 1 < len ? chars[(triplet >> 6) & 63] : '=';
    result += i + 2 < len ? chars[triplet & 63] : '=';
  }
  return result;
};

figma.showUI(__html__);
figma.ui.resize(370, 500);

const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

/** PascalCase class name from layer name, e.g. "Frame 2095585183" → "Frame2095585183" */
const toPascalCase = (name: string) => {
  const parts = name.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
};

/**
 * CSS class names must be valid identifiers — they cannot start with a digit
 * (e.g. layer "$1.299" must not become `.1299`).
 */
const ensureValidCssClassName = (name: string): string => {
  let n = (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!n) return 'Layer';
  if (/^[0-9]/.test(n)) n = `N${n}`;
  if (!/^[A-Za-z_]/.test(n)) n = `Layer${n}`;
  return n;
};

/** Layer name → safe CSS class base (PascalCase, never starts with a digit). */
const toCssClassBase = (name: string): string =>
  ensureValidCssClassName(toPascalCase(name) || sanitizeName(name).replace(/-/g, '') || 'Layer');

const getDataLayerAttr = (name: string) => {
  const escaped = name.replace(/"/g, '&quot;');
  return `data-layer="${escaped}" `;
};

const getLayerBlurRadius = (node: BlendMixin): number => {
  if (!('effects' in node) || !node.effects.length) return 0;
  const blur = node.effects.find((e) => e.type === 'LAYER_BLUR' && e.visible !== false);
  return blur && blur.type === 'LAYER_BLUR' ? blur.radius : 0;
};

/**
 * Figma "Clip content" → CSS overflow clipping.
 * Must be honored for frame masking (rounded frames, overflowing children, absolute layers).
 */
const getClipsContentStyles = (node: SceneNode): string[] => {
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

const mapPrimaryAxis = (val: FrameNode['primaryAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'SPACE_BETWEEN':
      return 'space-between';
    default:
      return 'flex-start';
  }
};

const mapCounterAxis = (val: FrameNode['counterAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'BASELINE':
      return 'baseline';
    default:
      return 'stretch';
  }
};

const roundAlpha = (a: number) => Math.round((a ?? 1) * 100) / 100;

/** Solid color as CSS: hex when opaque, rgba when not. */
const toCssColor = (r: number, g: number, b: number, a: number): string => {
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  const alpha = roundAlpha(a);
  if (alpha >= 1 || Math.abs(alpha - 1) < 0.005) {
    const hex = (x: number) => ('0' + x.toString(16)).slice(-2);
    return '#' + (hex(R) + hex(G) + hex(B)).toUpperCase();
  }
  return `rgba(${R}, ${G}, ${B}, ${alpha})`;
};

const getSolidFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const fill = node.fills.find((paint) => paint.type === 'SOLID' && paint.visible !== false) as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return toCssColor(r, g, b, a);
};

const getSolidTextFill = (text: TextNode) => {
  if (text.fills === figma.mixed) return null;
  const fill = text.fills.find((paint) => paint.type === 'SOLID' && paint.visible !== false) as
    | SolidPaint
    | undefined;
  if (!fill) return null;
  const { r, g, b } = fill.color;
  const a = fill.opacity ?? 1;
  return toCssColor(r, g, b, a);
};

/** Figma gradient paint (plugin API uses gradientTransform + gradientStops). */
type FigmaGradientPaint = {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  gradientTransform: Transform;
  gradientStops: ReadonlyArray<{ position: number; color: RGBA }>;
  visible?: boolean;
  opacity?: number;
};

/** Transform is 2x3: [[a, b, tx], [c, d, ty]]. Maps (x,y) -> (a*x+b*y+tx, c*x+d*y+ty). */
const gradientStopsToCss = (stops: ReadonlyArray<{ position: number; color: RGBA }>): string => {
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
const gradientTransformToLinearCss = (t: Transform): string => {
  const a = t[0][0];
  const c = t[1][0];
  const angleDeg = Math.round((Math.atan2(a, -c) * 180) / Math.PI) + 180;
  const normalized = ((angleDeg % 360) + 360) % 360;
  return `${normalized}deg`;
};

/** Radial: transform maps gradient space to layer. Use center (tx,ty) and scale for size. */
const gradientTransformToRadialCss = (t: Transform): string => {
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
const gradientTransformToConicCss = (t: Transform): string => {
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

const paintToCssBackground = (paint: SolidPaint | FigmaGradientPaint): string => {
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
const getFillStyle = (node: GeometryMixin): string | null => {
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
const getFillStyleFromPaints = (paints: ReadonlyArray<Paint>): string | null => {
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

const isVectorNode = (node: SceneNode) =>
  node.type === 'VECTOR' ||
  node.type === 'LINE' ||
  node.type === 'ELLIPSE' ||
  node.type === 'POLYGON' ||
  node.type === 'STAR' ||
  node.type === 'BOOLEAN_OPERATION';

/** Rotation is 0° / 90° / 180° (axis-aligned), so a line can be a CSS border. */
const isAxisAlignedRotation = (rotation: number): boolean => {
  const r = ((rotation % 180) + 180) % 180;
  return r < 0.5 || Math.abs(r - 90) < 0.5 || Math.abs(r - 180) < 0.5;
};

/**
 * Detect simple dividers (LINE or 2-point VECTOR) that should be CSS borders,
 * not SVG assets. Heuristic:
 * - type LINE, or VECTOR with one straight segment / two vertices
 * - axis-aligned (including 90° rotation)
 * - solid stroke (gradients stay SVG)
 * - thin in one axis (height≈0 / width≈0 or ≤ ~2× stroke)
 */
const isCssDividerLine = (node: SceneNode): boolean => {
  if (node.type !== 'LINE' && node.type !== 'VECTOR') return false;
  if (!isAxisAlignedRotation('rotation' in node ? node.rotation : 0)) return false;

  const stroke = getStrokePaint(node as GeometryMixin);
  if (!stroke || stroke.type !== 'SOLID') return false;

  const strokeW = Math.max(getStrokeWeight(node), 0.5);
  const boxW = Math.abs(node.width);
  const boxH = Math.abs(node.height);
  const thinLimit = Math.max(strokeW * 2, 2);

  if (node.type === 'VECTOR') {
    const vn = (node as VectorNode).vectorNetwork;
    if (vn && Array.isArray(vn.vertices) && Array.isArray(vn.segments)) {
      if (vn.segments.length !== 1 || vn.vertices.length !== 2) return false;
      const v0 = vn.vertices[0];
      const v1 = vn.vertices[1];
      const dx = Math.abs(v0.x - v1.x);
      const dy = Math.abs(v0.y - v1.y);
      if (!(dx < 0.51 || dy < 0.51)) return false;
    }
  }

  const isHorizontal = boxH <= thinLimit && boxW > thinLimit;
  const isVertical = boxW <= thinLimit && boxH > thinLimit;
  // LINE often reports height 0 with length in width
  if (node.type === 'LINE') return boxW > 0 || boxH > 0;
  return isHorizontal || isVertical;
};

const getDividerOrientation = (node: SceneNode): 'horizontal' | 'vertical' => {
  const rot = (('rotation' in node ? node.rotation : 0) % 180 + 180) % 180;
  const near90 = Math.abs(rot - 90) < 0.5;
  const boxW = Math.abs(node.width);
  const boxH = Math.abs(node.height);
  const baseHorizontal = boxW >= boxH;
  if (near90) return baseHorizontal ? 'vertical' : 'horizontal';
  return baseHorizontal ? 'horizontal' : 'vertical';
};

const decodeSvgBytes = (svgBytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < svgBytes.length; i += chunkSize) {
    const chunk = svgBytes.subarray(i, i + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return result;
};

const encodeSvgText = (svg: string): Uint8Array => {
  // UTF-8 without relying on TextEncoder (not in Figma plugin typings)
  const encoded = unescape(encodeURIComponent(svg));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  return bytes;
};

/** Force root SVG to node size so masked/full shape exports use correct dimensions (not half/tight bounds). Only replaces width, height, viewBox — no scale transform. Fixes circles missing cx/cy (Figma export sometimes omits them; default would be 0 and misplace the circle). */
const normalizeSvgToNodeSize = (svg: string, width: number, height: number): string => {
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

const hasImageFill = (node: GeometryMixin) => {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return node.fills.some((paint) => paint.type === 'IMAGE' && paint.visible !== false);
};

const getFirstImagePaint = (node: GeometryMixin): ImagePaint | null => {
  if (!('fills' in node) || node.fills === figma.mixed) return null;
  const paint = node.fills.find((p) => p.type === 'IMAGE' && p.visible !== false) as ImagePaint | undefined;
  return paint ?? null;
};

const registerImageAsset = async (
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

const registerSvgAsset = (
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

const buildSvgImgHtml = (src: string, indentSpaces: string): string =>
  `${indentSpaces}<img src="${src}" alt="" style="display: block; width: 100%; height: 100%" />`;

const isFontAwesomeFamily = (family: string) => /font\s*awesome/i.test(family);

const isLikelyIconFontFamily = (family: string) => {
  if (isFontAwesomeFamily(family)) return false;
  return /icon|glyph|symbol|material icons|feather|phosphor|lucide/i.test(family);
};

const isIconSlugText = (characters: string) => {
  const t = characters.trim();
  if (!t || t.length > 48) return false;
  if (/\s/.test(t) && !/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(t)) return false;
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t);
};

const getFaStyleClass = (family: string) =>
  /brand/i.test(family) ? 'fa-brands' : 'fa-solid';

const getFaIconName = (text: TextNode) => {
  const fromChars = text.characters.trim().toLowerCase().replace(/\s+/g, '-');
  if (isIconSlugText(fromChars)) return fromChars.replace(/_/g, '-');
  const fromName = sanitizeName(text.name).replace(/^fa-/, '');
  return fromName || 'circle';
};

const hasInvisibleStrokesOnly = (node: GeometryMixin): boolean => {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return false;
  const hasVisibleStroke = node.strokes.some((p) => {
    if (p.visible === false) return false;
    const opacity = p.opacity ?? 1;
    return opacity > 0;
  });
  return !hasVisibleStroke;
};

const formatFontFamily = (fontName: TextNode['fontName']) => {
  if (fontName === figma.mixed) return 'inherit';
  return `"${fontName.family}"`;
};

const getFontWeightFromStyle = (fontName: TextNode['fontName']) => {
  if (fontName === figma.mixed) return null;
  const style = fontName.style.toLowerCase();
  if (style.includes('thin')) return 100;
  if (style.includes('extra light') || style.includes('ultra light')) return 200;
  if (style.includes('light')) return 300;
  if (style.includes('regular') || style.includes('normal')) return 400;
  if (style.includes('medium')) return 500;
  if (style.includes('semi bold') || style.includes('demi bold')) return 600;
  if (style.includes('bold')) return 700;
  if (style.includes('extra bold') || style.includes('ultra bold')) return 800;
  if (style.includes('black') || style.includes('heavy')) return 900;
  return null;
};

const getUniqueClassName = (base: string, context: ExportContext) => {
  const safeBase = ensureValidCssClassName(base);
  const nextCount = (context.nameCounts.get(safeBase) ?? 0) + 1;
  context.nameCounts.set(safeBase, nextCount);
  return nextCount === 1 ? safeBase : `${safeBase}-${nextCount}`;
};

const getBaseNameAndSuffix = (className: string) => {
  const match = className.match(/^(.*?)-(\d+)$/);
  if (match) {
    return { baseName: match[1], suffix: Number(match[2]) };
  }
  return { baseName: className, suffix: 0 };
};

const registerUtilityClass = (
  className: string,
  lines: string[],
  context: ExportContext
) => {
  if (context.utilityClasses.has(className)) return;
  const { baseName, suffix } = getBaseNameAndSuffix(className);
  context.utilityClasses.add(className);
  if (lines.length === 0) return;
  context.styleEntries.push({
    className,
    baseName,
    suffix,
    cssText: `.${className} {\n${lines.join('\n')}\n}\n\n`,
  });
};

const formatNegativeClassValue = (value: number) => {
  const absValue = Math.round(Math.abs(value));
  return value < 0 ? `neg-${absValue}` : `${absValue}`;
};

const roundPx = (n: number) => Math.round(n * 100) / 100;
/** Higher precision for rotated shapes so non-90° angles don't drift from rounding. */
const roundPx4 = (n: number) => Math.round(n * 10000) / 10000;
const roundDim = (n: number) => Math.round(n);
const isMeaningfulRotation = (r: number) => Math.abs(r) >= 0.01;
/** Figma rotation in degrees; negate for correct CSS visual. */
const cssRotationDeg = (rotation: number) => roundPx(-rotation);

const getCornerRadiusStyle = (node: SceneNode) => {
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `border-radius: ${roundDim(node.cornerRadius)}px`;
  }
  return null;
};

/** Figma mask: a node with isMask=true masks all of its subsequent siblings. */
const isMaskNode = (node: SceneNode): boolean =>
  'isMask' in node && (node as { isMask?: boolean }).isMask === true;

type FigmaMaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE';
const getMaskType = (node: SceneNode): FigmaMaskType | null =>
  ('maskType' in node && typeof (node as { maskType?: FigmaMaskType }).maskType === 'string')
    ? (node as { maskType: FigmaMaskType }).maskType
    : null;

/** Gradient stops as CSS for use in mask-image. LUMINANCE: use luminance as mask alpha (black=0, white=1); ALPHA/default: use rgba as-is. */
const gradientStopsToCssForMask = (
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
const getMaskImageFromMaskNode = (node: SceneNode): string | null => {
  if (!('fills' in node) || node.fills === figma.mixed || !node.fills.length) return null;
  const fill = node.fills.find((p) => p.visible !== false) as SolidPaint | FigmaGradientPaint | undefined;
  if (!fill || fill.type === 'SOLID') return null;
  const g = fill as FigmaGradientPaint;
  const maskType = getMaskType(node);
  const stops = gradientStopsToCssForMask(g.gradientStops, maskType);
  if (!stops) return null;
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
      return null;
  }
};

/** Style lines for CSS mask-image when the mask node has a gradient fill (for gradient masking). */
const getMaskImageStyles = (maskNode: SceneNode): string[] => {
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
const getClipPathFromMaskNode = (node: SceneNode): string | null => {
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

/** First visible stroke paint (solid or gradient). Same paint types as fills: SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, GRADIENT_ANGULAR, GRADIENT_DIAMOND. */
const getStrokePaint = (node: GeometryMixin): SolidPaint | FigmaGradientPaint | null => {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return null;
  const p = node.strokes.find((paint) => paint.visible !== false);
  if (!p || (p.type !== 'SOLID' && p.type !== 'GRADIENT_LINEAR' && p.type !== 'GRADIENT_RADIAL' && p.type !== 'GRADIENT_ANGULAR' && p.type !== 'GRADIENT_DIAMOND')) return null;
  const opacity = p.opacity ?? 1;
  if (opacity <= 0) return null;
  return p as SolidPaint | FigmaGradientPaint;
};

/** CSS value for stroke paint (color string or gradient). */
const strokePaintToCss = (paint: SolidPaint | FigmaGradientPaint): string => {
  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color;
    return toCssColor(r, g, b, paint.opacity ?? 1);
  }
  return paintToCssBackground(paint as FigmaGradientPaint);
};

/** Whether the node has a dashed stroke (dashPattern / strokeDashes). Plugin API may use strokeDashes. */
const getStrokeDashPattern = (node: SceneNode): number[] | null => {
  const dashes = (node as { strokeDashes?: number[]; dashPattern?: number[] }).strokeDashes ?? (node as { dashPattern?: number[] }).dashPattern;
  if (!Array.isArray(dashes) || dashes.length === 0) return null;
  return dashes;
};

/** strokeAlign: INSIDE | CENTER | OUTSIDE. */
const getStrokeAlign = (node: SceneNode): 'INSIDE' | 'CENTER' | 'OUTSIDE' => {
  if (!('strokeAlign' in node)) return 'INSIDE';
  const v = (node as { strokeAlign?: string }).strokeAlign;
  if (v === 'CENTER' || v === 'OUTSIDE') return v;
  return 'INSIDE';
};

/** strokeWeight in px; can be figma.mixed. */
const getStrokeWeight = (node: SceneNode): number => {
  if (!('strokeWeight' in node) || (node as { strokeWeight?: number | symbol }).strokeWeight === figma.mixed) return 1;
  const w = (node as { strokeWeight: number }).strokeWeight;
  return roundDim(typeof w === 'number' ? w : 1);
};

const getStrokeStyles = (node: GeometryMixin): string[] => {
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

const getEffectsStyles = (node: BlendMixin): string[] => {
  const styles: string[] = [];
  if (!('effects' in node) || node.effects.length === 0) return styles;
  const shadows: string[] = [];
  let blur = 0;
  for (const e of node.effects) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      const { r, g, b } = e.color;
      const a = 'a' in e.color ? e.color.a : 1;
      const color = toCssColor(r, g, b, a);
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'INNER_SHADOW') {
      const { r, g, b } = e.color;
      const a = 'a' in e.color ? e.color.a : 1;
      const color = toCssColor(r, g, b, a);
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`inset ${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'LAYER_BLUR') {
      blur = roundDim(e.radius);
    }
  }
  if (shadows.length > 0) styles.push(`box-shadow: ${shadows.join(', ')}`);
  if (blur > 0) styles.push(`filter: blur(${roundPx(blur / 2)}px)`);
  return styles;
};

const mapBlendMode = (mode: BlendMode): string | null => {
  const m: Record<string, string> = {
    PASS_THROUGH: 'normal',
    NORMAL: 'normal',
    DARKEN: 'darken',
    MULTIPLY: 'multiply',
    LINEAR_BURN: 'color-burn',
    COLOR_BURN: 'color-burn',
    LIGHTEN: 'lighten',
    SCREEN: 'screen',
    LINEAR_DODGE: 'color-dodge',
    COLOR_DODGE: 'color-dodge',
    OVERLAY: 'overlay',
    SOFT_LIGHT: 'soft-light',
    HARD_LIGHT: 'hard-light',
    DIFFERENCE: 'difference',
    EXCLUSION: 'exclusion',
    HUE: 'hue',
    SATURATION: 'saturation',
    COLOR: 'color',
    LUMINOSITY: 'luminosity',
  };
  return m[mode] ?? null;
};

const registerSizingUtilities = (
  node: SceneNode,
  parentLayoutMode: FrameNode['layoutMode'] | null,
  context: ExportContext
): { classes: string[]; styles: string[] } => {
  const classes: string[] = [];
  const styles: string[] = [];
  const sizingHorizontal =
    'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : null;
  const sizingVertical =
    'layoutSizingVertical' in node ? node.layoutSizingVertical : null;
  const hasLayoutSizing =
    sizingHorizontal !== null || sizingVertical !== null;
  const isAbsolute =
    parentLayoutMode !== null &&
    'layoutPositioning' in node &&
    node.layoutPositioning === 'ABSOLUTE';
  const layoutGrow =
    'layoutGrow' in node && typeof node.layoutGrow === 'number'
      ? node.layoutGrow
      : 0;
  const layoutAlign =
    'layoutAlign' in node ? node.layoutAlign : null;

  const addClass = (cls: string) => {
    if (classes.indexOf(cls) === -1) classes.push(cls);
  };

  if (parentLayoutMode && layoutGrow > 0 && !isAbsolute) {
    registerUtilityClass('flex-1', ['  flex: 1;'], context);
    addClass('flex-1');
  }

  if (parentLayoutMode && layoutAlign === 'STRETCH' && !isAbsolute) {
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    addClass('self-stretch');
  }

  if (hasLayoutSizing && parentLayoutMode && !isAbsolute) {
    if (sizingHorizontal === 'FILL') {
      if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
      }
    }
    if (sizingVertical === 'FILL') {
      if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
      }
    }
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(text.height)}px`);
      }
    } else {
      if (text.textAutoResize === 'NONE') {
        styles.push(`width: ${roundDim(text.width)}px`);
        styles.push(`height: ${roundDim(text.height)}px`);
      } else if (text.textAutoResize === 'HEIGHT') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
    }
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(rect.height)}px`);
      }
    } else {
      const primaryFill =
        parentLayoutMode === 'HORIZONTAL'
          ? layoutGrow > 0
          : parentLayoutMode === 'VERTICAL'
          ? layoutGrow > 0
          : false;
      const counterFill = layoutAlign === 'STRETCH';

      if (!primaryFill) {
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (!counterFill) {
        styles.push(`height: ${roundDim(rect.height)}px`);
      }
    }
  }

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(frame.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(frame.height)}px`);
      }
    } else {
      if (frame.layoutMode === 'NONE') {
        styles.push(`width: ${roundDim(frame.width)}px`);
        styles.push(`height: ${roundDim(frame.height)}px`);
        return { classes, styles };
      }

      const primaryIsWidth = frame.layoutMode === 'HORIZONTAL';
      const primaryFixed = frame.primaryAxisSizingMode === 'FIXED';
      const counterFixed = frame.counterAxisSizingMode === 'FIXED';
      const primaryFill =
        parentLayoutMode && layoutGrow > 0;
      const counterFill = layoutAlign === 'STRETCH';

      if (primaryFixed && !primaryFill) {
        styles.push(
          `${primaryIsWidth ? 'width' : 'height'}: ${roundDim(
            primaryIsWidth ? frame.width : frame.height
          )}px`
        );
      }
      if (counterFixed && !counterFill) {
        styles.push(
          `${primaryIsWidth ? 'height' : 'width'}: ${roundDim(
            primaryIsWidth ? frame.height : frame.width
          )}px`
        );
      }
    }
  }

  return { classes, styles };
};

const registerGridUtilities = (frame: FrameNode, context: ExportContext): string[] => {
  if (frame.layoutMode !== 'GRID') return [];
  const classes: string[] = [];
  registerUtilityClass('grid', ['  display: grid;'], context);
  classes.push('grid');
  const rows = 'gridRowCount' in frame ? frame.gridRowCount : 1;
  const cols = 'gridColumnCount' in frame ? frame.gridColumnCount : 1;
  const rowsClass = `grid-rows-${rows}`;
  const colsClass = `grid-cols-${cols}`;
  registerUtilityClass(rowsClass, [`  grid-template-rows: repeat(${rows}, minmax(0, 1fr));`], context);
  registerUtilityClass(colsClass, [`  grid-template-columns: repeat(${cols}, minmax(0, 1fr));`], context);
  classes.push(rowsClass, colsClass);
  const gapValue = formatNegativeClassValue(frame.itemSpacing);
  if (frame.itemSpacing !== 0) {
    const gapClass = `gap-${gapValue}`;
    registerUtilityClass(gapClass, [`  gap: ${pxToRem(frame.itemSpacing)};`], context);
    classes.push(gapClass);
  }
  return classes;
};

const registerFlexUtilities = (
  frame: FrameNode,
  context: ExportContext
): string[] => {
  const classes: string[] = [];
  registerUtilityClass('flex', ['  display: flex;'], context);
  classes.push('flex');

  const directionClass = frame.layoutMode === 'HORIZONTAL' ? 'flex-row' : 'flex-col';
  registerUtilityClass(
    directionClass,
    [`  flex-direction: ${frame.layoutMode === 'HORIZONTAL' ? 'row' : 'column'};`],
    context
  );
  classes.push(directionClass);

  if (frame.layoutWrap === 'WRAP') {
    registerUtilityClass('flex-wrap', ['  flex-wrap: wrap;'], context);
    classes.push('flex-wrap');
    if (frame.counterAxisAlignContent === 'SPACE_BETWEEN') {
      registerUtilityClass('content-between', ['  align-content: space-between;'], context);
      classes.push('content-between');
    }
    const counterSpacing = frame.counterAxisSpacing ?? frame.itemSpacing;
    if (counterSpacing != null && counterSpacing > 0) {
      if (frame.layoutMode === 'HORIZONTAL') {
        const rowGapClass = `row-gap-${formatNegativeClassValue(counterSpacing)}`;
        registerUtilityClass(rowGapClass, [`  row-gap: ${pxToRem(counterSpacing)};`], context);
        classes.push(rowGapClass);
      } else {
        const colGapClass = `column-gap-${formatNegativeClassValue(counterSpacing)}`;
        registerUtilityClass(colGapClass, [`  column-gap: ${pxToRem(counterSpacing)};`], context);
        classes.push(colGapClass);
      }
    }
  }

  // When SPACE_BETWEEN, Figma distributes space—don't add fixed gap (handles AUTO spacing)
  const isAutoGap = frame.primaryAxisAlignItems === 'SPACE_BETWEEN';
  if (!isAutoGap && frame.itemSpacing !== 0) {
    const gapValue = formatNegativeClassValue(frame.itemSpacing);
    const gapClass = `gap-${gapValue}`;
    registerUtilityClass(gapClass, [`  gap: ${pxToRem(frame.itemSpacing)};`], context);
    classes.push(gapClass);
  }

  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = frame;
  const allSame =
    paddingTop === paddingRight &&
    paddingTop === paddingBottom &&
    paddingTop === paddingLeft;

  if (allSame) {
    if (paddingTop !== 0) {
      const padValue = formatNegativeClassValue(paddingTop);
      const padClass = `p-${padValue}`;
      registerUtilityClass(
        padClass,
        [`  padding: ${pxToRem(paddingTop)};`],
        context
      );
      classes.push(padClass);
    }
  } else {
    if (paddingTop !== 0) {
      const value = formatNegativeClassValue(paddingTop);
      const className = `pt-${value}`;
      registerUtilityClass(className, [`  padding-top: ${pxToRem(paddingTop)};`], context);
      classes.push(className);
    }
    if (paddingRight !== 0) {
      const value = formatNegativeClassValue(paddingRight);
      const className = `pr-${value}`;
      registerUtilityClass(
        className,
        [`  padding-right: ${pxToRem(paddingRight)};`],
        context
      );
      classes.push(className);
    }
    if (paddingBottom !== 0) {
      const value = formatNegativeClassValue(paddingBottom);
      const className = `pb-${value}`;
      registerUtilityClass(
        className,
        [`  padding-bottom: ${pxToRem(paddingBottom)};`],
        context
      );
      classes.push(className);
    }
    if (paddingLeft !== 0) {
      const value = formatNegativeClassValue(paddingLeft);
      const className = `pl-${value}`;
      registerUtilityClass(
        className,
        [`  padding-left: ${pxToRem(paddingLeft)};`],
        context
      );
      classes.push(className);
    }
  }

  const justifyClass = (() => {
    switch (frame.primaryAxisAlignItems) {
      case 'MIN':
        return 'justify-start';
      case 'MAX':
        return 'justify-end';
      case 'CENTER':
        return 'justify-center';
      case 'SPACE_BETWEEN':
        return 'justify-between';
      default:
        return 'justify-start';
    }
  })();
  registerUtilityClass(
    justifyClass,
    [`  justify-content: ${mapPrimaryAxis(frame.primaryAxisAlignItems)};`],
    context
  );
  classes.push(justifyClass);

  const itemsClass = (() => {
    switch (frame.counterAxisAlignItems) {
      case 'MIN':
        return 'items-start';
      case 'MAX':
        return 'items-end';
      case 'CENTER':
        return 'items-center';
      case 'BASELINE':
        return 'items-baseline';
      default:
        return 'items-stretch';
    }
  })();
  registerUtilityClass(
    itemsClass,
    [`  align-items: ${mapCounterAxis(frame.counterAxisAlignItems)};`],
    context
  );
  classes.push(itemsClass);

  return classes;
};

const getTextAlignClass = (align: TextNode['textAlignHorizontal']) => {
  switch (align) {
    case 'LEFT':
      return 'text-left';
    case 'CENTER':
      return 'text-center';
    case 'RIGHT':
      return 'text-right';
    case 'JUSTIFIED':
      return 'text-justify';
    default:
      return null;
  }
};

const getTextCaseClass = (textCase: TextNode['textCase']) => {
  if (textCase === figma.mixed) return null;
  switch (textCase) {
    case 'UPPER':
      return 'uppercase';
    case 'LOWER':
      return 'lowercase';
    case 'TITLE':
      return 'capitalize';
    case 'SMALL_CAPS':
    case 'SMALL_CAPS_FORCED':
      return 'small-caps';
    default:
      return null;
  }
};

const getTextDecorationClass = (decoration: TextNode['textDecoration']) => {
  if (decoration === figma.mixed) return null;
  switch (decoration) {
    case 'UNDERLINE':
      return 'underline';
    case 'STRIKETHROUGH':
      return 'line-through';
    default:
      return null;
  }
};

const isAbsoluteChild = (node: SceneNode, parentFrame: FrameNode | null) =>
  !!parentFrame &&
  'layoutPositioning' in node &&
  node.layoutPositioning === 'ABSOLUTE';

type ParentGroupLike = {
  width: number;
  height: number;
  children: readonly SceneNode[];
  absoluteBoundingBox?: { x: number; y: number } | null;
};

/** Position styles for children of a Group. Group children use explicit x,y (and optional constraints). */
const getGroupChildPositionStyles = (
  node: SceneNode,
  parentGroup: ParentGroupLike
): string[] => {
  const styles: string[] = ['position: absolute'];
  const zIndex = parentGroup.children.indexOf(node);
  if (zIndex >= 0) styles.push(`z-index: ${zIndex}`);

  const rot = 'rotation' in node ? (node as { rotation: number }).rotation : 0;
  const rotated = isMeaningfulRotation(rot);
  const parentBounds = parentGroup.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;

  // Prefer AABB relative to parent. For rotated nodes, node.x/y can be far off
  // (e.g. thousands of px); place the box so its center matches the AABB center,
  // then rotate around center so the visual matches Figma.
  let left: number;
  let top: number;
  let useCenterOrigin = false;
  if (parentBounds && nodeBounds) {
    if (rotated) {
      left = nodeBounds.x - parentBounds.x + (nodeBounds.width - node.width) / 2;
      top = nodeBounds.y - parentBounds.y + (nodeBounds.height - node.height) / 2;
      useCenterOrigin = true;
    } else {
      left = nodeBounds.x - parentBounds.x;
      top = nodeBounds.y - parentBounds.y;
    }
  } else {
    left = node.x;
    top = node.y;
  }
  const rawLeft = left;
  const rawTop = top;
  const leftPx = roundPx(left);
  const topPx = roundPx(top);
  const right = roundPx(parentGroup.width - (rawLeft + node.width));
  const bottom = roundPx(parentGroup.height - (rawTop + node.height));
  const constraints =
    'constraints' in node ? node.constraints : { horizontal: 'MIN', vertical: 'MIN' };
  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = rawLeft + node.width / 2;
      const offsetX = roundPx(centerX - parentGroup.width / 2);
      styles.push('left: 50%');
      transformParts.push('translateX(-50%)');
      if (Math.round(offsetX) !== 0) transformParts.push(`translateX(${offsetX}px)`);
      break;
    }
    case 'STRETCH':
      styles.push(`left: ${leftPx}px`, `right: ${right}px`);
      break;
    default:
      styles.push(`left: ${leftPx}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = rawTop + node.height / 2;
      const offsetY = roundPx(centerY - parentGroup.height / 2);
      styles.push('top: 50%');
      transformParts.push('translateY(-50%)');
      if (Math.round(offsetY) !== 0) transformParts.push(`translateY(${offsetY}px)`);
      break;
    }
    case 'STRETCH':
      styles.push(`top: ${topPx}px`, `bottom: ${bottom}px`);
      break;
    default:
      styles.push(`top: ${topPx}px`);
      break;
  }

  if (rotated) {
    styles.push(useCenterOrigin ? 'transform-origin: center center' : 'transform-origin: 0 0');
    transformParts.push(`rotate(${cssRotationDeg(rot)}deg)`);
  }
  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }
  return styles;
};

const getAbsolutePositionStyles = (
  node: SceneNode,
  parentFrame: FrameNode | null
) => {
  const styles: string[] = [];
  if (
    !parentFrame ||
    !('layoutPositioning' in node) ||
    node.layoutPositioning !== 'ABSOLUTE'
  ) {
    return styles;
  }

  styles.push('position: absolute');
  const zIndex = parentFrame.children.indexOf(node);
  if (zIndex >= 0) {
    styles.push(`z-index: ${zIndex}`);
  }
  const constraints =
    'constraints' in node
      ? node.constraints
      : { horizontal: 'MIN', vertical: 'MIN' };

  const left = roundPx(node.x);
  const top = roundPx(node.y);
  const right = roundPx(parentFrame.width - (node.x + node.width));
  const bottom = roundPx(parentFrame.height - (node.y + node.height));

  const transformParts: string[] = [];

  switch (constraints.horizontal) {
    case 'MAX':
      styles.push(`right: ${right}px`);
      break;
    case 'CENTER': {
      const centerX = node.x + node.width / 2;
      const offsetX = roundPx(centerX - parentFrame.width / 2);
      styles.push('left: 50%');
      transformParts.push('translateX(-50%)');
      if (Math.round(offsetX) !== 0) {
        transformParts.push(`translateX(${offsetX}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`left: ${left}px`);
      styles.push(`right: ${right}px`);
      break;
    default:
      styles.push(`left: ${left}px`);
      break;
  }

  switch (constraints.vertical) {
    case 'MAX':
      styles.push(`bottom: ${bottom}px`);
      break;
    case 'CENTER': {
      const centerY = node.y + node.height / 2;
      const offsetY = roundPx(centerY - parentFrame.height / 2);
      styles.push('top: 50%');
      transformParts.push('translateY(-50%)');
      if (Math.round(offsetY) !== 0) {
        transformParts.push(`translateY(${offsetY}px)`);
      }
      break;
    }
    case 'STRETCH':
      styles.push(`top: ${top}px`);
      styles.push(`bottom: ${bottom}px`);
      break;
    default:
      styles.push(`top: ${top}px`);
      break;
  }

  if (isMeaningfulRotation(node.rotation)) {
    styles.push('transform-origin: 0 0');
    transformParts.push(`rotate(${cssRotationDeg(node.rotation)}deg)`);
  }

  if (transformParts.length > 0) {
    styles.push(`transform: ${transformParts.join(' ')}`);
  }

  return styles;
};

/** Position styles relative to a container. When container is a mask node, use parent-relative (node.x - container.x, node.y - container.y). decimals: 2 = roundPx, 4 = higher precision for rotated vectors. */
const getPositionStylesRelativeToContainer = (
  node: SceneNode,
  container: { absoluteBoundingBox?: { x: number; y: number } | null; x?: number; y?: number },
  zIndex: number,
  decimals: 2 | 4 = 2
): string[] => {
  const round = decimals === 4 ? roundPx4 : roundPx;
  const styles = ['position: absolute', `z-index: ${zIndex}`];
  if (container && 'isMask' in container && (container as { isMask?: boolean }).isMask === true && typeof (container as { x?: number }).x === 'number' && typeof (container as { y?: number }).y === 'number') {
    const left = round(node.x - (container as { x: number }).x);
    const top = round(node.y - (container as { y: number }).y);
    styles.push(`left: ${left}px`, `top: ${top}px`);
    return styles;
  }
  const containerBounds = container.absoluteBoundingBox;
  const nodeBounds = node.absoluteBoundingBox;
  if (containerBounds && nodeBounds) {
    const left = round(nodeBounds.x - containerBounds.x);
    const top = round(nodeBounds.y - containerBounds.y);
    styles.push(`left: ${left}px`, `top: ${top}px`);
  } else {
    styles.push(`left: ${round(node.x)}px`, `top: ${round(node.y)}px`);
  }
  return styles;
};

const buildInlineStyle = (styles: string[]) => {
  if (styles.length === 0) return '';
  const seen = new Map<string, string>();
  for (const s of styles) {
    const colon = s.indexOf(':');
    if (colon > 0) {
      const prop = s.substring(0, colon).trim();
      seen.set(prop, s.trim());
    }
  }
  const deduped = Array.from(seen.values());
  return `style="${deduped.join('; ')}"`;
};

const getClassForStyle = (
  baseName: string,
  lines: string[],
  context: ExportContext
) => {
  if (!lines.length) return '';
  const signature = lines.join('\n');
  const existing = context.styleMap.get(signature);
  if (existing) return existing;

  const className = getUniqueClassName(baseName, context);
  context.styleMap.set(signature, className);
  const suffixMatch = className.match(/-(\d+)$/);
  const suffix = suffixMatch ? Number(suffixMatch[1]) : 0;
  context.styleEntries.push({
    className,
    baseName,
    suffix,
    cssText: `.${className} {\n${lines.join('\n')}\n}\n\n`,
  });
  return className;
};

/** Styles that are unique per node (positioning) stay inline; shared visuals go to CSS classes. */
const POSITIONAL_STYLE_RE =
  /^(position|left|right|top|bottom|z-index|transform|transform-origin|width|height|min-width|min-height|max-width|max-height|flex|align-self|box-sizing):/;

const splitInlineVsClassStyles = (styles: string[]): { inline: string[]; classLines: string[] } => {
  const inline: string[] = [];
  const classLines: string[] = [];
  for (const s of styles) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (POSITIONAL_STYLE_RE.test(trimmed) || trimmed.startsWith('clip-path:') || trimmed.startsWith('overflow:')) {
      inline.push(trimmed);
    } else {
      classLines.push(`  ${trimmed};`.replace(/;;+/g, ';'));
    }
  }
  return { inline, classLines };
};

const parentHasAbsoluteChildren = (parent: FrameNode | null): boolean => {
  if (!parent || !('children' in parent)) return false;
  return parent.children.some(
    (c) => 'layoutPositioning' in c && c.layoutPositioning === 'ABSOLUTE'
  );
};

const shouldAddRelativeStacking = (
  node: SceneNode,
  parentFrame: FrameNode | null
): boolean => {
  if (!parentFrame || isAbsoluteChild(node, parentFrame)) return false;
  return parentHasAbsoluteChildren(parentFrame);
};

const findHeroHeadingNodeId = (root: SceneNode): string | null => {
  const rootH = 'height' in root ? root.height : 0;
  const band = Math.min(900, rootH * 0.2);
  let bestId: string | null = null;
  let bestSize = -1;
  let bestY = Infinity;

  const walk = (n: SceneNode) => {
    if (n.visible === false) return;
    if (n.type === 'TEXT') {
      const t = n as TextNode;
      const size = typeof t.fontSize === 'number' ? t.fontSize : 0;
      const y = t.y;
      if (size >= 40 && y < band) {
        if (size > bestSize || (size === bestSize && y < bestY)) {
          bestId = t.id;
          bestSize = size;
          bestY = y;
        }
      }
    }
    if ('children' in n) {
      for (const c of n.children) walk(c as SceneNode);
    }
  };
  walk(root);
  return bestId;
};

const nodeToHtmlCss = async (
  node: SceneNode,
  context: ExportContext,
  parentLayoutMode: FrameNode['layoutMode'] | null = null,
  parentFrame: FrameNode | null = null,
  parentGroup: GroupNode | FrameNode | null = null,
  indent: number = 0,
  baseIndent: number = 0,
  positionContainer: SceneNode | null = null,
  flattenedZIndex: number = 0
): Promise<ExportNode> => {
  if (node.visible === false) {
    return { html: '' };
  }

  tickNodeProgress(context, node);

  // Pretty-print: baseIndent=2 so body content aligns under <body>
  const openPrefix = (indent === 0 && baseIndent === 0 ? '' : '\n') + '  '.repeat(baseIndent + indent);
  const closePrefix = '\n' + '  '.repeat(baseIndent + indent);
  const pascalName = toCssClassBase(node.name) || ensureValidCssClassName(`Node${node.id.replace(/[^a-zA-Z0-9]/g, '')}`);
  const baseName = pascalName;
  let className = baseName;
  let html = '';
  let dataLayer = getDataLayerAttr(node.name);
  if (isMaskNode(node)) {
    const mt = getMaskType(node);
    dataLayer += ` data-figma-mask="true"${mt ? ` data-figma-mask-type="${mt}"` : ''}`;
  }

  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const frame = node as FrameNode;
    const isInvisibleSpacer =
      frame.height < 1 &&
      roundPx(frame.opacity) < 0.01 &&
      frame.children.length === 0;
    if (isInvisibleSpacer) {
      return { html: '' };
    }
    const classes: string[] = [];
    if (frame.layoutMode === 'GRID') {
      classes.push(...registerGridUtilities(frame, context));
    } else if (frame.layoutMode !== 'NONE') {
      classes.push(...registerFlexUtilities(frame, context));
    }
    const sizing = registerSizingUtilities(frame, parentLayoutMode, context);
    classes.push(...sizing.classes);

    const styleLines: string[] = [];
    const fill = getFillStyle(frame);
    const inlineStyles = [...sizing.styles];
    let hasPositioningTransform = false;
    if (positionContainer) {
      inlineStyles.push(...getPositionStylesRelativeToContainer(frame, positionContainer, flattenedZIndex));
      hasPositioningTransform = true;
    } else if (parentGroup) {
      inlineStyles.push(...getGroupChildPositionStyles(frame, parentGroup));
      hasPositioningTransform = true;
    } else {
      const absoluteStyles = getAbsolutePositionStyles(frame, parentFrame);
      inlineStyles.push(...absoluteStyles);
      hasPositioningTransform = absoluteStyles.length > 0;
      if (shouldAddRelativeStacking(frame, parentFrame)) {
        inlineStyles.push('position: relative');
        const idx = parentFrame!.children.indexOf(frame);
        const z = parentFrame!.itemReverseZIndex
          ? parentFrame!.children.length - 1 - idx
          : idx + 1;
        inlineStyles.push(`z-index: ${z}`);
      }
    }
    const isRoot = context.rootNode !== null && frame.id === context.rootNode.id;
    let imageSrc: string | null = null;
    if (!isMaskNode(frame)) {
      if (fill) inlineStyles.push(`background: ${fill}`);
      else if (hasImageFill(frame)) {
        imageSrc = await registerImageAsset(frame, context);
        if (imageSrc) {
          if (frame.children.length > 0) {
            inlineStyles.push(
              `background-image: url("${imageSrc}")`,
              'background-size: cover',
              'background-position: center',
              'background-repeat: no-repeat'
            );
            imageSrc = null; // used as background, not <img>
          }
        } else {
          inlineStyles.push('background: #e5e7eb');
        }
      }
    }
    if (isRoot) {
      // Replace fixed artboard width/height with responsive root constraints
      for (let i = inlineStyles.length - 1; i >= 0; i--) {
        if (inlineStyles[i].startsWith('width:') || inlineStyles[i].startsWith('height:')) {
          inlineStyles.splice(i, 1);
        }
      }
      inlineStyles.push(
        'width: 100%',
        `max-width: ${roundDim(frame.width)}px`,
        'margin-inline: auto',
        `min-height: ${roundDim(frame.height)}px`
      );
    }
    const radius = getCornerRadiusStyle(frame);
    if (radius) inlineStyles.push(radius);
    inlineStyles.push(...getStrokeStyles(frame));
    inlineStyles.push(...getEffectsStyles(frame));
    if (frame.opacity < 1) inlineStyles.push(`opacity: ${roundPx(frame.opacity)}`);
    const blend = 'blendMode' in frame ? mapBlendMode(frame.blendMode) : null;
    if (blend && blend !== 'normal') inlineStyles.push(`mix-blend-mode: ${blend}`);
    inlineStyles.push(...getClipsContentStyles(frame));
    // Figma frame dimensions include padding; use border-box so width/height match
    if (frame.layoutMode !== 'NONE') inlineStyles.push('box-sizing: border-box');
    if (isMeaningfulRotation(frame.rotation) && !hasPositioningTransform) {
      inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(frame.rotation)}deg)`);
    }
    const { inline: keepInline, classLines: visualClassLines } = splitInlineVsClassStyles(inlineStyles);
    inlineStyles.length = 0;
    inlineStyles.push(...keepInline);
    if (visualClassLines.length > 0) {
      const visualClass = getClassForStyle(baseName || 'box', visualClassLines, context);
      if (visualClass) classes.push(visualClass);
    }
    if (styleLines.length > 0) {
      className = getClassForStyle(baseName, styleLines, context);
      if (className) classes.push(className);
    }
    if (classes.length === 0) {
      // Avoid empty PascalCase class with no CSS — only add if we register a minimal rule
      if (baseName && baseName !== 'frame') {
        /* skip bare name */
      } else {
        context.usedBaseClasses.add(baseName);
        if (baseName === 'frame') {
          registerUtilityClass(baseName, ['  display: block;'], context);
          classes.push(baseName);
        }
      }
    }
    if (
      frame.layoutMode === 'NONE'
        ? frame.children.length > 0
        : frame.children.some(
            (child) =>
              'layoutPositioning' in child && child.layoutPositioning === 'ABSOLUTE'
          )
    ) {
      inlineStyles.push('position: relative');
    }
    const seen = new Set<string>();
    const finalClasses = classes.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    const hasFlexDir = finalClasses.indexOf('flex-col') >= 0 || finalClasses.indexOf('flex-row') >= 0;
    if (hasFlexDir && finalClasses.indexOf('flex') < 0) {
      finalClasses.unshift('flex');
    }
    html += openPrefix + `<div ${dataLayer}${getClassAttr(finalClasses)}${getStyleAttr(inlineStyles)}>`;
    if (imageSrc) {
      const imgIndent = '  '.repeat(baseIndent + indent + 1);
      html +=
        '\n' +
        imgIndent +
        `<img src="${imageSrc}" alt="" style="display: block; width: 100%; height: 100%; object-fit: cover" />`;
    }

    const childParentLayoutMode =
      frame.layoutMode === 'NONE' ? null : frame.layoutMode;
    const childParentFrame =
      frame.layoutMode === 'NONE' ? null : frame;
    const childParentGroup =
      frame.layoutMode === 'NONE' ? frame : null;
    const frameChildren = Array.from(frame.children);
    const runFrameChild = async (c: SceneNode, posContainer: SceneNode | null, z: number) => {
      const out = await nodeToHtmlCss(
        c,
        context,
        childParentLayoutMode,
        childParentFrame,
        childParentGroup,
        indent + 1,
        baseIndent,
        posContainer,
        z
      );
      return out.html;
    };
    let i = 0;
    while (i < frameChildren.length) {
      const child = frameChildren[i];
      const isGroup = child.type === 'GROUP' || child.type === 'TRANSFORM_GROUP';
      if (frame.layoutMode === 'NONE' && isGroup) {
        const group = child as GroupNode;
        const groupChildren = Array.from(group.children);
        let j = 0;
        while (j < groupChildren.length) {
          const gc = groupChildren[j] as SceneNode;
          if (isMaskNode(gc)) {
            const clipPath = getClipPathFromMaskNode(gc);
            let k = j + 1;
            while (k < groupChildren.length && !isMaskNode(groupChildren[k] as SceneNode)) k++;
            const maskedCount = k - j - 1;
            html += await runFrameChild(gc, frame, j);
            if (maskedCount > 0) {
              const wrapperStyles: string[] = [
                `width: ${roundDim(gc.width)}px`,
                `height: ${roundDim(gc.height)}px`,
                'position: absolute',
                'overflow: hidden',
              ];
              if (clipPath) wrapperStyles.push(`clip-path: ${clipPath}`);
              wrapperStyles.push(...getMaskImageStyles(gc));
              wrapperStyles.push(...getPositionStylesRelativeToContainer(gc, frame, j + 1));
              const innerIndent = '  '.repeat(baseIndent + indent + 1);
              html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
              for (let m = j + 1; m < k; m++) {
                html += await runFrameChild(groupChildren[m] as SceneNode, gc, m - j - 1);
              }
              html += '\n' + innerIndent + '</div>';
            }
            j = k;
          } else {
            html += await runFrameChild(gc, frame, j);
            j++;
          }
        }
        i++;
      } else if (isMaskNode(child)) {
        const clipPath = getClipPathFromMaskNode(child);
        let k = i + 1;
        while (k < frameChildren.length && !isMaskNode(frameChildren[k])) k++;
        const maskedCount = k - i - 1;
        html += await runFrameChild(child, null, 0);
        if (maskedCount > 0) {
          const wrapperStyles: string[] = [
            `width: ${roundDim(child.width)}px`,
            `height: ${roundDim(child.height)}px`,
            'position: absolute',
            'overflow: hidden',
          ];
          if (clipPath) wrapperStyles.push(`clip-path: ${clipPath}`);
          wrapperStyles.push(...getMaskImageStyles(child));
          const idx = i + 1;
          const z = frame.itemReverseZIndex ? frameChildren.length - 1 - idx : idx + 1;
          wrapperStyles.push(...getPositionStylesRelativeToContainer(child, frame, z));
          const innerIndent = '  '.repeat(baseIndent + indent + 1);
          html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
          for (let m = i + 1; m < k; m++) {
            html += await runFrameChild(frameChildren[m], child, m - i - 1);
          }
          html += '\n' + innerIndent + '</div>';
        }
        i = k;
      } else {
        html += await runFrameChild(child, null, 0);
        i++;
      }
    }

    html += closePrefix + `</div>`;
  }

  if (node.type === 'GROUP' || node.type === 'TRANSFORM_GROUP') {
    const group = node as GroupNode;
    const isInvisibleSpacer =
      group.height < 1 &&
      roundPx(group.opacity) < 0.01 &&
      group.children.length === 0;
    if (isInvisibleSpacer) {
      return { html: '' };
    }
    const classes: string[] = [];
    const inlineStyles: string[] = [];
    inlineStyles.push(
      `width: ${roundDim(group.width)}px`,
      `height: ${roundDim(group.height)}px`
    );
    if (positionContainer) {
      inlineStyles.push(...getPositionStylesRelativeToContainer(group, positionContainer, flattenedZIndex));
    } else if (parentGroup) {
      inlineStyles.push(...getGroupChildPositionStyles(group, parentGroup));
    } else if (parentFrame) {
      if ('layoutPositioning' in group && group.layoutPositioning === 'ABSOLUTE') {
        inlineStyles.push(...getAbsolutePositionStyles(group, parentFrame));
      } else if (shouldAddRelativeStacking(group, parentFrame)) {
        inlineStyles.push('position: relative');
        const idx = parentFrame.children.indexOf(group);
        const z = parentFrame.itemReverseZIndex
          ? parentFrame.children.length - 1 - idx
          : idx + 1;
        inlineStyles.push(`z-index: ${z}`);
      }
    }
    // Groups always position children absolutely — establish a containing block
    // even when the group itself sits in normal flex/flow layout.
    if (!inlineStyles.some((s) => s.startsWith('position:'))) {
      inlineStyles.push('position: relative');
    }
    if ('fills' in group && group.fills !== figma.mixed && !isMaskNode(group)) {
      const fill = getFillStyle(group as unknown as GeometryMixin);
      if (fill) inlineStyles.push(`background: ${fill}`);
      else if (hasImageFill(group as unknown as GeometryMixin)) {
        const gImg = await registerImageAsset(group as unknown as SceneNode & GeometryMixin, context);
        if (gImg) {
          inlineStyles.push(
            `background-image: url("${gImg}")`,
            'background-size: cover',
            'background-position: center',
            'background-repeat: no-repeat'
          );
        } else {
          inlineStyles.push('background: #e5e7eb');
        }
      }
    }
    if ('strokes' in group && Array.isArray((group as { strokes?: unknown }).strokes)) {
      inlineStyles.push(...getStrokeStyles(group as unknown as GeometryMixin));
    }
    if ('cornerRadius' in group && (group as SceneNode & { cornerRadius?: unknown }).cornerRadius !== figma.mixed) {
      const radius = getCornerRadiusStyle(group as SceneNode);
      if (radius) inlineStyles.push(radius);
    }
    if ('effects' in group && (group as BlendMixin).effects?.length) {
      inlineStyles.push(...getEffectsStyles(group as BlendMixin));
    }
    if (group.opacity < 1) inlineStyles.push(`opacity: ${roundPx(group.opacity)}`);
    const groupBlend = 'blendMode' in group ? mapBlendMode(group.blendMode) : null;
    if (groupBlend && groupBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${groupBlend}`);
    if (isMeaningfulRotation(group.rotation) && !inlineStyles.some((s) => s.startsWith('transform:'))) {
      inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(group.rotation)}deg)`);
    }

    if (classes.length === 0) {
      context.usedBaseClasses.add(baseName);
      registerUtilityClass('group', ['  display: block;'], context);
      classes.push('group');
    } else if (baseName && baseName.toLowerCase() !== 'group') {
      classes.unshift(baseName);
    }
    const seen = new Set<string>();
    const finalClasses = classes.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    inlineStyles.push('overflow: visible');
    html += openPrefix + `<div ${dataLayer}${getClassAttr(finalClasses)}${getStyleAttr(inlineStyles)}>`;

    const groupChildren = Array.from(group.children).filter((c): c is SceneNode => 'type' in c);
    let gi = 0;
    while (gi < groupChildren.length) {
      const child = groupChildren[gi];
      if (isMaskNode(child)) {
        const clipPath = getClipPathFromMaskNode(child);
        let k = gi + 1;
        while (k < groupChildren.length && !isMaskNode(groupChildren[k])) k++;
        const maskedCount = k - gi - 1;
        const childExport = await nodeToHtmlCss(child, context, null, null, group, indent + 1, baseIndent);
        html += childExport.html;
        if (maskedCount > 0) {
          const wrapperStyles: string[] = [
            `width: ${roundDim(child.width)}px`,
            `height: ${roundDim(child.height)}px`,
            'position: absolute',
            'overflow: hidden',
          ];
          if (clipPath) wrapperStyles.push(`clip-path: ${clipPath}`);
          wrapperStyles.push(...getMaskImageStyles(child));
          wrapperStyles.push(...getPositionStylesRelativeToContainer(child, group, gi + 1));
          const innerIndent = '  '.repeat(baseIndent + indent + 1);
          html += '\n' + innerIndent + `<div ${getClassAttr([])}${getStyleAttr(wrapperStyles)}>`;
          for (let m = gi + 1; m < k; m++) {
            const sibExport = await nodeToHtmlCss(
              groupChildren[m],
              context,
              null,
              null,
              group,
              indent + 1,
              baseIndent,
              child,
              m - gi - 1
            );
            html += sibExport.html;
          }
          html += '\n' + innerIndent + '</div>';
        }
        gi = k;
      } else {
        const childExport = await nodeToHtmlCss(child, context, null, null, group, indent + 1, baseIndent);
        html += childExport.html;
        gi++;
      }
    }

    html += closePrefix + `</div>`;
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    const classes: string[] = [];
    const inlineStyles: string[] = [];
    const fontSize = typeof text.fontSize === 'number' ? Math.round(text.fontSize) : null;
    if (fontSize) {
      const sizeClass = `text-${fontSize}`;
      registerUtilityClass(sizeClass, [`  font-size: ${pxToRem(fontSize)};`], context);
      classes.push(sizeClass);
    }

    const fontWeight = getFontWeightFromStyle(text.fontName);
    if (fontWeight) {
      const weightClass = `font-${fontWeight}`;
      registerUtilityClass(weightClass, [`  font-weight: ${fontWeight};`], context);
      classes.push(weightClass);
    }

    if (text.lineHeight !== figma.mixed && text.lineHeight.unit !== 'AUTO') {
      const value = Math.round(text.lineHeight.value);
      const lineClass = `leading-${formatNegativeClassValue(value)}`;
      const unit = text.lineHeight.unit === 'PERCENT' ? '%' : 'px';
      registerUtilityClass(
        lineClass,
        [`  line-height: ${value}${unit};`],
        context
      );
      classes.push(lineClass);
    }

    if (text.letterSpacing !== figma.mixed) {
      const value = text.letterSpacing.value;
      const trackingClass = `tracking-${formatNegativeClassValue(Math.round(value))}`;
      const cssValue = text.letterSpacing.unit === 'PERCENT'
        ? `${value / 100}em`
        : `${Math.round(value)}px`;
      registerUtilityClass(
        trackingClass,
        [`  letter-spacing: ${cssValue};`],
        context
      );
      classes.push(trackingClass);
    }

    if (text.fontName !== figma.mixed) {
      const family = text.fontName.family;
      if (isFontAwesomeFamily(family)) {
        context.usesFontAwesome = true;
        // Skip Google Fonts / fontfam for FA — use CDN classes instead
      } else if (!isLikelyIconFontFamily(family) || !isIconSlugText(text.characters)) {
        const familyName = sanitizeName(family);
        if (familyName) {
          context.fontFamiliesUsed.add(family);
          const familyClass = `fontfam-${familyName}`;
          registerUtilityClass(
            familyClass,
            [`  font-family: ${formatFontFamily(text.fontName)};`],
            context
          );
          classes.push(familyClass);
        }
      }
    }

    const alignClass = getTextAlignClass(text.textAlignHorizontal);
    if (alignClass) {
      registerUtilityClass(
        alignClass,
        [`  text-align: ${text.textAlignHorizontal.toLowerCase()};`],
        context
      );
      classes.push(alignClass);
    }

    const textCaseVal = getTextCaseClass(text.textCase);
    if (textCaseVal) {
      const caseClass = `tt-${textCaseVal}`;
      registerUtilityClass(caseClass, [`  text-transform: ${textCaseVal};`], context);
      classes.push(caseClass);
    }

    const textDeco = getTextDecorationClass(text.textDecoration);
    if (textDeco) {
      const decoClass = `decoration-${textDeco}`;
      registerUtilityClass(decoClass, [`  text-decoration: ${textDeco};`], context);
      classes.push(decoClass);
    }

    const sizing = registerSizingUtilities(text, parentLayoutMode, context);
    classes.push(...sizing.classes);
    inlineStyles.push(...sizing.styles);
    if (positionContainer) {
      inlineStyles.push(...getPositionStylesRelativeToContainer(text, positionContainer, flattenedZIndex));
    } else if (parentGroup) {
      inlineStyles.push(...getGroupChildPositionStyles(text, parentGroup));
    } else {
      inlineStyles.push(...getAbsolutePositionStyles(text, parentFrame));
      if (shouldAddRelativeStacking(text, parentFrame)) {
        inlineStyles.push('position: relative');
        const idx = parentFrame!.children.indexOf(text);
        const z = parentFrame!.itemReverseZIndex
          ? parentFrame!.children.length - 1 - idx
          : idx + 1;
        inlineStyles.push(`z-index: ${z}`);
      }
    }

    // Font Awesome → <i class="fa-*"> in export; also capture SVG for preview (Pro icons)
    if (text.fontName !== figma.mixed && isFontAwesomeFamily(text.fontName.family)) {
      const styleClass = getFaStyleClass(text.fontName.family);
      const iconName = getFaIconName(text);
      const textFill = getSolidTextFill(text) || getFillStyleFromPaints(text.fills === figma.mixed ? [] : (text.fills as ReadonlyArray<Paint>));
      if (textFill && !/gradient\(/.test(textFill)) inlineStyles.push(`color: ${textFill}`);
      if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
      const textSplit = splitInlineVsClassStyles(inlineStyles);
      if (textSplit.classLines.length > 0) {
        const vc = getClassForStyle(baseName || 'icon', textSplit.classLines, context);
        if (vc) classes.push(vc);
      }

      let previewFaAttr = '';
      try {
        await reportExportProgress(
          `Preview icon… ${truncateLabel(iconName)}`,
          overallPercentFromLayers(context)
        );
        const svgBytes = await text.exportAsync({ format: 'SVG' });
        let svgText = decodeSvgBytes(svgBytes);
        svgText = normalizeSvgToNodeSize(svgText, text.width, text.height);
        const previewId = `fa${context.previewFaIcons.length}`;
        context.previewFaIcons.push({
          id: previewId,
          bytes: encodeSvgText(svgText),
          width: Math.max(1, Math.round(text.width)),
          height: Math.max(1, Math.round(text.height)),
        });
        previewFaAttr = `data-preview-fa="${previewId}" `;
      } catch {
        // Preview SVG is optional; export still uses <i class="fa-*">
      }

      html +=
        openPrefix +
        `<i ${dataLayer}${previewFaAttr}${getClassAttr([...classes, styleClass, `fa-${iconName}`])}${getStyleAttr(textSplit.inline)} aria-hidden="true"></i>`;
      return { html };
    }

    // Non-FA icon font with short slug → export as SVG
    if (
      text.fontName !== figma.mixed &&
      isLikelyIconFontFamily(text.fontName.family) &&
      isIconSlugText(text.characters)
    ) {
      try {
        await reportExportProgress(
          `Exporting icon SVG… ${truncateLabel(text.name || text.characters)}`,
          overallPercentFromLayers(context)
        );
        const svgBytes = await text.exportAsync({ format: 'SVG' });
        let svgText = decodeSvgBytes(svgBytes);
        svgText = normalizeSvgToNodeSize(svgText, text.width, text.height);
        const svgPath = registerSvgAsset(text.name || text.characters || 'icon', svgText, context);
        if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
        const imgIndent = '  '.repeat(baseIndent + indent + 1);
        html +=
          openPrefix +
          `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}>` +
          '\n' +
          buildSvgImgHtml(svgPath, imgIndent) +
          closePrefix +
          `</div>`;
        return { html };
      } catch {
        // fall through to normal text
      }
    }

    let textContent = textToHtml(text.characters);
    if (text.fills === figma.mixed) {
      try {
        const segments = text.getStyledTextSegments(['fills']);
        textContent = segments
          .map((segment) => {
            const paints = segment.fills as ReadonlyArray<Paint>;
            const segmentFill = Array.isArray(paints)
              ? getFillStyleFromPaints(paints)
              : null;
            const segmentText = textToHtml(segment.characters);
            if (!segmentFill) return segmentText;
            const isGradient = /^(linear|radial|conic)-gradient\(/.test(segmentFill);
            const spanStyle = isGradient
              ? `background: ${segmentFill}; color: transparent; background-clip: text; -webkit-background-clip: text`
              : `color: ${segmentFill}`;
            return `<span style="${spanStyle}">${segmentText}</span>`;
          })
          .join('');
      } catch {
        const textFill = getSolidTextFill(text) || getFillStyleFromPaints((text.fills as unknown) as ReadonlyArray<Paint>);
        if (textFill) {
          const isGradient = /^(linear|radial|conic)-gradient\(/.test(textFill);
          if (isGradient) inlineStyles.push(`background: ${textFill}`, 'color: transparent', 'background-clip: text', '-webkit-background-clip: text');
          else inlineStyles.push(`color: ${textFill}`);
        }
      }
    } else {
      const textFill = getSolidTextFill(text) || getFillStyleFromPaints(text.fills as ReadonlyArray<Paint>);
      if (textFill) {
        const isGradient = /^(linear|radial|conic)-gradient\(/.test(textFill);
        if (isGradient) inlineStyles.push(`background: ${textFill}`, 'color: transparent', 'background-clip: text', '-webkit-background-clip: text');
        else inlineStyles.push(`color: ${textFill}`);
      }
    }
    if (text.paragraphSpacing > 0) inlineStyles.push(`margin-bottom: ${pxToRem(text.paragraphSpacing)}`);
    if (text.opacity < 1) inlineStyles.push(`opacity: ${roundPx(text.opacity)}`);
    if (isMeaningfulRotation(text.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(text.rotation)}deg)`);
    }

    const textSplit = splitInlineVsClassStyles(inlineStyles);
    if (textSplit.classLines.length > 0) {
      const vc = getClassForStyle(baseName || 'text', textSplit.classLines, context);
      if (vc) classes.push(vc);
    }

    if (classes.length === 0) {
      registerUtilityClass('text', [], context);
      classes.push('text');
    }
    const tag = context.heroHeadingNodeId === text.id ? 'h1' : 'p';
    html +=
      openPrefix +
      `<${tag} ${dataLayer}${getClassAttr(classes)}${getStyleAttr(textSplit.inline)}>${textContent}</${tag}>`;
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    const isInvisibleSpacer =
      rect.height < 1 && roundPx(rect.opacity) < 0.01;
    if (isInvisibleSpacer) {
      return { html: '' };
    }
    const fill = getSolidFill(rect);
    const rectBlurRadius = getLayerBlurRadius(rect as BlendMixin);
    if (fill && rectBlurRadius > 0) {
      const classes: string[] = [getUniqueClassName(pascalName, context)];
      const container = positionContainer || parentGroup || parentFrame;
      const z = positionContainer
        ? flattenedZIndex
        : parentGroup
          ? parentGroup.children.indexOf(rect)
          : parentFrame
            ? parentFrame.children.indexOf(rect)
            : 0;
      const rotated = isMeaningfulRotation(rect.rotation);
      const aabb = rect.absoluteBoundingBox;
      const blurPx = roundPx(rectBlurRadius / 2);
      const radiusStyle = getCornerRadiusStyle(rect);
      const borderRadius = radiusStyle ? radiusStyle.replace('border-radius: ', '').trim() : null;

      if (rotated && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number') {
        const outerStyles: string[] = [
          `width: ${roundPx(aabb.width)}px`,
          `height: ${roundPx(aabb.height)}px`,
        ];
        if (container) {
          outerStyles.push(...getPositionStylesRelativeToContainer(rect, container, z));
        }
        const innerStyles: string[] = [
          `width: ${roundPx(rect.width)}px`,
          `height: ${roundPx(rect.height)}px`,
          'position: absolute',
          'left: 50%',
          'top: 50%',
          `transform: translate(-50%, -50%) rotate(${cssRotationDeg(rect.rotation)}deg)`,
          `filter: blur(${blurPx}px)`,
        ];
        if (!isMaskNode(rect)) innerStyles.push(`background: ${fill}`);
        if (borderRadius) innerStyles.push(`border-radius: ${borderRadius}`);
        const innerIndent = '  '.repeat(baseIndent + indent + 1);
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>`;
        html += '\n' + innerIndent + `<div ${getStyleAttr(innerStyles)}></div>`;
        html += closePrefix + `</div>`;
      } else {
        const inlineStyles: string[] = [
          `width: ${roundPx(rect.width)}px`,
          `height: ${roundPx(rect.height)}px`,
        ];
        if (container) {
          inlineStyles.push(...getPositionStylesRelativeToContainer(rect, container, z));
        }
        if (!isMaskNode(rect)) inlineStyles.push(`background: ${fill}`);
        if (borderRadius) inlineStyles.push(`border-radius: ${borderRadius}`);
        inlineStyles.push(`filter: blur(${blurPx}px)`);
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}></div>`;
      }
      return { html };
    }

    const classes: string[] = [];
    const styleLines: string[] = [];
    if (rect.cornerRadius !== figma.mixed && typeof rect.cornerRadius === 'number' && rect.cornerRadius > 0) {
      styleLines.push(`  border-radius: ${roundDim(rect.cornerRadius)}px;`);
    }
    if (styleLines.length > 0) {
      className = getClassForStyle(baseName, styleLines, context);
      if (className) classes.push(className);
    }
    const sizing = registerSizingUtilities(rect, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const inlineStyles = [...sizing.styles];
    if (positionContainer) {
      inlineStyles.push(...getPositionStylesRelativeToContainer(rect, positionContainer, flattenedZIndex));
    } else if (parentGroup) {
      inlineStyles.push(...getGroupChildPositionStyles(rect, parentGroup));
    } else {
      inlineStyles.push(...getAbsolutePositionStyles(rect, parentFrame));
      if (shouldAddRelativeStacking(rect, parentFrame)) {
        inlineStyles.push('position: relative');
        const idx = parentFrame!.children.indexOf(rect);
        const z = parentFrame!.itemReverseZIndex
          ? parentFrame!.children.length - 1 - idx
          : idx + 1;
        inlineStyles.push(`z-index: ${z}`);
      }
    }
    const rectFill = isMaskNode(rect) ? null : getFillStyle(rect);
    let rectImageSrc: string | null = null;
    if (rectFill) inlineStyles.push(`background: ${rectFill}`);
    if (!rectFill && !isMaskNode(rect) && hasImageFill(rect)) {
      rectImageSrc = await registerImageAsset(rect, context);
      if (!rectImageSrc) inlineStyles.push('background: #e5e7eb');
    }
    const radius = getCornerRadiusStyle(rect);
    if (radius) inlineStyles.push(radius);
    inlineStyles.push(...getStrokeStyles(rect));
    inlineStyles.push(...getEffectsStyles(rect));
    if (rect.opacity < 1) inlineStyles.push(`opacity: ${roundPx(rect.opacity)}`);
    const rectBlend = 'blendMode' in rect ? mapBlendMode(rect.blendMode) : null;
    if (rectBlend && rectBlend !== 'normal') inlineStyles.push(`mix-blend-mode: ${rectBlend}`);
    if (isMeaningfulRotation(rect.rotation) && inlineStyles.every((style) => !style.startsWith('transform:'))) {
      inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(rect.rotation)}deg)`);
    }
    const rectSplit = splitInlineVsClassStyles(inlineStyles);
    const rectInline = rectSplit.inline;
    if (rectSplit.classLines.length > 0) {
      const vc = getClassForStyle(baseName || 'rect', rectSplit.classLines, context);
      if (vc) classes.push(vc);
    }
    if (rectImageSrc) {
      if (!rectInline.some((s) => s.startsWith('overflow:'))) rectInline.push('overflow: hidden');
      html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(rectInline)}>`;
      const imgIndent = '  '.repeat(baseIndent + indent + 1);
      html +=
        '\n' +
        imgIndent +
        `<img src="${rectImageSrc}" alt="" style="display: block; width: 100%; height: 100%; object-fit: cover" />`;
      html += closePrefix + `</div>`;
    } else {
      html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(rectInline)}></div>`;
    }
  }

  if (node.type === 'ELLIPSE') {
    const ellipse = node as EllipseNode;
    const fill = getSolidFill(ellipse);
    const blurRadius = getLayerBlurRadius(ellipse as BlendMixin);
    if (fill && blurRadius > 0) {
      const classes: string[] = [getUniqueClassName(pascalName, context)];
      const container = positionContainer || parentGroup || parentFrame;
      const z = positionContainer
        ? flattenedZIndex
        : parentGroup
          ? parentGroup.children.indexOf(ellipse)
          : parentFrame
            ? parentFrame.children.indexOf(ellipse)
            : 0;
      const rotated = isMeaningfulRotation(ellipse.rotation);
      const aabb = ellipse.absoluteBoundingBox;
      const blurPx = roundPx(blurRadius / 2);

      if (rotated && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number') {
        const outerStyles: string[] = [
          `width: ${roundPx(aabb.width)}px`,
          `height: ${roundPx(aabb.height)}px`,
        ];
        if (container) {
          outerStyles.push(...getPositionStylesRelativeToContainer(ellipse, container, z));
        }
        const innerStyles: string[] = [
          `width: ${roundPx(ellipse.width)}px`,
          `height: ${roundPx(ellipse.height)}px`,
          'position: absolute',
          'left: 50%',
          'top: 50%',
          `transform: translate(-50%, -50%) rotate(${cssRotationDeg(ellipse.rotation)}deg)`,
          'border-radius: 9999px',
          `filter: blur(${blurPx}px)`,
        ];
        if (!isMaskNode(ellipse)) innerStyles.push(`background: ${fill}`);
        const innerIndent = '  '.repeat(baseIndent + indent + 1);
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>`;
        html += '\n' + innerIndent + `<div ${getStyleAttr(innerStyles)}></div>`;
        html += closePrefix + `</div>`;
      } else {
        const inlineStyles: string[] = [
          `width: ${roundPx(ellipse.width)}px`,
          `height: ${roundPx(ellipse.height)}px`,
        ];
        if (container) {
          inlineStyles.push(...getPositionStylesRelativeToContainer(ellipse, container, z));
        }
        if (!isMaskNode(ellipse)) inlineStyles.push(`background: ${fill}`);
        inlineStyles.push('border-radius: 9999px');
        inlineStyles.push(`filter: blur(${blurPx}px)`);
        html += openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(inlineStyles)}></div>`;
      }
      return { html };
    }
  }

  if (isVectorNode(node)) {
    const classes: string[] = [];
    const sizing = registerSizingUtilities(node, parentLayoutMode, context);
    classes.push(...sizing.classes);
    const baseInlineStyles: string[] = [...sizing.styles];
    if (!baseInlineStyles.some((s) => s.startsWith('width:'))) {
      baseInlineStyles.push(`width: ${roundDim(node.width)}px`);
    }
    if (!baseInlineStyles.some((s) => s.startsWith('height:'))) {
      baseInlineStyles.push(`height: ${roundDim(node.height)}px`);
    }
    if (positionContainer) {
      baseInlineStyles.push(...getPositionStylesRelativeToContainer(node, positionContainer, flattenedZIndex));
    } else if (parentGroup) {
      baseInlineStyles.push(...getGroupChildPositionStyles(node, parentGroup));
    } else {
      baseInlineStyles.push(...getAbsolutePositionStyles(node, parentFrame));
      if (shouldAddRelativeStacking(node, parentFrame)) {
        baseInlineStyles.push('position: relative');
        const idx = parentFrame!.children.indexOf(node);
        const z = parentFrame!.itemReverseZIndex
          ? parentFrame!.children.length - 1 - idx
          : idx + 1;
        baseInlineStyles.push(`z-index: ${z}`);
      }
    }
    baseInlineStyles.push(...getEffectsStyles(node as BlendMixin));
    const vecBlend = 'blendMode' in node ? mapBlendMode(node.blendMode) : null;
    if (vecBlend && vecBlend !== 'normal') baseInlineStyles.push(`mix-blend-mode: ${vecBlend}`);

    // Simple H/V dividers → CSS border (not SVG asset)
    if (isCssDividerLine(node)) {
      const stroke = getStrokePaint(node as GeometryMixin);
      const weight = Math.max(getStrokeWeight(node), 1);
      const color = stroke ? strokePaintToCss(stroke) : '#000000';
      const dashed = !!getStrokeDashPattern(node);
      const orient = getDividerOrientation(node);
      const length = roundDim(Math.max(Math.abs(node.width), Math.abs(node.height)));
      const dividerStyles = baseInlineStyles.filter(
        (s) => !s.startsWith('width:') && !s.startsWith('height:') && !s.startsWith('transform:')
      );
      if (orient === 'horizontal') {
        dividerStyles.push(`width: ${length}px`, 'height: 0');
        dividerStyles.push(
          dashed
            ? `border-top: ${weight}px dashed ${color}`
            : `border-top: ${weight}px solid ${color}`
        );
      } else {
        dividerStyles.push('width: 0', `height: ${length}px`);
        dividerStyles.push(
          dashed
            ? `border-left: ${weight}px dashed ${color}`
            : `border-left: ${weight}px solid ${color}`
        );
      }
      if (node.opacity < 1) dividerStyles.push(`opacity: ${roundPx(node.opacity)}`);
      html +=
        openPrefix +
        `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(dividerStyles)}></div>`;
      return { html };
    }

    const rotated = isMeaningfulRotation(node.rotation);
    const aabb = node.absoluteBoundingBox;
    const useAabbWrapper = rotated && aabb && typeof aabb.width === 'number' && typeof aabb.height === 'number';
    const container = positionContainer || parentGroup || parentFrame;
    const z = positionContainer
      ? flattenedZIndex
      : parentGroup
        ? parentGroup.children.indexOf(node)
        : parentFrame
          ? parentFrame.children.indexOf(node)
          : 0;

    const usePlaceholder = hasInvisibleStrokesOnly(node as GeometryMixin);

    const buildVectorContent = (innerStyles: string[], contentHtml: string): string => {
      if (useAabbWrapper && container) {
        const r = roundPx4;
        const outerStyles: string[] = [
          `width: ${r(aabb!.width)}px`,
          `height: ${r(aabb!.height)}px`,
        ];
        outerStyles.push(...getPositionStylesRelativeToContainer(node, container, z, 4));
        const innerWrapperStyles: string[] = [
          `width: ${r(aabb!.width)}px`,
          `height: ${r(aabb!.height)}px`,
          'position: absolute',
          'left: 50%',
          'top: 50%',
          'transform: translate(-50%, -50%)',
        ];
        const innerIndent = '  '.repeat(baseIndent + indent + 1);
        return (
          openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(outerStyles)}>` +
          '\n' + innerIndent + `<div ${getStyleAttr(innerWrapperStyles)}>` +
          (contentHtml ? '\n' + contentHtml + '\n' + innerIndent : '') +
          `</div>` +
          closePrefix + `</div>`
        );
      }
      return openPrefix + `<div ${dataLayer}${getClassAttr(classes)}${getStyleAttr(innerStyles)}>` +
        (contentHtml ? '\n' + contentHtml + '\n' + '  '.repeat(baseIndent + indent) : '') +
        `</div>`;
    };

    if (usePlaceholder) {
      const inlineStyles = [...baseInlineStyles];
      if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
        inlineStyles.push(`width: ${Math.round(node.width)}px`, `height: ${Math.round(node.height)}px`);
      }
      if (!isMaskNode(node)) {
        const vecFill = getFillStyle(node as GeometryMixin);
        if (vecFill) inlineStyles.push(`background: ${vecFill}`);
        else if (hasImageFill(node as GeometryMixin)) inlineStyles.push('background: #e5e7eb');
        else inlineStyles.push('background: #e5e7eb');
      }
      inlineStyles.push(...getStrokeStyles(node as GeometryMixin));
      if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
      if (!useAabbWrapper) {
        if (isMeaningfulRotation(node.rotation)) inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(node.rotation)}deg)`);
      }
      html += buildVectorContent(inlineStyles, '');
    } else {
      try {
        await reportExportProgress(
          `Exporting SVG… ${truncateLabel(node.name || node.type)}`,
          overallPercentFromLayers(context)
        );
        const svgBytes = await node.exportAsync({ format: 'SVG' });
        let svgText = decodeSvgBytes(svgBytes);
        if (!useAabbWrapper) {
          svgText = normalizeSvgToNodeSize(svgText, node.width, node.height);
        }
        const svgPath = registerSvgAsset(node.name || node.type, svgText, context);
        const svgIndent = '  '.repeat(useAabbWrapper ? baseIndent + indent + 2 : baseIndent + indent + 1);
        const inlineStyles = [...baseInlineStyles];
        if (!useAabbWrapper && isMeaningfulRotation(node.rotation)) {
          inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(node.rotation)}deg)`);
        }
        html += buildVectorContent(inlineStyles, buildSvgImgHtml(svgPath, svgIndent));
      } catch (vectorErr) {
        const inlineStyles = [...baseInlineStyles];
        if (!inlineStyles.some((s) => s.startsWith('width:') || s.startsWith('height:'))) {
          inlineStyles.push(`width: ${roundDim(node.width)}px`, `height: ${roundDim(node.height)}px`);
        }
        if (!isMaskNode(node)) {
          const vecFill = getFillStyle(node as GeometryMixin);
          if (vecFill) inlineStyles.push(`background: ${vecFill}`);
          else if (hasImageFill(node as GeometryMixin)) inlineStyles.push('background: #e5e7eb');
          else inlineStyles.push('background: #e5e7eb');
        }
        inlineStyles.push(...getStrokeStyles(node as GeometryMixin));
        if (node.opacity < 1) inlineStyles.push(`opacity: ${roundPx(node.opacity)}`);
        if (!useAabbWrapper && isMeaningfulRotation(node.rotation)) {
          inlineStyles.push('transform-origin: 0 0', `transform: rotate(${cssRotationDeg(node.rotation)}deg)`);
        }
        html += buildVectorContent(inlineStyles, '');
      }
    }
  }

  return { html };
};

const exportSelection = async (): Promise<ExportResult> => {
  await reportExportProgress('Loading page…', 1);
  await figma.currentPage.loadAsync();
  await reportExportProgress('Checking selection…', 2);
  const selection = figma.currentPage.selection[0];
  const allowedTypes = ['FRAME', 'GROUP', 'TRANSFORM_GROUP', 'COMPONENT', 'INSTANCE'];
  if (!selection || allowedTypes.indexOf(selection.type) === -1) {
    throw new Error('Select a frame, component, instance, or group.');
  }
  const rootNode = selection as SceneNode;

  await reportExportProgress('Scanning layers…', 4);
  const progressTotal = Math.max(1, countExportableNodes(rootNode));
  const imageHashes = new Set<string>();
  countUniqueImageHashes(rootNode, imageHashes);
  const imageTotal = imageHashes.size;
  if (imageTotal > 0) {
    await reportExportProgress(
      `Found ${imageTotal} image${imageTotal === 1 ? '' : 's'} to export…`,
      5
    );
  }

  const context: ExportContext = {
    nameCounts: new Map<string, number>(),
    styleMap: new Map<string, string>(),
    utilityClasses: new Set<string>(),
    styleEntries: [],
    fontFamiliesUsed: new Set<string>(),
    usedBaseClasses: new Set<string>(),
    assets: [],
    assetNameCounts: new Map<string, number>(),
    imageHashToFile: new Map<string, string>(),
    usesFontAwesome: false,
    previewFaIcons: [],
    rootNode,
    rootHeight: rootNode.height,
    heroHeadingNodeId: findHeroHeadingNodeId(rootNode),
    isRootPass: true,
    progressDone: 0,
    progressTotal,
    progressLastReportAt: 0,
    imageTotal,
    imageDone: 0,
  };

  await reportExportProgress('Converting layers…', 5);
  const baseIndent = 2;
  const { html: bodyContent } = await nodeToHtmlCss(rootNode, context, null, null, null, 0, baseIndent);

  await reportExportProgress('Building CSS…', 78);
  const googleFonts = Array.from(context.fontFamiliesUsed)
    .filter((f) => !isFontAwesomeFamily(f))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  const css =
    `html { font-size: ${REM_BASE}px; }\n` +
    `body, p, h1 { margin: 0; }\n\n` +
    context.styleEntries
      .sort((a, b) => {
        const baseCompare = a.baseName.localeCompare(b.baseName);
        if (baseCompare !== 0) return baseCompare;
        return a.suffix - b.suffix;
      })
      .map((entry) => entry.cssText)
      .join('');

  const frameWidth = rootNode.width;
  const frameHeight = rootNode.height;

  await reportExportProgress('Assembling HTML…', 85);
  const fontsLink =
    googleFonts.length > 0
      ? `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${googleFonts}&display=swap" rel="stylesheet">
`
      : '';
  const faLink = context.usesFontAwesome
    ? `    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css">
`
    : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Figma Export</title>
${fontsLink}${faLink}    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
${bodyContent}
  </body>
</html>`;

  const assets: ExportAsset[] = [];
  const assetCount = context.assets.length;
  if (assetCount === 0) {
    await reportExportProgress('Finishing export…', 98);
  }
  for (let i = 0; i < assetCount; i++) {
    const a = context.assets[i];
    const pct = 85 + ((i + 1) / assetCount) * 13;
    await reportExportProgress(`Encoding asset ${i + 1}/${assetCount}… ${a.fileName}`, pct);
    assets.push({
      fileName: a.fileName,
      bytesBase64: uint8ToBase64(a.bytes),
      mimeType: a.mimeType,
    });
  }
  await reportExportProgress('Finishing export…', 99);
  const previewFaIcons: PreviewFaIcon[] = context.previewFaIcons.map((icon) => ({
    id: icon.id,
    bytesBase64: uint8ToBase64(icon.bytes),
    width: icon.width,
    height: icon.height,
  }));
  return { html, css, frameWidth, frameHeight, assets, previewFaIcons };
};

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'export') {
    (async () => {
      try {
        const result = await exportSelection();
        figma.ui.postMessage({
          type: 'export-result',
          html: result.html,
          css: result.css,
          frameWidth: result.frameWidth,
          frameHeight: result.frameHeight,
          assets: result.assets,
          previewFaIcons: result.previewFaIcons,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Export failed.',
        });
      }
    })();
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
