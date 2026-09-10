import { randomUUID } from 'node:crypto';
import { SimulationEngine } from '../src/sim/engine';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../src/data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_MS } from '../src/sim/constants';
import { HUD_REFRESH_INTERVAL_MS } from '../src/ui/state/simStore';
import type { ArenaBounds, MatchConfig } from '../src/sim/types';
import type { BattleStartPayload, HelloPayload, RoomMode, RoomPhase, RoomSlotSummary, RoomSummary, RoomTeam } from '../src/net/protocol';
import { roomCapacityForMode, teamSizeForMode } from '../src/net/protocol';
import { broadcast } from './sse';

export const ROOM_COUNTDOWN_MS = 15_000;
export const ROOM_COMPLETE_HOLD_MS = 8_000;
// Matches SetupScreen's own default level for the local free-for-all flow.
export const MULTIPLAYER_LEVEL = 50;
// Reuses the HUD's own refresh cadence rather than inventing a second
// interval constant that could drift out of sync with it.
const BROADCAST_INTERVAL_MS = HUD_REFRESH_INTERVAL_MS;

interface PlayerSlot {
  playerId: string | null;
  speciesId: number | null;
  isAutoFilled: boolean;
  /** Fixed for the room's lifetime by slot index (see emptySlots()) — null
   * outside a team-mode room. */
  team: RoomTeam | null;
}

