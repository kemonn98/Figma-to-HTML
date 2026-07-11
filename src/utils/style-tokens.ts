import { roundAlpha, roundDim } from './color';
import { colorToToken, parseCssColor } from './color-tokens';

const shortHash = (input: string): string => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
};

/** `opacity: 0.6` → `opacity-60`. Returns null for ~0 (skip) or invalid. */
export const opacityLineToClassBase = (line: string): string | null => {
  const m = line.trim().replace(/;+\s*$/, '').match(/^opacity:\s*([\d.]+)$/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v < 0.01) return null; // skip invisible
  if (v >= 0.995) return null; // fully opaque = default
  const pct = Math.round(roundAlpha(v) * 100);
  if (pct <= 0) return null;
  if (pct >= 100) return null;
  return `opacity-${pct}`;
};

/** `border-radius: 8px` → `rounded-8`; `9999px` → `rounded-full`. */
export const roundedLineToClassBase = (line: string): string | null => {
  const m = line
    .trim()
    .replace(/;+\s*$/, '')
    .match(/^border-radius:\s*([\d.]+)px$/i);
  if (!m) return null;
  const px = roundDim(Number(m[1]));
  if (!Number.isFinite(px) || px <= 0) return null;
  if (px >= 9999) return 'rounded-full';
  return `rounded-${px}`;
};

/**
 * Simple inset ring: `box-shadow: inset 0 0 0 1px rgba(...)` → `shadow-inset-1-white-10`
 * Simple drop: `box-shadow: 0 4px 8px 0 rgba(...)` → `shadow-4-8-black-20`
 * Multi-shadow or complex → null (keep layer class).
 */
export const shadowLineToClassBase = (line: string): string | null => {
  const m = line.trim().replace(/;+\s*$/, '').match(/^box-shadow:\s*(.+)$/i);
  if (!m) return null;
  const value = m[1].trim();
  if (value.includes(',')) return null; // multi-shadow

  const inset = value.match(
    /^inset\s+0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+([\d.]+)px\s+(.+)$/i
  );
  if (inset) {
    const w = roundDim(Number(inset[1]));
    const color = parseCssColor(inset[2].trim());
    if (!color || w <= 0) return null;
    return `shadow-inset-${w}-${colorToToken(color)}`;
  }

  const drop = value.match(
    /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/i
  );
  if (drop) {
    const x = roundDim(Number(drop[1]));
    const y = roundDim(Number(drop[2]));
    const blur = roundDim(Number(drop[3]));
    const spread = roundDim(Number(drop[4]));
    const color = parseCssColor(drop[5].trim());
    if (!color) return null;
    if (x === 0 && spread === 0) {
      return `shadow-${y}-${blur}-${colorToToken(color)}`;
    }
    return `shadow-${x}-${y}-${blur}-${spread}-${colorToToken(color)}`;
  }

  return null;
};

/** Gradient background (not text-clip) → `bg-grad-{hash}`. */
export const gradientBgLineToClassBase = (line: string): string | null => {
  const m = line.trim().replace(/;+\s*$/, '').match(/^background:\s*(.+)$/i);
  if (!m) return null;
  const value = m[1].trim();
  if (!/^(linear|radial|conic)-gradient\(/i.test(value)) return null;
  return `bg-grad-${shortHash(value.toLowerCase())}`;
};

export type PeeledStyleLine = {
  classBase: string;
  cssLines: string[];
};

/**
 * Detect gradient-fill text block:
 * background: gradient; color: transparent; background-clip: text; -webkit-background-clip: text
 */
export const peelGradientTextBlock = (
  lines: string[]
): { token: PeeledStyleLine | null; rest: string[] } => {
  const normalized = lines.map((l) => l.trim().replace(/;+\s*$/, ''));
  let bgIdx = -1;
  let colorIdx = -1;
  let clipIdx = -1;
  let webkitIdx = -1;
  for (let i = 0; i < normalized.length; i++) {
    const l = normalized[i];
    if (/^background:\s*(linear|radial|conic)-gradient\(/i.test(l)) bgIdx = i;
    else if (/^color:\s*transparent$/i.test(l)) colorIdx = i;
    else if (/^background-clip:\s*text$/i.test(l)) clipIdx = i;
    else if (/^-webkit-background-clip:\s*text$/i.test(l)) webkitIdx = i;
  }
  if (bgIdx < 0 || colorIdx < 0 || (clipIdx < 0 && webkitIdx < 0)) {
    return { token: null, rest: lines };
  }
  const bgValue = normalized[bgIdx].replace(/^background:\s*/i, '');
  const classBase = `text-grad-${shortHash(bgValue.toLowerCase())}`;
  const cssLines = [
    `  background: ${bgValue};`,
    '  color: transparent;',
    '  background-clip: text;',
    '  -webkit-background-clip: text;',
  ];
  const skip = new Set([bgIdx, colorIdx, clipIdx, webkitIdx].filter((i) => i >= 0));
  const rest = lines.filter((_, i) => !skip.has(i));
  return { token: { classBase, cssLines }, rest };
};

/** Map a single style line to a token class base + normalized CSS, or null. */
export const styleLineToToken = (line: string): PeeledStyleLine | null => {
  const trimmed = line.trim().replace(/;+\s*$/, '');
  const opacity = opacityLineToClassBase(trimmed);
  if (opacity) return { classBase: opacity, cssLines: [`  ${trimmed};`] };

  const rounded = roundedLineToClassBase(trimmed);
  if (rounded) {
    const m = trimmed.match(/^border-radius:\s*([\d.]+)px$/i);
    const px = m ? roundDim(Number(m[1])) : 0;
    const css =
      rounded === 'rounded-full'
        ? '  border-radius: 9999px;'
        : `  border-radius: ${px}px;`;
    return { classBase: rounded, cssLines: [css] };
  }

  const shadow = shadowLineToClassBase(trimmed);
  if (shadow) return { classBase: shadow, cssLines: [`  ${trimmed};`] };

  const gradBg = gradientBgLineToClassBase(trimmed);
  if (gradBg) return { classBase: gradBg, cssLines: [`  ${trimmed};`] };

  return null;
};
