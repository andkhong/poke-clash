import type { ItemId } from './shop';

/** Wire types shared by game-server/ and the client: the crowd's chat, bets
 * and item shop in an online Play Mode room. The rest of that room's
 * messages are in play/playProtocol.ts. */

/** Which side a fighter is on in a team match. */
export type RoomTeam = 'teamA' | 'teamB';

export interface MyBet {
  optionId: string;
  amount: number;
}

/** 'open' from the match start until the betting deadline (see
 * game-server/playRooms.ts), 'closed' from then until the match ends,
 * 'settled' once the pool has paid out. */
export type PredictionStatus = 'open' | 'closed' | 'settled';

/** One thing to bet on — a fighter in a free-for-all, a side in a team
 * match. `id` is the sim team key of its members (an instance id in FFA,
 * `teamA`/`teamB` in a team match). */
export interface PredictionOptionSummary {
  id: string;
  label: string;
  instanceIds: string[];
  /** Pokémon Dollars staked on this option so far, and by how many sessions. */
  total: number;
  bettors: number;
  /** Server-estimated win probability, 0–1 (see sim/odds.ts). */
  odds: number;
  /** False once every member is down — no longer bettable. */
  alive: boolean;
}

export interface PredictionSummary {
  /** Per room, counts up with every match — the client uses it to tell a
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

/** One item actually used on a Pokémon, for the panel's activity line and
 * the system chat announcement. Carries the buyer's display name, never a
 * session id. */
export interface ItemUse {
  itemId: ItemId;
  effect: 'heal' | 'revive';
  targetInstanceId: string;
  targetName: string;
  buyerName: string;
  /** HP actually restored, after clamping to maxHp. */
  amount: number;
  atMs: number;
}

/** The room's shop for the current match. Public: everyone sees the same
 * stock draining, which is half the drama and all of the accountability. */
export interface ShopSummary {
  /** Matches PredictionSummary.matchNo — lets the client tell this match's
   * shop from the last one's leftovers. Whether the shop is trading is not
   * here: it's a function of the sim phase (see isShopOpenForPhase), which
   * every client already holds live. */
  matchNo: number;
  /** Units left of each item, room-wide, for this match. */
  stockLeft: Partial<Record<ItemId, number>>;
  /** Heals landed on each instance id so far, for MAX_HEALS_PER_TARGET. Absent ids have had none. */
  healsByTarget: Record<string, number>;
  /** The most recent uses, newest last, capped at ITEM_USE_LOG_LIMIT. */
  recent: ItemUse[];
}

/** A viewer's wallet as of a change, plus — when a match has just settled —
 * what they put in, what came back (payout or refund) and the watch reward. */
export interface WalletEventPayload {
  balance: number;
  myBet: MyBet | null;
  settled?: {
    matchNo: number;
    staked: number;
    returned: number;
    watched: number;
  };
}

export interface ApiErrorBody {
  error: string;
}

/** One room chat line. */
export interface ChatMessage {
  /** Per-room, strictly increasing — the client appends in order. */
  id: number;
  /** Always null in Play Mode rooms; senders are named by spectatorName. */
  slotIndex: number | null;
  speciesId: number | null;
  speciesName: string | null;
  /** The sender's side when they're fighting in a team match. */
  team: RoomTeam | null;
  /** The sender's display name (their sign-up name). */
  spectatorName: string | null;
  /** The sender's wallet balance when they sent this, or null with no session. */
  balance: number | null;
  /** 'system' for a line the server wrote itself (a purchase, a Crowd Call).
   * Such a line has no sender: every identity field above is null and the
   * client renders `text` on its own, so it can never be mistaken for
   * something a viewer typed. */
  kind?: 'system';
  text: string;
  sentAtMs: number;
}
