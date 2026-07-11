export const sanitizeExportText = (text: string): string =>
  text
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

export const escapeHtml = (text: string) =>
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
export const textToHtml = (text: string): string =>
  escapeHtml(sanitizeExportText(text)).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');

export const uint8ToBase64 = (bytes: Uint8Array): string => {
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

export const getClassAttr = (classes: string[]) => {
  const joined = classes.filter(Boolean).join(' ').trim();
  if (!joined) return '';
  return `class="${joined}" `;
};

export const getStyleAttr = (styles: string[]) => buildInlineStyle(styles);

export const buildInlineStyle = (styles: string[]) => {
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
