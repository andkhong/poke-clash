import {
  KANTO_IDS,
  PLAY_LEVEL,
  buildPlayMatchConfig,
  isPlayModeKind,
  rollMoves,
  seatCount,
  seatTeam,
  type PlayModeKind,
} from '../src/app/playMode';
import { buildSpeciesMapForLevel, moveLookup } from '../src/data/loader';
import { ActionEngine, isFacing } from '../src/sim/action/ActionEngine';
import { ACTION_TICK_MS } from '../src/sim/action/rules';
import { ARENA_HEIGHT, ARENA_WIDTH, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH } from '../src/sim/constants';
import type { ArenaBounds, MatchConfig, SimState } from '../src/sim/types';
import {
  CROWD_CALL_EVERY_MS,
  CROWD_CALL_FIRST_MS,
  CROWD_CALL_LAND_DELAY_MS,
  CROWD_CALL_VOTE_MS,
  type CrowdCallView,
  type CrowdCardId,
  type CrowdSide,
  type PlayRoomSummary,
  type PlayRoomView,
  type SeatView,
  type ServerMessage,
} from '../src/net/play/playProtocol';
import { createRng, rngPick, rngShuffle, type Rng } from '../src/sim/rng';
import type { ChatMessage, WalletEventPayload } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, normalizeChatText, normalizeSpectatorName } from '../src/net/chat';
import { containsBlockedLanguage } from '../src/net/chatFilter';
import { AGGRESSION_TRIGGER_MS } from '../src/sim/constants';
import { openPrediction, placeBet, settlePrediction, toPredictionSummary, type PredictionState } from './predictions';
import { itemUsesForSession, openShop, purchaseItem, toShopSummary, type ShopState } from './shop';
import { CHAT_BURST, CHAT_REFILL_MS, ITEM_BURST, ITEM_REFILL_MS, takeToken, type RateBucket } from './rateLimit';
import { adjustBalance, getBalance, MATCH_WATCHED_REWARD, touchWallet, walletStreamClosed, walletStreamOpened } from './wallets';

// Online Play Mode rooms: a lobby (seats, species, ready) and, once the host
// starts, an authoritative ActionEngine run here. The WebSocket plumbing
// lives in server.ts; this module only sees PlayConn, so tests drive it with
// fakes.
//
// Spectators sign up with a name to chat, bet on the match and buy potions
// for the fighters — the same pool, shop and wallet rules as watch rooms
// (predictions.ts, shop.ts, wallets.ts). The fighters themselves can chat
// but not bet or buy, so nobody backs or heals their own side.

/** Snapshots go out every second 60 Hz tick: 30 Hz (~730 B each, ~22 KB/s per player). */
const SNAPSHOT_EVERY_TICKS = 2;
/** Always-live rooms: one per mode, never deleted, a bot-filled match always
 * running. Between matches a short break lets people take a seat and pick
 * before the next one starts on its own. Ids are route-safe (#/play/<id>). */
export const LIVE_ROOMS: readonly { id: string; mode: PlayModeKind }[] = [
  { id: 'live1v1', mode: 1 },
  { id: 'live2v2', mode: 2 },
  { id: 'live3v3', mode: 3 },
  { id: 'liveffa', mode: 'ffa' },
];
export const LIVE_INTERMISSION_MS = 15_000;
const MAX_NAME_LENGTH = 24;
/** While a Crowd Call is voting, its tally goes out every this many ticks (~4×/s). */
const CALL_BROADCAST_EVERY_TICKS = 15;
const CROWD_CARDS: readonly CrowdCardId[] = ['speed', 'shield', 'energy', 'supply'];
const CROWD_SIDES: readonly CrowdSide[] = ['teamA', 'teamB'];
const CARD_LABELS: Record<CrowdCardId, string> = { speed: 'Speed Burst', shield: 'Shield', energy: 'Energy Refill', supply: 'Supply Drop' };
const SIDE_LABELS: Record<CrowdSide, string> = { teamA: 'Team Ruby', teamB: 'Team Sapphire' };

export interface PlayConn {
  readonly id: number;
  sessionId: string | null;
  name: string;
  roomId: string | null;
  /** Picked a name with `signup` — required to chat (unseated), bet or buy. */
  signedUp: boolean;
  send(message: ServerMessage): void;
}

