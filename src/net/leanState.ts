import type { PokemonInstance, SimState } from '../sim/types';

/**
 * The wire shape of a multiplayer room's 10 Hz `stateUpdate` broadcast
 * (game-server/roomManager.ts). A full SimState carries every Pokémon's
 * whole record — ~1 KB each, 16 KB per update for a 16-seat room, 160 KB/s
 * per viewer — most of which never changes after spawn (species, name,
 * stats, moves, collision radius, ...) or is sim-internal bookkeeping no
 * renderer reads (wander waypoints, cooldowns, stat stages, velocity). Every
 * viewer already holds the full snapshot from the `hello` / `battleStart`
 * payloads, so an update only needs the per-Pokémon fields that both change
 * over a match *and* something on the client displays; the client merges
 * them over its snapshot (see mergeLeanState / RemoteSimEngine). Everything
 * at the top level of SimState is small and kept as-is.
 *
 * If a renderer starts reading a new mutable PokemonInstance field, add it
 * to LEAN_POKEMON_FIELDS — a field left out is silently frozen at its
 * battleStart value on every spectator's screen.
 */
export const LEAN_POKEMON_FIELDS = [
  'currentHp',
  'status',
  'position',
  'facing',
  'aiState',
  'targetInstanceId',
  'postAttackHoldMs',
  'lastHitAtMs',
  'lastDamagedByInstanceId',
] as const;

export type LeanPokemonField = (typeof LEAN_POKEMON_FIELDS)[number];
export type LeanPokemon = Pick<PokemonInstance, LeanPokemonField>;

export interface LeanSimState extends Omit<SimState, 'pokemon'> {
  pokemon: Record<string, LeanPokemon>;
}

/** Positions go out at a tenth of a pixel: sprites lerp between two 100 ms
 * snapshots (RemoteSimEngine), so anything finer is invisible, and it stops
 * JSON spelling every coordinate out to 15+ digits. */
const POSITION_SCALE = 10;

function roundCoordinate(value: number): number {
  return Math.round(value * POSITION_SCALE) / POSITION_SCALE;
}

/** The broadcast form of `state` — see the module comment. */
export function toLeanState(state: Readonly<SimState>): LeanSimState {
  const pokemon: Record<string, LeanPokemon> = {};
  for (const id of state.allInstanceIds) {
    const p = state.pokemon[id];
    if (!p) continue;
    const lean: LeanPokemon = {
      currentHp: p.currentHp,
      status: p.status,
      position: { x: roundCoordinate(p.position.x), y: roundCoordinate(p.position.y) },
      facing: p.facing,
      aiState: p.aiState,
      targetInstanceId: p.targetInstanceId,
      postAttackHoldMs: p.postAttackHoldMs,
    };
    // Optional fields are only ever set (never cleared) by the sim, so leaving
    // an unset one off the wire is both smaller and merge-safe.
    if (p.lastHitAtMs !== undefined) lean.lastHitAtMs = p.lastHitAtMs;
    if (p.lastDamagedByInstanceId !== undefined) lean.lastDamagedByInstanceId = p.lastDamagedByInstanceId;
    pokemon[id] = lean;
  }
  return { ...state, pokemon };
}

/** `prev` (a full snapshot) with `update`'s fields laid over it. Also accepts
 * a full SimState as `update` — its per-Pokémon records are supersets of the
 * lean ones — so a client stays compatible with a server that still sends
 * full states. A Pokémon the snapshot never had is dropped rather than
 * admitted as a half-built record. */
export function mergeLeanState(prev: Readonly<SimState>, update: LeanSimState): SimState {
  const pokemon: Record<string, PokemonInstance> = { ...prev.pokemon };
  for (const id in update.pokemon) {
    const base = prev.pokemon[id];
    if (!base) continue;
    pokemon[id] = { ...base, ...update.pokemon[id] };
  }
  return { ...update, pokemon };
}
