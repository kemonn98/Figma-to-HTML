export const REM_BASE = 16;

/** Snap to a spacing grid (default 4px) for gap/padding tokens. */
export const snapPx = (px: number, grid = 4): number => {
  if (!Number.isFinite(px) || px === 0) return 0;
  return Math.round(px / grid) * grid;
};

export const pxToRem = (px: number): string => {
  if (!Number.isFinite(px) || px === 0) return '0';
  const rem = px / REM_BASE;
  const rounded = Math.round(rem * 10000) / 10000;
  const str = String(rounded).replace(/\.?0+$/, '');
  return `${str || '0'}rem`;
};

export const roundAlpha = (a: number) => Math.round((a ?? 1) * 100) / 100;

/** Solid color as CSS: hex when opaque, rgba when not. */
export const toCssColor = (r: number, g: number, b: number, a: number): string => {
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

export const roundPx = (n: number) => Math.round(n * 100) / 100;
/** Higher precision for rotated shapes so non-90° angles don't drift from rounding. */
export const roundPx4 = (n: number) => Math.round(n * 10000) / 10000;
export const roundDim = (n: number) => Math.round(n);
export const isMeaningfulRotation = (r: number) => Math.abs(r) >= 0.01;
/** Figma rotation in degrees; negate for correct CSS visual. */
export const cssRotationDeg = (rotation: number) => roundPx(-rotation);
