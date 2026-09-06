import { randomUUID } from 'node:crypto';
import { SimulationEngine } from '../src/sim/engine';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../src/data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_MS } from '../src/sim/constants';
import { HUD_REFRESH_INTERVAL_MS } from '../src/ui/state/simStore';
import type { MatchConfig } from '../src/sim/types';
import type { BattleStartPayload, HelloPayload, RoomPhase, RoomSlotSummary, RoomSummary } from '../src/net/protocol';
import { broadcast } from './sse';

export const ROOM_CAPACITY = 4;
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
}

interface RoomState {
  id: string;
  name: string;
  phase: RoomPhase;
  slots: PlayerSlot[];
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

function emptySlots(): PlayerSlot[] {
  return Array.from({ length: ROOM_CAPACITY }, () => ({ playerId: null, speciesId: null, isAutoFilled: false }));
}

export function createRoom() {
  const id = `room-${nextRoomNumber}`;
  const name = `Room ${nextRoomNumber}`;
  nextRoomNumber += 1;
  const room: RoomState = {
    id,
    name,
    phase: 'idle',
    slots: emptySlots(),
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
  }));
  return { id: room.id, name: room.name, phase: room.phase, slots, countdownEndsAtMs: room.countdownEndsAtMs };
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
  const config: MatchConfig = {
    level: MULTIPLAYER_LEVEL,
    speciesIds,
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    shiny: false,
  };
  const seed = Math.floor(Math.random() * 0xffffffff);
  const engine = new SimulationEngine(config, buildSpeciesMapForLevel(speciesIds, MULTIPLAYER_LEVEL), moveLookup, seed);

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
  room.slots = emptySlots();
  room.countdownEndsAtMs = null;
  room.engine = null;
  room.lastBroadcastSeq = 0;
  broadcast(room.id, 'lobbyReset', toRoomSummary(room));
}
