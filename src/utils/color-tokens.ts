import { roundAlpha } from './color';

export type RgbaColor = { r: number; g: number; b: number; a: number };

/** Named palette (sRGB 0–255). Exact / near matches become tokens like `black`, `white-90`. */
const NAMED_COLORS: ReadonlyArray<{ name: string; r: number; g: number; b: number }> = [
  { name: 'black', r: 0, g: 0, b: 0 },
  { name: 'white', r: 255, g: 255, b: 255 },
  { name: 'red', r: 255, g: 0, b: 0 },
  { name: 'green', r: 0, g: 128, b: 0 },
  { name: 'blue', r: 0, g: 0, b: 255 },
  { name: 'yellow', r: 255, g: 255, b: 0 },
  { name: 'orange', r: 255, g: 165, b: 0 },
  { name: 'purple', r: 128, g: 0, b: 128 },
  { name: 'gray', r: 128, g: 128, b: 128 },
  { name: 'grey', r: 128, g: 128, b: 128 },
];

/** Max channel distance (0–255) to treat a color as a named swatch. */
const NAMED_COLOR_TOLERANCE = 2;

const hexByte = (n: number) => ('0' + Math.round(n).toString(16)).slice(-2).toLowerCase();

export const parseCssColor = (value: string): RgbaColor | null => {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }

  const rgba = v.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgba) {
    return {
      r: Math.round(Number(rgba[1])),
      g: Math.round(Number(rgba[2])),
      b: Math.round(Number(rgba[3])),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }

  return null;
};

const findNamedColor = (r: number, g: number, b: number): string | null => {
  for (const swatch of NAMED_COLORS) {
    if (
      Math.abs(swatch.r - r) <= NAMED_COLOR_TOLERANCE &&
      Math.abs(swatch.g - g) <= NAMED_COLOR_TOLERANCE &&
      Math.abs(swatch.b - b) <= NAMED_COLOR_TOLERANCE
    ) {
      return swatch.name === 'grey' ? 'gray' : swatch.name;
    }
  }
  return null;
};

/** Opacity as integer percent 1–99 (100 / opaque → no suffix). */
export const opacityPercent = (a: number): number | null => {
  const alpha = roundAlpha(a);
  if (alpha >= 1 || Math.abs(alpha - 1) < 0.005) return null;
  const pct = Math.round(alpha * 100);
  if (pct <= 0) return 0;
  if (pct >= 100) return null;
  return pct;
};

/**
 * Color library token: `black`, `white-90`, `c-a3a3a3`, `c-ff5500-50`.
 * Custom hex always uses `c-` prefix so class names never start with a digit.
 */
export const colorToToken = (color: RgbaColor): string => {
  const named = findNamedColor(color.r, color.g, color.b);
  const pct = opacityPercent(color.a);
  if (named) {
    return pct === null ? named : `${named}-${pct}`;
  }
  const hex = hexByte(color.r) + hexByte(color.g) + hexByte(color.b);
  return pct === null ? `c-${hex}` : `c-${hex}-${pct}`;
};

export type ColorCssProperty = 'color' | 'background' | 'background-color';

/**
 * If `line` is a solid color declaration, return utility class base:
 * `text-black-50`, `bg-white`, `bg-c-0835ff`.
 */
export const colorLineToClassBase = (line: string): string | null => {
  const trimmed = line.trim().replace(/;+\s*$/, '');
  const m = trimmed.match(/^(color|background-color|background):\s*(.+)$/i);
  if (!m) return null;
  const prop = m[1].toLowerCase() as ColorCssProperty;
  const value = m[2].trim();
  if (/gradient\(/i.test(value) || /url\(/i.test(value)) return null;
  const parsed = parseCssColor(value);
  if (!parsed) return null;
  const token = colorToToken(parsed);
  const prefix = prop === 'color' ? 'text' : 'bg';
  return `${prefix}-${token}`;
};
