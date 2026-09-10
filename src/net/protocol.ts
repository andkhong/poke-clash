import type { MatchConfig, SimEvent, SimState } from '../sim/types';

/** Shared wire types between game-server/ and the client's multiplayer UI.
 * game-server already imports src/sim/* and src/data/loader.ts directly
 * (it reuses the real SimulationEngine), so importing this module too is
 * consistent with that, not a new precedent. */

export type RoomPhase = 'idle' | 'countdown' | 'battle' | 'complete';

/** 'classic' = today's 4-way free-for-all. 'boss' = the 4 joined players'
 * picks become one allied party against an auto-selected, amplified boss
 * (see sim/bossConfig.ts) — nobody picks the boss, there's no 5th slot.
 * 'teamN' = two opposing sides of N players each (see sim/types.ts's
 * MatchConfig.teams) — teamSizeForMode()/roomCapacityForMode() below derive
 * everything mode-size-dependent (seat count, team split) from this one tag,
 * so nothing else needs a companion "team size" field to stay in sync. */
export type RoomMode = 'classic' | 'boss' | 'team2' | 'team3' | 'team4' | 'team8';

/** Which side a team-mode slot fights on; null for classic/boss rooms. */
export type RoomTeam = 'teamA' | 'teamB';

/** Per-side size for a team-mode room, or null outside Team Mode. */
export function teamSizeForMode(mode: RoomMode): number | null {
  switch (mode) {
    case 'team2': return 2;
    case 'team3': return 3;
    case 'team4': return 4;
    case 'team8': return 8;
    default: return null;
  }
}

/** Total seats a room of this mode has — classic/boss are fixed at 4;
 * team modes are twice their per-side size. */
export function roomCapacityForMode(mode: RoomMode): number {
  const teamSize = teamSizeForMode(mode);
  return teamSize !== null ? teamSize * 2 : 4;
}

export interface RoomSlotSummary {
  slotIndex: number;
  playerId: string | null;
  speciesId: number | null;
  speciesName: string | null;
  isAutoFilled: boolean;
  /** Which side this slot fights on — set only in a team-mode room (see
   * RoomMode), fixed by slot index for the room's whole lifetime. */
  team: RoomTeam | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  mode: RoomMode;
  phase: RoomPhase;
  slots: RoomSlotSummary[];
  countdownEndsAtMs: number | null;
  /** Only meaningful once phase is 'battle'/'complete' in a boss-mode room. */
  bossSpeciesName: string | null;
  /** Total seats this room has — same as `slots.length`, echoed here so the
   * lobby/list screens don't need to derive it themselves. */
  capacity: number;
}

export interface CreateRoomRequest {
  mode?: RoomMode;
  /** The creating client's own chosen arena (see app/config.ts's
   * resolveMatchArena — mobile devices are hard-locked to the portrait
   * arena, desktop browsers can opt into the wide one) — since the sim is
   * server-authoritative and shared by everyone in the room (one arena per
   * match, not per viewer), only whoever creates a room gets any say in its
   * shape. Omitted for the server's own boot-time pre-seeded rooms, which
   * have no client to ask. */
  arena?: { width: number; height: number };
}

export interface HelloPayload {
  room: RoomSummary;
  engineState: SimState | null;
}

export interface BattleStartPayload {
  room: RoomSummary;
  config: MatchConfig;
  seed: number;
  initialState: SimState;
}

export interface StateUpdatePayload {
  state: SimState;
  events: SimEvent[];
}

export interface BattleCompletePayload {
  finalState: SimState;
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
}

export interface CreateRoomResponse {
  room: RoomSummary;
}

export interface JoinRoomResponse {
  playerId: string;
  room: RoomSummary;
}

export interface PickSpeciesRequest {
  playerId: string;
  speciesId: number;
}

export interface PickSpeciesResponse {
  room: RoomSummary;
}

export interface ApiErrorBody {
  error: string;
}
