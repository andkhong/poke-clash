import type { PokemonTypeName } from '../sim/types';
import { getMoveTypeColor } from '../render/vfx/typeColor';
import { INK } from './theme';

// The arena's fills that fail INK text (< 4.5:1), lifted a step lighter for
// DOM chips so INK still reads on them.
const LIGHTER: Partial<Record<PokemonTypeName, string>> = {
  water: '#7898f8',
  grass: '#78b850',
  psychic: '#f070a0',
  rock: '#b8a050',
  steel: '#90a8b8',
};
// Too dark for INK at any lift; these carry white text (≥ 6:1) instead.
const DARK: ReadonlySet<PokemonTypeName> = new Set(['fighting', 'poison', 'ghost', 'dragon', 'dark']);

/** The arena's move-type color as a CSS color, for DOM screens that show moves. */
export function typeColorCss(type: PokemonTypeName): string {
  return LIGHTER[type] ?? `#${getMoveTypeColor(type).toString(16).padStart(6, '0')}`;
}

/** Text color for a typeColorCss fill: INK, or white on the dark types. */
export function typeTextCss(type: PokemonTypeName): string {
  return DARK.has(type) ? '#ffffff' : INK;
}
