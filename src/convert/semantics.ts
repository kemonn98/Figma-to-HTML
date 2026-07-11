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
