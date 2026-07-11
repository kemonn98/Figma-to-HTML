import { toCssColor, roundDim, roundPx } from '../utils/color';

export const getEffectsStyles = (node: BlendMixin): string[] => {
  const styles: string[] = [];
  if (!('effects' in node) || node.effects.length === 0) return styles;
  const shadows: string[] = [];
  let blur = 0;
  for (const e of node.effects) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      const { r, g, b } = e.color;
      const a = 'a' in e.color ? e.color.a : 1;
      const color = toCssColor(r, g, b, a);
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'INNER_SHADOW') {
      const { r, g, b } = e.color;
      const a = 'a' in e.color ? e.color.a : 1;
      const color = toCssColor(r, g, b, a);
      const spread = roundDim('spread' in e ? e.spread || 0 : 0);
      shadows.push(`inset ${roundDim(e.offset.x)}px ${roundDim(e.offset.y)}px ${roundDim(e.radius)}px ${spread}px ${color}`);
    } else if (e.type === 'LAYER_BLUR') {
      blur = roundDim(e.radius);
    }
  }
  if (shadows.length > 0) styles.push(`box-shadow: ${shadows.join(', ')}`);
  if (blur > 0) styles.push(`filter: blur(${roundPx(blur / 2)}px)`);
  return styles;
};

export const mapBlendMode = (mode: BlendMode): string | null => {
  const m: Record<string, string> = {
    PASS_THROUGH: 'normal',
    NORMAL: 'normal',
    DARKEN: 'darken',
    MULTIPLY: 'multiply',
    LINEAR_BURN: 'color-burn',
    COLOR_BURN: 'color-burn',
    LIGHTEN: 'lighten',
    SCREEN: 'screen',
    LINEAR_DODGE: 'color-dodge',
    COLOR_DODGE: 'color-dodge',
    OVERLAY: 'overlay',
    SOFT_LIGHT: 'soft-light',
    HARD_LIGHT: 'hard-light',
    DIFFERENCE: 'difference',
    EXCLUSION: 'exclusion',
    HUE: 'hue',
    SATURATION: 'saturation',
    COLOR: 'color',
    LUMINOSITY: 'luminosity',
  };
  return m[mode] ?? null;
};
