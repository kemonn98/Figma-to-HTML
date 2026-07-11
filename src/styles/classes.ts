import type { ExportContext } from '../types';
import { ensureValidCssClassName } from '../utils/names';
import { colorLineToClassBase } from '../utils/color-tokens';
import { peelGradientTextBlock, styleLineToToken } from '../utils/style-tokens';

export const getUniqueClassName = (base: string, context: ExportContext) => {
  const safeBase = ensureValidCssClassName(base);
  const nextCount = (context.nameCounts.get(safeBase) ?? 0) + 1;
  context.nameCounts.set(safeBase, nextCount);
  return nextCount === 1 ? safeBase : `${safeBase}-${nextCount}`;
};

export const getBaseNameAndSuffix = (className: string) => {
  const match = className.match(/^(.*?)-(\d+)$/);
  if (match) {
    return { baseName: match[1], suffix: Number(match[2]) };
  }
  return { baseName: className, suffix: 0 };
};

export const registerUtilityClass = (
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

export const getClassForStyle = (
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

/** Register a preferred utility class name for a CSS signature (color / style tokens). */
export const registerNamedStyleClass = (
  classBase: string,
  cssLines: string[],
  context: ExportContext
): string => {
  const signature = cssLines.join('\n');
  const existing = context.styleMap.get(signature);
  if (existing) return existing;

  let className = ensureValidCssClassName(classBase);
  const alreadyEntry = context.styleEntries.find((e) => e.className === className);
  const expectedCss = `.${className} {\n${signature}\n}\n\n`;
  if (alreadyEntry) {
    if (alreadyEntry.cssText === expectedCss) {
      context.styleMap.set(signature, className);
      return className;
    }
    className = getUniqueClassName(classBase, context);
  } else {
    context.nameCounts.set(className, 1);
  }

  context.styleMap.set(signature, className);
  if (!context.utilityClasses.has(className)) {
    const { baseName, suffix } = getBaseNameAndSuffix(className);
    context.utilityClasses.add(className);
    context.styleEntries.push({
      className,
      baseName,
      suffix,
      cssText: `.${className} {\n${signature}\n}\n\n`,
    });
  }
  return className;
};

/**
 * Register a single solid-color declaration as a shared color utility
 * (`text-black-50`, `bg-white`, …). Returns null for non-color / gradient lines.
 */
export const registerColorStyleClass = (
  line: string,
  context: ExportContext
): string | null => {
  const classBase = colorLineToClassBase(line);
  if (!classBase) return null;

  const normalized = line.trim().replace(/;+\s*$/, '');
  const propMatch = normalized.match(/^(color|background-color|background):\s*(.+)$/i);
  if (!propMatch) return null;
  const cssNormalized = `  ${propMatch[1].toLowerCase()}: ${propMatch[2].trim()};`;
  return registerNamedStyleClass(classBase, [cssNormalized], context);
};

/**
 * Peel solid colors + style tokens into shared utilities; leftovers keep layer-based names.
 */
export const assignStyleClasses = (
  baseName: string,
  lines: string[],
  context: ExportContext
): string[] => {
  const classes: string[] = [];
  const { token: gradText, rest: afterGradText } = peelGradientTextBlock(lines);
  if (gradText) {
    classes.push(registerNamedStyleClass(gradText.classBase, gradText.cssLines, context));
  }

  const rest: string[] = [];
  for (const line of afterGradText) {
    const colorClass = registerColorStyleClass(line, context);
    if (colorClass) {
      classes.push(colorClass);
      continue;
    }
    const styleToken = styleLineToToken(line);
    if (styleToken) {
      // opacityLineToClassBase returns null for ~0; styleLineToToken skips those
      classes.push(
        registerNamedStyleClass(styleToken.classBase, styleToken.cssLines, context)
      );
      continue;
    }
    // Drop bare opacity ≈ 0 lines instead of layer-naming them
    if (/^\s*opacity:\s*0(\.0+)?\s*;?\s*$/i.test(line.trim())) continue;
    rest.push(line);
  }
  if (rest.length > 0) {
    const visual = getClassForStyle(baseName, rest, context);
    if (visual) classes.push(visual);
  }
  return classes;
};

/** Styles that are unique per node (positioning) stay inline; shared visuals go to CSS classes. */
export const POSITIONAL_STYLE_RE =
  /^(position|left|right|top|bottom|z-index|transform|transform-origin|width|height|min-width|min-height|max-width|max-height|flex|align-self|box-sizing):/;

export const splitInlineVsClassStyles = (styles: string[]): { inline: string[]; classLines: string[] } => {
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
