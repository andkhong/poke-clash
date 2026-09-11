import { randomUUID } from 'node:crypto';
import { SimulationEngine } from '../src/sim/engine';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../src/data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_MS } from '../src/sim/constants';
import { HUD_REFRESH_INTERVAL_MS } from '../src/ui/state/simStore';
import type { ArenaBounds, MatchConfig } from '../src/sim/types';
import type { BattleStartPayload, ChatMessage, HelloPayload, RoomMode, RoomPhase, RoomSlotSummary, RoomSummary, RoomTeam } from '../src/net/protocol';
import { roomCapacityForMode, teamSizeForMode } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, normalizeChatText } from '../src/net/chat';
import { broadcast } from './sse';

export const ROOM_COUNTDOWN_MS = 15_000;
export const ROOM_COMPLETE_HOLD_MS = 8_000;
// Matches SetupScreen's own default level for the local free-for-all flow.
export const MULTIPLAYER_LEVEL = 50;
// Reuses the HUD's own refresh cadence rather than inventing a second
// interval constant that could drift out of sync with it.
const BROADCAST_INTERVAL_MS = HUD_REFRESH_INTERVAL_MS;

/** Chat rate limit, per seated player: up to CHAT_BURST messages at once,
 * then one more every CHAT_REFILL_MS. Generous enough for the quick-reaction
 * chips (one tap each), tight enough that one seat can't flood a room. */
export const CHAT_BURST = 4;
export const CHAT_REFILL_MS = 1500;

/** A lazy token bucket — nothing ticks; it's refilled from the clock whenever
 * it's next consulted (see takeChatToken). */
interface ChatBucket {
  tokens: number;
  lastRefillMs: number;
}

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
  /** The last CHAT_LOG_LIMIT messages, oldest first — replayed to every new
   * subscriber via HelloPayload, wiped by resetRoom. */
  chatLog: ChatMessage[];
  /** Never reset, even by resetRoom: a client that missed the lobbyReset
   * frame still holds the old session's ids, and restarting at 1 would make
   * its id-based dedupe silently drop the new session's first messages. */
  nextChatId: number;
  chatBuckets: Map<string, ChatBucket>;
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
    chatLog: [],
    nextChatId: 1,
    chatBuckets: new Map(),
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
  return { room: toRoomSummary(room), engineState: room.engine ? room.engine.getState() : null, chatLog: room.chatLog };
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

function takeChatToken(room: RoomState, playerId: string, nowMs: number): boolean {
  let bucket = room.chatBuckets.get(playerId);
  if (!bucket) {
    bucket = { tokens: CHAT_BURST, lastRefillMs: nowMs };
    room.chatBuckets.set(playerId, bucket);
  }
  const refills = Math.floor((nowMs - bucket.lastRefillMs) / CHAT_REFILL_MS);
  if (refills > 0) {
    bucket.tokens = Math.min(CHAT_BURST, bucket.tokens + refills);
    // Once full, time stops accruing — otherwise a long quiet stretch would
    // bank a partial refill and hand out the next token early.
    bucket.lastRefillMs = bucket.tokens === CHAT_BURST ? nowMs : bucket.lastRefillMs + refills * CHAT_REFILL_MS;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}

export type PostChatResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: 'not_in_room' | 'invalid_message' | 'rate_limited' };

/** Posts one chat line from a seated player and broadcasts it as a `chat`
 * SSE event. No phase gate on purpose: a seat only exists from join until
 * resetRoom wipes it 8 s after the match completes, so `not_in_room` already
 * covers idle rooms, and the complete-phase hold is exactly when "GG"
 * happens. Validation runs before the rate limiter so a rejected message
 * doesn't burn any of the sender's budget. `nowMs` is injectable for tests. */
export function postChat(room: RoomState, playerId: string, rawText: string, nowMs = Date.now()): PostChatResult {
  const slotIndex = room.slots.findIndex((s) => s.playerId === playerId);
  if (slotIndex === -1) return { ok: false, error: 'not_in_room' };
  const text = normalizeChatText(rawText);
  if (text === null) return { ok: false, error: 'invalid_message' };
  if (!takeChatToken(room, playerId, nowMs)) return { ok: false, error: 'rate_limited' };

  const slot = room.slots[slotIndex];
  const message: ChatMessage = {
    id: room.nextChatId,
    slotIndex,
    speciesId: slot.speciesId,
    speciesName: slot.speciesId !== null ? (speciesNameById.get(slot.speciesId) ?? null) : null,
    team: slot.team,
    text,
    sentAtMs: nowMs,
  };
  room.nextChatId += 1;
  room.chatLog.push(message);
  if (room.chatLog.length > CHAT_LOG_LIMIT) room.chatLog.splice(0, room.chatLog.length - CHAT_LOG_LIMIT);
  broadcast(room.id, 'chat', message);
  return { ok: true, message };
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
  room.chatLog = [];
  room.chatBuckets.clear();
  broadcast(room.id, 'lobbyReset', toRoomSummary(room));
}
