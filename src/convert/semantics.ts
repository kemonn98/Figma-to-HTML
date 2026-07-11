/** Lightweight semantic hints for AI-friendly markup (not full a11y). */

const BUTTON_NAME_RE = /\b(button|btn|cta)\b/i;
const LINK_NAME_RE = /\b(link|nav\s*link)\b/i;

export const isButtonLayerName = (name: string): boolean => BUTTON_NAME_RE.test(name.trim());

export const isLinkLayerName = (name: string): boolean => {
  const n = name.trim();
  if (BUTTON_NAME_RE.test(n)) return false;
  return LINK_NAME_RE.test(n) || /^link$/i.test(n);
};

/** Prefer semantic container tag for frames/groups from layer name. */
export const semanticContainerTag = (name: string): 'button' | 'a' | 'div' => {
  if (isButtonLayerName(name)) return 'button';
  if (isLinkLayerName(name)) return 'a';
  return 'div';
};

export const semanticContainerOpenAttrs = (tag: 'button' | 'a' | 'div'): string => {
  if (tag === 'button') return 'type="button" ';
  if (tag === 'a') return 'href="#" ';
  return '';
};

/**
 * Heading band for text (hero h1 handled separately).
 * >= 32 → h2, >= 24 → h3, else p.
 */
export const textHeadingTag = (
  fontSize: number | null,
  isHeroH1: boolean
): 'h1' | 'h2' | 'h3' | 'p' => {
  if (isHeroH1) return 'h1';
  if (fontSize != null && fontSize >= 32) return 'h2';
  if (fontSize != null && fontSize >= 24) return 'h3';
  return 'p';
};
