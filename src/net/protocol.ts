import type { MatchConfig, SimEvent, SimState } from '../sim/types';

/** Shared wire types between game-server/ and the client's multiplayer UI.
 * game-server already imports src/sim/* and src/data/loader.ts directly
 * (it reuses the real SimulationEngine), so importing this module too is
 * consistent with that, not a new precedent. */

export type RoomPhase = 'idle' | 'countdown' | 'battle' | 'complete';

export interface RoomSlotSummary {
  slotIndex: number;
  playerId: string | null;
  speciesId: number | null;
  speciesName: string | null;
  isAutoFilled: boolean;
}

export interface RoomSummary {
  id: string;
  name: string;
  phase: RoomPhase;
  slots: RoomSlotSummary[];
  countdownEndsAtMs: number | null;
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
