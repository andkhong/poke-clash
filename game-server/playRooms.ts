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
import type { PlayRoomSummary, PlayRoomView, ServerMessage, SeatView } from '../src/net/play/playProtocol';
import type { ChatMessage, WalletEventPayload } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, normalizeChatText, normalizeSpectatorName } from '../src/net/chat';
import { containsBlockedLanguage } from '../src/net/chatFilter';
import { AGGRESSION_TRIGGER_MS } from '../src/sim/constants';
import { openPrediction, placeBet, settlePrediction, toPredictionSummary, type PredictionState } from './predictions';
import { itemUsesForSession, openShop, purchaseItem, toShopSummary, type ShopState } from './shop';
import { CHAT_BURST, CHAT_REFILL_MS, ITEM_BURST, ITEM_REFILL_MS, takeToken, type RateBucket } from './roomManager';
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
const MAX_NAME_LENGTH = 24;

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
  if (msg.t === 'chat' || msg.t === 'bet' || msg.t === 'buy') {
    if (typeof msg.req === 'number') conn.send({ t: 'ack', req: msg.req, error: handleCrowdMessage(room, conn, msg) });
    return;
  }
  if (room.battle) handleBattleMessage(room.battle, conn, msg);
  else handleLobbyMessage(room, conn, msg);
}

export function listPlayRooms(): PlayRoomSummary[] {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    mode: room.mode,
    players: room.seats.filter((seat) => seat.conn).length,
    seats: room.seats.length,
    phase: room.battle ? 'battle' : 'lobby',
  }));
}

export function createPlayRoom(mode: PlayModeKind, arena: ArenaBounds): PlayRoom {
  let id: string;
  do id = Math.random().toString(36).slice(2, 7);
  while (rooms.has(id));
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
  };
  rooms.set(id, room);
  return room;
}

/** Test hook: drop every room (and stop its match loop). */
export function resetPlayRoomsForTests(): void {
  for (const room of rooms.values()) if (room.battle) clearInterval(room.battle.timer);
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
  room.host ??= conn;
  broadcastRoom(room);
  // Arriving mid-match: watch it.
  if (room.battle) conn.send(startMessage(room.battle, conn));
}

function leaveRoom(conn: PlayConn): void {
  const room = conn.roomId ? rooms.get(conn.roomId) : undefined;
  conn.roomId = null;
  if (!room) return;
  room.conns.delete(conn);
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
  if (room.conns.size === 0) {
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
  };
  room.battle = battle;
  room.matchNo += 1;
  room.prediction = openPrediction(room.mode === 'ffa' ? 'classic' : 'team2', engine.getState(), room.matchNo, Date.now(), moveLookup);
  room.shop = openShop(room.matchNo);
  for (const conn of room.conns) conn.send(startMessage(battle, conn));
  broadcastRoom(room);
  for (const conn of room.conns) {
    sendMarket(room, conn);
    sendMe(room, conn);
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

/** Straight back to the lobby; clients keep showing their results screen until they leave it. */
function endBattle(room: PlayRoom): void {
  if (room.battle) {
    clearInterval(room.battle.timer);
    settleBets(room, room.battle.engine);
    room.lastState = room.battle.engine.getState();
  }
  room.battle = null;
  for (const seat of room.seats) {
    if (seat.conn) seat.ready = false;
    else Object.assign(seat, { speciesId: null, moves: [], ready: false });
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

/** chat / bet / buy — returns null on success or an error code for the ack. */
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
  const balance = touchWallet(sessionId).balance;
  if (msg.t === 'bet') {
    if (!battle || !room.prediction) return 'no_prediction';
    if (typeof msg.optionId !== 'string' || typeof msg.amount !== 'number') return 'invalid_amount';
    const result = placeBet(room.prediction, battle.engine.getState(), sessionId, msg.optionId, msg.amount, balance);
    if (!result.ok) return result.error;
    adjustBalance(sessionId, -msg.amount);
  } else {
    if (!battle || !room.shop) return 'no_shop';
    if (typeof msg.itemId !== 'string' || typeof msg.targetId !== 'string') return 'unknown_item';
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
      use.effect === 'revive' ? `${conn.name} revived ${use.targetName}!` : `${conn.name} used ${result.item.label} on ${use.targetName} (+${use.amount} HP)`
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
  conn.send({
    t: 'me',
    name: conn.signedUp ? conn.name : null,
    balance,
    myBet: room?.prediction?.bets.get(conn.sessionId) ?? null,
    myItemUses: itemUsesForSession(room?.shop ?? null, conn.sessionId),
    ...(settled ? { settled } : {}),
  });
}
