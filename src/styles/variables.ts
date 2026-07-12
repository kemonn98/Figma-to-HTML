import type { ExportContext } from '../types';
import { toCssColor, roundPx } from '../utils/color';
import { sanitizeName } from '../utils/names';

/** CSS custom property name from a Figma variable name (e.g. "Color/Primary" → `--color-primary`). */
export const toCssVarName = (figmaName: string): string => {
  const cleaned = sanitizeName(figmaName.replace(/\//g, '-')) || 'token';
  return `--${cleaned}`;
};

export const registerCssVariable = (
  context: ExportContext,
  figmaName: string,
  cssValue: string
): string => {
  const name = toCssVarName(figmaName);
  if (!context.cssVariables.has(name)) {
    context.cssVariables.set(name, cssValue);
  }
  return name;
};

const colorValueToCss = (value: VariableValue): string | null => {
  if (typeof value !== 'object' || value === null || !('r' in value)) return null;
  const c = value as RGB | RGBA;
  const a = 'a' in c && typeof c.a === 'number' ? c.a : 1;
  return toCssColor(c.r, c.g, c.b, a);
};

/**
 * If a solid paint is bound to a COLOR variable, register `--token` and return `var(--token, fallback)`.
 * Unresolved aliases / missing vars → plain fallback color.
 */
export const solidPaintToCssWithVariable = async (
  paint: SolidPaint,
  consumer: SceneNode,
  context: ExportContext
): Promise<string> => {
  const { r, g, b } = paint.color;
  const fallback = toCssColor(r, g, b, paint.opacity ?? 1);
  const alias = paint.boundVariables?.color;
  if (!alias || alias.type !== 'VARIABLE_ALIAS') return fallback;
  try {
    const variable = await figma.variables.getVariableByIdAsync(alias.id);
    if (!variable || variable.resolvedType !== 'COLOR') return fallback;
    const resolved = variable.resolveForConsumer(consumer);
    const css = colorValueToCss(resolved.value);
    if (!css) return fallback;
    const varName = registerCssVariable(context, variable.name, css);
    return `var(${varName}, ${fallback})`;
  } catch {
    return fallback;
  }
};

/** Bind a FLOAT (spacing) variable when present on a node field. */
export const floatBoundToCssVar = async (
  node: SceneNode,
  field: string,
  pxValue: number,
  context: ExportContext
): Promise<string> => {
  const fallback = `${roundPx(pxValue)}px`;
  const bv = 'boundVariables' in node ? (node as { boundVariables?: Record<string, unknown> }).boundVariables : undefined;
  if (!bv) return fallback;
  const alias = bv[field] as VariableAlias | VariableAlias[] | undefined;
  const single = Array.isArray(alias) ? alias[0] : alias;
  if (!single || single.type !== 'VARIABLE_ALIAS') return fallback;
  try {
    const variable = await figma.variables.getVariableByIdAsync(single.id);
    if (!variable || variable.resolvedType !== 'FLOAT') return fallback;
    const resolved = variable.resolveForConsumer(node);
    const num = typeof resolved.value === 'number' ? resolved.value : pxValue;
    const css = `${roundPx(num)}px`;
    const varName = registerCssVariable(context, variable.name, css);
    return `var(${varName}, ${fallback})`;
  } catch {
    return fallback;
  }
};

/** Emit `:root { … }` block from collected variables, or empty string. */
export const buildCssVariablesBlock = (context: ExportContext): string => {
  if (context.cssVariables.size === 0) return '';
  const lines = Array.from(context.cssVariables.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}\n\n`;
};
