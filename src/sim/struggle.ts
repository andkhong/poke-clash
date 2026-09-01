import type { MoveDefinition } from './types';

// The real games never let a Pokémon "do nothing" when every move is out of PP —
// it's forced to use Struggle: typeless, no STAB, no type-chart interaction, and
// it recoils 25% of the user's own max HP. Not part of the generated move dataset
// (it's a fallback, not a learnable move), so it's a small hardcoded constant here.
export const STRUGGLE_MOVE_ID = -1;
export const STRUGGLE_RECOIL_FRACTION = 0.25;

export const STRUGGLE_MOVE: MoveDefinition = {
  id: STRUGGLE_MOVE_ID,
  name: 'Struggle',
  type: 'normal',
  category: 'physical',
  power: 50,
  accuracy: null,
  pp: 1,
  priority: 0,
  targeting: 'enemy',
  typeless: true,
};
