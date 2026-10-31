import type { PokemonTypeName } from '../sim/types';
import { getMoveTypeColor } from '../render/vfx/typeColor';

/** The arena's move-type color as a CSS color, for DOM screens that show moves. */
export function typeColorCss(type: PokemonTypeName): string {
  return `#${getMoveTypeColor(type).toString(16).padStart(6, '0')}`;
}
