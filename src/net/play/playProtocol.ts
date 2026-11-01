import type { PlayModeKind } from '../../app/playMode';
import type { ActionSnapshot } from '../../sim/action/ActionEngine';
import type { ArenaBounds, MatchConfig, PokemonInstance } from '../../sim/types';
import type { ChatMessage, MyBet, PredictionSummary, ShopSummary, WalletEventPayload } from '../protocol';

// Online Play Mode's WebSocket messages (/api/play/ws). JSON, one object per
// frame. The server (game-server/playRooms.ts) owns hits, damage, lives and
// bots; each player's own screen owns its fighter's movement and reports it
// (see ActionEngine.reportMovement for how far that's trusted).

export const PLAY_WS_PATH = '/api/play/ws';

// Crowd Calls: in team modes, every CROWD_CALL_EVERY_MS (first at
// CROWD_CALL_FIRST_MS) each side's crowd gets three of the four cards and
// votes for CROWD_CALL_VOTE_MS; the winning card lands on every fighter of
// that side CROWD_CALL_LAND_DELAY_MS after the vote closes. A side nobody
// voted for gets a random "house pick". Viewers only — fighters never vote —
// and a viewer's first vote or bet locks them to that side for the match.
// FFA has no sides and no calls (deferred). Times are match elapsedMs.

export type CrowdCardId = 'speed' | 'shield' | 'energy' | 'supply';
export type CrowdSide = 'teamA' | 'teamB';

export const CROWD_CALL_FIRST_MS = 20_000;
export const CROWD_CALL_EVERY_MS = 30_000;
export const CROWD_CALL_VOTE_MS = 10_000;
export const CROWD_CALL_LAND_DELAY_MS = 2_000;

export interface CrowdCallSide {
  cards: CrowdCardId[];
  /** Votes per offered card. */
  votes: Partial<Record<CrowdCardId, number>>;
  /** Set once voting closes. */
  winner: CrowdCardId | null;
  /** True when nobody voted and the house picked at random. */
  housePick: boolean;
}

export interface CrowdCallView {
  /** 1, 2, 3… within the match. */
  index: number;
  phase: 'voting' | 'landing' | 'landed';
  opensAtMs: number;
  closesAtMs: number;
  landsAtMs: number;
  sides: Record<CrowdSide, CrowdCallSide>;
}

export interface SeatView {
  index: number;
  team: 'teamA' | 'teamB' | null;
  /** null = an open seat, which a bot takes when the match starts. */
  name: string | null;
  speciesId: number | null;
  moves: number[];
  ready: boolean;
  host: boolean;
}

export interface PlayRoomView {
  id: string;
  mode: PlayModeKind;
  arena: ArenaBounds;
  phase: 'lobby' | 'battle';
  seats: SeatView[];
  /** The receiving connection's seat, or null while only watching. */
  you: number | null;
  /** An always-live room: no host, bots always fighting, matches start themselves. */
  live: boolean;
  /** During a live room's break: ms until the next match starts (as of sending). */
  startsInMs: number | null;
}

export interface PlayRoomSummary {
  id: string;
  mode: PlayModeKind;
  players: number;
  seats: number;
  phase: 'lobby' | 'battle';
  live: boolean;
}

export type ClientMessage =
  | { t: 'hello'; sessionId: string; name: string }
  | { t: 'list' }
  | { t: 'create'; mode: PlayModeKind; arena: ArenaBounds }
  /** `watch`: come in as a spectator rather than taking an open seat. */
  | { t: 'join'; roomId: string; watch?: boolean }
  /** Picks the name you chat, bet and buy under (and play under, if seated). */
  | { t: 'signup'; name: string }
  | { t: 'chat'; req: number; text: string }
  | { t: 'bet'; req: number; optionId: string; amount: number }
  | { t: 'buy'; req: number; itemId: string; targetId: string }
  /** A viewer's vote in the open Crowd Call; the first vote or bet locks their side. Re-voting switches the card. */
  | { t: 'vote'; req: number; side: CrowdSide; card: CrowdCardId }
  | { t: 'leave' }
  | { t: 'mode'; mode: PlayModeKind }
  | { t: 'seat'; index: number }
  | { t: 'pick'; speciesId: number }
  | { t: 'reroll' }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | {
      t: 'move';
      x: number;
      y: number;
      vx: number;
      vy: number;
      facing: PokemonInstance['facing'];
    }
  | { t: 'fire'; slot: number; x: number; y: number }
  | { t: 'dash' }
  | { t: 'ping'; c: number };

export type ServerMessage =
  | { t: 'rooms'; rooms: PlayRoomSummary[] }
  | { t: 'room'; room: PlayRoomView }
  | {
      t: 'start';
      config: MatchConfig;
      seed: number;
      you: string | null;
      names: Record<string, string>;
    }
  | { t: 'snap'; s: ActionSnapshot }
  | { t: 'pong'; c: number }
  | { t: 'error'; message: string }
  /** The answer to a chat/bet/buy: null on success, else an error code the
   * shared panels already know how to word (see ChatPanel/PredictionsPanel/ShopPanel). */
  | { t: 'ack'; req: number; error: string | null }
  /** This connection's own standing: sign-up name, wallet, bet and purchases. */
  | {
      t: 'me';
      name: string | null;
      balance: number;
      myBet: MyBet | null;
      myItemUses: number;
      settled?: WalletEventPayload['settled'];
      /** The side this viewer is locked to this match (first vote or bet), else null. */
      side: CrowdSide | null;
      /** This viewer's card in the open call, else null. */
      myVote: CrowdCardId | null;
    }
  /** The match's current call (null before the first / outside team matches) and every call so far, oldest first. Sent on change and ~4×/s while voting. */
  | { t: 'calls'; current: CrowdCallView | null; history: CrowdCallView[] }
  /** New chat lines; on joining a room, the whole backlog. */
  | { t: 'chat'; messages: ChatMessage[]; reset?: boolean }
  /** The current match's betting pool and item shop (null between matches). */
  | { t: 'market'; prediction: PredictionSummary | null; shop: ShopSummary | null };