interface RoomState {
  id: string;
  name: string;
  mode: RoomMode;
  phase: RoomPhase;
  slots: PlayerSlot[];
  /** Boss Mode only — chosen once at battle start; nobody picks it, so it
   * isn't a PlayerSlot. Null outside 'battle'/'complete'. */
  bossSpeciesId: number | null;
  /** Set once at room creation from whoever created it (see createRoom) —
   * defaults to the portrait constant for the server's own boot-time
   * pre-seeded rooms, which have no client to ask. */
  arena: ArenaBounds;
  countdownEndsAtMs: number | null;
  engine: SimulationEngine | null;
  lastBroadcastSeq: number;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  simTimer: ReturnType<typeof setInterval> | null;
  broadcastTimer: ReturnType<typeof setInterval> | null;
  completeResetTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, RoomState>();
let nextRoomNumber = 1;
const speciesNameById = new Map(listAllSpecies().map((s) => [s.id, s.name]));

// A team room's slots are always laid out with all of Team A's seats first
// (index 0..teamSize-1) then all of Team B's (teamSize..capacity-1) — joinRoom
// always claims the lowest-index open slot, so the split is equivalent to
// "first half of joiners are Team A, second half Team B" without needing any
// separate join-order bookkeeping. It also means startBattle() can hand
// room.slots straight to MatchConfig.speciesIds in slot order and get exactly
// the contiguous halves matchSetup.ts's Team Mode split expects.
function emptySlots(mode: RoomMode): PlayerSlot[] {
  const capacity = roomCapacityForMode(mode);
  const teamSize = teamSizeForMode(mode);
  return Array.from({ length: capacity }, (_, slotIndex) => ({
    playerId: null,
    speciesId: null,
    isAutoFilled: false,
    team: teamSize !== null ? (slotIndex < teamSize ? 'teamA' : 'teamB') : null,
  }));
}

export function createRoom(mode: RoomMode = 'classic', arena?: ArenaBounds) {
  const id = `room-${nextRoomNumber}`;
  const name = `Room ${nextRoomNumber}`;
  nextRoomNumber += 1;
  const room: RoomState = {
    id,
    name,
    mode,
    phase: 'idle',
    slots: emptySlots(mode),
    bossSpeciesId: null,
    arena: arena ?? { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    countdownEndsAtMs: null,
    engine: null,
    lastBroadcastSeq: 0,
    countdownTimer: null,
    simTimer: null,
    broadcastTimer: null,
    completeResetTimer: null,
  };
  rooms.set(id, room);
  return room;
}

export function listRooms() {
  return [...rooms.values()];
}

export function getRoom(id: string) {
  return rooms.get(id);
}

export function toRoomSummary(room: RoomState): RoomSummary {
  const slots: RoomSlotSummary[] = room.slots.map((slot, slotIndex) => ({
    slotIndex,
    playerId: slot.playerId,
    speciesId: slot.speciesId,
    speciesName: slot.speciesId !== null ? (speciesNameById.get(slot.speciesId) ?? null) : null,
    isAutoFilled: slot.isAutoFilled,
    team: slot.team,
  }));
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    phase: room.phase,
    slots,
    countdownEndsAtMs: room.countdownEndsAtMs,
    bossSpeciesName: room.bossSpeciesId !== null ? (speciesNameById.get(room.bossSpeciesId) ?? null) : null,
    capacity: roomCapacityForMode(room.mode),
  };
}

export function getHelloPayload(room: RoomState): HelloPayload {
  return { room: toRoomSummary(room), engineState: room.engine ? room.engine.getState() : null };
}

export function joinRoom(room: RoomState): { ok: true; playerId: string } | { ok: false; error: 'room_full' | 'room_not_joinable' } {
  if (room.phase !== 'idle' && room.phase !== 'countdown') {
    return { ok: false, error: 'room_not_joinable' };
  }
  const slot = room.slots.find((s) => s.playerId === null);
  if (!slot) return { ok: false, error: 'room_full' };

  const playerId = randomUUID();
  slot.playerId = playerId;

  if (room.phase === 'idle') {
    room.phase = 'countdown';
    room.countdownEndsAtMs = Date.now() + ROOM_COUNTDOWN_MS;
    room.countdownTimer = setTimeout(() => startBattle(room), ROOM_COUNTDOWN_MS);
  }

  broadcast(room.id, 'roomUpdate', toRoomSummary(room));
  return { ok: true, playerId };
}

export function pickSpecies(room: RoomState, playerId: string, speciesId: number): { ok: true } | { ok: false; error: string } {
  if (room.phase !== 'countdown') return { ok: false, error: 'picking_closed' };
  const slot = room.slots.find((s) => s.playerId === playerId);
  if (!slot) return { ok: false, error: 'not_in_room' };
  if (!hasPmdSprite(speciesId)) return { ok: false, error: 'invalid_species' };
  if (room.slots.some((s) => s !== slot && s.speciesId === speciesId)) {
    return { ok: false, error: 'species_taken' };
  }

  slot.speciesId = speciesId;
  broadcast(room.id, 'roomUpdate', toRoomSummary(room));
  return { ok: true };
}

function startBattle(room: RoomState): void {
  room.countdownTimer = null;

  // Every slot without a pick gets a random species — whether nobody ever
  // joined it, or someone joined and never picked. One path handles both.
  const chosenIds = room.slots.filter((s) => s.speciesId !== null).map((s) => s.speciesId as number);
  for (const slot of room.slots) {
    if (slot.speciesId !== null) continue;
    const [randomId] = pickRandomSpeciesIds(1, chosenIds);
    slot.speciesId = randomId;
    slot.isAutoFilled = true;
    chosenIds.push(randomId);
  }

  const speciesIds = room.slots.map((s) => s.speciesId as number);

  let bossSpeciesId: number | null = null;
  if (room.mode === 'boss') {
    [bossSpeciesId] = pickRandomSpeciesIds(1, chosenIds);
    room.bossSpeciesId = bossSpeciesId;
  }

  const teamSize = teamSizeForMode(room.mode);

  const config: MatchConfig = {
    level: MULTIPLAYER_LEVEL,
    speciesIds,
    arena: room.arena,
    shiny: false,
    ...(bossSpeciesId !== null ? { boss: { speciesId: bossSpeciesId } } : {}),
    ...(teamSize !== null ? { teams: { size: teamSize } } : {}),
  };
  // Boss Mode's boss species lives outside speciesIds (MatchConfig.boss), so
  // it needs to be requested here too or matchSetup.ts's createMatch throws
  // "Unknown species id" building its instance.
  const allSpeciesIds = bossSpeciesId !== null ? [...speciesIds, bossSpeciesId] : speciesIds;
  const seed = Math.floor(Math.random() * 0xffffffff);
  const engine = new SimulationEngine(config, buildSpeciesMapForLevel(allSpeciesIds, MULTIPLAYER_LEVEL), moveLookup, seed);

  room.phase = 'battle';
  room.countdownEndsAtMs = null;
  room.engine = engine;
  room.lastBroadcastSeq = 0;

  const payload: BattleStartPayload = {
    room: toRoomSummary(room),
    config,
    seed,
    initialState: engine.getState(),
  };
  broadcast(room.id, 'battleStart', payload);

  registerRoomTickLoop(room);
}

function registerRoomTickLoop(room: RoomState): void {
  let lastTickAtMs = Date.now();

  room.simTimer = setInterval(() => {
    const engine = room.engine;
    if (!engine) return;
    const now = Date.now();
    engine.tick(now - lastTickAtMs);
    lastTickAtMs = now;

    if (room.phase === 'battle' && engine.getState().phase === 'complete') {
      room.phase = 'complete';
      broadcast(room.id, 'battleComplete', { finalState: engine.getState() });
      if (room.simTimer) clearInterval(room.simTimer);
      if (room.broadcastTimer) clearInterval(room.broadcastTimer);
      room.simTimer = null;
      room.broadcastTimer = null;
      room.completeResetTimer = setTimeout(() => resetRoom(room), ROOM_COMPLETE_HOLD_MS);
    }
  }, TICK_MS);

  room.broadcastTimer = setInterval(() => {
    const engine = room.engine;
    if (!engine) return;
    const events = engine.getEventsSince(room.lastBroadcastSeq);
    if (events.length > 0) room.lastBroadcastSeq = events[events.length - 1].seq;
    broadcast(room.id, 'stateUpdate', { state: engine.getState(), events });
  }, BROADCAST_INTERVAL_MS);
}

function resetRoom(room: RoomState): void {
  room.completeResetTimer = null;
  room.phase = 'idle';
  room.slots = emptySlots(room.mode);
  room.bossSpeciesId = null;
  room.countdownEndsAtMs = null;
  room.engine = null;
  room.lastBroadcastSeq = 0;
  broadcast(room.id, 'lobbyReset', toRoomSummary(room));
}
