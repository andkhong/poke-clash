import { randomUUID } from 'node:crypto';
import { SimulationEngine } from '../src/sim/engine';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../src/data/loader';
import { AGGRESSION_TRIGGER_MS, ARENA_HEIGHT, ARENA_WIDTH, TICK_MS } from '../src/sim/constants';
import { HUD_REFRESH_INTERVAL_MS } from '../src/ui/state/simStore';
import type { ArenaBounds, MatchConfig, SimState } from '../src/sim/types';
import { computeWinOdds } from '../src/sim/odds';
import type {
  BattleStartPayload,
  ChatMessage,
  HelloPayload,
  MyBet,
  PredictionSummary,
  RoomMode,
  RoomPhase,
  RoomSlotSummary,
  RoomSummary,
  RoomTeam,
  WalletEventPayload,
} from '../src/net/protocol';
import { roomCapacityForMode, teamSizeForMode } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, normalizeChatText, normalizeSpectatorName } from '../src/net/chat';
import { broadcast, sendToSession, subscribedSessionIds, subscriberCount } from './sse';
import { toLeanState } from '../src/net/leanState';
import { openPrediction, placeBet, settlePrediction, toPredictionSummary, type PlaceBetError, type PredictionState } from './predictions';
import { adjustBalance, getBalance, MATCH_WATCHED_REWARD, touchWallet } from './wallets';

export const ROOM_COUNTDOWN_MS = 15_000;
export const ROOM_COMPLETE_HOLD_MS = 8_000;
/** The always-on showcase room's countdown between cycles — short, since
 * nobody is picking anything and the point is to stay "constantly active"
 * rather than sit idle (see startAutoPlayCycle). */
export const AUTO_PLAY_COUNTDOWN_MS = 5_000;
/** Floor between accepted thumbnail uploads for the same room (see
 * postThumbnail) — defense in depth alongside the client's own capture
 * interval against several simultaneous viewers all uploading at once. */
export const THUMBNAIL_MIN_INTERVAL_MS = 4_000;
/** Largest accepted thumbnail upload — client captures are downscaled to a
 * few hundred px wide before sending, so a real one is well under this. */
export const MAX_THUMBNAIL_BYTES = 200 * 1024;
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
  /** The joining tab's session id (see wallets.ts) — links the seat to a
   * wallet for the balance shown next to its name, and lets a reload work
   * out which seat is its own. Null for a join that carried none. */
  sessionId: string | null;
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
  /** Seat count, fixed for this room's whole lifetime — normally just
   * roomCapacityForMode(mode), but the always-on showcase room overrides it
   * (see createRoom's `capacity` opt). Stored rather than recomputed so
   * resetRoom's fresh emptySlots() call keeps the same seat count on every
   * loop instead of silently reverting to the mode's default. */
  capacity: number;
  /** Boss Mode only — chosen once at battle start; nobody picks it, so it
   * isn't a PlayerSlot. Null outside 'battle'/'complete'. */
  bossSpeciesId: number | null;
  /** Set at room creation from whoever created it (see createRoom) —
   * defaulting to the portrait constant for the server's own boot-time
   * pre-seeded rooms, which have no client to ask — and reshaped by the
   * first player to join each session (see joinRoom). */
  arena: ArenaBounds;
  countdownEndsAtMs: number | null;
  engine: SimulationEngine | null;
  lastBroadcastSeq: number;
  /** True only for the server's one permanent showcase room (see
   * startAutoPlayCycle) — never joinable, loops forever. */
  autoPlay: boolean;
  /** Latest captured frame for this room (see the /thumbnail routes), and
   * when it landed — null until some watching client's first capture. */
  thumbnail: Buffer | null;
  thumbnailUpdatedAtMs: number | null;
  /** The last CHAT_LOG_LIMIT messages, oldest first — replayed to every new
   * subscriber via HelloPayload, wiped by resetRoom. */
  chatLog: ChatMessage[];
  /** Never reset, even by resetRoom: a client that missed the lobbyReset
   * frame still holds the old session's ids, and restarting at 1 would make
   * its id-based dedupe silently drop the new session's first messages. */
  nextChatId: number;
  chatBuckets: Map<string, ChatBucket>;
  /** The running/just-finished match's betting pool (see predictions.ts) —
   * opened by startBattle, settled when the match completes, dropped by
   * resetRoom along with the engine. Null between rounds. */
  prediction: PredictionState | null;
  /** Battles started in this room so far, ever — PredictionSummary.matchNo. */
  matchCount: number;
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
function emptySlots(mode: RoomMode, capacity: number): PlayerSlot[] {
  const teamSize = teamSizeForMode(mode);
  return Array.from({ length: capacity }, (_, slotIndex) => ({
    playerId: null,
    sessionId: null,
    speciesId: null,
    isAutoFilled: false,
    team: teamSize !== null ? (slotIndex < teamSize ? 'teamA' : 'teamB') : null,
  }));
}

