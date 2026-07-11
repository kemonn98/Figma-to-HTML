export const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

/** PascalCase class name from layer name, e.g. "Frame 2095585183" → "Frame2095585183" */
export const toPascalCase = (name: string) => {
  const parts = name.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
};

/**
 * CSS class names must be valid identifiers — they cannot start with a digit
 * (e.g. layer "$1.299" must not become `.1299`).
 */
export const ensureValidCssClassName = (name: string): string => {
  let n = (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!n) return 'Layer';
  if (/^[0-9]/.test(n)) n = `N${n}`;
  if (!/^[A-Za-z_]/.test(n)) n = `Layer${n}`;
  return n;
};

/** Layer name → safe CSS class base (PascalCase, never starts with a digit). */
export const toCssClassBase = (name: string): string =>
  ensureValidCssClassName(toPascalCase(name) || sanitizeName(name).replace(/-/g, '') || 'Layer');

export const getDataLayerAttr = (name: string) => {
  const escaped = name.replace(/"/g, '&quot;');
  return `data-layer="${escaped}" `;
};

export const formatNegativeClassValue = (value: number) => {
  const absValue = Math.round(Math.abs(value));
  return value < 0 ? `neg-${absValue}` : `${absValue}`;
};
