import type { MatchConfig, SimEvent, SimState } from '../sim/types';
import type { LeanSimState } from './leanState';

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
export type RoomMode = 'classic' | 'boss' | 'team2' | 'team3' | 'team4';

/** Every RoomMode, for validating a client-supplied one (see game-server). */
export const ROOM_MODES: readonly RoomMode[] = ['classic', 'boss', 'team2', 'team3', 'team4'];

export function isRoomMode(value: unknown): value is RoomMode {
  return typeof value === 'string' && (ROOM_MODES as readonly string[]).includes(value);
}

/** Which side a team-mode slot fights on; null for classic/boss rooms. */
export type RoomTeam = 'teamA' | 'teamB';

/** Per-side size for a team-mode room, or null outside Team Mode. */
export function teamSizeForMode(mode: RoomMode): number | null {
  switch (mode) {
    case 'team2': return 2;
    case 'team3': return 3;
    case 'team4': return 4;
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
  /** Whether someone holds this seat. The seat's playerId is deliberately
   * *not* here: it doubles as that player's bearer token (see ChatMessage),
   * and this summary goes to every client in the room. A client learns its
   * own seat from JoinRoomResponse.slotIndex / HelloPayload.me instead. */
  occupied: boolean;
  speciesId: number | null;
  speciesName: string | null;
  isAutoFilled: boolean;
  /** Which side this slot fights on — set only in a team-mode room (see
   * RoomMode), fixed by slot index for the room's whole lifetime. */
  team: RoomTeam | null;
  /** The seated player's wallet balance (see game-server/wallets.ts), shown
   * next to their name everywhere ("Piplup ($100)"). Null for an empty seat
   * or a join that carried no session id. Live: re-broadcast with every
   * roomUpdate, including the one settlement sends. */
  balance: number | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  mode: RoomMode;
  phase: RoomPhase;
  slots: RoomSlotSummary[];
  /** The arena the room's current match runs on, or its next one will —
   * see CreateRoomRequest.arena / JoinRoomRequest.arena for who sets it.
   * Shown in the lobby and room list so nobody is surprised by the shape
   * once the battle starts. */
  arena: { width: number; height: number };
  countdownEndsAtMs: number | null;
  /** Only meaningful once phase is 'battle'/'complete' in a boss-mode room. */
  bossSpeciesName: string | null;
  /** Total seats this room has — same as `slots.length`, echoed here so the
   * lobby/list screens don't need to derive it themselves. */
  capacity: number;
  /** True only for the server's one permanent, bot-driven showcase room (see
   * game-server/roomManager.ts's startAutoPlayCycle) — spectate-only, never
   * joinable, loops battle after battle forever so the landing page always
   * has something live to feature. Clients use this to exclude it from the
   * normal room list/grid and to hide JOIN ROOM if it's ever opened directly. */
  autoPlay: boolean;
  /** When this room's thumbnail cache (see the /thumbnail routes) was last
   * updated by a watching client's canvas capture, or null if nobody has
   * ever captured one — null means "don't bother requesting the image, show
   * the placeholder instead." */
  thumbnailUpdatedAtMs: number | null;
  /** Connections currently subscribed to this room's SSE stream — seated
   * players and spectators alike (see game-server/sse.ts's subscriberCount).
   * Recomputed on every fetch, so the landing page's 2s room-list poll keeps
   * it live without a dedicated push event. */
  viewerCount: number;
}

export interface CreateRoomRequest {
  mode?: RoomMode;
  /** The creating client's own chosen arena (see app/config.ts's
   * resolveMatchArena — mobile devices are hard-locked to the portrait
   * arena, desktop browsers can opt into the wide one) — since the sim is
   * server-authoritative and shared by everyone in the room (one arena per
   * match, not per viewer), a room has exactly one shape at a time. This
   * sets its initial shape; JoinRoomRequest.arena can reshape it at the
   * start of each session. Omitted for the server's own boot-time
   * pre-seeded rooms, which have no client to ask. */
  arena?: { width: number; height: number };
}

export interface JoinRoomRequest {
  /** This tab's session id (see src/net/sessionIdentity.ts) — links the seat
   * to the tab's wallet so the seat can show a balance, and lets a reload
   * recover which seat is "mine" (HelloPayload.me.mySlotIndex). */
  sessionId: string;
  /** The joining client's own chosen arena (see CreateRoomRequest.arena).
   * Honoured only by the join that opens a session — the first seat taken
   * in an idle room, the one that starts the countdown — so whoever gets a
   * room going decides its shape for everyone in it, whether the room was
   * one of the server's pre-seeded ones or created by someone else earlier
   * with a different choice. Later joiners' preferences are ignored: the
   * lobby shows the room's arena (RoomSummary.arena) before they sit down. */
  arena?: { width: number; height: number };
}

export interface HelloPayload {
  room: RoomSummary;
  engineState: SimState | null;
  /** The room's recent chat (see ChatMessage) — sent on every (re)connect so
   * a late joiner or an EventSource auto-reconnect sees the same backlog
   * everyone else does; the client replaces its log with this wholesale. */
  chatLog: ChatMessage[];
  /** The current match's prediction pool, if a match is running or just
   * finished (null between rounds, since resetRoom drops it with the engine). */
  prediction: PredictionSummary | null;
  /** This stream's own session, or null if it opened without a `?session=`
   * — the one personalised part of an otherwise identical hello. */
  me: SessionPrivate | null;
}

/** What only this session gets to know about itself. `hello` is per-stream
 * so it can carry this; everything else about a session is public by design
 * (balances are shown next to names). */
export interface SessionPrivate {
  balance: number;
  /** The seat this session holds in the room, or null — replaces matching a
   * (no longer broadcast) playerId against the slot list. */
  mySlotIndex: number | null;
  myBet: MyBet | null;
}

export interface MyBet {
  optionId: string;
  amount: number;
}

/** 'open' from battleStart until the sim hits its aggression mark (see
 * sim/constants.ts AGGRESSION_TRIGGER_MS), 'closed' from then until the
 * match ends, 'settled' once the pool has paid out. */
export type PredictionStatus = 'open' | 'closed' | 'settled';

/** One thing to bet on — a fighter in a free-for-all, a side in a boss/team
 * room. `id` is the sim team key of its members (an instance id like
 * `p2-448` in classic, `party`/`boss`, `teamA`/`teamB`). */
export interface PredictionOptionSummary {
  id: string;
  label: string;
  instanceIds: string[];
  /** Pokémon Dollars staked on this option so far, and by how many sessions. */
  total: number;
  bettors: number;
  /** Server-estimated win probability, 0–1 (see sim/odds.ts) — recomputed
   * on every faint, so it keeps moving after betting closes. */
  odds: number;
  /** False once every member has fainted — no longer bettable. */
  alive: boolean;
}

export interface PredictionSummary {
  /** Per room, counts up with every battle — the client uses it to tell a
   * fresh pool from the previous round's settled one. */
  matchNo: number;
  status: PredictionStatus;
  openedAtMs: number;
  /** Absolute server time the window is expected to close — drives the
   * "Closes in MM:SS" countdown; the sim clock is the real gate. */
  closesAtMs: number;
  pool: number;
  options: PredictionOptionSummary[];
  winnerOptionId: string | null;
  /** True when the pool was handed back instead of paid out — co-winners,
   * no winner, or nobody had backed the winner. */
  refunded: boolean;
}

export interface BetRequest {
  sessionId: string;
  optionId: string;
  amount: number;
}

export interface WalletSummary {
  balance: number;
}

export interface BetResponse {
  wallet: WalletSummary;
  myBet: MyBet;
  prediction: PredictionSummary;
}

/** The private `wallet` SSE frame — sent to a session (every stream it has
 * open) when its balance changes for a reason other than its own bet
 * request, i.e. at settlement. */
export interface WalletEventPayload {
  balance: number;
  myBet: MyBet | null;
  /** Present when this frame is a match settling: what this session put in,
   * what came back (payout or refund), and the watch reward it earned. */
  settled?: {
    matchNo: number;
    staked: number;
    returned: number;
    watched: number;
  };
}

export interface BattleStartPayload {
  room: RoomSummary;
  config: MatchConfig;
  seed: number;
  initialState: SimState;
}

/** The 10 Hz live broadcast. `state` is the lean shape (see leanState.ts):
 * each Pokémon carries only its renderer-facing mutable fields, which the
 * client merges over the full snapshot it got from `hello`/`battleStart`. */
export interface StateUpdatePayload {
  state: LeanSimState;
  events: SimEvent[];
}

export interface BattleCompletePayload {
  /** Lean, same as StateUpdatePayload.state. */
  finalState: LeanSimState;
  /** Events generated on the same tick the match ended (the finishing
   * move, the KO'd Pokémon's faint, the matchEnd milestone) — the periodic
   * stateUpdate broadcast is cancelled the instant completion is detected
   * (see game-server/roomManager.ts's registerRoomTickLoop), so without
   * these riding along on battleComplete itself, the finishing blow's
   * animation and the loser's faint would never reach a spectator. */
  events: SimEvent[];
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
}

export interface CreateRoomResponse {
  room: RoomSummary;
}

export interface JoinRoomResponse {
  playerId: string;
  /** The seat just taken — the client's only way to know, now that seat
   * playerIds aren't broadcast (see RoomSlotSummary.occupied). */
  slotIndex: number;
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

/** One room chat line. The sender is identified by seat, never by playerId —
 * a playerId doubles as that player's bearer token for seat-scoped actions
 * (pick, chat), so it must never be broadcast to the whole room; the client
 * works out "You" by comparing slotIndex against its own seat. speciesName /
 * team are snapshotted at send time (a seat that hasn't picked yet is null,
 * shown as "Seat N"), so a message stays attributable after the room resets
 * and its slots are wiped. */
export interface ChatMessage {
  /** Per-room, strictly increasing, and never reset (see roomManager's
   * resetRoom) — the client dedupes by it across SSE reconnects. */
  id: number;
  /** Null for a spectator — someone with no seat, including everyone in the
   * always-on autoPlay room, which has none to give. See spectatorName. */
  slotIndex: number | null;
  speciesId: number | null;
  speciesName: string | null;
  team: RoomTeam | null;
  /** A generated display name ("Slowpoke482", see src/net/spectatorIdentity.ts),
   * set only when slotIndex is null. Seated senders are identified by their
   * pick instead (speciesName), never by this. */
  spectatorName: string | null;
  /** The sender's wallet balance when they sent this, or null if the request
   * carried no session. A seated sender's live balance is on their slot
   * (RoomSlotSummary.balance) and wins over this snapshot in the client. */
  balance: number | null;
  text: string;
  sentAtMs: number;
}

export interface ChatRequest {
  /** A seated sender's bearer id (see JoinRoomResponse.playerId). Omit for an
   * unseated sender and send spectatorName instead — postChat treats
   * whichever of the two actually resolves to a real identity as the sender. */
  playerId?: string;
  /** An unseated sender's generated display name. Ignored if playerId
   * resolves to a real seat. */
  spectatorName?: string;
  /** This tab's session id, so the message can be stamped with its balance. */
  sessionId?: string;
  text: string;
}

export interface ChatResponse {
  message: ChatMessage;
}