interface Seat {
  conn: PlayConn | null;
  speciesId: number | null;
  moves: number[];
  ready: boolean;
}

interface Battle {
  config: MatchConfig;
  seed: number;
  engine: ActionEngine;
  /** Seat index → that seat's fighter. */
  seatInstanceIds: string[];
  humans: Map<PlayConn, string>;
  names: Record<string, string>;
  timer: ReturnType<typeof setInterval>;
  lastWallMs: number;
  ticks: number;
  sentSeq: number;
  /** A fire or dash just landed: send the next tick's snapshot whatever the cadence, so the shot shows a beat sooner. */
  flushNext: boolean;
  /** Crowd Calls so far (team modes only), oldest first; the last is the current one. */
  calls: CrowdCallView[];
  /** sessionId → the current call's vote. */
  votes: Map<string, { side: CrowdSide; card: CrowdCardId }>;
  /** sessionId → the side a viewer's first vote or bet locked them to, this match. */
  sides: Map<string, CrowdSide>;
  callRng: Rng;
}

interface PlayRoom {
  id: string;
  mode: PlayModeKind;
  arena: ArenaBounds;
  seats: Seat[];
  host: PlayConn | null;
  /** Everyone connected to the room, seated or not. */
  conns: Set<PlayConn>;
  battle: Battle | null;
  matchNo: number;
  /** The latest match's pool and shop, kept after it ends so its results stay readable. */
  prediction: PredictionState | null;
  shop: ShopState | null;
  /** The finished match's final state, for the settled pool's summary. */
  lastState: Readonly<SimState> | null;
  chatLog: ChatMessage[];
  nextChatId: number;
  chatBuckets: Map<string, RateBucket>;
  itemBuckets: Map<string, RateBucket>;
  /** One of LIVE_ROOMS: no host, never deleted, matches start themselves. */
  live: boolean;
  /** When a live room's next match starts (Date.now() ms), during its break. */
  nextStartAtMs: number | null;
  /** Watchers who asked for a seat in the next match ("Join next match"), first come first served. */
  queue: PlayConn[];
  startTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, PlayRoom>();
let nextConnId = 1;

export function openPlayConnection(send: (message: ServerMessage) => void): PlayConn {
  return {
    id: nextConnId++,
    sessionId: null,
    name: 'Player',
    roomId: null,
    signedUp: false,
    send,
  };
}

export function closePlayConnection(conn: PlayConn): void {
  leaveRoom(conn);
  if (conn.sessionId) walletStreamClosed(conn.sessionId);
}

/** Every message from a client lands here. Anything malformed is ignored —
 * this is the trust boundary, so every field is checked before use. */
export function handlePlayMessage(conn: PlayConn, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as Record<string, unknown>;
  const room = conn.roomId ? rooms.get(conn.roomId) : undefined;
  switch (msg.t) {
    case 'hello':
      if (conn.sessionId === null && typeof msg.sessionId === 'string' && msg.sessionId.length <= 64) {
        conn.sessionId = msg.sessionId;
        // Keeps the wallet alive while connected, like a watch room's stream.
        walletStreamOpened(conn.sessionId);
      }
      if (typeof msg.name === 'string') conn.name = msg.name.trim().slice(0, MAX_NAME_LENGTH) || 'Player';
      return;
    case 'ping':
      if (typeof msg.c === 'number') conn.send({ t: 'pong', c: msg.c });
      return;
    case 'list':
      conn.send({ t: 'rooms', rooms: listPlayRooms() });
      return;
    case 'create':
      if (isPlayModeKind(msg.mode)) joinRoom(conn, createPlayRoom(msg.mode, isWide(msg.arena) ? wideArena() : portraitArena()).id);
      return;
    case 'join':
      if (typeof msg.roomId === 'string' && rooms.has(msg.roomId)) joinRoom(conn, msg.roomId, msg.watch === true);
      else conn.send({ t: 'error', message: 'That room no longer exists.' });
      return;
    case 'leave':
      leaveRoom(conn);
      return;
    case 'signup':
      signUp(conn, room, msg.name);
      return;
  }
  if (!room) return;
  if (msg.t === 'chat' || msg.t === 'bet' || msg.t === 'buy' || msg.t === 'vote') {
    if (typeof msg.req === 'number') conn.send({ t: 'ack', req: msg.req, error: handleCrowdMessage(room, conn, msg) });
    return;
  }
  if (msg.t === 'queue') {
    // Only a watcher mid-match can queue; between matches they just take a seat.
    const seated = room.seats.some((s) => s.conn === conn);
    room.queue = room.queue.filter((c) => c !== conn);
    if (msg.join === true && room.battle && !seated) room.queue.push(conn);
    // Everyone watching sees the line change.
    return broadcastRoom(room);
  }
  if (room.battle) handleBattleMessage(room.battle, conn, msg);
  else handleLobbyMessage(room, conn, msg);
}

export function listPlayRooms(): PlayRoomSummary[] {
  return [...rooms.values()]
    .map((room) => ({
      id: room.id,
      mode: room.mode,
      players: room.seats.filter((seat) => seat.conn).length,
      seats: room.seats.length,
      phase: room.battle ? ('battle' as const) : ('lobby' as const),
      live: room.live,
      fighters: room.battle
        ? room.battle.config.speciesIds.map((speciesId, i) => ({ speciesId, team: seatTeam(room.mode, i) }))
        : room.seats.flatMap((seat, i) => (seat.speciesId !== null ? [{ speciesId: seat.speciesId, team: seatTeam(room.mode, i) }] : [])),
    }))
    .sort((a, b) => Number(b.live) - Number(a.live));
}

export function createPlayRoom(mode: PlayModeKind, arena: ArenaBounds, liveId?: string): PlayRoom {
  let id = liveId ?? '';
  while (!id || (!liveId && rooms.has(id))) id = Math.random().toString(36).slice(2, 7);
  const room: PlayRoom = {
    id,
    mode,
    arena,
    seats: emptySeats(mode),
    host: null,
    conns: new Set(),
    battle: null,
    matchNo: 0,
    prediction: null,
    shop: null,
    lastState: null,
    chatLog: [],
    nextChatId: 1,
    chatBuckets: new Map(),
    itemBuckets: new Map(),
    live: liveId !== undefined,
    nextStartAtMs: null,
    startTimer: null,
    queue: [],
  };
  rooms.set(id, room);
  return room;
}

/** Opens the always-live rooms (server start), each straight into a bot match. */
export function openLiveRooms(): void {
  for (const { id, mode } of LIVE_ROOMS) {
    if (rooms.has(id)) continue;
    startBattle(createPlayRoom(mode, wideArena(), id));
  }
}

/** Test hook: drop every room (and stop its match loop). */
export function resetPlayRoomsForTests(): void {
  for (const room of rooms.values()) {
    if (room.battle) clearInterval(room.battle.timer);
    if (room.startTimer) clearTimeout(room.startTimer);
  }
  rooms.clear();
}

function emptySeats(mode: PlayModeKind): Seat[] {
  return Array.from({ length: seatCount(mode) }, () => ({
    conn: null,
    speciesId: null,
    moves: [],
    ready: false,
  }));
}

function portraitArena(): ArenaBounds {
  return { width: ARENA_WIDTH, height: ARENA_HEIGHT };
}

function wideArena(): ArenaBounds {
  return { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };
}

function isWide(arena: unknown): boolean {
  return !!arena && typeof arena === 'object' && (arena as ArenaBounds).width === DESKTOP_ARENA_WIDTH;
}

function joinRoom(conn: PlayConn, roomId: string, watch = false): void {
  if (conn.roomId === roomId) return sendRoom(rooms.get(roomId)!, conn);
  leaveRoom(conn);
  const room = rooms.get(roomId)!;
  conn.roomId = roomId;
  room.conns.add(conn);
  conn.send({ t: 'chat', messages: [...room.chatLog], reset: true });
  sendMarket(room, conn);
  sendMe(room, conn);
  if (!room.battle && !watch) {
    const seat = room.seats.find((s) => !s.conn);
    if (seat) Object.assign(seat, { conn, speciesId: null, moves: [], ready: false });
  }
  // Live rooms have no host: nobody changes their mode or starts them.
  if (!room.live) room.host ??= conn;
  broadcastRoom(room);
  // Arriving mid-match: watch it.
  if (room.battle) conn.send(startMessage(room.battle, conn));
  sendCalls(room, conn);
}

function leaveRoom(conn: PlayConn): void {
  const room = conn.roomId ? rooms.get(conn.roomId) : undefined;
  conn.roomId = null;
  if (!room) return;
  room.conns.delete(conn);
  room.queue = room.queue.filter((c) => c !== conn);
  const seat = room.seats.find((s) => s.conn === conn);
  if (seat) {
    // Leaving mid-match faints you for good; the seat itself frees up when the match ends.
    const instanceId = room.battle?.humans.get(conn);
    if (room.battle && instanceId) {
      room.battle.engine.eliminate(instanceId);
      room.battle.humans.delete(conn);
    }
    Object.assign(seat, {
      conn: null,
      speciesId: null,
      moves: [],
      ready: false,
    });
  }
  if (room.host === conn) room.host = room.seats.find((s) => s.conn)?.conn ?? [...room.conns][0] ?? null;
  if (room.conns.size === 0 && !room.live) {
    if (room.battle) clearInterval(room.battle.timer);
    rooms.delete(room.id);
    return;
  }
  broadcastRoom(room);
}

function handleLobbyMessage(room: PlayRoom, conn: PlayConn, msg: Record<string, unknown>): void {
  const seat = room.seats.find((s) => s.conn === conn);
  switch (msg.t) {
    case 'mode': {
      if (room.host !== conn || !isPlayModeKind(msg.mode) || msg.mode === room.mode) return;
      const seated = room.seats.filter((s) => s.conn);
      room.mode = msg.mode;
      room.seats = emptySeats(msg.mode);
      // Players keep their order; anyone past the new size watches instead.
      seated.slice(0, room.seats.length).forEach((old, i) => Object.assign(room.seats[i], old, { ready: false }));
      break;
    }
    case 'seat': {
      const target = typeof msg.index === 'number' ? room.seats[msg.index] : undefined;
      if (!target || target.conn) return;
      if (seat)
        Object.assign(seat, {
          conn: null,
          speciesId: null,
          moves: [],
          ready: false,
        });
      Object.assign(target, {
        conn,
        speciesId: seat?.speciesId ?? null,
        moves: seat?.moves ?? [],
        ready: false,
      });
      break;
    }
    case 'pick': {
      const id = msg.speciesId;
      if (!seat || typeof id !== 'number' || !KANTO_IDS.includes(id)) return;
      if (room.seats.some((s) => s !== seat && s.speciesId === id))
        return conn.send({
          t: 'error',
          message: 'Someone already picked that Pokémon.',
        });
      Object.assign(seat, {
        speciesId: id,
        moves: rollMoves(id),
        ready: false,
      });
      break;
    }
    case 'reroll':
      if (!seat || seat.speciesId === null) return;
      Object.assign(seat, { moves: rollMoves(seat.speciesId), ready: false });
      break;
    case 'ready':
      if (!seat || seat.speciesId === null || typeof msg.ready !== 'boolean') return;
      seat.ready = msg.ready;
      break;
    case 'start':
      if (room.host !== conn) return;
      if (!room.seats.some((s) => s.conn) || room.seats.some((s) => s.conn && !s.ready)) {
        return conn.send({
          t: 'error',
          message: 'Everyone seated has to be ready.',
        });
      }
      startBattle(room);
      return;
    default:
      return;
  }
  broadcastRoom(room);
}

function handleBattleMessage(battle: Battle, conn: PlayConn, msg: Record<string, unknown>): void {
  const id = battle.humans.get(conn);
  if (!id) return;
  const { engine } = battle;
  if (msg.t === 'move') {
    const { x, y, vx, vy, facing } = msg;
    if (![x, y, vx, vy].every((n) => typeof n === 'number' && Number.isFinite(n)) || !isFacing(facing)) return;
    engine.reportMovement(id, { x: x as number, y: y as number }, { x: vx as number, y: vy as number }, facing);
  } else if (msg.t === 'fire') {
    const { slot, x, y } = msg;
    if (typeof slot !== 'number' || ![x, y].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
    battle.flushNext ||= engine.fire(id, slot, { x: x as number, y: y as number });
  } else if (msg.t === 'dash') {
    battle.flushNext ||= engine.dash(id);
  }
}

function startBattle(room: PlayRoom): void {
  if (room.live) {
    // Nobody readies up in a live room: a seated player who hasn't picked gets a random Pokémon.
    const taken = new Set(room.seats.flatMap((s) => (s.speciesId !== null ? [s.speciesId] : [])));
    for (const seat of room.seats) {
      if (!seat.conn || seat.speciesId !== null) continue;
      const free = KANTO_IDS.filter((id) => !taken.has(id));
      const speciesId = free[Math.floor(Math.random() * free.length)];
      taken.add(speciesId);
      Object.assign(seat, { speciesId, moves: rollMoves(speciesId) });
    }
  }
  const config = buildPlayMatchConfig(
    room.mode,
    room.seats.map((s) => (s.conn && s.speciesId !== null ? { speciesId: s.speciesId, moves: s.moves } : null)),
    room.arena
  );
  const seed = Math.floor(Math.random() * 0xffffffff);
  const seatInstanceIds = config.speciesIds.map((speciesId, i) => `p${i}-${speciesId}`);
  const humans = new Map<PlayConn, string>();
  const names: Record<string, string> = {};
  room.seats.forEach((seat, i) => {
    if (!seat.conn) return;
    humans.set(seat.conn, seatInstanceIds[i]);
    names[seatInstanceIds[i]] = seat.conn.name;
  });
  const engine = new ActionEngine(config, buildSpeciesMapForLevel(config.speciesIds, PLAY_LEVEL), moveLookup, seed, {
    humanIds: [...humans.values()],
    reportedMovement: true,
  });
  const battle: Battle = {
    config,
    seed,
    engine,
    seatInstanceIds,
    humans,
    names,
    timer: setInterval(() => stepBattle(room), ACTION_TICK_MS),
    lastWallMs: Date.now(),
    ticks: 0,
    sentSeq: 0,
    flushNext: false,
    calls: [],
    votes: new Map(),
    sides: new Map(),
    callRng: createRng(seed ^ 0x5eed),
  };
  room.battle = battle;
  room.matchNo += 1;
  room.prediction = openPrediction(engine.getState(), room.matchNo, Date.now(), moveLookup);
  room.shop = openShop(room.matchNo);
  for (const conn of room.conns) conn.send(startMessage(battle, conn));
  broadcastRoom(room);
  for (const conn of room.conns) {
    sendMarket(room, conn);
    sendMe(room, conn);
    sendCalls(room, conn);
  }
}

function startMessage(battle: Battle, conn: PlayConn): ServerMessage {
  return {
    t: 'start',
    config: battle.config,
    seed: battle.seed,
    you: battle.humans.get(conn) ?? null,
    names: battle.names,
  };
}

function stepBattle(room: PlayRoom): void {
  const battle = room.battle;
  if (!battle) return;
  const now = Date.now();
  battle.engine.tick(now - battle.lastWallMs);
  battle.lastWallMs = now;
  battle.ticks += 1;
  if (room.mode !== 'ffa' && !battle.engine.finished) stepCalls(room, battle);
  const finished = battle.engine.finished;
  if (battle.ticks % SNAPSHOT_EVERY_TICKS !== 0 && !finished && !battle.flushNext) return;
  battle.flushNext = false;
  const snapshot = battle.engine.snapshot(battle.sentSeq);
  battle.sentSeq = battle.engine.lastActionSeq();
  for (const conn of room.conns) conn.send({ t: 'snap', s: snapshot });
  if (finished) return endBattle(room);
  // Betting closes at the same mark as a watch room's; a KO changes which sides can still be backed.
  const state = battle.engine.getState();
  const closing = room.prediction?.status === 'open' && state.elapsedMs >= AGGRESSION_TRIGGER_MS;
  if (closing) room.prediction!.status = 'closed';
  if (closing || snapshot.events.some((e) => e.type === 'ko' || e.type === 'respawned')) broadcastMarket(room);
}

/** Opens, closes and lands Crowd Calls on the match clock. */
function stepCalls(room: PlayRoom, battle: Battle): void {
  const nowMs = battle.engine.getState().elapsedMs;
  let changed = false;
  let call = battle.calls.at(-1);
  if (call?.phase === 'voting' && nowMs >= call.closesAtMs) {
    for (const side of CROWD_SIDES) {
      const s = call.sides[side];
      const top = Math.max(0, ...s.cards.map((c) => s.votes[c] ?? 0));
      s.housePick = top === 0;
      s.winner = rngPick(battle.callRng, top === 0 ? s.cards : s.cards.filter((c) => (s.votes[c] ?? 0) === top));
    }
    call.phase = 'landing';
    changed = true;
  }
  if (call?.phase === 'landing' && nowMs >= call.landsAtMs) {
    // One chat line per call, both sides together, so the log isn't all house picks.
    const results: string[] = [];
    for (const side of CROWD_SIDES) {
      const { winner, housePick } = call.sides[side];
      if (!winner) continue;
      battle.engine.applyCrowdCard(side, winner, housePick);
      results.push(`${SIDE_LABELS[side].replace('Team ', '')}: ${CARD_LABELS[winner]}${housePick ? ' (house pick)' : '!'}`);
    }
    if (results.length > 0) postSystemChat(room, `Crowd Call ${call.index} — ${results.join(' · ')}`);
    call.phase = 'landed';
    battle.flushNext = true;
    changed = true;
  }
  const opensAtMs = CROWD_CALL_FIRST_MS + battle.calls.length * CROWD_CALL_EVERY_MS;
  if ((!call || call.phase === 'landed') && nowMs >= opensAtMs) {
    const offer = (): CrowdCallView['sides'][CrowdSide] => ({
      cards: rngShuffle(battle.callRng, CROWD_CARDS).slice(0, 3),
      votes: {},
      winner: null,
      housePick: false,
    });
    call = {
      index: battle.calls.length + 1,
      phase: 'voting',
      opensAtMs,
      closesAtMs: opensAtMs + CROWD_CALL_VOTE_MS,
      landsAtMs: opensAtMs + CROWD_CALL_VOTE_MS + CROWD_CALL_LAND_DELAY_MS,
      sides: { teamA: offer(), teamB: offer() },
    };
    battle.calls.push(call);
    battle.votes.clear();
    // Everyone's myVote resets with the new call.
    for (const conn of room.conns) if (!battle.humans.has(conn)) sendMe(room, conn);
    changed = true;
  }
  if (changed || (call?.phase === 'voting' && battle.ticks % CALL_BROADCAST_EVERY_TICKS === 0)) {
    for (const conn of room.conns) sendCalls(room, conn);
  }
}

function sendCalls(room: PlayRoom, conn: PlayConn): void {
  const calls = room.battle?.calls ?? [];
  conn.send({ t: 'calls', current: calls.at(-1) ?? null, history: calls });
}

/** Straight back to the lobby; clients keep showing their results screen until they leave it. */
function endBattle(room: PlayRoom): void {
  if (room.battle) {
    clearInterval(room.battle.timer);
    settleBets(room, room.battle.engine);
    room.lastState = room.battle.engine.getState();
  }
  room.battle = null;
  // A call still voting when the match ended never lands — clear it from every screen.
  for (const conn of room.conns) sendCalls(room, conn);
  for (const seat of room.seats) {
    if (seat.conn) seat.ready = false;
    else Object.assign(seat, { speciesId: null, moves: [], ready: false });
  }
  // Seat whoever queued for this moment, in order, while seats last; the rest go back to watching.
  for (const conn of room.queue) {
    const seat = room.seats.find((s) => !s.conn);
    if (!seat) break;
    Object.assign(seat, { conn, speciesId: null, moves: [], ready: false });
  }
  room.queue = [];
  if (room.live) {
    room.nextStartAtMs = Date.now() + LIVE_INTERMISSION_MS;
    room.startTimer = setTimeout(() => {
      room.startTimer = null;
      room.nextStartAtMs = null;
      if (!room.battle) startBattle(room);
    }, LIVE_INTERMISSION_MS);
  }
  broadcastRoom(room);
}

function broadcastRoom(room: PlayRoom): void {
  for (const conn of room.conns) sendRoom(room, conn);
}

function sendRoom(room: PlayRoom, conn: PlayConn): void {
  const seats: SeatView[] = room.seats.map((seat, index) => ({
    index,
    team: seatTeam(room.mode, index),
    name: seat.conn?.name ?? null,
    speciesId: seat.speciesId,
    moves: seat.moves,
    ready: seat.ready,
    host: !!seat.conn && seat.conn === room.host,
  }));
  const youIndex = room.seats.findIndex((s) => s.conn === conn);
  const view: PlayRoomView = {
    id: room.id,
    mode: room.mode,
    arena: room.arena,
    phase: room.battle ? 'battle' : 'lobby',
    seats,
    you: youIndex >= 0 ? youIndex : null,
    queued: room.queue.includes(conn),
    queue: room.queue.map((c) => c.name),
    queuePlace: room.queue.indexOf(conn) + 1 || null,
    live: room.live,
    startsInMs: room.nextStartAtMs !== null ? Math.max(0, room.nextStartAtMs - Date.now()) : null,
  };
  conn.send({ t: 'room', room: view });
}

function signUp(conn: PlayConn, room: PlayRoom | undefined, raw: unknown): void {
  const name = typeof raw === 'string' ? normalizeSpectatorName(raw) : null;
  if (!name) return conn.send({ t: 'error', message: 'Pick another name — 1 to 24 characters, nothing rude.' });
  const taken = room && [...room.conns].some((c) => c !== conn && c.signedUp && c.name.toLowerCase() === name.toLowerCase());
  if (taken) return conn.send({ t: 'error', message: 'Someone in this room already has that name.' });
  conn.name = name;
  conn.signedUp = true;
  if (room) broadcastRoom(room);
  sendMe(room, conn);
}

/** chat / bet / buy / vote — returns null on success or an error code for the ack. */
function handleCrowdMessage(room: PlayRoom, conn: PlayConn, msg: Record<string, unknown>): string | null {
  const nowMs = Date.now();
  const seatIndex = room.seats.findIndex((s) => s.conn === conn);
  if (msg.t === 'chat') {
    if (seatIndex < 0 && !conn.signedUp) return 'not_signed_up';
    const text = typeof msg.text === 'string' ? normalizeChatText(msg.text) : null;
    if (text === null) return 'invalid_message';
    if (containsBlockedLanguage(text)) return 'blocked_language';
    if (!takeToken(room.chatBuckets, String(conn.id), CHAT_BURST, CHAT_REFILL_MS, nowMs)) return 'rate_limited';
    const seat = seatIndex >= 0 ? room.seats[seatIndex] : null;
    appendChat(room, {
      id: room.nextChatId,
      slotIndex: null,
      speciesId: seat?.speciesId ?? null,
      speciesName: null,
      team: seatTeam(room.mode, seatIndex) ?? null,
      spectatorName: conn.name,
      balance: conn.sessionId ? getBalance(conn.sessionId) : null,
      text,
      sentAtMs: nowMs,
    });
    return null;
  }

  // Betting and buying: spectators only.
  if (seatIndex >= 0) return 'fighters_cant';
  if (!conn.signedUp) return 'not_signed_up';
  const sessionId = conn.sessionId;
  const battle = room.battle;
  if (!sessionId) return 'no_session';
  const locked = battle?.sides.get(sessionId) ?? null;
  if (msg.t === 'vote') {
    const call = battle?.calls.at(-1);
    if (!battle || call?.phase !== 'voting') return 'no_call';
    const side = msg.side;
    if (side !== 'teamA' && side !== 'teamB') return 'invalid_message';
    if (locked && locked !== side) return 'side_locked';
    const card = msg.card as CrowdCardId;
    if (!call.sides[side].cards.includes(card)) return 'bad_card';
    const previous = battle.votes.get(sessionId);
    if (previous) {
      const votes = call.sides[previous.side].votes;
      votes[previous.card] = (votes[previous.card] ?? 1) - 1;
    }
    call.sides[side].votes[card] = (call.sides[side].votes[card] ?? 0) + 1;
    battle.votes.set(sessionId, { side, card });
    battle.sides.set(sessionId, side);
    sendMe(room, conn);
    return null;
  }
  const balance = touchWallet(sessionId).balance;
  if (msg.t === 'bet') {
    if (!battle || !room.prediction) return 'no_prediction';
    if (typeof msg.optionId !== 'string' || typeof msg.amount !== 'number') return 'invalid_amount';
    // In team modes the option ids are the sides themselves.
    if (locked && msg.optionId !== locked) return 'side_locked';
    const result = placeBet(room.prediction, battle.engine.getState(), sessionId, msg.optionId, msg.amount, balance);
    if (!result.ok) return result.error;
    adjustBalance(sessionId, -msg.amount);
    if (room.mode !== 'ffa' && (msg.optionId === 'teamA' || msg.optionId === 'teamB')) battle.sides.set(sessionId, msg.optionId);
  } else {
    if (!battle || !room.shop) return 'no_shop';
    if (typeof msg.itemId !== 'string' || typeof msg.targetId !== 'string') return 'unknown_item';
    if (locked && battle.engine.getState().pokemon[msg.targetId]?.team !== locked) return 'side_locked';
    if (!takeToken(room.itemBuckets, sessionId, ITEM_BURST, ITEM_REFILL_MS, nowMs)) return 'rate_limited';
    const targetId = msg.targetId;
    const result = purchaseItem(room.shop, battle.engine.getState(), sessionId, msg.itemId, targetId, balance, conn.name, nowMs, (item) =>
      battle.engine.useItem(targetId, item.effect, item.healFraction, conn.name)
    );
    if (!result.ok) return result.error;
    adjustBalance(sessionId, -result.item.price);
    const { use } = result;
    postSystemChat(
      room,
      use.effect === 'revive'
        ? `${conn.name} revived ${use.targetName}!`
        : `${conn.name} used ${result.item.label} on ${use.targetName} (+${use.amount} HP)`
    );
  }
  broadcastMarket(room);
  sendMe(room, conn);
  return null;
}

/** Pays the pool out against the finished match, plus the watch reward to every spectator. */
function settleBets(room: PlayRoom, engine: ActionEngine): void {
  const prediction = room.prediction;
  if (!prediction) return;
  const state = engine.getState();
  settlePrediction(prediction, state, moveLookup);
  for (const [sessionId, returned] of prediction.payouts) adjustBalance(sessionId, returned);
  const watchers = new Set([...room.conns].filter((c) => c.sessionId && !room.battle?.humans.has(c)).map((c) => c.sessionId!));
  for (const sessionId of watchers) adjustBalance(sessionId, MATCH_WATCHED_REWARD);
  for (const conn of room.conns) {
    sendMarket(room, conn);
    if (!conn.sessionId) continue;
    sendMe(room, conn, {
      matchNo: prediction.matchNo,
      staked: prediction.bets.get(conn.sessionId)?.amount ?? 0,
      returned: prediction.payouts.get(conn.sessionId) ?? 0,
      watched: watchers.has(conn.sessionId) ? MATCH_WATCHED_REWARD : 0,
    });
  }
}

function appendChat(room: PlayRoom, message: ChatMessage): void {
  room.nextChatId += 1;
  room.chatLog.push(message);
  if (room.chatLog.length > CHAT_LOG_LIMIT) room.chatLog.splice(0, room.chatLog.length - CHAT_LOG_LIMIT);
  for (const conn of room.conns) conn.send({ t: 'chat', messages: [message] });
}

function postSystemChat(room: PlayRoom, text: string): void {
  appendChat(room, {
    id: room.nextChatId,
    slotIndex: null,
    speciesId: null,
    speciesName: null,
    team: null,
    spectatorName: null,
    balance: null,
    kind: 'system',
    text,
    sentAtMs: Date.now(),
  });
}

function broadcastMarket(room: PlayRoom): void {
  for (const conn of room.conns) sendMarket(room, conn);
}

function sendMarket(room: PlayRoom, conn: PlayConn): void {
  const state = room.battle?.engine.getState() ?? room.lastState;
  conn.send({
    t: 'market',
    prediction: room.prediction && state ? toPredictionSummary(room.prediction, state) : null,
    shop: room.shop ? toShopSummary(room.shop) : null,
  });
}

function sendMe(room: PlayRoom | undefined, conn: PlayConn, settled?: WalletEventPayload['settled']): void {
  if (!conn.sessionId) return;
  const balance = getBalance(conn.sessionId) ?? touchWallet(conn.sessionId).balance;
  const battle = room?.battle;
  conn.send({
    t: 'me',
    name: conn.signedUp ? conn.name : null,
    balance,
    myBet: room?.prediction?.bets.get(conn.sessionId) ?? null,
    myItemUses: itemUsesForSession(room?.shop ?? null, conn.sessionId),
    side: battle?.sides.get(conn.sessionId) ?? null,
    myVote: battle?.votes.get(conn.sessionId)?.card ?? null,
    ...(settled ? { settled } : {}),
  });
}