export function createRoom(mode: RoomMode = 'classic', arena?: ArenaBounds, opts?: { autoPlay?: boolean; capacity?: number }) {
  const id = `room-${nextRoomNumber}`;
  const name = opts?.autoPlay ? 'Featured Showcase' : `Room ${nextRoomNumber}`;
  nextRoomNumber += 1;
  const capacity = opts?.capacity ?? roomCapacityForMode(mode);
  const room: RoomState = {
    id,
    name,
    mode,
    phase: 'idle',
    slots: emptySlots(mode, capacity),
    capacity,
    bossSpeciesId: null,
    arena: arena ?? { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    countdownEndsAtMs: null,
    engine: null,
    lastBroadcastSeq: 0,
    autoPlay: opts?.autoPlay ?? false,
    thumbnail: null,
    thumbnailUpdatedAtMs: null,
    chatLog: [],
    nextChatId: 1,
    chatBuckets: new Map(),
    prediction: null,
    matchCount: 0,
    countdownTimer: null,
    simTimer: null,
    broadcastTimer: null,
    completeResetTimer: null,
  };
  rooms.set(id, room);
  if (room.autoPlay) startAutoPlayCycle(room);
  return room;
}

export function listRooms() {
  return [...rooms.values()];
}

export function getRoom(id: string) {
  return rooms.get(id);
}

export function toRoomSummary(room: RoomState): RoomSummary {
  // Never slot.playerId — it's the seat's bearer token and this goes to
  // everyone in the room (see RoomSlotSummary.occupied).
  const slots: RoomSlotSummary[] = room.slots.map((slot, slotIndex) => ({
    slotIndex,
    occupied: slot.playerId !== null,
    speciesId: slot.speciesId,
    speciesName: slot.speciesId !== null ? (speciesNameById.get(slot.speciesId) ?? null) : null,
    isAutoFilled: slot.isAutoFilled,
    team: slot.team,
    balance: slot.sessionId !== null ? getBalance(slot.sessionId) : null,
  }));
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    phase: room.phase,
    slots,
    arena: room.arena,
    countdownEndsAtMs: room.countdownEndsAtMs,
    bossSpeciesName: room.bossSpeciesId !== null ? (speciesNameById.get(room.bossSpeciesId) ?? null) : null,
    capacity: room.capacity,
    autoPlay: room.autoPlay,
    thumbnailUpdatedAtMs: room.thumbnailUpdatedAtMs,
    viewerCount: subscriberCount(room.id),
  };
}

function predictionSummary(room: RoomState): PredictionSummary | null {
  return room.prediction && room.engine ? toPredictionSummary(room.prediction, room.engine.getState()) : null;
}

/** The connect-time snapshot for one stream. `sessionId` is the session the
 * stream was opened with (see server.ts), or null — only `me` depends on it,
 * and a session that's never been seen gets its wallet minted right here so
 * a brand-new tab's first hello already shows a balance. */
export function getHelloPayload(room: RoomState, sessionId: string | null = null): HelloPayload {
  let me: HelloPayload['me'] = null;
  if (sessionId !== null) {
    const mySlotIndex = room.slots.findIndex((s) => s.sessionId === sessionId);
    me = {
      balance: touchWallet(sessionId).balance,
      mySlotIndex: mySlotIndex === -1 ? null : mySlotIndex,
      myBet: room.prediction?.bets.get(sessionId) ?? null,
    };
  }
  return {
    room: toRoomSummary(room),
    engineState: room.engine ? room.engine.getState() : null,
    chatLog: room.chatLog,
    prediction: predictionSummary(room),
    me,
  };
}

