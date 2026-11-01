import { buildSpeciesDataForLevel, hasPmdSprite, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../data/loader';
import type { ArenaBounds, MatchConfig } from '../sim/types';

// Play Mode match setup, shared by solo play (PlayModeScreen) and the online
// rooms on the game server (game-server/playRooms.ts).

export type PlayModeKind = 1 | 2 | 3 | 4 | 'ffa';

export const PLAY_MODES: { value: PlayModeKind; label: string }[] = [
  { value: 1, label: '1v1' },
  { value: 2, label: '2v2' },
  { value: 3, label: '3v3' },
  { value: 4, label: '4v4' },
  { value: 'ffa', label: 'FFA · 8' },
];

export const PLAY_LEVEL = 50;

/** A move that can hurt someone without taking its user down. */
function canDealDamage(moveId: number): boolean {
  const move = moveLookup(moveId);
  return !!move && (move.power ?? 0) > 0 && !move.userFaints;
}

/** Play Mode starts with the original 151 only — minus the few (Ditto,
 * Metapod, Kakuna) whose level-50 pool has no damaging move, which a player
 * could pick and then never attack with. */
export const KANTO_IDS: readonly number[] = listAllSpecies()
  .map((s) => s.id)
  .filter((id) => id <= 151 && hasPmdSprite(id) && (buildSpeciesDataForLevel(id, PLAY_LEVEL)?.movePool ?? []).some(canDealDamage));

export function isPlayModeKind(value: unknown): value is PlayModeKind {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 'ffa';
}

export function seatCount(mode: PlayModeKind): number {
  return mode === 'ffa' ? 8 : mode * 2;
}

/** Seats 0..size-1 are Team A, the rest Team B (createMatch's split); FFA has no teams. */
export function seatTeam(mode: PlayModeKind, seat: number): 'teamA' | 'teamB' | null {
  if (mode === 'ffa') return null;
  return seat < mode ? 'teamA' : 'teamB';
}

/** A random 4 from the species' pool. Self-KO moves (Explosion…) are left
 * out: on a click-to-fire slot they just throw a life away. */
export function rollMoves(speciesId: number): number[] {
  const pool = [...(buildSpeciesDataForLevel(speciesId, PLAY_LEVEL)?.movePool ?? [])].filter((id) => {
    const move = moveLookup(id);
    return move !== undefined && !move.userFaints;
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, 4);
  // Never four status moves: a fighter that can't hurt anyone can't win.
  const damaging = pool.find(canDealDamage);
  if (damaging !== undefined && !picked.some(canDealDamage)) picked[picked.length - 1] = damaging;
  return picked;
}

/** One match's config from its seats in order: a filled seat brings its
 * species and moves, an empty one (null) gets a random bot. No species
 * appears twice anywhere, which covers "no duplicates on a team". */
export function buildPlayMatchConfig(
  mode: PlayModeKind,
  seats: ({ speciesId: number; moves: number[] } | null)[],
  arena: ArenaBounds
): MatchConfig {
  const taken = seats.flatMap((seat) => (seat ? [seat.speciesId] : []));
  const botSpecies = pickRandomSpeciesIds(seats.filter((seat) => !seat).length, taken, KANTO_IDS);
  const filled = seats.map((seat) => seat ?? { speciesId: botSpecies.shift()!, moves: [] });
  return {
    level: PLAY_LEVEL,
    speciesIds: filled.map((seat) => seat.speciesId),
    arena,
    shiny: false,
    customMoves: Object.fromEntries(filled.map((seat) => [seat.speciesId, seat.moves.length > 0 ? seat.moves : rollMoves(seat.speciesId)])),
    ...(mode === 'ffa' ? {} : { teams: { size: mode } }),
  };
}
