import type { PokemonTypeName } from '../../sim/types';

// Move-name callout box colors, keyed by move type — matches the color coding
// observed in the example videos (fire=orange, water=blue, grass=green,
// electric=olive, ground=tan, dragon=purple, etc.), using the standard
// competitive-Pokémon type-color palette as the base.
const TYPE_COLORS: Record<PokemonTypeName, number> = {
  normal: 0xa8a878,
  fire: 0xf08030,
  water: 0x6890f0,
  electric: 0xd0b030,
  grass: 0x60a040,
  ice: 0x60c8c8,
  fighting: 0xa03028,
  poison: 0x9040a0,
  ground: 0xc8a050,
  flying: 0x9098f8,
  psychic: 0xe85898,
  bug: 0x90a818,
  rock: 0xa89040,
  ghost: 0x604878,
  dragon: 0x6040c0,
  dark: 0x5c4a3a,
  steel: 0x8098a8,
  fairy: 0xd888c0,
};

export function getMoveTypeColor(type: PokemonTypeName): number {
  return TYPE_COLORS[type] ?? TYPE_COLORS.normal;
}
