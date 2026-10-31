import type { SpeciesData } from '../matchSetup';
import type { MoveDefinition } from '../types';

// Shared by the Play Mode engine tests (sim/action and net/play).

export const MOVES: MoveDefinition[] = [
  { id: 1, name: 'Fixture Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, targeting: 'enemy' },
  { id: 2, name: 'Fixture Ember', type: 'fire', category: 'special', power: 40, accuracy: 50, pp: 25, priority: 0, targeting: 'enemy' },
  { id: 3, name: 'Fixture Quake', type: 'ground', category: 'physical', power: 60, accuracy: 100, pp: 10, priority: 0, targeting: 'all-enemies-in-radius' },
  { id: 4, name: 'Fixture Swords Dance', type: 'normal', category: 'status', power: null, accuracy: null, pp: 20, priority: 0, targeting: 'self', effect: { kind: 'statStage', target: 'self', statChanges: { atk: 2 } } },
];
const movesById = new Map(MOVES.map((m) => [m.id, m]));
export const lookup = (id: number) => movesById.get(id);

const stats = { hp: 80, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 };
export const SPECIES: Record<number, SpeciesData> = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, { id, name: `Fix${id}`, types: ['normal'], baseStats: stats, movePool: [2, 1, 3, 4], collisionRadius: 40 }])
);
export const MOVESET = { customMoves: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, [2, 1, 3, 4]])) };
