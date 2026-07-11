import type { ExportContext } from '../types';
import { ensureValidCssClassName } from '../utils/names';

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