/** Seats a player. `arena` is the joiner's own arena choice (see
 * JoinRoomRequest.arena): it becomes the room's arena only when this join
 * is the one that opens a session (the room was idle), so the player who
 * gets a room going decides the shape everyone in it plays on — a
 * pre-seeded room, or one created earlier with a different choice, would
 * otherwise silently hold onto a shape nobody in the current session asked
 * for. Later joiners, and joins with no arena given, leave it alone. */
export function joinRoom(
  room: RoomState,
  arena?: ArenaBounds,
  sessionId: string | null = null
): { ok: true; playerId: string; slotIndex: number } | { ok: false; error: 'room_full' | 'room_not_joinable' | 'already_seated' } {
  // The showcase room is spectate-only, forever — see startAutoPlayCycle.
  if (room.autoPlay) return { ok: false, error: 'room_not_joinable' };
  if (room.phase !== 'idle' && room.phase !== 'countdown') {
    return { ok: false, error: 'room_not_joinable' };
  }
  // One seat per tab: a session's wallet can't back two fighters' seats.
  if (sessionId !== null && room.slots.some((s) => s.sessionId === sessionId)) {
    return { ok: false, error: 'already_seated' };
  }
  const slotIndex = room.slots.findIndex((s) => s.playerId === null);
  if (slotIndex === -1) return { ok: false, error: 'room_full' };
  const slot = room.slots[slotIndex];

  const playerId = randomUUID();
  slot.playerId = playerId;
  slot.sessionId = sessionId;
  if (sessionId !== null) touchWallet(sessionId);

  if (room.phase === 'idle') {
    if (arena) room.arena = arena;
    room.phase = 'countdown';
    room.countdownEndsAtMs = Date.now() + ROOM_COUNTDOWN_MS;
    room.countdownTimer = setTimeout(() => startBattle(room), ROOM_COUNTDOWN_MS);
  }

  broadcast(room.id, 'roomUpdate', toRoomSummary(room));
  return { ok: true, playerId, slotIndex };
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

/** `key` is a seated sender's playerId, or a `spectator:<name>` key for an
 * unseated one (see postChat) — either way just a bucket identity, opaque to
 * this function. */
function takeChatToken(room: RoomState, key: string, nowMs: number): boolean {
  let bucket = room.chatBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: CHAT_BURST, lastRefillMs: nowMs };
    room.chatBuckets.set(key, bucket);
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
  | { ok: false; error: 'not_in_room' | 'invalid_message' | 'invalid_name' | 'rate_limited' };

/** Posts one chat line and broadcasts it as a `chat` SSE event — from a
 * seated player (`playerId` matches one of the room's slots) or, since every
 * room must support chat including the always-on showcase room that has no
 * seats to give, from an unseated spectator identified by a generated
 * `spectatorName` instead (see src/net/spectatorIdentity.ts). A `playerId`
 * that doesn't match any seat is `not_in_room` unless a spectatorName is
 * also given to fall back to — a stale/unknown playerId is never silently
 * reinterpreted as a fresh spectator identity.
 *
 * No phase gate on purpose: a seat only exists from join until resetRoom
 * wipes it 8 s after the match completes, so `not_in_room` already covers
 * idle rooms, and the complete-phase hold is exactly when "GG" happens.
 * Validation runs before the rate limiter so a rejected message doesn't burn
 * any of the sender's budget. `nowMs` is injectable for tests. `sessionId`
 * only stamps the message with the sender's balance (ChatMessage.balance);
 * a seated sender's comes from their seat's session instead. */
export function postChat(
  room: RoomState,
  playerId: string | null,
  rawText: string,
  nowMs = Date.now(),
  spectatorName?: string,
  sessionId?: string
): PostChatResult {
  const slotIndex = playerId !== null ? room.slots.findIndex((s) => s.playerId === playerId) : -1;
  const seated = slotIndex !== -1;
  if (!seated && spectatorName === undefined) return { ok: false, error: 'not_in_room' };

  const text = normalizeChatText(rawText);
  if (text === null) return { ok: false, error: 'invalid_message' };

  let normalizedSpectatorName: string | null = null;
  if (!seated) {
    normalizedSpectatorName = normalizeSpectatorName(spectatorName as string);
    if (normalizedSpectatorName === null) return { ok: false, error: 'invalid_name' };
  }

  // Rate-limit spectators per (claimed) name rather than per-connection —
  // good enough for a casual game chat; see protocol.ts's ChatRequest.
  const bucketKey = seated ? (playerId as string) : `spectator:${normalizedSpectatorName}`;
  if (!takeChatToken(room, bucketKey, nowMs)) return { ok: false, error: 'rate_limited' };

  const slot = seated ? room.slots[slotIndex] : null;
  const balanceSessionId = slot ? slot.sessionId : (sessionId ?? null);
  const message: ChatMessage = {
    id: room.nextChatId,
    slotIndex: seated ? slotIndex : null,
    speciesId: slot?.speciesId ?? null,
    speciesName: slot && slot.speciesId !== null ? (speciesNameById.get(slot.speciesId) ?? null) : null,
    team: slot?.team ?? null,
    spectatorName: seated ? null : normalizedSpectatorName,
    balance: balanceSessionId !== null ? getBalance(balanceSessionId) : null,
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

  // After battleStart, not before: a client builds its match store from that
  // frame, and the panel needs the fighters' names it carries.
  room.matchCount += 1;
  room.prediction = openPrediction(room.mode, engine.getState(), room.matchCount, Date.now(), moveLookup);
  broadcast(room.id, 'prediction', toPredictionSummary(room.prediction, engine.getState()));

  registerRoomTickLoop(room);
}

export type PlaceRoomBetResult =
  | { ok: true; balance: number; bet: MyBet; prediction: PredictionSummary }
  | { ok: false; error: PlaceBetError };

/** Stakes `amount` of the session's balance on an option of the running
 * match's pool (see predictions.ts's placeBet for the rules), debits the
 * wallet, and tells the room. A seated bettor's balance also rides on the
 * slot list, so that goes out again too. */
export function placeRoomBet(room: RoomState, sessionId: string, optionId: string, amount: number): PlaceRoomBetResult {
  const engine = room.engine;
  if (!room.prediction || !engine) return { ok: false, error: 'no_prediction' };
  const state = engine.getState();
  const wallet = touchWallet(sessionId);
  const result = placeBet(room.prediction, state, sessionId, optionId, amount, wallet.balance);
  if (!result.ok) return result;
  const balance = adjustBalance(sessionId, -amount) ?? 0;
  const prediction = toPredictionSummary(room.prediction, state);
  broadcast(room.id, 'prediction', prediction);
  if (room.slots.some((s) => s.sessionId === sessionId)) broadcast(room.id, 'roomUpdate', toRoomSummary(room));
  return { ok: true, balance, bet: result.bet, prediction };
}

/** Pays the finished match's pool out (see predictions.ts's settlePrediction
 * / computePayouts), credits everyone still watching their MATCH_WATCHED_REWARD,
 * and tells the room — publicly (the settled pool, the slots' new balances)
 * and each session privately (its own new balance and what it got back). A
 * bettor who has since closed their tab and timed out simply isn't paid;
 * nobody else's share depends on it. */
function settleRoomPrediction(room: RoomState, state: Readonly<SimState>): void {
  const prediction = room.prediction;
  if (!prediction) return;
  settlePrediction(prediction, state, moveLookup);
  for (const [sessionId, returned] of prediction.payouts) adjustBalance(sessionId, returned);
  const watchers = subscribedSessionIds(room.id);
  for (const sessionId of watchers) adjustBalance(sessionId, MATCH_WATCHED_REWARD);

  broadcast(room.id, 'prediction', toPredictionSummary(prediction, state));
  broadcast(room.id, 'roomUpdate', toRoomSummary(room));

  const sessions = new Set([...watchers, ...prediction.bets.keys()]);
  for (const sessionId of sessions) {
    const balance = getBalance(sessionId);
    if (balance === null) continue;
    const payload: WalletEventPayload = {
      balance,
      myBet: null,
      settled: {
        matchNo: prediction.matchNo,
        staked: prediction.bets.get(sessionId)?.amount ?? 0,
        returned: prediction.payouts.get(sessionId) ?? 0,
        watched: watchers.has(sessionId) ? MATCH_WATCHED_REWARD : 0,
      },
    };
    sendToSession(sessionId, 'wallet', payload);
  }
}

function registerRoomTickLoop(room: RoomState): void {
  let lastTickAtMs = Date.now();

  room.simTimer = setInterval(() => {
    const engine = room.engine;
    if (!engine) return;
    const now = Date.now();
    engine.tick(now - lastTickAtMs);
    lastTickAtMs = now;
    const state = engine.getState();

    // Betting closes on the sim's own clock, at the aggression mark — the
    // last moment before the pace picks up and outcomes start to show. A
    // match that ends sooner is closed by settlement below instead.
    const prediction = room.prediction;
    if (prediction && prediction.status === 'open' && state.phase !== 'complete' && state.elapsedMs >= AGGRESSION_TRIGGER_MS) {
      prediction.status = 'closed';
      broadcast(room.id, 'prediction', toPredictionSummary(prediction, state));
    }

    if (room.phase === 'battle' && state.phase === 'complete') {
      room.phase = 'complete';
      // The broadcastTimer below is about to be cancelled — flush whatever
      // it hasn't gotten to yet (the finishing move, the faint, the
      // matchEnd milestone, all generated on this same tick) onto
      // battleComplete itself, or they're lost for good.
      const events = engine.getEventsSince(room.lastBroadcastSeq);
      if (events.length > 0) room.lastBroadcastSeq = events[events.length - 1].seq;
      broadcast(room.id, 'battleComplete', { finalState: toLeanState(state), events });
      settleRoomPrediction(room, state);
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
    const state = engine.getState();
    broadcast(room.id, 'stateUpdate', { state: toLeanState(state), events });

    // A faint is the one thing that moves the odds enough to be worth a
    // frame of its own (HP wobbles all match; settlement recomputes anyway).
    const prediction = room.prediction;
    if (prediction && prediction.status !== 'settled' && events.some((e) => e.type === 'fainted')) {
      prediction.odds = computeWinOdds(state, moveLookup, prediction.options);
      broadcast(room.id, 'prediction', toPredictionSummary(prediction, state));
    }
  }, BROADCAST_INTERVAL_MS);
}

/** Starts (or restarts) the always-on showcase room's cycle: a short
 * countdown — purely cosmetic pacing, since nobody picks anything — straight
 * into startBattle(), which already auto-fills every slot with a random
 * species whenever it finds one still null (true here, since every slot is
 * empty right after createRoom/resetRoom). Called once at creation and again
 * from resetRoom every time this room completes a battle, which is what
 * keeps it looping forever with zero real joins. */
function startAutoPlayCycle(room: RoomState): void {
  room.phase = 'countdown';
  room.countdownEndsAtMs = Date.now() + AUTO_PLAY_COUNTDOWN_MS;
  room.countdownTimer = setTimeout(() => startBattle(room), AUTO_PLAY_COUNTDOWN_MS);
  broadcast(room.id, 'roomUpdate', toRoomSummary(room));
}

function resetRoom(room: RoomState): void {
  room.completeResetTimer = null;
  room.phase = 'idle';
  room.slots = emptySlots(room.mode, room.capacity);
  room.bossSpeciesId = null;
  room.countdownEndsAtMs = null;
  room.engine = null;
  room.lastBroadcastSeq = 0;
  room.chatLog = [];
  room.chatBuckets.clear();
  // The settled pool goes with the engine it was scored against; wallets
  // (wallets.ts) live on — they're the tab's, not the room's.
  room.prediction = null;
  broadcast(room.id, 'lobbyReset', toRoomSummary(room));
  // Never actually sits idle — starts the next cycle right away.
  if (room.autoPlay) startAutoPlayCycle(room);
}

export type SetThumbnailResult = { ok: true } | { ok: false; error: 'too_large' | 'rate_limited' };

/** Caches a watching client's latest canvas capture for this room (see
 * src/ui/hooks/useRoomThumbnailCapture.ts) — whoever's currently watching a
 * room is the one source of its "live" thumbnail, same as a broadcaster's
 * own encoder is the source of a Twitch thumbnail. Throttled server-side
 * (independent of, and in addition to, the client's own capture interval)
 * so several simultaneous viewers all capturing at once can't spam writes. */
export function setThumbnail(room: RoomState, image: Buffer, nowMs = Date.now()): SetThumbnailResult {
  if (image.byteLength > MAX_THUMBNAIL_BYTES) return { ok: false, error: 'too_large' };
  if (room.thumbnailUpdatedAtMs !== null && nowMs - room.thumbnailUpdatedAtMs < THUMBNAIL_MIN_INTERVAL_MS) {
    return { ok: false, error: 'rate_limited' };
  }
  room.thumbnail = image;
  room.thumbnailUpdatedAtMs = nowMs;
  return { ok: true };
}
